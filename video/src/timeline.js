import * as THREE from 'three';
import { duneHeight } from './world/terrain-fn.js';
import { clamp, lerp, smoothstep, easeInOut, easeOutCubic, hash1 } from './core/util.js';

// =============================================================================
// The storyboard (docs/02-storyboard.md) as code. One entry per shot:
//   { id, name, start, end, init?(ctx), frame(ctx) }
// frame(ctx) must only read ctx.t / ctx.sim / ctx.music, never stored state,
// so every frame can be rendered on its own. It sets the camera and fills
// ctx.{walker, stake, worm, rings, ringShape, mounds, dust, spice, post, ...}.
// See director.js for the defaults.
//
// STATUS: first pass, every shot is blocked in. Refine shot by shot
// (docs/04-handoff.md has the list).
// =============================================================================

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const CUT_LEAD = 0.06; // cut a hair before the downbeat so the first kick lands on the new shot

function aim(cam, pos, target, fov = 40, roll = 0) {
  cam.position.copy(pos);
  cam.up.set(0, 1, 0);
  cam.lookAt(target);
  if (roll) cam.rotateZ(roll);
  if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
}

/** Ground + h, never lower than the highest ground within r metres. */
function clear(x, z, h, r = 25) {
  let g = -1e9;
  for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) g = Math.max(g, duneHeight(x + dx, z + dz));
  return g + h;
}

/** Follow a dune crest along -z from near (x0, z0). Returns s(m) -> { x, z, heading }. */
function ridgePath(x0, z0, length) {
  const step = 2;
  let x = x0, bh = -1e9;
  for (let dx = -150; dx <= 150; dx += 1) {
    const h = duneHeight(x0 + dx, z0);
    if (h > bh) { bh = h; x = x0 + dx; }
  }
  const pts = [];
  for (let s = 0; s <= length; s += step) {
    const z = z0 - s;
    let bx = x; bh = -1e9;
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
    return { x: lerp(a[0], b[0], u), z: lerp(a[1], b[1], u), heading: Math.atan2(-(b[0] - a[0]), -(b[1] - a[1])) };
  };
}

/** Continuous step count since `from`: +1 per kick, eased over 0.3 s. */
function steps(m, t, from) {
  const n = m.hitCount('kick', t) - m.hitCount('kick', from);
  if (n <= 0) return 0;
  const last = m.recentHits('kick', t, 1).pop();
  const frac = last ? easeOutCubic(clamp(last.age / 0.3)) : 1;
  return n - 1 + frac;
}

/**
 * Precomputed flight over the dunes: heading changes by turns[k] every
 * `period` seconds, altitude follows the terrain with look-ahead + smoothing.
 * Returns t -> { pos, dir, roll }.
 */
function flight({ t0, t1, x, z, heading, turns, period, speed, height }) {
  const dt = 1 / 25;
  const n = Math.ceil((t1 - t0) / dt) + 2;
  const hd = (t) => {
    let h = heading;
    turns.forEach((d, k) => (h += d * smoothstep(k * period, k * period + period * 0.6, t - t0)));
    return h;
  };
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = t0 + i * dt;
    const a = hd(t);
    pts.push({ x, z, a });
    x += Math.sin(a) * speed * dt;
    z += -Math.cos(a) * speed * dt;
  }
  // terrain-following altitude: max ground over the next 1.5 s, then smoothed
  const look = Math.round(1.5 / dt);
  const raw = pts.map((p, i) => {
    let g = -1e9;
    for (let j = i; j < Math.min(pts.length, i + look); j += 3) g = Math.max(g, duneHeight(pts[j].x, pts[j].z));
    return g + height;
  });
  const win = 25;
  const ys = raw.map((_, i) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - win); j < Math.min(raw.length, i + win); j++) { s += Math.max(raw[j], raw[i] - 2); c++; }
    return s / c;
  });
  return (t) => {
    const f = clamp((t - t0) / dt, 0, n - 2.001);
    const i = Math.floor(f), u = f - i;
    const p0 = pts[i], p1 = pts[i + 1];
    const pos = V(lerp(p0.x, p1.x, u), lerp(ys[i], ys[i + 1], u), lerp(p0.z, p1.z, u));
    const a = lerp(p0.a, p1.a, u);
    const turnRate = (hd(t + 0.2) - hd(t - 0.2)) / 0.4;
    return { pos, dir: V(Math.sin(a), 0, -Math.cos(a)), roll: -turnRate * 0.35 };
  };
}

/** Ring centre scattered in front of the camera, stable per hit index. */
function ringAhead(pos, dir, i, near, far, spread) {
  const d = lerp(near, far, hash1(i * 7 + 1));
  const lat = (hash1(i * 7 + 2) - 0.5) * 2 * spread;
  return [pos.x + dir.x * d - dir.z * lat, pos.z + dir.z * d + dir.x * lat];
}

/** Worm body points (tail -> head) along a ground path; head raised by `rise` (m). */
function wormBody(path, sHead, length, rise, radius = 22, sink = 0.45) {
  const pts = [];
  const N = 14;
  for (let k = 0; k <= N; k++) {
    const s = sHead - length * (1 - k / N);
    const p = path(s);
    const g = duneHeight(p.x, p.z);
    const lift = rise * Math.pow(k / N, 3);
    pts.push(V(p.x, g - radius * sink + lift, p.z));
  }
  return pts;
}

export function buildShots(m) {
  const B = (n) => m.barTime(n) - CUT_LEAD;
  const end = m.duration;
  const shots = [];
  const add = (s) => shots.push(s);

  // Walker world: a long crest that runs along -z near the origin.
  const ridge = ridgePath(0, 0, 4000);
  const WALK_FROM = B(8);
  const STEP = 0.85;
  const walkerAt = (t, from = WALK_FROM, s0 = 0) => {
    const st = steps(m, t, from);
    const p = ridge(s0 + st * STEP);
    return { ...p, step: st };
  };
  const footAt = (hit, from = WALK_FROM, s0 = 0) => {
    const k = hit.i - m.hitCount('kick', from);
    return ridge(s0 + Math.max(0, k) * STEP);
  };

  // ---------------------------------------------------------------- 01 + 02
  add({
    id: '02', name: 'Intro: pre-dawn, guitar lifts grains, title', start: 0, end: B(8),
    frame(c) {
      const x = -260 + c.t * 4.5, z = 30;
      const y = clear(x, z, 7, 40);
      aim(c.camera, V(x, y, z), V(x + 100, y - 6, z - 8), 38);
      c.dust = { uGust: c.snareEnv * 1.4, uOpacity: 0.45, uWind: [2 + 4 * m.curve('mid', c.t), 0.2, 0.5] };
      c.post.fade = smoothstep(0.1, 2.8, c.t);
      // title forms over bars 4-6 and is blown away during bar 7
      c.post.title = smoothstep(m.barTime(4), m.barTime(6), c.t);
      c.post.titleDissolve = smoothstep(m.barTime(7), m.barTime(8) - 0.2, c.t);
      c.glint = m.curve('high', c.t) * 0.3;
    },
  });

  // ---------------------------------------------------------------- 03
  add({
    id: '03', name: 'Band entry: sunrise + giant shockwave', start: B(8), end: B(10),
    frame(c) {
      const pos = V(-120 + c.local * 3, 0, 20);
      pos.y = clear(pos.x, pos.z, 26, 40);
      const fwd = V(1, 0, -0.05).normalize();
      aim(c.camera, pos, pos.clone().add(V(100, -14, -5)), 42);
      const first = m.hitCount('kick', B(8));
      c.rings = (h) => h.i === first
        ? [pos.x + 420, pos.z, 3.0]
        : [...ringAhead(pos, fwd, h.i, 120, 500, 220), h.w * 1.2];
      c.ringShape = [150, 14, 3.2, 0.45];
      c.ringLife = 5;
      c.shake = 0.2 + c.kickEnv * 0.6 * (1 - c.u);
      c.dust = { uGust: 0.6 + c.snareEnv };
    },
  });

  // ---------------------------------------------------------------- 04
  add({
    id: '04', name: 'A1 first steps: walker on the ridge, steps = kicks', start: B(10), end: B(17),
    frame(c) {
      const w = walkerAt(c.t);
      c.walker = { x: w.x, z: w.z, heading: w.heading, step: w.step };
      const W = V(w.x, duneHeight(w.x, w.z), w.z);
      const sub = Math.floor((m.barAt(c.t + CUT_LEAD).bar - 10) / 2) % 4; // cut every 2 bars
      c.rings = (h) => { const f = footAt(h); return [f.x, f.z, h.w]; };
      if (sub === 1) {        // (b) macro on the boot
        aim(c.camera, W.clone().add(V(-2.6, 0.5, 1.2)), W.clone().add(V(0, 0.25, -0.6)), 30);
        c.ringShape = [5, 0.35, 0.05, 1.5];
        c.dust = { uBox: [12, 3, 12], uSize: 0.012, uGust: c.kickEnv * 0.5 };
      } else if (sub === 2) { // (c) top-down: line of footsteps
        aim(c.camera, W.clone().add(V(0.01, 45, 6)), W.clone().add(V(0, 0, -6)), 35);
        c.ringShape = [9, 0.9, 0.18, 1.0];
      } else {                // (a) wide side tracking against the sun
        aim(c.camera, W.clone().add(V(-34, 5, 10)), W.clone().add(V(0, 2.2, -2)), 34);
        c.ringShape = [16, 1.4, 0.3, 1.1];
      }
      c.shake = c.kickEnv * 0.05;
    },
  });

  // ---------------------------------------------------------------- 05
  let fly05;
  add({
    id: '05', name: 'A2 the drum field: flight over the dunes', start: B(17), end: B(33),
    init() {
      fly05 = flight({ t0: B(17), t1: B(33), x: 300, z: -400, heading: Math.PI * 0.42, turns: [0, -0.6, 0.9, -0.5, 0.4], period: 16 * 60 / 105, speed: 55, height: 38 });
    },
    frame(c) {
      const f = fly05(c.t);
      aim(c.camera, f.pos, f.pos.clone().add(f.dir.clone().multiplyScalar(100)).add(V(0, -22, 0)), 45, f.roll);
      c.rings = (h) => [...ringAhead(f.pos, f.dir, h.i, 90, 420, 160), h.w * 1.2];
      c.ringShape = [110, 10, 2.2, 0.6];
      c.dust = { uGust: c.snareEnv * 1.5, uWind: [8, 0, 2] };
      c.glint = Math.min(1, c.hatEnv * 1.5);
      c.shake = c.kickEnv * 0.15;
    },
  });

  // ---------------------------------------------------------------- 06
  add({
    id: '06', name: 'A3 singing dunes: Chladni plate, slip-face intercuts', start: B(33), end: B(49),
    frame(c) {
      const bar = m.barAt(c.t + CUT_LEAD);
      if ((bar.bar - 33) % 4 === 3) { // low angle on a vibrating slip face
        const x = 900 + (bar.bar - 33) * 40, z = -900;
        const pos = V(x, clear(x, z, 3, 10), z);
        aim(c.camera, pos, pos.clone().add(V(60, 8, -20)), 34);
        c.rings = (h) => [x + 40 + hash1(h.i) * 60, z - 20 + hash1(h.i + 9) * 40, h.w];
        c.ringShape = [25, 2.5, 0.5, 1.0];
        c.dust = { uGust: c.snareEnv * 1.2 };
        c.shake = c.kickEnv * 0.06;
        return;
      }
      c.scene = 'chladni';
      const ch = c.director.chladni;
      ch.setMode('uModeA', bar.bar - 1);
      ch.setMode('uModeB', bar.bar);
      const u = ch.uniforms;
      u.uMorph.value = easeOutCubic(clamp(bar.phase * 2.5));
      u.uSharp.value = 10 + 26 * clamp(bar.phase * 2) + 18 * Math.min(1, c.kickEnv);
      u.uKick.value = Math.min(1, c.kickEnv);
      u.uTime.value = c.sim;
      u.uRing.value = 0;
      u.uZoom.value = 1.0 + 0.15 * c.u;
      u.uRot.value = c.local * 0.01;
      c.post.saturation = 0.9;
    },
  });

  // ---------------------------------------------------------------- 07
  const STAKE_BAR = 57;
  const S07_S0 = 900;            // further along the ridge
  add({
    id: '07', name: 'A4 noon: heat, the stake throbs on every beat', start: B(49), end: B(65),
    frame(c) {
      const tStake = m.barTime(STAKE_BAR);
      const walking = c.t < tStake;
      const w = walkerAt(Math.min(c.t, tStake), B(49), S07_S0);
      const W = V(w.x, duneHeight(w.x, w.z), w.z);
      const fwd = V(-Math.sin(w.heading), 0, -Math.cos(w.heading));
      const stakeP = W.clone().add(fwd.clone().multiplyScalar(1.2));
      c.walker = { x: w.x, z: w.z, heading: w.heading, step: walking ? w.step : 0 };
      if (c.t >= tStake - 0.5) {
        const drive = easeOutCubic(clamp((c.t - (tStake - 0.5)) / 0.5));
        c.stake = { x: stakeP.x, z: stakeP.z, sink: 1.6 - 1.2 * drive, pulse: m.envelope('kick', c.t, 0.1) };
      }
      if (walking) {
        c.rings = (h) => { const f = footAt(h, B(49), S07_S0); return [f.x, f.z, h.w * 1.3]; };
        c.ringShape = [20, 1.8, 0.35, 1.0];
      } else {
        c.ringHits = 'beat';
        c.rings = () => [stakeP.x, stakeP.z, 1.4];
        c.ringShape = [24, 2.2, 0.55, 0.7];
        c.ringLife = 4;
      }
      const bar = m.barAt(c.t + CUT_LEAD).bar;
      const angle = bar >= 61 ? bar % 3 : Math.floor((bar - 49) / 4) % 2;
      if (angle === 0) aim(c.camera, W.clone().add(V(-48, 7, 18)), W.clone().add(V(0, 1.5, 0)), 30);
      else if (angle === 1) aim(c.camera, W.clone().add(V(-8, 2.2, -10)), W.clone().add(V(0, 1.2, 0)), 38);
      else aim(c.camera, W.clone().add(V(0.01, 70, 0)), W, 40);
      c.shake = c.kickEnv * 0.06;
    },
  });

  // ---------------------------------------------------------------- 08
  add({
    id: '08', name: 'A5 something listens: a mound moves far away', start: B(65), end: B(73),
    frame(c) {
      const w = walkerAt(m.barTime(STAKE_BAR), B(49), S07_S0);
      const W = V(w.x, duneHeight(w.x, w.z), w.z);
      c.walker = { x: w.x, z: w.z, heading: w.heading + Math.PI / 2, step: 0 };
      aim(c.camera, W.clone().add(V(-14, 3.5, 6)), W.clone().add(V(200, 4, -40)), 32);
      const k = c.local * 9;
      const mx = W.x + 380, mz = W.z + 300 - k;
      c.mounds = [[mx, mz, 6 + 5 * m.curve('lowmid', c.t), 26], [mx + 6, mz + 45, 4, 22], [mx + 10, mz + 90, 2.5, 18]];
      c.rings = (h) => [mx, mz, h.w * 0.6];
      c.ringShape = [30, 4, 0.6, 1.2];
    },
  });

  // ---------------------------------------------------------------- 09
  add({
    id: '09', name: 'Break: everything hangs in the air', start: B(73), end: B(75),
    frame(c) {
      const w = walkerAt(m.barTime(STAKE_BAR), B(49), S07_S0);
      const W = V(w.x, duneHeight(w.x, w.z), w.z);
      c.walker = { x: w.x, z: w.z, heading: w.heading + Math.PI / 2, step: 0 };
      const d = lerp(9, 2.4, easeInOut(c.u));
      aim(c.camera, W.clone().add(V(-d, 1.7, d * 0.4)), W.clone().add(V(0, 1.65, 0)), lerp(32, 26, c.u));
      c.dust = { uHover: smoothstep(167.3, 168.2, c.t), uBox: [40, 10, 40], uSize: 0.03, uOpacity: 0.8 };
    },
  });

  // ---------------------------------------------------------------- 10
  add({
    id: '10', name: 'B1 grains drop, time-lapse to late afternoon', start: B(75), end: B(78),
    frame(c) {
      const x = -1400, z = 600 - c.local * 2;
      const pos = V(x, clear(x, z, 4, 20), z);
      aim(c.camera, pos, pos.clone().add(V(100, -4, -30 + c.local * 3)), 36);
      c.dust = { uHover: 1 - smoothstep(0, 0.35, c.local), uWind: [6, 0, 1] };
      c.ripple = 1 + Math.min(1, c.hatEnv) * 1.5;
      c.glint = Math.min(1, c.hatEnv);
    },
  });

  // ---------------------------------------------------------------- 11 + 12
  // The mound only moves while the bass plays.
  const bassActive = (t, from) => {
    let s = t - from;
    for (const [a, b] of m.events.bass_out) if (b > from && a < t) s -= Math.min(t, b) - Math.max(a, from);
    return Math.max(0, s);
  };
  const S11_W = ridge(1300);
  add({
    id: '11', name: 'B2 approach: stop-and-go mound, walker freezes', start: B(78), end: B(83),
    frame(c) {
      const W = V(S11_W.x, duneHeight(S11_W.x, S11_W.z), S11_W.z);
      c.walker = { x: W.x, z: W.z, heading: S11_W.heading - 0.6, step: 0 };
      const prog = bassActive(c.t, B(78)) * 18;
      const mx = W.x + 320 - prog * 0.8, mz = W.z - 200 + prog * 0.5;
      c.mounds = [[mx, mz, 9, 28], [mx + 30, mz - 20, 6, 24], [mx + 60, mz - 40, 3, 20]];
      c.rings = (h) => [mx, mz, h.w];
      c.ringShape = [40, 4, 0.9, 1.0];
      const sub = (m.barAt(c.t + CUT_LEAD).bar - 78) % 3;
      if (sub === 0) aim(c.camera, W.clone().add(V(-20, 6, 12)), V(mx, duneHeight(mx, mz) + 5, mz), 34);
      else if (sub === 1) aim(c.camera, W.clone().add(V(-2.2, 0.4, 1.0)), W.clone().add(V(0, 0.3, -0.3)), 30);
      else aim(c.camera, W.clone().add(V(-4, 2.2, 3)), V(mx, duneHeight(mx, mz) + 10, mz), 40);
      c.shake = m.inEvent('bass_out', c.t) ? 0 : 0.08 + c.kickEnv * 0.1;
    },
  });
  add({
    id: '12', name: 'B3 build: mound accelerates, dunes buckle', start: B(83), end: B(86),
    frame(c) {
      const W = V(S11_W.x, duneHeight(S11_W.x, S11_W.z), S11_W.z);
      const prog0 = bassActive(B(83), B(78)) * 18;
      const prog = prog0 + Math.pow(c.local, 1.6) * 14;
      const mx = W.x + 320 - prog * 0.8, mz = W.z - 200 + prog * 0.5;
      c.walker = { x: W.x, z: W.z, heading: S11_W.heading - 0.6, step: 0 };
      c.mounds = [[mx, mz, 10 + c.u * 6, 30], [mx + 30, mz - 20, 7, 26]];
      c.rings = (h) => [mx, mz, h.w * 1.6];
      c.ringShape = [60, 6, 1.4, 0.8];
      const back = lerp(10, 60, easeInOut(c.u));
      aim(c.camera, W.clone().add(V(-back, 3 + back * 0.15, back * 0.4)), V(mx, duneHeight(mx, mz) + 6, mz), 38);
      c.shake = 0.1 + c.kickEnv * 0.2;
    },
  });

  // ---------------------------------------------------------------- 13 + 14
  // Worm path: long sweeping line across open dunes toward -z.
  const wormPath = (s) => {
    const z = -6000 - s;
    return { x: 2000 + Math.sin(s * 0.004) * 120, z };
  };
  const WORM_SPEED = 26;
  add({
    id: '13', name: 'Breach: the worm bursts out of the dune', start: B(86), end: B(87),
    frame(c) {
      const head = 0;
      const rise = 25 + 90 * easeOutCubic(clamp(c.local / 1.6));
      c.worm = { points: wormBody(wormPath, head + c.local * 6, 160, rise), flex: Math.min(1, c.kickEnv) };
      const hp = wormPath(head);
      const H = V(hp.x, duneHeight(hp.x, hp.z), hp.z);
      aim(c.camera, H.clone().add(V(-260, 25, 140)), H.clone().add(V(0, 70, 0)), 36);
      c.rings = () => [hp.x, hp.z, 3];
      c.ringShape = [80, 12, 3.5, 0.5];
      c.ringLife = 4;
      c.dust = { uGust: 2.5, uBox: [400, 80, 400], uSize: 0.2 };
      c.shake = 0.6 * (1 - c.u);
    },
  });
  add({
    id: '14', name: 'B4 riding the drum: walker rides the worm', start: B(87), end: B(99),
    frame(c) {
      const sHead = 6 + (c.t - B(87)) * WORM_SPEED + 40;
      c.worm = { points: wormBody(wormPath, sHead, 220, 14), flex: Math.min(1, c.snareEnv) };
      const rp = wormPath(sHead - 35);
      const R = V(rp.x, duneHeight(rp.x, rp.z) - 22 * 0.45 + 22 + 0.2, rp.z);
      c.walker = { x: rp.x, z: rp.z, y: R.y, heading: 0, step: 0 };
      c.rings = (h) => { const p = wormPath(sHead - 20 - hash1(h.i) * 120); return [p.x + (hash1(h.i + 3) - 0.5) * 40, p.z, h.w * 1.5]; };
      c.ringShape = [45, 4, 0.9, 0.9];
      c.dust = { uGust: 0.5 + m.curve('rms', c.t), uWind: [4, 0, 20] };
      const sub = Math.floor((m.barAt(c.t + CUT_LEAD).bar - 87) / 2) % 3;
      if (sub === 0) aim(c.camera, R.clone().add(V(-70, 6, 10)), R.clone().add(V(0, 0, -20)), 36);
      else if (sub === 1) aim(c.camera, R.clone().add(V(-8, 10, -160)), R, 30);
      else aim(c.camera, R.clone().add(V(-40, 120, 120)), R.clone().add(V(0, 0, -60)), 40);
      c.shake = 0.08 + c.kickEnv * 0.12;
    },
  });

  // ---------------------------------------------------------------- 15
  add({
    id: '15', name: 'B5 storm: lightning on the stabs', start: B(99), end: B(106),
    frame(c) {
      const sHead = 6 + (c.t - B(87)) * WORM_SPEED + 40;
      c.worm = { points: wormBody(wormPath, sHead, 220, 10), flex: Math.min(1, c.snareEnv) };
      const rp = wormPath(sHead - 35);
      const R = V(rp.x, duneHeight(rp.x, rp.z) + 12, rp.z);
      aim(c.camera, R.clone().add(V(-90, 14, 30)), R.clone().add(V(0, 0, -30)), 38);
      const stab = m.events.stops.some(([a, b]) => c.t >= a - 0.05 && c.t < b + 0.15);
      c.post = { flash: stab ? 0.7 : 0, flashColor: [0.85, 0.9, 1.0] };
      c.stormFx = { uWind: [50 + 30 * m.curve('mid', c.t), -2, 15] };
      c.rings = (h) => [rp.x, rp.z, h.w];
      c.ringShape = [45, 4, 0.8, 1.0];
    },
  });

  // ---------------------------------------------------------------- 16
  add({
    id: '16', name: 'Eye of the storm: night, two moons, stillness', start: B(106), end: B(108),
    frame(c) {
      const x = 2500, z = -9000;
      const pos = V(x, clear(x, z, 5, 20), z);
      const tilt = easeInOut(c.u);
      aim(c.camera, pos, pos.clone().add(V(-30, lerp(2, 40, tilt), -100)), 40);
      c.dust = { uOpacity: 0.25, uWind: [0.5, 0, 0] };
    },
  });

  // ---------------------------------------------------------------- 17
  let fly17;
  add({
    id: '17', name: 'B6 night drum: spice motes, the dune sea pulses', start: B(108), end: B(123),
    init() {
      fly17 = flight({ t0: B(108), t1: B(123), x: 2600, z: -9400, heading: Math.PI, turns: [0, 0.5, -0.8, 0.6, -0.4, 0.7, -0.5, 0.3, -0.6], period: 2 * 4 * 60 / 87.5, speed: 60, height: 34 });
    },
    frame(c) {
      const f = fly17(c.t);
      aim(c.camera, f.pos, f.pos.clone().add(f.dir.clone().multiplyScalar(100)).add(V(0, -18, 0)), 46, f.roll);
      const blackout = m.events.stops.find(([a]) => a > 280 && a < 285);
      const afterBlack = blackout && c.t >= blackout[1];
      c.rings = (h) => {
        const big = afterBlack && h.t >= blackout[1] && h.t < blackout[1] + 0.6;
        return [...ringAhead(f.pos, f.dir, h.i, 100, 450, 180), h.w * (big ? 4 : 1.3)];
      };
      c.ringShape = [120, 10, 2.4, 0.5];
      c.spice = { uGlow: 1.5 + 2.5 * Math.min(1, c.kickEnv), uOpacity: 0.6 + 0.4 * Math.min(1, c.kickEnv) };
      c.dust = { uOpacity: 0.3 };
      if (blackout && c.t >= blackout[0] - 0.02 && c.t < blackout[1]) c.post.fade = 0;
      c.shake = c.kickEnv * 0.15;
    },
  });

  // ---------------------------------------------------------------- 18
  add({
    id: '18', name: 'B7 the worm dives back into the sand', start: B(123), end: B(126),
    frame(c) {
      const hp = wormPath(30000);
      const dive = easeInOut(c.u);
      const pts = [];
      for (let k = 0; k <= 14; k++) {
        const a = Math.PI * (0.15 + 0.85 * (k / 14)) + dive * 1.2;
        pts.push(V(hp.x + Math.cos(a) * 150, duneHeight(hp.x, hp.z) - 40 + Math.sin(a) * 140, hp.z + (k - 7) * 6));
      }
      c.worm = { points: pts, flex: 0 };
      aim(c.camera, V(hp.x - 50, duneHeight(hp.x, hp.z) + 30, hp.z + 520), V(hp.x, duneHeight(hp.x, hp.z) + 60, hp.z), 40);
      c.dust = { uGust: 1.5 + m.curve('rms', c.t), uBox: [500, 120, 500], uSize: 0.3 };
      c.rings = (h) => [hp.x + 150 * Math.cos(Math.PI * 0.15 + dive * 1.2), hp.z, h.w * 2];
      c.ringShape = [70, 8, 2, 0.6];
      c.spice = { uOpacity: 0.5 * (1 - c.u) };
    },
  });

  // ---------------------------------------------------------------- 19
  add({
    id: '19', name: 'Final hits: the plate snaps into a drumhead', start: B(126), end: 314.64,
    frame(c) {
      c.scene = 'chladni';
      const ch = c.director.chladni;
      const n = m.hitCount('kick', c.t) - m.hitCount('kick', B(126));
      ch.setMode('uModeA', 40 + n - 1);
      ch.setMode('uModeB', 40 + n);
      const last = m.recentHits('kick', c.t, 2).pop();
      const u = ch.uniforms;
      u.uMorph.value = last ? easeOutCubic(clamp(last.age / 0.15)) : 1;
      u.uSharp.value = 18 + 40 * c.u;
      u.uKick.value = Math.min(1, c.kickEnv);
      u.uRing.value = smoothstep(0.55, 1.0, c.u);
      u.uZoom.value = 0.9;
      u.uRot.value = 0;
      u.uTime.value = c.sim;
    },
  });

  // ---------------------------------------------------------------- 20
  add({
    id: '20', name: 'Ring-out: dawn, lone figure, title, fade', start: 314.64, end,
    frame(c) {
      const w = ridge(2000);
      const W = V(w.x, duneHeight(w.x, w.z), w.z);
      c.walker = { x: w.x, z: w.z, heading: w.heading, step: 0 };
      aim(c.camera, W.clone().add(V(-160, 18, 60)), W.clone().add(V(0, 8, 0)), 30);
      c.dust = { uOpacity: 0.3, uGust: Math.max(0, 1 - c.local) };
      c.post.title = smoothstep(315.6, 317.6, c.t);
      c.post.fade = 1 - smoothstep(319.2, 321.2, c.t);
    },
  });

  return shots.map((s, i) => ({ ...s, end: shots[i + 1] ? shots[i + 1].start : end }));
}
