// Knock-over props: traffic cones and barrels. Deliberately simple rigid-ish bodies — they exist
// to give the car something satisfying to plough through (and the controller something to rumble at).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VEHICLE as V } from '../config';
import { VehicleState } from '../vehicle/VehiclePhysics';
import { WorldData } from './WorldData';

interface Prop {
  kind: 0 | 1; // cone, barrel
  slot: number; // instance index within its mesh
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  tilt: number;
  yawVel: number;
  tiltVel: number;
  awake: boolean;
  dirty: boolean;
  hx: number; // home position for reset
  hz: number;
}

const RADIUS = [0.24, 0.32];
const HALF_H = [0.18, 0.3]; // how far to lift the pivot when lying on its side
const MASS_DRAG = [0.004, 0.016]; // fraction of car speed lost per hit

function coloured(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const g = geo.toNonIndexed();
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function coneGeometry(): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(0.4, 0.035, 0.4);
  base.translate(0, 0.0175, 0);
  const frustum = (r0: number, r1: number, y0: number, y1: number) => {
    const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, 12, 1, true);
    g.translate(0, (y0 + y1) / 2, 0);
    return g;
  };
  return mergeGeometries([
    coloured(base, 0x1a1a1a),
    coloured(frustum(0.15, 0.105, 0.035, 0.25), 0xff5a0a),
    coloured(frustum(0.105, 0.075, 0.25, 0.4), 0xf4f4f0),
    coloured(frustum(0.075, 0.03, 0.4, 0.62), 0xff5a0a),
  ])!;
}

function barrelGeometry(): THREE.BufferGeometry {
  const ring = (y0: number, y1: number, hex: number, r = 0.29) => {
    const g = new THREE.CylinderGeometry(r, r, y1 - y0, 14, 1, false);
    g.translate(0, (y0 + y1) / 2, 0);
    return coloured(g, hex);
  };
  return mergeGeometries([ring(0, 0.3, 0xc7231c), ring(0.3, 0.33, 0x1c1c1c, 0.3), ring(0.33, 0.57, 0xeeeeea), ring(0.57, 0.6, 0x1c1c1c, 0.3), ring(0.6, 0.9, 0xc7231c)])!;
}

export class PropSystem {
  private props: Prop[] = [];
  private meshes: THREE.InstancedMesh[];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  /** number of props sent flying since the last read (for score popups / audio) */
  hitsThisStep = 0;
  lastHitKind = 0;

  constructor(scene: THREE.Scene, world: WorldData) {
    const counts = [0, 0];
    for (const s of world.props) {
      const kind = s.kind === 'cone' ? 0 : 1;
      this.props.push({ kind, slot: counts[kind]++, x: s.x, y: 0, z: s.z, vx: 0, vy: 0, vz: 0, yaw: 0, tilt: 0, yawVel: 0, tiltVel: 0, awake: false, dirty: true, hx: s.x, hz: s.z });
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    this.meshes = [new THREE.InstancedMesh(coneGeometry(), mat, Math.max(1, counts[0])), new THREE.InstancedMesh(barrelGeometry(), mat, Math.max(1, counts[1]))];
    for (const mesh of this.meshes) {
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    this.render();
  }

  reset(): void {
    for (const p of this.props) {
      p.x = p.hx;
      p.z = p.hz;
      p.y = 0;
      p.vx = p.vy = p.vz = 0;
      p.tilt = p.yaw = p.tiltVel = p.yawVel = 0;
      p.awake = false;
      p.dirty = true;
    }
  }

  step(car: VehicleState, dt: number): void {
    this.hitsThisStep = 0;
    const sn = Math.sin(car.yaw);
    const cs = Math.cos(car.yaw);
    for (const p of this.props) {
      // ── car contact ──
      const dx0 = p.x - car.x;
      const dz0 = p.z - car.z;
      if (dx0 * dx0 + dz0 * dz0 < 16 && p.y < car.y + 1.0 && p.y > car.y - 1.2) {
        for (const off of V.bodyCircleOffsets) {
          const cx = car.x + sn * off;
          const cz = car.z + cs * off;
          const dx = p.x - cx;
          const dz = p.z - cz;
          const rr = V.bodyRadius * 0.92 + RADIUS[p.kind];
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr) continue;
          const d = Math.sqrt(d2) || 0.001;
          const nx = dx / d;
          const nz = dz / d;
          // car surface velocity at the contact
          const rx = p.x - car.x;
          const rz = p.z - car.z;
          const cvx = car.vx + car.yawRate * rz;
          const cvz = car.vz - car.yawRate * rx;
          const closing = (cvx - p.vx) * nx + (cvz - p.vz) * nz;
          p.x = cx + nx * rr;
          p.z = cz + nz * rr;
          if (closing > 0.6) {
            const sp = Math.hypot(cvx, cvz);
            const k = 0.85 + ((p.slot * 37) % 10) * 0.04;
            p.vx = cvx * k + nx * closing * 0.5;
            p.vz = cvz * k + nz * closing * 0.5;
            p.vy = Math.min(9, 1.5 + sp * (p.kind === 0 ? 0.22 : 0.12));
            p.tiltVel = (4 + sp * 0.5) * (p.slot % 2 ? 1 : -1);
            p.yawVel = ((p.slot % 5) - 2) * 2.5;
            p.awake = true;
            const loss = MASS_DRAG[p.kind];
            car.vx *= 1 - loss;
            car.vz *= 1 - loss;
            car.impacts.push({ x: p.x, y: car.y + 0.4, z: p.z, nx: -nx, nz: -nz, strength: p.kind === 0 ? 0.45 : 1.3 });
            this.hitsThisStep++;
            this.lastHitKind = p.kind;
          }
          break;
        }
      }
      if (!p.awake) continue;
      // ── free flight / tumbling ──
      p.vy -= 9.81 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.tilt += p.tiltVel * dt;
      p.yaw += p.yawVel * dt;
      const rest = HALF_H[p.kind] * Math.abs(Math.sin(p.tilt));
      if (p.y <= rest) {
        p.y = rest;
        if (p.vy < -1.2) {
          p.vy = -p.vy * 0.35;
          p.tiltVel *= 0.7;
        } else p.vy = 0;
        const f = Math.max(0, 1 - 2.6 * dt);
        p.vx *= f;
        p.vz *= f;
        p.yawVel *= f;
        p.tiltVel *= Math.max(0, 1 - 1.5 * dt);
        if (Math.hypot(p.vx, p.vz) < 0.5 && Math.abs(p.vy) < 0.1) {
          // settle lying on its side
          const lying = Math.round((p.tilt - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
          p.tilt += (lying - p.tilt) * Math.min(1, dt * 10);
          p.tiltVel = 0;
          if (Math.abs(lying - p.tilt) < 0.02 && Math.hypot(p.vx, p.vz) < 0.08) {
            p.tilt = lying;
            p.vx = p.vz = 0;
            p.awake = false;
          }
        }
      }
      p.dirty = true;
    }
  }

  render(): void {
    let any0 = false;
    let any1 = false;
    for (const p of this.props) {
      if (!p.dirty) continue;
      p.dirty = false;
      this.e.set(p.tilt, p.yaw, 0);
      this.q.setFromEuler(this.e);
      this.p.set(p.x, p.y, p.z);
      this.m.compose(this.p, this.q, this.one);
      this.meshes[p.kind].setMatrixAt(p.slot, this.m);
      if (p.kind === 0) any0 = true;
      else any1 = true;
    }
    if (any0) this.meshes[0].instanceMatrix.needsUpdate = true;
    if (any1) this.meshes[1].instanceMatrix.needsUpdate = true;
  }
}
