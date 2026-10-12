import * as THREE from 'three';
import { MAX_RINGS, MAX_MOUNDS } from './terrain-fn.js';

// One uniform object shared by every custom material, so the Director sets a
// value once per frame and terrain, sky and particles all agree.
export const U = {
  uTime: { value: 0 },          // simulation time (frozen during freezes)
  uCamPos: { value: new THREE.Vector3() },
  uSunDir: { value: new THREE.Vector3(0, 0.2, -1).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.8, 0.6) },
  uSunSize: { value: 0.025 },
  uZenith: { value: new THREE.Color(0.2, 0.3, 0.5) },
  uHorizon: { value: new THREE.Color(0.9, 0.7, 0.5) },
  uAmbient: { value: new THREE.Color(0.4, 0.35, 0.3) },
  uSand: { value: new THREE.Color(0.75, 0.48, 0.25) },
  uFogDensity: { value: 0.0006 },
  uHaze: { value: 0.3 },        // sun glow / scattering strength
  uNight: { value: 0 },         // 0 day .. 1 night (stars, moons)
  uMoonDir1: { value: new THREE.Vector3(-0.4, 0.35, -1).normalize() },
  uMoonDir2: { value: new THREE.Vector3(0.3, 0.22, -1).normalize() },
  uStorm: { value: 0 },         // 0..1 sandstorm amount
  uGlint: { value: 0 },         // cymbal glints on the sand
  uRipple: { value: 1 },        // small wind ripple strength
  uShadow: { value: 1 },        // dune self-shadow strength
  uRings: { value: Array.from({ length: MAX_RINGS }, () => new THREE.Vector4()) },
  uRingShape: { value: new THREE.Vector4(30, 3, 0.6, 1.2) },
  uMounds: { value: Array.from({ length: MAX_MOUNDS }, () => new THREE.Vector4()) },
};

export const COMMON_GLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunSize;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uAmbient;
uniform vec3 uSand;
uniform float uFogDensity;
uniform float uHaze;
uniform float uNight;
uniform vec3 uMoonDir1;
uniform vec3 uMoonDir2;
uniform float uStorm;
uniform float uGlint;
uniform float uRipple;
uniform float uShadow;

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
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

// Colour of the air looking along dir: sky gradient + sun scattering + storm.
vec3 skyColor(vec3 dir) {
  float y = max(dir.y, 0.0);
  vec3 c = mix(uHorizon, uZenith, pow(y, 0.45));
  float sd = max(dot(dir, uSunDir), 0.0);
  c += uSunColor * (pow(sd, 8.0) * 0.35 + pow(sd, 64.0) * 0.6) * uHaze;
  vec3 stormC = mix(uHorizon, uSunColor, 0.25) * 0.55;
  c = mix(c, stormC, uStorm * 0.9);
  return c;
}

vec3 applyFog(vec3 col, vec3 worldPos) {
  vec3 v = worldPos - uCamPos;
  float dist = length(v);
  vec3 dir = v / max(dist, 1e-3);
  float dens = uFogDensity * (1.0 + uStorm * 25.0);
  // thicker near the ground
  float hf = exp(-max(worldPos.y, 0.0) * 0.004);
  float f = 1.0 - exp(-dist * dens * (0.4 + 0.6 * hf));
  return mix(col, skyColor(normalize(vec3(dir.x, max(dir.y, 0.02), dir.z))), f);
}
`;
