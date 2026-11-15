// The fonts offered in the editor's Font menu.
//
// To add one: install it (npm install @fontsource/<name>), import its CSS in
// src/styles/fonts.css, and add a line here.
//
//   key     saved nowhere, only used by the menu
//   label   what the menu shows
//   family  the CSS font-family written onto the element
//   style   optional font-style
//   weight  optional font-weight that belongs to this entry

const sans = 'system-ui, sans-serif';
const serif = 'Georgia, serif';
const mono = 'ui-monospace, Consolas, monospace';

export const FONTS = [
  // fogya.tech brand fonts
  { key: 'figtree', label: 'Figtree (fogya.tech)', family: 'var(--font-sans)', match: 'Figtree' },
  { key: 'instrument', label: 'Instrument Serif', family: 'var(--font-serif)', match: 'Instrument Serif', style: 'normal' },
  { key: 'instrument-italic', label: 'Instrument Serif Italic', family: 'var(--font-serif)', match: 'Instrument Serif', style: 'italic' },
  { key: 'geist-mono', label: 'Geist Mono', family: 'var(--font-mono)', match: 'Geist Mono' },

  // Montserrat SemiBold is its own entry: it sets the weight to 600 for you.
  { key: 'montserrat-semibold', label: 'Montserrat SemiBold', family: `'Montserrat Variable', ${sans}`, match: 'Montserrat Variable', weight: '600' },
  { key: 'montserrat', label: 'Montserrat', family: `'Montserrat Variable', ${sans}`, match: 'Montserrat Variable' },

  { key: 'roboto', label: 'Roboto', family: `'Roboto Variable', ${sans}`, match: 'Roboto Variable' },
  { key: 'open-sans', label: 'Open Sans', family: `'Open Sans Variable', ${sans}`, match: 'Open Sans Variable' },
  { key: 'lato', label: 'Lato', family: `'Lato', ${sans}`, match: 'Lato' },
  { key: 'poppins', label: 'Poppins', family: `'Poppins', ${sans}`, match: 'Poppins' },
  { key: 'raleway', label: 'Raleway', family: `'Raleway Variable', ${sans}`, match: 'Raleway Variable' },
  { key: 'nunito', label: 'Nunito', family: `'Nunito Variable', ${sans}`, match: 'Nunito Variable' },
  { key: 'source-sans', label: 'Source Sans 3', family: `'Source Sans 3 Variable', ${sans}`, match: 'Source Sans 3 Variable' },
  { key: 'oswald', label: 'Oswald', family: `'Oswald Variable', ${sans}`, match: 'Oswald Variable' },
  { key: 'bebas', label: 'Bebas Neue', family: `'Bebas Neue', ${sans}`, match: 'Bebas Neue' },
  { key: 'playfair', label: 'Playfair Display', family: `'Playfair Display Variable', ${serif}`, match: 'Playfair Display Variable' },
  { key: 'merriweather', label: 'Merriweather', family: `'Merriweather', ${serif}`, match: 'Merriweather' },
  { key: 'roboto-mono', label: 'Roboto Mono', family: `'Roboto Mono Variable', ${mono}`, match: 'Roboto Mono Variable' },
  { key: 'jetbrains-mono', label: 'JetBrains Mono', family: `'JetBrains Mono Variable', ${mono}`, match: 'JetBrains Mono Variable' },
];

/** Which menu entry describes an element with these computed styles. */
export function fontKeyFor({ family, style, weight }) {
  const first = family.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  const candidates = FONTS.filter((f) => f.match === first);
  if (!candidates.length) return '';
  return (
    candidates.find((f) => f.weight && f.weight === String(weight))?.key ||
    candidates.find((f) => f.style && f.style === style)?.key ||
    candidates.find((f) => !f.weight && !f.style)?.key ||
    candidates[0].key
  );
}

/** The CSS properties to write when a menu entry is chosen. */
export function fontStyles(key) {
  const font = FONTS.find((f) => f.key === key);
  if (!font) return {};
  return {
    'font-family': font.family,
    'font-style': font.style || (font.match === 'Instrument Serif' ? 'normal' : ''),
    ...(font.weight ? { 'font-weight': font.weight } : {}),
  };
}
