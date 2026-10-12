import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { duneHeight } from './terrain-fn.js';
import { RIM } from './figures.js';
import { rng } from '../core/util.js';

// The walker: a rigged human (Soldier.glb from mixamo.com via the three.js
// examples, fetched by `npm run models`, not committed) dressed in cloth that
// is built around the bind pose and SKINNED to the same skeleton, so the robe
// swings with the thighs and the sleeves follow the arms. Only vertices marked
// with aFlutter (robe hem, scarf, cape edge) move in the wind.
//
// Bind space of the model: centimetres, +Z up, +Y forward, character's right = +X.
// The model's root node turns that into metres, +Y up, facing -Z.

// .glb from `npm run models`; the .json (same model as glTF JSON) is what the web build adds
// for hosts that don't serve .glb
const MODEL_URLS = ['models/Soldier.glb', 'models/Soldier.json'];

// ---------------------------------------------------------------------------
// generated textures (deterministic): woven, worn, dusty cloth
// ---------------------------------------------------------------------------
function clothTextures(seed, base, { size = 512, stripes = 0 } = {}) {
  const r = rng(seed);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const img = g.createImageData(size, size);
  const bump = new Uint8ClampedArray(size * size);
  // low-frequency wear blotches
  const blot = [];
  for (let i = 0; i < 40; i++) blot.push([r() * size, r() * size, 20 + r() * 90, r() * 0.5 - 0.25]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // plain weave: alternating over/under threads
      const wx = Math.sin((x / size) * Math.PI * 2 * 96), wy = Math.sin((y / size) * Math.PI * 2 * 96);
      const weave = ((Math.floor(x / 2.67) + Math.floor(y / 2.67)) % 2 ? wx : wy) * 0.5 + 0.5;
      let wear = 0;
      for (const [bx, by, br, bv] of blot) {
        const dx = Math.min(Math.abs(x - bx), size - Math.abs(x - bx)), dy = Math.min(Math.abs(y - by), size - Math.abs(y - by));
        wear += bv * Math.exp(-(dx * dx + dy * dy) / (br * br));
      }
      const streak = stripes ? 0.06 * Math.sin((x / size) * Math.PI * 2 * stripes + Math.sin(y * 0.05)) : 0;
      const fibre = (r() - 0.5) * 0.08;
      const k = 0.82 + 0.12 * weave + wear + streak + fibre;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, base[0] * k);
      img.data[i + 1] = Math.min(255, base[1] * k);
      img.data[i + 2] = Math.min(255, base[2] * k);
      img.data[i + 3] = 255;
      bump[y * size + x] = 128 + weave * 70 + fibre * 300;
    }
  }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  const bc = document.createElement('canvas');
  bc.width = bc.height = size;
  const bimg = bc.getContext('2d').createImageData(size, size);
  for (let i = 0; i < bump.length; i++) bimg.data.set([bump[i], bump[i], bump[i], 255], i * 4);
  bc.getContext('2d').putImageData(bimg, 0, 0);
  const bumpMap = new THREE.CanvasTexture(bc);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  return { map, bumpMap };
}

/** Skinned cloth material: rim light + wind flutter on aFlutter vertices only. */
function clothMaterial(tex, { repeat = [3, 3], side = THREE.FrontSide, tatter = 0 } = {}) {
  tex.map.repeat.set(...repeat);
  tex.bumpMap.repeat.set(...repeat);
  const m = new THREE.MeshStandardMaterial({ map: tex.map, bumpMap: tex.bumpMap, bumpScale: 0.6, roughness: 0.95, side, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = RIM;
    sh.uniforms.uFlutter = WALKER_WIND;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFlutter;\nuniform vec4 uFlutter;\nvarying vec2 vClothUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvClothUv = uv;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (aFlutter > 0.0) {
          // wind in bind space (cm); uFlutter.xyz = wind direction * strength, w = time
          float ph = uFlutter.w * 8.0 + position.z * 0.06 + position.x * 0.05;
          vec3 w = uFlutter.xyz;
          vec3 side = normalize(cross(w + vec3(0.0, 0.0, 1e-3), vec3(0.0, 0.0, 1.0)));
          transformed += (w * (0.6 + 0.4 * sin(ph)) + side * 0.5 * length(w) * sin(ph * 1.3 + 1.0)
                        + vec3(0.0, 0.0, 0.3 * length(w) * sin(ph * 1.7))) * aFlutter * 14.0;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;\nvarying vec2 vClothUv;')
      .replace('void main() {', `void main() {
        // frayed, torn hem: ragged cut-outs along the bottom edge
        if (${tatter.toFixed(3)} > 0.0) {
          float u = vClothUv.x * 64.0;
          float n = fract(sin(floor(u) * 12.9898) * 43758.5453) * 0.6 + fract(sin(floor(u * 3.7) * 78.233) * 12543.21) * 0.4;
          if (vClothUv.y > 1.0 - ${tatter.toFixed(3)} * n) discard;
        }`)
      .replace('#include <opaque_fragment>', `
        float rimF = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 4.0);
        outgoingLight += uRim * rimF * (0.35 + 1.6 * diffuseColor.rgb);
        #include <opaque_fragment>`);
  };
  return m;
}

export const WALKER_WIND = { value: new THREE.Vector4(0, 0, 0, 0) };

// ---------------------------------------------------------------------------
// cloth geometry in bind space, with skin indices/weights and flutter weights
// ---------------------------------------------------------------------------
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * A closed tube around the body's vertical axis. profile: [[z, rx, ry], ...]
 * from top to bottom. weightFn(x, y, z) -> [[boneIndex, w], ...] (≤ 4).
 * flutterFn(z, angle) -> 0..1. folds deepen with foldFn(z).
 */
function bodyTube(profile, { cx = 0, cy = -2, seg = 48, rows = 60, weightFn, flutterFn, foldFn = () => 0, open = null, color }) {
  const pos = [], uv = [], idx = [], sIdx = [], sW = [], flut = [], col = [];
  const zTop = profile[0][0], zBot = profile[profile.length - 1][0];
  const sample = (z) => {
    for (let i = 0; i < profile.length - 1; i++) {
      const [z0, a0, b0] = profile[i], [z1, a1, b1] = profile[i + 1];
      if (z <= z0 && z >= z1) { const f = (z0 - z) / (z0 - z1); const e = f * f * (3 - 2 * f); return [a0 + (a1 - a0) * e, b0 + (b1 - b0) * e]; }
    }
    return profile[profile.length - 1].slice(1);
  };
  const cols = open ? seg : seg + 1;
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const z = zTop + (zBot - zTop) * v;
    const [rx, ry] = sample(z);
    for (let s = 0; s < cols; s++) {
      const u = s / seg;
      let a = u * Math.PI * 2;
      if (open) a = open[0] + (open[1] - open[0]) * (s / (cols - 1));
      const fold = 1 + foldFn(z) * (Math.sin(a * 9 + z * 0.08) * 0.6 + Math.sin(a * 4 + 1.3) * 0.4);
      // angle 0 = forward (+y); x = sin, y = cos
      const x = cx + Math.sin(a) * rx * fold, y = cy + Math.cos(a) * ry * fold;
      pos.push(x, y, z);
      uv.push(open ? s / (cols - 1) : u, v);
      const ws = weightFn(x, y, z);
      const total = ws.reduce((t, w) => t + w[1], 0) || 1;
      for (let k = 0; k < 4; k++) { sIdx.push(ws[k] ? ws[k][0] : 0); sW.push(ws[k] ? ws[k][1] / total : 0); }
      flut.push(flutterFn ? flutterFn(z, a) : 0);
      const c = color(z, a);
      col.push(c[0], c[1], c[2]);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < cols - 1; s++) {
      const a = r * cols + s, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, b, c, b, d, c);   // outward-facing winding
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sIdx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sW, 4));
  g.setAttribute('aFlutter', new THREE.Float32BufferAttribute(flut, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A tube along a straight bone segment (sleeves), skinned upper -> lower bone. */
function boneTube(p0, p1, r0, r1, bA, bB, { seg = 14, rows = 12, color }) {
  const pos = [], uv = [], idx = [], sIdx = [], sW = [], flut = [], col = [];
  const axis = new THREE.Vector3().subVectors(p1, p0);
  const len = axis.length();
  axis.normalize();
  const up = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const n1 = new THREE.Vector3().crossVectors(axis, up).normalize();
  const n2 = new THREE.Vector3().crossVectors(axis, n1).normalize();
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const c = p0.clone().addScaledVector(axis, len * v);
    const rad = r0 + (r1 - r0) * v;
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const p = c.clone().addScaledVector(n1, Math.cos(a) * rad).addScaledVector(n2, Math.sin(a) * rad * 1.1);
      pos.push(p.x, p.y, p.z);
      uv.push(s / seg, v);
      const wB = smooth(0.35, 0.65, v);
      sIdx.push(bA, bB, 0, 0);
      sW.push(1 - wB, wB, 0, 0);
      flut.push(v > 0.85 ? (v - 0.85) * 2 : 0);
      const cc = color(v);
      col.push(cc[0], cc[1], cc[2]);
    }
  }
  for (let r = 0; r < rows; r++) for (let s = 0; s < seg; s++) {
    const a = r * (seg + 1) + s, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sIdx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sW, 4));
  g.setAttribute('aFlutter', new THREE.Float32BufferAttribute(flut, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Two scarf tails trailing from the back of the neck, skinned to Neck/Spine2. */
function scarfTails(neckIdx, spineIdx, neck, color) {
  const pos = [], uv = [], idx = [], sIdx = [], sW = [], flut = [], col = [];
  let base = 0;
  for (const [ox, len] of [[-3, 95], [3.5, 80]]) {
    const rows = 20;
    for (let r = 0; r <= rows; r++) {
      const v = r / rows;
      const w = (9 - 6 * v) * (1 - 0.15 * Math.sin(v * 30) * v);
      for (const side of [-1, 1]) {
        // hangs down the back, then trails: bind shape is a gentle fall behind the body
        pos.push(neck.x + ox + side * w * 0.5, neck.y - 14 - v * 18, neck.z - 4 - v * len * 0.85);
        uv.push(side < 0 ? 0 : 1, v);
        sIdx.push(neckIdx, spineIdx, 0, 0);
        sW.push(1 - v * 0.6, v * 0.6, 0, 0);
        flut.push(Math.pow(v, 1.3) * 1.6);
        const c = color(v);
        col.push(c[0], c[1], c[2]);
      }
    }
    for (let r = 0; r < rows; r++) {
      const a = base + r * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    base += (rows + 1) * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sIdx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sW, 4));
  g.setAttribute('aFlutter', new THREE.Float32BufferAttribute(flut, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------

export class RiggedWalker {
  /** Resolves to a RiggedWalker, or null when the model is missing. */
  static async load(scene) {
    for (const u of MODEL_URLS) {
      try {
        const gltf = await new GLTFLoader().loadAsync(new URL(u, document.baseURI).href);
        return new RiggedWalker(scene, gltf);
      } catch (e) {
        console.warn(`[walker] ${u}: ${e.message}`);
      }
    }
    console.warn('[walker] model not available, using the procedural walker');
    return null;
  }

  constructor(scene, gltf) {
    this.root = new THREE.Group();          // world placement (position, heading)
    this.model = gltf.scene;                // Character node: cm -> m, z-up -> y-up
    this.root.add(this.model);
    scene.add(this.root);

    const body = this.model.getObjectByName('vanguard_Mesh');
    const visor = this.model.getObjectByName('vanguard_visor');
    const skeleton = body.skeleton;
    this.skeleton = skeleton;
    // GLTFLoader strips ':' from node names (mixamorig:Hips -> mixamorigHips)
    const bi = (name) => {
      const i = skeleton.bones.findIndex((b) => b.name === `mixamorig${name}` || b.name === `mixamorig:${name}`);
      if (i < 0) throw new Error(`bone ${name} not found`);
      return i;
    };
    const bindPos = (name) => new THREE.Vector3().setFromMatrixPosition(skeleton.boneInverses[bi(name)].clone().invert());
    this.bone = (name) => skeleton.bones[bi(name)];

    // only the legs, boots and hands of the armour stay visible (dark, dusty leather);
    // everything the cloth covers is discarded so it can never poke through
    this.hideUpperBody(body, skeleton);
    visor.visible = false;
    body.frustumCulled = false;

    const B = {
      hips: bi('Hips'), spine: bi('Spine'), spine1: bi('Spine1'), spine2: bi('Spine2'), neck: bi('Neck'), head: bi('Head'),
      lUp: bi('LeftUpLeg'), rUp: bi('RightUpLeg'), lArm: bi('LeftArm'), lFore: bi('LeftForeArm'), rArm: bi('RightArm'), rFore: bi('RightForeArm'),
    };
    const hipZ = bindPos('Hips').z;

    const robeTex = clothTextures(7, [134, 104, 78], { stripes: 0 });
    const capeTex = clothTextures(11, [112, 80, 56], { stripes: 5 });
    const scarfTex = clothTextures(13, [164, 98, 58], { stripes: 3 });
    const dusty = (z) => {
      const d = smooth(70, 5, z); // dust collects toward the hem
      return [0.85 + 0.35 * d, 0.85 + 0.3 * d, 0.85 + 0.22 * d];
    };

    // torso -> spine bones by height; below the hips -> thighs by side, anchored to the hips
    const spineWeights = (z) => {
      if (z > 150) return [[B.neck, smooth(150, 158, z)], [B.spine2, 1 - smooth(150, 158, z)]];
      if (z > 133) return [[B.spine2, smooth(126, 140, z)], [B.spine1, 1 - smooth(126, 140, z)]];
      if (z > 118) return [[B.spine1, smooth(112, 126, z)], [B.spine, 1 - smooth(112, 126, z)]];
      return [[B.spine, smooth(hipZ, 116, z)], [B.hips, 1 - smooth(hipZ, 116, z)]];
    };
    const robeWeights = (x, y, z) => {
      if (z >= hipZ) return spineWeights(z);
      const anchor = 0.55 - 0.35 * smooth(hipZ, 20, z);   // hips share: more near the waist
      const left = smooth(7, -7, x);                       // character's left is -x
      return [[B.hips, anchor], [B.lUp, (1 - anchor) * left], [B.rUp, (1 - anchor) * (1 - left)]];
    };

    // the armour above the knees is hidden, so the cloth follows natural
    // proportions: shoulders, waist, hips, then a wide hem
    const robeProfile = [[157, 8, 8], [152, 14, 10.5], [147, 20, 12.5], [138, 19.5, 13], [124, 16.5, 12], [110, 18.5, 13.5],
      [98, 21, 16], [72, 26, 21], [42, 30, 25], [12, 34, 29]];
    const robeGeo = bodyTube(robeProfile, {
      cy: -3, weightFn: robeWeights, rows: 70, seg: 56,
      foldFn: (z) => 0.07 * smooth(120, 20, z),
      flutterFn: (z) => 0.6 * Math.pow(smooth(80, 10, z), 1.5),
      color: (z) => dusty(z),
    });
    const capeProfile = [[156, 9, 8.5], [152, 16, 12], [148, 23, 14.5], [140, 24, 15.5], [128, 23.5, 15.5], [114, 22.5, 15.5]];
    const capeGeo = bodyTube(capeProfile, {
      cy: -3.5, weightFn: (x, y, z) => spineWeights(Math.max(z, 125)), rows: 24, seg: 56,
      foldFn: (z) => 0.05 * smooth(140, 114, z),
      flutterFn: (z) => 0.35 * smooth(126, 114, z),
      color: () => [1, 1, 1],
    });
    // pointed hood drawn forward; the face opening shows a dark void
    const head = bindPos('Head');
    const hoodGeo = bodyTube([[192, 1.5, 1.5], [188, 7, 8], [180, 12, 13], [170, 13, 14], [161, 12, 12.5], [154, 13.5, 12.5], [150, 16, 13]], {
      cx: head.x, cy: head.y - 4.5, rows: 24, seg: 40, open: [0.8, Math.PI * 2 - 0.8], foldFn: (z) => 0.035 * smooth(185, 160, z),
      weightFn: (x, y, z) => (z > 160 ? [[B.head, 1]] : [[B.head, smooth(152, 160, z)], [B.neck, 1 - smooth(152, 160, z)]]),
      flutterFn: () => 0, color: () => [0.9, 0.9, 0.9],
    });
    // sleeves along the T-pose arms
    const sleeve = (side) => {
      const a = bindPos(side + 'Arm'), f = bindPos(side + 'ForeArm'), h = bindPos(side + 'Hand');
      const tip = h.clone().lerp(f, 0.08);
      return boneTube(a.clone().lerp(new THREE.Vector3(0, a.y, a.z), 0.3), tip, 7.5, 6.5, side === 'Left' ? B.lArm : B.rArm, side === 'Left' ? B.lFore : B.rFore, { color: () => [1, 1, 1] });
    };
    const scarfGeo = scarfTails(B.neck, B.spine2, bindPos('Neck'), (v) => [1, 1, 1 - v * 0.1]);

    const parent = body.parent;
    const mk = (geo, mat) => {
      const m = new THREE.SkinnedMesh(geo, mat);
      m.bind(skeleton, body.bindMatrix);
      m.frustumCulled = false;
      parent.add(m);
      return m;
    };
    mk(robeGeo, clothMaterial(robeTex, { repeat: [6, 5], tatter: 0.035, side: THREE.DoubleSide }));
    mk(capeGeo, clothMaterial(capeTex, { repeat: [6, 2], tatter: 0.12, side: THREE.DoubleSide }));
    // sash at the waist
    mk(bodyTube([[116, 18.2, 13.6], [112, 18.6, 14], [107, 19.4, 14.6]], {
      cy: -3, rows: 4, seg: 56, weightFn: (x, y, z) => spineWeights(z), color: () => [1, 1, 1],
    }), clothMaterial(scarfTex, { repeat: [8, 1] }));
    mk(hoodGeo, clothMaterial(robeTex, { repeat: [3, 2], side: THREE.DoubleSide }));
    {
      // a dark void where the face would be
      const v = new THREE.SphereGeometry(10.5, 16, 12);
      v.translate(head.x, head.y - 2, head.z + 8);
      const n = v.attributes.position.count;
      v.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Array.from({ length: n * 4 }, (_, i) => (i % 4 ? 0 : B.head)), 4));
      v.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({ length: n * 4 }, (_, i) => (i % 4 ? 0 : 1)), 4));
      mk(v, new THREE.MeshBasicMaterial({ color: 0x050302 }));
    }
    const sleeveMat = clothMaterial(robeTex, { repeat: [2, 2] });
    mk(sleeve('Left'), sleeveMat);
    mk(sleeve('Right'), sleeveMat);
    mk(scarfGeo, clothMaterial(scarfTex, { repeat: [1, 4], side: THREE.DoubleSide }));

    // staff: placed in world space each frame next to the right hand
    const wood = new THREE.MeshStandardMaterial({ color: 0x2b2018, roughness: 0.8 });
    this.staff = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.024, 2.1, 8), wood);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), wood);
    knot.position.y = 0.8;
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.9 }));
    wrap.position.y = 0.45;
    this.staff.add(pole, knot, wrap);
    scene.add(this.staff);

    // the thumper, slung across the back until it is planted: the pole runs
    // from the left hip to above the right shoulder, the hammer hangs low;
    // a sack rides between the shoulder blades
    this.pack = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x5a5048, roughness: 0.45, metalness: 0.8 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.9 });
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 10), metal);
    tube.position.y = 0.15;
    const hammer = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.3, 14), metal);
    hammer.position.y = -0.55;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.015, 6, 18), leather);
    band.rotation.x = Math.PI / 2;
    band.position.y = -0.55;
    const sling = new THREE.Group();
    sling.add(tube, hammer, band);
    sling.rotation.z = -0.55;
    sling.position.z = 0.06;
    const sack = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), leather);
    sack.scale.set(0.17, 0.21, 0.09);
    sack.position.set(0, 0.02, -0.02);
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 12), new THREE.MeshStandardMaterial({ color: 0x6a5038, roughness: 0.95 }));
    roll.rotation.z = Math.PI / 2;
    roll.position.set(0, 0.24, -0.02);
    this.pack.add(sling, sack, roll);
    scene.add(this.pack);

    // animation: sampled at absolute times, never integrated
    this.mixer = new THREE.AnimationMixer(this.model);
    const clip = (n) => gltf.animations.find((a) => a.name === n);
    this.walkClip = clip('Walk');
    this.walk = this.mixer.clipAction(this.walkClip);
    this.idle = this.mixer.clipAction(clip('Idle'));
    for (const a of [this.walk, this.idle]) { a.play(); a.setEffectiveTimeScale(0); }
    // a step lands every half walk cycle; find where the left foot is lowest so
    // integer step counts line up with footfalls
    this.footOffset = this.findFootfall();
    this.hand = this.bone('RightHand');
    this.back = this.bone('Spine2');
    RiggedWalker.instance = this;
  }

  hideUpperBody(body, skeleton) {
    const g = body.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const keep = /UpLeg|Leg|Foot|Toe|Hand/;
    const hide = new Float32Array(si.count);
    for (let i = 0; i < si.count; i++) {
      let bi = si.getX(i), bw = sw.getX(i);
      for (const k of ['getY', 'getZ', 'getW']) if (sw[k](i) > bw) { bw = sw[k](i); bi = si[k](i); }
      hide[i] = keep.test(skeleton.bones[bi].name) ? 0 : 1;
    }
    g.setAttribute('aHide', new THREE.BufferAttribute(hide, 1));
    const m = body.material.clone();
    m.color.set(0x5a4636);
    m.metalness = 0.1;
    m.roughness = 0.9;
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aHide;\nvarying float vHide;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHide = aHide;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vHide;')
        .replace('void main() {', 'void main() {\n  if (vHide > 0.5) discard;');
    };
    body.material = m;
  }

  findFootfall() {
    const foot = this.bone('LeftFoot');
    const v = new THREE.Vector3();
    let best = 0, low = Infinity;
    const dur = this.walkClip.duration;
    this.idle.setEffectiveWeight(0);
    this.walk.setEffectiveWeight(1);
    for (let i = 0; i < 60; i++) {
      this.walk.time = (i / 60) * dur;
      this.mixer.update(0);
      this.model.updateMatrixWorld(true);
      foot.getWorldPosition(v);
      if (v.y < low) { low = v.y; best = i / 60; }
    }
    return best;
  }

  /**
   * Place at (x, z) facing heading (0 = -z). step: continuous step count
   * (footfall at every integer). walk: 0 idle .. 1 walking. t: time for idle sway.
   */
  place(x, z, heading, step, { y = null, walk = step > 0 ? 1 : 0, brace = 0, t = 0, wind = [1, 0], windStrength = 0.5, carry = false, scale = 1 } = {}) {
    this.root.position.set(x, y ?? duneHeight(x, z), z);
    this.root.rotation.set(0, heading, 0);
    this.root.scale.setScalar(scale);
    const dur = this.walkClip.duration;
    this.walk.time = (((step / 2 + this.footOffset) % 1) + 1) % 1 * dur;
    this.idle.time = (t * 0.6) % this.idle.getClip().duration;
    this.walk.setEffectiveWeight(walk);
    this.idle.setEffectiveWeight(1 - walk);
    this.mixer.update(0);
    // brace: lean forward into the wind from the hips
    const hips = this.bone('Hips');
    hips.rotateX(brace * 0.35);
    this.root.updateMatrixWorld(true);

    // wind into bind space: world -> walker local (rotate by -heading) -> bind (x, -z)
    const ch = Math.cos(heading), sh = Math.sin(heading);
    const lx = wind[0] * ch - wind[1] * sh, lz = wind[0] * sh + wind[1] * ch;
    const len = Math.hypot(lx, lz) || 1;
    WALKER_WIND.value.set((lx / len) * windStrength, (-lz / len) * windStrength, 0, t);

    // staff: upright beside the right hand
    const hp = this.hand.getWorldPosition(new THREE.Vector3());
    this.staff.position.copy(hp).add(new THREE.Vector3(0, -0.35, 0));
    this.staff.rotation.set(0.08 * Math.sin(step * Math.PI), heading, 0);
    // thumper on the back
    this.pack.visible = carry;
    if (carry) {
      const bp = this.back.getWorldPosition(new THREE.Vector3());
      const backDir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
      this.pack.position.copy(bp).addScaledVector(backDir, 0.2).add(new THREE.Vector3(0, -0.08, 0));
      this.pack.quaternion.copy(this.root.quaternion);
    }
  }

  set visible(v) { this.root.visible = v; this.staff.visible = v; if (!v) this.pack.visible = false; }
}
