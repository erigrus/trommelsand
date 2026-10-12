import * as THREE from 'three';
import { U } from './world/shared.js';
import { MAX_RINGS, MAX_MOUNDS, duneHeight } from './world/terrain-fn.js';
import { Terrain } from './world/terrain.js';
import { Sky } from './world/sky.js';
import { Particles } from './world/particles.js';
import { Walker, Stake, Worm, RIM, WIND } from './world/figures.js';
import { WormSkeleton } from './world/bones.js';
import { RiggedWalker } from './world/walker.js';
import { Post } from './post/post.js';
import { makeTitleTexture } from './post/titles.js';
import { LOOK } from './look.js';
import { buildShots } from './timeline.js';
import { sampleKeys, hex, clamp } from './core/util.js';

// Scene colours are authored as sRGB hex and converted to linear for lighting;
// lift/gain act in the display-space grade, so they stay sRGB.
const LINEAR_KEYS = ['sunColor', 'zenith', 'horizon', 'ambient', 'sand'];
const DISPLAY_KEYS = ['lift', 'gain'];
const toLinear = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };

/** Carry every value forward so partial keyframes interpolate correctly; hex -> rgb. */
function normalizeLook(keys) {
  let prev = {};
  return keys.map((k) => {
    const full = { ...prev, ...k };
    prev = full;
    const out = { ...full };
    for (const c of LINEAR_KEYS) if (typeof out[c] === 'number') out[c] = toLinear(out[c]);
    for (const c of DISPLAY_KEYS) if (typeof out[c] === 'number') out[c] = hex(out[c]);
    return out;
  });
}

/** Smooth deterministic 1D noise in -1..1 (sum of incommensurate sines). */
function wobble(t, seed) {
  return (Math.sin(t * 1.0 + seed) * 0.5 + Math.sin(t * 2.31 + seed * 1.7) * 0.3 + Math.sin(t * 5.13 + seed * 2.9) * 0.2);
}

/**
 * Owns the world and turns music time t into one finished frame.
 * render(t) is a pure function of t: no state carries from frame to frame,
 * so the preview can seek anywhere and the offline render can run in chunks.
 */
export class Director {
  constructor({ renderer, music, width, height, quality = 1 }) {
    this.renderer = renderer;
    this.music = music;
    this.width = width;
    this.height = height;
    this.look = normalizeLook(LOOK);

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // --- world ---------------------------------------------------------
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 30000);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2);
    this.scene.add(this.sunLight, this.sunLight.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x442211, 0.6);
    this.scene.add(this.hemi);

    const q = quality;
    this.sky = new Sky(this.scene);
    this.terrain = new Terrain(this.scene, q < 1 ? { nearSegs: 320, farSegs: 160 } : {});
    this.dust = new Particles(this.scene, { count: Math.round(30000 * q), seed: 11, mode: 0 });
    this.drift = new Particles(this.scene, { count: Math.round(60000 * q), seed: 17, mode: 1 });
    this.motes = new Particles(this.scene, { count: Math.round(260 * q), seed: 29, mode: 2 });
    this.spice = new Particles(this.scene, { count: Math.round(9000 * q), seed: 23, additive: true, mode: 3 });
    this.storm = new Particles(this.scene, { count: Math.round(30000 * q), seed: 37, mode: 0 });
    this.pour = new Particles(this.scene, { count: Math.round(14000 * q), seed: 41, mode: 4 });
    this.walker = new Walker(this.scene);
    this.stake = new Stake(this.scene);
    this.worm = new Worm(this.scene);
    this.skel = new WormSkeleton(this.scene);   // built by the timeline (cut 05d init)

    this.post = new Post(renderer, width, height);

    // --- time maps -------------------------------------------------------
    // Simulation time runs slower/stops during freezes: grains hang in the air,
    // rings stop expanding. Camera moves keep using music time.
    this.simRates = [
      [167.3, 170.5, 0.03], // break: everything hangs
      [302.2, 310.4, 0.45], // B7: the worm dives in slow motion
    ];
    // Freeze frames at hard stops (the picture holds the stop's first frame).
    this.freezes = music.events.stops.filter(([a]) => a < 314);

    this.shots = buildShots(music);
    for (const s of this.shots) s.init?.(this.ctxBase());
  }

  async init() {
    this.post.g.tTitle.value = await makeTitleTexture(this.width, this.height);
    // the rigged walker if its model was fetched (npm run models), else the procedural one
    this.rigged = await RiggedWalker.load(this.scene);
    if (this.rigged) this.walker.visible = false;
  }

  setSize(w, h) {
    this.width = w; this.height = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
  }

  sim(t) {
    let s = t;
    for (const [a, b, r] of this.simRates) {
      if (t > a) s -= (Math.min(t, b) - a) * (1 - r);
    }
    return s;
  }

  shotAt(t) {
    let cur = this.shots[0];
    for (const s of this.shots) if (t >= s.start) cur = s;
    return cur;
  }

  ctxBase() {
    return { music: this.music, ground: duneHeight, director: this };
  }

  /**
   * One output frame with motion blur: `samples` sub-frames spread over a
   * `shutter` fraction of the frame time (0.5 = 180° film shutter), averaged.
   * Sub-frames never cross a cut.
   */
  renderFrame(t, { samples = 1, shutter = 0.5 } = {}) {
    if (samples <= 1) return this.render(t);
    const shot = this.shotAt(t);
    const span = shutter / this.music.fps;
    this.post.beginAccum(samples);
    for (let k = 0; k < samples; k++) {
      const tk = clamp(t + ((k + 0.5) / samples - 0.5) * span, shot.start, shot.end - 1e-4);
      this.render(tk, t);
    }
    this.post.endAccum();
  }

  render(tMusic, tFrame = tMusic) {
    const m = this.music;
    // hold the frame during hard stops
    let t = tMusic;
    for (const [a, b] of this.freezes) if (t >= a && t < b) t = a;

    const shot = this.shotAt(t);
    const look = { ...sampleKeys(this.look, t) };
    const sim = this.sim(t);
    const mid = m.curve('mid', t);

    const ctx = {
      ...this.ctxBase(),
      t, sim, shot,
      local: t - shot.start,
      u: clamp((t - shot.start) / (shot.end - shot.start)),
      look,
      camera: this.camera,
      skeleton: false,      // the dead worm's bones (part A)
      rings: null,          // (hit) => [x, z, strength] | null  — kick rings
      ringHits: 'kick',     // which hit list drives rings ('kick' | 'beat')
      ringShape: [30, 3, 0.6, 1.2],
      ringLife: 3.5,
      ringGlow: null,       // [r, g, b] light on the wave fronts (night)
      mounds: [],
      feet: [],             // [[x, z, heading, depth], ...]
      walker: null,         // { x, z, heading, step, y?, scale?, brace? }
      stake: null,          // { x, z, sink, lift }
      worm: null,           // { points: Vector3[], flex, open, pour: {...particle params} }
      pour: null,           // { curve: [[x, y, z, r] x16], ...particle params } sand pouring off a line
      wind: [6 + 7 * mid, 1.5],
      post: {},
      dust: {}, drift: {}, motes: {}, spice: null, stormFx: null,
      rays: {},
      stormWall: null,      // [nx, nz, offset, height]
      shake: 0,             // degrees of smooth rumble
      punch: 0.6,           // how much kicks punch the lens in (0..1)
      focus: 0,             // focus distance for the mote bokeh
      kickEnv: m.envelope('kick', t, 0.18),
      snareEnv: m.envelope('snare', t, 0.25),
      hatEnv: m.envelope('hat', t, 0.12),
    };
    shot.frame(ctx);

    this.applyWorld(ctx, look);
    this.applyPost(ctx, look, tFrame);
    this.post.render(this.scene, this.camera);
  }

  applyWorld(ctx, look) {
    const m = this.music;
    const cam = this.camera;

    // lens punch on kicks + smooth rumble (rotation, not jitter)
    const punch = Math.min(1, m.envelope('kick', ctx.t, 0.09)) * ctx.punch;
    if (punch > 0) { cam.fov *= 1 - 0.03 * punch; cam.updateProjectionMatrix(); }
    if (ctx.shake > 0) {
      const a = THREE.MathUtils.degToRad(ctx.shake);
      cam.rotateY(wobble(ctx.t * 11, 1.3) * a);
      cam.rotateX(wobble(ctx.t * 13, 4.1) * a * 0.7);
      cam.rotateZ(wobble(ctx.t * 7, 2.2) * a * 0.4);
    }
    cam.updateMatrixWorld();

    // sun
    const el = THREE.MathUtils.degToRad(look.sunElev), az = THREE.MathUtils.degToRad(look.sunAzim);
    const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const sunUp = clamp((look.sunElev + 2) / 5);

    // shared uniforms
    U.uTime.value = ctx.sim;
    U.uCamPos.value.copy(cam.position);
    U.uSunDir.value.copy(sunDir);
    U.uSunColor.value.setRGB(...look.sunColor).multiplyScalar(look.sunPower);
    U.uZenith.value.setRGB(...look.zenith);
    U.uHorizon.value.setRGB(...look.horizon);
    U.uAmbient.value.setRGB(...look.ambient);
    U.uSand.value.setRGB(...look.sand);
    U.uFogDensity.value = look.fog;
    U.uHaze.value = look.haze;
    U.uNight.value = look.night;
    U.uStorm.value = look.storm;
    U.uClouds.value = look.clouds ?? 0;
    U.uGlint.value = ctx.glint ?? Math.min(1, ctx.hatEnv) * (0.3 + m.curve('high', ctx.t));
    U.uRipple.value = ctx.ripple ?? 1;
    U.uShadow.value = 1;
    U.uRingGlow.value.setRGB(...(ctx.ringGlow ?? [0, 0, 0]));
    if (ctx.stormWall) U.uStormWall.value.set(...ctx.stormWall); else U.uStormWall.value.set(0, 0, 0, 0);

    // rings from hits (newest MAX_RINGS)
    const rings = U.uRings.value;
    rings.forEach((r) => r.set(0, 0, 0, 0));
    if (ctx.rings) {
      const hits = ctx.ringHits === 'beat'
        ? m.beats.map((b, i) => ({ t: b, w: 1, i })).filter((b) => b.t <= ctx.t && ctx.t - b.t < ctx.ringLife)
        : m.recentHits('kick', ctx.t, ctx.ringLife);
      const list = [];
      for (const h of hits) {
        const r = ctx.rings(h);
        if (r) list.push([r[0], r[1], Math.max(0, ctx.sim - this.sim(h.t)), r[2]]);
      }
      list.slice(-MAX_RINGS).forEach((r, i) => rings[i].set(...r));
    }
    U.uRingShape.value.set(...ctx.ringShape);
    // sand drifted against the skeleton's ribs (the ones nearest the camera)
    if (ctx.skeleton && !ctx.mounds.length) ctx.mounds = this.skel.driftsNear(cam.position.x, cam.position.z, MAX_MOUNDS, ctx.skeleton.drift ?? 1);
    const mounds = U.uMounds.value;
    mounds.forEach((v, i) => (ctx.mounds[i] ? v.set(...ctx.mounds[i]) : v.set(0, 0, 0, 0)));
    this.terrain.setFeet(ctx.feet);

    // never let a camera end up under the sand: dunes + rings + mounds, as the GPU sees them
    {
      const { x, z } = cam.position;
      let gy = duneHeight(x, z);
      const [speed, width, amp, decay] = ctx.ringShape;
      for (const r of rings) {
        if (r.w <= 0) continue;
        const d = Math.hypot(x - r.x, z - r.y) - r.z * speed, w = width * (1 + r.z * 0.6);
        gy += Math.max(0, amp * Math.exp(-d * d / (w * w)) * Math.exp(-r.z * decay) * r.w);
      }
      for (const mo of ctx.mounds) { const dx = (x - mo[0]) / mo[3], dz = (z - mo[1]) / mo[3]; gy += mo[2] * Math.exp(-(dx * dx + dz * dz)); }
      if (cam.position.y < gy + 0.15) { cam.position.y = gy + 0.15; cam.updateMatrixWorld(); }
    }

    // lights for the figures: sun, sky, and a rim when they are backlit
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const backlit = clamp(fwd.dot(sunDir) * 0.8 + 0.35);
    this.sunLight.color.setRGB(...look.sunColor);
    this.sunLight.intensity = 3.2 * look.sunPower * sunUp;
    this.sunLight.position.copy(cam.position).addScaledVector(sunDir, 500);
    this.sunLight.target.position.copy(cam.position);
    this.hemi.color.setRGB(...look.zenith);
    // fill: open sky above and a lot of bounce off the sand, so figures match the terrain's own shading
    this.hemi.groundColor.setRGB(...look.sand).multiplyScalar(0.8);
    this.hemi.intensity = 2.2 + look.night * 0.8;
    RIM.value.setRGB(...look.sunColor).multiplyScalar(look.sunPower * sunUp * backlit * backlit * 1.1)
      .add(new THREE.Color(0.25, 0.35, 0.6).multiplyScalar(look.night * 0.5));
    const wlen = Math.hypot(ctx.wind[0], ctx.wind[1]);
    WIND.value.set(ctx.wind[0] / wlen, ctx.wind[1] / wlen, clamp(wlen / 12) + ctx.snareEnv * 0.3, ctx.sim);

    this.sky.follow(cam);
    this.terrain.follow(cam.position.x, cam.position.z);

    // particles
    const projScale = this.height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    const sand = new THREE.Color().setRGB(...look.sand).lerp(new THREE.Color(1, 0.92, 0.8), 0.3);
    const sandRGB = [sand.r, sand.g, sand.b];
    const wind = [ctx.wind[0], 0, ctx.wind[1]];
    const common = { uProjScale: projScale, uFocus: ctx.focus };
    const show = (sys, params, defaults) => {
      sys.visible = params !== null && params?.visible !== false;
      if (sys.points.visible) sys.set({ ...common, ...defaults, ...params });
    };
    show(this.dust, ctx.dust, { uBox: [160, 30, 160], uWind: wind, uGust: ctx.snareEnv * 0.5, uHover: 0, uSize: 0.035, uColor: sandRGB, uOpacity: 0.5 });
    show(this.drift, ctx.drift, { uBox: [500, 60, 500], uWind: wind, uGust: ctx.snareEnv, uSize: 0.06, uColor: sandRGB, uOpacity: 0.5 });
    show(this.motes, ctx.motes, { uBox: [14, 8, 14], uWind: wind, uSize: 0.02, uColor: sandRGB, uOpacity: 0.35 });
    show(this.spice, ctx.spice, { uBox: [240, 45, 240], uWind: [1, 0, 0.3], uSize: 0.1, uColor: [0.3, 0.6, 1.0], uOpacity: 0.9, uGlow: 1.5 });
    const stormFx = ctx.stormFx ?? (look.storm > 0.02 ? {} : null);
    show(this.storm, stormFx, { uBox: [140, 50, 140], uWind: [55, -2, 14], uGust: 0, uSize: 0.12, uColor: sandRGB, uOpacity: 0.55 * look.storm });

    // figures
    const fig = this.rigged ?? this.walker;
    fig.visible = !!ctx.walker;
    if (ctx.walker) {
      const w = ctx.walker;
      const y = w.y ?? this.terrain.drawnHeight(w.x, w.z);
      if (this.rigged) {
        this.rigged.place(w.x, w.z, w.heading, w.step ?? 0, { y, scale: w.scale ?? 1, brace: w.brace ?? 0, t: ctx.sim,
          walk: w.walk, carry: !!w.carry, wind: ctx.wind, windStrength: clamp(wlen / 14) + ctx.snareEnv * 0.25 });
      } else {
        this.walker.place(w.x, w.z, w.heading, w.step ?? 0, { y, scale: w.scale ?? 1, brace: w.brace ?? 0, t: ctx.sim,
          wind: { dir: [ctx.wind[0] / wlen, ctx.wind[1] / wlen], strength: clamp(wlen / 12) } });
      }
    }
    this.skel.visible = !!ctx.skeleton;
    this.stake.visible = !!ctx.stake;
    if (ctx.stake) this.stake.place(ctx.stake.x, ctx.stake.z, { ...ctx.stake, windYaw: Math.atan2(-ctx.wind[1], ctx.wind[0]) });
    this.worm.visible = !!ctx.worm;
    if (ctx.worm) this.worm.build(ctx.worm.points, ctx.worm);
    // sand pouring: off the worm's back, or along any curve a shot supplies
    const pour = ctx.pour ?? ctx.worm?.pour ?? null;
    this.pour.visible = !!pour;
    if (pour) {
      const cv = this.pour.uniforms.uCurve.value;
      if (pour.curve) pour.curve.forEach((p, i) => cv[i].set(...p));
      else {
        for (let i = 0; i < 16; i++) {
          const p = this.worm.curve.getPointAt(Math.min(1, i / 15) * 0.97);
          cv[i].set(p.x, p.y, p.z, this.worm.radius * Math.min(1, 0.25 + (i / 15) * 3.5));
        }
      }
      const { curve, ...params } = pour;
      this.pour.set({ ...common, uWind: wind, uSize: 0.35, uColor: sandRGB, uOpacity: 0.55, ...params });
    }

    // god rays + flare: where is the sun on screen?
    const sp = cam.position.clone().addScaledVector(sunDir, 1000).project(cam);
    const facing = fwd.dot(sunDir);
    const onScreen = clamp(1.4 - Math.max(Math.abs(sp.x), Math.abs(sp.y)) * 0.8);
    const r = this.post.r;
    r.uSunUV.value.set((sp.x + 1) / 2, (sp.y + 1) / 2);
    r.uSunOn.value = facing > 0 ? clamp(facing * 3) * onScreen * clamp((look.sunElev + 1.5) / 3) * (1 - look.storm * 0.7) : 0;
    r.uStrength.value = ctx.rays.strength ?? look.rays ?? 0.5;
    r.uDensity.value = ctx.rays.density ?? 0.95;
    r.uDecay.value = ctx.rays.decay ?? 0.965;
    r.uThreshold.value = ctx.rays.threshold ?? 0.9;
    r.uFlare.value = ctx.rays.flare ?? 1;
    r.uSunColor.value.copy(U.uSunColor.value);

    this.renderer.toneMappingExposure = look.exposure * (ctx.exposure ?? 1);
    this.post.bloom.strength = look.bloom;
  }

  applyPost(ctx, look, tMusic) {
    const g = this.post.g;
    g.uFrame.value = Math.round(tMusic * this.music.fps);
    g.uContrast.value = look.contrast;
    g.uSaturation.value = look.saturation;
    g.uLift.value.setRGB(...look.lift);
    g.uGain.value.setRGB(...look.gain);
    g.uShadowTint.value.setRGB(...(look.shadowTint ?? [0.0, 0.025, 0.05]));
    g.uHighTint.value.setRGB(...(look.highTint ?? [0.04, 0.015, -0.03]));
    g.uVignette.value = 0.4;
    g.uGrain.value = 0.045;
    g.uAberration.value = 0.002;
    g.uShimmer.value = look.shimmer * (0.5 + 0.5 * this.music.curve('rms', ctx.t));
    g.uFlash.value = 0;
    g.uFlashColor.value.setRGB(1, 0.95, 0.85);
    g.uFade.value = 1;
    g.uStreaks.value = look.storm * (ctx.streaks ?? 1);
    g.uTitle.value = 0;
    g.uTitleDissolve.value = 0;
    for (const [k, v] of Object.entries(ctx.post)) {
      if (k === 'flashColor') g.uFlashColor.value.setRGB(...v);
      else g['u' + k[0].toUpperCase() + k.slice(1)].value = v;
    }
  }
}
