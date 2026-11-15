# fogya.tech presentation deck

A local browser presentation for the Vizsgaremek. reveal.js + Vite, no CDN, works offline.

## Run

```bash
npm install
```

```bash
npm run dev
```

- Deck: http://127.0.0.1:5173/
- Editor: http://127.0.0.1:5173/editor

`npm install` needs internet once. After that nothing does. Do it at home, not in the exam room.

### Keys

| Key | Action |
| --- | --- |
| Right, Space, PageDown | Next slide (a clicker sends PageDown / PageUp) |
| Left, PageUp | Previous slide |
| F | Fullscreen |
| S | Speaker view with notes and timer |
| Esc | Slide overview |
| B | Black screen |

## Add a slide

Every file in `slides/` is one slide. Files are shown in file name order, so the number at the front sets the position: `03-image-left.html` comes after `02-section.html`.

1. Copy the file with the layout you like. The file names say which layout is which (`06-two-columns.html`), and the editor shows the layout name on the right when nothing is selected.
2. Rename the copy, for example `07-results.html`.
3. Edit the text. Save. The open deck updates by itself and stays on the same slide.

Or use the editor, described next.

## The editor

Open http://127.0.0.1:5173/editor while `npm run dev` is running. It works like a slide program: the slide in the middle is the real slide, and you edit it directly. Every change is saved to the slide's file about half a second later.

| To do this | Do this |
| --- | --- |
| Select something | Click it |
| Change text | Double-click it and type. `Enter` or `Esc` finishes, `Shift+Enter` makes a new line |
| Bold / serif italic while typing | `Ctrl+B` / `Ctrl+I` |
| Move | Drag. Arrow keys move 1 px, with `Shift` 10 px. `Shift` while dragging keeps one direction |
| Resize | Drag a handle. Text that belongs to a layout has side handles for its width; free boxes resize freely (see below) |
| Snap while moving or resizing | **Snap on / off** in the top bar. Hold `Alt` to switch it off for one drag |
| Add a text box, heading, rectangle, code block | **Insert** group in the top bar |
| Add an image | **Image** in the top bar: pick one from `assets/` or upload from the computer. Or drop an image file onto the slide |
| Undo / redo | `Ctrl+Z` / `Ctrl+Y` |
| Copy / cut / paste, also to another slide | `Ctrl+C` / `Ctrl+X` / `Ctrl+V`, or **Copy** and **Paste** in the top bar |
| Duplicate / delete the selection | `Ctrl+D` / `Delete` |
| Select the group around an element | `Esc`, or **Select group** on the right |

**Top bar.** The tools are grouped like a ribbon, with the group name under each:

| Group | What is in it |
| --- | --- |
| Insert | Text, Heading, Image, Rectangle, Code |
| Text | Font, size and alignment of the selected text |
| Arrange | To front, To back, Snap |
| Edit | Undo, Redo, Copy, Paste, Delete |
| Transition | How the current slide appears |

Controls that do not apply to the selection are greyed out.

**Copy and paste.** Copy an element, open another slide in the list, paste. The copy is exact:

- It lands in the same place and size, as a free box. Pasting again puts the next copy a little lower right.
- It keeps every setting from the Design panel: font, size, weight, colour, alignment, animation preset and delay, click-to-enlarge, morph name, code language.
- It keeps the look its old slide gave it. If the new slide's layout would draw it differently, the original values are written onto the copy. This also covers everything inside a copied group.
- An element that was animated as part of a staggered group gets that preset and its own delay, so it still comes in at the same moment.

Two things cannot travel: decorations drawn by a layout itself (the square markers on the timeline, for example), and a morph name that is already used on the target slide. The clipboard is the editor's own: it is kept while the editor tab is open and does not go to other programs.

**Code blocks.** **Code** in the Insert group places a code block. Select it and type or paste your code into the **Code** box on the right; the slide shows it with syntax highlighting. Language, line numbers and text size are next to it. Drag its side handles to change the width.

**Fonts.** The Font menu has the three fogya.tech fonts and a set of well-known Google fonts, all bundled, so they work offline: Montserrat (with **Montserrat SemiBold** as its own entry), Roboto, Open Sans, Lato, Poppins, Raleway, Nunito, Source Sans 3, Oswald, Bebas Neue, Playfair Display, Merriweather, Roboto Mono, JetBrains Mono. To add another: `npm install @fontsource/<name>`, import its CSS in `src/styles/fonts.css`, add a line in `src/editor/fonts.js`.

**Design tab (right).** Shows the properties of what is selected: position and size, font, size, weight, alignment, colour, fill, animation preset and delay. With nothing selected it shows the slide's own settings: transition, darkness of the background, a full-screen image, and speaker notes.

**Free boxes and layout elements.** Things you add are free boxes: placed by X, Y and width on the 1920x1080 stage, with resize handles, and they can overlap (**To front** / **To back**). Things that came with a layout (the title of a two-column slide, for example) stay in their layout: dragging nudges them, and the side handles (or the Width field) make them narrower or wider, so the text wraps where you want. **Reset** gives back the layout's own position and width. Press **Free from layout** to turn one into a free box you can put and size anywhere.

**Snapping.** With Snap on, the edges and centre of what you drag stick to the slide's edges, centre and margins, and to the edges and centres of the other elements. A white line shows what it snapped to. The setting is remembered in the browser.

**Code tab (right).** The slide file as text, in sync with the slide in both directions. Use it for what the canvas cannot do, such as tables, code blocks and lists.

**Slide list (left).** Add a blank slide, duplicate (D), delete (X) and reorder (arrows, or drag a row). To start from one of the layouts, duplicate its slide. Reordering renames the number prefixes for you. Delete moves the file to `slides/.trash/`.

**Markdown slides** are edited in the Code tab. **Convert to HTML** on the Design tab turns one into a normal slide.

Uploaded images are saved in `assets/`. The editor only writes plain HTML: a free box looks like this in the file, and you can edit it by hand too.

```html
<p class="box" style="left: 240px; top: 240px; width: 640px">Text</p>
```

### HTML slide

```html
<section data-layout="two-columns" data-transition="wipe" data-bg-dim="0.7">
  <header>
    <p class="label">Eyebrow</p>
    <h2>Title</h2>
  </header>
  ...
  <aside class="notes">Speaker notes, only visible in the speaker view.</aside>
</section>
```

| Attribute on `<section>` | What it does |
| --- | --- |
| `data-layout` | Picks the layout CSS |
| `data-transition` | Transition for this slide only (see below) |
| `data-bg-dim` | How dark the scrim over the background is on this slide, 0 to 1 |
| `data-background-image` | Full screen image behind the slide (see `05-full-bleed.html`) |

### Markdown slide

A `.md` file works too, see `16-markdown.md`. Slide attributes go in a comment on top, notes after `Note:`.

```md
<!-- .slide: data-transition="drift" -->

## Title

Text with *emphasis*.

Note: Speaker notes.
```

### Images

Put images in `assets/` and reference them as `/assets/name.svg`. The placeholders there are plain SVG files; replace them with your own.

## Change animations

Everything is in one file: `src/styles/animations.css`.

### Timing

The variables at the top of that file control all of it:

```css
--slide-transition: rise;     /* default transition for every slide */
--slide-in-duration: 760ms;
--anim-duration: 820ms;       /* element animations */
--anim-stagger: 110ms;        /* delay between children in a stagger */
--anim-distance: 44px;
```

### Slide transitions

Default for all slides: `--slide-transition`. One slide can override it:

```html
<section data-transition="wipe">
```

Names: `rise`, `drift`, `wipe`, `cut`, `morph` (defined in `animations.css`, morph is explained below) and `none`, `fade`, `slide`, `convex`, `concave`, `zoom` (built into reveal.js).

### Morph

Morph works like the PowerPoint transition of the same name.

1. Make the first slide.
2. Duplicate it (D in the editor's slide list).
3. On the copy, move, resize, recolour or retype things. Add or delete what you like.
4. Set the copy's transition to **morph** (editor: click an empty spot, Transition), or write `data-transition="morph"` on its `<section>`.

When you go from the first slide to the copy:

- Every object that is on both slides glides from its old place to the new one. Size, colour, font size and width change on the way. Text is moved and re-flowed, not stretched.
- Objects that only exist on the first slide fade out. Objects that only exist on the copy fade in.
- Going back plays it in reverse.
- Morph is set on the second slide and only runs between that slide and the one right before it.

How objects are matched, in this order:

1. **Same name.** Each object can carry a name, `data-id="..."`. The editor names every object when you duplicate a slide, so the copy's objects stay "the same objects" even after you change their text. In the editor the name is the **Object name** field under Morph.
2. **Same text**, for headings, paragraphs and list items without a name.
3. **Same image file.**

To morph two different objects into each other (PowerPoint's `!!name` trick), give both the same Object name.

Timing is in `animations.css`: `--morph-duration`, `--morph-ease`, `--morph-fade`. One slide can differ with `data-auto-animate-duration="1.4"` (seconds) on its `<section>`. An object that morphs skips its own preset animation; objects that fade in still play theirs.

Morph does not play inside the editor. Press **Present** to see it. With "reduce motion" on, a morph slide simply appears.

### Click to enlarge

Any image can open large when clicked during the talk.

- In the editor: select the image, tick **Enlarge this image when clicked**, and pick how it opens.
- By hand: `<img src="/assets/photo.jpg" data-zoom="grow" />`

| `data-zoom` | How it opens |
| --- | --- |
| `grow` | Expands from where the image sits on the slide |
| `fade` | Fades in, in the middle of the screen |
| `scale` | Fades in while growing a little |
| `rise` | Fades in while coming up from below |

Click the large image, or press `Esc`, to close it. Next / previous on the keyboard or clicker closes it and moves on. With the keyboard: Tab to the image, `Enter` opens and closes.

Speed, easing and the darkness behind the image are `--zoom-duration`, `--zoom-ease` and `--zoom-backdrop` at the top of `animations.css`. The four presets are in section 5 of that file; a new one is one rule:

```css
.zoom-layer[data-zoom='drop'] {
  --zoom-from: translate3d(0, -20vh, 0) rotate(-3deg);
}
```

Then use `data-zoom="drop"`. (The editor's list shows the four built-in ones; a custom name is typed in the Code tab.)

### Element presets

Put a preset on any element with a data attribute or a class. Both do the same.

```html
<h2 data-anim="fade-up">...</h2>
<h2 class="anim-fade-up">...</h2>
```

| Preset | Motion |
| --- | --- |
| `fade-up` | Fades in, moves up |
| `fade-down` | Fades in, moves down |
| `slide-in` | Comes in from the left |
| `slide-in-right` | Comes in from the right |
| `scale` | Fades in, grows slightly |
| `fade` | Fades in, no movement |
| `wipe` | Uncovered from left to right by a hard edge, no fading |
| `wipe-rise` | The same edge while it also comes up from below (the look of the section divider title) |
| `stagger` | Put it on a parent: its children come in one after another |

- Combine stagger with a preset: `data-anim="stagger scale"`.
- Tune one element: `style="--anim-delay: 900ms"` (also `--anim-duration`, `--anim-distance`, `--anim-stagger`).
- Play on the next click instead of on arrival: add `class="fragment"`.

### Add your own preset

A preset is one rule that says where the element starts. Add it to section 3 of `animations.css`:

```css
[data-anim~='drop'],
.anim-drop {
  --anim-from: translate3d(0, -120px, 0) rotate(-2deg);
}
```

Then use it: `<img data-anim="drop">`. Fading, timing, stagger and reduced motion are handled by the shared rules below the presets, so the new preset gets them for free.

### Add your own slide transition

A transition says how a slide looks when it is not the current one (`.past` and `.future`). Copy the `rise` block in section 2, rename `rise` in every selector, and change the `transform`. Add the new name to the two `:is(.rise, .drift, .wipe)` lists above it so it gets the shared timing.

## Tune the background

One file: `src/background/config.js`. Save it and the deck reloads.

| Setting | Meaning |
| --- | --- |
| `duration` | How long the background moves after a slide change, in ms |
| `speed` | How fast it moves while moving. 1 = speed of the fogya.tech site. Distance per slide = speed x duration |
| `easing` | Shape of the move. Names are in `src/background/easing.js`; add your own function there |
| `intensity` | Brightness of the animation, 1 = original |
| `dim` | Black scrim over the animation, 0 = original look, higher = more text contrast |
| `distortion`, `swirl` | Shape of the mesh |
| `grain` | Fine noise against colour banding on projectors |
| `offset` | Shifts the whole deck to a different set of frozen frames |
| `layers` | Colours of the two gradient layers, taken from the fogya.tech site |
| `maxDpr`, `resolution` | Rendering resolution. Lower them if the exam room PC stutters |

How it works: the fogya.tech site stacks two `MeshGradient` components that run forever. Here the same technique is one WebGL shader in one fixed canvas behind all slides. The picture depends on a single time value. Each slide owns one value, and a slide change eases from the old value to the new one, then the render loop stops. Going back eases to a lower value, so the motion plays in reverse. Between slide changes nothing is drawn.

With "reduce motion" switched on in the operating system, the background jumps to the new frame and element animations lose their movement.

If text is hard to read on one slide, raise `data-bg-dim` on that slide. If the whole deck is too bright on the projector, raise `dim`.

## PDF export

```bash
npm run pdf
```

Writes `fogya-tech-deck.pdf`, one 1920x1080 page per slide, with the background. It uses the Chrome or Edge installed on the computer. Another file name: `npm run pdf -- talk.pdf`. Another browser: set `CHROME_PATH`.

## Files

```
index.html              deck page
editor/index.html       editor page
slides/                 one file per slide
assets/                 images
src/main.js             reveal.js setup, hot reload of slides
src/morph.js            the morph transition (object matching, on top of reveal.js auto-animate)
src/zoom.js             click an image to enlarge it
src/background/         config.js, the shader, the tween, easings
src/styles/
  tokens.css            colours, fonts, sizes, grid
  base.css              type and deck chrome (wordmark, number, progress)
  layouts.css           one block per data-layout
  animations.css        all transitions and presets
  code-theme.css        code block colours
src/editor/
  fonts.js              the Font menu list
  editor.js             the /editor page: list, toolbar, Design and Code tabs, autosave
  stage.js              editing on the slide itself: select, drag, resize, type, undo
plugins/slides-plugin.js   reads slides/, hot reload, the editor's file and image upload API
scripts/export-pdf.js   npm run pdf
```

## Design notes

- Fonts, colours and the wordmark come from the fogya-tech repo: Figtree, Instrument Serif, Geist Mono, black, white, violet `#8b5cf6`. The repo has no logo file, only a v0 placeholder, so the deck uses the `fogya.tech` wordmark in Figtree Medium.
- `--violet-text` (`#b9a2fb`) is a lighter tint of the brand violet, used where violet is small text, because `#8b5cf6` is too dark to read at that size.
- The stage is fixed at 1920x1080 and scaled by reveal.js. All sizes in the CSS are pixels on that stage.

`npm run build` writes a static copy to `dist/` (deck only, the editor needs the dev server).
