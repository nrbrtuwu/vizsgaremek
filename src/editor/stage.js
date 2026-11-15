// The editable slide inside /editor. Runs in the deck page (opened with ?edit),
// so what you edit is the real slide: same CSS, same fonts, same scaling.
//
// How it keeps the file clean:
//   `src`  is the slide as written in the file, parsed but never shown.
//   `live` is the copy reveal.js shows (it adds classes, highlights code...).
// Every element carries the same data-eid in both. An edit is applied to both,
// and the file is always written from `src`, so nothing reveal.js does to the
// visible copy can leak into slides/*.html.

import './stage.css';
import { isMarkdown, toSectionHtml } from '../../plugins/slide-format.js';

const STAGE_W = 1920;
const INLINE = new Set(['EM', 'STRONG', 'B', 'I', 'U', 'SPAN', 'CODE', 'BR', 'A', 'SMALL', 'SUB', 'SUP', 'MARK']);
const NOT_TEXT = new Set(['IMG', 'FIGURE', 'TABLE', 'PRE', 'HR', 'SECTION', 'UL', 'OL', 'TR', 'TBODY', 'THEAD', 'ASIDE']);
const NO_DETACH = new Set(['LI', 'TD', 'TH', 'TR', 'DT', 'DD', 'TBODY', 'THEAD']);
// The parts of an element's look that come from its slide layout. Copy takes
// them along, so a pasted title still looks like the title it was.
const COPIED_LOOK = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-transform', 'text-align',
  'font-variant-numeric', 'white-space', 'color', 'background-color', 'padding',
  'border-top', 'border-right', 'border-bottom', 'border-left',
];
// Parts inside the copied element also keep how they are laid out in it.
const INNER_LOOK = [...COPIED_LOOK, 'display', 'margin', 'gap', 'grid-template-columns', 'align-items', 'align-content', 'justify-content', 'min-height'];
// The copied element itself: everything except its outer margin, which a
// free box does not have.
const ROOT_LOOK = INNER_LOOK.filter((prop) => prop !== 'margin');
const round = Math.round;
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export function initStage(ctx) {
  const doc = document;
  doc.documentElement.classList.add('is-editing');

  let file = null;
  let src = null; // clean model of the slide, null when the slide is code-only
  let prefix = ''; // anything in the file before <section
  let live = null; // the visible <section>
  let selected = null; // a live element
  let editing = null; // live element being typed in
  let editStart = '';
  let lastSaved = '';
  let seq = 1;

  const undoStack = [];
  const redoStack = [];
  let snapKey = '';
  let snapTime = 0;

  const listeners = {};
  const emit = (name, ...args) => (listeners[name] || []).forEach((fn) => fn(...args));

  // ---- Overlay: selection frame, resize handles, hover frame ---------------

  const overlay = doc.createElement('div');
  overlay.id = 'fx-overlay';
  overlay.innerHTML =
    '<div class="fx-hover"></div><div class="fx-sel"><div class="fx-tag"></div>' +
    ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => `<span data-handle="${h}"></span>`).join('') +
    '</div>';
  const dropHint = doc.createElement('div');
  dropHint.className = 'fx-drop';
  doc.body.append(overlay, dropHint);
  const hoverBox = overlay.querySelector('.fx-hover');
  const selBox = overlay.querySelector('.fx-sel');
  const selTag = overlay.querySelector('.fx-tag');

  const place = (box, el) => {
    if (!el || !el.isConnected) return (box.style.display = 'none');
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  };

  function updateOverlay() {
    place(selBox, selected);
    if (!selected) return;
    const kind = isBox(selected)
      ? isShape(selected) || selected.tagName === 'FIGURE'
        ? 'h-all'
        : selected.tagName === 'IMG'
          ? 'h-corners'
          : 'h-sides'
      : canSetWidth(selected)
        ? 'h-sides' // layout elements: width only
        : '';
    selBox.className = `fx-sel ${editing ? 'is-typing' : kind}`;
    selTag.textContent = label(selected);
  }

  // ---- Model helpers --------------------------------------------------------

  const scale = () => live.getBoundingClientRect().width / STAGE_W;
  const isBox = (el) => el.classList.contains('box') && el.parentElement === live;
  const isShape = (el) => el.classList.contains('shape');
  // Elements that sit in a layout can still be made narrower or wider.
  // Table cells are left to the table.
  const canSetWidth = (el) => !isBox(el) && !['TD', 'TH', 'TR', 'TBODY', 'THEAD', 'IMG'].includes(el.tagName);
  // The <code> of a code block, when `el` is the block (its panel or its <pre>).
  const codeOf = (el) => (el.matches('.code-panel, pre') ? el.querySelector('code') : null);
  const imgOf = (el) => (el.tagName === 'IMG' ? el : el.tagName === 'FIGURE' ? el.querySelector('img') : null);

  const srcOf = (el) => (el === live ? src : src.querySelector(`[data-eid="${el.dataset.eid}"]`));
  const liveOf = (eid) => (!eid ? null : live.dataset.eid === eid ? live : live.querySelector(`[data-eid="${eid}"]`));
  const both = (el, fn) => {
    fn(el);
    const twin = srcOf(el);
    if (twin) fn(twin);
  };

  function tagAll(root) {
    const all = [root, ...root.querySelectorAll('*')];
    all.forEach((el) => {
      if (el.dataset.eid) seq = Math.max(seq, Number(el.dataset.eid.slice(1)) + 1);
    });
    all.forEach((el) => {
      if (!el.dataset.eid) el.dataset.eid = `e${seq++}`;
    });
  }

  // A slide can be edited visually when the file is exactly one <section>.
  function parse(text) {
    const at = text.search(/<section[\s>]/i);
    if (at === -1) return null;
    const tpl = doc.createElement('template');
    tpl.innerHTML = text.slice(at);
    const tops = [...tpl.content.children];
    if (tops.length !== 1 || tops[0].tagName !== 'SECTION' || tops[0].querySelector('section')) return null;
    return { prefix: text.slice(0, at), el: tops[0] };
  }

  const raw = () => prefix + src.outerHTML; // with ids, for undo

  function getHtml() {
    if (!src) return null;
    const clone = src.cloneNode(true);
    [clone, ...clone.querySelectorAll('*')].forEach((el) => {
      el.removeAttribute('data-eid');
      for (const name of ['style', 'class']) if (el.getAttribute(name) === '') el.removeAttribute(name);
    });
    return `${prefix}${clone.outerHTML}\n`;
  }

  // Put the given HTML on screen in place of this file's current slide.
  function mount(html) {
    const fresh = ctx.sectionsFor(file, html);
    const old = [...ctx.slidesEl.children].filter((s) => s.dataset.file === file);
    if (old.length) {
      old[0].before(...fresh);
      old.forEach((s) => s.remove());
    } else {
      ctx.slidesEl.append(...fresh);
    }
    live = src ? fresh[0] : null;
    ctx.refresh();
    ctx.gotoFile(file);
  }

  function setModel(text, { keepIds = false } = {}) {
    const keep = selected?.dataset.eid;
    editing = null;
    selected = null;
    const parsed = isMarkdown(file) ? null : parse(text);
    if (parsed) {
      src = parsed.el;
      prefix = parsed.prefix;
      tagAll(src);
      mount(src.outerHTML);
      if (keepIds) selected = liveOf(keep);
    } else {
      src = null;
      prefix = '';
      mount(toSectionHtml(file, text));
    }
    updateOverlay();
    place(hoverBox, null);
  }

  function rerender() {
    const keep = selected?.dataset.eid;
    mount(src.outerHTML);
    selected = liveOf(keep);
  }

  function snapshot(key = '') {
    const now = performance.now();
    // Typing in one inspector field, or nudging with the arrows, is one undo step.
    if (key && key === snapKey && now - snapTime < 900) {
      snapTime = now;
      return;
    }
    snapKey = key;
    snapTime = now;
    undoStack.push(raw());
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
  }

  function changed() {
    updateOverlay();
    emit('change', getHtml());
    emitSelect();
  }

  // ---- What is under the pointer -------------------------------------------

  function pick(target) {
    if (!live || !(target instanceof Element) || !live.contains(target) || target === live) return null;
    if (target.closest('aside.notes')) return null;
    let el = target;
    for (let p = target; p && p !== live; p = p.parentElement) if (isBox(p)) el = p;
    if (isBox(el)) return el;
    // A word in italics is part of its paragraph: climb to the element that holds the text.
    while (el.parentElement !== live && INLINE.has(el.tagName) && isTextEditable(el.parentElement)) el = el.parentElement;
    if (el.closest('pre')) el = el.closest('.code-panel') || el.closest('pre');
    if (el.tagName === 'IMG' && el.parentElement.tagName === 'FIGURE') el = el.parentElement;
    return el === live ? null : el;
  }

  function isTextEditable(el) {
    if (NOT_TEXT.has(el.tagName) || isShape(el) || el.closest('pre')) return false;
    return [...el.childNodes].every((n) => n.nodeType !== 1 || INLINE.has(n.tagName));
  }

  function label(el) {
    const cls = [...el.classList].filter((c) => c !== 'box' && c !== 'shape' && !c.startsWith('fx-'))[0];
    if (codeOf(el)) return 'code block';
    const kind = isBox(el) ? (el.tagName === 'IMG' ? 'image' : isShape(el) ? 'shape' : 'text box') : el.tagName.toLowerCase();
    return cls ? `${kind} .${cls}` : kind;
  }

  // ---- Geometry -------------------------------------------------------------

  function geometry(el) {
    const s = live.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const k = s.width / STAGE_W;
    return { x: round((r.left - s.left) / k), y: round((r.top - s.top) / k), w: round(r.width / k), h: round(r.height / k) };
  }

  // Elements that belong to a layout are nudged with `translate`, so they keep
  // their place in the grid. Free boxes use left/top.
  function getOffset(el) {
    const m = (el.style.translate || '').match(/(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?/);
    return m ? { dx: Number(m[1]), dy: Number(m[2] || 0) } : { dx: 0, dy: 0 };
  }

  function setOffset(el, dx, dy) {
    both(el, (e) => {
      if (!dx && !dy) e.style.removeProperty('translate');
      else e.style.translate = `${round(dx)}px ${round(dy)}px`;
    });
  }

  // Width of an element that stays in its layout. max-width is lifted because
  // paragraphs have a reading-width limit that would otherwise win.
  function setLayoutWidth(el, w) {
    both(el, (e) => {
      if (w == null) {
        e.style.removeProperty('width');
        e.style.removeProperty('max-width');
      } else {
        e.style.width = `${Math.max(40, round(w))}px`;
        e.style.maxWidth = 'none';
      }
    });
  }

  function setBoxRect(el, { x, y, w, h }) {
    both(el, (e) => {
      if (x != null) e.style.left = `${round(x)}px`;
      if (y != null) e.style.top = `${round(y)}px`;
      if (w != null) e.style.width = `${Math.max(16, round(w))}px`;
      if (h != null) e.style.height = `${Math.max(16, round(h))}px`;
    });
  }

  // ---- Snapping --------------------------------------------------------------
  // While you drag or resize, edges and centres stick to the slide's edges,
  // centre and margins, and to the edges and centres of the other elements.

  let snapEnabled = true;
  const SNAP_PX = 6; // reach on screen, whatever the zoom
  const guideX = doc.createElement('div');
  const guideY = doc.createElement('div');
  guideX.className = 'fx-guide fx-guide-x';
  guideY.className = 'fx-guide fx-guide-y';
  overlay.append(guideX, guideY);

  function snapTargets(el) {
    const cs = getComputedStyle(live);
    const padX = parseFloat(cs.paddingLeft) || 0;
    const padY = parseFloat(cs.paddingTop) || 0;
    const xs = [0, padX, STAGE_W / 2, STAGE_W - padX, STAGE_W];
    const ys = [0, padY, 540, 1080 - padY, 1080];
    const pool = new Set([...live.children, ...(el.parentElement !== live ? el.parentElement.children : [])]);
    for (const other of pool) {
      if (other === el || other.contains(el) || el.contains(other) || other.matches('aside')) continue;
      const g = geometry(other);
      if (!g.w || !g.h) continue;
      xs.push(g.x, g.x + g.w / 2, g.x + g.w);
      ys.push(g.y, g.y + g.h / 2, g.y + g.h);
    }
    return { xs, ys };
  }

  // The smallest correction that puts one of `values` on one of `targets`.
  function nearest(values, targets, reach) {
    let best = null;
    for (const v of values) {
      for (const t of targets) {
        const d = t - v;
        if (Math.abs(d) <= reach && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t };
      }
    }
    return best;
  }

  function showGuides(x, y) {
    const s = live.getBoundingClientRect();
    const k = s.width / STAGE_W;
    guideX.style.display = x == null ? 'none' : 'block';
    guideY.style.display = y == null ? 'none' : 'block';
    if (x != null) Object.assign(guideX.style, { left: `${s.left + x * k}px`, top: `${s.top}px`, height: `${s.height}px` });
    if (y != null) Object.assign(guideY.style, { top: `${s.top + y * k}px`, left: `${s.left}px`, width: `${s.width}px` });
  }

  // ---- Selection ------------------------------------------------------------

  function info(el) {
    const cs = getComputedStyle(el);
    const img = imgOf(el);
    const tokens = (el.getAttribute('data-anim') || '').split(/\s+/).filter(Boolean);
    return {
      eid: el.dataset.eid,
      label: label(el),
      box: isBox(el),
      shape: isShape(el),
      text: isTextEditable(el),
      image: !!img,
      src: img?.getAttribute('src') || '',
      alt: img?.getAttribute('alt') || '',
      zoom: img?.hasAttribute('data-zoom') ? img.getAttribute('data-zoom') || 'grow' : '',
      geo: geometry(el),
      offset: getOffset(el),
      hasParent: el.parentElement !== live,
      canDetach: !isBox(el) && !NO_DETACH.has(el.tagName),
      canSetWidth: canSetWidth(el),
      morphName: el.getAttribute('data-id') || '',
      code: codeInfo(el),
      style: {
        fontSize: round(parseFloat(cs.fontSize)),
        fontWeight: cs.fontWeight,
        fontFamily: cs.fontFamily,
        fontStyle: cs.fontStyle,
        textAlign: cs.textAlign === 'start' ? 'left' : cs.textAlign,
        color: cs.color,
        background: cs.backgroundColor,
        opacity: cs.opacity,
      },
      anim: {
        stagger: tokens.includes('stagger'),
        preset: tokens.find((t) => t !== 'stagger') || '',
        delay: el.style.getPropertyValue('--anim-delay').trim(),
      },
    };
  }

  // What the Design panel needs to edit a code block. Read from the clean
  // copy: the visible one has been rewritten by the syntax highlighter.
  function codeInfo(el) {
    if (!codeOf(el)) return null;
    const code = codeOf(srcOf(el));
    if (!code) return null;
    return {
      text: code.textContent.replace(/^\s*\n/, '').replace(/\s+$/, ''),
      language: [...code.classList].find((c) => c.startsWith('language-'))?.slice(9) || 'plaintext',
      lineNumbers: code.hasAttribute('data-line-numbers'),
    };
  }

  function slideInfo() {
    if (!src) return null;
    return {
      layout: src.getAttribute('data-layout') || '',
      transition: src.getAttribute('data-transition') || '',
      dim: src.getAttribute('data-bg-dim') ?? '',
      image: src.getAttribute('data-background-image') || '',
      notes: src.querySelector(':scope > aside.notes')?.textContent.trim().replace(/\s+/g, ' ') || '',
    };
  }

  const emitSelect = () => emit('select', selected && selected.isConnected ? info(selected) : null, slideInfo(), { undo: undoStack.length, redo: redoStack.length });

  function select(el) {
    if (editing && editing !== el) commitEdit();
    selected = el;
    updateOverlay();
    emitSelect();
  }

  // ---- Typing in place ------------------------------------------------------

  function startEdit(el, point) {
    if (!isTextEditable(el)) return;
    select(el);
    editing = el;
    editStart = raw();
    el.contentEditable = 'true';
    el.classList.add('fx-editing');
    window.focus(); // typing must go to this frame, not to the editor around it
    el.focus({ preventScroll: true });
    const sel = doc.getSelection();
    const range = point && doc.caretRangeFromPoint?.(point.x, point.y);
    if (range && el.contains(range.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      sel.selectAllChildren(el);
    }
    updateOverlay();
  }

  // contenteditable leaves <b>, <div>, styled <span> behind. Turn that back
  // into the small set of tags the slides use.
  function cleanInline(el) {
    const box = el.cloneNode(true);
    box.querySelectorAll('[data-eid]').forEach((n) => n.removeAttribute('data-eid'));
    const swap = (from, to) =>
      box.querySelectorAll(from).forEach((n) => {
        const fresh = doc.createElement(to);
        fresh.append(...n.childNodes);
        n.replaceWith(fresh);
      });
    swap('b', 'strong');
    swap('i', 'em');
    box.querySelectorAll('div, p').forEach((n) => {
      if (n.previousSibling) n.before(doc.createElement('br'));
      n.replaceWith(...n.childNodes);
    });
    box.querySelectorAll('span:not([class]), font').forEach((n) => n.replaceWith(...n.childNodes));
    box.querySelectorAll('[style]').forEach((n) => n.removeAttribute('style'));
    while (box.lastChild?.nodeName === 'BR') box.lastChild.remove();
    return box.innerHTML.replace(/&nbsp;/g, ' ');
  }

  function commitEdit() {
    if (!editing) return;
    const el = editing;
    editing = null;
    el.removeAttribute('contenteditable');
    el.classList.remove('fx-editing');
    if (el.getAttribute('class') === '') el.removeAttribute('class');
    doc.getSelection().removeAllRanges();

    const twin = srcOf(el);
    const html = cleanInline(el);
    const before = cleanInline(twin);
    if (twin && html !== before) {
      undoStack.push(editStart);
      redoStack.length = 0;
      snapKey = '';
      // A text box emptied out is removed, like in any slide tool.
      if (isBox(el) && !el.textContent.trim() && !el.querySelector('img')) {
        twin.remove();
        el.remove();
        selected = null;
      } else {
        twin.innerHTML = html;
        el.innerHTML = html;
        const a = [...twin.querySelectorAll('*')];
        const b = [...el.querySelectorAll('*')];
        a.forEach((node, i) => {
          node.dataset.eid = b[i].dataset.eid = `e${seq++}`;
        });
      }
      changed();
    } else {
      el.innerHTML = el.innerHTML; // drop any caret artefacts
      updateOverlay();
    }
  }

  // ---- Pointer: select, move, resize ---------------------------------------

  let drag = null;

  function onPointerDown(e) {
    if (!live || e.button !== 0) return;
    const handle = e.target.closest?.('[data-handle]');
    if (handle && selected) {
      e.preventDefault();
      drag = { mode: 'resize', dir: handle.dataset.handle, el: selected, x0: e.clientX, y0: e.clientY, start: geometry(selected), moved: false };
      drag.ratio = drag.start.h / Math.max(1, drag.start.w);
      drag.baseOffset = getOffset(srcOf(selected));
      return;
    }
    if (editing && editing.contains(e.target)) return; // normal caret placement
    const el = pick(e.target);
    select(el);
    place(hoverBox, null);
    if (!el) return;
    e.preventDefault();
    const box = isBox(el);
    const twin = srcOf(el);
    drag = {
      mode: 'move',
      el,
      box,
      x0: e.clientX,
      y0: e.clientY,
      moved: false,
      base: box ? { x: parseFloat(twin.style.left) || 0, y: parseFloat(twin.style.top) || 0 } : getOffset(twin),
    };
  }

  function onPointerMove(e) {
    if (!drag) {
      if (live && !editing) {
        const el = pick(e.target);
        place(hoverBox, el && el !== selected ? el : null);
      }
      return;
    }
    if (e.buttons === 0) return onPointerUp(); // released outside the frame
    let dx = (e.clientX - drag.x0) / scale();
    let dy = (e.clientY - drag.y0) / scale();
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
      drag.moved = true;
      drag.start ||= geometry(drag.el);
      drag.targets = snapTargets(drag.el);
      snapshot();
    }

    // Alt switches snapping off for as long as it is held.
    const snap = snapEnabled && !e.altKey;
    const reach = SNAP_PX / scale();
    let lineX = null;
    let lineY = null;

    if (drag.mode === 'move') {
      // Shift keeps the move on one axis.
      if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      if (snap) {
        const g = drag.start;
        const sx = e.shiftKey && dx === 0 ? null : nearest([g.x + dx, g.x + dx + g.w / 2, g.x + dx + g.w], drag.targets.xs, reach);
        const sy = e.shiftKey && dy === 0 ? null : nearest([g.y + dy, g.y + dy + g.h / 2, g.y + dy + g.h], drag.targets.ys, reach);
        if (sx) (dx += sx.d), (lineX = sx.t);
        if (sy) (dy += sy.d), (lineY = sy.t);
      }
      if (drag.box) setBoxRect(drag.el, { x: drag.base.x + dx, y: drag.base.y + dy });
      else setOffset(drag.el, drag.base.dx + dx, drag.base.dy + dy);
    } else {
      const { dir, start, el } = drag;
      if (snap) {
        // Only the edge being dragged snaps.
        const sx = dir.includes('e')
          ? nearest([start.x + start.w + dx], drag.targets.xs, reach)
          : dir.includes('w')
            ? nearest([start.x + dx], drag.targets.xs, reach)
            : null;
        if (sx) (dx += sx.d), (lineX = sx.t);
        if (isShape(el) || el.tagName === 'FIGURE') {
          const sy = dir.includes('s')
            ? nearest([start.y + start.h + dy], drag.targets.ys, reach)
            : dir.includes('n')
              ? nearest([start.y + dy], drag.targets.ys, reach)
              : null;
          if (sy) (dy += sy.d), (lineY = sy.t);
        }
      }
      let { x, y, w, h } = start;
      if (dir.includes('e')) w = start.w + dx;
      if (dir.includes('w')) w = start.w - dx;
      w = Math.max(24, w);
      if (dir.includes('w')) x = start.x + start.w - w;
      const freeHeight = isShape(el) || el.tagName === 'FIGURE';
      if (!isBox(el)) {
        // Layout element: change its width. Dragging the left handle also
        // shifts it, so the right edge stays where it is.
        w = Math.max(40, w);
        setLayoutWidth(el, w);
        if (dir.includes('w')) setOffset(el, drag.baseOffset.dx + (start.w - w), drag.baseOffset.dy);
      } else if (freeHeight) {
        if (dir.includes('s')) h = start.h + dy;
        if (dir.includes('n')) h = start.h - dy;
        h = Math.max(24, h);
        if (dir.includes('n')) y = start.y + start.h - h;
        setBoxRect(el, { x, y, w, h });
      } else {
        // Images keep their proportions; text boxes grow with their text.
        if (el.tagName === 'IMG' && dir.includes('n')) y = start.y + start.h - w * drag.ratio;
        setBoxRect(el, { x, y, w });
      }
    }
    showGuides(lineX, lineY);
    updateOverlay();
    emit('geometry', info(drag.el));
  }

  function onPointerUp() {
    const finished = drag;
    drag = null;
    showGuides(null, null);
    if (finished?.moved) changed();
  }

  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('pointermove', onPointerMove, true);
  doc.addEventListener('pointerup', onPointerUp, true);
  doc.addEventListener('pointerleave', () => place(hoverBox, null));
  doc.addEventListener('dragstart', (e) => e.preventDefault());
  doc.addEventListener('click', (e) => e.target.closest?.('a') && e.preventDefault(), true);

  doc.addEventListener('dblclick', (e) => {
    const el = pick(e.target);
    if (el && el !== editing) startEdit(el, { x: e.clientX, y: e.clientY });
  });

  doc.addEventListener('focusout', (e) => {
    if (editing && e.target === editing) commitEdit();
  });

  doc.addEventListener('paste', (e) => {
    if (!editing) return;
    e.preventDefault();
    doc.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });

  // ---- Keyboard -------------------------------------------------------------

  function onKeyDown(e) {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (mod && key === 's') {
      e.preventDefault();
      commitEdit();
      return emit('save');
    }

    if (editing) {
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        commitEdit();
      }
      if (mod && key === 'u') e.preventDefault(); // no underline in this deck
      return;
    }

    if (mod && key === 'z') {
      e.preventDefault();
      return e.shiftKey ? api.redo() : api.undo();
    }
    if (mod && key === 'y') {
      e.preventDefault();
      return api.redo();
    }
    // Copy, cut, paste: the editor keeps the clipboard, so it survives
    // switching to another slide.
    if (mod && key === 'v') {
      e.preventDefault();
      return emit('paste');
    }
    if (!selected) return;
    if (mod && (key === 'c' || key === 'x')) {
      e.preventDefault();
      return emit(key === 'c' ? 'copy' : 'cut');
    }

    if (mod && key === 'd') {
      e.preventDefault();
      return api.duplicate();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      return api.remove();
    }
    if (e.key === 'Escape') return select(selected.parentElement !== live ? selected.parentElement : null);
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      return startEdit(selected);
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key]) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const [ax, ay] = arrows[e.key];
      snapshot(`nudge:${selected.dataset.eid}`);
      const twin = srcOf(selected);
      if (isBox(selected)) {
        setBoxRect(selected, { x: (parseFloat(twin.style.left) || 0) + ax * step, y: (parseFloat(twin.style.top) || 0) + ay * step });
      } else {
        const o = getOffset(twin);
        setOffset(selected, o.dx + ax * step, o.dy + ay * step);
      }
      changed();
    }
  }
  doc.addEventListener('keydown', onKeyDown);

  // ---- Dropping an image file onto the slide -------------------------------

  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  doc.addEventListener('dragover', (e) => {
    if (!src || !hasFiles(e)) return;
    e.preventDefault();
    dropHint.classList.add('is-on');
  });
  doc.addEventListener('dragleave', () => dropHint.classList.remove('is-on'));
  doc.addEventListener('drop', (e) => {
    dropHint.classList.remove('is-on');
    if (!src || !hasFiles(e)) return;
    e.preventDefault();
    const image = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    if (!image) return;
    const s = live.getBoundingClientRect();
    emit('dropfile', image, { x: round((e.clientX - s.left) / scale()), y: round((e.clientY - s.top) / scale()) });
  });

  window.addEventListener('resize', () => requestAnimationFrame(updateOverlay));
  ctx.deck.on('resize', () => requestAnimationFrame(updateOverlay));

  // ---- Adding things --------------------------------------------------------

  // New elements go at the end of the slide, before the speaker notes.
  function addToSlide(el) {
    const notes = src.querySelector(':scope > aside.notes');
    if (notes) {
      notes.before(el, '\n\n  ');
    } else {
      const last = src.lastChild;
      if (last?.nodeType === 3 && !last.textContent.trim()) last.remove();
      src.append('\n\n  ', el, '\n');
    }
  }

  const fromHtml = (html) => {
    const tpl = doc.createElement('template');
    tpl.innerHTML = html;
    return tpl.content.firstElementChild;
  };

  const naturalSize = (url) =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 800, h: img.naturalHeight || 600 });
      img.onerror = () => resolve({ w: 800, h: 600 });
      img.src = url;
    });

  // ---- Copying an element's exact look ---------------------------------------
  // A lot of how an element looks comes from the slide it is on (its layout's
  // CSS). To paste it elsewhere unchanged, Copy records how every part is
  // drawn, and Paste writes down only the values that would otherwise differ.

  // The element and everything inside it, except the inside of a code block
  // (the highlighter rewrites that, and it looks the same everywhere).
  const lookParts = (rootEl) => [rootEl, ...[...rootEl.querySelectorAll('*')].filter((n) => !n.closest('pre'))];

  function readLook(el, inner) {
    const cs = getComputedStyle(el);
    const look = {};
    for (const prop of inner ? INNER_LOOK : ROOT_LOOK) look[prop] = cs.getPropertyValue(prop);
    return look;
  }

  function applyLooks(rootEl, looks) {
    let parts = lookParts(rootEl);
    if (parts.length !== looks.length) parts = [rootEl]; // structure differs: do the element itself
    parts.forEach((el, i) => {
      const want = looks[i];
      const size = parseFloat(want['font-size']) || 1;
      for (const prop of i > 0 ? INNER_LOOK : ROOT_LOOK) {
        let value = want[prop];
        if (value == null || value === '' || getComputedStyle(el).getPropertyValue(prop) === value) continue;
        // Spacing stays relative to the text size, so resizing the text later still looks right.
        if (prop === 'line-height' && value.endsWith('px')) value = String(Math.round((parseFloat(value) / size) * 1000) / 1000);
        if (prop === 'letter-spacing' && value.endsWith('px')) value = `${Math.round((parseFloat(value) / size) * 1000) / 1000}em`;
        both(el, (e) => e.style.setProperty(prop, value));
      }
    });
  }

  // A child of a staggered group has no animation of its own: it gets the
  // group's preset and a delay from its place in the group. Work that out, so
  // a copy of just this child animates the same way.
  function inheritedAnim(el, twin) {
    if (twin.hasAttribute('data-anim') || /(^|\s)anim-/.test(twin.className)) return null;
    const parent = el.parentElement;
    if (!parent || parent === live) return null;
    const tokens = (parent.getAttribute('data-anim') || '').split(/\s+/).filter(Boolean);
    if (!tokens.includes('stagger') && !parent.classList.contains('anim-stagger')) return null;
    const cs = getComputedStyle(el);
    const ms = (name) => {
      const v = cs.getPropertyValue(name).trim();
      const n = parseFloat(v);
      return Number.isFinite(n) ? (v.endsWith('ms') ? n : n * 1000) : 0;
    };
    const index = parseFloat(cs.getPropertyValue('--i')) || 0;
    return { preset: tokens.find((t) => t !== 'stagger') || 'fade-up', delay: `${Math.round(ms('--anim-delay') + index * ms('--anim-stagger'))}ms` };
  }

  // ---- Public API (called by src/editor/editor.js in the parent page) -------

  const api = {
    on(name, fn) {
      (listeners[name] ||= []).push(fn);
    },

    /** Show a slide file. Returns { visual } - false means code view only. */
    open(name, text) {
      commitEdit();
      file = name;
      lastSaved = text;
      undoStack.length = redoStack.length = 0;
      setModel(text);
      emitSelect();
      return { visual: !!src };
    },

    /** New text from the code view. */
    setSource(text) {
      if (src) snapshot('code');
      setModel(text, { keepIds: true });
      emitSelect();
      return { visual: !!src };
    },

    getHtml,
    /** Turn snapping on or off (the Snap button in the editor). */
    setSnap(on) {
      snapEnabled = !!on;
    },
    markSaved(text) {
      lastSaved = text;
    },

    /** The slide files changed on disk (our own save, or another program). */
    onDisk(list) {
      const sameAsSaved = (s) => s.html === toSectionHtml(s.file, lastSaved);
      let mine = file && (list.find((s) => s.file === file) || list.find(sameAsSaved));
      const kept = file ? [...ctx.slidesEl.children].filter((s) => s.dataset.file === file) : [];
      if (mine && mine.file !== file) {
        // Reordering renames files: follow our slide to its new name.
        file = mine.file;
        kept.forEach((s) => s.setAttribute('data-file', file));
        emit('renamed', file);
      }
      const external = mine && !sameAsSaved(mine);
      ctx.slidesEl.replaceChildren(...list.flatMap((s) => (s === mine && !external && kept.length ? kept : ctx.sectionsFor(s.file, s.html))));
      ctx.refresh();
      if (mine) ctx.gotoFile(file);
      updateOverlay();
      if (external) emit('external', file);
    },

    select(eid) {
      select(eid ? liveOf(eid) : null);
    },
    selectParent() {
      if (selected && selected.parentElement !== live) select(selected.parentElement);
    },
    editText() {
      if (selected) startEdit(selected);
    },

    async insert(kind, opts = {}) {
      if (!src) return;
      commitEdit();
      const n = src.querySelectorAll(':scope > .box').length % 8;
      let x = opts.x ?? 240 + n * 32;
      let y = opts.y ?? 240 + n * 32;
      let html;
      if (kind === 'image') {
        const size = await naturalSize(opts.src);
        const w = Math.min(size.w, 720);
        if (opts.x != null) {
          x -= w / 2; // dropped: centre it under the pointer
          y -= (w * size.h) / size.w / 2;
        }
        html = `<img class="box" src="${escAttr(opts.src)}" alt="" style="left: ${round(x)}px; top: ${round(y)}px; width: ${round(w)}px" />`;
      } else if (kind === 'code') {
        const sample = ['// Your code here', 'function hello(name) {', "  return 'Hello, ' + name;", '}'].join('\n');
        html = `<div class="box code-panel" style="left: ${x}px; top: ${y}px; width: 900px"><pre><code class="language-javascript" data-trim data-line-numbers>\n${sample}\n</code></pre></div>`;
      } else if (kind === 'heading') {
        html = `<h2 class="box" style="left: ${x}px; top: ${y}px; width: 960px">Heading</h2>`;
      } else if (kind === 'rect') {
        html = `<div class="box shape" style="left: ${x}px; top: ${y}px; width: 360px; height: 240px; background: #8b5cf6"></div>`;
      } else {
        html = `<p class="box" style="left: ${x}px; top: ${y}px; width: 640px">Text</p>`;
      }
      snapshot();
      const el = fromHtml(html);
      addToSlide(el);
      tagAll(el);
      rerender();
      selected = liveOf(el.dataset.eid);
      changed();
      if (kind === 'text' || kind === 'heading') startEdit(selected);
    },

    remove() {
      if (!selected || !src) return;
      commitEdit();
      snapshot();
      const twin = srcOf(selected);
      const before = twin.previousSibling;
      if (before?.nodeType === 3 && !before.textContent.trim()) before.remove();
      twin.remove();
      selected = null;
      rerender();
      changed();
    },

    duplicate() {
      if (!selected || !src) return;
      commitEdit();
      snapshot();
      const twin = srcOf(selected);
      const copy = twin.cloneNode(true);
      // A copy on the same slide is a new object: it gets no morph identity.
      [copy, ...copy.querySelectorAll('*')].forEach((n) => {
        n.removeAttribute('data-eid');
        n.removeAttribute('data-id');
      });
      tagAll(copy);
      if (isBox(selected)) {
        copy.style.left = `${(parseFloat(twin.style.left) || 0) + 32}px`;
        copy.style.top = `${(parseFloat(twin.style.top) || 0) + 32}px`;
      }
      const gap = twin.previousSibling?.nodeType === 3 && !twin.previousSibling.textContent.trim() ? twin.previousSibling.textContent : '\n';
      twin.after(gap, copy);
      rerender();
      selected = liveOf(copy.dataset.eid);
      changed();
    },

    /**
     * What Copy puts on the editor's clipboard: the element as clean HTML, plus
     * where it sits and how its text looks, so it can be rebuilt on a slide
     * with a different layout.
     */
    copy() {
      if (!selected || !src) return null;
      commitEdit();
      const twin = srcOf(selected);
      const clone = twin.cloneNode(true);
      [clone, ...clone.querySelectorAll('*')].forEach((n) => n.removeAttribute('data-eid'));
      return {
        html: clone.outerHTML,
        box: isBox(selected),
        geo: geometry(selected),
        // How the element and everything inside it is drawn right now.
        looks: lookParts(selected).map((part, i) => readLook(part, i > 0)),
        // The animation it gets from a staggered group, if it has none of its own.
        anim: inheritedAnim(selected, twin),
        file,
        tag: selected.tagName,
      };
    },

    /** Puts a copied element on this slide, as a free box in the same place. */
    paste(clip) {
      if (!clip || !src) return;
      commitEdit();
      const el = fromHtml(clip.html);
      if (!el) return;
      snapshot();

      // An element that lived in a layout becomes a free box here.
      if (!clip.box) {
        el.classList.add('box');
        el.style.removeProperty('translate');
        el.style.removeProperty('max-width');
        el.style.width = `${clip.geo.w}px`;
        if (clip.tag === 'FIGURE') el.style.height = `${clip.geo.h}px`;
      }

      // It was animated as part of a staggered group: give it that animation
      // and its own turn in the sequence.
      if (clip.anim && !el.hasAttribute('data-anim')) {
        el.setAttribute('data-anim', clip.anim.preset);
        el.style.setProperty('--anim-delay', clip.anim.delay);
      }

      // Same place as the original; a little lower right if something of the
      // same kind already sits exactly there (pasting twice, or on its own slide).
      let { x, y } = clip.geo;
      const taken = () =>
        [...src.querySelectorAll(':scope > .box')].some((b) => parseFloat(b.style.left) === x && parseFloat(b.style.top) === y);
      const sameSlideOriginal = clip.file === file && !clip.box;
      if (sameSlideOriginal) (x += 32), (y += 32);
      while (taken()) (x += 32), (y += 32);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;

      // Morph names must stay unique on a slide.
      [el, ...el.querySelectorAll('[data-id]')].forEach((n) => {
        const id = n.getAttribute('data-id');
        if (id && src.querySelector(`[data-id="${CSS.escape(id)}"]`)) n.removeAttribute('data-id');
      });

      addToSlide(el);
      tagAll(el);
      rerender();
      selected = liveOf(el.dataset.eid);
      // Whatever still looks different from the original (because this slide's
      // layout styles it differently) is pinned to the original's values.
      if (selected && clip.looks) applyLooks(selected, clip.looks);
      changed();
    },

    /** 'front' or 'back' - only for free boxes, which can overlap. */
    order(where) {
      if (!selected || !isBox(selected)) return;
      snapshot();
      const twin = srcOf(selected);
      const before = twin.previousSibling;
      if (before?.nodeType === 3 && !before.textContent.trim()) before.remove();
      if (where === 'back') src.prepend('\n  ', twin);
      else addToSlide(twin);
      rerender();
      changed();
    },

    /** Take an element out of its layout and make it a free box in the same spot. */
    detach() {
      if (!selected || isBox(selected) || NO_DETACH.has(selected.tagName)) return;
      commitEdit();
      const g = geometry(selected);
      snapshot();
      const twin = srcOf(selected);
      const before = twin.previousSibling;
      if (before?.nodeType === 3 && !before.textContent.trim()) before.remove();
      twin.classList.add('box');
      twin.style.removeProperty('translate');
      twin.style.left = `${g.x}px`;
      twin.style.top = `${g.y}px`;
      twin.style.width = `${g.w}px`;
      if (twin.tagName === 'FIGURE') twin.style.height = `${g.h}px`;
      addToSlide(twin);
      rerender();
      changed();
    },

    resetOffset() {
      if (!selected || isBox(selected)) return;
      snapshot();
      setOffset(selected, 0, 0);
      setLayoutWidth(selected, null); // back to the width the layout gives it
      changed();
    },

    /** x/y/w/h from the inspector. For layout elements x/y are the offset. */
    setGeometry(g) {
      if (!selected) return;
      snapshot(`geo:${selected.dataset.eid}`);
      if (isBox(selected)) {
        setBoxRect(selected, g);
      } else {
        const o = getOffset(srcOf(selected));
        if (g.x != null || g.y != null) setOffset(selected, g.x ?? o.dx, g.y ?? o.dy);
        if (g.w != null && canSetWidth(selected)) setLayoutWidth(selected, g.w);
      }
      changed();
    },

    setStyle(prop, value) {
      if (!selected) return;
      snapshot(`style:${prop}:${selected.dataset.eid}`);
      both(selected, (e) => (value === '' || value == null ? e.style.removeProperty(prop) : e.style.setProperty(prop, value)));
      changed();
    },

    setImage(url, alt) {
      const img = selected && imgOf(selected);
      if (!img) return;
      snapshot(`img:${selected.dataset.eid}`);
      both(img, (e) => {
        if (url != null) e.setAttribute('src', url);
        if (alt != null) e.setAttribute('alt', alt);
      });
      changed();
    },

    /** Morph identity (data-id). The same name on two neighbouring slides = one object. */
    setMorphName(name) {
      if (!selected) return;
      snapshot(`morph:${selected.dataset.eid}`);
      const value = name.trim();
      both(selected, (e) => (value ? e.setAttribute('data-id', value) : e.removeAttribute('data-id')));
      changed();
    },

    /**
     * Gives every object on the slide a data-id, if it has none. Called before
     * a slide is duplicated, so the copy's objects are "the same objects" and
     * Morph can follow them even after their text, place or size changes.
     */
    ensureMorphIds() {
      if (!src) return false;
      commitEdit();
      const fresh = [];
      const isObject = (el) =>
        (el.classList.contains('box') && el.parentElement === src) ||
        ['FIGURE', 'IMG', 'TABLE', 'PRE', 'HR'].includes(el.tagName) ||
        el.classList.contains('code-panel') ||
        el.classList.contains('shape') ||
        [...el.children].every((child) => INLINE.has(child.tagName));
      const visit = (el) => {
        if (el.matches('aside')) return;
        if (el.hasAttribute('data-id')) return;
        if (isObject(el)) return fresh.push(el);
        [...el.children].forEach(visit);
      };
      [...src.children].forEach(visit);
      if (!fresh.length) return false;
      snapshot();
      fresh.forEach((el) => {
        const id = `m-${Math.random().toString(36).slice(2, 8)}`;
        el.setAttribute('data-id', id);
        liveOf(el.dataset.eid)?.setAttribute('data-id', id);
      });
      changed();
      return true;
    },

    /** Code block: its text, language and whether lines are numbered. */
    setCode({ text, language, lineNumbers }) {
      if (!selected || !codeOf(selected)) return;
      snapshot(`code:${selected.dataset.eid}`);
      const code = codeOf(srcOf(selected));
      if (text != null) code.textContent = `\n${text}\n`;
      if (language != null) {
        [...code.classList].filter((c) => c.startsWith('language-') || c === 'hljs').forEach((c) => code.classList.remove(c));
        code.classList.add(`language-${language}`);
      }
      if (lineNumbers != null) {
        if (lineNumbers) code.setAttribute('data-line-numbers', '');
        else code.removeAttribute('data-line-numbers');
      }
      code.setAttribute('data-trim', '');
      rerender(); // the highlighter has to run again
      changed();
    },

    /** Click to enlarge: '' turns it off, otherwise the name of the animation. */
    setZoom(name) {
      const img = selected && imgOf(selected);
      if (!img) return;
      snapshot(`zoom:${selected.dataset.eid}`);
      both(img, (e) => (name ? e.setAttribute('data-zoom', name) : e.removeAttribute('data-zoom')));
      changed();
    },

    setAnim({ preset, stagger, delay }) {
      if (!selected) return;
      snapshot(`anim:${selected.dataset.eid}`);
      const value = [stagger && 'stagger', preset].filter(Boolean).join(' ');
      both(selected, (e) => {
        if (value) e.setAttribute('data-anim', value);
        else e.removeAttribute('data-anim');
        if (delay) e.style.setProperty('--anim-delay', delay);
        else e.style.removeProperty('--anim-delay');
      });
      changed();
    },

    /** Attributes of the slide itself: data-transition, data-bg-dim, ... */
    setSlide(name, value) {
      if (!src) return;
      snapshot(`slide:${name}`);
      both(live, (e) => (value === '' || value == null ? e.removeAttribute(name) : e.setAttribute(name, value)));
      if (name.startsWith('data-background')) rerender();
      ctx.applySlideState(live, { immediate: true });
      changed();
    },

    setNotes(text) {
      if (!src) return;
      snapshot('notes');
      let notes = src.querySelector(':scope > aside.notes');
      if (!text.trim()) {
        notes?.remove();
      } else {
        if (!notes) {
          notes = fromHtml('<aside class="notes"></aside>');
          const last = src.lastChild;
          if (last?.nodeType === 3 && !last.textContent.trim()) last.remove();
          src.append('\n\n  ', notes, '\n');
          tagAll(notes);
        }
        notes.textContent = text;
      }
      emit('change', getHtml());
    },

    undo() {
      commitEdit();
      if (!src || !undoStack.length) return;
      redoStack.push(raw());
      restore(undoStack.pop());
    },

    redo() {
      commitEdit();
      if (!src || !redoStack.length) return;
      undoStack.push(raw());
      restore(redoStack.pop());
    },
  };

  function restore(text) {
    snapKey = '';
    const keep = selected?.dataset.eid;
    const parsed = parse(text);
    if (!parsed) return;
    src = parsed.el;
    prefix = parsed.prefix;
    tagAll(src);
    mount(src.outerHTML);
    selected = liveOf(keep);
    ctx.applySlideState(live, { immediate: true });
    changed();
  }

  return api;
}
