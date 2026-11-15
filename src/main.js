import Reveal from 'reveal.js';
import Notes from 'reveal.js/plugin/notes';
import Highlight from 'reveal.js/plugin/highlight';

import 'reveal.js/reset.css';
import 'reveal.js/reveal.css';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layouts.css';
import './styles/code-theme.css';
import './styles/animations.css';

import slides from 'virtual:slides';
import { createBackground } from './background/background.js';
import backgroundConfig from './background/config.js';
import { morphConfig, prepareMorph, wireMorph } from './morph.js';
import { prepareZoom, wireZoom } from './zoom.js';

const params = new URLSearchParams(location.search);
const isExport = params.has('export'); // used by `npm run pdf`
const isEdit = params.has('edit'); // the stage inside /editor
if (isExport || isEdit) document.documentElement.classList.add('no-motion');
if (isExport || params.has('notags')) document.documentElement.classList.add('hide-tags');

const slidesEl = document.querySelector('.reveal .slides');

// --- Build the slides from the files in /slides ----------------------------

function sectionsFor(file, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const sections = [...tpl.content.children].filter((el) => el.tagName === 'SECTION');
  sections.forEach((s) => s.setAttribute('data-file', file));
  return sections;
}

function renderSlides(list) {
  slidesEl.replaceChildren(...list.flatMap((s) => sectionsFor(s.file, s.html)));
  prepareMorph(slidesEl);
  if (!isEdit) prepareZoom(slidesEl);
}

renderSlides(slides);

// --- reveal.js -------------------------------------------------------------

const css = getComputedStyle(document.documentElement);
const defaultTransition = css.getPropertyValue('--slide-transition').trim() || 'fade';

const deck = new Reveal(document.querySelector('.reveal'), {
  // Fixed 16:9 stage. reveal.js scales it to the window.
  width: 1920,
  height: 1080,
  margin: 0,
  minScale: 0.05,
  maxScale: 4,
  center: false,
  display: 'grid',

  hash: true,
  controls: false,
  progress: true,
  slideNumber: 'c/t',
  navigationMode: 'linear', // clicker next/previous walks every slide
  transition: defaultTransition, // set in src/styles/animations.css
  backgroundTransition: 'fade',
  hideCursorTime: 2500,
  pdfSeparateFragments: false,

  // Morph (data-transition="morph"), see src/morph.js. Off while editing and
  // for people who asked their system for less motion.
  ...morphConfig({ enabled: !isEdit && !isExport && !window.matchMedia('(prefers-reduced-motion: reduce)').matches }),

  // While editing, keys and clicks belong to the editor, not to navigation.
  ...(isEdit && { keyboard: false, touch: false, overview: false, hideInactiveCursor: false }),

  plugins: [Notes, Highlight],
});

// --- Background: frozen on a slide, moves only on a slide change ------------

const background = createBackground(document.getElementById('bg'), backgroundConfig);

function applySlideState(slide = deck.getCurrentSlide(), { immediate = false } = {}) {
  if (!slide) return;
  document.body.dataset.layout = slide.dataset.layout || '';

  // Forward raises the slide number, back lowers it; the background follows.
  background.setSlide(deck.getSlidePastCount(slide), { immediate: immediate || isExport });

  // Flat black scrim over the background: config default or data-bg-dim.
  const dim = slide.dataset.bgDim ?? backgroundConfig.dim;
  document.documentElement.style.setProperty('--bg-dim', dim);
}

function highlightCode(root = slidesEl) {
  const plugin = deck.getPlugin('highlight');
  root.querySelectorAll('pre code:not(.hljs)').forEach((block) => {
    // The plugin only trims on first load, so hot swapped slides are trimmed here.
    if (block.hasAttribute('data-trim')) block.innerHTML = block.innerHTML.trim();
    plugin.highlightBlock(block);
  });
}

deck.on('slidechanged', (e) => applySlideState(e.currentSlide));
wireMorph(deck);
if (!isEdit && !isExport) wireZoom(deck, slidesEl); // click an image to enlarge it

// --- Swap slides in place (hot reload, editor) -----------------------------

function refresh() {
  const { h, v, f } = deck.getIndices();
  prepareMorph(slidesEl);
  if (!isEdit) prepareZoom(slidesEl);
  deck.sync();
  highlightCode();
  const last = deck.getHorizontalSlides().length - 1;
  deck.slide(Math.max(0, Math.min(h, last)), v, f);
  applySlideState();
}

function gotoFile(file) {
  const target = slidesEl.querySelector(`:scope > section[data-file="${CSS.escape(file)}"]`);
  if (target) deck.slide(deck.getIndices(target).h);
}

let stage = null; // the editing layer, only inside /editor

deck.initialize().then(async () => {
  applySlideState(undefined, { immediate: true });
  // T toggles the layout tags in the corner.
  deck.addKeyBinding({ keyCode: 84, key: 'T', description: 'Toggle layout tags' }, () =>
    document.documentElement.classList.toggle('hide-tags'),
  );

  if (isEdit) {
    const { initStage } = await import('./editor/stage.js');
    stage = initStage({ deck, slidesEl, sectionsFor, refresh, gotoFile, applySlideState });
    window.fogyaStage = stage;
    window.parent?.postMessage({ type: 'fogya:ready' }, location.origin);
  }
});

if (import.meta.hot) {
  import.meta.hot.accept('virtual:slides', (mod) => {
    if (!mod) return;
    // The editor keeps the slide being edited as it is and swaps the rest.
    if (stage) return stage.onDisk(mod.default);
    renderSlides(mod.default);
    refresh();
  });
}

// Handy in the console: deck.next(), background.state
window.deck = deck;
window.background = background;
if (isExport) window.Reveal = deck; // decktape (npm run pdf) looks for this name
