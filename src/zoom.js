// Click to enlarge: an image with data-zoom="<animation>" opens large over
// the slide when clicked, and closes on the next click, Esc, or slide change.
//
//   <img src="/assets/photo.jpg" data-zoom="grow" />
//
// The animations (grow, fade, scale, rise) are presets in
// src/styles/animations.css, section 5. The editor sets the attribute for you.

const SELECTOR = 'img[data-zoom]';

/** Makes enlargeable images reachable with the keyboard. Called after slides render. */
export function prepareZoom(slidesEl) {
  slidesEl.querySelectorAll(SELECTOR).forEach((img) => {
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    if (!img.hasAttribute('aria-label')) img.setAttribute('aria-label', `Enlarge image${img.alt ? `: ${img.alt}` : ''}`);
  });
}

// Zoom limits for the enlarged image: 1 = fitted to the screen.
const MAX_ZOOM = 8;
const WHEEL_SPEED = 0.0015; // larger = faster zoom per wheel step

export function wireZoom(deck, slidesEl) {
  let open = null; // { box, img, source, timer, pan, x, y, s, ... }

  // ---- Zoom and pan of the open image --------------------------------------
  // The pan layer is moved by (x, y) and scaled by s, from its top left corner.

  // Keeps the zoomed image on screen: no empty strip on a side where the
  // image is larger than the window, centred on a side where it is smaller.
  function clampPan() {
    const { left, top, width, height } = open.base; // the image at zoom 1
    const fit = (pos, size, view, shift) => {
      const scaled = size * open.s;
      const start = pos * open.s + shift;
      if (scaled <= view) return shift + (view - scaled) / 2 - start;
      if (start > 0) return shift - start;
      if (start + scaled < view) return shift + (view - (start + scaled));
      return shift;
    };
    open.x = fit(left, width, window.innerWidth, open.x);
    open.y = fit(top, height, window.innerHeight, open.y);
  }

  function applyZoom() {
    if (open.s <= 1.001) {
      open.s = 1;
      open.x = 0;
      open.y = 0;
    } else {
      clampPan();
    }
    open.pan.style.transform = `translate(${open.x}px, ${open.y}px) scale(${open.s})`;
    open.box.classList.toggle('is-zoomed', open.s > 1);
    open.hint.textContent = open.s > 1 ? `${Math.round(open.s * 100)} %  ·  drag to move  ·  0 resets` : 'Scroll to zoom · click to close';
  }

  /** Zoom by `factor`, keeping the screen point (px, py) where it is. */
  function zoomAt(factor, px, py) {
    if (!open) return;
    const s = Math.min(MAX_ZOOM, Math.max(1, open.s * factor));
    const k = s / open.s;
    open.x = px - (px - open.x) * k;
    open.y = py - (py - open.y) * k;
    open.s = s;
    applyZoom();
  }

  window.addEventListener(
    'wheel',
    (event) => {
      if (!open) return;
      // Also stops the browser's own page zoom (Ctrl + wheel, trackpad pinch).
      event.preventDefault();
      const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
      zoomAt(Math.exp(-event.deltaY * lines * WHEEL_SPEED), event.clientX, event.clientY);
    },
    { passive: false },
  );

  // Belt and braces for browsers that ignore draggable=false.
  document.addEventListener('dragstart', (event) => {
    if (event.target.closest?.('.zoom-layer')) event.preventDefault();
  });

  document.addEventListener('pointerdown', (event) => {
    if (!open || open.s === 1 || event.button !== 0 || !event.target.closest('.zoom-layer')) return;
    event.preventDefault(); // no text selection or native drag while panning
    open.drag = { x: event.clientX, y: event.clientY, ox: open.x, oy: open.y };
    open.dragged = false;
    open.pan.classList.add('is-dragging');
  });

  document.addEventListener('pointermove', (event) => {
    const drag = open?.drag;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!open.dragged && Math.hypot(dx, dy) < 4) return;
    open.dragged = true;
    open.x = drag.ox + dx;
    open.y = drag.oy + dy;
    applyZoom();
  });

  document.addEventListener('pointerup', () => {
    if (!open?.drag) return;
    open.drag = null;
    open.pan.classList.remove('is-dragging');
  });

  // Where the picture itself is drawn inside the <img> box. With
  // object-fit: cover part of it lies outside the box; "grow" starts from the
  // whole picture so nothing is stretched.
  function drawnRect(img) {
    const box = img.getBoundingClientRect();
    const ratio = img.naturalWidth / img.naturalHeight || box.width / box.height;
    const fit = getComputedStyle(img).objectFit;
    let w = box.width;
    let h = box.height;
    if (fit === 'cover' || fit === 'contain') {
      const wider = box.width / box.height > ratio;
      if ((fit === 'cover') === wider) h = w / ratio;
      else w = h * ratio;
    }
    return { left: box.left + (box.width - w) / 2, top: box.top + (box.height - h) / 2, width: w, height: h, ratio };
  }

  function show(source) {
    close(true);
    const from = drawnRect(source);

    // Largest size that fits the window with a margin, never upside down small.
    const margin = Math.min(window.innerWidth, window.innerHeight) * 0.06;
    const maxW = window.innerWidth - margin * 2;
    const maxH = window.innerHeight - margin * 2;
    const width = Math.min(maxW, maxH * from.ratio);
    const height = width / from.ratio;
    const left = (window.innerWidth - width) / 2;
    const top = (window.innerHeight - height) / 2;

    const box = document.createElement('div');
    box.className = 'zoom-layer';
    box.dataset.zoom = source.dataset.zoom || 'grow';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', source.alt || 'Enlarged image');

    const img = document.createElement('img');
    img.src = source.currentSrc || source.src;
    img.alt = source.alt;
    Object.assign(img.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    // For "grow": the transform that puts the large image exactly on the small one.
    box.style.setProperty('--zoom-grow', `translate(${from.left - left}px, ${from.top - top}px) scale(${from.width / width})`);

    // The image sits in a layer that the scroll wheel zooms and the mouse pans.
    // Our own drag moves the image; the browser's built-in image drag (the
    // faded copy that follows the pointer) is switched off.
    img.draggable = false;
    const pan = document.createElement('div');
    pan.className = 'zoom-pan';
    pan.append(img);

    const hint = document.createElement('div');
    hint.className = 'zoom-hint';
    hint.textContent = 'Scroll to zoom · click to close';

    box.append(pan, hint);
    document.body.append(box);
    open = { box, source, timer: 0, pan, img, hint, x: 0, y: 0, s: 1, drag: null, dragged: false, base: { left, top, width, height } };
    source.classList.add('is-zoomed');

    // Two frames, so the closed state is painted before the open one.
    requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('is-open')));
    // If the tab is not painting, do not leave the image stuck closed.
    setTimeout(() => box.classList.add('is-open'), 120);
  }

  function close(instant = false) {
    if (!open) return;
    const { box, source, timer } = open;
    open = null;
    clearTimeout(timer);
    const finish = () => {
      box.remove();
      source.classList.remove('is-zoomed');
    };
    if (instant) return finish();
    box.classList.remove('is-open');
    box.classList.add('is-closing');
    const ms = parseFloat(getComputedStyle(box).getPropertyValue('--zoom-duration')) || 0;
    setTimeout(finish, ms + 60);
    source.focus({ preventScroll: true });
  }

  slidesEl.addEventListener('click', (event) => {
    const img = event.target.closest?.(SELECTOR);
    if (img) show(img);
  });

  document.addEventListener('click', (event) => {
    if (!open || !event.target.closest('.zoom-layer')) return;
    // The end of a drag is not a click.
    if (open.dragged) return void (open.dragged = false);
    close();
  });

  // Keys while an image is open. Capture phase, so this runs before reveal.js.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!open) {
        const img = event.target.closest?.(SELECTOR);
        if (img && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          event.stopImmediatePropagation();
          show(img);
        }
        return;
      }
      // + and - zoom on the middle of the screen, 0 goes back to the whole image.
      const zoomKeys = { '+': 1.25, '=': 1.25, '-': 0.8, _: 0.8 };
      if (zoomKeys[event.key] || event.key === '0') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === '0') zoomAt(1 / open.s, 0, 0);
        else zoomAt(zoomKeys[event.key], window.innerWidth / 2, window.innerHeight / 2);
        return;
      }
      if (['Escape', 'Enter', ' '].includes(event.key)) {
        // Close only: do not also open the overview or change slide.
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      } else if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'PageDown', 'PageUp'].includes(event.key)) {
        close(true); // the clicker moves on: get out of the way at once
      }
    },
    true,
  );

  deck.on('slidechanged', () => close(true));
  window.addEventListener('resize', () => close(true));
}
