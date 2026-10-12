import * as THREE from 'three';

// Top-down "the desert is a drum skin" shots (06, 19). Sand gathers on the
// nodal lines of a vibrating plate:  f = cos(nπx)cos(mπy) ± cos(mπx)cos(nπy).
// Mode (n, m) changes per downbeat. Kicks sharpen the figure. Grains are
// procedural per-pixel cells, so it holds up at any resolution.

const frag = /* glsl */ `
uniform vec2 uRes;
uniform float uTime;
uniform vec4 uModeA;     // n, m, sign, unused   (previous mode)
uniform vec4 uModeB;     // n, m, sign, unused   (current mode)
uniform float uMorph;    // 0..1 migration from A to B
uniform float uSharp;    // how tightly grains sit on the lines
uniform float uKick;     // kick envelope: shake + brightness
uniform float uRing;     // 0..1 blend toward a final circular drumhead figure
uniform float uZoom;
uniform float uRot;
uniform vec3 uSand;
uniform vec3 uPlate;
uniform vec3 uLight;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float chladni(vec2 p, vec4 m) {
  float PI = 3.14159265;
  return cos(m.x * PI * p.x) * cos(m.y * PI * p.y) + m.z * cos(m.y * PI * p.x) * cos(m.x * PI * p.y);
}
float drumhead(vec2 p) { // circular membrane-like mode: rings
  float r = length(p);
  return cos(r * 3.14159 * 4.5);
}
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.0 / uZoom;
  float c = cos(uRot), s = sin(uRot);
  p = mat2(c, -s, s, c) * p;
  p += vec2(sin(uTime * 61.0), cos(uTime * 53.0)) * 0.004 * uKick;

  float fa = chladni(p, uModeA), fb = chladni(p, uModeB);
  float f = mix(fa, fb, uMorph);
  f = mix(f, drumhead(p), uRing);

  // grain field: each pixel cell holds a grain with random size/brightness
  vec2 cell = floor(gl_FragCoord.xy / 2.0);
  float g = hash12(cell);
  float g2 = hash12(cell + 7.3);
  float density = exp(-abs(f) * uSharp) ;
  density = mix(density, 0.25 * g2, 0.15 * (1.0 - uSharp / 40.0));
  float grain = step(1.0 - density, g);

  // slight relief lighting: grains piled on lines catch the light
  float e = 0.004;
  float fx = abs(mix(chladni(p + vec2(e, 0), uModeA), chladni(p + vec2(e, 0), uModeB), uMorph)) - abs(f);
  float lit = 0.75 + 0.5 * clamp(-fx * 40.0 * dot(uLight.xy, vec2(1.0, 0.0)), -0.5, 0.5);

  vec3 plate = uPlate * (0.7 + 0.3 * smoothstep(1.6, 0.0, length(p)));
  vec3 sand = uSand * (0.7 + 0.6 * g2) * lit * (1.0 + uKick * 0.5);
  vec3 col = mix(plate, sand, grain);
  // vignette toward the plate edge
  col *= 1.0 - 0.35 * smoothstep(0.9, 1.8, length(p));
  gl_FragColor = vec4(col, 1.0);
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
      uSand: { value: new THREE.Color(0.95, 0.72, 0.42) },
      uPlate: { value: new THREE.Color(0.16, 0.09, 0.05) },
      uLight: { value: new THREE.Vector3(1, 0.3, 0.5) },
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
