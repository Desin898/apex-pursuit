// ─────────────────────────────────────────────────────────────────────────────
// Roadside hardware (5D) — the pieces that were still boxes, rebuilt to look like the real thing:
//   · street lamps: a tapered octagonal steel column on a cast base, a swept bracket arm and a
//     shallow "cobra head" luminaire with a glowing lens underneath;
//   · the start / finish gantry: two lattice towers and a box-truss beam of steel tube;
//   · chevron boards: an aluminium sign blank with a folded edge on two round galvanised posts.
// Geometry only (and one helper for a tube between two points); the scenery code places them.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const Y = new THREE.Vector3(0, 1, 0);

/** A round tube of radius r from a to b (for trusses). */
export function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g.index ? g.toNonIndexed() : g;
}

/** Street lamp parts. The column is 1 m tall (scale it in y); the arm runs 1 m along +z (scale z). */
export function lampParts(): { column: THREE.BufferGeometry; base: THREE.BufferGeometry; arm: THREE.BufferGeometry; head: THREE.BufferGeometry; lens: THREE.BufferGeometry } {
  const column = new THREE.CylinderGeometry(0.07, 0.13, 1, 8);
  column.translate(0, 0.5, 0);
  // a cast base with a step in it
  const b1 = new THREE.CylinderGeometry(0.2, 0.24, 0.32, 8);
  b1.translate(0, 0.16, 0);
  const b2 = new THREE.CylinderGeometry(0.15, 0.19, 0.22, 8);
  b2.translate(0, 0.43, 0);
  const base = mergeGeometries([b1.toNonIndexed(), b2.toNonIndexed()])!;
  // the bracket: rises out of the column and sweeps out level to the lamp
  const curve = new THREE.CubicBezierCurve3(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(0, 0.05, 0.05), new THREE.Vector3(0, 0.12, 0.45), new THREE.Vector3(0, 0.1, 1));
  const arm = new THREE.TubeGeometry(curve, 14, 0.045, 6, false);
  // the luminaire: a shallow shell, long along the arm, open underneath where the lens is
  const head = new THREE.SphereGeometry(0.5, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  head.scale(0.34, 0.2, 0.78);
  const lens = new THREE.CircleGeometry(0.5, 16);
  lens.rotateX(Math.PI / 2); // facing down
  lens.scale(0.28, 1, 0.66);
  lens.translate(0, 0.012, 0);
  return { column, base, arm, head, lens };
}

/** The start gantry: lattice towers at ±span/2 and a truss beam across, all steel tube. */
export function gantryTruss(span: number, height: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const w = 0.42; // half the tower's width
  // towers
  for (const cx of [-span / 2, span / 2]) {
    const corners = [v(cx - w, 0, -w), v(cx + w, 0, -w), v(cx + w, 0, w), v(cx - w, 0, w)];
    for (const c of corners) parts.push(tube(c, v(c.x, height + 0.6, c.z), 0.07));
    const step = 0.9;
    for (let y = 0.3, k = 0; y < height; y += step, k++) {
      for (let f = 0; f < 4; f++) {
        const a = corners[f];
        const b = corners[(f + 1) % 4];
        parts.push(tube(v(a.x, y, a.z), v(b.x, y, b.z), 0.035, 5));
        // zig-zag diagonals
        const y2 = Math.min(height, y + step);
        if (k % 2) parts.push(tube(v(a.x, y, a.z), v(b.x, y2, b.z), 0.03, 5));
        else parts.push(tube(v(b.x, y, b.z), v(a.x, y2, a.z), 0.03, 5));
      }
    }
  }
  // the beam: a box truss 1.1 m deep, 0.8 m thick
  const y0 = height - 0.4;
  const y1 = height + 0.7;
  const L = span / 2 + w;
  const chords = [v(-L, y0, -0.4), v(-L, y0, 0.4), v(-L, y1, -0.4), v(-L, y1, 0.4)];
  for (const c of chords) parts.push(tube(c, v(L, c.y, c.z), 0.08));
  const n = Math.round((2 * L) / 1.1);
  for (let i = 0; i <= n; i++) {
    const x = -L + (2 * L * i) / n;
    const x2 = -L + (2 * L * Math.min(n, i + 1)) / n;
    for (const z of [-0.4, 0.4]) {
      parts.push(tube(v(x, y0, z), v(x, y1, z), 0.035, 5));
      if (i < n) parts.push(tube(i % 2 ? v(x, y0, z) : v(x, y1, z), i % 2 ? v(x2, y1, z) : v(x2, y0, z), 0.03, 5));
    }
    for (const y of [y0, y1]) parts.push(tube(v(x, y, -0.4), v(x, y, 0.4), 0.03, 5));
  }
  const g = mergeGeometries(parts)!;
  g.computeBoundingSphere();
  return g;
}

/** A chevron board's back: an aluminium blank with a folded rim (1.5 × 1.1 m), facing −z. */
export function signBlank(w: number, h: number): THREE.BufferGeometry {
  const plate = new THREE.BoxGeometry(w, h, 0.012);
  const rimT = new THREE.BoxGeometry(w, 0.03, 0.05);
  rimT.translate(0, h / 2 - 0.015, -0.03);
  const rimB = rimT.clone();
  rimB.translate(0, -h + 0.03, 0);
  const rimL = new THREE.BoxGeometry(0.03, h, 0.05);
  rimL.translate(-w / 2 + 0.015, 0, -0.03);
  const rimR = rimL.clone();
  rimR.translate(w - 0.03, 0, 0);
  // two clamp rails across the back for the posts
  const rail = new THREE.BoxGeometry(w * 0.9, 0.05, 0.04);
  const r1 = rail.clone();
  r1.translate(0, h * 0.25, -0.04);
  const r2 = rail.clone();
  r2.translate(0, -h * 0.25, -0.04);
  const g = mergeGeometries([plate, rimT, rimB, rimL, rimR, r1, r2].map((x) => x.toNonIndexed()))!;
  g.translate(0, 0, -0.012);
  return g;
}
