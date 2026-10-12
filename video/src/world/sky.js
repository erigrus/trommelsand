import * as THREE from 'three';
import { U, COMMON_GLSL } from './shared.js';

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}
`;

// The sky writes alpha = 0 (everything else is opaque) so the god-ray pass
// knows which pixels are open sky.
const frag = /* glsl */ `
${COMMON_GLSL}
varying vec3 vDir;

vec3 moon(vec3 dir, vec3 mdir, float size, vec3 tint) {
  float d = acos(clamp(dot(dir, mdir), -1.0, 1.0));
  vec3 halo = tint * (exp(-d * 18.0) * 0.12 + exp(-d * 5.0) * 0.04);
  float disc = 1.0 - smoothstep(size * 0.94, size, d);
  if (disc <= 0.0) return halo;
  vec3 side = normalize(cross(mdir, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(side, mdir);
  vec2 uv = vec2(dot(dir - mdir, side), dot(dir - mdir, up)) / size;
  vec3 nrm = normalize(vec3(uv, sqrt(max(0.0, 1.0 - dot(uv, uv)))));
  vec3 l = normalize(vec3(dot(uSunDir, side), dot(uSunDir, up), 0.45));
  float lit = smoothstep(-0.08, 0.3, dot(nrm, l));
  float maria = 0.72 + 0.28 * fbm(uv * 3.0 + mdir.xy * 10.0);
  float craters = 0.9 + 0.1 * fbm(uv * 14.0 + 3.0);
  return halo + tint * disc * (0.04 + lit * maria * craters);
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyColor(dir);

  // sun disc with limb darkening
  float sd = dot(dir, uSunDir);
  float r = acos(clamp(sd, -1.0, 1.0)) / uSunSize;
  float disc = 1.0 - smoothstep(0.85, 1.0, r);
  float limb = sqrt(max(0.0, 1.0 - min(r, 1.0) * min(r, 1.0)));
  col += uSunColor * disc * (3.0 + 6.0 * limb) * (1.0 - uStorm);

  // thin high cloud streaks, lit from below at dawn and dusk
  if (uClouds > 0.0 && dir.y > 0.0) {
    vec2 uv = dir.xz / (dir.y + 0.08);
    float c = fbm(vec2(uv.x * 0.9 + uTime * 0.004, uv.y * 3.5));
    c = smoothstep(0.45, 0.85, c) * smoothstep(0.0, 0.12, dir.y) * (1.0 - smoothstep(0.5, 0.9, dir.y));
    vec3 cl = mix(uHorizon * 1.1, uSunColor * 1.4, pow(max(sd, 0.0), 3.0));
    col = mix(col, cl, c * uClouds * 0.7);
  }

  // night: stars, the milky way, two moons
  if (uNight > 0.0) {
    float hz = smoothstep(0.0, 0.25, dir.y) * (1.0 - uStorm);
    vec2 sp = vec2(atan(dir.z, dir.x) * 320.0, dir.y * 320.0);
    float s = step(0.9965, hash12(floor(sp))) * (0.4 + 0.6 * hash12(floor(sp) + 9.0));
    float tw = 0.75 + 0.25 * sin(uTime * 3.0 + hash12(floor(sp)) * 40.0);
    col += vec3(0.9, 0.95, 1.0) * s * tw * uNight * hz;
    vec3 band = normalize(vec3(0.35, 0.55, -0.76));
    float b = exp(-pow(dot(dir, band) * 4.5, 2.0));
    float dustLane = fbm(vec2(atan(dir.z, dir.x) * 4.0, dir.y * 6.0));
    col += vec3(0.55, 0.6, 0.85) * b * smoothstep(0.35, 0.8, dustLane) * 0.11 * uNight * hz;
    col += moon(dir, uMoonDir1, 0.055, vec3(1.0, 0.94, 0.84)) * uNight * 2.2;
    col += moon(dir, uMoonDir2, 0.03, vec3(0.86, 0.88, 1.0)) * uNight * 2.2;
  }

  if (uStorm > 0.0) col = mix(col, stormDust(dir, 3.0), uStorm * 0.92);
  vec3 wc;
  float w = stormWall(dir, 1e9, wc);
  col = mix(col, wc, w);
  gl_FragColor = vec4(col, 0.0);
}
`;

export class Sky {
  constructor(scene) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: U,
      side: THREE.BackSide, depthWrite: false, depthTest: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }
  follow(camera) {
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(camera.far * 0.95);
  }
}
