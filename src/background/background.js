// The shared deck background: one canvas, one WebGL program.
//
// The picture is a pure function of one number, `time`. Slide n sits at
//   time = offset + n * (speed * duration)
// and a slide change tweens `time` from where it is to the new slide's value.
// A lower slide number is a lower time, so going back plays in reverse.
// The animation loop only runs during that tween. Between slide changes
// nothing is drawn at all.

import { getEasing } from './easing.js';
import { buildFragmentSource, vertexSource } from './shader.js';

export function createBackground(canvas, config) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ease = getEasing(config.easing);
  const durationSec = Math.max(0.001, config.duration / 1000);
  const step = config.speed * durationSec; // time units between two slides

  let gl = null;
  let uniforms = null;

  // Tween state
  let time = config.offset; // what is on screen now
  let from = time;
  let to = time;
  let startVelocity = 0; // velocity carried over when a move is interrupted
  let velocity = 0;
  let elapsed = 0;
  let lastFrame = 0;
  let rafId = 0;

  const stats = { frames: 0, maxFrameMs: 0, totalMs: 0, running: false };

  // --- WebGL setup ----------------------------------------------------------

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Background shader: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  }

  function setup() {
    gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      // Keeps the last frame available for printing and PDF export.
      preserveDrawingBuffer: true,
    });
    if (!gl) return false;

    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, buildFragmentSource(config.layers)));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Background program: ${gl.getProgramInfoLog(program)}`);
    }
    gl.useProgram(program);

    // One triangle that covers the screen.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    uniforms = Object.fromEntries(
      ['u_resolution', 'u_time', 'u_distortion', 'u_swirl', 'u_intensity', 'u_grain'].map((name) => [
        name,
        gl.getUniformLocation(program, name),
      ]),
    );
    gl.uniform1f(uniforms.u_distortion, config.distortion);
    gl.uniform1f(uniforms.u_swirl, config.swirl);
    gl.uniform1f(uniforms.u_intensity, config.intensity);
    gl.uniform1f(uniforms.u_grain, config.grain);
    return true;
  }

  function draw() {
    if (!gl) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uniforms.u_resolution, canvas.width, canvas.height);
    gl.uniform1f(uniforms.u_time, time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // --- Size: follows the window and devicePixelRatio ------------------------

  function resize(deviceWidth, deviceHeight) {
    const dpr = window.devicePixelRatio || 1;
    // deviceWidth is in real pixels. Scale it down if dpr is above the cap.
    const scale = (Math.min(dpr, config.maxDpr) / dpr) * config.resolution;
    const width = Math.max(1, Math.round(deviceWidth * scale));
    const height = Math.max(1, Math.round(deviceHeight * scale));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    draw(); // resizing clears the canvas, so repaint the frozen frame
  }

  const observer = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    const exact = entry.devicePixelContentBoxSize?.[0];
    if (exact) {
      resize(exact.inlineSize, exact.blockSize);
    } else {
      const dpr = window.devicePixelRatio || 1;
      resize(entry.contentRect.width * dpr, entry.contentRect.height * dpr);
    }
  });

  // --- The tween ------------------------------------------------------------

  // Extra term that carries the old velocity into a new move and fades it out.
  // Its slope is 1 at the start and 0 at the end, its value 0 at both ends.
  const carry = (u) => u * (1 - u) * (1 - u);

  function frame(now) {
    // Delta time, so the move takes `duration` at 30, 60 or 144 Hz alike.
    // Clamped: a stalled tab resumes smoothly instead of jumping.
    const dt = Math.min(Math.max((now - lastFrame) / 1000, 0), 0.1);
    lastFrame = now;
    elapsed += dt;

    const u = Math.min(elapsed / durationSec, 1);
    const previous = time;
    time = from + (to - from) * ease(u) + startVelocity * durationSec * carry(u);
    if (dt > 0) velocity = (time - previous) / dt;

    draw();

    stats.frames += 1;
    stats.totalMs += dt * 1000;
    stats.maxFrameMs = Math.max(stats.maxFrameMs, dt * 1000);

    if (u < 1) {
      rafId = requestAnimationFrame(frame);
    } else {
      // Arrived: stop the loop. The canvas keeps the last frame.
      time = to;
      velocity = 0;
      rafId = 0;
      stats.running = false;
    }
  }

  function moveTo(target, { immediate = false } = {}) {
    if (target === to && !immediate) return;

    if (immediate || reducedMotion.matches) {
      cancelAnimationFrame(rafId);
      rafId = 0;
      stats.running = false;
      time = from = to = target;
      velocity = startVelocity = 0;
      draw();
      return;
    }

    // Start from wherever the background is right now, keeping its velocity,
    // so a second key press mid move bends the motion instead of restarting it.
    from = time;
    to = target;
    startVelocity = rafId ? velocity : 0;
    elapsed = 0;

    if (!rafId) {
      Object.assign(stats, { frames: 0, maxFrameMs: 0, totalMs: 0, running: true });
      lastFrame = performance.now();
      rafId = requestAnimationFrame((now) => {
        lastFrame = now; // first frame starts the clock
        frame(now);
      });
    }
  }

  // --- Lifecycle ------------------------------------------------------------

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    cancelAnimationFrame(rafId);
    rafId = 0;
    time = to;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (setup()) draw();
  });

  try {
    if (!setup()) throw new Error('WebGL is not available');
  } catch (error) {
    console.warn(`${error.message}. The deck falls back to a plain black background.`);
    gl = null;
    canvas.style.display = 'none';
  }

  // Size once right away, then keep following the window.
  {
    const dpr = window.devicePixelRatio || 1;
    resize(canvas.clientWidth * dpr, canvas.clientHeight * dpr);
  }
  try {
    observer.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    observer.observe(canvas);
  }

  return {
    /** Move to the frozen frame of slide `index`. */
    setSlide(index, options) {
      moveTo(config.offset + index * step, options);
    },
    /** For checks in the console: time, size, and frame timing of the last move. */
    get state() {
      return { time, target: to, width: canvas.width, height: canvas.height, ...stats };
    },
    redraw: draw,
  };
}
