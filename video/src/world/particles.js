import * as THREE from 'three';
import { U, COMMON_GLSL } from './shared.js';
import { DUNE_GLSL, DISPLACE_GLSL } from './terrain-fn.js';
import { rng } from '../core/util.js';

// Stateless particles: every position is a closed-form function of (seed, time)
// so any frame can be rendered in isolation. Three flavours via uniforms:
//   dust   — drifting grains near the ground, lifted by rings / hits
//   spice  — glowing motes rising slowly (night)
//   storm  — fast horizontal streaks around the camera

const vert = /* glsl */ `
${COMMON_GLSL}
${DUNE_GLSL}
${DISPLACE_GLSL}
attribute vec4 aSeed;
uniform vec3 uBox;        // size of the camera-following box
uniform vec3 uWind;       // m/s
uniform float uGust;      // extra lift for all grains (snare / guitar hits)
uniform float uRise;      // >0: rise from the ground (spice)
uniform float uHover;     // 0..1 freeze grains in the air (break)
uniform float uSize;
uniform float uPixelRatio;
varying float vAlpha;
varying float vSeed;

void main() {
  vec3 base = aSeed.xyz * uBox;
  float speed = 0.6 + 0.8 * aSeed.w;
  vec3 p = base + uWind * uTime * speed;
  p.xz = mod(p.xz - uCamPos.xz + uBox.xz * 0.5, uBox.xz) + uCamPos.xz - uBox.xz * 0.5;

  float ground = terrainHeight(p.xz);
  float above;
  if (uRise > 0.0) {
    above = fract(aSeed.y + uTime * uRise * (0.4 + aSeed.w)) * uBox.y;
  } else {
    above = pow(aSeed.y, 4.0) * uBox.y;
    above += ringsLift(p.xz) * (0.6 + 2.5 * aSeed.w);
    above += uGust * pow(aSeed.w, 2.0) * 6.0;
    above += uHover * (2.0 + 10.0 * aSeed.w);
  }
  p.y = ground + 0.05 + above;
  p.xz += vec2(sin(uTime * 1.3 + aSeed.x * 40.0), cos(uTime * 1.1 + aSeed.z * 40.0)) * 0.3;

  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  gl_PointSize = uSize * uPixelRatio * (0.5 + aSeed.w) * 300.0 / max(dist, 0.5);
  vAlpha = smoothstep(0.3, 2.0, dist) * (1.0 - smoothstep(uBox.x * 0.3, uBox.x * 0.5, dist));
  vSeed = aSeed.w;
}
`;

const frag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uGlow;
varying float vAlpha;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c) * 4.0;
  if (r > 1.0) discard;
  float a = (1.0 - r) * vAlpha * uOpacity;
  gl_FragColor = vec4(uColor * (1.0 + uGlow * (1.0 - r) * 2.0), a);
}
`;

export class Particles {
  constructor(scene, { count = 30000, seed = 1, additive = false } = {}) {
    const r = rng(seed);
    const s = new Float32Array(count * 4);
    for (let i = 0; i < s.length; i++) s[i] = r();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(s, 4));
    this.uniforms = {
      ...U,
      uBox: { value: new THREE.Vector3(160, 30, 160) },
      uWind: { value: new THREE.Vector3(3, 0, 0.5) },
      uGust: { value: 0 },
      uRise: { value: 0 },
      uHover: { value: 0 },
      uSize: { value: 0.05 },
      uPixelRatio: { value: 1 },
      uColor: { value: new THREE.Color(1, 0.85, 0.6) },
      uOpacity: { value: 0.7 },
      uGlow: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  set(params) {
    for (const [k, v] of Object.entries(params)) {
      const u = this.uniforms[k];
      if (!u) continue;
      if (u.value?.set && Array.isArray(v)) u.value.set(...v);
      else if (u.value?.copy && typeof v === 'object') u.value.copy(v);
      else u.value = v;
    }
  }

  set visible(v) { this.points.visible = v; }
}
