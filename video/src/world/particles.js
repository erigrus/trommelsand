import * as THREE from 'three';
import { U, COMMON_GLSL } from './shared.js';
import { DUNE_GLSL, DISPLACE_GLSL } from './terrain-fn.js';
import { rng } from '../core/util.js';

// Stateless particles: every position is a closed-form function of (seed, time)
// so any frame can be rendered in isolation. Flavours (uMode):
//   0 dust    — grains near the ground; jump at ring wave fronts and on hits
//   1 drift   — spindrift: sand streaming off dune crests downwind (snare = gusts)
//   2 motes   — big soft out-of-focus grains right in front of the lens
//   3 rise    — glowing spice motes rising slowly (night)
//   4 pour    — sand pouring off a body curve (the worm), uCurve = 16 points
// All of them glow when the sun is behind them (forward scattering).

const vert = /* glsl */ `
${COMMON_GLSL}
${DUNE_GLSL}
${DISPLACE_GLSL}
attribute vec4 aSeed;
uniform float uMode;
uniform vec3 uBox;        // size of the camera-following box
uniform vec3 uWind;       // m/s
uniform float uGust;      // extra lift (snare / guitar hits)
uniform float uHover;     // 0..1 freeze grains in the air (break)
uniform float uSize;      // metres
uniform float uFocus;     // focus distance (m) for the bokeh size boost (0 = off)
uniform float uProjScale;   // pixels per metre at 1 m distance
uniform vec3 uColor;
uniform float uOpacity;
uniform vec4 uCurve[16];  // x, y, z, radius (mode 4)
varying float vAlpha;
varying vec3 vCol;

float crestness(vec2 p) {
  float E = 7.0;
  float h = duneHeight(p);
  float lap = (duneHeight(p + vec2(E, 0.0)) + duneHeight(p - vec2(E, 0.0)) + duneHeight(p + vec2(0.0, E)) + duneHeight(p - vec2(0.0, E))) * 0.25 - h;
  return clamp(-lap * 0.5, 0.0, 1.0);
}

void main() {
  vec3 box = uBox;
  vec3 base = aSeed.xyz * box;
  float speed = 0.6 + 0.8 * aSeed.w;
  vec3 p;
  float alpha = 1.0;

  if (uMode < 0.5 || (uMode > 2.5 && uMode < 3.5)) {
    p = base + uWind * uTime * speed;
    p.xz = mod(p.xz - uCamPos.xz + box.xz * 0.5, box.xz) + uCamPos.xz - box.xz * 0.5;
    float ground = terrainHeight(p.xz);
    float above;
    if (uMode > 2.5) {
      above = fract(aSeed.y + uTime * 0.02 * (0.4 + aSeed.w)) * box.y;
      alpha = smoothstep(0.0, 0.15, above / box.y) * (1.0 - smoothstep(0.7, 1.0, above / box.y));
    } else {
      above = pow(aSeed.y, 4.0) * box.y;
      above += ringsLift(p.xz) * (0.6 + 2.5 * aSeed.w);
      above += uGust * pow(aSeed.w, 2.0) * 6.0;
      above += uHover * (1.5 + 9.0 * aSeed.w);
    }
    p.y = ground + 0.05 + above;
    p.xz += vec2(sin(uTime * 1.3 + aSeed.x * 40.0), cos(uTime * 1.1 + aSeed.z * 40.0)) * 0.3;
  } else if (uMode < 1.5) {
    // spindrift: a particle leaves its source point, which only emits on crests
    float cyc = fract(aSeed.w * 7.13 + uTime * (0.25 + 0.35 * aSeed.y));
    vec2 o = base.xz;
    o = mod(o - uCamPos.xz + box.xz * 0.5, box.xz) + uCamPos.xz - box.xz * 0.5;
    float c = crestness(o);
    float gust = 1.0 + uGust * 2.0;
    vec2 wdir = normalize(uWind.xz + vec2(1e-4, 0.0));
    float travel = cyc * (6.0 + 22.0 * aSeed.y) * (0.6 + 0.4 * gust) * length(uWind.xz) / 6.0;
    p.xz = o + wdir * travel + vec2(-wdir.y, wdir.x) * sin(cyc * 6.0 + aSeed.z * 30.0) * 0.6;
    float h0 = duneHeight(o);
    float lift = (0.3 + 3.5 * aSeed.x * aSeed.x) * cyc * gust;
    p.y = max(h0 + lift - cyc * cyc * 2.0, terrainHeight(p.xz) + 0.05);
    alpha = smoothstep(0.25, 0.6, c) * sin(cyc * 3.14159) * min(1.0, 0.35 + uGust * 1.5);
  } else if (uMode > 3.5) {
    // sand pouring off the top of a moving body
    float fu = aSeed.x * 14.999;
    int i0 = int(floor(fu));
    float fr = fu - float(i0);
    vec4 a = uCurve[i0], b = uCurve[i0 + 1];
    vec3 c = mix(a.xyz, b.xyz, fr);
    float rad = mix(a.w, b.w, fr);
    vec3 side = normalize(cross(b.xyz - a.xyz + vec3(1e-3, 0.0, 0.0), vec3(0.0, 1.0, 0.0)));
    float ang = (aSeed.y - 0.5) * 2.8;
    vec3 start = c + (vec3(0.0, 1.0, 0.0) * cos(ang) + side * sin(ang)) * rad * 1.02;
    float cyc = fract(aSeed.w * 5.3 + uTime * (0.3 + 0.3 * aSeed.z));
    float tt = cyc * 2.6;
    p = start + side * sin(ang) * tt * 3.0 + uWind * tt * 0.4 + vec3(0.0, -4.9 * tt * tt, 0.0);
    alpha = step(terrainHeight(p.xz), p.y) * (1.0 - cyc) * step(0.5, rad) * smoothstep(0.0, 0.05, cyc);
  } else {
    // motes: big, slow, close to the lens
    p = base + uWind * uTime * 0.15 * speed;
    vec3 rel = mod(p - uCamPos + box * 0.5, box) - box * 0.5;
    p = uCamPos + rel;
    p.y += sin(uTime * 0.4 + aSeed.x * 20.0) * 0.4;
  }

  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  float size = uSize * (0.5 + aSeed.w);
  // defocus: grains far from the focus distance grow and fade (bokeh)
  float coc = uFocus > 0.0 ? abs(dist - uFocus) / max(dist, 0.1) : 0.0;
  size *= 1.0 + coc * 4.0;
  alpha /= 1.0 + coc * 6.0;
  // sub-pixel grains would flicker as hard dots: fade them out instead
  float px = size * uProjScale / max(dist, 0.3);
  alpha *= smoothstep(0.5, 1.8, px);
  gl_PointSize = max(px, 1.0);
  alpha *= smoothstep(0.2, 1.2, dist) * (1.0 - smoothstep(box.x * 0.32, box.x * 0.5, dist));
  vAlpha = alpha * uOpacity;

  // lighting: sand lit by sun + sky, strongly forward-scattering when backlit
  vec3 V = normalize(p - uCamPos);
  float fwd = pow(max(dot(V, uSunDir), 0.0), 5.0);
  float sunUp = smoothstep(-0.04, 0.06, uSunDir.y);
  vCol = uColor * (uAmbient * 0.8 + uZenith * 0.25 + uSunColor * sunUp * (0.55 + 3.5 * fwd));
}
`;

const frag = /* glsl */ `
uniform float uGlow;
uniform float uMode;
uniform vec3 uColor;
varying float vAlpha;
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c) * 4.0;
  if (r > 1.0) discard;
  float a = exp(-r * 3.0) * vAlpha;
  vec3 col = uMode > 2.5 ? uColor * (1.0 + uGlow * exp(-r * 6.0) * 3.0) : vCol;
  gl_FragColor = vec4(col, a);
}
`;

export class Particles {
  constructor(scene, { count = 30000, seed = 1, additive = false, mode = 0 } = {}) {
    const r = rng(seed);
    const s = new Float32Array(count * 4);
    for (let i = 0; i < s.length; i++) s[i] = r();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(s, 4));
    this.defaults = { uMode: mode };
    this.uniforms = {
      ...U,
      uMode: { value: mode },
      uBox: { value: new THREE.Vector3(160, 30, 160) },
      uWind: { value: new THREE.Vector3(3, 0, 0.5) },
      uGust: { value: 0 },
      uHover: { value: 0 },
      uSize: { value: 0.05 },
      uFocus: { value: 0 },
      uProjScale: { value: 1480 },
      uColor: { value: new THREE.Color(1, 0.85, 0.6) },
      uOpacity: { value: 0.7 },
      uGlow: { value: 0 },
      uCurve: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  set(params) {
    for (const [k, v] of Object.entries(params)) {
      const u = this.uniforms[k];
      if (!u) continue;
      if (u.value?.set && Array.isArray(v)) u.value.set(...v);
      else if (u.value?.copy && typeof v === 'object') u.value.copy(v);
      else u.value = v;
    }
  }

  set visible(v) { this.points.visible = v; }
}
