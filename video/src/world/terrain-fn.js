// The dune heightfield, written twice: once in JS (camera clearance, placing
// the walker/worm) and once in GLSL (terrain, particles). KEEP THEM IN SYNC.
//
// Shape: transverse dunes perpendicular to the wind (+x), with a gentle
// windward (stoss) slope, a steep lee face and a sharp crest. The ridges
// meander (noise + sine warp). A regional envelope makes great dune seas in
// some places and flat interdune basins in others (shot 07 lives in one).
// Noise uses an integer hash that gives the same bits in JS (Math.imul) and
// GLSL (uint), so both sides agree to float precision.

const fract = (x) => x - Math.floor(x);

function hashu(x) {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
function hash2i(ix, iy) {
  return hashu((Math.imul(ix, 1597334677) ^ hashu((iy + 0x9e3779b9) | 0)) | 0) / 4294967296;
}
export function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2i(ix, iy), b = hash2i(ix + 1, iy), c = hash2i(ix, iy + 1), d = hash2i(ix + 1, iy + 1);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

// Asymmetric dune profile over one period: long windward rise (85 %), a
// slip face at roughly the angle of repose, a sharp crest.
function profile(x) {
  const f = fract(x / (2 * Math.PI));
  const s = f < 0.85 ? f / 0.85 : (1 - f) / 0.15;
  return s * s * (2 - s); // flat at the trough, sharp at the crest
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** 0 = flat interdune basin, 1 = full dune sea. */
export function duneEnv(x, z) {
  const e = vnoise(x * 0.00045 + 3.1, z * 0.00045 + 7.7) * 0.65 + vnoise(x * 0.0011 + 11.3, z * 0.0011 + 2.9) * 0.35;
  return smooth(0.16, 0.48, e);
}

export function duneHeight(x, z) {
  const env = duneEnv(x, z);
  const warp = (vnoise(x * 0.0016, z * 0.0016) - 0.5) * 5.0 + (vnoise(x * 0.0045 + 5.0, z * 0.0045 + 5.0) - 0.5) * 1.6
    + Math.sin(z * 0.004 + Math.sin(x * 0.002) * 1.3) * 1.0;
  const r1 = profile(x * 0.0105 + warp);                              // main ridges, ~600 m apart
  const r2 = profile(x * 0.024 + z * 0.007 + warp * 1.6 + 3.1);       // secondary set, ~260 m
  const big = Math.sin(x * 0.0026 + 1.0) * Math.sin(z * 0.0019 + 2.0); // long swell, ~2.4 km
  return (55 * r1 + 12 * r2) * (0.06 + 0.94 * env) + 30 * big * (0.3 + 0.7 * env) + 4 * vnoise(x * 0.01, z * 0.01);
}

export const DUNE_GLSL = /* glsl */ `
uint hashu(uint x) {
  x = (x ^ (x >> 16u)) * 0x7feb352du;
  x = (x ^ (x >> 15u)) * 0x846ca68bu;
  return x ^ (x >> 16u);
}
float hash2i(int ix, int iy) {
  return float(hashu(uint(ix) * 1597334677u ^ hashu(uint(iy) + 0x9e3779b9u))) / 4294967296.0;
}
float vnoiseI(vec2 p) {
  vec2 i = floor(p), f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  int ix = int(i.x), iy = int(i.y);
  float a = hash2i(ix, iy), b = hash2i(ix + 1, iy), c = hash2i(ix, iy + 1), d = hash2i(ix + 1, iy + 1);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float duneProfile(float x) {
  float f = fract(x / 6.28318530718);
  float s = f < 0.85 ? f / 0.85 : (1.0 - f) / 0.15;
  return s * s * (2.0 - s);
}
float duneEnv(vec2 p) {
  float e = vnoiseI(p * 0.00045 + vec2(3.1, 7.7)) * 0.65 + vnoiseI(p * 0.0011 + vec2(11.3, 2.9)) * 0.35;
  return smoothstep(0.16, 0.48, e);
}
float duneHeight(vec2 p) {
  float env = duneEnv(p);
  float warp = (vnoiseI(p * 0.0016) - 0.5) * 5.0 + (vnoiseI(p * 0.0045 + 5.0) - 0.5) * 1.6
    + sin(p.y * 0.004 + sin(p.x * 0.002) * 1.3) * 1.0;
  float r1 = duneProfile(p.x * 0.0105 + warp);
  float r2 = duneProfile(p.x * 0.024 + p.y * 0.007 + warp * 1.6 + 3.1);
  float big = sin(p.x * 0.0026 + 1.0) * sin(p.y * 0.0019 + 2.0);
  return (55.0 * r1 + 12.0 * r2) * (0.06 + 0.94 * env) + 30.0 * big * (0.3 + 0.7 * env) + 4.0 * vnoiseI(p * 0.01);
}
`;

// Shockwave rings + worm mounds. Uniform layout shared by terrain and particles.
export const MAX_RINGS = 16;
export const MAX_MOUNDS = 8;

export const DISPLACE_GLSL = /* glsl */ `
uniform vec4 uRings[${MAX_RINGS}];   // x, z, age (s), strength (0 = unused)
uniform vec4 uRingShape;            // speed (m/s), width (m), amplitude (m), decay (1/s)
uniform vec4 uMounds[${MAX_MOUNDS}]; // x, z, height (m), radius (m)

float ringEnvelope(vec2 p, vec4 r, out float d) {
  d = length(p - r.xy) - r.z * uRingShape.x;
  float w = uRingShape.y * (1.0 + r.z * 0.6);
  return exp(-d * d / (w * w)) * exp(-r.z * uRingShape.w) * r.w;
}
float ringsHeight(vec2 p) {
  float h = 0.0, d;
  for (int i = 0; i < ${MAX_RINGS}; i++) {
    if (uRings[i].w <= 0.0) continue;
    float e = ringEnvelope(p, uRings[i], d);
    h += uRingShape.z * e * cos(d * 3.14159 / uRingShape.y);
  }
  return h;
}
float ringsLift(vec2 p) { // >= 0, for grains jumping at the wave front
  float l = 0.0, d;
  for (int i = 0; i < ${MAX_RINGS}; i++) {
    if (uRings[i].w <= 0.0) continue;
    l += ringEnvelope(p, uRings[i], d);
  }
  return l;
}
float moundHeight(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < ${MAX_MOUNDS}; i++) {
    vec4 m = uMounds[i];
    if (m.z == 0.0) continue;
    vec2 d = (p - m.xy) / m.w;
    h += m.z * exp(-dot(d, d));
  }
  return h;
}
float terrainHeight(vec2 p) { return duneHeight(p) + ringsHeight(p) + moundHeight(p); }
`;
