import * as THREE from 'three';
import { U, COMMON_GLSL } from './shared.js';
import { DUNE_GLSL, DISPLACE_GLSL } from './terrain-fn.js';

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
varying vec3 vWorld;

float shadowMarch(vec3 p) {
  // march toward the sun over the macro dunes; soft penumbra
  float res = 1.0;
  float t = 2.0;
  for (int i = 0; i < 28; i++) {
    vec3 q = p + uSunDir * t;
    float h = q.y - (duneHeight(q.xz) + moundHeight(q.xz));
    res = min(res, 10.0 * h / t);
    if (res < 0.0) break;
    t *= 1.22;
    if (t > 1500.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

void main() {
  vec3 p = vWorld;
  float dist = length(p - uCamPos);
  float e = max(0.25, dist * 0.0025);
  float hx = terrainHeight(p.xz + vec2(e, 0.0)) - terrainHeight(p.xz - vec2(e, 0.0));
  float hz = terrainHeight(p.xz + vec2(0.0, e)) - terrainHeight(p.xz - vec2(0.0, e));
  vec3 n = normalize(vec3(-hx, 2.0 * e, -hz));

  // wind ripples (normal-only), faded with distance to avoid aliasing
  float fade = (1.0 - smoothstep(30.0, 260.0, dist)) * uRipple;
  if (fade > 0.0) {
    float warp = fbm(p.xz * 0.05) * 6.0;
    float ph = p.x * 1.6 + warp + sin(p.z * 0.11) * 1.5;
    float r = sin(ph) + 0.35 * sin(ph * 2.0 + 1.0);
    n = normalize(n + vec3(r * 0.22 * fade, 0.0, r * 0.05 * fade));
  }

  // albedo: crests a bit lighter, troughs darker and redder, grain noise
  float hN = clamp(duneHeight(p.xz) / 90.0, 0.0, 1.0);
  vec3 alb = uSand * mix(0.82, 1.08, hN);
  alb *= 0.93 + 0.14 * fbm(p.xz * 0.02);
  alb *= 0.96 + 0.08 * hash12(floor(p.xz * 12.0));

  float ndl = dot(n, uSunDir);
  float diff = max(ndl * 0.85 + 0.15, 0.0);     // slight wrap: sand scatters
  float sh = mix(1.0, shadowMarch(p + n * 0.3), uShadow);
  float sunUp = smoothstep(-0.05, 0.05, uSunDir.y);
  vec3 col = alb * (uAmbient * (0.55 + 0.45 * n.y) + uSunColor * diff * sh * 2.2 * sunUp);

  // cymbal glints: sparse cells that face the sun flicker on hits
  vec2 gc = floor(p.xz * 5.0);
  float g = step(0.985, hash12(gc + floor(uTime * 12.0)));
  float near = 1.0 - smoothstep(10.0, 120.0, dist);
  col += uSunColor * g * uGlint * near * sh * 3.0 * sunUp;

  // moonlight at night: cool fill from the bigger moon
  col += alb * vec3(0.35, 0.45, 0.7) * max(dot(n, uMoonDir1), 0.0) * uNight * 0.35;

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
  constructor(scene, { nearSegs = 640, nearSize = 1600, farSegs = 320, farSize = 12000 } = {}) {
    this.levels = [
      { size: nearSize, segs: nearSegs, drop: 0 },
      { size: farSize, segs: farSegs, drop: 1.5 },
    ].map((l) => {
      const uniforms = { ...U, uCenter: { value: new THREE.Vector2() }, uDrop: { value: l.drop } };
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
  }

  set visible(v) { for (const l of this.levels) l.mesh.visible = v; }
}
