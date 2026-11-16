import * as THREE from 'three';
import { duneHeight } from './terrain-fn.js';
import { RIM } from './figures.js';
import { rng } from '../core/util.js';

// The skeleton of a long-dead giant worm, half buried in the dunes (part A3).
// Vertebrae along a spine curve, pairs of ribs arching over it, a jaw ring of
// teeth at the head end. Built once from a definition the timeline supplies.

function boneTexture(seed) {
  const r = rng(seed);
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.fillStyle = '#d9ccb2';
  g.fillRect(0, 0, size, size);
  // weathered grain along the bone, faint pores, a few hairline cracks
  for (let i = 0; i < 90; i++) {
    const y = r() * size;
    g.fillStyle = `rgba(${150 + r() * 60},${130 + r() * 50},${100 + r() * 40},${0.08 + r() * 0.12})`;
    g.fillRect(0, y, size, 1 + r() * 4);
  }
  for (let i = 0; i < 1400; i++) {
    const x = r() * size, y = r() * size, s = r() * r() * 2.2 + 0.4;
    g.fillStyle = `rgba(${120 + r() * 40},${95 + r() * 30},${70 + r() * 20},${0.06 + r() * 0.16})`;
    g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(90,70,50,0.22)';
  for (let i = 0; i < 40; i++) {
    let x = r() * size, y = r() * size;
    g.lineWidth = 0.5 + r() * 0.6;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 22; y += r() * 14; g.lineTo(x, y); }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function boneMaterial(map) {
  const m = new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: 0.5, roughness: 0.85, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = RIM;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace('#include <opaque_fragment>', `
        float rimF = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 3.0);
        outgoingLight += uRim * rimF * 0.7;
        #include <opaque_fragment>`);
  };
  return m;
}

/** Darken + tint toward sand where a vertex is close to (or under) the ground; tint: per-bone shade. */
function sandBuried(geo, sand, tint = 1) {
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = y - duneHeight(x, z);
    const s = Math.min(1, Math.max(0, 1 - d / 3.5));
    const k = (0.75 + 0.25 * Math.min(1, d / 12)) * tint;
    col[i * 3] = (1 - s) * k + s * sand[0];
    col[i * 3 + 1] = (1 - s) * k * 0.97 + s * sand[1];
    col[i * 3 + 2] = (1 - s) * k * 0.92 + s * sand[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/**
 * A bone along a curve: tube with a flattened cross-section (wider along
 * `flatDir`), thick at the root and tapering (or snapped off) at the end.
 */
function boneAlong(points, { thick, flatDir = null, flat = 1, taper = 0.55, snapped = false, radial = 8, seg = 30 }) {
  const rc = new THREE.CatmullRomCurve3(points);
  const tube = new THREE.TubeGeometry(rc, seg, thick, radial, false);
  const p = tube.attributes.position, uv = tube.attributes.uv;
  const per = radial + 1;
  const cp = new THREE.Vector3(), o = new THREE.Vector3();
  for (let q = 0; q < p.count; q++) {
    const f = Math.floor(q / per) / seg;
    rc.getPointAt(f, cp);
    o.set(p.getX(q), p.getY(q), p.getZ(q)).sub(cp);
    if (flatDir) o.addScaledVector(flatDir, o.dot(flatDir) * (flat - 1));
    // thick root, knobbly shaft, tapered or snapped tip
    const k = (1.25 - (snapped ? 0.35 : taper + 0.1) * f) * (1 + 0.08 * Math.sin(f * 23 + q % per));
    p.setXYZ(q, cp.x + o.x * k, cp.y + o.y * k, cp.z + o.z * k);
  }
  // square-ish texels: repeat the texture along the bone
  const rep = Math.max(1, Math.round(rc.getLength() / (thick * 5)));
  for (let q = 0; q < uv.count; q++) uv.setX(q, uv.getX(q) * rep);
  tube.computeVertexNormals();
  return tube;
}

export class WormSkeleton {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.built = false;
    this.drifts = [];
  }

  /**
   * def: { spine: [[x, z], ...] tail -> head (≥ 2 points), sink (m), radius (m) }
   * Ribs shrink toward the tail; the skull ring opens at the head. Nothing here
   * is regular: spacing, lean, height and thickness vary per rib, some are
   * snapped or missing, sand has drifted against their roots.
   */
  build({ spine, sink = 7, radius = 26, ribEvery = 9, seed = 5 }) {
    if (this.built) return;
    this.built = true;
    const r = rng(seed);
    const mat = boneMaterial(boneTexture(seed));
    const pts = spine.map(([x, z]) => new THREE.Vector3(x, duneHeight(x, z) - sink, z));
    const curve = new THREE.CatmullRomCurve3(pts);
    const len = curve.getLength();
    const sand = [0.86, 0.62, 0.4];
    const up = new THREE.Vector3(0, 1, 0);
    const bones = [];   // [geometry, tint]

    for (let s = ribEvery * 0.7; s < len - ribEvery * 0.4; s += ribEvery * (0.8 + r() * 0.4)) {
      const u = s / len;
      const c = curve.getPointAt(u);
      const tg = curve.getTangentAt(u);
      const side = new THREE.Vector3().crossVectors(tg, up).normalize();
      const scale = 0.35 + 0.65 * Math.pow(u, 0.6);        // big near the head
      const R = radius * scale;
      // vertebra: a squat drum (mostly under the sand)
      const v = new THREE.CylinderGeometry(R * 0.2, R * 0.24, ribEvery * 0.55, 10);
      v.rotateX(Math.PI / 2);   // axis -> +z, then point it along the spine
      v.lookAt(tg);
      v.translate(c.x, c.y + R * 0.05, c.z);
      bones.push([v, 0.9 + r() * 0.15]);
      if (r() < 0.06) continue;                            // a whole pair gone
      // ribs: hoops around the body's cross-section (centre R above the spine),
      // rising from the spine on each side and almost meeting overhead
      for (const sd of [-1, 1]) {
        if (r() < 0.05) continue;                          // one rib gone
        const snapped = r() < 0.14;
        const top = snapped ? 0.05 + r() * 0.6 : 1.0 + r() * 0.3;
        const sweep = 0.1 + r() * 0.14;                    // swept back toward the tail
        const slump = (r() - 0.5) * 0.35;                  // leaning out or in
        const wide = 0.95 + r() * 0.2, tall = 0.88 + r() * 0.17;
        const ph = r() * 6.28, wob = 0.02 + r() * 0.04;
        const arc = [];
        const K = 16;
        let root = null;
        for (let j = 0; j <= K; j++) {
          const f = j / K;
          const th = -Math.PI / 2 + f * (Math.PI / 2 + top);
          const rr = R * (1 + wob * Math.sin(f * 9 + ph));
          const vert = (R + rr * Math.sin(th)) * tall;
          const lat = sd * (rr * Math.cos(th) * wide + vert * slump * 0.3);
          const pt = c.clone().addScaledVector(side, lat).addScaledVector(up, vert)
            .addScaledVector(tg, -Math.sin(f * Math.PI * 0.5) * R * sweep);
          arc.push(pt);
          if (!root && pt.y > duneHeight(pt.x, pt.z)) root = pt;
        }
        const thick = R * 0.055 * (0.8 + r() * 0.4);
        bones.push([boneAlong(arc, { thick, flatDir: tg, flat: 1.7, snapped }), 0.82 + r() * 0.22]);
        // sand piled against the root where the rib leaves the dune
        if (root && r() < 0.55) this.drifts.push([root.x, root.z, R * (0.1 + r() * 0.14), R * (0.2 + r() * 0.1)]);
      }
    }

    // loose fragments: snapped-off ribs lying on the sand beside the skeleton,
    // roughly parallel to it so none lies across the path along the spine
    for (let i = 0; i < 14; i++) {
      const u = 0.1 + r() * 0.85;
      const c = curve.getPointAt(u), tg = curve.getTangentAt(u);
      const side = new THREE.Vector3().crossVectors(tg, up).normalize();
      const R = radius * (0.35 + 0.65 * Math.pow(u, 0.6));
      const off = (r() < 0.5 ? -1 : 1) * R * (1.5 + r() * 1.2);
      const a0 = Math.atan2(tg.z, tg.x) + (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.7;
      const L = R * (0.5 + r() * 0.8), bend = (r() - 0.5) * 0.8;
      const thick = R * 0.05;
      const arc = [];
      for (let j = 0; j <= 6; j++) {
        const f = j / 6, a = a0 + bend * f;
        const x = c.x + side.x * off + Math.cos(a) * L * f, z = c.z + side.z * off + Math.sin(a) * L * f;
        arc.push(new THREE.Vector3(x, duneHeight(x, z) + thick * (0.2 + 0.5 * Math.sin(f * Math.PI)), z));
      }
      bones.push([boneAlong(arc, { thick, flatDir: up, flat: 0.75, snapped: true, seg: 12 }), 0.85 + r() * 0.2]);
    }

    // skull: a slumped, warped jaw ring at the head, rows of teeth pointing inward
    const head = curve.getPointAt(1);
    const htg = curve.getTangentAt(1);
    const skull = new THREE.Group();
    const ring = new THREE.TorusGeometry(radius * 1.05, radius * 0.16, 14, 64);
    {
      const p = ring.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const a = Math.atan2(y, x);
        const k = 1 + 0.06 * Math.sin(3 * a + 1.3) + 0.035 * Math.sin(7 * a + 0.4);
        p.setXYZ(i, x * k, y * k * 0.92, z + radius * 0.07 * Math.sin(2 * a + 0.7) + radius * 0.02 * Math.sin(11 * a));
      }
      ring.computeVertexNormals();
    }
    const ringMesh = new THREE.Mesh(ring, mat);
    skull.add(ringMesh);
    const toothGeo = new THREE.ConeGeometry(radius * 0.04, radius * 0.36, 6);
    toothGeo.translate(0, radius * 0.18, 0);
    toothGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(toothGeo.attributes.position.count * 3).fill(1), 3));
    const N = 120;
    const teeth = new THREE.InstancedMesh(toothGeo, mat, N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    const tcol = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const row = i % 3, a = (i / N) * Math.PI * 2 * 3 + row * 0.37 + (r() - 0.5) * 0.06;
      const kk = 1 + 0.06 * Math.sin(3 * a + 1.3);
      const rr = radius * (0.96 - row * 0.12) * kk;
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-Math.cos(a) + (r() - 0.5) * 0.3, -Math.sin(a) + (r() - 0.5) * 0.3, -0.35 - row * 0.25).normalize());
      const gone = r() < 0.12, broken = r() < 0.15;
      const sc = gone ? 0 : (0.55 + r() * 0.9) * (1 - row * 0.15);
      m4.compose(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr * 0.92, -row * radius * 0.1), q, new THREE.Vector3(sc, sc * (broken ? 0.3 + r() * 0.2 : 1), sc));
      teeth.setMatrixAt(i, m4);
      tcol.fill(0.8 + r() * 0.2, i * 3, i * 3 + 3);
    }
    teeth.instanceColor = new THREE.InstancedBufferAttribute(tcol, 3);
    skull.add(teeth);
    skull.position.copy(head).add(new THREE.Vector3(0, radius * 0.8, 0)).addScaledVector(htg, radius * 0.3);
    skull.lookAt(skull.position.clone().add(htg).add(new THREE.Vector3(0, 0.2, 0)));
    skull.rotateZ(0.2);
    this.group.add(skull);
    this.skull = { position: skull.position.clone(), dir: htg.clone(), radius };
    ring.setAttribute('color', new THREE.BufferAttribute(new Float32Array(ring.attributes.position.count * 3).fill(0.85), 3));

    for (const [g, tint] of bones) {
      sandBuried(g, sand, tint);
      this.group.add(new THREE.Mesh(g, mat));
    }
    this.curve = curve;
    this.length = len;
  }

  /** The n sand drifts nearest to (x, z) as mounds [x, z, height, radius], height scaled by k. */
  driftsNear(x, z, n, k = 1) {
    return this.drifts
      .map((d) => [Math.hypot(d[0] - x, d[1] - z), d])
      .sort((a, b) => a[0] - b[0])
      .slice(0, n)
      .map(([, d]) => [d[0], d[1], d[2] * k, d[3]]);
  }

  set visible(v) { this.group.visible = v && this.built; }
}
