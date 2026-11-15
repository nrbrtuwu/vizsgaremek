// The slide editor at /editor.
//
//   left    slide list (add, duplicate, delete, reorder)
//   middle  the slide itself, editable: src/editor/stage.js runs inside the frame
//   right   Design (properties of what is selected) or Code (the file as text)
//
// Every change is saved to slides/<file> a moment later. The file API lives in
// plugins/slides-plugin.js and only exists while `npm run dev` is running.

import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { isMarkdown, toSectionHtml } from '../../plugins/slide-format.js';
import { FONTS, fontKeyFor, fontStyles } from './fonts.js';
import './editor.css';

const $ = (id) => document.getElementById(id);
const listEl = $('list');
const statusEl = $('status');
const frame = $('stage');
const inspector = $('inspector');

const state = {
  files: [],
  current: null,
  text: '', // content of the current file, as it is or will be on disk
  visual: false, // false: the slide can only be edited as code
  tab: 'design',
};

let stage = null; // API of src/editor/stage.js inside the frame

// ---- Small DOM helper -----------------------------------------------------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

// ---- API ------------------------------------------------------------------

async function api(method, path = '', body) {
  const res = await fetch(`/api/slides${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const enc = encodeURIComponent;

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

async function guard(action) {
  try {
    return await action();
  } catch (error) {
    setStatus(error.message, 'is-error');
    console.error(error);
  }
}

// ---- Saving: automatic, a moment after the last change --------------------

let saveTimer = 0;
let saving = Promise.resolve();

function scheduleSave() {
  setStatus('Saving', 'is-busy');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 500);
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  const file = state.current;
  const text = state.text;
  if (!file) return saving;
  stage?.markSaved(text); // so the stage knows the coming file change is ours
  saving = saving.then(() =>
    guard(async () => {
      await api('PUT', `/${enc(file)}`, { content: text });
      if (!saveTimer) setStatus('Saved');
    }),
  );
  return saving;
}

const flushSave = () => (saveTimer ? save() : saving);

// ---- Code view ------------------------------------------------------------

const language = new Compartment();

const theme = EditorView.theme(
  {
    '&': { backgroundColor: '#050505', color: '#ffffff', fontSize: '13px' },
    '.cm-scroller': { fontFamily: "'Geist Mono', ui-monospace, Consolas, monospace", lineHeight: '1.65' },
    '.cm-content': { padding: '14px 0', caretColor: '#ffffff' },
    '.cm-gutters': { backgroundColor: '#050505', color: 'rgba(255,255,255,0.4)', border: 'none', paddingLeft: '6px' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.05)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#ffffff' },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-cursor': { borderLeftColor: '#ffffff' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(139,92,246,0.45)' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(139,92,246,0.4)', outline: 'none' },
    '.cm-tooltip': { backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '0' },
    '.cm-panels': { backgroundColor: '#111', color: '#fff' },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.tagName, t.keyword, t.heading], color: '#b9a2fb' },
  { tag: [t.attributeName, t.propertyName], color: '#dcd0ff' },
  { tag: [t.string, t.attributeValue], color: '#ffffff' },
  { tag: [t.comment, t.meta], color: 'rgba(255,255,255,0.55)' },
  { tag: [t.angleBracket, t.punctuation], color: 'rgba(255,255,255,0.6)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '600' },
]);

let muted = false; // true while code is replaced by the program, not by typing
let codeTimer = 0;

const code = new EditorView({
  parent: $('code'),
  state: EditorState.create({
    doc: '',
    extensions: [
      basicSetup,
      keymap.of([indentWithTab, { key: 'Mod-s', preventDefault: true, run: () => (save(), true) }]),
      language.of(html()),
      theme,
      syntaxHighlighting(highlight),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !muted) onCodeEdit(update.state.doc.toString());
      }),
    ],
  }),
});

function showCode(text) {
  if (code.state.doc.toString() === text) return;
  muted = true;
  code.dispatch({
    changes: { from: 0, to: code.state.doc.length, insert: text },
    effects: language.reconfigure(isMarkdown(state.current || '') ? markdown() : html()),
  });
  muted = false;
}

function onCodeEdit(text) {
  state.text = text;
  scheduleSave();
  clearTimeout(codeTimer);
  codeTimer = setTimeout(() => {
    if (!stage) return;
    setVisual(stage.setSource(text).visual);
  }, 250);
}

function setTab(tab) {
  state.tab = tab;
  $('tab-design').classList.toggle('is-active', tab === 'design');
  $('tab-code').classList.toggle('is-active', tab === 'code');
  inspector.hidden = tab !== 'design';
  $('code').hidden = tab !== 'code';
  document.querySelector('.panes').classList.toggle('is-code', tab === 'code');
  if (tab === 'code') {
    showCode(state.text);
    code.requestMeasure();
  }
}

let autoCode = false; // the Code tab was opened by the editor, not by the user

$('tab-design').addEventListener('click', () => ((autoCode = false), setTab('design')));
$('tab-code').addEventListener('click', () => ((autoCode = false), setTab('code')));

// ---- Stage wiring ---------------------------------------------------------

let selection = null; // info about the selected element, from the stage
let slideInfo = null;

function setVisual(visual) {
  state.visual = visual;
  for (const id of ['add-text', 'add-heading', 'add-image', 'add-rect', 'add-code']) $(id).disabled = !visual;
  $('stage-hint').textContent = visual
    ? 'Click to select. Double-click to type. Drag to move.'
    : 'This slide is edited in the Code tab.';
  if (!visual) renderInspector(true);
}

function attachStage() {
  const next = frame.contentWindow.fogyaStage;
  if (!next || next === stage) return;
  stage = next;
  stage.setSnap(snapOn);

  stage.on('change', (text) => {
    if (text == null) return;
    state.text = text;
    if (state.tab === 'code') showCode(text);
    scheduleSave();
  });

  stage.on('select', (info, slide, history) => {
    // Same element of the same kind: keep the panel and only refresh its values.
    const kind = (i) => (i ? `${i.eid}:${i.box}:${i.shape}:${i.image}:${i.text}` : 'slide');
    const sameTarget = kind(info) === kind(selection) && !!slide === !!slideInfo;
    selection = info;
    slideInfo = slide;
    $('undo').disabled = !history.undo;
    $('redo').disabled = !history.redo;
    // A code-only slide has neither: rebuild, so no field reads missing values.
    renderInspector(!sameTarget || (!info && !slide));
  });

  stage.on('geometry', (info) => {
    selection = info;
    renderInspector(false);
  });

  stage.on('renamed', (file) => {
    state.current = file;
    renderList();
  });

  // Another program changed the file we have open.
  stage.on('external', (file) => {
    if (file === state.current && !saveTimer) select(file, { reload: true });
  });

  stage.on('save', save);
  stage.on('copy', () => copySelection());
  stage.on('cut', () => copySelection({ cut: true }));
  stage.on('paste', pasteClipboard);
  stage.on('dropfile', (file, at) => guard(async () => stage.insert('image', { src: await upload(file), ...at })));

  if (state.current) select(state.current, { reload: true });
}

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
  if (event.data?.type === 'fogya:ready') attachStage();
});

// ---- Inspector ------------------------------------------------------------

const PRESETS = ['', 'fade-up', 'fade-down', 'slide-in', 'slide-in-right', 'scale', 'fade', 'wipe', 'wipe-rise'];
const TRANSITIONS = ['', 'morph', 'rise', 'drift', 'wipe', 'cut', 'fade', 'slide', 'zoom', 'none'];
const ZOOMS = [
  ['grow', 'Grow from its place'],
  ['fade', 'Fade in'],
  ['scale', 'Scale up'],
  ['rise', 'Rise from below'],
];
const TEXT_COLORS = [
  ['White', '#ffffff'],
  ['Muted', 'rgba(255, 255, 255, 0.74)'],
  ['Violet tint', '#b9a2fb'],
  ['Violet', '#8b5cf6'],
  ['Black', '#000000'],
];
const FILLS = [
  ['Violet', '#8b5cf6'],
  ['Deep violet', '#4c1d95'],
  ['Indigo', '#1e1b4b'],
  ['White', '#ffffff'],
  ['Black', '#000000'],
];
const WEIGHTS = [['300', 'Light'], ['400', 'Regular'], ['500', 'Medium'], ['600', 'SemiBold'], ['700', 'Bold'], ['800', 'ExtraBold']];
const LANGUAGES = [
  ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['xml', 'HTML / XML'], ['css', 'CSS'], ['python', 'Python'],
  ['java', 'Java'], ['csharp', 'C#'], ['cpp', 'C / C++'], ['php', 'PHP'], ['sql', 'SQL'], ['json', 'JSON'], ['bash', 'Shell'], ['plaintext', 'Plain text'],
];

// Font menu entries, each shown in its own typeface.
const fontOptions = () =>
  FONTS.map((font) => {
    const option = h('option', { value: font.key }, font.label);
    option.style.fontFamily = font.family;
    if (font.weight) option.style.fontWeight = font.weight;
    if (font.style) option.style.fontStyle = font.style;
    return option;
  });
const currentFont = (info) => fontKeyFor({ family: info.style.fontFamily, style: info.style.fontStyle, weight: info.style.fontWeight });
const applyFont = (key) => Object.entries(fontStyles(key)).forEach(([prop, value]) => stage.setStyle(prop, value));

// Fields register how to refresh themselves, so values can update while the
// panel stays in place (for example while you drag an element on the slide).
let bindings = [];

function bind(el, read, prop = 'value') {
  bindings.push(() => {
    if (document.activeElement === el) return; // do not fight the user's typing
    const value = read();
    if (value != null && el[prop] !== value) el[prop] = value;
  });
  return el;
}

const field = (label, control) => h('label', { class: 'field' }, label, control);

function numberField(label, read, write, { min, max, step = 1 } = {}) {
  const input = h('input', { type: 'number', step });
  if (min != null) input.min = min;
  if (max != null) input.max = max;
  input.addEventListener('input', () => {
    if (input.value !== '' && Number.isFinite(input.valueAsNumber)) write(input.valueAsNumber);
  });
  return field(label, bind(input, () => String(read())));
}

function selectField(label, options, read, write) {
  const select = h(
    'select',
    { onchange: () => write(select.value) },
    options.map(([value, text]) => h('option', { value }, text)),
  );
  return field(label, bind(select, read));
}

function swatches(label, colors, read, write) {
  const buttons = colors.map(([name, color]) => {
    const button = h('button', { type: 'button', class: 'swatch', title: name, 'aria-label': name, onclick: () => write(color) });
    button.style.background = color;
    bindings.push(() => button.classList.toggle('is-on', sameColor(read(), color)));
    return button;
  });
  return h('div', { class: 'field' }, label, h('div', { class: 'swatches' }, buttons));
}

const probe = document.createElement('span');
function sameColor(a, b) {
  const norm = (c) => {
    probe.style.color = '';
    probe.style.color = c;
    return probe.style.color.replace(/\s+/g, '');
  };
  return norm(a) === norm(b);
}

const button = (text, onclick, extra = {}) => h('button', { type: 'button', class: 'btn', onclick, ...extra }, text);
const group = (title, ...children) => h('section', { class: 'group' }, title && h('p', { class: 'group-title' }, title), children);

function elementPanels() {
  const s = () => selection;
  const panels = [];

  panels.push(
    group(
      'Selected',
      h('h2', {}, selection.label),
      h(
        'div',
        { class: 'row' },
        selection.text && button('Edit text', () => stage.editText()),
        selection.hasParent && button('Select group', () => stage.selectParent()),
      ),
    ),
  );

  if (selection.box) {
    panels.push(
      group(
        'Position and size',
        h(
          'div',
          { class: 'row' },
          numberField('X', () => s().geo.x, (x) => stage.setGeometry({ x })),
          numberField('Y', () => s().geo.y, (y) => stage.setGeometry({ y })),
          numberField('Width', () => s().geo.w, (w) => stage.setGeometry({ w }), { min: 16 }),
          selection.shape && numberField('Height', () => s().geo.h, (hh) => stage.setGeometry({ h: hh }), { min: 16 }),
        ),
        h('div', { class: 'row' }, button('To front', () => stage.order('front')), button('To back', () => stage.order('back'))),
      ),
    );
  } else {
    panels.push(
      group(
        'Position',
        h('p', {}, 'This element belongs to the slide layout. Drag it to nudge it, drag a side handle to change its width, or free it to place it anywhere.'),
        h(
          'div',
          { class: 'row' },
          numberField('Offset X', () => s().offset.dx, (x) => stage.setGeometry({ x })),
          numberField('Offset Y', () => s().offset.dy, (y) => stage.setGeometry({ y })),
          selection.canSetWidth && numberField('Width', () => s().geo.w, (w) => stage.setGeometry({ w }), { min: 40 }),
        ),
        h(
          'div',
          { class: 'row' },
          button('Reset', () => stage.resetOffset()),
          selection.canDetach && button('Free from layout', () => stage.detach()),
        ),
      ),
    );
  }

  if (selection.image) {
    const img = h('img', { class: 'preview-img', alt: '' });
    bindings.push(() => {
      if (img.getAttribute('src') !== s().src) img.src = s().src;
    });
    const alt = h('input', { type: 'text', oninput: () => stage.setImage(null, alt.value) });
    panels.push(
      group('Image', img, button('Replace image', () => openImages('replace')), field('Description (alt text)', bind(alt, () => s().alt))),
    );

    // Click to enlarge: a switch, and the animation it opens with.
    let lastZoom = selection.zoom || 'grow';
    const zoomOn = h('input', { type: 'checkbox', onchange: () => stage.setZoom(zoomOn.checked ? lastZoom : '') });
    const zoomField = selectField(
      'Opens with',
      ZOOMS,
      () => s().zoom || lastZoom,
      (name) => {
        lastZoom = name;
        stage.setZoom(name);
      },
    );
    bindings.push(() => {
      if (s().zoom) lastZoom = s().zoom;
      zoomField.hidden = !s().zoom;
    });
    panels.push(
      group(
        'Click to enlarge',
        h('label', { class: 'check' }, bind(zoomOn, () => !!s().zoom, 'checked'), 'Enlarge this image when clicked'),
        zoomField,
        h('p', {}, 'Works in the deck, not here. Click the image there to open it, click again or press Esc to close.'),
      ),
    );
  }

  if (selection.shape) {
    panels.push(group('Fill', swatches('Colour', FILLS, () => s().style.background, (c) => stage.setStyle('background', c))));
  }

  if (selection.code) panels.push(codePanel());

  if (!selection.image && !selection.shape && !selection.code) {
    const aligns = ['left', 'center', 'right'].map((value) => {
      const b = button(value[0].toUpperCase() + value.slice(1), () => stage.setStyle('text-align', value));
      bindings.push(() => b.classList.toggle('is-on', s().style.textAlign === value));
      return b;
    });
    panels.push(
      group(
        'Text',
        h(
          'div',
          { class: 'row' },
          numberField('Size (px)', () => s().style.fontSize, (v) => stage.setStyle('font-size', `${v}px`), { min: 8, max: 600 }),
          selectField(
            'Weight',
            WEIGHTS,
            () => (WEIGHTS.some(([w]) => w === s().style.fontWeight) ? s().style.fontWeight : '400'),
            (v) => stage.setStyle('font-weight', v),
          ),
        ),
        fontField(),
        h('div', { class: 'field' }, 'Align', h('div', { class: 'row' }, aligns)),
        swatches('Colour', TEXT_COLORS, () => s().style.color, (c) => stage.setStyle('color', c)),
        h('p', {}, 'While typing: ', h('kbd', {}, 'Ctrl+B'), ' bold, ', h('kbd', {}, 'Ctrl+I'), ' serif italic, ', h('kbd', {}, 'Shift+Enter'), ' new line.'),
      ),
    );
  }

  const anim = (patch) => stage.setAnim({ ...s().anim, ...patch });
  const stagger = h('input', { type: 'checkbox', onchange: () => anim({ stagger: stagger.checked }) });
  panels.push(
    group(
      'Animation',
      h(
        'div',
        { class: 'row' },
        selectField('Preset', PRESETS.map((p) => [p, p || 'None']), () => s().anim.preset, (preset) => anim({ preset })),
        numberField('Delay (ms)', () => parseFloat(s().anim.delay) || 0, (ms) => anim({ delay: ms ? `${ms}ms` : '' }), { min: 0, step: 20 }),
      ),
      h('label', { class: 'check' }, bind(stagger, () => s().anim.stagger, 'checked'), 'Stagger: animate its children one by one'),
      h('p', {}, 'Animations play in the deck, not here. Press Present to see them.'),
    ),
  );

  const morphName = h('input', { type: 'text', spellcheck: false, placeholder: 'none', oninput: () => stage.setMorphName(morphName.value) });
  panels.push(
    group(
      'Morph',
      field('Object name', bind(morphName, () => s().morphName)),
      h('p', {}, 'On a slide with the Morph transition, an object moves into place from the object with the same name on the slide before. Duplicated slides get matching names by themselves. Type the same name on two different objects to morph one into the other.'),
    ),
  );

  panels.push(
    group(
      null,
      h('div', { class: 'row' }, button('Duplicate', () => stage.duplicate(), { title: 'Ctrl+D' }), button('Delete', () => stage.remove(), { title: 'Delete' })),
    ),
  );
  return panels;
}

function fontField() {
  const select = h('select', { onchange: () => applyFont(select.value) }, fontOptions());
  return field('Font', bind(select, () => currentFont(selection)));
}

// Editing a code block: the code itself is typed here, not on the slide,
// because the slide shows the highlighted version.
function codePanel() {
  const s = () => selection.code || {};
  let timer = 0;
  const area = h('textarea', { class: 'code-area', spellcheck: false, wrap: 'off' });
  area.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => stage.setCode({ text: area.value }), 200);
  });
  area.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    event.preventDefault(); // Tab indents instead of leaving the field
    area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end');
    area.dispatchEvent(new Event('input'));
  });
  const numbers = h('input', { type: 'checkbox', onchange: () => stage.setCode({ lineNumbers: numbers.checked }) });
  return group(
    'Code',
    field('Type or paste your code', bind(area, () => s().text)),
    h(
      'div',
      { class: 'row' },
      selectField('Language', LANGUAGES, () => s().language, (language) => stage.setCode({ language })),
      numberField('Text size (px)', () => selection.style.fontSize, (v) => stage.setStyle('font-size', v + 'px'), { min: 10, max: 80 }),
    ),
    h('label', { class: 'check' }, bind(numbers, () => !!s().lineNumbers, 'checked'), 'Line numbers'),
  );
}

function slidePanels() {
  const s = () => slideInfo;
  const dim = h('input', { type: 'range', min: 0, max: 1, step: 0.02, oninput: () => stage.setSlide('data-bg-dim', dim.value) });
  const notes = h('textarea', { placeholder: 'What you want to say on this slide.', oninput: () => stage.setNotes(notes.value) });
  const morphHint = h('p', {}, 'Morph: everything that is also on the slide before glides to its new place, size and colour. The rest fades. Easiest way: duplicate a slide, change the copy, set Morph on the copy.');
  bindings.push(() => (morphHint.hidden = s().transition !== 'morph'));
  const bgImage = h('img', { class: 'preview-img', alt: '' });
  bindings.push(() => {
    bgImage.hidden = !s().image;
    if (s().image && bgImage.getAttribute('src') !== s().image) bgImage.src = s().image;
  });

  return [
    group(
      'Slide',
      h('h2', {}, slideInfo.layout ? `Layout: ${slideInfo.layout}` : 'Slide'),
      h('p', {}, 'Nothing is selected. Click something on the slide, or add a text box, image or rectangle from the bar above.'),
    ),
    group(
      'Transition',
      selectField('When this slide appears', TRANSITIONS.map((v) => [v, v || 'Default']), () => s().transition, (v) => stage.setSlide('data-transition', v)),
      morphHint,
    ),
    group(
      'Background',
      field('Darkness of the animated background', bind(dim, () => (s().dim === '' ? '0.62' : String(s().dim)))),
      h('div', { class: 'row' }, button('Use deck default', () => stage.setSlide('data-bg-dim', ''))),
      bgImage,
      h(
        'div',
        { class: 'row' },
        button('Full-screen image', () => openImages('background')),
        button('Remove image', () => stage.setSlide('data-background-image', '')),
      ),
    ),
    group('Speaker notes', bind(notes, () => s().notes)),
  ];
}

function codeOnlyPanels() {
  const md = isMarkdown(state.current || '');
  return [
    group(
      'Code only',
      h('h2', {}, md ? 'Markdown slide' : 'Edited as code'),
      h(
        'p',
        {},
        md
          ? 'Markdown slides are edited as text. Convert it to an HTML slide to place text boxes and images by hand.'
          : 'This file is not a single <section>, so it cannot be edited on the slide. Fix it in the Code tab.',
      ),
      h('div', { class: 'row' }, button('Open Code tab', () => setTab('code')), md && button('Convert to HTML', convertMarkdown)),
    ),
  ];
}

function renderInspector(rebuild) {
  if (rebuild) {
    bindings = [];
    const panels = !state.current ? [] : !state.visual ? codeOnlyPanels() : selection ? elementPanels() : slideInfo ? slidePanels() : [];
    inspector.replaceChildren(...panels);
  }
  if (selection || slideInfo) bindings.forEach((refresh) => refresh());
  updateRibbon();
}

// ---- Images ---------------------------------------------------------------

let imageMode = 'insert'; // insert | replace | background

async function upload(file) {
  const res = await fetch(`/api/assets?name=${enc(file.name)}`, {
    method: 'POST',
    headers: { 'X-Fogya-Upload': '1', 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
  return data.url;
}

function useImage(url) {
  $('image-panel').hidden = true;
  if (imageMode === 'replace') stage.setImage(url);
  else if (imageMode === 'background') {
    stage.setSlide('data-background-image', url);
    stage.setSlide('data-background-size', 'cover');
  } else stage.insert('image', { src: url });
}

async function openImages(mode) {
  imageMode = mode;
  $('image-panel-title').textContent = { insert: 'Add image', replace: 'Replace image', background: 'Full-screen image' }[mode];
  $('image-panel').hidden = false;
  await guard(async () => {
    const res = await fetch('/api/assets');
    const { assets } = await res.json();
    $('image-grid').replaceChildren(
      ...assets.map((name) =>
        h(
          'button',
          { type: 'button', class: 'thumb', title: name, onclick: () => useImage(`/assets/${name}`) },
          h('img', { src: `/assets/${name}`, alt: '', loading: 'lazy' }),
          h('span', {}, name),
        ),
      ),
    );
  });
}

$('add-image').addEventListener('click', () => ($('image-panel').hidden ? openImages('insert') : ($('image-panel').hidden = true)));
$('image-close').addEventListener('click', () => ($('image-panel').hidden = true));
$('image-upload').addEventListener('click', () => $('image-file').click());
$('image-file').addEventListener('change', (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) guard(async () => useImage(await upload(file)));
});

// ---- Copy, cut, paste ------------------------------------------------------
// The clipboard lives here, outside the slide, so you can copy on one slide,
// open another and paste. It also survives a reload of the editor.

let clipboard = null;
try {
  clipboard = JSON.parse(sessionStorage.getItem('fogya-clipboard') || 'null');
} catch {
  clipboard = null;
}

function copySelection({ cut = false } = {}) {
  const clip = stage?.copy();
  if (!clip) return;
  clipboard = clip;
  try {
    sessionStorage.setItem('fogya-clipboard', JSON.stringify(clip));
  } catch {
    /* too large to keep across a reload: still works until then */
  }
  if (cut) stage.remove();
  updateRibbon();
  setStatus(cut ? 'Cut' : 'Copied');
}

function pasteClipboard() {
  if (!clipboard || !state.visual) return;
  stage?.paste(clipboard);
}

$('copy').addEventListener('click', () => copySelection());
$('paste').addEventListener('click', pasteClipboard);

// Snapping: remembered between visits.
let snapOn = localStorage.getItem('fogya-snap') !== 'off';

function applySnap() {
  $('snap').textContent = snapOn ? 'Snap on' : 'Snap off';
  $('snap').classList.toggle('is-on', snapOn);
  $('snap').setAttribute('aria-pressed', String(snapOn));
  stage?.setSnap(snapOn);
}

$('snap').addEventListener('click', () => {
  snapOn = !snapOn;
  localStorage.setItem('fogya-snap', snapOn ? 'on' : 'off');
  applySnap();
});
applySnap();

$('add-text').addEventListener('click', () => stage?.insert('text'));
$('add-heading').addEventListener('click', () => stage?.insert('heading'));
$('add-rect').addEventListener('click', () => stage?.insert('rect'));
$('add-code').addEventListener('click', () => stage?.insert('code'));
$('del').addEventListener('click', () => stage?.remove());
$('front').addEventListener('click', () => stage?.order('front'));
$('back').addEventListener('click', () => stage?.order('back'));

// ---- Ribbon controls that mirror the selection ------------------------------

$('r-font').append(...fontOptions());
$('r-font').addEventListener('change', () => applyFont($('r-font').value));
$('r-size').addEventListener('input', () => {
  const v = $('r-size').valueAsNumber;
  if (Number.isFinite(v) && v >= 8) stage?.setStyle('font-size', v + 'px');
});
$('r-transition').append(...TRANSITIONS.map((v) => h('option', { value: v }, v || 'Default')));
$('r-transition').addEventListener('change', () => stage?.setSlide('data-transition', $('r-transition').value));
['left', 'center', 'right'].forEach((value) => $('r-' + value).addEventListener('click', () => stage?.setStyle('text-align', value)));

function updateRibbon() {
  const sel = state.visual ? selection : null;
  const textual = !!sel && !sel.image && !sel.shape && !sel.code;
  $('copy').disabled = $('del').disabled = !sel;
  $('paste').disabled = !state.visual || !clipboard;
  $('front').disabled = $('back').disabled = !sel?.box;
  for (const id of ['r-font', 'r-size', 'r-left', 'r-center', 'r-right']) $(id).disabled = !textual;
  $('r-transition').disabled = !state.visual || !slideInfo;
  const set = (el, value) => {
    if (document.activeElement !== el && el.value !== value) el.value = value;
  };
  set($('r-font'), textual ? currentFont(sel) : '');
  set($('r-size'), textual ? String(sel.style.fontSize) : '');
  set($('r-transition'), slideInfo?.transition || '');
  for (const value of ['left', 'center', 'right']) $('r-' + value).classList.toggle('is-on', textual && sel.style.textAlign === value);
}
$('undo').addEventListener('click', () => stage?.undo());
$('redo').addEventListener('click', () => stage?.redo());

// Shortcuts also work when the focus is on the editor around the slide.
document.addEventListener('keydown', (event) => {
  if (!stage) return;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (event.key === 'Escape' && !$('image-panel').hidden) return ($('image-panel').hidden = true);
  if (mod && key === 's') {
    event.preventDefault();
    return save();
  }
  if (event.target.closest('input, textarea, select, .cm-editor')) return;
  if (mod && key === 'z') {
    event.preventDefault();
    event.shiftKey ? stage.redo() : stage.undo();
  } else if (mod && key === 'y') {
    event.preventDefault();
    stage.redo();
  } else if (mod && key === 'c' && selection && !String(window.getSelection())) {
    event.preventDefault();
    copySelection();
  } else if (mod && key === 'x' && selection && !String(window.getSelection())) {
    event.preventDefault();
    copySelection({ cut: true });
  } else if (mod && key === 'v' && clipboard) {
    event.preventDefault();
    pasteClipboard();
  } else if (mod && key === 'd' && selection) {
    event.preventDefault();
    stage.duplicate();
  } else if (event.key === 'Delete' && selection) {
    stage.remove();
  }
});

// ---- Slides: select, list, add, duplicate, delete, reorder ----------------

async function select(file, { reload = false } = {}) {
  if (file === state.current && !reload) return;
  await flushSave();
  if (!file) {
    state.current = null;
    state.text = '';
    $('current-file').textContent = '';
    renderList();
    renderInspector(true);
    return;
  }
  await guard(async () => {
    const text = (await api('GET', `/${enc(file)}`)).content;
    state.current = file;
    state.text = text;
    selection = null;
    slideInfo = null;
    $('current-file').textContent = `slides/${file}`;
    $('present').href = `/#/${state.files.indexOf(file)}`;
    renderList();
    showCode(text);
    setStatus('Saved');
    if (stage) setVisual(stage.open(file, text).visual);
    renderInspector(true);
    // Markdown opens as code. Coming back to a normal slide returns to Design,
    // unless you chose the Code tab yourself.
    if (isMarkdown(file)) {
      if (state.tab !== 'code') autoCode = true;
      setTab('code');
    } else if (autoCode) {
      autoCode = false;
      setTab('design');
    }
  });
}

function tool(label, title, onClick, disabled = false) {
  return h('button', {
    type: 'button',
    class: 'tool',
    textContent: label,
    title,
    'aria-label': title,
    disabled,
    onclick: (e) => {
      e.stopPropagation();
      onClick();
    },
  });
}

function renderList() {
  $('count').textContent = `(${state.files.length})`;
  listEl.replaceChildren(
    ...state.files.map((file, index) => {
      const row = h(
        'li',
        { class: `slide-row${file === state.current ? ' is-active' : ''}`, tabIndex: 0, draggable: true, title: file },
        h('span', { class: 'slide-num' }, String(index + 1).padStart(2, '0')),
        h('span', { class: 'slide-name' }, file.replace(/^\d+[-_]?/, '').replace(/\.html$/i, '')),
        h(
          'span',
          { class: 'slide-tools' },
          tool('↑', 'Move up', () => move(index, index - 1), index === 0),
          tool('↓', 'Move down', () => move(index, index + 1), index === state.files.length - 1),
          tool('D', 'Duplicate slide', () => duplicate(file)),
          tool('X', 'Delete slide', () => remove(file)),
        ),
      );
      row.dataset.file = file;
      row.addEventListener('click', () => select(file));
      row.addEventListener('keydown', (e) => {
        if (e.target === row && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          select(file);
        }
      });
      return row;
    }),
  );
}

// After the server renames files (numbers change), re-open ours under its new name.
async function reopen(file) {
  state.current = null;
  await select(file);
}

async function move(from, to) {
  if (to < 0 || to >= state.files.length || from === to) return;
  await flushSave();
  const order = [...state.files];
  order.splice(to, 0, order.splice(from, 1)[0]);
  await guard(async () => {
    const result = await api('POST', '/_reorder', { order });
    const current = result.renamed[state.current] || state.current;
    state.files = result.slides;
    await reopen(current);
  });
}

async function duplicate(file) {
  // Name the slide's objects first, so Morph can follow them into the copy.
  if (file !== state.current) await select(file);
  if (state.visual) stage?.ensureMorphIds();
  await flushSave();
  await guard(async () => {
    const created = await api('POST', `/${enc(file)}/duplicate`, {});
    state.files = (await api('GET')).slides;
    await reopen(created.file);
  });
}

async function remove(file) {
  if (!window.confirm(`Delete ${file}?\nIt is moved to slides/.trash, not erased.`)) return;
  await flushSave();
  await guard(async () => {
    const before = [...state.files];
    const index = before.indexOf(file);
    await api('DELETE', `/${enc(file)}`, {});
    state.files = (await api('GET')).slides;
    // Files after the deleted one were renumbered: find ours by position.
    const survivors = before.filter((f) => f !== file);
    const next = state.current === file ? Math.min(index, state.files.length - 1) : survivors.indexOf(state.current);
    await reopen(state.files[next] || null);
  });
}

$('new-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('new-name');
  guard(async () => {
    await flushSave();
    const created = await api('POST', '', { name: input.value.trim() || 'slide', ext: 'html', after: state.current });
    input.value = '';
    state.files = (await api('GET')).slides;
    await reopen(created.file);
  });
});

async function convertMarkdown() {
  const file = state.current;
  if (!file || !isMarkdown(file)) return;
  await flushSave();
  await guard(async () => {
    const name = file.replace(/^\d+[-_]?/, '').replace(/\.md$/i, '');
    const content = `${toSectionHtml(file, state.text)}\n`;
    const created = await api('POST', '', { name, ext: 'html', after: file, content });
    await api('DELETE', `/${enc(file)}`, {});
    state.files = (await api('GET')).slides;
    const at = state.files.findIndex((f) => f.replace(/^\d+[-_]?/, '') === created.file.replace(/^\d+[-_]?/, ''));
    setTab('design');
    await reopen(state.files[at]);
  });
}

// ---- Drag to reorder ------------------------------------------------------

let dragFrom = -1;

const rowAt = (event) => event.target.closest?.('.slide-row');
const clearDrop = () =>
  listEl.querySelectorAll('.is-drop-before, .is-drop-after').forEach((el) => el.classList.remove('is-drop-before', 'is-drop-after'));

listEl.addEventListener('dragstart', (event) => {
  const row = rowAt(event);
  if (!row) return;
  dragFrom = state.files.indexOf(row.dataset.file);
  row.classList.add('is-dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', row.dataset.file);
});

listEl.addEventListener('dragover', (event) => {
  const row = rowAt(event);
  if (!row || dragFrom === -1) return;
  event.preventDefault();
  clearDrop();
  const box = row.getBoundingClientRect();
  row.classList.add(event.clientY < box.top + box.height / 2 ? 'is-drop-before' : 'is-drop-after');
});

listEl.addEventListener('drop', (event) => {
  const row = rowAt(event);
  if (!row || dragFrom === -1) return;
  event.preventDefault();
  const box = row.getBoundingClientRect();
  let to = state.files.indexOf(row.dataset.file) + (event.clientY < box.top + box.height / 2 ? 0 : 1);
  if (to > dragFrom) to -= 1;
  const from = dragFrom;
  dragFrom = -1;
  clearDrop();
  move(from, to);
});

listEl.addEventListener('dragend', () => {
  dragFrom = -1;
  clearDrop();
  listEl.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
});

// ---- Start ----------------------------------------------------------------

window.addEventListener('beforeunload', (event) => {
  if (saveTimer) {
    save();
    event.preventDefault();
  }
});

// Slides added, removed or renamed outside the editor (for example in VS Code).
if (import.meta.hot) {
  import.meta.hot.on('slides:files', ({ slides }) => {
    const same = slides.length === state.files.length && slides.every((f, i) => f === state.files[i]);
    if (same) return;
    state.files = slides;
    renderList();
  });
}

setVisual(false);
guard(async () => {
  state.files = (await api('GET')).slides;
  renderList();
  const wanted = new URLSearchParams(location.search).get('file');
  await select(state.files.includes(wanted) ? wanted : state.files[0] || null);
  // The frame may have finished loading before this script did.
  if (!stage && frame.contentWindow.fogyaStage) attachStage();
});
