// Car-to-car contact. Each car is three circles along its length (the same ones used against
// walls); overlapping circles are pushed apart and exchange an impulse. Pure logic, no rendering.
import { VEHICLE as V } from '../config';
import { VehicleState } from './VehiclePhysics';

const OFF = V.bodyCircleOffsets;

/** Resolve contact between two cars. Returns the hardest hit (velocity change, m/s) or 0. */
export function collideCars(a: VehicleState, b: VehicleState): number {
  const dx0 = a.x - b.x;
  const dz0 = a.z - b.z;
  if (dx0 * dx0 + dz0 * dz0 > 36) return 0;
  if (Math.abs(a.y - b.y) > 1.1) return 0; // one is flying over the other
  const R = V.carRadius * 2;
  let worst = 0;
  for (let i = 0; i < OFF.length; i++) {
    for (let j = 0; j < OFF.length; j++) {
      const ax = a.x + Math.sin(a.yaw) * OFF[i];
      const az = a.z + Math.cos(a.yaw) * OFF[i];
      const bx = b.x + Math.sin(b.yaw) * OFF[j];
      const bz = b.z + Math.cos(b.yaw) * OFF[j];
      const dx = ax - bx;
      const dz = az - bz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d; // from b towards a
      const nz = dz / d;
      const pen = R - d;
      a.x += nx * pen * 0.5;
      a.z += nz * pen * 0.5;
      b.x -= nx * pen * 0.5;
      b.z -= nz * pen * 0.5;
      // contact point halfway between the two circle centres
      const px = (ax + bx) * 0.5;
      const pz = (az + bz) * 0.5;
      const rax = px - a.x;
      const raz = pz - a.z;
      const rbx = px - b.x;
      const rbz = pz - b.z;
      const vax = a.vx + a.yawRate * raz;
      const vaz = a.vz - a.yawRate * rax;
      const vbx = b.vx + b.yawRate * rbz;
      const vbz = b.vz - b.yawRate * rbx;
      const vn = (vax - vbx) * nx + (vaz - vbz) * nz;
      if (vn >= 0) continue;
      const ca = raz * nx - rax * nz;
      const cb = rbz * nx - rbx * nz;
      const k = 1 / a.mass + 1 / b.mass + (ca * ca) / a.yawInertia + (cb * cb) / b.yawInertia;
      const e = Math.min(a.restitution, b.restitution);
      const jn = (-(1 + e) * vn) / k;
      a.vx += (jn * nx) / a.mass;
      a.vz += (jn * nz) / a.mass;
      b.vx -= (jn * nx) / b.mass;
      b.vz -= (jn * nz) / b.mass;
      a.yawRate += ((jn * ca) / a.yawInertia) * V.carYawKick;
      b.yawRate -= ((jn * cb) / b.yawInertia) * V.carYawKick;
      // a little friction along the contact so cars scrub rather than slide freely
      const tx = -nz;
      const tz = nx;
      const vt = (vax - vbx) * tx + (vaz - vbz) * tz;
      const jt = Math.max(-V.carFriction * jn, Math.min(V.carFriction * jn, -vt / (1 / a.mass + 1 / b.mass)));
      a.vx += (jt * tx) / a.mass;
      a.vz += (jt * tz) / a.mass;
      b.vx -= (jt * tx) / b.mass;
      b.vz -= (jt * tz) / b.mass;
      const strength = jn / Math.min(a.mass, b.mass);
      if (strength > 0.5) {
        a.impacts.push({ x: px, y: a.y + 0.45, z: pz, nx, nz, strength });
        b.impacts.push({ x: px, y: b.y + 0.45, z: pz, nx: -nx, nz: -nz, strength });
      }
      if (strength > worst) worst = strength;
    }
  }
  return worst;
}
