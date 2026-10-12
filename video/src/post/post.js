import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// HDR, before tone mapping: crepuscular rays from open sky around the sun
// (the sky writes alpha 0, everything solid alpha 1), plus an anamorphic
// streak and a few soft ghosts when the sun itself is visible.
const RaysShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
    uSunOn: { value: 0 },          // 0..1: sun in front of the camera and above the horizon
    uStrength: { value: 0.6 },
    uDecay: { value: 0.965 },
    uDensity: { value: 0.9 },
    uThreshold: { value: 0.6 },
    uSunColor: { value: new THREE.Color(1, 0.8, 0.6) },
    uAspect: { value: 16 / 9 },
    uFlare: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uSunUV;
    uniform float uSunOn, uStrength, uDecay, uDensity, uThreshold, uAspect, uFlare;
    uniform vec3 uSunColor;
    varying vec2 vUv;
    const int N = 56;
    float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 col = base.rgb;
      if (uSunOn > 0.001) {
        vec2 delta = (vUv - uSunUV) * uDensity / float(N);
        vec2 uv = vUv;
        float w = 1.0;
        vec3 acc = vec3(0.0);
        for (int i = 0; i < N; i++) {
          uv -= delta;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
          vec4 s = texture2D(tDiffuse, uv);
          vec2 dd = (uv - uSunUV) * vec2(uAspect, 1.0);
          float m = (1.0 - s.a) * min(max(lum(s.rgb) - uThreshold, 0.0), 1.5) * exp(-dot(dd, dd) * 5.0);
          acc += normalize(s.rgb + 1e-4) * m * w;
          w *= uDecay;
        }
        col += acc * uStrength * uSunOn / float(N) * 3.0;

        // sun visibility: open sky around the sun position
        float vis = 0.0;
        for (int k = 0; k < 5; k++) {
          vec2 o = vec2(float(k - 2) * 0.004, float((k * 3) % 5 - 2) * 0.004);
          vis += 1.0 - texture2D(tDiffuse, uSunUV + o).a;
        }
        vis = vis / 5.0 * uSunOn * uFlare;
        if (vis > 0.0) {
          vec2 d = (vUv - uSunUV) * vec2(uAspect, 1.0);
          float streak = exp(-abs(d.y) * 260.0) * exp(-abs(d.x) * 2.2);
          col += uSunColor * vec3(1.0, 0.85, 0.7) * streak * vis * 0.9;
          vec2 c = vec2(0.5);
          for (int g = 0; g < 3; g++) {
            float k = g == 0 ? 0.55 : g == 1 ? 1.25 : 1.9;
            float r = g == 0 ? 0.05 : g == 1 ? 0.025 : 0.08;
            vec2 gp = c + (c - uSunUV) * k;
            vec2 gd = (vUv - gp) * vec2(uAspect, 1.0);
            float disc = smoothstep(r, r * 0.6, length(gd));
            vec3 tint = g == 0 ? vec3(1.0, 0.6, 0.3) : g == 1 ? vec3(0.5, 0.8, 1.0) : vec3(0.9, 0.5, 0.8);
            col += uSunColor * tint * disc * vis * 0.045;
          }
        }
      }
      // a single NaN/Inf pixel would bloom into a black frame: clamp it here
      if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
      gl_FragColor = vec4(min(col, vec3(6e4)), base.a);
    }
  `,
};

// Final look, applied in display space after tone mapping:
// heat shimmer, slight chromatic aberration, split-tone grade, title with a
// sand dissolve, flash / fade, vignette, film grain.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tTitle: { value: null },
    uRes: { value: new THREE.Vector2(1920, 1080) },
    uFrame: { value: 0 },
    uContrast: { value: 1.05 },
    uSaturation: { value: 1.0 },
    uLift: { value: new THREE.Color(0, 0, 0) },
    uGain: { value: new THREE.Color(1, 1, 1) },
    uShadowTint: { value: new THREE.Color(0.0, 0.03, 0.06) },
    uHighTint: { value: new THREE.Color(0.05, 0.02, -0.03) },
    uVignette: { value: 0.35 },
    uGrain: { value: 0.05 },
    uAberration: { value: 0.0015 },
    uShimmer: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uFade: { value: 1 },            // 1 = visible, 0 = black
    uStreaks: { value: 0 },         // storm: sand streaming across the frame
    uTitle: { value: 0 },           // 0..1 title opacity
    uTitleDissolve: { value: 0 },   // 0 = solid, 1 = blown away
    uTitleWind: { value: new THREE.Vector2(1, 0.15) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tTitle;
    uniform vec2 uRes;
    uniform float uFrame, uContrast, uSaturation, uVignette, uGrain, uAberration, uShimmer, uFlash, uFade, uStreaks;
    uniform vec3 uLift, uGain, uFlashColor, uShadowTint, uHighTint;
    uniform float uTitle, uTitleDissolve;
    uniform vec2 uTitleWind;
    varying vec2 vUv;

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

    void main() {
      vec2 uv = vUv;
      // heat shimmer: strongest in the band around the horizon
      if (uShimmer > 0.0) {
        float band = smoothstep(0.2, 0.45, uv.y) * (1.0 - smoothstep(0.5, 0.75, uv.y));
        float t = uFrame / 25.0;
        uv.x += (vnoise(vec2(uv.y * 110.0, t * 4.0)) - 0.5) * 0.004 * uShimmer * band;
        uv.y += (vnoise(vec2(uv.x * 70.0, t * 3.0 + 4.0)) - 0.5) * 0.003 * uShimmer * band;
      }
      vec2 q = uv - 0.5;
      vec2 ca = q * uAberration * dot(q, q) * 4.0;
      vec3 c = vec3(texture2D(tDiffuse, uv + ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - ca).b);

      // grade: contrast, saturation, split toning, lift/gain
      c = (c - 0.5) * uContrast + 0.5;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c += uShadowTint * (1.0 - smoothstep(0.0, 0.5, l)) + uHighTint * smoothstep(0.45, 1.0, l);
      c = uLift + c * (uGain - uLift);

      // title: sand-coloured letters that break into grains and blow away
      vec2 cell = floor(vUv * uRes / 2.0);
      float gh = hash12(cell);
      vec2 off = uTitleWind * uTitleDissolve * (0.12 + 0.4 * gh) + vec2(0.0, 0.05 * uTitleDissolve * (gh - 0.5));
      vec4 ti = texture2D(tTitle, vUv - off);
      if (uTitle > 0.0 && ti.a > 0.0) {
        // letters break into grains that drift downwind and fade as they go
        float keep = step(uTitleDissolve * 1.1, gh * (0.6 + 0.4 * vnoise(vUv * 8.0)));
        float fadeOut = uTitleDissolve > 0.0 ? keep * pow(1.0 - uTitleDissolve, 1.5) * (0.5 + 0.5 * gh) : 1.0;
        c = mix(c, ti.rgb, ti.a * uTitle * fadeOut);
      }

      // storm: layers of sand streaking sideways, fast near the lens
      if (uStreaks > 0.0) {
        float t = uFrame / 25.0;
        float s1 = vnoise(vec2(vUv.x * 3.0 - t * 9.0, vUv.y * 140.0));
        float s2 = vnoise(vec2(vUv.x * 6.0 - t * 15.0 + 7.0, vUv.y * 260.0 + 3.0));
        float s3 = vnoise(vec2(vUv.x * 1.5 - t * 5.0 + 2.0, vUv.y * 40.0 + 9.0));
        float st = smoothstep(0.55, 0.95, s1) * 0.5 + smoothstep(0.6, 0.98, s2) * 0.35 + smoothstep(0.4, 0.9, s3) * 0.25;
        c = mix(c, vec3(0.78, 0.55, 0.36) * (0.5 + 0.6 * l), clamp(st * uStreaks, 0.0, 0.8));
      }
      c += uFlashColor * uFlash;
      c *= uFade;

      vec2 vq = vUv - 0.5;
      c *= 1.0 - uVignette * dot(vq, vq) * 2.4;
      float gr = hash12(vUv * uRes + fract(uFrame * 0.618) * 1000.0) - 0.5;
      c += gr * uGrain * (0.6 + 0.8 * (1.0 - l));
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

export class Post {
  constructor(renderer, width, height) {
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType }));
    this.composer.setSize(width, height);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.rays = new ShaderPass(RaysShader);
    this.rays.uniforms.uAspect.value = width / height;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.35, 0.65, 0.9);
    this.output = new OutputPass();
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.uRes.value.set(width, height);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.rays);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.grade);
    this.g = this.grade.uniforms;
    this.r = this.rays.uniforms;
  }

  render(scene, camera) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    if (this.accum) {
      // motion blur: add this sub-frame (already graded) into the accumulator
      this.composer.renderToScreen = false;
      this.composer.render();
      const r = this.composer.renderer;
      this.copy.material.uniforms.tex.value = this.composer.readBuffer.texture;
      this.copy.material.uniforms.w.value = this.accum.weight;
      this.copy.material.blending = THREE.AdditiveBlending;
      r.setRenderTarget(this.accum.target);
      if (this.accum.first) { r.setClearColor(0x000000, 1); r.clear(); this.accum.first = false; }
      const auto = r.autoClear;
      r.autoClear = false; // accumulate, don't wipe the previous sub-frames
      this.copy.render(r);
      r.autoClear = auto;
      r.setRenderTarget(null);
    } else {
      this.composer.renderToScreen = true;
      this.composer.render();
    }
  }

  /** Start averaging `samples` sub-frames; call endAccum() to put the result on screen. */
  beginAccum(samples) {
    const { width, height } = this.composer.renderTarget1;
    if (!this.accumTarget || this.accumTarget.width !== width || this.accumTarget.height !== height) {
      this.accumTarget?.dispose();
      this.accumTarget = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType });
    }
    if (!this.copy) {
      this.copy = new FullScreenQuad(new THREE.ShaderMaterial({
        uniforms: { tex: { value: null }, w: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'uniform sampler2D tex; uniform float w; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tex, vUv).rgb * w, 1.0); }',
        depthTest: false, depthWrite: false, transparent: true,
      }));
    }
    this.accum = { target: this.accumTarget, weight: 1 / samples, first: true };
  }

  endAccum() {
    const r = this.composer.renderer;
    this.accum = null;
    this.copy.material.uniforms.tex.value = this.accumTarget.texture;
    this.copy.material.uniforms.w.value = 1;
    this.copy.material.blending = THREE.NoBlending;
    r.setRenderTarget(null);
    this.copy.render(r);
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.g.uRes.value.set(w, h);
    this.r.uAspect.value = w / h;
  }
}
