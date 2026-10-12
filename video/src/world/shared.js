import * as THREE from 'three';
import { MAX_RINGS, MAX_MOUNDS } from './terrain-fn.js';

// One uniform object shared by every custom material, so the Director sets a
// value once per frame and terrain, sky and particles all agree.
export const U = {
  uTime: { value: 0 },          // simulation time (frozen during freezes)
  uCamPos: { value: new THREE.Vector3() },
  uSunDir: { value: new THREE.Vector3(0, 0.2, -1).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.8, 0.6) },
  uSunSize: { value: 0.022 },
  uZenith: { value: new THREE.Color(0.2, 0.3, 0.5) },
  uHorizon: { value: new THREE.Color(0.9, 0.7, 0.5) },
  uAmbient: { value: new THREE.Color(0.4, 0.35, 0.3) },
  uSand: { value: new THREE.Color(0.75, 0.48, 0.25) },
  uFogDensity: { value: 0.0006 },
  uHaze: { value: 0.3 },        // sun glow / scattering strength
  uNight: { value: 0 },         // 0 day .. 1 night (stars, moons)
  uMoonDir1: { value: new THREE.Vector3(-0.4, 0.35, -1).normalize() },
  uMoonDir2: { value: new THREE.Vector3(0.3, 0.22, -1).normalize() },
  uStorm: { value: 0 },         // 0..1 sandstorm amount (inside the storm)
  uStormWall: { value: new THREE.Vector4(0, 0, 0, 0) }, // nx, nz, offset, height (0 = off)
  uClouds: { value: 0 },        // thin high cloud streaks
  uGlint: { value: 0 },         // cymbal glints on the sand
  uRipple: { value: 1 },        // small wind ripple strength
  uShadow: { value: 1 },        // dune self-shadow strength
  uRingGlow: { value: new THREE.Color(0, 0, 0) }, // light emitted by ring wave fronts (night)
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
uniform vec4 uStormWall;
uniform float uClouds;
uniform float uGlint;
uniform float uRipple;
uniform float uShadow;
uniform vec3 uRingGlow;

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

// Colour of the air looking along dir: sky gradient + sun scattering.
vec3 skyColor(vec3 dir) {
  float y = max(dir.y, 0.0);
  vec3 c = mix(uHorizon, uZenith, pow(y, 0.42));
  // brighter, warmer band right at the horizon
  c += uHorizon * 0.35 * exp(-y * 18.0);
  float sd = max(dot(dir, uSunDir), 0.0);
  c += uSunColor * (pow(sd, 8.0) * 0.1 + pow(sd, 64.0) * 0.22 + pow(sd, 600.0) * 0.5) * uHaze;
  return c;
}

// Dust colour inside the storm: billowing, lit from the sun's side.
vec3 stormDust(vec3 dir, float seed) {
  float a = atan(dir.z, dir.x);
  float n = fbm(vec2(a * 7.0 - uTime * 0.9 + seed, dir.y * 9.0 + uTime * 0.15));
  float n2 = fbm(vec2(a * 19.0 - uTime * 2.3, dir.y * 25.0 - seed));
  vec3 base = mix(uHorizon, uSunColor * 0.6 + uHorizon * 0.4, 0.35) * 0.55;
  float lit = 0.55 + 0.45 * max(dot(dir, uSunDir), 0.0);
  return base * lit * (0.55 + 0.7 * n) * (0.85 + 0.3 * n2);
}

// Advancing storm wall (haboob): the plane dot(xz, n) = offset, billowing top.
// Returns coverage 0..1 of whatever lies at distance dist along dir.
float stormWall(vec3 dir, float dist, out vec3 col) {
  col = vec3(0.0);
  if (uStormWall.w <= 0.0) return 0.0;
  vec2 n = uStormWall.xy;
  float dn = dot(dir.xz, n);
  if (dn <= 0.001) return 0.0;
  float tHit = (uStormWall.z - dot(uCamPos.xz, n)) / dn;
  if (tHit < 0.0 || tHit > dist) return 0.0;
  vec3 hit = uCamPos + dir * tHit;
  vec2 along = vec2(-n.y, n.x);
  float s = dot(hit.xz, along);
  float top = uStormWall.w * (0.75 + 0.5 * fbm(vec2(s * 0.0025 - uTime * 0.05, uTime * 0.03)));
  float cover = 1.0 - smoothstep(top * 0.85, top * 1.05, hit.y);
  float billow = fbm(vec2(s * 0.004 + uTime * 0.02, hit.y * 0.006 - uTime * 0.12));
  float billow2 = fbm(vec2(s * 0.012, hit.y * 0.02 - uTime * 0.3));
  float topLight = smoothstep(top * 0.3, top, hit.y);
  vec3 dark = uHorizon * vec3(0.42, 0.3, 0.22);
  vec3 lit = uSunColor * 0.55 + uHorizon * 0.3;
  col = mix(dark, lit, topLight * (0.4 + 0.6 * billow)) * (0.7 + 0.5 * billow2);
  return cover;
}

vec3 applyFog(vec3 col, vec3 worldPos) {
  vec3 v = worldPos - uCamPos;
  float dist = length(v);
  vec3 dir = v / max(dist, 1e-3);
  float dens = uFogDensity * (1.0 + uStorm * 30.0);
  // ground-hugging haze: thicker when the ray stays low
  float hAvg = max(0.0, (uCamPos.y + worldPos.y) * 0.5);
  float hf = exp(-hAvg * 0.0035);
  vec3 ext = exp(-dist * dens * (0.35 + 0.65 * hf) * vec3(0.85, 1.0, 1.2));
  vec3 air = skyColor(normalize(vec3(dir.x, max(dir.y, 0.015), dir.z)));
  if (uStorm > 0.0) air = mix(air, stormDust(dir, 0.0), uStorm);
  col = col * ext + air * (1.0 - ext);
  vec3 wc;
  float w = stormWall(dir, dist, wc);
  return mix(col, wc, w);
}
`;
