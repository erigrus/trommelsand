import * as THREE from 'three';
import { duneHeight } from './terrain-fn.js';

// Figures are mostly seen against a low sun, so silhouette, motion and a
// clean rim light matter most. Cloth flutters in the vertex shader, and
// every material gets a back-light rim term (uRim, set by the director).

export const RIM = { value: new THREE.Color(0, 0, 0) };
export const WIND = { value: new THREE.Vector4(1, 0, 0, 0) }; // dir.x, dir.z, strength, time

/**
 * MeshStandardMaterial + rim light + optional cloth flutter.
 * flutter: 'none' | 'hem' (more toward the bottom of the mesh) | 'strip' (more along uv.x)
 */
function figureMaterial({ color, roughness = 1, metalness = 0, flutter = 'none', amount = 1, side = THREE.FrontSide, vertexColors = false, map = null, bumpMap = null, bumpScale = 1, rim = 1, rimTint = 0 }) {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, side, vertexColors, map, bumpMap, bumpScale });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = RIM;
    sh.uniforms.uWind = WIND;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float w = 0.0;
          ${flutter === 'hem' ? 'w = pow(clamp(1.0 - position.y / 1.5, 0.0, 1.0), 2.0) * 0.12;' : ''}
          ${flutter === 'strip' ? 'w = uv.x * uv.x * 0.55;' : ''}
          w *= ${amount.toFixed(3)} * uWind.z;
          float ph = uWind.w * 9.0 + position.y * 5.0 + uv.x * 7.0;
          vec3 wd = vec3(uWind.x, 0.0, uWind.y);
          transformed += wd * w * (0.7 + 0.3 * sin(ph)) + vec3(0.0, 1.0, 0.0) * w * 0.35 * sin(ph * 1.7)
                       + cross(wd, vec3(0.0, 1.0, 0.0)) * w * 0.4 * sin(ph * 1.3 + 1.0);
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace('#include <opaque_fragment>', `
        float rimF = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 3.0) * step(0.0, dot(normal, normalize(vViewPosition)));
        outgoingLight += uRim * rimF * ${rim.toFixed(3)} * mix(vec3(1.0), 0.3 + 1.5 * diffuseColor.rgb, ${rimTint.toFixed(3)});
        #include <opaque_fragment>`);
  };
  return m;
}

const robeLathe = (pts, seg = 20) => sanitizeNormals(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg));

/** Vertices on the lathe axis get zero-length normals (degenerate triangles),
 *  which shade as NaN and bloom into a black frame. Point them along the axis. */
function sanitizeNormals(g) {
  const n = g.attributes.normal, p = g.attributes.position;
  for (let i = 0; i < n.count; i++) {
    const l = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
    if (!(l > 1e-6)) n.setXYZ(i, 0, p.getY(i) > 0.8 ? 1 : -1, 0);
  }
  n.needsUpdate = true;
  return g;
}

/** Lathe + vertical cloth folds that deepen toward the hem. */
function foldedLathe(pts, { folds = 9, depth = 0.06, seg = 40 } = {}) {
  const g = robeLathe(pts, seg);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + depth * Math.sin(a * folds + y * 1.7) * Math.max(0, 1 - y / 1.4) + depth * 0.5 * Math.sin(a * 3 + 1.0) * Math.max(0, 1 - y / 1.4);
    p.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  return sanitizeNormals(g);
}

/** A ribbon that tapers to a frayed end, extending along +x. */
function ribbon(len, w0, w1, seg = 14) {
  const g = new THREE.PlaneGeometry(len, 1, seg, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + len / 2, u = x / len;
    p.setXYZ(i, x, p.getY(i) * lerpN(w0, w1, u) * (1 - 0.25 * Math.sin(u * 40) * u), 0);
  }
  g.computeVertexNormals();
  return sanitizeNormals(g);
}
const lerpN = (a, b, u) => a + (b - a) * u;

/** Cloaked walker with staff and pack, ~1.85 m. pose(stepPhase) advances 1 per step. */
export class Walker {
  constructor(scene) {
    const cloth = figureMaterial({ color: 0x3b2a1e, flutter: 'hem', amount: 1 });
    const cape = figureMaterial({ color: 0x4a3324, flutter: 'hem', amount: 0.6 });
    // hood and sleeve sit near their mesh origin, so 'hem' flutter would shake them whole
    const clothStill = figureMaterial({ color: 0x3b2a1e });
    const clothDark = figureMaterial({ color: 0x241810 });
    const scarf = figureMaterial({ color: 0x6a4228, flutter: 'strip', side: THREE.DoubleSide });
    const wood = figureMaterial({ color: 0x2b2018, roughness: 0.8 });
    const leather = figureMaterial({ color: 0x2a1c12, roughness: 0.9 });

    this.group = new THREE.Group();
    // robe: wide folded hem, narrow waist, shoulders; a shorter cape layered on top
    const robe = new THREE.Mesh(foldedLathe([[0.0, 0.3], [0.3, 0.24], [0.47, 0.14], [0.46, 0.2], [0.4, 0.55], [0.3, 0.95], [0.27, 1.2], [0.26, 1.36], [0.19, 1.47], [0.09, 1.53], [0.0, 1.54]]), cloth);
    robe.scale.set(1, 1, 0.78);
    const capeM = new THREE.Mesh(foldedLathe([[0.0, 1.0], [0.36, 0.98], [0.37, 1.04], [0.33, 1.2], [0.3, 1.36], [0.2, 1.47], [0.0, 1.5]], { folds: 7, depth: 0.05 }), cape);
    capeM.scale.set(1.05, 1, 0.85);
    // pointed hood, drawn forward; the face opening stays in deep shadow
    const hood = new THREE.Mesh(robeLathe([[0.0, 0.0], [0.17, 0.02], [0.19, 0.12], [0.17, 0.24], [0.12, 0.33], [0.05, 0.4], [0.0, 0.44]], 18), clothStill);
    hood.position.set(0, 1.5, 0.01);
    hood.rotation.x = -0.22;
    hood.scale.set(1, 1, 1.15);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), clothDark);
    face.position.set(0, 1.64, -0.08);
    // pack: a soft sack and a bedroll
    const sack = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), leather);
    sack.scale.set(0.15, 0.2, 0.09);
    sack.position.set(0, 1.2, 0.2);
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 12), clothDark);
    roll.rotation.z = Math.PI / 2;
    roll.position.set(0, 1.42, 0.19);
    // staff with a knot near the top, and the sleeve reaching to it
    this.staff = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.024, 2.1, 7), wood);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), wood);
    knot.position.y = 0.8;
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 8), leather);
    wrap.position.y = 0.55;
    this.staff.add(pole, knot, wrap);
    this.staff.position.set(0.37, 1.0, -0.14);
    const sleeve = new THREE.Mesh(robeLathe([[0.0, 0.0], [0.09, 0.0], [0.08, 0.3], [0.065, 0.58], [0.0, 0.6]], 10), clothStill);
    sleeve.position.set(0.24, 1.38, -0.02);
    sleeve.rotation.set(Math.PI - 0.35, 0, 0.32);
    // scarf tails off the neck, streaming downwind
    const tailGeo = ribbon(1.0, 0.17, 0.06);
    this.tails = [0, 1].map((k) => {
      const t = new THREE.Mesh(tailGeo, scarf);
      t.position.set(k ? 0.06 : -0.06, 1.5 - k * 0.07, 0.12);
      this.group.add(t);
      return t;
    });
    // legs + boots below the hem
    const legGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.6, 8);
    legGeo.translate(0, -0.3, 0);
    const bootGeo = new THREE.SphereGeometry(1, 10, 6);
    bootGeo.scale(0.065, 0.05, 0.14);
    bootGeo.translate(0, -0.62, -0.05);
    this.legs = [-0.11, 0.11].map((x) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(legGeo, clothDark), new THREE.Mesh(bootGeo, leather));
      g.position.set(x, 0.66, 0);
      this.group.add(g);
      return g;
    });
    this.body = new THREE.Group();
    this.body.add(robe, capeM, hood, face, sack, roll, this.staff, sleeve);
    this.group.add(this.body);
    scene.add(this.group);
  }

  /**
   * Place at (x, z) facing heading (radians, 0 = -z). stepPhase advances 1 per
   * step (eased), wind: { dir: [x, z], strength 0..1, t }.
   */
  place(x, z, heading, stepPhase, { y = null, wind = { dir: [1, 0], strength: 0.5 }, t = 0, scale = 1, brace = 0 } = {}) {
    const g = this.group;
    g.position.set(x, y ?? duneHeight(x, z), z);
    g.rotation.set(0, heading, 0);
    g.scale.setScalar(scale);
    const s = Math.sin(stepPhase * Math.PI);
    this.legs[0].rotation.x = 0.5 * s;
    this.legs[1].rotation.x = -0.5 * s;
    this.body.position.y = Math.abs(Math.cos(stepPhase * Math.PI)) * 0.04;
    this.body.rotation.z = 0.03 * s;
    this.body.rotation.x = -0.08 - brace * 0.25; // lean into the wind / brace
    this.staff.rotation.x = 0.12 * s;
    // scarf tails point downwind in local space
    const wd = new THREE.Vector3(wind.dir[0], 0, wind.dir[1]).applyAxisAngle(new THREE.Vector3(0, 1, 0), -heading);
    const yaw = Math.atan2(-wd.z, wd.x);
    this.tails.forEach((tl, k) => tl.rotation.set(0.2 + k * 0.15, yaw, -0.25 - k * 0.12 + Math.sin(t * 6 + k) * 0.08));
  }

  set visible(v) { this.group.visible = v; }
}

/** The thumper: a tripod rig with a heavy hammer that slams down on every beat. */
export class Stake {
  constructor(scene) {
    const metal = figureMaterial({ color: 0x5a5048, roughness: 0.4, metalness: 0.85 });
    const dark = figureMaterial({ color: 0x2a2420, roughness: 0.55, metalness: 0.7 });
    const cloth = figureMaterial({ color: 0x5a3a24, flutter: 'strip', amount: 0.5, side: THREE.DoubleSide });
    this.group = new THREE.Group();
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 2.3, 10), metal);
    column.position.y = 1.0;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.5, 8), dark);
    spike.rotation.x = Math.PI;
    spike.position.y = -0.15;
    // tripod legs splayed into the sand
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.3;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.62, 6), dark);
      leg.position.set(Math.cos(a) * 0.2, 0.22, Math.sin(a) * 0.2);
      leg.lookAt(0, 0.5, 0);
      leg.rotateX(Math.PI / 2);
      this.group.add(leg);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.03, 10), dark);
      foot.position.set(Math.cos(a) * 0.4, 0.01, Math.sin(a) * 0.4);
      this.group.add(foot);
    }
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.14, 12), dark);
    collar.position.y = 1.32;
    // a strip of cloth tied to the top, streaming in the wind
    const flag = new THREE.Mesh(ribbon(0.7, 0.12, 0.05), cloth);
    flag.position.y = 2.15;
    this.flag = flag;
    this.head = new THREE.Group();
    const hammer = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.46, 16), metal);
    for (const y of [-0.15, 0.0, 0.15]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.018, 6, 20), dark);
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      this.head.add(band);
    }
    this.head.add(hammer);
    this.group.add(column, spike, collar, flag, this.head);
    scene.add(this.group);
  }
  /** lift 0..1: the head is raised (1) or has just slammed down (0). */
  place(x, z, { sink = 0, lift = 0, windYaw = 0 } = {}) {
    this.group.position.set(x, duneHeight(x, z) - sink, z);
    this.head.position.y = 1.62 + lift * 0.5;
    this.flag.rotation.y = windYaw;
  }
  set visible(v) { this.group.visible = v; }
}

/**
 * Giant worm: overlapping armour rings along a curve, dusted with sand on top,
 * a mouth of petals around rings of crystalline teeth. Rebuilt every frame
 * from 15 body points (cheap at this vertex count).
 */
/**
 * Worm skin, one armour plate per texture repeat along u (u = 1 is the
 * plate's leading edge), tiled around v. Colour + bump from the same canvas.
 */
function wormSkin(seed = 3, size = 512) {
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const col = document.createElement('canvas'), bmp = document.createElement('canvas');
  col.width = col.height = bmp.width = bmp.height = size;
  const c = col.getContext('2d'), b = bmp.getContext('2d');
  const H = new Float32Array(size * size);
  // plate profile across u: a raised leading lip, a sunken groove at the seam
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size;
    let h = 0.45 + 0.25 * u;                                   // plate swells toward its lip
    h += 0.35 * Math.exp(-Math.pow((u - 0.93) * 22, 2));        // the lip
    h -= 0.55 * Math.exp(-Math.pow((Math.min(u, 1 - u)) * 40, 2)); // the seam groove
    // long, irregular wrinkles along the body
    h += 0.012 * Math.sin((y / size) * Math.PI * 2 * 23 + Math.sin(x * 0.031 + y * 0.013) * 3.1) + 0.008 * Math.sin((y / size) * Math.PI * 2 * 57 + x * 0.02);
    H[y * size + x] = h;
  }
  // pits and old wounds
  for (let i = 0; i < 900; i++) {
    const cx = r() * size, cy = r() * size, rad = 1 + r() * r() * 7, d = 0.12 + r() * 0.2;
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++) for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
      const dd = ((x - cx) ** 2 + (y - cy) ** 2) / (rad * rad);
      if (dd < 1) H[((y + size) % size) * size + ((x + size) % size)] -= d * (1 - dd);
    }
  }
  // cracks wandering across the plates
  for (let i = 0; i < 45; i++) {
    let x = r() * size, y = r() * size;
    const steps = 20 + r() * 60, dir = r() * Math.PI * 2;
    for (let k = 0; k < steps; k++) {
      const ang = dir + Math.sin(k * 0.4 + i) * 0.8;
      x += Math.cos(ang) * 2; y += Math.sin(ang) * 2;
      const ix = ((Math.round(x) % size) + size) % size, iy = ((Math.round(y) % size) + size) % size;
      H[iy * size + ix] -= 0.25;
      H[iy * size + ((ix + 1) % size)] -= 0.12;
    }
  }
  const ci = c.createImageData(size, size), bi = b.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const h = H[i], u = (i % size) / size;
    const grain = r();
    // sand packed into the seam and pits, darker leathery plate, paler worn lip
    const seam = Math.exp(-Math.pow(Math.min(u, 1 - u) * 18, 2));
    const pit = Math.max(0, 0.45 - h) * 2;
    let R = 128 + 40 * (h - 0.5) + grain * 14, G = 92 + 30 * (h - 0.5) + grain * 10, B = 66 + 22 * (h - 0.5) + grain * 8;
    const sand = Math.min(1, seam * 0.9 + pit * 0.6) * (0.6 + 0.4 * grain);
    R = R * (1 - sand) + 205 * sand; G = G * (1 - sand) + 160 * sand; B = B * (1 - sand) + 112 * sand;
    ci.data.set([R, G, B, 255], i * 4);
    const v = Math.max(0, Math.min(255, h * 200 + grain * 10));
    bi.data.set([v, v, v, 255], i * 4);
  }
  c.putImageData(ci, 0, 0);
  b.putImageData(bi, 0, 0);
  const map = new THREE.CanvasTexture(col), bump = new THREE.CanvasTexture(bmp);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, bump]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  return { map, bump };
}

export class Worm {
  constructor(scene, { radius = 22, segments = 300, radial = 64 } = {}) {
    this.radius = radius;
    this.segments = segments;
    this.radial = radial;
    this.skin = typeof document !== 'undefined' ? wormSkin() : { map: null, bump: null };
    this.mat = figureMaterial({ color: 0xffffff, roughness: 0.9, vertexColors: true, map: this.skin.map, bumpMap: this.skin.bump, bumpScale: 1.6, rim: 0.55, rimTint: 1 });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    let tseed = 17;
    const tr = () => { tseed = (tseed * 16807) % 2147483647; return tseed / 2147483647; };

    this.mouth = new THREE.Group();
    // hooked teeth: a cone bent toward its inner side
    const hooked = (h, rb) => {
      const g = new THREE.ConeGeometry(rb, h, 7, 5);
      g.translate(0, h / 2, 0);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i) / h; p.setZ(i, p.getZ(i) - y * y * h * 0.35); }
      g.computeVertexNormals();
      return g;
    };
    // three rows of crystalline teeth, smaller and sparser toward the throat, a few missing
    const toothMat = figureMaterial({ color: 0xe8dcc6, roughness: 0.3, metalness: 0.05, rim: 0.6 });
    const toothGeo = hooked(4.6, 0.55);
    const m = new THREE.Matrix4();
    for (const [rr, n, depth, sc] of [[0.9, 38, 0.6, 1.6], [0.76, 30, 4.8, 1.25], [0.6, 22, 10, 0.95]]) {
      const teeth = new THREE.InstancedMesh(toothGeo, toothMat, n);
      for (let i = 0; i < n; i++) {
        const a = ((i + (tr() - 0.5) * 0.5) / n) * Math.PI * 2 + rr * 3;
        const dir = new THREE.Vector3(-Math.cos(a) * 0.8 + (tr() - 0.5) * 0.25, -Math.sin(a) * 0.8 + (tr() - 0.5) * 0.25, -0.55).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        // turn each hook so it curls down the throat
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a + Math.PI / 2));
        const k = tr() < 0.1 ? 0 : sc * (0.6 + tr() * 0.7);
        const rad = radius * rr * (1 + (tr() - 0.5) * 0.06);
        m.compose(new THREE.Vector3(Math.cos(a) * rad, Math.sin(a) * rad, -depth - tr() * 1.5), q, new THREE.Vector3(k, k * (tr() < 0.12 ? 0.45 : 1 + tr() * 0.4), k));
        teeth.setMatrixAt(i, m);
      }
      this.mouth.add(teeth);
    }
    // throat: ridged, fleshy, darkening with depth
    const throatGeo = new THREE.CylinderGeometry(radius * 0.95, radius * 0.3, 44, 72, 16, true);
    {
      const p = throatGeo.attributes.position;
      const col = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const ang = Math.atan2(z, x), f = 1 + 0.07 * Math.sin(ang * 13 + y * 0.25) + 0.04 * Math.sin(ang * 29 - y * 0.4) + 0.05 * Math.sin(y * 0.9);
        p.setXYZ(i, x * f, y, z * f);
        const deep = (22 - y) / 44;                           // 0 at the opening, 1 deep down
        const k = (1 - deep * 0.75) * (0.85 + 0.15 * Math.sin(ang * 13 + y * 0.25));
        col.set([0.55 * k, 0.2 * k, 0.15 * k], i * 3);
      }
      throatGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      throatGeo.computeVertexNormals();
    }
    const throat = new THREE.Mesh(throatGeo, figureMaterial({ color: 0xffffff, roughness: 0.45, vertexColors: true, side: THREE.BackSide, rim: 0 }));
    throat.rotation.x = Math.PI / 2; // +y (wide end) -> +z, the opening
    throat.position.z = -22;
    const glow = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.36, 24), new THREE.MeshBasicMaterial({ color: 0x5a2008 }));
    glow.position.z = -43;
    this.mouth.add(glow);
    // a thick, uneven lip
    const lipGeo = new THREE.TorusGeometry(radius * 0.98, radius * 0.1, 12, 72);
    {
      const p = lipGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(y, x);
        const k = 1 + 0.02 * Math.sin(a * 5 + 1) + 0.012 * Math.sin(a * 17);
        p.setXYZ(i, x * k, y * k, z * (1 + 0.4 * Math.sin(a * 7 + 2)));
      }
      lipGeo.computeVertexNormals();
    }
    const lip = new THREE.Mesh(lipGeo, figureMaterial({ color: 0x6a4630, roughness: 0.9, map: this.skin.map, bumpMap: this.skin.bump, bumpScale: 1.2, rim: 0.5, rimTint: 1 }));
    // petals: tapered armour plates continuing the body forward, hinged at the
    // rim; pivot.rotation.y opens them outward (0.15 = nearly closed cone).
    // Skin outside, raw flesh lined with small hooks inside.
    this.petals = [];
    const L = radius * 1.25;
    const petalGeo = new THREE.CylinderGeometry(radius * 0.45, radius, L, 20, 10, true, Math.PI / 2 - 0.95, 1.9);
    {
      // taper each petal to a point: squeeze the angular width toward the tip
      const pp = petalGeo.attributes.position;
      for (let i = 0; i < pp.count; i++) {
        const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
        const u = (y + L / 2) / L;                     // 0 at the rim, 1 at the tip
        const a = Math.atan2(x, z) - Math.PI / 2;      // angle from the petal centre
        const r = Math.hypot(x, z) * (1 + 0.04 * Math.sin(u * 19 + a * 3));
        const a2 = a * (1 - 0.85 * u * u);
        pp.setXYZ(i, Math.sin(a2 + Math.PI / 2) * r, y, Math.cos(a2 + Math.PI / 2) * r);
      }
      petalGeo.computeVertexNormals();
    }
    petalGeo.translate(0, L / 2, 0);
    petalGeo.rotateX(Math.PI / 2);   // along +z, centred on the rim point (R, 0)
    petalGeo.translate(-radius, 0, 0);
    const petalTex = { map: this.skin.map?.clone(), bump: this.skin.bump?.clone() };
    for (const t of [petalTex.map, petalTex.bump]) if (t) { t.repeat.set(1.6, 3); t.needsUpdate = true; }
    const petalMat = figureMaterial({ color: 0xd8c0a8, roughness: 0.9, map: petalTex.map, bumpMap: petalTex.bump, bumpScale: 3, rim: 0.6, rimTint: 1 });
    const fleshMat = figureMaterial({ color: 0xa8645a, roughness: 0.4, side: THREE.BackSide, map: petalTex.map, bumpMap: petalTex.bump, bumpScale: 2, rim: 0 });
    const hookGeo = hooked(1.6, 0.28);
    for (let k = 0; k < 3; k++) {
      const hinge = new THREE.Group();
      hinge.rotation.z = (k / 3) * Math.PI * 2 + Math.PI / 2;
      const pivot = new THREE.Group();
      pivot.position.x = radius;
      pivot.add(new THREE.Mesh(petalGeo, petalMat), new THREE.Mesh(petalGeo, fleshMat));
      // hooks on the inner face, pointing at the axis
      const hooks = new THREE.InstancedMesh(hookGeo, toothMat, 40);
      for (let i = 0; i < 40; i++) {
        const u = 0.12 + 0.75 * tr();
        const phi = (tr() - 0.5) * 2 * 0.8 * (1 - 0.85 * u * u);
        const rho = radius * (1 - 0.55 * u) * 0.985;
        const pos = new THREE.Vector3(-radius + rho * Math.cos(phi), rho * Math.sin(phi), u * L);
        const dir = new THREE.Vector3(-Math.cos(phi), -Math.sin(phi), -0.5).normalize();
        const sc = 0.6 + tr() * 0.8;
        m.compose(pos, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), new THREE.Vector3(sc, sc, sc));
        hooks.setMatrixAt(i, m);
      }
      pivot.add(hooks);
      hinge.add(pivot);
      this.mouth.add(hinge);
      this.petals.push(pivot);
    }
    this.mouth.add(throat, lip);
    scene.add(this.mesh, this.mouth);
  }

  /** points: Vector3[] tail -> head; flex: 0..1 ring pulse; open: 0..1 mouth petals. */
  build(points, { flex = 0, open = 1 } = {}) {
    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, this.segments, this.radius, this.radial, false);
    const pos = geo.attributes.position, uvs = geo.attributes.uv;
    const len = curve.getLength();
    const rings = Math.round(len / 9.5);
    // ring coordinate: plates of uneven length (monotonic warp of u * rings)
    const ringAt = (u) => { const x = u * rings; return x + 0.16 * Math.sin(x * 0.53 + 1.0) + 0.09 * Math.sin(x * 1.31 + 2.0); };
    const end = ringAt(1);
    const h = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
    const colors = new Float32Array(pos.count * 3);
    const plate = new THREE.Color(0xc8b09a), groove = new THREE.Color(0x4a3428), dust = new THREE.Color(0xf0dcc0), belly = new THREE.Color(0x8a6a54);
    const c = new THREE.Color();
    const centre = new THREE.Vector3();
    for (let i = 0; i <= this.segments; i++) {
      const u = i / this.segments;
      curve.getPointAt(u, centre);
      const taper = Math.min(1, 0.25 + u * 3.5) * (u > 0.97 ? 1.04 : 1);
      const rc = ringAt(u), ring = Math.floor(rc), seg = rc - ring;
      const lipH = 0.045 + 0.05 * h(ring), deep = 0.03 + 0.035 * h(ring + 50), ph = h(ring + 100) * 6.28;
      const tint = 0.85 + 0.25 * h(ring + 200);
      for (let j = 0; j <= this.radial; j++) {
        const k = i * (this.radial + 1) + j;
        const dx = pos.getX(k) - centre.x, dy = pos.getY(k) - centre.y, dz = pos.getZ(k) - centre.z;
        const ang = (j / this.radial) * Math.PI * 2;
        const up = dy / this.radius; // -1 .. 1
        const back = 0.5 + 0.5 * Math.min(1, Math.max(0, (up + 0.4) / 0.9));    // armour on the back, softer belly
        // overlapping plates: the lip varies per plate and around it; a groove at the seam
        const lip = lipH * (0.7 + 0.3 * Math.sin(ang * 3 + ph)) * back;
        const gr = Math.exp(-Math.pow((1 - seg) * 9, 2));
        let plateR = 1 + lip * Math.pow(seg, 1.4) - deep * gr * back + flex * 0.03 * Math.sin(u * 40);
        // lumps and long creases
        plateR *= 1 + 0.022 * Math.sin(ang * 5 + u * 17 + ph) + 0.012 * Math.sin(ang * 11 + u * 41) + 0.008 * Math.sin(ang * 23 + rc * 2);
        const s = taper * plateR;
        pos.setXYZ(k, centre.x + dx * s, centre.y + dy * s, centre.z + dz * s);
        // skin texture follows the plates
        uvs.setX(k, rc / end);
        const g = Math.exp(-Math.pow((1 - seg) * 7, 2));
        const patch = 0.5 + 0.5 * Math.sin(ang * 2 + rc * 0.7 + ph) * Math.sin(u * 31 + ang);
        c.copy(plate).lerp(belly, Math.max(0, -up) * 0.7).lerp(groove, g * 0.8 * back)
          .lerp(dust, Math.max(0, up) * (0.35 + 0.4 * patch) * (1 - g));
        c.multiplyScalar(tint * (0.9 + 0.2 * ((j * 7 + i * 13) % 11) / 11));
        colors.set([c.r, c.g, c.b], k * 3);
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    // one texture repeat per armour plate, so the painted lip/seam sits on the geometric one
    if (this.skin.map) { this.skin.map.repeat.set(end, 6); this.skin.bump.repeat.set(end, 6); }
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
    const head = curve.getPointAt(1), dir = curve.getTangentAt(1);
    this.mouth.position.copy(head);
    this.mouth.lookAt(head.clone().add(dir));
    this.mouth.scale.setScalar(1.04);
    for (const p of this.petals) p.rotation.y = 0.1 + open * 0.85;
    this.curve = curve;
  }

  set visible(v) { this.mesh.visible = v; this.mouth.visible = v; }
}
