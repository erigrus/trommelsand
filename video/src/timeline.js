import * as THREE from 'three';
import { duneHeight } from './world/terrain-fn.js';
import { clamp, lerp, smoothstep, easeOutCubic, hash1 } from './core/util.js';
import { V, aim, clear, onGround, crestX, ridgePath, findBasin, flight, ahead, wormBody, easeIn, easeInOut } from './rig.js';

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

  // ---- walking: one step per kick ------------------------------------------
  const STEP = 0.8;
  const steps = (t, from, kind = 'kick') => {
    const n = m.hitCount(kind, t) - m.hitCount(kind, from);
    if (n <= 0) return 0;
    const last = m.recentHits(kind, t, 1).pop();
    return n - 1 + (last ? easeOutCubic(clamp(last.age / 0.3)) : 1);
  };
  const walker = (path, t, from, s0 = 0, extra = {}) => {
    const st = steps(t, from);
    const p = path(s0 + st * STEP);
    return { x: p.x, z: p.z, heading: p.heading, step: st, ...extra };
  };
  const footAt = (path, hit, from, s0 = 0) => {
    const k = hit.i - m.hitCount('kick', from) + 1;
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

  let zW, xW, xC;
  cut('02c', 'Endless dunes, the title forms, a figure on the far ridge', B(5), (c) => {
    const g = duneHeight(xC, zW + 120);
    aim(c.camera, V(xC + c.local * 2.5, g + 14, zW + 120), V(xW + 900, duneHeight(xW, zW) + 6, zW - 40), 28);
    c.walker = { x: xW, z: zW, heading: -Math.PI / 2, step: 0 };
    c.post.title = smoothstep(m.barTime(5), m.barTime(6) - 0.3, c.t);
    c.drift = { uGust: 0.3 + c.snareEnv * 1.4 };
    c.punch = 0;
  }, () => { zW = -2200; xW = crestX(300, zW); xC = crestX(xW - 600, zW + 120); });

  cut('02d', 'Accelerating into the dawn, the title blows away', B(7), (c) => {
    const L = c.local;
    const x = xW - 420 + 18 * L + 26 * L * L, z = zW + 40;
    const y = clear(x, z, 8, 30);
    aim(c.camera, V(x, y, z), V(x + 300, y - 10 + 3 * L, z - 10), lerp(38, 50, easeIn(c.u)));
    c.post.title = 1;
    c.post.titleDissolve = smoothstep(B(7) + 0.1, B(8) - 0.3, c.t);
    c.drift = { uGust: 0.5 + 1.5 * c.u + c.snareEnv, uOpacity: 0.35 };
    c.shake = 0.08 + 0.3 * easeIn(c.u);
    c.punch = 0;
  });

  // ====================== BAR 8: THE BAND COMES IN =============================
  let zE, xE, hE;
  cut('03', 'Sunrise on the downbeat, one giant shockwave', B(8), (c) => {
    const pos = V(xE - 12 + c.local * 4, hE + 34, zE);
    aim(c.camera, pos, V(xE + 1500, hE - 34, zE + 30), 44);
    const first = m.hitCount('kick', B(8));
    c.rings = (h) => (h.i === first ? [xE + 1150, zE, 3.2] : [...ahead(pos, V(1, 0, 0), h.i, 250, 1300, 550, hash1), h.w * 1.1]);
    c.ringShape = [260, 24, 3.6, 0.28];
    c.ringLife = 7;
    c.post.flash = 0.5 * since(c.t, m.barTime(8), 0.25);
    c.shake = 0.7 * since(c.t, m.barTime(8), 1.8) + c.kickEnv * 0.15;
    c.drift = { uGust: 1.2 + c.snareEnv };
    c.dust = { uOpacity: 0.6 };
  }, () => { zE = -3000; xE = crestX(0, zE); hE = duneHeight(xE, zE); });

  // ========================= A1: first steps (bars 10-16) ======================
  const walkCut = (c) => {
    const w = walker(RIDGE, c.t, WALK_FROM);
    c.walker = w;
    c.feet = footprints(RIDGE, c.t, WALK_FROM);
    c.rings = (h) => { const f = footAt(RIDGE, h, WALK_FROM); return [f[0], f[1], h.w * 1.2]; };
    const W = onGround(w.x, w.z);
    const fwd = V(-Math.sin(w.heading), 0, -Math.cos(w.heading));
    return { w, W, fwd };
  };
  cut('04a', 'Walker in silhouette on the crest, each step booms', B(10), (c) => {
    const { W, fwd } = walkCut(c);
    aim(c.camera, W.clone().add(V(-30, 3.2, 6)), W.clone().add(V(0, 1.5, 0)).addScaledVector(fwd, 3), 22);
    c.ringShape = [16, 1.3, 0.28, 1.0];
  });
  cut('04b', 'Low behind the walker: the footprint trail leads away from us', B(12), (c) => {
    const { W, fwd } = walkCut(c);
    const cp = W.clone().addScaledVector(fwd, -7.5).add(V(0.6, 0, 0));
    cp.y = duneHeight(cp.x, cp.z) + 0.55;
    aim(c.camera, cp, W.clone().add(V(0, 1.0, 0)).addScaledVector(fwd, 4), 30);
    c.ringShape = [6, 0.45, 0.07, 1.4];
    c.dust = { uBox: [16, 3, 16], uSize: 0.008, uOpacity: 0.8 };
    c.motes = { uOpacity: 0.5 };
    c.focus = 7.5;
  });
  cut('04c', 'Drone descends over the crest, a trail of rings', B(14), (c) => {
    const { W, fwd } = walkCut(c);
    aim(c.camera, W.clone().add(V(0.01, lerp(34, 9, easeInOut(c.u)), 0)).addScaledVector(fwd, -4), W.clone().addScaledVector(fwd, 5), 42);
    c.ringShape = [11, 1.0, 0.2, 0.9];
    c.ringLife = 4;
  });
  cut('04d', 'Front, low, the sun behind the hood', B(16), (c) => {
    const { W, fwd } = walkCut(c);
    aim(c.camera, W.clone().addScaledVector(fwd, 6).add(V(-24, 1.1, 0)), W.clone().add(V(0, 1.8, 0)), 17);
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

  cut('05b', 'Long ridge from the side, the tiny walker, each step a pulse', B(21), (c) => {
    const w = walker(RIDGE, c.t, WALK_FROM);
    c.walker = w;
    const W = onGround(w.x, w.z);
    const x = W.x - 120, z = W.z + 90 - 22 * c.local;
    aim(c.camera, V(x, clear(x, z, 24, 30), z), W.clone().add(V(0, 3, -30)), 24);
    c.rings = (h) => { const f = footAt(RIDGE, h, WALK_FROM); return [f[0], f[1], h.w * 1.4]; };
    c.ringShape = [40, 3.5, 0.8, 0.6];
    c.ringLife = 5;
  });

  let crestAv;
  cut('05c', 'Under a slip face: sand pours over the crest on every beat', B(25), (c) => {
    const { x, z, h } = crestAv;
    const pos = V(x + 120 - c.local * 3, 0, z + 30 - c.local * 2);
    pos.y = duneHeight(pos.x, pos.z) + 2.2;
    aim(c.camera, pos, V(x - 10, h + 4, z - 40), 38);
    const curve = [];
    for (let i = 0; i < 16; i++) {
      const zz = z - 90 + i * 12;
      const xx = crestX(x, zz, 30);
      curve.push([xx, duneHeight(xx, zz), zz, 0.6]);
    }
    c.pour = { curve, uOpacity: 0.3 + 0.7 * beatEnv(c.t, 0.4), uSize: 0.4 };
    c.drift = { uGust: 0.8 + c.snareEnv * 1.5 };
    c.rings = (h) => [x + 60 + hash1(h.i) * 80, z - 60 + hash1(h.i + 5) * 120, h.w];
    c.ringShape = [40, 3.5, 0.7, 0.8];
    c.shake = c.kickEnv * 0.12;
  }, () => { const z = -5200, x = crestX(800, z); crestAv = { x, z, h: duneHeight(x, z) }; });

  cut('05d', 'Top-down over the dune sea, kicks fall like rain', B(29), (c) => {
    const x0 = 2500, z0 = -6500;
    const a = c.local * 0.05;
    const dive = easeIn(smoothstep(B(32), B(33), c.t));
    const g = duneHeight(x0, z0);
    const y = g + lerp(460, 70, dive);
    aim(c.camera, V(x0, y, z0), V(x0 + Math.cos(a) * 25, g, z0 + Math.sin(a) * 25), 52);
    c.rings = (h) => [x0 + (hash1(h.i * 3) - 0.5) * 700, z0 + (hash1(h.i * 3 + 1) - 0.5) * 420, h.w * (m.a.bars[barOf(h.t) - 1]?.kicks > 5 ? 1.8 : 1.2)];
    c.ringShape = [80, 7, 2.2, 0.42];
    c.ringLife = 5;
    c.drift = { uOpacity: 0.3 };
  });

  // ===================== A3: singing dunes (bars 33-48) ========================
  const chladni = (c, { zoom = 1, light = 0.6, pan = [0, 0], perKick = false, from = 0 } = {}) => {
    c.scene = 'chladni';
    const ch = c.director.chladni, u = ch.uniforms;
    if (perKick) {
      const n = m.hitCount('kick', c.t) - m.hitCount('kick', from);
      const last = m.recentHits('kick', c.t, 3).pop();
      ch.setMode('uModeA', 20 + n - 1);
      ch.setMode('uModeB', 20 + n);
      u.uMorph.value = last ? easeOutCubic(clamp(last.age / 0.22)) : 1;
    } else {
      const b = m.barAt(c.t + CUT_LEAD);
      ch.setMode('uModeA', b.bar - 1);
      ch.setMode('uModeB', b.bar);
      u.uMorph.value = easeOutCubic(clamp(b.phase * 2.2));
    }
    u.uSharp.value = 7 + 12 * Math.min(1, c.kickEnv) + 4 * m.curve('rms', c.t);
    u.uKick.value = Math.min(1, c.kickEnv);
    u.uTime.value = c.sim;
    u.uRing.value = 0;
    u.uZoom.value = zoom;
    u.uRot.value = c.t * 0.012;
    u.uPan.value.set(...pan);
    const a = c.t * 0.05 + light;
    u.uLight.value.set(Math.cos(a), Math.sin(a), 0.35);
    u.uExposure.value = 1;
  };
  cut('06a', 'The desert floor as a drum skin (cymbals out)', B(33), (c) => chladni(c, { zoom: lerp(1.0, 1.3, c.u) }));

  let slip2;
  cut('06b', 'A slip face vibrating, grains dance', B(36), (c) => {
    const { x, z, h } = slip2;
    const pos = V(x - 60 + c.local * 0.6, 0, z + 10);
    pos.y = duneHeight(pos.x, pos.z) + 0.28;
    const tg = V(pos.x + 4, 0, pos.z - 1.5);
    tg.y = duneHeight(tg.x, tg.z) + 0.05;
    aim(c.camera, pos, tg, 34);
    c.dust = { uBox: [8, 1.2, 8], uGust: Math.min(1.5, c.kickEnv * 2.0), uSize: 0.004, uOpacity: 0.95 };
    c.rings = (h2) => [x + 30, z - 10, h2.w * 0.8];
    c.ringShape = [12, 0.8, 0.12, 1.2];
    c.motes = { uOpacity: 0.5 };
    c.focus = 10;
    c.exposure = 0.8;
  }, () => { const z = -8200, x = crestX(-1200, z); slip2 = { x, z, h: duneHeight(x, z) }; });

  cut('06c', 'Close on the plate: grains migrate to the new figure', B(37), (c) => chladni(c, { zoom: lerp(2.0, 2.4, c.u), pan: [0.2, -0.1], light: 2.2 }));

  cut('06d', 'The walker waits in the haze', B(39), (c) => {
    const w = walker(RIDGE, B(39), WALK_FROM);
    c.walker = { ...w, step: 0, heading: -Math.PI / 2 };
    const W = onGround(w.x, w.z);
    aim(c.camera, W.clone().add(V(-70 + c.local * 6, 4, 18)), W.clone().add(V(0, 2, 0)), 14);
    c.drift = { uGust: 0.2 };
  });

  // bar 40: cymbals crash back in, every crest explodes into spindrift
  let fly40;
  cut('06e', 'Bar 40: the haze clears, every crest streams', B(40), (c) => {
    const f = fly40(c.t);
    aim(c.camera, f.pos, f.pos.clone().addScaledVector(f.dir, 100).add(V(0, lerp(-30, -8, easeInOut(c.u)), 0)), 48, f.roll);
    c.post.flash = 0.35 * since(c.t, m.barTime(40), 0.3);
    c.drift = { uGust: 0.8 + 2.0 * since(c.t, m.barTime(40), 2.0) + c.snareEnv, uOpacity: 0.7, uSize: 0.45 };
    c.rings = (h) => [...ahead(f.pos, f.dir, h.i, 150, 600, 260, hash1), h.w * 1.3];
    c.ringShape = [150, 12, 2.2, 0.5];
    c.glint = Math.min(1, c.hatEnv * 1.5);
    c.shake = 0.25 * since(c.t, m.barTime(40), 1.2) + c.kickEnv * 0.15;
  }, () => { fly40 = flight({ t0: B(40), t1: B(44) + 1, x: -2200, z: -9000, heading: Math.PI * 0.62, turns: [0, -0.35, 0.3, -0.2], period: 4 * 60 / 105, speed: (l) => 30 + l * 8, height: 30 }); });

  cut('06f', 'The plate answers every kick', B(44), (c) => chladni(c, { zoom: lerp(0.95, 1.15, c.u), perKick: true, from: B(44), light: 4.0 }));

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
  const S_STOP = 66;                                  // where the walker stops in the basin
  const stopT = () => m.barTime(56);
  const basinWalker = (t) => {
    const w = walker(basinPath, Math.min(t, stopT()), B(49));
    return { ...w, x: w.x, z: w.z, step: t < stopT() ? w.step : 0 };
  };
  const stakeAt = () => { const w = basinWalker(stopT()); return { x: w.x + 1.1, z: w.z - 1.2 }; };
  cut('07a', 'Heat: across the basin on a long lens, rings run over the hardpan', B(49), (c) => {
    const w = basinWalker(c.t);
    c.walker = w;
    c.feet = footprints(basinPath, c.t, B(49));
    c.rings = (h) => { const f = footAt(basinPath, h, B(49)); return [f[0], f[1], h.w * 1.5]; };
    c.ringShape = [22, 2.0, 0.4, 0.7];
    c.ringLife = 5;
    const W = onGround(w.x, w.z);
    const cp = W.clone().add(V(-420, 0, 60));
    cp.y = duneHeight(cp.x, cp.z) + 2.0;
    aim(c.camera, cp, W.clone().add(V(0, 1.4, 0)), 8);
    c.focus = 0;
  });
  cut('07b', 'Tracking the walker, who stops on the fill', B(53), (c) => {
    const w = basinWalker(c.t);
    c.walker = w;
    c.feet = footprints(basinPath, Math.min(c.t, stopT()), B(49));
    c.rings = (h) => (h.t < stopT() ? (() => { const f = footAt(basinPath, h, B(49)); return [f[0], f[1], h.w * 1.3]; })() : null);
    c.ringShape = [18, 1.6, 0.35, 0.8];
    const W = onGround(w.x, w.z);
    aim(c.camera, W.clone().add(V(-9, 1.6, -7)), W.clone().add(V(0, 1.3, 0)), 30);
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
    aim(c.camera, W.clone().add(V(-7, 2.0, 3.5)), V(mx0 - 40, duneHeight(mx0, mz0) + 5, mz0 + 30), 26);
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
    const st = steps(c.t, B(80), 'hat');
    c.walker = { ...c.walker, step: st, heading: -Math.PI / 2 };
    aim(c.camera, W.clone().add(V(-1.8, 0.35, 1.8)), W.clone().add(V(0, 0.3, 0)), 32);
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
  cut('19', 'Final hits: the plate snaps into a drumhead', B(126), (c) => {
    chladni(c, { zoom: lerp(1.5, 1.1, c.u), perKick: true, from: B(126), light: 0.4 });
    const u = c.director.chladni.uniforms;
    u.uExposure.value = 1.35;
    u.uSharp.value = 8 + 22 * c.u;
    u.uRing.value = smoothstep(0.5, 0.95, c.u);
    u.uRot.value = 0;
    c.post.flash = 0.3 * Math.min(1, c.kickEnv);
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
