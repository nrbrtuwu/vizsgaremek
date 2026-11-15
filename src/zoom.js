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

export function wireZoom(deck, slidesEl) {
  let open = null; // { box, img, source, timer }

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

    box.append(img);
    document.body.append(box);
    open = { box, source, timer: 0 };
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
    if (open && event.target.closest('.zoom-layer')) close();
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
