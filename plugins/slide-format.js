// Turns the source of one slide file into the HTML of one <section>.
// Shared by the Vite plugin (Node) and the live preview (browser).
import { marked } from 'marked';

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export function isMarkdown(file) {
  return /\.md$/i.test(file);
}

export function toSectionHtml(file, source) {
  if (!isMarkdown(file)) {
    const html = source.trim();
    // A slide file normally holds its own <section>. Loose content is wrapped.
    return /^(<!--[\s\S]*?-->\s*)*<section[\s>]/i.test(html) ? html : `<section>\n${html}\n</section>`;
  }

  let md = source;
  let attrs = 'data-layout="markdown"';

  // <!-- .slide: data-transition="fade" data-bg-dim="0.5" -->
  md = md.replace(/<!--\s*\.slide:\s*([\s\S]*?)\s*-->/, (_, a) => {
    attrs = /data-layout=/.test(a) ? a : `${attrs} ${a}`;
    return '';
  });

  // Everything after a line starting with "Note:" becomes speaker notes.
  let notes = '';
  const noteAt = md.search(/^Notes?:/im);
  if (noteAt !== -1) {
    notes = md.slice(noteAt).replace(/^Notes?:/i, '').trim();
    md = md.slice(0, noteAt);
  }

  const body = marked.parse(md.trim());
  const aside = notes ? `\n<aside class="notes">${marked.parse(notes)}</aside>` : '';
  return `<section ${attrs}>\n<div class="md">\n${body}</div>${aside}\n</section>`;
}

export function toSlide(file, source) {
  return { file, html: toSectionHtml(file, source), fileAttr: escapeAttr(file) };
}
