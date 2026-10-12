import * as THREE from 'three';
import { duneHeight, duneEnv } from './world/terrain-fn.js';
import { clamp, lerp, smoothstep, easeOutCubic } from './core/util.js';

// Camera and staging helpers for timeline.js. Everything here is a pure
// function of its inputs (or precomputed once from fixed inputs).

export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const easeIn = (x) => clamp(x) * clamp(x) * clamp(x);
export const easeInOut = (x) => smoothstep(0, 1, x);
export { easeOutCubic };

export function aim(cam, pos, target, fov = 40, roll = 0) {
  cam.position.copy(pos);
  cam.up.set(0, 1, 0);
  cam.lookAt(target);
  if (roll) cam.rotateZ(roll);
  if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
}

/** Ground + h, never lower than the highest ground within r metres. */
export function clear(x, z, h, r = 25) {
  let g = -1e9;
  for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) g = Math.max(g, duneHeight(x + dx, z + dz));
  return g + h;
}

/** Lift cam (a Vector3, in place) until its line of sight to `target` clears the dunes by `margin`. */
export function sightline(cam, target, margin = 0.6) {
  let y = cam.y;
  for (let k = 1; k <= 22; k++) {
    const f = k / 24;
    const x = cam.x + (target.x - cam.x) * f, z = cam.z + (target.z - cam.z) * f;
    y = Math.max(y, (duneHeight(x, z) + margin - target.y * f) / (1 - f));
  }
  cam.y = y;
  return cam;
}

export const ground = (x, z) => duneHeight(x, z);
export const onGround = (x, z, h = 0) => V(x, duneHeight(x, z) + h, z);

/** x of the highest crest within ±range of x0 along the line z. */
export function crestX(x0, z, range = 320) {
  let best = x0, bh = -1e9;
  for (let dx = -range; dx <= range; dx += 2) {
    const h = duneHeight(x0 + dx, z);
    if (h > bh) { bh = h; best = x0 + dx; }
  }
  for (let dx = -2; dx <= 2; dx += 0.1) {
    const h = duneHeight(best + dx, z);
    if (h > bh) { bh = h; best = best + dx; }
  }
  return best;
}

/** Follow a dune crest along -z from near (x0, z0). Returns s(m) -> { x, z, heading, dir }. */
export function ridgePath(x0, z0, length) {
  const step = 2;
  let x = crestX(x0, z0);
  const pts = [];
  for (let s = 0; s <= length; s += step) {
    const z = z0 - s;
    let bx = x, bh = -1e9;
    for (let dx = -3; dx <= 3; dx += 0.25) {
      const h = duneHeight(x + dx, z);
      if (h > bh) { bh = h; bx = x + dx; }
    }
    x = bx;
    pts.push([x, z]);
  }
  for (let k = 0; k < 4; k++) for (let i = 1; i < pts.length - 1; i++) pts[i][0] = (pts[i - 1][0] + 2 * pts[i][0] + pts[i + 1][0]) / 4;
  return (s) => {
    const f = clamp(s / step, 0, pts.length - 1.001);
    const i = Math.floor(f), u = f - i;
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    return { x: lerp(a[0], b[0], u), z: lerp(a[1], b[1], u), heading: Math.atan2(-dx, -dz), dir: [dx / l, dz / l] };
  };
}

/** Nearest point to (x0, z0) inside a wide flat basin (duneEnv ~ 0 all around). */
export function findBasin(x0, z0) {
  for (let r = 0; r < 20000; r += 150) {
    const n = Math.max(1, Math.round((2 * Math.PI * r) / 150));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
      if (duneEnv(x, z) > 0.01) continue;
      let ok = true;
      for (let j = 0; j < 8 && ok; j++) {
        const b = (j / 8) * Math.PI * 2;
        if (duneEnv(x + Math.cos(b) * 260, z + Math.sin(b) * 260) > 0.08) ok = false;
      }
      if (ok) return { x, z };
    }
  }
  return { x: x0, z: z0 };
}

/**
 * Precomputed flight over the dunes: heading changes by turns[k] every
 * `period` seconds; altitude follows the terrain with look-ahead + smoothing.
 * speed may be a number or a function of local time. Returns t -> { pos, dir, roll }.
 */
export function flight({ t0, t1, x, z, heading, turns = [], period = 4, speed, height }) {
  const dt = 1 / 25;
  const n = Math.ceil((t1 - t0) / dt) + 2;
  const hd = (t) => {
    let h = heading;
    turns.forEach((d, k) => (h += d * smoothstep(k * period, k * period + period * 0.7, t - t0)));
    return h;
  };
  const sp = typeof speed === 'function' ? speed : () => speed;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = t0 + i * dt;
    const a = hd(t);
    pts.push({ x, z, a });
    x += Math.sin(a) * sp(t - t0) * dt;
    z += -Math.cos(a) * sp(t - t0) * dt;
  }
  const look = Math.round(1.2 / dt);
  const raw = pts.map((p, i) => {
    let g = -1e9;
    for (let j = i; j < Math.min(pts.length, i + look); j += 2) g = Math.max(g, duneHeight(pts[j].x, pts[j].z));
    return g + height;
  });
  const win = 18;
  const ys = raw.map((_, i) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - win); j < Math.min(raw.length, i + win); j++) { s += Math.max(raw[j], raw[i] - 1.5); c++; }
    return s / c;
  });
  return (t) => {
    const f = clamp((t - t0) / dt, 0, n - 2.001);
    const i = Math.floor(f), u = f - i;
    const p0 = pts[i], p1 = pts[i + 1];
    const pos = V(lerp(p0.x, p1.x, u), lerp(ys[i], ys[i + 1], u), lerp(p0.z, p1.z, u));
    const a = lerp(p0.a, p1.a, u);
    const turnRate = (hd(t + 0.2) - hd(t - 0.2)) / 0.4;
    return { pos, dir: V(Math.sin(a), 0, -Math.cos(a)), roll: -turnRate * 0.3 };
  };
}

/** Point scattered in front of pos along dir, stable per index. */
export function ahead(pos, dir, i, near, far, spread, hash) {
  const d = lerp(near, far, hash(i * 7 + 1));
  const lat = (hash(i * 7 + 2) - 0.5) * 2 * spread;
  return [pos.x + dir.x * d - dir.z * lat, pos.z + dir.z * d + dir.x * lat];
}

/** Worm body points (tail -> head) along a ground path; head raised by `rise` (m). */
export function wormBody(path, sHead, length, rise, { radius = 22, sink = 0.45, N = 14 } = {}) {
  const pts = [];
  for (let k = 0; k <= N; k++) {
    const s = sHead - length * (1 - k / N);
    const p = path(s);
    const g = duneHeight(p.x, p.z);
    const lift = rise * Math.pow(k / N, 3);
    pts.push(V(p.x, g - radius * sink + lift, p.z));
  }
  return pts;
}
