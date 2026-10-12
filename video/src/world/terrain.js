import * as THREE from 'three';
import { U, COMMON_GLSL } from './shared.js';
import { DUNE_GLSL, DISPLACE_GLSL, duneHeight } from './terrain-fn.js';

export const MAX_FEET = 24;

const vert = /* glsl */ `
${COMMON_GLSL}
${DUNE_GLSL}
${DISPLACE_GLSL}
uniform vec2 uCenter;
uniform float uDrop;
varying vec3 vWorld;
void main() {
  vec2 p = position.xz + uCenter;
  float h = terrainHeight(p) - uDrop;
  vWorld = vec3(p.x, h, p.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const frag = /* glsl */ `
${COMMON_GLSL}
${DUNE_GLSL}
${DISPLACE_GLSL}
uniform float uDrop;
uniform vec4 uFeet[${MAX_FEET}];   // x, z, heading, depth (0 = unused)
uniform vec3 uNear;                 // near grid: centre x, z, half size it fully covers
varying vec3 vWorld;

// Footprints: an oval dent with a small pushed-up rim.
float footHeight(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < ${MAX_FEET}; i++) {
    vec4 f = uFeet[i];
    if (f.w <= 0.0) continue;
    vec2 d = p - f.xy;
    if (dot(d, d) > 1.0) continue;
    float c = cos(f.z), s = sin(f.z);
    vec2 l = vec2(c * d.x - s * d.y, s * d.x + c * d.y) / vec2(0.13, 0.3);
    float r = dot(l, l);
    h += f.w * (-0.08 * exp(-r * 2.2) + 0.03 * exp(-(r - 1.4) * (r - 1.4) * 3.0));
  }
  return h;
}

float shadowMarch(vec3 p) {
  float res = 1.0;
  float t = 1.0;
  for (int i = 0; i < 32; i++) {
    vec3 q = p + uSunDir * t;
    float h = q.y - (duneHeight(q.xz) + moundHeight(q.xz));
    res = min(res, 12.0 * h / t);
    if (res < 0.0) break;
    t *= 1.2;
    if (t > 2500.0) break;
  }
  return smoothstep(0.0, 1.0, res);
}

float fineHeight(vec2 q, bool near) {
  float h = terrainHeight(q);
  if (near) h += footHeight(q);
  return h;
}

void main() {
  vec3 p = vWorld;
  // the coarse grid only fills in beyond the fine one: its long triangles span
  // troughs above the real floor and would poke through (hiding the walker)
  if (uDrop > 0.0 && max(abs(p.x - uNear.x), abs(p.z - uNear.y)) < uNear.z) discard;
  vec3 toCam = uCamPos - p;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  bool near = dist < 60.0;
  float e = max(0.04, dist * 0.0022);
  float hx = fineHeight(p.xz + vec2(e, 0.0), near) - fineHeight(p.xz - vec2(e, 0.0), near);
  float hz = fineHeight(p.xz + vec2(0.0, e), near) - fineHeight(p.xz - vec2(0.0, e), near);
  vec3 n = normalize(vec3(-hx, 2.0 * e, -hz));

  // curvature at dune scale: troughs collect shade, crests are wind-sorted and pale
  float E = 16.0;
  float hc = duneHeight(p.xz);
  float lap = (duneHeight(p.xz + vec2(E, 0.0)) + duneHeight(p.xz - vec2(E, 0.0))
             + duneHeight(p.xz + vec2(0.0, E)) + duneHeight(p.xz - vec2(0.0, E))) * 0.25 - hc;
  float ao = clamp(1.0 - lap * 0.05, 0.5, 1.0);
  float crest = clamp(-lap * 0.1, 0.0, 1.0);

  // wind ripples on the gentle slopes, none on steep lee faces; faded with distance
  float slope = 1.0 - n.y;
  float envR = duneEnv(p.xz);
  float fade = (1.0 - smoothstep(25.0, 320.0, dist)) * uRipple * (1.0 - smoothstep(0.25, 0.5, slope)) * (0.3 + 0.7 * envR);
  if (fade > 0.0) {
    float warp = fbm(p.xz * 0.04) * 7.0;
    float ph = p.x * 1.9 + warp + sin(p.z * 0.09) * 1.8;
    float aa = 1.0 - smoothstep(0.6, 2.2, fwidth(ph));   // ripples finer than a pixel alias into speckle
    float r = sin(ph) + 0.4 * sin(ph * 2.0 + 1.3) * (1.0 - smoothstep(0.3, 1.1, fwidth(ph)));
    r *= (0.4 + 0.6 * vnoise(p.xz * 0.25)) * aa;
    n = normalize(n + vec3(r * 0.11 * fade, 0.0, r * 0.03 * fade));
  }
  float fine = (1.0 - smoothstep(3.0, 14.0, dist)) * uRipple;
  if (fine > 0.0) {
    float ph = p.x * 17.0 + fbm(p.xz * 0.6) * 9.0 + sin(p.z * 1.3) * 1.2;
    n = normalize(n + vec3(sin(ph) * 0.12 * fine * (1.0 - smoothstep(0.6, 2.2, fwidth(ph))), 0.0, 0.0));
  }

  // albedo
  float env = duneEnv(p.xz);
  vec3 alb = uSand;
  alb *= mix(0.86, 1.1, crest);
  alb *= mix(1.0, 0.9, smoothstep(0.3, 0.7, slope));        // lee faces: coarser, darker
  // basins: pale hardpan cracked into polygons (visible up close)
  if (env < 0.6 && dist < 160.0) {
    vec2 cp = p.xz * 0.7;
    vec2 ci = floor(cp);
    float d1 = 9.0, d2 = 9.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 pt = o + vec2(hash12(ci + o), hash12(ci + o + 7.3)) * 0.85;
      float dd = length(cp - ci - pt);
      if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
    }
    float crack = (1.0 - smoothstep(0.02, 0.06, d2 - d1)) * (1.0 - smoothstep(0.06, 0.25, length(fwidth(cp))));
    alb *= 1.0 - crack * 0.45 * (1.0 - env / 0.6) * (1.0 - smoothstep(60.0, 160.0, dist));
  }
  alb = mix(alb * vec3(1.08, 0.98, 0.9), alb, env);           // pale hardpan in basins
  alb *= 0.94 + 0.12 * fbm(p.xz * 0.015);
  alb *= 0.95 + 0.1 * hash12(floor(p.xz * 14.0)) * (1.0 - smoothstep(0.5, 1.5, length(fwidth(p.xz * 14.0))));

  // light
  vec3 L = uSunDir;
  float sunUp = smoothstep(-0.04, 0.06, L.y);
  float ndl = dot(n, L);
  float sh = mix(1.0, shadowMarch(p + n * 0.3), uShadow);
  vec3 direct = uSunColor * max(ndl, 0.0) * sh * sunUp * 1.9;
  vec3 skyAmb = mix(uHorizon * 0.7, uZenith, clamp(n.y, 0.0, 1.0)) * 0.38 + uAmbient * 0.3;
  vec3 bounce = uSand * uSunColor * sunUp * 0.3 * clamp(1.0 - n.y + 0.2, 0.0, 1.0);
  float ndv = max(dot(n, V), 0.0);
  float fres = pow(1.0 - ndv, 5.0);
  float back = pow(max(dot(-V, L), 0.0), 2.0);
  vec3 sheen = uSunColor * fres * (0.2 + 1.4 * back) * sh * sunUp;
  vec3 col = alb * (direct + (skyAmb + bounce) * ao) + alb * sheen * 0.8;

  // glints: sparse grains that mirror the sun toward the camera, flicker on cymbals
  if (dist < 140.0) {
    vec2 gc = floor(p.xz * 6.0);
    float gh = hash12(gc + floor(uTime * 14.0) * 0.37);
    vec3 gn = normalize(n + (vec3(hash12(gc + 1.7), 0.0, hash12(gc + 3.1)) - 0.5) * 0.9);
    float spec = pow(max(dot(reflect(-L, gn), V), 0.0), 40.0);
    // fade glints once a grain cell is smaller than a pixel (they alias into speckle)
    float g = step(0.97, gh) * spec * (1.0 - smoothstep(0.35, 1.2, length(fwidth(p.xz * 6.0))));
    col += uSunColor * g * (0.6 + 4.0 * uGlint) * sh * sunUp * (1.0 - smoothstep(30.0, 140.0, dist));
  }

  // moonlight at night: cool fill from the bigger moon
  col += alb * vec3(0.3, 0.42, 0.75) * max(dot(n, uMoonDir1), 0.0) * uNight * 0.45;

  // night: the ring wave fronts glow
  col += uRingGlow * ringsLift(p.xz);

  col = applyFog(col, p);
  gl_FragColor = vec4(col, 1.0);
}
`;

function grid(size, segs) {
  const g = new THREE.PlaneGeometry(size, size, segs, segs);
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * Two camera-following grids (fine near, coarse far). Their centres snap to the
 * vertex spacing so vertices always sit on the same world lattice: no swimming.
 */
export class Terrain {
  constructor(scene, { nearSegs = 640, nearSize = 1600, farSegs = 320, farSize = 14000 } = {}) {
    this.feet = { value: Array.from({ length: MAX_FEET }, () => new THREE.Vector4()) };
    this.near = { value: new THREE.Vector3(0, 0, nearSize / 2 - 2 * (nearSize / nearSegs)) };
    this.levels = [
      { size: nearSize, segs: nearSegs, drop: 0 },
      { size: farSize, segs: farSegs, drop: 2.0 },
    ].map((l) => {
      const uniforms = { ...U, uCenter: { value: new THREE.Vector2() }, uDrop: { value: l.drop }, uFeet: this.feet, uNear: this.near };
      const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms });
      const mesh = new THREE.Mesh(grid(l.size, l.segs), mat);
      mesh.frustumCulled = false;
      scene.add(mesh);
      return { ...l, step: l.size / l.segs, mesh, uniforms };
    });
  }

  follow(x, z) {
    for (const l of this.levels) {
      l.uniforms.uCenter.value.set(Math.round(x / l.step) * l.step, Math.round(z / l.step) * l.step);
    }
    const c = this.levels[0].uniforms.uCenter.value;
    this.near.value.x = c.x;
    this.near.value.y = c.y;
  }

  /**
   * Dune height as the grid actually draws it at (x, z): exact on the vertex
   * lattice, linear across each triangle. On a sharp crest this is lower than
   * duneHeight(), so figures stand on this to keep their feet on the sand.
   * Call after follow(). Rings and mounds are left out.
   */
  drawnHeight(x, z) {
    for (const l of this.levels) {
      const c = l.uniforms.uCenter.value, half = l.size / 2 - l.step;
      if (Math.abs(x - c.x) > half || Math.abs(z - c.y) > half) continue;
      const s = l.step, i = Math.floor(x / s), j = Math.floor(z / s);
      const u = x / s - i, v = z / s - j;
      const h = (a, b) => duneHeight(a * s, b * s);
      // PlaneGeometry (rotated to xz) splits each cell along (x0, z1)-(x1, z0)
      const y = u + v <= 1
        ? h(i, j) + u * (h(i + 1, j) - h(i, j)) + v * (h(i, j + 1) - h(i, j))
        : h(i + 1, j + 1) + (1 - u) * (h(i, j + 1) - h(i + 1, j + 1)) + (1 - v) * (h(i + 1, j) - h(i + 1, j + 1));
      return y - l.uniforms.uDrop.value;
    }
    return duneHeight(x, z);
  }

  /** feet: [[x, z, heading, depth], ...] newest last */
  setFeet(feet) {
    const v = this.feet.value;
    v.forEach((f) => f.set(0, 0, 0, 0));
    feet.slice(-MAX_FEET).forEach((f, i) => v[i].set(...f));
  }

  set visible(v) { for (const l of this.levels) l.mesh.visible = v; }
}
