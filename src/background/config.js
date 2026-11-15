// Everything you tune about the background lives in this file.
// Save it and the deck reloads with the new values.

export default {
  // ---- Motion --------------------------------------------------------------

  // How long the background moves after a slide change, in milliseconds.
  duration: 2000,

  // How fast it moves while it is moving. 1 = the speed of the fogya.tech
  // website. Distance travelled per slide change = speed x duration.
  speed: 4.5,

  // Shape of the move. One of the names in easing.js:
  // linear, easeInOutSine, easeInOutQuad, easeInOutCubic, easeInOutQuart,
  // easeInOutQuint, easeOutCubic, easeOutQuart, easeOutExpo
  easing: 'easeInOutCubic',

  // ---- Look ----------------------------------------------------------------

  // Brightness of the animation itself. 1 = original, 0 = black.
  intensity: 1,

  // Opacity of the flat black layer between the animation and the slides.
  // Higher = calmer background and more text contrast. 0 = original look.
  // One slide can override it: <section data-bg-dim="0.3">
  dim: 0.62,

  // Shape of the mesh. Original values: 0.8 and 0.1.
  distortion: 0.8,
  swirl: 0.1,

  // Fine noise that hides colour banding on projectors. 0 turns it off.
  grain: 1,

  // Where in the animation slide 1 sits. Change it to get a different
  // set of frozen frames for the whole deck.
  offset: 12,

  // The two layers of the fogya.tech background, composited in one canvas.
  // `speed` is each layer's own rate, as on the website.
  layers: [
    { colors: ['#000000', '#8b5cf6', '#ffffff', '#1e1b4b', '#4c1d95'], speed: 0.3, opacity: 1 },
    { colors: ['#000000', '#ffffff', '#8b5cf6', '#000000'], speed: 0.2, opacity: 0.6 },
  ],

  // ---- Rendering -----------------------------------------------------------

  // Cap on devicePixelRatio. The gradient is soft, so 1.5 looks the same as 2
  // or 3 and costs far fewer pixels. Lower it if a weak projector PC stutters.
  maxDpr: 1.5,

  // Extra resolution scale on top of that. 0.5 renders a quarter of the pixels.
  resolution: 1,
};
