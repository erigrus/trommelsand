import * as THREE from 'three';

// Top-down "the desert is a drum skin" shots. Sand gathers on the nodal lines
// of a vibrating plate:  f = cos(nπx)cos(mπy) ± cos(mπx)cos(nπy).
// Rendered as relief: sand piles lit by a low raking sun on a dark, brushed
// bronze plate. Mode (n, m) changes per downbeat; the grains migrate from the
// old figure to the new one (uMorph). Kicks make the grains jump.

const frag = /* glsl */ `
uniform vec2 uRes;
uniform float uTime;
uniform vec4 uModeA;     // n, m, sign   (previous figure)
uniform vec4 uModeB;     // n, m, sign   (current figure)
uniform float uMorph;    // 0..1 migration from A to B
uniform float uSharp;    // how tightly grains sit on the lines
uniform float uKick;     // kick envelope: grains jump
uniform float uRing;     // 0..1 blend toward a final circular drumhead figure
uniform float uZoom;
uniform float uRot;
uniform vec2 uPan;
uniform vec3 uSand;
uniform vec3 uPlate;
uniform vec3 uLight;     // direction of the raking light (xy on the plate, z up)
uniform vec3 uLightColor;
uniform float uExposure;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float chladni(vec2 p, vec4 m) {
  float PI = 3.14159265;
  return cos(m.x * PI * p.x) * cos(m.y * PI * p.y) + m.z * cos(m.y * PI * p.x) * cos(m.x * PI * p.y);
}
float field(vec2 p) {
  float f = mix(chladni(p, uModeA), chladni(p, uModeB), uMorph);
  float r = length(p);
  f = mix(f, cos(r * 3.14159 * 4.5) * 0.9, uRing);
  return f;
}
// sand height: piles on the nodal lines, granular, with stray grains elsewhere
float sand(vec2 p) {
  float f = abs(field(p));
  float pile = exp(-f * uSharp);
  float grit = vnoise(p * 180.0) * 0.6 + vnoise(p * 420.0) * 0.4;
  float h = smoothstep(0.15, 0.95, pile + (grit - 0.5) * 0.35);
  h += step(0.985, hash12(floor(p * 260.0))) * 0.5 * (1.0 - h);
  return h;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.0 / uZoom + uPan;
  float c = cos(uRot), s = sin(uRot);
  p = mat2(c, -s, s, c) * p;
  // grains hop on kicks
  vec2 hop = (vec2(vnoise(p * 40.0 + uTime * 30.0), vnoise(p * 40.0 - uTime * 27.0)) - 0.5) * 0.006 * uKick;
  vec2 q = p + hop;

  float h = sand(q);
  float e = 0.0025;
  vec3 n = normalize(vec3(sand(q - vec2(e, 0.0)) - sand(q + vec2(e, 0.0)), sand(q - vec2(0.0, e)) - sand(q + vec2(0.0, e)), 0.9));
  vec3 L = normalize(uLight);
  float ndl = max(dot(n, L), 0.0);

  // brushed bronze plate with a broad anisotropic sheen
  float brush = vnoise(vec2(p.x * 3.0, p.y * 600.0)) * 0.5 + 0.5;
  vec3 plate = uPlate * (0.75 + 0.25 * brush);
  float sheen = exp(-pow((p.x * 0.6 + p.y * 0.8 - 0.2) * 2.2, 2.0)) * 0.12;
  plate += uLightColor * sheen * (0.6 + 0.4 * brush) * 0.4;
  plate *= 1.0 - 0.45 * smoothstep(0.8, 2.0, length(p));

  vec3 sandC = uSand * (0.78 + 0.35 * vnoise(q * 300.0));
  vec3 lit = sandC * (uLightColor * ndl * 1.6 + vec3(0.18, 0.16, 0.2));
  lit *= 1.0 + uKick * 0.35;
  // contact shadow beside the piles
  float shadow = sand(q - L.xy * 0.006) - h;
  vec3 base = plate * (1.0 - clamp(shadow, 0.0, 1.0) * 0.6);
  vec3 col = mix(base, lit, smoothstep(0.08, 0.35, h));
  gl_FragColor = vec4(col * uExposure, 1.0);
}
`;

const vert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Hand-picked modes that read well; cycled per bar.
export const CHLADNI_MODES = [
  [1, 4, 1], [2, 5, -1], [3, 5, 1], [3, 7, -1], [4, 7, 1], [2, 7, 1], [5, 8, -1], [4, 9, 1],
  [6, 9, -1], [3, 8, 1], [5, 9, 1], [7, 10, -1],
];

export class Chladni {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.uniforms = {
      uRes: { value: new THREE.Vector2(1920, 1080) },
      uTime: { value: 0 },
      uModeA: { value: new THREE.Vector4(1, 4, 1, 0) },
      uModeB: { value: new THREE.Vector4(2, 5, -1, 0) },
      uMorph: { value: 1 },
      uSharp: { value: 20 },
      uKick: { value: 0 },
      uRing: { value: 0 },
      uZoom: { value: 1 },
      uRot: { value: 0 },
      uPan: { value: new THREE.Vector2(0, 0) },
      uSand: { value: new THREE.Color(0.95, 0.66, 0.36) },
      uPlate: { value: new THREE.Color(0.07, 0.04, 0.025) },
      uLight: { value: new THREE.Vector3(0.8, 0.45, 0.35) },
      uLightColor: { value: new THREE.Color(1.0, 0.82, 0.6) },
      uExposure: { value: 1 },
    };
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, depthTest: false }));
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  setMode(slot, i) {
    const m = CHLADNI_MODES[((i % CHLADNI_MODES.length) + CHLADNI_MODES.length) % CHLADNI_MODES.length];
    this.uniforms[slot].value.set(m[0], m[1], m[2], 0);
  }
}
