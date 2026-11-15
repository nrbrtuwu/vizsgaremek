// Morph: the PowerPoint transition, built on reveal.js auto-animate.
//
// The rules are the same as in PowerPoint:
//   - Morph is a transition you set on the SECOND slide: data-transition="morph".
//   - An object that exists on both slides glides from where it was to where
//     it is now, changing size, colour and font size on the way.
//   - Objects are the same object when the second slide was made by
//     duplicating the first (the editor gives every object a data-id that the
//     copy keeps). Without ids, equal text and equal image files are matched.
//   - To morph two different objects into each other, give both the same
//     name: data-id="name" (PowerPoint's !!name).
//   - Whatever has no partner fades: out on the old slide, in on the new one.
//   - Going back plays the same morph in reverse.

const INLINE = new Set(['EM', 'STRONG', 'B', 'I', 'U', 'SPAN', 'CODE', 'BR', 'A', 'SMALL', 'SUB', 'SUP', 'MARK']);

/**
 * reveal.js only auto-animates between two slides that both carry
 * data-auto-animate. This marks each morph slide and the slide before it,
 * and tells reveal where a morph chain starts, so nothing else morphs.
 */
export function prepareMorph(slidesEl) {
  const slides = [...slidesEl.querySelectorAll(':scope > section')];
  slides.forEach((slide, i) => {
    if (slide.dataset.morphAuto) {
      slide.removeAttribute('data-auto-animate');
      slide.removeAttribute('data-auto-animate-restart');
      delete slide.dataset.morphAuto;
    }
    const isMorph = slide.dataset.transition === 'morph';
    const nextIsMorph = slides[i + 1]?.dataset.transition === 'morph';
    if ((isMorph || nextIsMorph) && !slide.hasAttribute('data-auto-animate')) {
      slide.setAttribute('data-auto-animate', '');
      // Not a morph slide itself: do not morph into it from the slide before.
      if (!isMorph) slide.setAttribute('data-auto-animate-restart', '');
      slide.dataset.morphAuto = '1';
    }
  });
}

// Position and size as drawn, relative to the element's own slide. Unlike
// reveal's default this includes elements nudged with `translate`.
function measure(element) {
  const slide = element.closest('.slides > section') || element.parentElement;
  const s = slide.getBoundingClientRect();
  const r = element.getBoundingClientRect();
  return { x: r.left - s.left, y: r.top - s.top, width: r.width, height: r.height };
}

const isText = (el) =>
  !['IMG', 'FIGURE', 'PRE', 'TABLE', 'HR'].includes(el.tagName) &&
  !el.classList.contains('shape') &&
  el.textContent.trim() !== '' &&
  [...el.children].every((child) => INLINE.has(child.tagName));

/** Options for `new Reveal({...})`. */
export function morphConfig({ enabled }) {
  const css = getComputedStyle(document.documentElement);
  const seconds = (name, fallback) => {
    const value = css.getPropertyValue(name).trim();
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return fallback;
    return value.endsWith('ms') ? n / 1000 : n;
  };

  return {
    autoAnimate: enabled,
    autoAnimateUnmatched: true,
    autoAnimateDuration: seconds('--morph-duration', 0.9),
    autoAnimateEasing: css.getPropertyValue('--morph-ease').trim() || 'ease',

    // reveal's own pairing (data-id, then equal text, then equal image),
    // adjusted so every kind of element in this deck morphs cleanly.
    autoAnimateMatcher(fromSlide, toSlide) {
      const textStyles = [...this.Reveal.getConfig().autoAnimateStyles, 'width'];
      const pairs = this.getAutoAnimatePairs(fromSlide, toSlide);
      const targets = new Set(pairs.map((pair) => pair.to));

      return pairs
        .filter((pair) => {
          // Lines inside a code block are handled by reveal itself.
          if (pair.options?.measure) return true;
          // An object inside another matched object moves with its parent.
          for (let p = pair.to.parentElement; p && p !== toSlide; p = p.parentElement) {
            if (targets.has(p) && p.tagName !== 'PRE') return false;
          }
          return true;
        })
        .map((pair) => {
          if (pair.options?.measure) return pair;
          const options = { ...pair.options, measure };
          // Text is moved and re-flowed, never stretched like a picture.
          if (isText(pair.to) && pair.to.tagName !== 'PRE') {
            options.scale = false;
            options.styles = textStyles;
          }
          return { ...pair, options };
        });
    },
  };
}

/** Fades out what is left of the old slide while the morph runs. */
export function wireMorph(deck) {
  let leaving = null;
  let timer = 0;
  const clear = () => {
    clearTimeout(timer);
    leaving?.classList.remove('morph-leaving');
    leaving = null;
  };
  deck.on('slidechanged', clear); // fires before reveal starts the next morph
  deck.on('autoanimate', ({ fromSlide }) => {
    clear();
    leaving = fromSlide;
    fromSlide.classList.add('morph-leaving');
    timer = setTimeout(clear, 1500);
  });
}
