// The dune heightfield, written twice: once in JS (camera clearance, placing
// the walker/worm) and once in GLSL (terrain, particles). KEEP THEM IN SYNC.
//
// Shape: transverse dunes perpendicular to the wind (+x), with a gentle
// windward (stoss) slope and a steep lee face, a sharp crest, domain-warped so
// the ridges meander, plus a second smaller ridge set and a long swell.

const fract = (x) => x - Math.floor(x);

// Asymmetric dune profile over one period: slow rise (78 %), steep fall.
function profile(x) {
  const f = fract(x / (2 * Math.PI));
  const s = f < 0.78 ? f / 0.78 : (1 - f) / 0.22;
  return s * s * (2 - s); // flat at the trough, sharp at the crest
}

export function duneHeight(x, z) {
  const qx = x * 0.0025, qz = z * 0.0025;
  const warp = Math.sin(qz * 1.7 + Math.sin(qx * 0.9) * 1.3) * 1.2 + Math.sin(qz * 0.6 - qx * 0.4) * 2.0;
  const r1 = profile(qx * 1.0 + warp);
  const r2 = profile(qx * 2.3 + qz * 0.7 + warp * 1.6 + 3.1);
  const big = Math.sin(qx * 0.31 + 1.0) * Math.sin(qz * 0.23 + 2.0);
  return 55 * r1 + 16 * r2 + 30 * big;
}

export const DUNE_GLSL = /* glsl */ `
float duneProfile(float x) {
  float f = fract(x / 6.28318530718);
  float s = f < 0.78 ? f / 0.78 : (1.0 - f) / 0.22;
  return s * s * (2.0 - s);
}
float duneHeight(vec2 p) {
  vec2 q = p * 0.0025;
  float warp = sin(q.y * 1.7 + sin(q.x * 0.9) * 1.3) * 1.2 + sin(q.y * 0.6 - q.x * 0.4) * 2.0;
  float r1 = duneProfile(q.x * 1.0 + warp);
  float r2 = duneProfile(q.x * 2.3 + q.y * 0.7 + warp * 1.6 + 3.1);
  float big = sin(q.x * 0.31 + 1.0) * sin(q.y * 0.23 + 2.0);
  return 55.0 * r1 + 16.0 * r2 + 30.0 * big;
}
`;

// Shockwave rings + worm mound. Uniform layout shared by terrain and particles.
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
