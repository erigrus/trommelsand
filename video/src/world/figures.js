import * as THREE from 'three';
import { duneHeight } from './terrain-fn.js';

// Silhouette-grade figures. They are mostly seen against the sun, so form and
// motion matter more than surface detail. FIRST PASS — refine freely.

const cloth = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 1 });
const metal = new THREE.MeshStandardMaterial({ color: 0x5a5048, roughness: 0.4, metalness: 0.8 });

/** Cloaked walker, ~1.8 m. Call pose(stepPhase) with a phase that advances 1 per step. */
export class Walker {
  constructor(scene) {
    this.group = new THREE.Group();
    const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.45, 10, 1, true), cloth);
    cloak.position.y = 0.95;
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), cloth);
    hood.position.y = 1.7;
    hood.scale.set(1, 1.15, 1.1);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.45, 0.2), cloth);
    pack.position.set(0, 1.25, 0.22);
    this.legL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.75, 6), cloth);
    this.legR = this.legL.clone();
    for (const [leg, x] of [[this.legL, -0.11], [this.legR, 0.11]]) {
      leg.geometry = leg.geometry.clone();
      leg.geometry.translate(0, -0.37, 0);
      leg.position.set(x, 0.75, 0);
      this.group.add(leg);
    }
    // a tail of cloth that sways with the wind
    this.tail = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.9, 1, 4), new THREE.MeshStandardMaterial({ color: 0x3a2618, side: THREE.DoubleSide, roughness: 1 }));
    this.tail.position.set(0, 1.0, 0.35);
    this.group.add(cloak, hood, pack, this.tail);
    this.group.traverse((o) => (o.castShadow = true));
    scene.add(this.group);
  }

  /** Place at (x,z) facing heading (radians, 0 = -z), with a walking pose. */
  place(x, z, heading, stepPhase, wind = 0.5, t = 0, yOverride = null) {
    const y = yOverride ?? duneHeight(x, z);
    this.group.position.set(x, y, z);
    this.group.rotation.y = heading;
    const s = Math.sin(stepPhase * Math.PI);
    this.legL.rotation.x = 0.45 * s;
    this.legR.rotation.x = -0.45 * s;
    this.group.position.y += Math.abs(Math.cos(stepPhase * Math.PI)) * 0.05;
    this.tail.rotation.x = 0.4 + 0.3 * wind + 0.1 * Math.sin(t * 7);
  }

  set visible(v) { this.group.visible = v; }
}

/** The metal stake the walker drives into the sand (shot 07). */
export class Stake {
  constructor(scene) {
    this.group = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 2.2, 8), metal);
    rod.position.y = 1.1;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.25, 12), metal);
    cap.position.y = 2.2;
    this.group.add(rod, cap);
    scene.add(this.group);
  }
  place(x, z, sink = 0, pulse = 0) {
    this.group.position.set(x, duneHeight(x, z) - sink, z);
    this.group.scale.setScalar(1 + pulse * 0.04);
  }
  set visible(v) { this.group.visible = v; }
}

/**
 * Giant worm: a ringed tube along a path that comes out of the sand. The body
 * is a fixed curve rebuilt each frame from points (cheap at this vertex count).
 */
export class Worm {
  constructor(scene, { radius = 22, segments = 160, radial = 28 } = {}) {
    this.radius = radius;
    this.segments = segments;
    this.radial = radial;
    this.mat = new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.95, metalness: 0, flatShading: false });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    this.mouth = new THREE.Group();
    const teeth = new THREE.InstancedMesh(new THREE.ConeGeometry(0.9, 6, 5), new THREE.MeshStandardMaterial({ color: 0xd8c8a8, roughness: 0.6 }), 48);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2, rr = radius * (i % 2 ? 0.75 : 0.9);
      m.makeRotationFromEuler(new THREE.Euler(Math.PI / 2 + 0.5, 0, 0));
      m.premultiply(new THREE.Matrix4().makeRotationZ(a));
      m.setPosition(Math.cos(a) * rr, Math.sin(a) * rr, 1);
      teeth.setMatrixAt(i, m);
    }
    const throat = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.95, 32), new THREE.MeshBasicMaterial({ color: 0x120804 }));
    this.mouth.add(teeth, throat);
    scene.add(this.mesh, this.mouth);
  }

  /** points: THREE.Vector3[] from tail to head; flex: 0..1 segment pulse. */
  build(points, flex = 0) {
    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, this.segments, this.radius, this.radial, false);
    // ring ridges: bulge every few metres, pulsing with `flex`
    const pos = geo.attributes.position, nrm = geo.attributes.normal;
    const ringsPerLen = curve.getLength() / 9;
    for (let i = 0; i <= this.segments; i++) {
      const u = i / this.segments;
      const taper = Math.min(1, u * 4 + 0.15);
      const ridge = 1 + 0.06 * Math.pow(Math.abs(Math.sin(u * ringsPerLen * Math.PI)), 6) + flex * 0.04 * Math.sin(u * 20);
      for (let j = 0; j <= this.radial; j++) {
        const k = i * (this.radial + 1) + j;
        const c = curve.getPointAt(u);
        const dx = pos.getX(k) - c.x, dy = pos.getY(k) - c.y, dz = pos.getZ(k) - c.z;
        pos.setXYZ(k, c.x + dx * taper * ridge, c.y + dy * taper * ridge, c.z + dz * taper * ridge);
      }
    }
    geo.computeVertexNormals();
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
    const head = curve.getPointAt(1), dir = curve.getTangentAt(1);
    this.mouth.position.copy(head);
    this.mouth.lookAt(head.clone().add(dir));
  }

  set visible(v) { this.mesh.visible = v; this.mouth.visible = v; }
}
