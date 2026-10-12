import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// Final look, applied in display space after tone mapping:
// heat shimmer, grade (contrast/saturation/tint), title composite with a sand
// dissolve, flash / fade, vignette, film grain.
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
    uVignette: { value: 0.35 },
    uGrain: { value: 0.05 },
    uShimmer: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uFade: { value: 1 },            // 1 = visible, 0 = black
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
    uniform float uFrame, uContrast, uSaturation, uVignette, uGrain, uShimmer, uFlash, uFade;
    uniform vec3 uLift, uGain, uFlashColor;
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
      // heat shimmer: strongest just below the horizon band in the middle of the frame
      if (uShimmer > 0.0) {
        float band = smoothstep(0.25, 0.5, uv.y) * (1.0 - smoothstep(0.5, 0.7, uv.y));
        float t = uFrame / 25.0;
        uv.x += (vnoise(vec2(uv.y * 90.0, t * 3.0)) - 0.5) * 0.004 * uShimmer * band;
        uv.y += (vnoise(vec2(uv.x * 60.0, t * 2.3 + 4.0)) - 0.5) * 0.003 * uShimmer * band;
      }
      vec3 c = texture2D(tDiffuse, uv).rgb;

      // grade
      c = (c - 0.5) * uContrast + 0.5;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c = uLift + c * (uGain - uLift);

      // title: sand-coloured letters that break into grains and blow away
      vec4 ti = texture2D(tTitle, vUv - uTitleWind * uTitleDissolve * 0.25 * hash12(floor(vUv * uRes / 2.0)));
      if (uTitle > 0.0 && ti.a > 0.0) {
        float grainMask = step(uTitleDissolve * 1.1, hash12(floor(vUv * uRes / 2.0)) * (0.6 + 0.4 * vnoise(vUv * 8.0)));
        c = mix(c, ti.rgb, ti.a * uTitle * grainMask);
      }

      c += uFlashColor * uFlash;
      c *= uFade;

      vec2 q = vUv - 0.5;
      c *= 1.0 - uVignette * dot(q, q) * 2.2;
      c += (hash12(vUv * uRes + fract(uFrame * 0.618) * 1000.0) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

export class Post {
  constructor(renderer, width, height) {
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType }));
    this.composer.setSize(width, height);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.35, 0.6, 0.85);
    this.output = new OutputPass();
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.uRes.value.set(width, height);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.grade);
    this.g = this.grade.uniforms;
  }

  render(scene, camera) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.composer.render();
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.g.uRes.value.set(w, h);
  }
}
