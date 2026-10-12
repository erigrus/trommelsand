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

const frag = /* glsl */ `
${COMMON_GLSL}
varying vec3 vDir;

vec3 moon(vec3 dir, vec3 mdir, float size, vec3 tint) {
  float d = acos(clamp(dot(dir, mdir), -1.0, 1.0));
  float disc = 1.0 - smoothstep(size * 0.92, size, d);
  if (disc <= 0.0) return vec3(0.0) + tint * exp(-d * 25.0) * 0.15;
  // crude sphere shading lit from the sun's side
  vec3 side = normalize(cross(mdir, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(side, mdir);
  vec2 uv = vec2(dot(dir - mdir, side), dot(dir - mdir, up)) / size;
  vec3 nrm = normalize(vec3(uv, sqrt(max(0.0, 1.0 - dot(uv, uv)))));
  vec3 l = normalize(vec3(dot(uSunDir, side), dot(uSunDir, up), 0.35));
  float lit = smoothstep(-0.1, 0.25, dot(nrm, l));
  float craters = 0.8 + 0.2 * fbm(uv * 4.0 + mdir.xy * 10.0);
  return tint * disc * (0.08 + lit * craters);
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyColor(dir);

  // sun disc
  float sd = dot(dir, uSunDir);
  float disc = smoothstep(cos(uSunSize), cos(uSunSize * 0.8), sd);
  col += uSunColor * disc * 6.0 * (1.0 - uStorm);

  // night: stars + two moons
  if (uNight > 0.0) {
    vec2 sp = vec2(atan(dir.z, dir.x) * 300.0, dir.y * 300.0);
    float s = step(0.9975, hash12(floor(sp))) * smoothstep(0.02, 0.25, dir.y);
    col += vec3(s) * uNight * 0.9 * (1.0 - uStorm);
    col += moon(dir, uMoonDir1, 0.06, vec3(0.95, 0.92, 0.85)) * uNight * 2.0;
    col += moon(dir, uMoonDir2, 0.035, vec3(0.85, 0.85, 0.95)) * uNight * 2.0;
  }

  // storm streaks
  if (uStorm > 0.0) {
    float n = fbm(vec2(atan(dir.z, dir.x) * 6.0 - uTime * 1.8, dir.y * 14.0));
    col *= mix(1.0, 0.6 + 0.7 * n, uStorm);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  constructor(scene) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: U,
      side: THREE.BackSide, depthWrite: false,
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
