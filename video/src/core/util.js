// Small deterministic helpers (no Math.random anywhere in the render path).

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, f) => a + (b - a) * f;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const easeInOut = (x) => smoothstep(0, 1, x);
export const easeOutCubic = (x) => 1 - Math.pow(1 - clamp(x), 3);

/** Integer hash -> [0,1). Stable across machines. */
export function hash1(n) {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Seeded PRNG (mulberry32) for building static geometry/attributes. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear interpolation of keyframed plain objects / numbers / [r,g,b] arrays. */
export function mixValue(a, b, f) {
  if (typeof a === 'number') return lerp(a, b, f);
  if (Array.isArray(a)) return a.map((v, i) => lerp(v, b[i], f));
  if (a && typeof a === 'object') {
    const o = {};
    for (const k of Object.keys(a)) o[k] = k in b ? mixValue(a[k], b[k], f) : a[k];
    return o;
  }
  return f < 0.5 ? a : b;
}

/** Evaluate keyframes [{t, ...values}] at time t with smooth easing between keys. */
export function sampleKeys(keys, t) {
  if (t <= keys[0].t) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t < b.t) return mixValue(a, b, easeInOut((t - a.t) / (b.t - a.t)));
  }
  return keys[keys.length - 1];
}

export const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
