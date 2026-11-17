// PDFs on slides.
//
//   <figure class="box pdf" data-pdf="/assets/report.pdf" data-page="1" data-zoom="scale"
//           style="left: 200px; top: 200px; width: 640px; height: 830px"></figure>
//
// On the slide the figure shows one page of the PDF (data-page, default 1).
// With data-zoom it opens when clicked: a scrollable view of every page, with
// zoom. The page picture is drawn when the deck loads and is never written
// into the slide file. pdf.js is bundled, so this works offline.

const DEV = import.meta.env.DEV;
// Where pdf.js finds its fonts and character maps (copied there by `npm run build`).
const DATA = DEV ? '/node_modules/pdfjs-dist/' : '/pdfjs/';

let pdfjsPromise = null;
const docs = new Map(); // url -> Promise<PDFDocumentProxy>
const thumbs = new Map(); // `${url}#${page}` -> Promise<{ url, ratio }>

async function pdfjs() {
  pdfjsPromise ||= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
    ([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    },
  );
  return pdfjsPromise;
}

export function loadPdf(url) {
  if (!docs.has(url)) {
    const promise = pdfjs().then(
      (lib) =>
        lib.getDocument({
          url,
          cMapUrl: `${DATA}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${DATA}standard_fonts/`,
          wasmUrl: `${DATA}wasm/`,
          iccUrl: `${DATA}iccs/`,
        }).promise,
    );
    promise.catch(() => docs.delete(url)); // a missing file may appear later
    docs.set(url, promise);
  }
  return docs.get(url);
}

/** Width / height of a page, for sizing a new PDF box. */
export async function pdfPageRatio(url, pageNumber = 1) {
  const doc = await loadPdf(url);
  const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));
  const viewport = page.getViewport({ scale: 1 });
  return { ratio: viewport.width / viewport.height, pages: doc.numPages };
}

// intent 'print' draws in one go, without waiting for animation frames, so
// it also works while the window is hidden and during PDF export. The viewer
// uses the normal 'display' mode, which draws in steps and stays responsive.
async function renderPage(page, canvas, cssWidth, intent = 'display') {
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvas, viewport, intent }).promise;
}

// One page as a picture, drawn once and shared by every slide that shows it.
function thumbnail(url, pageNumber) {
  const key = `${url}#${pageNumber}`;
  if (!thumbs.has(key)) {
    const promise = (async () => {
      const doc = await loadPdf(url);
      const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));
      const canvas = document.createElement('canvas');
      await renderPage(page, canvas, 1600, 'print'); // sharp at full stage size
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      return { url: URL.createObjectURL(blob), pages: doc.numPages };
    })();
    promise.catch(() => thumbs.delete(key));
    thumbs.set(key, promise);
  }
  return thumbs.get(key);
}

/** Draws the chosen page into every PDF box. Safe to call after every re-render. */
export function preparePdfs(root) {
  const waits = [];
  root.querySelectorAll('[data-pdf]').forEach((box) => {
    const url = box.getAttribute('data-pdf');
    const pageNumber = parseInt(box.getAttribute('data-page'), 10) || 1;
    const key = `${url}#${pageNumber}`;
    if (box.dataset.pdfShown === key && box.querySelector('.pdf-thumb')) return;
    box.dataset.pdfShown = key;

    let img = box.querySelector('.pdf-thumb');
    if (!img) {
      img = document.createElement('img');
      img.className = 'pdf-thumb';
      img.alt = '';
      img.draggable = false;
      box.prepend(img);
    }
    let badge = box.querySelector('.pdf-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'pdf-badge';
      box.append(badge);
    }
    badge.textContent = 'PDF';

    if (box.hasAttribute('data-zoom')) {
      box.tabIndex = 0;
      box.setAttribute('role', 'button');
      box.setAttribute('aria-label', `Open PDF ${url.split('/').pop()}`);
    }

    waits.push(
      thumbnail(url, pageNumber)
        .then((t) => {
          if (box.dataset.pdfShown !== key) return;
          img.src = t.url;
          badge.textContent = `PDF · ${t.pages} ${t.pages === 1 ? 'page' : 'pages'}`;
          box.classList.remove('pdf-missing');
        })
        .catch(() => {
          box.classList.add('pdf-missing');
          badge.textContent = `PDF not found: ${url}`;
        }),
    );
  });
  return Promise.all(waits);
}

// ---- The viewer: every page, scrollable, zoomable --------------------------

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;

export function wirePdfViewer(deck, slidesEl) {
  let view = null;

  async function show(box) {
    close(true);
    const url = box.getAttribute('data-pdf');
    const name = decodeURIComponent(url.split('/').pop());

    const layer = document.createElement('div');
    layer.className = 'pdf-viewer';
    layer.dataset.zoom = box.getAttribute('data-zoom') || 'scale';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-label', `PDF: ${name}`);
    layer.innerHTML = `
      <div class="pdf-bar">
        <span class="pdf-name"></span>
        <span class="pdf-count">…</span>
        <span class="pdf-tools">
          <button type="button" data-act="out" title="Zoom out (-)">−</button>
          <button type="button" data-act="fit" class="pdf-level" title="Fit to width (0)">100 %</button>
          <button type="button" data-act="in" title="Zoom in (+)">+</button>
          <button type="button" data-act="close" title="Close (Esc)">Close</button>
        </span>
      </div>
      <div class="pdf-scroll"><div class="pdf-pages"></div></div>`;
    layer.querySelector('.pdf-name').textContent = name;
    document.body.append(layer);

    const scroller = layer.querySelector('.pdf-scroll');
    const pagesEl = layer.querySelector('.pdf-pages');
    view = { layer, box, scroller, pagesEl, zoom: 1, pages: [], observer: null, timer: 0 };
    box.classList.add('is-open');
    requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('is-open')));
    setTimeout(() => layer.classList.add('is-open'), 120);

    let doc;
    try {
      doc = await loadPdf(url);
    } catch {
      layer.querySelector('.pdf-count').textContent = 'Could not open this PDF';
      return;
    }
    if (!view || view.layer !== layer) return; // closed while loading

    const current = view;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      if (view !== current) return;
      const base = page.getViewport({ scale: 1 });
      const holder = document.createElement('div');
      holder.className = 'pdf-page';
      const canvas = document.createElement('canvas');
      holder.append(canvas);
      pagesEl.append(holder);
      current.pages.push({ page, holder, canvas, width: base.width, height: base.height, drawnAt: 0 });
      if (n === 1) layout(); // first page visible right away
    }
    layout();

    // Draw a page when it comes near the screen.
    current.observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && draw(current.pages.find((p) => p.holder === e.target))),
      { root: scroller, rootMargin: '100% 0px' },
    );
    current.pages.forEach((p) => current.observer.observe(p.holder));

    // Start on the page the slide shows, and draw what is on screen now.
    const startPage = parseInt(box.getAttribute('data-page'), 10) || 1;
    if (startPage > 1) current.pages[startPage - 1]?.holder.scrollIntoView({ block: 'start' });
    drawVisible();
    updateCount();
  }

  // Width of a page at zoom 1: the window width minus margins, capped for reading.
  const fitWidth = () => Math.min(window.innerWidth - 96, 1100);

  function layout() {
    if (!view) return;
    const w = fitWidth() * view.zoom;
    for (const p of view.pages) {
      p.holder.style.width = `${w}px`;
      p.holder.style.height = `${(w * p.height) / p.width}px`;
    }
    view.layer.querySelector('.pdf-level').textContent = `${Math.round(view.zoom * 100)} %`;
  }

  function draw(p) {
    if (!p || !view) return;
    const w = fitWidth() * view.zoom;
    if (Math.abs(p.drawnAt - w) < 1) return;
    p.drawnAt = w;
    renderPage(p.page, p.canvas, w).catch(() => {
      p.drawnAt = 0; // cancelled or failed: try again next time
    });
  }

  // Draws the pages on screen and one screen above and below; forgets the rest.
  function drawVisible() {
    if (!view) return;
    const s = view.scroller;
    const top = s.getBoundingClientRect().top;
    view.pages.forEach((p) => {
      const r = p.holder.getBoundingClientRect();
      if (r.bottom > top - s.clientHeight && r.top < top + 2 * s.clientHeight) draw(p);
      else p.drawnAt = 0;
    });
  }

  function setZoom(zoom, anchorY = view.scroller.clientHeight / 2) {
    if (!view) return;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
    if (next === view.zoom) return;
    // Keep the point under the anchor where it is.
    const s = view.scroller;
    const relY = (s.scrollTop + anchorY) / s.scrollHeight;
    const relX = (s.scrollLeft + s.clientWidth / 2) / s.scrollWidth;
    view.zoom = next;
    layout();
    s.scrollTop = relY * s.scrollHeight - anchorY;
    s.scrollLeft = relX * s.scrollWidth - s.clientWidth / 2;
    // Sharpen the pages on screen once zooming stops.
    clearTimeout(view.timer);
    const current = view;
    view.timer = setTimeout(() => view === current && drawVisible(), 160);
  }

  function updateCount() {
    if (!view || !view.pages.length) return;
    const mid = view.scroller.getBoundingClientRect().top + view.scroller.clientHeight / 2;
    let index = view.pages.findIndex((p) => p.holder.getBoundingClientRect().bottom >= mid);
    if (index === -1) index = view.pages.length - 1;
    view.layer.querySelector('.pdf-count').textContent = `Page ${index + 1} / ${view.pages.length}`;
  }

  function close(instant = false) {
    if (!view) return;
    const { layer, box, observer, timer } = view;
    view = null;
    observer?.disconnect();
    clearTimeout(timer);
    box.classList.remove('is-open');
    const finish = () => layer.remove();
    if (instant) return finish();
    layer.classList.remove('is-open');
    const ms = parseFloat(getComputedStyle(layer).getPropertyValue('--zoom-duration')) || 0;
    setTimeout(finish, ms + 60);
    box.focus({ preventScroll: true });
  }

  // Open on click (only boxes with data-zoom; the editor sets it).
  slidesEl.addEventListener('click', (event) => {
    const box = event.target.closest?.('[data-pdf][data-zoom]');
    if (box) show(box);
  });

  document.addEventListener('click', (event) => {
    if (!view) return;
    const act = event.target.closest?.('.pdf-viewer [data-act]')?.dataset.act;
    if (act === 'close') close();
    else if (act === 'in') setZoom(view.zoom * 1.25);
    else if (act === 'out') setZoom(view.zoom / 1.25);
    else if (act === 'fit') setZoom(1);
    // A click on the dark area around the pages closes, a click on a page does not.
    else if (event.target.closest('.pdf-viewer') && !event.target.closest('.pdf-page, .pdf-bar')) close();
  });

  document.addEventListener(
    'scroll',
    (event) => {
      if (view && event.target === view.scroller) updateCount();
    },
    true,
  );

  // Ctrl + wheel and trackpad pinch zoom; a plain wheel scrolls the pages.
  window.addEventListener(
    'wheel',
    (event) => {
      if (!view) return;
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const anchor = event.clientY - view.scroller.getBoundingClientRect().top;
      setZoom(view.zoom * Math.exp(-event.deltaY * 0.002), anchor);
    },
    { passive: false },
  );

  window.addEventListener(
    'keydown',
    (event) => {
      if (!view) {
        const box = event.target.closest?.('[data-pdf][data-zoom]');
        if (box && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          event.stopImmediatePropagation();
          show(box);
        }
        return;
      }
      const s = view.scroller;
      const step = s.clientHeight * 0.85;
      const handled = {
        Escape: () => close(),
        '+': () => setZoom(view.zoom * 1.25),
        '=': () => setZoom(view.zoom * 1.25),
        '-': () => setZoom(view.zoom / 1.25),
        _: () => setZoom(view.zoom / 1.25),
        0: () => setZoom(1),
        // The clicker's next / previous scroll through the PDF.
        PageDown: () => s.scrollBy({ top: step, behavior: 'smooth' }),
        PageUp: () => s.scrollBy({ top: -step, behavior: 'smooth' }),
        ' ': () => s.scrollBy({ top: event.shiftKey ? -step : step, behavior: 'smooth' }),
        ArrowDown: () => s.scrollBy({ top: 80 }),
        ArrowUp: () => s.scrollBy({ top: -80 }),
        Home: () => s.scrollTo({ top: 0 }),
        End: () => s.scrollTo({ top: s.scrollHeight }),
      }[event.key];
      if (handled) {
        event.preventDefault();
        event.stopImmediatePropagation();
        handled();
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        close(true); // leave the PDF and let the deck change slide
      }
    },
    true,
  );

  deck.on('slidechanged', () => close(true));
  window.addEventListener('resize', () => {
    if (!view) return;
    layout();
    view.pages.forEach((p) => (p.drawnAt = 0));
    setTimeout(drawVisible, 150);
  });
}
