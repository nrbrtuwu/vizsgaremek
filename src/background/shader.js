// GLSL for the background.
//
// This is the mesh gradient technique the fogya.tech site uses (through the
// paper-design MeshGradient component), written as one shader:
//   - every colour is a "spot" that travels on its own sine/cosine orbit,
//   - the screen coordinates are bent (distortion) and twisted (swirl),
//   - each pixel takes a weighted mix of all colours, nearer spots weigh more.
// The site stacks two such gradients in two canvases. Here both are computed
// in the same pass and blended, so the deck needs a single canvas.
//
// Nothing in here advances on its own: the picture depends only on u_time,
// and background.js decides what u_time is.

export const vertexSource = /* glsl */ `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const hexToVec3 = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  const f = (v) => (v / 255).toFixed(4);
  return `vec3(${f((n >> 16) & 255)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
};

// One GLSL function per layer, with that layer's colours written in.
const layerFunction = (layer, index) => {
  const spots = layer.colors
    .map(
      (hex, i) => `
  w = spotWeight(uv, ${i}.0, t);
  color += ${hexToVec3(hex)} * w;
  total += w;`,
    )
    .join('');

  return `
vec3 layer${index}(vec2 uv, float t) {
  uv = warp(uv, t);
  vec3 color = vec3(0.0);
  float total = 0.0;
  float w;${spots}
  return color / total;
}`;
};

export function buildFragmentSource(layers) {
  const blend = layers
    .map((layer, i) => {
      const t = `u_time * ${Number(layer.speed).toFixed(4)}`;
      const opacity = Number(layer.opacity ?? 1).toFixed(4);
      return `  color = mix(color, layer${i}(uv, 0.5 * ${t}), ${opacity});`;
    })
    .join('\n');

  return /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_distortion;
uniform float u_swirl;
uniform float u_intensity;
uniform float u_grain;

vec2 rotate(vec2 v, float a) {
  float s = sin(a);
  float c = cos(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

// Where colour spot i is at time t, inside the 0..1 square.
vec2 spotPosition(float i, float t) {
  float a = i * 0.37;
  float b = 0.6 + mod(i, 3.0) * 0.3;
  float c = 0.8 + mod(i + 1.0, 4.0) * 0.25;
  return 0.5 + 0.5 * vec2(sin(t * b + a), cos(t * c + a * 1.5));
}

float spotWeight(vec2 uv, float i, float t) {
  float d = length(uv - spotPosition(i, t));
  return 1.0 / (pow(d, 3.5) + 1e-3);
}

// Bend and twist the coordinates, strongest in the middle of the screen.
vec2 warp(vec2 uv, float t) {
  float radius = smoothstep(0.0, 1.0, length(uv - 0.5));
  float center = 1.0 - radius;
  for (float i = 1.0; i <= 2.0; i++) {
    uv.x += u_distortion * center / i
      * sin(t + i * 0.4 * smoothstep(0.0, 1.0, uv.y))
      * cos(0.2 * t + i * 2.4 * smoothstep(0.0, 1.0, uv.y));
    uv.y += u_distortion * center / i * cos(t + i * 2.0 * smoothstep(0.0, 1.0, uv.x));
  }
  return rotate(uv - 0.5, -3.0 * u_swirl * radius) + 0.5;
}
${layers.map(layerFunction).join('\n')}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 color = vec3(0.0);
${blend}
  color *= u_intensity;
  // Static dither: breaks up 8 bit banding in the dark areas.
  color += (hash(gl_FragCoord.xy) - 0.5) * u_grain * (1.5 / 255.0);
  gl_FragColor = vec4(color, 1.0);
}
`;
}
