import * as THREE from 'three';
import { duneHeight } from './world/terrain-fn.js';
import { clamp, lerp, smoothstep, easeOutCubic, hash1 } from './core/util.js';
import { V, aim, clear, sightline, onGround, crestX, ridgePath, findBasin, flight, ahead, wormBody, easeIn, easeInOut } from './rig.js';

// =============================================================================
// The storyboard (docs/02-storyboard.md) as code: a list of CUTS, each pinned
// to a bar. A cut is { id, name, start, init?(ctx), frame(ctx) } and lasts
// until the next cut. frame(ctx) may only read ctx.t / ctx.sim / ctx.music
// and data built in init(), so every frame can be rendered on its own.
// It sets the camera and fills ctx (see director.js for every field).
//
// Musical rules used throughout:
//   - cuts land on downbeats (CUT_LEAD before the bar) and follow the riff:
//     part A changes picture every 2 or 4 bars, part B every 1 or 2 bars
//   - every kick does something visible (a ring, a lens punch, a hop)
//   - snares gust the sand off the crests, hats/cymbals glint
//   - section edges, fills and stops get their own moment (flash, burst, freeze)
// =============================================================================

const CUT_LEAD = 0.06;

export function buildShots(m) {
  const B = (n) => m.barTime(n) - CUT_LEAD;
  const barOf = (t) => m.barAt(t + CUT_LEAD).bar;
  const since = (t, t0, decay) => (t >= t0 ? Math.exp(-(t - t0) / decay) : 0);
  const beatEnv = (t, decay = 0.15) => { const b = m.beatAt(t); return b.index >= 0 ? Math.exp(-(t - b.start) / decay) : 0; };
  const cuts = [];
  const cut = (id, name, start, frame, init) => cuts.push({ id, name, start, frame, init });

  // ---- walking: a footfall on every kick, but the body moves continuously -----
  // Progress is an integer at each hit (0 at the first after `from`), linear in
  // between, then averaged over ~0.7 s so the walker never surges. Cameras follow
  // an even smoother, slightly lagging anchor so they don't lock onto each step.
  const STEP = 0.75;
  const rawSteps = (t, from, kind = 'kick') => {
    if (t <= from) return 0;
    const h = m.hits[kind];
    const i0 = m.hitCount(kind, from), i1 = m.hitCount(kind, t);
    if (i1 <= i0) return 0;
    const tPrev = h[i1 - 1][0];
    const tNext = i1 < h.length ? h[i1][0] : tPrev + 0.6;
    return i1 - i0 - 1 + clamp((t - tPrev) / clamp(tNext - tPrev, 0.12, 1.1));
  };
  const steps = (t, from, kind = 'kick', win = 0.7) => {
    let sum = 0;
    for (let k = -3; k <= 3; k++) sum += rawSteps(t + (k / 6) * win, from, kind);
    return sum / 7;
  };
  const walker = (path, t, from, s0 = 0, extra = {}) => {
    const st = steps(t, from);
    const speed = (steps(t + 0.15, from) - steps(t - 0.15, from)) / 0.3;
    const p = path(s0 + st * STEP);
    return { x: p.x, z: p.z, heading: p.heading, step: st, walk: clamp(speed / 1.2), ...extra };
  };
  /** Smooth, lagging ground point that follows the walker (camera anchor). */
  const follow = (path, t, from, s0 = 0) => {
    let sum = 0;
    for (let k = 0; k < 8; k++) sum += steps(t - 0.2 - k * 0.2, from, 'kick', 1.0);
    const p = path(s0 + (sum / 8) * STEP);
    return onGround(p.x, p.z);
  };
  const footAt = (path, hit, from, s0 = 0) => {
    const k = hit.i - m.hitCount('kick', from);
    const p = path(s0 + k * STEP);
    const side = k % 2 ? 0.13 : -0.13;
    return [p.x - p.dir[1] * side, p.z + p.dir[0] * side, p.heading];
  };
  const footprints = (path, t, from, s0 = 0) => {
    const i1 = m.hitCount('kick', t), i0 = m.hitCount('kick', from);
    const out = [];
    for (let i = Math.max(i0, i1 - 24); i < i1; i++) out.push([...footAt(path, { i }, from, s0), 1]);
    return out;
  };
  /** A walker on `path` with footprints and a booming ring per footfall. */
  const walkOn = (c, path, from, s0 = 0, { ring = 1.2, extra = {} } = {}) => {
    const w = walker(path, c.t, from, s0, extra);
    c.walker = w;
    c.feet = footprints(path, c.t, from, s0);
    c.rings = (h) => (h.t >= from ? (() => { const f = footAt(path, h, from, s0); return [f[0], f[1], h.w * ring]; })() : null);
    const W = onGround(w.x, w.z);
    const fwd = V(-Math.sin(w.heading), 0, -Math.cos(w.heading));
    return { w, W, fwd, A: follow(path, c.t, from, s0) };
  };
  /** Path through ground points [[x, z], ...] by arc length -> { x, z, heading, dir }. */
  const polyPath = (pts) => {
    const seg = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      const l = Math.hypot(x1 - x0, z1 - z0);
      seg.push({ x0, z0, dx: (x1 - x0) / l, dz: (z1 - z0) / l, l, s0: total });
      total += l;
    }
    return (s) => {
      const sc = clamp(s, 0, total - 1e-3);
      const g = seg.find((q) => sc < q.s0 + q.l) || seg[seg.length - 1];
      const u = sc - g.s0;
      return { x: g.x0 + g.dx * u, z: g.z0 + g.dz * u, heading: Math.atan2(-g.dx, -g.dz), dir: [g.dx, g.dz] };
    };
  };

  // ---- the thumper: slams on every beat --------------------------------------
  const thumpLift = (t) => {
    const ph = m.beatAt(t).phase;
    return ph < 0.8 ? easeOutCubic(ph / 0.8) : 1 - easeIn((ph - 0.8) / 0.2);
  };

  // ---- lightning on the storm stabs ----------------------------------------
  const lightning = (t, extra = []) => {
    let f = 0;
    for (const [a] of m.events.stops) if (a > 236 && a < 256) f = Math.max(f, since(t, a - 0.02, 0.09) + 0.6 * since(t, a + 0.11, 0.07));
    for (const a of extra) f = Math.max(f, since(t, a, 0.12));
    return f;
  };

  // ---- places ------------------------------------------------------------------
  const RIDGE = ridgePath(0, 0, 6000);              // the walker's crest (part A)
  const WALK_FROM = B(8);
  const BASIN = findBasin(4200, -4200);              // flat hardpan for noon, thumper, approach
  const basinPath = (s) => ({ x: BASIN.x, z: BASIN.z + 260 - s, heading: 0, dir: [0, -1] });

  // ============================ INTRO: guitar alone ============================
  let zI, xI, hI;
  cut('02a', 'Blue hour: crane up over a crest, guitar notes lift grains', 0, (c) => {
    const u = clamp(c.t / B(3));
    const x = xI - 46 + 34 * u, z = zI;
    const y = Math.max(hI - 7 + 34 * easeInOut(u), duneHeight(x, z) + 1.4);
    aim(c.camera, V(x, y, z), V(xI + 1600, hI - 12 + 14 * u, zI - 160), 34);
    c.post.fade = smoothstep(0.15, 3.2, c.t);
    c.drift = { uGust: 0.4 + c.snareEnv * 1.6, uOpacity: 0.65 };
    c.dust = { uOpacity: 0.25 };
    c.motes = { uOpacity: 0.25 };
    c.focus = 6;
    c.punch = 0;
  }, () => { zI = -700; xI = crestX(0, zI); hI = duneHeight(xI, zI); });

  let RA;
  cut('02b', 'Macro along a knife-edge crest, sand streaming off it', B(3), (c) => {
    const s = 4 + c.local * 1.3;
    const p = RA(s), q = RA(s + 22);
    const g = duneHeight(p.x, p.z);
    aim(c.camera, V(p.x - 2.0, g + 0.85, p.z), V(q.x + 5, duneHeight(q.x, q.z) + 0.6, q.z), 32);
    c.drift = { uBox: [120, 30, 120], uGust: 0.6 + c.snareEnv * 2.2, uOpacity: 0.95, uSize: 0.03 };
    c.motes = { uOpacity: 0.45 };
    c.focus = 8;
    c.punch = 0;
  }, () => { RA = ridgePath(0, -1400, 300); });

  // the walker waits at the start of his crest through the intro
  const START = RIDGE(0);
  const SW = () => onGround(START.x, START.z);
  let xC;
  cut('02c', 'Long lens: a figure waits on a crest against the dawn, the title forms', B(5), (c) => {
    const W = SW();
    const cp = V(xC + c.local * 0.6, 0, START.z + 40);
    cp.y = clear(cp.x, cp.z, 6, 20);
    aim(c.camera, cp, W.clone().add(V(0, 2.4, 0)), 6.5);
    c.walker = { x: START.x, z: START.z, heading: START.heading, step: 0, walk: 0, carry: true };
    c.post.title = smoothstep(m.barTime(5), m.barTime(6) - 0.3, c.t);
    c.drift = { uGust: 0.3 + c.snareEnv * 1.4 };
    c.punch = 0;
  }, () => { xC = START.x - 330; });

  cut('02d', 'Closing in on him; the title blows away', B(7), (c) => {
    const W = SW();
    const d = lerp(46, 9, easeInOut(c.u));
    aim(c.camera, W.clone().add(V(-d, 1.2 + d * 0.06, d * 0.3)), W.clone().add(V(0, 1.6, 0)), lerp(24, 30, c.u));
    c.walker = { x: START.x, z: START.z, heading: START.heading, step: 0, walk: 0, carry: true };
    c.post.title = 1;
    c.post.titleDissolve = smoothstep(B(7) + 0.1, B(8) - 0.3, c.t);
    c.drift = { uGust: 0.5 + 1.2 * c.u + c.snareEnv, uOpacity: 0.5 };
    c.shake = 0.05 + 0.15 * easeIn(c.u);
    c.punch = 0;
  });

  // ====================== BAR 8: THE BAND COMES IN =============================
  cut('03', 'Bar 8: sunrise, and his first step sends a giant ring across the desert', B(8), (c) => {
    const { W } = walkOn(c, RIDGE, WALK_FROM, 0, { extra: { carry: true } });
    const first = m.hitCount('kick', B(8));
    const f0 = footAt(RIDGE, { i: first }, WALK_FROM);
    c.rings = (h) => (h.i === first ? [f0[0], f0[1], 3.0] : h.t >= WALK_FROM ? (() => { const f = footAt(RIDGE, h, WALK_FROM); return [f[0], f[1], h.w * 1.3]; })() : null);
    c.ringShape = [120, 9, 2.2, 0.3];
    c.ringLife = 7;
    const u = easeInOut(c.u);
    const S = SW();
    aim(c.camera, S.clone().add(V(-16 - 30 * u, 6 + 34 * u, 20 + 40 * u)), S.clone().add(V(60, -6, -120)), 46);
    c.post.flash = 0.5 * since(c.t, m.barTime(8), 0.25);
    c.shake = 0.6 * since(c.t, m.barTime(8), 1.6) + c.kickEnv * 0.1;
    c.drift = { uGust: 1.2 + c.snareEnv };
    void W;
  });

  // ========================= A1: first steps (bars 10-16) ======================
  const walkCut = (c) => walkOn(c, RIDGE, WALK_FROM, 0, { extra: { carry: true } });
  cut('04a', 'Walker in silhouette on the crest, each step booms', B(10), (c) => {
    const { W, A, fwd } = walkCut(c);
    aim(c.camera, A.clone().add(V(-30, 3.2, 6)), W.clone().add(V(0, 1.5, 0)).addScaledVector(fwd, 2), 22);
    c.ringShape = [16, 1.3, 0.28, 1.0];
  });
  cut('04b', 'Low behind the walker: the footprint trail leads away from us', B(12), (c) => {
    const { W, A, fwd } = walkCut(c);
    const cp = A.clone().addScaledVector(fwd, -8).add(V(0.6, 0, 0));
    cp.y = duneHeight(cp.x, cp.z) + 0.6;
    aim(c.camera, cp, W.clone().add(V(0, 1.0, 0)).addScaledVector(fwd, 4), 30);
    c.ringShape = [6, 0.45, 0.07, 1.4];
    c.dust = { uBox: [16, 3, 16], uSize: 0.008, uOpacity: 0.8 };
    c.motes = { uOpacity: 0.5 };
    c.focus = 8;
  });
  cut('04c', 'Drone descends over the crest, a trail of rings', B(14), (c) => {
    const { A, fwd } = walkCut(c);
    aim(c.camera, A.clone().add(V(0.01, lerp(34, 10, easeInOut(c.u)), 0)).addScaledVector(fwd, -4), A.clone().addScaledVector(fwd, 6), 42);
    c.ringShape = [11, 1.0, 0.2, 0.9];
    c.ringLife = 4;
  });
  cut('04d', 'Front, low, the sun behind the hood', B(16), (c) => {
    const { W, A, fwd } = walkCut(c);
    aim(c.camera, A.clone().addScaledVector(fwd, 6).add(V(-24, 1.1, 0)), W.clone().add(V(0, 1.7, 0)), 17);
    c.ringShape = [16, 1.3, 0.28, 1.0];
    c.rays = { strength: 0.9 };
  });

  // ======================== A2: the drum field (bars 17-32) ====================
  let fly1;
  cut('05a', 'Low flight into the sun, rings drop ahead', B(17), (c) => {
    const f = fly1(c.t);
    aim(c.camera, f.pos, f.pos.clone().addScaledVector(f.dir, 100).add(V(0, -13, 0)), 50, f.roll);
    c.rings = (h) => [...ahead(f.pos, f.dir, h.i, 120, 520, 220, hash1), h.w * 1.3];
    c.ringShape = [170, 13, 2.4, 0.5];
    c.drift = { uGust: 0.6 + c.snareEnv * 1.5 };
    c.glint = Math.min(1, c.hatEnv * 1.4);
    c.shake = c.kickEnv * 0.2;
  }, () => { fly1 = flight({ t0: B(17), t1: B(21) + 1, x: 600, z: -4000, heading: Math.PI / 2, turns: [0, 0.22, -0.3, 0.18], period: 16 * 60 / 105 / 4, speed: 72, height: 15 }); });

  cut('05b', 'Long ridge from the side, the walker, each step a pulse', B(21), (c) => {
    const { W, A } = walkOn(c, RIDGE, WALK_FROM, 0, { ring: 1.4, extra: { carry: true } });
    const x = A.x - 110, z = A.z + 80 - 20 * c.local;
    aim(c.camera, V(x, clear(x, z, 22, 30), z), W.clone().add(V(0, 3, -25)), 22);
    c.ringShape = [40, 3.5, 0.8, 0.6];
    c.ringLife = 5;
  });

  // 05c: over the edge. From a crest he walks down the slip face (+x); every
  // beat a sheet of sand slides off the crest above him.
  let slipPath, crestAv;
  cut('05c', 'Over the edge: down a slip face, sand avalanching on every beat', B(25), (c) => {
    const { W, A } = walkOn(c, slipPath, B(25), 0, { ring: 0.8, extra: { carry: true } });
    const { x, z, h } = crestAv;
    const cp = A.clone().add(V(17, 0, 7));
    cp.y = duneHeight(cp.x, cp.z) + 1.3;
    aim(c.camera, cp, A.clone().lerp(W, 0.5).add(V(-6, 3.5, 0)), 36);
    const curve = [];
    for (let i = 0; i < 16; i++) {
      const zz = z - 60 + i * 8;
      const xx = crestX(x, zz, 20);
      curve.push([xx, duneHeight(xx, zz), zz, 0.5]);
    }
    c.pour = { curve, uOpacity: 0.3 + 0.7 * beatEnv(c.t, 0.45), uSize: 0.45 };
    c.drift = { uGust: 0.8 + c.snareEnv * 1.5 };
    c.ringShape = [10, 1.2, 0.18, 1.0];
    c.shake = c.kickEnv * 0.08;
    void h;
  }, () => {
    const z = -5200, x = crestX(800, z);
    crestAv = { x, z, h: duneHeight(x, z) };
    slipPath = polyPath([[x - 3, z + 2], [x + 140, z - 6]]);
  });

  // ============ the dead worm: a skeleton half buried in a trough ============
  let SK, spinePath;
  const skeletonOn = (c, drift = 1) => { c.skeleton = { drift }; };   // drift: how much sand lies against the ribs
  cut('05d', 'From above: a giant skeleton in the dunes ahead, kicks fall like rain', B(29), (c) => {
    skeletonOn(c);
    const mid = SK.mid;
    const a = 0.3 + c.local * 0.035;
    const dive = easeIn(smoothstep(B(32), B(33), c.t));
    const g = duneHeight(mid.x, mid.z);
    const y = g + lerp(520, 110, dive);
    aim(c.camera, V(mid.x - 40 * dive, y, mid.z + 60 * dive), V(mid.x + Math.cos(a) * 25, g, mid.z + Math.sin(a) * 25), 50);
    const tail = spinePath(0);
    c.walker = { x: tail.x - 60, z: tail.z + 40, heading: tail.heading, step: steps(c.t, B(29)), walk: 1, carry: true };
    c.rings = (h) => [mid.x + (hash1(h.i * 3) - 0.5) * 760, mid.z + (hash1(h.i * 3 + 1) - 0.5) * 460, h.w * (m.a.bars[barOf(h.t) - 1]?.kicks > 5 ? 1.8 : 1.2)];
    c.ringShape = [80, 7, 2.2, 0.42];
    c.ringLife = 5;
    c.drift = { uOpacity: 0.3 };
  }, (ctx) => {
    // find a long trough: start east of the walker's crest, follow the lowest line south
    const z0 = -7400;
    const xc = crestX(1400, z0);
    let xt = xc, low = 1e9;
    for (let dx = 60; dx < 420; dx += 4) { const hh = duneHeight(xc + dx, z0); if (hh < low) { low = hh; xt = xc + dx; } }
    const spine = [];
    for (let k = 0; k <= 8; k++) {
      const zz = z0 - k * 40;
      let bx = xt, bl = 1e9;
      for (let dx = -50; dx <= 50; dx += 2) { const hh = duneHeight(xt + dx, zz); if (hh < bl) { bl = hh; bx = xt + dx; } }
      xt = bx;
      spine.push([bx, zz]);
    }
    ctx.director.skel.build({ spine, sink: 7, radius: 24 });
    spinePath = polyPath(spine);
    const midP = spinePath(150);
    let len = 0;
    for (let i = 1; i < spine.length; i++) len += Math.hypot(spine[i][0] - spine[i - 1][0], spine[i][1] - spine[i - 1][1]);
    SK = { mid: onGround(midP.x, midP.z), len };
  });

  // ===================== A3: inside the skeleton (bars 33-48) ==================
  cut('06a', 'Under the ribs in the haze; light flickers through the bones', B(33), (c) => {
    skeletonOn(c);
    const { W, A, fwd } = walkOn(c, spinePath, B(33), 40, { ring: 0.9, extra: { carry: true } });
    const cp = A.clone().addScaledVector(fwd, 26).add(V(7, 0, 0));
    cp.y = duneHeight(cp.x, cp.z) + 1.4;
    aim(c.camera, cp, W.clone().add(V(0, 4, 0)), 34);
    c.ringShape = [14, 1.2, 0.25, 1.0];
    c.rays = { strength: 1.1 };
    c.drift = { uGust: 0.3 };
  });
  cut('06b', 'Sand pours through the vertebrae on every beat', B(36), (c) => {
    skeletonOn(c);
    const p = spinePath(95), q = spinePath(115);
    const P = onGround(p.x, p.z);
    aim(c.camera, P.clone().add(V(-16, 3, 4)), onGround(q.x, q.z).add(V(0, 8, 0)), 34);
    const curve = [];
    for (let i = 0; i < 16; i++) { const r = spinePath(80 + i * 3); curve.push([r.x, duneHeight(r.x, r.z) + 9, r.z, 2.5]); }
    c.pour = { curve, uOpacity: 0.25 + 0.75 * beatEnv(c.t, 0.4), uSize: 0.3 };
    c.ringShape = [10, 1, 0.15, 1];
  });
  cut('06c', 'Beneath the jaw: the walker under a ring of teeth', B(37), (c) => {
    skeletonOn(c);
    const { W, A } = walkOn(c, spinePath, B(37), 270, { ring: 0.9, extra: { carry: true } });
    const sk = c.director.skel.skull;
    const cp = A.clone().add(V(-5 + c.u * 3, 0, 9));
    cp.y = duneHeight(cp.x, cp.z) + 0.7;
    aim(c.camera, cp, sk.position.clone().lerp(W, 0.35).add(V(0, 6, 0)), 46);
    c.ringShape = [14, 1.2, 0.25, 1.0];
    c.rays = { strength: 1.0 };
  });
  cut('06d', 'He stops and waits in the haze', B(39), (c) => {
    skeletonOn(c);
    const p = spinePath(300);
    c.walker = { x: p.x, z: p.z, heading: p.heading + 0.6, step: 0, walk: 0, carry: true };
    const W = onGround(p.x, p.z);
    const fwd = V(-Math.sin(p.heading), 0, -Math.cos(p.heading));
    const cp = W.clone().addScaledVector(fwd, -(34 - c.local * 2)).add(V(6, 0, 0));
    cp.y = clear(cp.x, cp.z, 1.6, 6);
    sightline(cp, W.clone().add(V(0, 1.2, 0)));   // the trough has humps: keep him in view
    aim(c.camera, cp, W.clone().add(V(0, 5, 0)), 32);
    c.drift = { uGust: 0.2 };
  });
  // bar 40: the cymbals crash back in, the wind tears the sand off the bones
  cut('06e', 'Bar 40: wind tears the sand off the bones; the whole skeleton revealed', B(40), (c) => {
    skeletonOn(c, 1 - 0.7 * smoothstep(B(40), B(40) + 4, c.t));
    const mid = SK.mid;
    const u = easeOutCubic(c.u);
    const p = spinePath(300);
    c.walker = { x: p.x, z: p.z, heading: p.heading + 0.6, step: 0, walk: 0, carry: true, brace: 0.6 };
    aim(c.camera, mid.clone().add(V(-150 - 160 * u, 30 + 140 * u, 110 + 120 * u)), mid.clone().add(V(0, 10, -40)), 44);
    c.post.flash = 0.35 * since(c.t, m.barTime(40), 0.3);
    c.drift = { uGust: 1.0 + 2.2 * since(c.t, m.barTime(40), 2.5) + c.snareEnv, uOpacity: 0.75, uSize: 0.4 };
    const curve = [];
    for (let i = 0; i < 16; i++) { const r = spinePath(20 + i * 18); curve.push([r.x, duneHeight(r.x, r.z) + 14, r.z, 12]); }
    c.pour = { curve, uOpacity: 0.6 * (0.4 + since(c.t, m.barTime(40), 3)), uSize: 0.9 };
    c.rings = (h) => [mid.x + (hash1(h.i) - 0.5) * 300, mid.z + (hash1(h.i + 7) - 0.5) * 300, h.w * 1.4];
    c.ringShape = [90, 8, 2.0, 0.5];
    c.glint = Math.min(1, c.hatEnv * 1.5);
    c.shake = 0.25 * since(c.t, m.barTime(40), 1.2) + c.kickEnv * 0.12;
  });
  cut('06f', 'He walks out of the jaws, the skeleton behind him', B(44), (c) => {
    skeletonOn(c, 0.3);
    const sk = c.director.skel.skull;
    // from just inside the head end, through the jaw ring (~7 m past it) and out
    const exit = (s) => { const p = spinePath(SK.len - 2); return { x: p.x + s * 0.2, z: p.z - s, heading: Math.atan2(-0.2, 1), dir: [0.2, -1] }; };
    const { W, A } = walkOn(c, exit, B(44), 0, { ring: 1.3, extra: { carry: true } });
    const cp = A.clone().add(V(9, 0, -34 + c.local * 1.2));
    cp.y = clear(cp.x, cp.z, 1.8, 6);
    sightline(cp, W.clone().add(V(0, 1.2, 0)));
    aim(c.camera, cp, W.clone().lerp(sk.position, 0.3).add(V(0, 3, 0)), 36);
    c.ringShape = [24, 2.0, 0.4, 0.8];
  });

  cut('06g', 'Fill: dive onto a crest', B(48), (c) => {
    const x0 = crestX(5200, -2600), z0 = -2600;
    const g = duneHeight(x0, z0);
    const d = easeIn(c.u);
    aim(c.camera, V(x0 - lerp(260, 8, d), g + lerp(140, 4, d), z0 + lerp(120, 4, d)), V(x0 + 40, g - lerp(60, 6, d), z0 - 20), lerp(40, 55, d));
    c.drift = { uGust: 1 + c.snareEnv * 1.5 };
    c.shake = 0.15 * d;
  });

  // ========================= A4: noon (bars 49-64) =============================
  const STAKE_BAR = 57;
  const stopT = () => m.barTime(56);
  const basinWalker = (t) => {
    const w = walker(basinPath, Math.min(t, stopT()), B(49));
    // he carries the thumper on his back until he plants it on bar 57
    return { ...w, walk: t < stopT() ? w.walk : 0, carry: t < m.barTime(STAKE_BAR) - 0.3 };
  };
  const stakeAt = () => { const w = basinWalker(stopT()); return { x: w.x + 1.1, z: w.z - 1.2 }; };
  cut('07a', 'Heat: across the basin on a long lens, rings run over the hardpan', B(49), (c) => {
    const w = basinWalker(c.t);
    c.walker = w;
    c.feet = footprints(basinPath, c.t, B(49));
    c.rings = (h) => { const f = footAt(basinPath, h, B(49)); return [f[0], f[1], h.w * 1.5]; };
    c.ringShape = [22, 2.0, 0.4, 0.7];
    c.ringLife = 5;
    const W = onGround(w.x, w.z), A = follow(basinPath, c.t, B(49));
    const cp = A.clone().add(V(-420, 0, 60));
    cp.y = duneHeight(cp.x, cp.z) + 2.0;
    aim(c.camera, cp, A.clone().lerp(W, 0.5).add(V(0, 1.4, 0)), 8);
    c.focus = 0;
  });
  cut('07b', 'Tracking the walker, who stops on the fill', B(53), (c) => {
    const w = basinWalker(c.t);
    c.walker = w;
    c.feet = footprints(basinPath, Math.min(c.t, stopT()), B(49));
    c.rings = (h) => (h.t < stopT() ? (() => { const f = footAt(basinPath, h, B(49)); return [f[0], f[1], h.w * 1.3]; })() : null);
    c.ringShape = [18, 1.6, 0.35, 0.8];
    const W = onGround(w.x, w.z), A = follow(basinPath, Math.min(c.t, stopT() + 0.8), B(49));
    aim(c.camera, A.clone().add(V(-9, 1.6, -7)), W.clone().add(V(0, 1.3, 0)), 30);
  });
  const stakeCut = (c) => {
    const w = basinWalker(c.t);
    c.walker = { ...w, heading: w.heading + 0.5 };
    c.feet = footprints(basinPath, stopT(), B(49));
    const s = stakeAt();
    const drive = easeOutCubic(clamp((c.t - (m.barTime(STAKE_BAR) - 0.25)) / 0.25));
    c.stake = { x: s.x, z: s.z, sink: 1.4 * (1 - drive), lift: c.t > m.barTime(STAKE_BAR) ? thumpLift(c.t) : 1 };
    c.ringHits = 'beat';
    c.rings = (h) => (h.t >= m.barTime(STAKE_BAR) - 0.05 ? [s.x, s.z, 1.5] : null);
    c.ringShape = [24, 2.2, 0.55, 0.55];
    c.ringLife = 4.5;
    c.post.flash = 0.45 * since(c.t, m.barTime(STAKE_BAR), 0.2);
    return { s, W: onGround(w.x, w.z) };
  };
  cut('07c', 'Bar 57: the thumper goes in and slams every beat', B(STAKE_BAR), (c) => {
    const { s } = stakeCut(c);
    const a = -2.2 + c.u * 1.4;
    const S = onGround(s.x, s.z);
    aim(c.camera, S.clone().add(V(Math.cos(a) * 15, 3.2, Math.sin(a) * 15)), S.clone().add(V(0, 1.4, 0)), 34);
    c.shake = 0.15 * since(c.t, m.barTime(STAKE_BAR), 1.0);
  });
  cut('07d', 'One bar each: rings from above, the hammer, the basin, the grains', B(61), (c) => {
    const { s } = stakeCut(c);
    const S = onGround(s.x, s.z);
    const k = barOf(c.t) - 61;
    if (k === 0) aim(c.camera, S.clone().add(V(0.01, 70, 0)), S, 42);
    else if (k === 1) aim(c.camera, S.clone().add(V(-1.6, 1.1, 1.0)), S.clone().add(V(0, 1.7, 0)), 34);
    else if (k === 2) aim(c.camera, S.clone().add(V(-130, 1.6, 40)), S.clone().add(V(0, 1.5, 0)), 20);
    else {
      aim(c.camera, S.clone().add(V(-1.5, 0.25, 0.6)), S.clone().add(V(0.8, 0.05, -0.5)), 38);
      c.dust = { uBox: [6, 1.5, 6], uSize: 0.004, uGust: Math.min(1.5, beatEnv(c.t, 0.2) * 2), uOpacity: 0.9 };
      c.focus = 1.2;
    }
  });

  // ===================== A5: something listens (bars 65-72) ====================
  const MOUND_FROM = B(65);
  const moundA5 = (t) => {
    const k = (t - MOUND_FROM) * 9;
    const x = BASIN.x + 300, z = BASIN.z - 160 + k;
    const h = 13 + 8 * m.curve('lowmid', t);
    return [[x, z, h, 45], [x + 12, z - 70, h * 0.6, 38], [x + 20, z - 140, h * 0.35, 30], [x + 26, z - 210, h * 0.2, 24]];
  };
  // a dust plume streaming off the top of a moving mound
  const moundPlume = ([mx, mz, mh, mr], opacity = 0.5) => {
    const curve = [];
    for (let i = 0; i < 16; i++) {
      const zz = mz - mr * 1.2 + i * (mr * 2.4 / 15);
      curve.push([mx, duneHeight(mx, zz) + mh * Math.exp(-Math.pow((zz - mz) / mr, 2)), zz, 1.0]);
    }
    return { curve, uOpacity: opacity, uSize: 3.0 };
  };
  const thumperOn = (c) => {
    const s = stakeAt();
    c.stake = { x: s.x, z: s.z, sink: 0, lift: thumpLift(c.t) };
    const w = basinWalker(c.t);
    c.walker = { ...w, heading: -Math.PI / 2 + 0.3 };
    c.feet = footprints(basinPath, stopT(), B(49));
    return { s, W: onGround(w.x, w.z) };
  };
  cut('08a', 'Colour drains; far away a mound moves', B(65), (c) => {
    const { W } = thumperOn(c);
    c.mounds = moundA5(c.t);
    const [mx0, mz0] = c.mounds[0];
    // over the walker's shoulder toward the mound; he and the thumper sit in the right third
    const M = V(mx0 - 40, duneHeight(mx0, mz0) + 5, mz0 + 30);
    const d = W.clone().sub(M).setY(0).normalize();
    aim(c.camera, W.clone().addScaledVector(d, 9).add(V(d.z * 1.5, 1.7, -d.x * 1.5)), M, 26);
    c.pour = moundPlume(c.mounds[0], 0.35);
    c.ringHits = 'beat';
    const s = stakeAt();
    c.rings = (h) => [s.x, s.z, 0.8];
    c.ringShape = [24, 2.2, 0.4, 0.7];
  });
  cut('08b', 'The mound on a long lens, sand sliding off it', B(69), (c) => {
    const { W } = thumperOn(c);
    const ms = moundA5(c.t);
    c.mounds = ms;
    const [mx, mz, mh] = ms[0];
    const g = duneHeight(mx, mz);
    const cam = W.clone().add(V(-3, 2.4, -7));
    aim(c.camera, cam, V(mx, g + mh * 0.6, mz), lerp(11, 8, c.u));
    const curve = [];
    for (let i = 0; i < 16; i++) {
      const zz = mz - 90 + i * 12;
      curve.push([mx, duneHeight(mx, zz) + mh * Math.exp(-Math.pow((zz - mz) / 45, 2)), zz, 1.5]);
    }
    c.pour = { curve, uOpacity: 0.6, uSize: 2.6 };
    c.look.fog = 0.0007;
    c.rings = (h) => [mx, mz, h.w];
    c.ringShape = [40, 5, 0.9, 0.8];
  });

  // ================== BREAK (bars 73-74): everything hangs =====================
  cut('09', 'Break: the drums stop, the grains hang in the air', B(73), (c) => {
    const { W } = thumperOn(c);
    if (c.t > 167.3) c.stake.lift = thumpLift(167.3);
    const d = lerp(9, 4.2, easeInOut(c.u));
    aim(c.camera, W.clone().add(V(-d, 1.6, -d * 0.45)), W.clone().add(V(0, 1.5, 0)), lerp(30, 26, c.u));
    c.dust = { uHover: smoothstep(167.0, 168.0, c.t), uBox: [14, 4, 14], uSize: 0.018, uOpacity: 1.0 };
    c.drift = { uOpacity: 0.3 };
    c.motes = { uOpacity: 0.6 };
    c.focus = 2.0;
    c.punch = 0;
  });

  // ================= B1: 87.5 BPM, no bass (bars 75-77) ========================
  cut('10', 'Grains drop on the downbeat; time-lapse to late afternoon', B(75), (c) => {
    const { W } = thumperOn(c);
    c.stake.lift = 1;
    const a = -2.0 + easeInOut(c.u) * 2.0;
    aim(c.camera, W.clone().add(V(Math.cos(a) * 26, 4, Math.sin(a) * 26)), W.clone().add(V(0, 1.2, 0)), 34);
    c.dust = { uHover: 1 - smoothstep(170.5, 170.9, c.t), uBox: [40, 6, 40], uSize: 0.012, uOpacity: 0.7 };
    c.ripple = 1 + Math.min(1, c.hatEnv) * 1.2;
    c.glint = Math.min(1, c.hatEnv * 1.5);
    c.punch = 0;
  });

  // ============ B2: stop-and-go, the mound moves only with the bass ============
  const bassActive = (t, from) => {
    let s = t - from;
    for (const [a, b] of m.events.bass_out) if (b > from && a < t) s -= Math.min(t, b) - Math.max(a, from);
    return Math.max(0, s);
  };
  const approach = (t) => {
    const W = basinWalker(t);
    const d0 = 560 - 48 * bassActive(Math.min(t, B(83)), B(78));
    const d = t < B(83) ? d0 : d0 - (d0 - 150) * easeIn(clamp((t - B(83)) / (B(86) - B(83))));
    const x = W.x + Math.max(d, 150), z = W.z - 20;
    const on = !m.inEvent('bass_out', t);
    const h = 14 + (on ? 7 : 0) + 8 * clamp((t - B(83)) / (B(86) - B(83)));
    return { x, z, h, on, W };
  };
  const moundOf = (a) => [[a.x, a.z, a.h, 42], [a.x + 80, a.z + 4, a.h * 0.6, 36], [a.x + 160, a.z + 8, a.h * 0.35, 30], [a.x + 240, a.z + 12, a.h * 0.2, 26]];
  const b2 = (c) => {
    const { W } = thumperOn(c);
    c.stake.lift = 1;
    const a = approach(c.t);
    c.mounds = moundOf(a);
    c.pour = moundPlume(c.mounds[0], a.on ? 0.7 : 0.2);
    c.rings = (h) => [a.x, a.z, h.w * 1.3];
    c.ringShape = [55, 5, 1.1, 0.8];
    c.shake = a.on ? 0.1 + c.kickEnv * 0.25 : 0;
    c.punch = a.on ? 0.8 : 0;
    return { W, a };
  };
  cut('11a', 'Walker listening, very still', B(78), (c) => {
    const { W } = b2(c);
    aim(c.camera, W.clone().add(V(-2.6, 1.7, 1.4)), W.clone().add(V(0, 1.66, 0)), 26);
    c.focus = 2.8;
  });
  cut('11b', 'Bass in: the mound surges toward us', B(79), (c) => {
    const { W, a } = b2(c);
    aim(c.camera, W.clone().add(V(-6, 1.2, 2)), V(a.x, duneHeight(a.x, a.z) + 6, a.z), 24);
  });
  cut('11c', 'Bass out: the walker moves off-rhythm', B(80), (c) => {
    const { W } = b2(c);
    // walking away without rhythm: steps on the hats, not the kicks
    const st = steps(c.t, B(80), 'hat', 0.5);
    c.walker = { ...c.walker, x: c.walker.x - st * 0.45, step: st, walk: 1, heading: Math.PI / 2 };
    const P = onGround(c.walker.x, c.walker.z);
    aim(c.camera, W.clone().add(V(-5, 0.4, 3.5)), P.clone().add(V(0, 0.5, 0)), 30);
  });
  cut('11d', 'From above: the mound and its wake close in', B(81), (c) => {
    const { W, a } = b2(c);
    aim(c.camera, W.clone().add(V(-60, 110, 120)), V((W.x + a.x) / 2, W.y, W.z), 40);
  });
  cut('11e', 'The walker braces', B(82), (c) => {
    const { W, a } = b2(c);
    c.walker = { ...c.walker, brace: 1 };
    aim(c.camera, W.clone().add(V(-4, 1.0, -3)), V(a.x, duneHeight(a.x, a.z) + 8, a.z), 30);
  });
  cut('12', 'B3: the mound accelerates, the ground heaves', B(83), (c) => {
    const { W, a } = b2(c);
    c.walker = { ...c.walker, brace: 1 };
    const back = lerp(8, 40, easeInOut(c.u));
    aim(c.camera, W.clone().add(V(-back, 1.5 + back * 0.12, 6)), V(a.x, duneHeight(a.x, a.z) + 10, a.z), lerp(30, 42, c.u));
    c.mounds = [...moundOf(a), [a.x - 90, a.z + 60, 4 * c.u, 30], [a.x - 90, a.z - 60, 4 * c.u, 30]];
    c.drift = { uGust: 1 + 2 * c.u, uOpacity: 0.8 };
    c.shake = 0.15 + 0.5 * c.u + c.kickEnv * 0.3;
  });

  // ============================ BAR 86: BREACH ==================================
  cut('13', 'Breach: the worm bursts out of the ground, mouth toward us', B(86), (c) => {
    const bw = basinWalker(c.t);
    const W = onGround(bw.x, bw.z);
    const { x: ax, z: az } = approach(B(86));
    const g = duneHeight(ax - 60, az);
    const rise = easeOutCubic(clamp((c.t - m.barTime(86)) / 1.4));
    const H = V(ax - 50 - 30 * rise, g + 8 + 40 * rise, az - 4);
    const T = V(ax + 170, g - 70, az + 10), C = V(ax + 30, g + 8 + 58 * rise, az + 4);
    const pts = [];
    for (let k = 0; k <= 14; k++) {
      const u = k / 14;
      pts.push(V((1 - u) * (1 - u) * T.x + 2 * (1 - u) * u * C.x + u * u * H.x, (1 - u) * (1 - u) * T.y + 2 * (1 - u) * u * C.y + u * u * H.y, (1 - u) * (1 - u) * T.z + 2 * (1 - u) * u * C.z + u * u * H.z));
    }
    c.worm = { points: pts, open: easeOutCubic(clamp((c.t - m.barTime(86)) / 1.0)), flex: Math.min(1, c.kickEnv), pour: { uOpacity: 0.8, uSize: 0.5 } };
    const s = stakeAt();
    c.stake = { x: s.x, z: s.z, sink: 0, lift: 1 };
    c.walker = { ...bw, heading: -Math.PI / 2, brace: 1 };
    aim(c.camera, W.clone().add(V(-9, 0.9, 5)), H.clone().add(V(0, -4, 0)), 40);
    c.rings = (h) => (h.t >= m.barTime(86) - 0.08 ? [ax - 70, az, 2.2] : null);
    c.ringShape = [90, 12, 2.6, 0.5];
    c.ringLife = 5;
    c.dust = { uGust: 2.5 * since(c.t, m.barTime(86), 1.5) + 0.5, uBox: [300, 80, 300], uSize: 0.15, uOpacity: 0.7 };
    c.drift = { uGust: 2.5, uOpacity: 0.9 };
    c.post.flash = 0.55 * since(c.t, m.barTime(86), 0.25);
    c.shake = 0.9 * since(c.t, m.barTime(86), 1.5) + c.kickEnv * 0.3;
  });

  // ======================== B4: riding the drum (bars 87-98) ===================
  const RIDE_FROM = B(87);
  const SPEED = 28;
  const wormPath = (s) => ({ x: 6200 + Math.sin(s * 0.0035) * 160, z: -12000 - s, heading: 0, dir: [0, -1] });
  const sHeadAt = (t) => 300 + (t - RIDE_FROM) * SPEED;
  const ride = (c, { rise = 14 } = {}) => {
    const sH = sHeadAt(c.t);
    const pts = wormBody(wormPath, sH, 280, rise);
    c.worm = { points: pts, flex: Math.min(1, c.snareEnv), open: 0.35, pour: { uOpacity: 0.45 } };
    const rp = wormPath(sH - 45);
    const top = duneHeight(rp.x, rp.z) - 22 * 0.45 + 22 * 1.04;
    c.walker = { x: rp.x, z: rp.z, y: top, heading: 0, step: 0, brace: 0.6 };
    c.wind = [0, 26];
    c.rings = (h) => { const p = wormPath(sH - 30 - hash1(h.i) * 160); return [p.x + (hash1(h.i + 3) - 0.5) * 50, p.z, h.w * 1.6]; };
    c.ringShape = [55, 4.5, 1.0, 0.8];
    const head = wormPath(sH);
    c.mounds = [[head.x - 26, head.z - 10, 7, 18], [head.x + 26, head.z - 10, 7, 18]];
    c.drift = { uGust: 1.2 + c.snareEnv, uOpacity: 0.7, uWind: [0, 0, 14] };
    c.shake = 0.12 + c.kickEnv * 0.2;
    return { R: V(rp.x, top, rp.z), H: onGround(head.x, head.z), sH };
  };
  cut('14a', 'Side tracking: the walker rides the worm into the sun', B(87), (c) => {
    const { R } = ride(c);
    aim(c.camera, R.clone().add(V(-80, -6, 6)), R.clone().add(V(0, 2, -14)), 32);
  });
  cut('14b', 'Head-on and low: the worm ploughs toward us', B(89), (c) => {
    const { H } = ride(c, { rise: 18 });
    const cam = H.clone().add(V(-30, 3, -150 + (c.t - B(89)) * 6));
    cam.y = duneHeight(cam.x, cam.z) + 3;
    aim(c.camera, cam, H.clone().add(V(0, 14, 0)), 30);
  });
  cut('14c', 'From above: the wake and its rings', B(91), (c) => {
    const { R } = ride(c);
    aim(c.camera, R.clone().add(V(-30, 130, 160)), R.clone().add(V(0, 0, -80)), 44);
  });
  cut('14d', 'Close on the rider, cloak whipping', B(93), (c) => {
    const { R } = ride(c);
    aim(c.camera, R.clone().add(V(-4.5, 0.6, -3.5)), R.clone().add(V(0, 1.7, 0)), 34);
  });
  cut('14e', 'Long lens: a speck on the worm against the sun', B(95), (c) => {
    const { R } = ride(c);
    const cam = R.clone().add(V(-340, 0, 40));
    cam.y = clear(cam.x, cam.z, 10, 30);
    aim(c.camera, cam, R.clone().add(V(0, 8, -30)), 22);
    c.look.sunAzim = 84;
    c.look.sunElev = 3.0;
  });
  let wallZ0;
  cut('14f', 'Low fast chase; a storm wall rises ahead', B(97), (c) => {
    const { R } = ride(c);
    const cam = R.clone().add(V(-55, 0, 90));
    cam.y = clear(cam.x, cam.z, 6, 12);
    aim(c.camera, cam, R.clone().add(V(10, 4, -160)), 50);
    const z = lerp(wallZ0, R.z - 300, smoothstep(B(97), B(99), c.t));
    c.stormWall = [0, -1, -z, lerp(80, 420, smoothstep(B(97), B(99), c.t))];
  }, () => { wallZ0 = wormPath(sHeadAt(B(97))).z - 2600; });

  // =========================== B5: storm (bars 99-105) ==========================
  cut('15a', 'Bar 99: the wall hits', B(99), (c) => {
    const { R } = ride(c, { rise: 10 });
    aim(c.camera, R.clone().add(V(-12, 4, 18)), R.clone().add(V(0, 6, -80)), 50);
    const z = R.z - 300 + 330 * clamp((c.t - B(99)) / 0.6);
    c.stormWall = c.t < B(99) + 0.6 ? [0, -1, -z, 420] : null;
    c.stormFx = { uOpacity: 0.7 * smoothstep(B(99), B(99) + 0.8, c.t) };
    c.post.flash = 0.25 * since(c.t, m.barTime(99), 0.3);
  });
  cut('15b', 'Inside the storm: lightning on the stabs', B(100), (c) => {
    const { R } = ride(c, { rise: 12 });
    aim(c.camera, R.clone().add(V(-60, 8, 30)), R.clone().add(V(0, 0, -40)), 36);
    const l = lightning(c.t);
    c.post = { flash: l * 0.75, flashColor: [0.8, 0.88, 1.0] };
    c.exposure = 1 + l * 1.5;
  });
  cut('15c', 'Bar 102: the worm rears up in a flash', B(102), (c) => {
    const { R } = ride(c, { rise: 12 + 70 * easeOutCubic(clamp((c.t - m.barTime(102)) / 1.2)) });
    aim(c.camera, R.clone().add(V(-120, 4, 60)), R.clone().add(V(0, 30, -60)), 42);
    const l = lightning(c.t, [m.barTime(102)]);
    c.post = { flash: l * 0.85, flashColor: [0.8, 0.88, 1.0] };
    c.exposure = 1 + l * 1.5;
    c.shake = 0.3 + c.kickEnv * 0.3;
  });
  cut('15d', 'The rider braced against the sand', B(103), (c) => {
    const { R } = ride(c, { rise: 12 });
    c.walker = { ...c.walker, brace: 1 };
    aim(c.camera, R.clone().add(V(-3.2, 1.0, 2.6)), R.clone().add(V(0, 1.6, -1)), 36);
    const l = lightning(c.t);
    c.post = { flash: l * 0.75, flashColor: [0.8, 0.88, 1.0] };
    c.exposure = 1 + l * 1.5;
  });

  // ========================= eye of the storm (106-107) ========================
  cut('16a', 'Bar 106: still in the storm', B(106), (c) => {
    const { R } = ride(c, { rise: 12 });
    aim(c.camera, R.clone().add(V(-30, 3, 25)), R.clone().add(V(0, 4, -40)), 40);
  });
  // the calm starts exactly where the bass drops out (just before bar 107)
  const CALM = (m.events.bass_out.find(([a0]) => a0 > 256 && a0 < 259) || [257.64])[0];
  cut('16b', 'Bass out: sudden calm, the sky opens to two moons', CALM - CUT_LEAD, (c) => {
    const { R } = ride(c, { rise: 8 });
    c.worm.flex = 0;
    const tilt = easeInOut(clamp((c.t - CALM - 0.2) / 2.6));
    aim(c.camera, R.clone().add(V(-8, 2, 6)), R.clone().add(V(-40 * tilt, lerp(2, 70, tilt), -60)), 44);
    c.drift = { uOpacity: 0.3, uGust: 0 };
    c.shake = 0;
    c.punch = 0;
  });

  // ======================== B6: night drum (bars 108-122) =======================
  const night = (c) => {
    c.ringGlow = [0.12, 0.35, 1.0].map((v) => v * 1.8);
    c.spice = { uGlow: 1.5 + 2.5 * Math.min(1, c.kickEnv), uOpacity: 0.6 + 0.4 * Math.min(1, c.kickEnv) };
    c.drift = { uOpacity: 0.25 };
    c.dust = { uOpacity: 0.25 };
  };
  let fly108;
  cut('17a', 'Moonlit flight: every kick a ring of light', B(108), (c) => {
    night(c);
    const f = fly108(c.t);
    aim(c.camera, f.pos, f.pos.clone().addScaledVector(f.dir, 100).add(V(0, -16, 0)), 48, f.roll);
    c.rings = (h) => [...ahead(f.pos, f.dir, h.i, 120, 520, 240, hash1), h.w * 1.4];
    c.ringShape = [140, 9, 2.0, 0.45];
    c.shake = c.kickEnv * 0.15;
  }, () => { fly108 = flight({ t0: B(108), t1: B(112) + 1, x: 9000, z: -15000, heading: Math.PI, turns: [0, 0.4, -0.6, 0.4], period: 2 * 4 * 60 / 87.5, speed: 64, height: 26 }); });

  let NX, NZ;
  cut('17b', 'The walker on a crest under the moons; the worm circles below', B(112), (c) => {
    night(c);
    const W = onGround(NX, NZ);
    c.walker = { x: NX, z: NZ, heading: Math.PI * 0.85, step: 0 };
    const a = c.local * 0.35;
    const wx = NX + 140 * Math.cos(a), wz = NZ + 140 * Math.sin(a);
    c.mounds = [[wx, wz, 7, 26], [NX + 140 * Math.cos(a - 0.35), NZ + 140 * Math.sin(a - 0.35), 4, 22]];
    c.rings = (h) => [wx, wz, h.w * 1.6];
    c.ringShape = [60, 5, 1.0, 0.55];
    aim(c.camera, W.clone().add(V(3 - c.u * 4, 0.7, 11)), W.clone().add(V(-1.5, 3.6, -10)), 36);
  }, () => { NZ = -16800; NX = crestX(9300, NZ); });

  cut('17c', 'Stop: blackout, then the biggest ring of all', B(116), (c) => {
    night(c);
    const [a, b] = m.events.stops.find(([s]) => s > 280 && s < 286) || [283.24, 283.6];
    const firstAfter = m.hitCount('kick', b);
    const g = duneHeight(NX, NZ);
    const rise = easeInOut(clamp((c.t - b) / 2.2));
    aim(c.camera, V(NX - 200, g + lerp(30, 180, rise), NZ + 200), V(NX, g, NZ), 50);
    c.walker = { x: NX, z: NZ, heading: Math.PI * 0.85, step: 0 };
    c.rings = (h) => (h.i === firstAfter ? [NX, NZ, 4] : h.t < a ? [NX + 100, NZ, h.w] : [NX + (hash1(h.i) - 0.5) * 300, NZ + (hash1(h.i + 1) - 0.5) * 300, h.w * 1.4]);
    c.ringShape = [120, 10, 2.4, 0.35];
    c.ringLife = 6;
    if (c.t >= a - 0.02 && c.t < b) c.post.fade = 0;
    c.post.flash = 0.4 * since(c.t, b + 0.02, 0.3);
  });

  cut('17d', 'High above: the whole dune sea pulses with light', B(117), (c) => {
    night(c);
    const g = duneHeight(NX, NZ);
    const a = c.local * 0.04;
    aim(c.camera, V(NX, g + 650 - c.local * 8, NZ), V(NX + Math.cos(a) * 30, g, NZ + Math.sin(a) * 30), 56);
    c.rings = (h) => [NX + (hash1(h.i * 5) - 0.5) * 900, NZ + (hash1(h.i * 5 + 1) - 0.5) * 520, h.w * 2];
    c.ringShape = [110, 9, 2.4, 0.38];
    c.ringLife = 6;
    c.spice = null;
  });

  let fly120;
  cut('17e', 'Climax: flying toward the moons', B(120), (c) => {
    night(c);
    const f = fly120(c.t);
    aim(c.camera, f.pos, f.pos.clone().addScaledVector(f.dir, 100).add(V(0, -6, 0)), 50, f.roll);
    c.rings = (h) => [...ahead(f.pos, f.dir, h.i, 100, 450, 220, hash1), h.w * 1.6];
    c.ringShape = [150, 10, 2.2, 0.45];
    c.shake = c.kickEnv * 0.2;
  }, () => { fly120 = flight({ t0: B(120), t1: B(123) + 1, x: 11000, z: -19000, heading: Math.PI * 1.08, turns: [0, -0.3, 0.3], period: 2 * 4 * 60 / 87.5, speed: (l) => 60 + l * 5, height: 22 }); });

  // =================== B7: the worm dives (bars 123-125) ========================
  cut('18', 'Dawn bleeds in; the worm dives in slow motion', B(123), (c) => {
    const x0 = 12000, z0 = -22000;
    const g = duneHeight(x0, z0);
    const dive = easeInOut(clamp((c.t - B(123)) / (B(126) - B(123))));
    const pts = [];
    for (let k = 0; k <= 14; k++) {
      const a = Math.PI * (0.08 + 0.84 * (k / 14)) + dive * 1.15;
      pts.push(V(x0 + Math.cos(a) * 170, g - 50 + Math.sin(a) * 160, z0 + (k - 7) * 5));
    }
    c.worm = { points: pts, open: 0.2, pour: { uOpacity: 0.9, uSize: 0.5 } };
    aim(c.camera, V(x0 - 40, clear(x0 - 40, z0 + 360, 8, 30), z0 + 360), V(x0 + 20, g + 60, z0), 42);
    c.drift = { uGust: 1.2, uOpacity: 0.6 };
    c.rings = (h) => [x0 + 170 * Math.cos(Math.PI * 0.08 + dive * 1.15), z0, h.w * 2];
    c.ringShape = [70, 8, 2, 0.6];
    c.spice = { uOpacity: 0.5 * (1 - c.u) };
  });

  // ==================== final hits (bars 126-127) ================================
  cut('19', 'Final hits: from above, each hit throws a giant ring out of the dive site', B(126), (c) => {
    const x0 = 12000 + 170 * Math.cos(Math.PI * 0.08 + 1.15), z0 = -22000;
    const g = duneHeight(x0, z0);
    const u = easeOutCubic(c.u);
    aim(c.camera, V(x0 + 30, g + lerp(170, 460, u), z0 + 30), V(x0, g, z0), 52);
    const first = m.hitCount('kick', B(126));
    c.rings = (h) => (h.t >= B(126) - 0.05 ? [x0, z0, 1.4 + 0.5 * (h.i - first)] : null);
    c.ringShape = [120, 9, 2.8, 0.32];
    c.ringLife = 6;
    c.post.flash = 0.22 * Math.min(1, c.kickEnv);
    c.drift = { uGust: 1 + c.snareEnv, uOpacity: 0.45, uSize: 0.4 };
    c.shake = c.kickEnv * 0.2;
  });

  // ============================== ring-out =====================================
  cut('20', 'Ring-out: dawn, a lone figure, the title, fade', 314.64, (c) => {
    const w = RIDGE(2600);
    const W = onGround(w.x, w.z);
    c.walker = { x: w.x, z: w.z, heading: -Math.PI / 2, step: 0 };
    aim(c.camera, W.clone().add(V(-190 + c.local * 3, 22, 70)), W.clone().add(V(60, 10, 0)), 28);
    c.drift = { uOpacity: 0.5, uGust: Math.max(0, 1 - c.local * 0.5) };
    c.post.title = smoothstep(315.6, 317.6, c.t);
    c.post.fade = 1 - smoothstep(319.2, 321.2, c.t);
    c.punch = 0;
  });

  return cuts.map((s, i) => ({ ...s, end: cuts[i + 1] ? cuts[i + 1].start : m.duration }));
}
