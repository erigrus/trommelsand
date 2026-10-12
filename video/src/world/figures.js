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
function figureMaterial({ color, roughness = 1, metalness = 0, flutter = 'none', amount = 1, side = THREE.FrontSide, vertexColors = false }) {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, side, vertexColors });
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
        outgoingLight += uRim * rimF;
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
    const hood = new THREE.Mesh(robeLathe([[0.0, 0.0], [0.17, 0.02], [0.19, 0.12], [0.17, 0.24], [0.12, 0.33], [0.05, 0.4], [0.0, 0.44]], 18), cloth);
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
    const sleeve = new THREE.Mesh(robeLathe([[0.0, 0.0], [0.09, 0.0], [0.08, 0.3], [0.065, 0.58], [0.0, 0.6]], 10), cloth);
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
export class Worm {
  constructor(scene, { radius = 22, segments = 180, radial = 36 } = {}) {
    this.radius = radius;
    this.segments = segments;
    this.radial = radial;
    this.mat = figureMaterial({ color: 0xffffff, roughness: 0.92, vertexColors: true });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.frustumCulled = false;

    this.mouth = new THREE.Group();
    const toothMat = figureMaterial({ color: 0xe6dccb, roughness: 0.35 });
    const toothGeo = new THREE.ConeGeometry(0.55, 4.2, 5);
    toothGeo.translate(0, 2.1, 0);
    const rows = [[0.88, 64, 0.5], [0.72, 52, 3.5], [0.55, 40, 7]];
    const m = new THREE.Matrix4();
    for (const [rr, n, depth] of rows) {
      const teeth = new THREE.InstancedMesh(toothGeo, toothMat, n);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rr;
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-Math.cos(a) * 0.8, -Math.sin(a) * 0.8, -0.6).normalize());
        m.compose(new THREE.Vector3(Math.cos(a) * radius * rr, Math.sin(a) * radius * rr, -depth), q, new THREE.Vector3(1, 1 + (i % 3) * 0.3, 1));
        teeth.setMatrixAt(i, m);
      }
      this.mouth.add(teeth);
    }
    const throat = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.95, radius * 0.45, 30, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x0a0402, side: THREE.BackSide }));
    throat.rotation.x = Math.PI / 2; // +y (wide end) -> +z, the opening
    throat.position.z = -15;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.98, radius * 0.09, 10, 48), figureMaterial({ color: 0x6a4630, roughness: 0.9 }));
    // petals: tapered armour plates continuing the body forward, hinged at the
    // rim; pivot.rotation.y opens them outward (0.15 = nearly closed cone)
    this.petals = [];
    const L = radius * 1.25;
    const petalGeo = new THREE.CylinderGeometry(radius * 0.45, radius, L, 16, 8, true, Math.PI / 2 - 0.95, 1.9);
    {
      // taper each petal to a point: squeeze the angular width toward the tip
      const pp = petalGeo.attributes.position;
      for (let i = 0; i < pp.count; i++) {
        const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
        const u = (y + L / 2) / L;                     // 0 at the rim, 1 at the tip
        const a = Math.atan2(x, z) - Math.PI / 2;      // angle from the petal centre
        const r = Math.hypot(x, z);
        const a2 = a * (1 - 0.85 * u * u);
        pp.setXYZ(i, Math.sin(a2 + Math.PI / 2) * r, y, Math.cos(a2 + Math.PI / 2) * r);
      }
      petalGeo.computeVertexNormals();
    }
    petalGeo.translate(0, L / 2, 0);
    petalGeo.rotateX(Math.PI / 2);   // along +z, centred on the rim point (R, 0)
    petalGeo.translate(-radius, 0, 0);
    const petalMat = figureMaterial({ color: 0x7a5236, roughness: 0.95, side: THREE.DoubleSide });
    for (let k = 0; k < 3; k++) {
      const hinge = new THREE.Group();
      hinge.rotation.z = (k / 3) * Math.PI * 2 + Math.PI / 2;
      const pivot = new THREE.Group();
      pivot.position.x = radius;
      pivot.add(new THREE.Mesh(petalGeo, petalMat));
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
    const pos = geo.attributes.position;
    const len = curve.getLength();
    const rings = len / 7.5;
    const colors = new Float32Array(pos.count * 3);
    const plate = new THREE.Color(0x8a6244), groove = new THREE.Color(0x2c1a10), dust = new THREE.Color(0xd2a46c);
    const c = new THREE.Color();
    const centre = new THREE.Vector3();
    for (let i = 0; i <= this.segments; i++) {
      const u = i / this.segments;
      curve.getPointAt(u, centre);
      const taper = Math.min(1, 0.25 + u * 3.5) * (u > 0.97 ? 1.04 : 1);
      const seg = (u * rings) % 1;
      // each ring overlaps the next: thick leading edge, thin trailing edge, a groove between
      const plateR = 1 + 0.07 * seg - 0.05 * Math.exp(-Math.pow((1 - seg) * 9, 2)) + flex * 0.03 * Math.sin(u * 40);
      for (let j = 0; j <= this.radial; j++) {
        const k = i * (this.radial + 1) + j;
        const dx = pos.getX(k) - centre.x, dy = pos.getY(k) - centre.y, dz = pos.getZ(k) - centre.z;
        const s = taper * plateR;
        pos.setXYZ(k, centre.x + dx * s, centre.y + dy * s, centre.z + dz * s);
        const up = dy / this.radius; // -1 .. 1
        const g = Math.exp(-Math.pow((1 - seg) * 7, 2));
        c.copy(plate).lerp(groove, g * 0.85).lerp(dust, Math.max(0, up) * 0.55 * (1 - g));
        c.multiplyScalar(0.85 + 0.3 * ((j * 7 + i * 13) % 11) / 11);
        colors.set([c.r, c.g, c.b], k * 3);
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
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
