import * as THREE from 'three';
import { U } from './world/shared.js';
import { MAX_RINGS, duneHeight } from './world/terrain-fn.js';
import { Terrain } from './world/terrain.js';
import { Sky } from './world/sky.js';
import { Particles } from './world/particles.js';
import { Walker, Stake, Worm } from './world/figures.js';
import { Chladni } from './world/chladni.js';
import { Post } from './post/post.js';
import { makeTitleTexture } from './post/titles.js';
import { LOOK } from './look.js';
import { buildShots } from './timeline.js';
import { sampleKeys, hex, clamp, hash1 } from './core/util.js';

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
    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 20000);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2);
    this.scene.add(this.sunLight, this.sunLight.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x442211, 0.6);
    this.scene.add(this.hemi);

    this.sky = new Sky(this.scene);
    this.terrain = new Terrain(this.scene, quality < 1 ? { nearSegs: 320, farSegs: 160 } : {});
    this.dust = new Particles(this.scene, { count: Math.round(40000 * quality), seed: 11 });
    this.spice = new Particles(this.scene, { count: Math.round(9000 * quality), seed: 23, additive: true });
    this.storm = new Particles(this.scene, { count: Math.round(25000 * quality), seed: 37 });
    this.walker = new Walker(this.scene);
    this.stake = new Stake(this.scene);
    this.worm = new Worm(this.scene);
    this.chladni = new Chladni();
    this.chladni.uniforms.uRes.value.set(width, height);

    this.post = new Post(renderer, width, height);

    // --- time maps -------------------------------------------------------
    // Simulation time runs slower/stops during freezes: grains hang in the air,
    // rings stop expanding. Camera moves keep using music time.
    this.simRates = [
      [167.3, 170.5, 0.03], // break: everything hangs
    ];
    // Freeze frames at hard stops (the picture holds the stop's first frame).
    this.freezes = music.events.stops.filter(([a]) => a < 314);

    this.shots = buildShots(music);
    for (const s of this.shots) s.init?.(this.ctxBase());
  }

  async init() {
    this.post.g.tTitle.value = await makeTitleTexture(this.width, this.height);
  }

  setSize(w, h) {
    this.width = w; this.height = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.chladni.uniforms.uRes.value.set(w, h);
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

  render(tMusic) {
    const m = this.music;
    // hold the frame during hard stops
    let t = tMusic;
    for (const [a, b] of this.freezes) if (t >= a && t < b) t = a;

    const shot = this.shotAt(t);
    const look = { ...sampleKeys(this.look, t) };
    const sim = this.sim(t);

    const ctx = {
      ...this.ctxBase(),
      t, sim, shot,
      local: t - shot.start,
      u: clamp((t - shot.start) / (shot.end - shot.start)),
      look,
      camera: this.camera,
      scene: 'desert',
      rings: null,          // (hit) => [x, z, strength] | null  — kick rings
      ringHits: 'kick',     // which hit list drives rings ('kick' | 'beat')
      ringShape: [30, 3, 0.6, 1.2],
      ringLife: 3.5,
      mounds: [],
      walker: null,         // { x, z, heading, step }
      stake: null,
      worm: null,           // { points: Vector3[], flex }
      post: {},
      dust: {}, spice: null, stormFx: null,
      shake: 0,
      kickEnv: m.envelope('kick', t, 0.18),
      snareEnv: m.envelope('snare', t, 0.25),
      hatEnv: m.envelope('hat', t, 0.12),
    };
    shot.frame(ctx);

    if (ctx.scene === 'chladni') {
      this.applyPost(ctx, look, tMusic);
      this.post.bloom.strength = 0.15;
      this.renderer.toneMappingExposure = look.exposure;
      this.post.render(this.chladni.scene, this.chladni.camera);
      return;
    }

    this.applyWorld(ctx, look);
    this.applyPost(ctx, look, tMusic);
    this.post.render(this.scene, this.camera);
  }

  applyWorld(ctx, look) {
    const m = this.music;
    const cam = this.camera;

    // camera shake from kicks (deterministic jitter)
    if (ctx.shake > 0) {
      const f = Math.round(ctx.t * 25);
      cam.position.x += (hash1(f * 3 + 1) - 0.5) * ctx.shake;
      cam.position.y += (hash1(f * 3 + 2) - 0.5) * ctx.shake;
      cam.position.z += (hash1(f * 3 + 3) - 0.5) * ctx.shake;
    }
    cam.updateMatrixWorld();

    // shared uniforms
    const el = THREE.MathUtils.degToRad(look.sunElev), az = THREE.MathUtils.degToRad(look.sunAzim);
    const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
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
    U.uGlint.value = ctx.glint ?? Math.min(1, ctx.hatEnv) * m.curve('high', ctx.t);
    U.uRipple.value = ctx.ripple ?? 1;
    U.uShadow.value = 1;

    // rings from hits (newest MAX_RINGS)
    const rings = U.uRings.value;
    rings.forEach((r) => r.set(0, 0, 0, 0));
    if (ctx.rings) {
      const hits = ctx.ringHits === 'beat'
        ? m.beats.filter((b) => b <= ctx.t && ctx.t - b < ctx.ringLife).map((b, k) => ({ t: b, w: 1, i: m.beats.indexOf(b) }))
        : m.recentHits('kick', ctx.t, ctx.ringLife);
      const list = [];
      for (const h of hits) {
        const r = ctx.rings(h);
        if (r) list.push([r[0], r[1], Math.max(0, ctx.sim - this.sim(h.t)), r[2]]);
      }
      list.slice(-MAX_RINGS).forEach((r, i) => rings[i].set(...r));
    }
    U.uRingShape.value.set(...ctx.ringShape);
    const mounds = U.uMounds.value;
    mounds.forEach((v, i) => (ctx.mounds[i] ? v.set(...ctx.mounds[i]) : v.set(0, 0, 0, 0)));

    // lights for standard materials (figures)
    const sunUp = clamp((look.sunElev + 2) / 6);
    this.sunLight.color.setRGB(...look.sunColor);
    this.sunLight.intensity = 3 * look.sunPower * sunUp + look.night * 0.4;
    this.sunLight.position.copy(cam.position).addScaledVector(sunDir, 500);
    this.sunLight.target.position.copy(cam.position);
    this.hemi.color.setRGB(...look.zenith);
    this.hemi.groundColor.setRGB(...look.sand).multiplyScalar(0.4);
    this.hemi.intensity = 1.2;

    this.sky.follow(cam);
    this.terrain.follow(cam.position.x, cam.position.z);

    // particles
    const sand = new THREE.Color().setRGB(...look.sand).lerp(new THREE.Color(1, 0.95, 0.85), 0.35);
    this.dust.set({
      uBox: [160, 30, 160], uWind: [3 + 6 * m.curve('mid', ctx.t), 0, 1], uGust: ctx.snareEnv * 0.5,
      uRise: 0, uHover: 0, uSize: 0.05, uColor: [sand.r, sand.g, sand.b], uOpacity: 0.55, uGlow: 0,
      uPixelRatio: this.height / 1080, ...ctx.dust,
    });
    this.dust.visible = ctx.dust.visible ?? true;
    this.spice.visible = !!ctx.spice;
    if (ctx.spice) this.spice.set({ uBox: [220, 40, 220], uWind: [1, 0, 0.3], uRise: 0.02, uSize: 0.12, uColor: [0.25, 0.55, 1.0], uOpacity: 0.9, uGlow: 1.5, uPixelRatio: this.height / 1080, ...ctx.spice });
    this.storm.visible = look.storm > 0.02 || !!ctx.stormFx;
    if (this.storm.visible) this.storm.set({ uBox: [120, 40, 120], uWind: [45, -2, 12], uGust: 0, uSize: 0.08, uColor: [0.75, 0.5, 0.3], uOpacity: 0.6 * look.storm, uPixelRatio: this.height / 1080, ...ctx.stormFx });

    // figures
    this.walker.visible = !!ctx.walker;
    if (ctx.walker) this.walker.place(ctx.walker.x, ctx.walker.z, ctx.walker.heading, ctx.walker.step, m.curve('mid', ctx.t), ctx.sim, ctx.walker.y);
    this.stake.visible = !!ctx.stake;
    if (ctx.stake) this.stake.place(ctx.stake.x, ctx.stake.z, ctx.stake.sink ?? 0, ctx.stake.pulse ?? 0);
    this.worm.visible = !!ctx.worm;
    if (ctx.worm) this.worm.build(ctx.worm.points, ctx.worm.flex ?? 0);

    this.renderer.toneMappingExposure = look.exposure;
    this.post.bloom.strength = look.bloom;
  }

  applyPost(ctx, look, tMusic) {
    const g = this.post.g;
    g.uFrame.value = Math.round(tMusic * this.music.fps);
    g.uContrast.value = look.contrast;
    g.uSaturation.value = look.saturation;
    g.uLift.value.setRGB(...look.lift);
    g.uGain.value.setRGB(...look.gain);
    g.uVignette.value = 0.35;
    g.uGrain.value = 0.045;
    g.uShimmer.value = look.shimmer * (0.5 + 0.5 * this.music.curve('rms', ctx.t));
    g.uFlash.value = 0;
    g.uFlashColor.value.setRGB(1, 0.95, 0.85);
    g.uFade.value = 1;
    g.uTitle.value = 0;
    g.uTitleDissolve.value = 0;
    for (const [k, v] of Object.entries(ctx.post)) {
      if (k === 'flashColor') g.uFlashColor.value.setRGB(...v);
      else g['u' + k[0].toUpperCase() + k.slice(1)].value = v;
    }
  }
}
