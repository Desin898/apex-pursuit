// ─────────────────────────────────────────────────────────────────────────────
// CameraRig — chase near, chase far, hood, bumper, cockpit and cinematic cameras (Phase 4A),
// plus look back / left / right and a free look on the right stick or a right-button mouse drag.
// The chase camera is the default: it lags the car's heading, swings towards the direction of
// travel in a drift (so you see the side of the car), widens its field of view with speed and
// nitrous, and shakes with speed, rough ground and impacts.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { CAMERA as C } from '../config';
import { clamp, damp, lerp, smoothstep, wrapAngle } from '../core/math';
import { VehicleState } from '../vehicle/VehiclePhysics';
import type { WorldData } from '../world/WorldData';

export const CAMERA_MODES = ['Chase near', 'Chase far', 'Hood', 'Bumper', 'Cockpit', 'Cinematic'] as const;
export type CameraKind = 'chase-near' | 'chase-far' | 'hood' | 'bumper' | 'cockpit' | 'cinematic';
const KINDS: CameraKind[] = ['chase-near', 'chase-far', 'hood', 'bumper', 'cockpit', 'cinematic'];

/** What the player is doing with the look controls this frame. */
export interface LookInput {
  /** right stick, −1..1 */
  x: number;
  y: number;
  back: boolean;
  /** −1 look right, +1 look left, 0 none (Z / X keys) */
  side: number;
  /** right-button mouse drag: yaw and pitch offsets in radians while held, else null */
  mouse: { yaw: number; pitch: number } | null;
}
export interface CarPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode = 0;
  shakeScale = 1;
  private yaw = 0; // smoothed heading the chase camera sits behind
  private height = C.chaseHeight;
  private fov = C.fovBase;
  private trauma = 0; // impact shake, decays
  private lookYaw = 0;
  private lookPitch = 0;
  private orbit = 0;
  private pos = new THREE.Vector3();
  private target = new THREE.Vector3();
  private initialised = false;
  private t = 0;
  /** the world's walls, for keeping the chase camera out of them */
  world: WorldData | null = null;
  /** the cockpit's eye point, on the player's car body (set when the cockpit is built) */
  cockpitEye: THREE.Object3D | null = null;
  private probe = 1; // 0..1 how far out the chase camera may sit (pulls in fast, eases out)
  private head = new THREE.Vector3(); // cockpit head offset from g-forces
  private headNod = 0;
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(C.fovBase, aspect, 0.25, 12000);
  }

  nextMode(): string {
    this.setMode((this.mode + 1) % CAMERA_MODES.length);
    return CAMERA_MODES[this.mode];
  }
  setMode(i: number): void {
    this.mode = ((i % CAMERA_MODES.length) + CAMERA_MODES.length) % CAMERA_MODES.length;
    this.initialised = false;
    this.lookYaw = 0;
    this.lookPitch = 0;
  }
  modeIndex(name: string): number {
    return Math.max(0, CAMERA_MODES.findIndex((m) => m.toLowerCase() === name.toLowerCase()));
  }
  get kind(): CameraKind {
    return KINDS[this.mode];
  }
  /** hood, bumper and cockpit: the views from the car itself */
  get inCar(): boolean {
    const k = this.kind;
    return k === 'hood' || k === 'bumper' || k === 'cockpit';
  }

  /** Kick the camera (0..1). Collisions and hard landings call this. */
  addShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  snap(pose: CarPose): void {
    this.yaw = pose.yaw;
    this.initialised = false;
  }

  update(pose: CarPose, s: VehicleState, dt: number, look: LookInput, menu: false | 'home' | 'showroom' = false): void {
    const showroom = menu === 'showroom';
    const home = menu === 'home';
    this.t += dt;
    const cam = this.camera;
    const speedN = clamp(s.speed / 100, 0, 1.25);
    const nitro = s.nitroLevel;

    // Field of view
    const fovTarget = C.fovBase + C.fovSpeed * Math.pow(Math.min(1, speedN), 1.3) + C.fovNitro * nitro;
    this.fov = lerp(this.fov, fovTarget, damp(nitro ? 2.6 : 1.8, dt));

    // Look: Z / X for the side views, the right stick or a right-button drag for free look.
    // Everything eases back to centre when let go.
    const kind = menu ? 'cinematic' : this.kind;
    const car = kind === 'hood' || kind === 'bumper' || kind === 'cockpit';
    let wantYaw: number;
    let wantPitch: number;
    if (look.side) {
      wantYaw = look.side * (car ? C.lookSideCar : C.lookSideChase);
      wantPitch = 0;
    } else if (look.mouse) {
      wantYaw = look.mouse.yaw;
      wantPitch = look.mouse.pitch;
    } else {
      wantYaw = -look.x * (car ? C.lookStickCar : C.lookStickChase);
      wantPitch = look.y * 0.5;
    }
    const lookRate = look.mouse ? 30 : 7;
    this.lookYaw = lerp(this.lookYaw, wantYaw, damp(lookRate, dt));
    this.lookPitch = lerp(this.lookPitch, wantPitch, damp(lookRate, dt));
    cam.near = kind === 'cockpit' ? C.cockpitNear : 0.25;

    const sinY = Math.sin(pose.yaw);
    const cosY = Math.cos(pose.yaw);

    if (showroom || home || kind === 'cinematic') {
      // Slow orbiting drone shot
      this.orbit += dt * (showroom ? 0.22 : home ? 0.11 : 0.3);
      const r = showroom ? 7.6 : home ? 9.2 + Math.sin(this.t * 0.17) * 1.6 : 8.5 + Math.sin(this.t * 0.31) * 2;
      const h = showroom ? 1.2 + Math.sin(this.t * 0.2) * 0.3 : home ? 1.5 + Math.sin(this.t * 0.13) * 0.5 : 1.6 + Math.sin(this.t * 0.23) * 1.0;
      // the home shot orbits the drift circle's centre-ish point rather than the car's heading
      const a = home ? this.orbit * 2.2 + 2.4 : pose.yaw + this.orbit;
      const want = new THREE.Vector3(pose.x + Math.sin(a) * r, pose.y + h, pose.z + Math.cos(a) * r);
      if (!this.initialised) this.pos.copy(want);
      this.pos.lerp(want, damp(showroom ? 4 : home ? 1.4 : 2.2, dt));
      // the drifting car can run up to a lagging camera: never let it get closer than this
      const dx = this.pos.x - pose.x;
      const dz = this.pos.z - pose.z;
      const dd = Math.hypot(dx, dz);
      const minD = showroom ? 5.5 : 7.2;
      if (dd < minD) {
        const k = minD / Math.max(dd, 0.01);
        this.pos.x = pose.x + (dd > 0.01 ? dx * k : minD);
        this.pos.z = pose.z + (dd > 0.01 ? dz * k : 0);
      }
      this.target.set(pose.x, pose.y + 0.6, pose.z);
      cam.position.copy(this.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.target);
      if (showroom || home) {
        // frame the car in the right-hand half so the menu can sit on the left
        cam.rotateY(home ? 0.3 : 0.24);
        cam.rotateX(-0.05);
      }
      cam.fov = showroom ? 38 : home ? 40 : this.fov - 8;
      this.initialised = true;
    } else if (kind === 'chase-near' || kind === 'chase-far') {
      // ── Chase near / far ──
      const far = kind === 'chase-far';
      const D = far ? C.farDistance : C.chaseDistance;
      const Hgt = far ? C.farHeight : C.chaseHeight;
      const Dspd = far ? C.farDistanceSpeed : C.chaseDistanceSpeed;
      const lag = far ? C.farYawLag : C.chaseYawLag;
      // Heading to sit behind: mostly the car's, partly the direction it is actually travelling.
      let heading = pose.yaw;
      if (s.speed > 6 && s.forwardSpeed > 0) {
        const travel = Math.atan2(s.vx, s.vz);
        heading = pose.yaw + wrapAngle(travel - pose.yaw) * C.chaseVelocityBlend * smoothstep(6, 18, s.speed);
      }
      if (s.gear === -1 && s.forwardSpeed < -2) heading = pose.yaw; // reversing: stay behind the car
      if (!this.initialised) this.yaw = heading;
      this.yaw += wrapAngle(heading - this.yaw) * damp(lag + speedN * 2.5, dt);
      const back = look.back ? Math.PI : 0;
      const a = this.yaw + this.lookYaw + back;
      let dist = (D + Dspd * speedN - nitro * 0.5) * (look.back ? 0.9 : 1);
      this.height = lerp(this.height, Hgt - 0.25 * speedN + this.lookPitch * 3, damp(4, dt));
      // Keep out of walls: if a wall taller than the camera stands between the car and where the
      // camera wants to be, pull in to just this side of it (fast) and ease back out (slowly).
      let room = 1;
      if (this.world) {
        const ex = pose.x - Math.sin(a) * (dist + C.probeMargin);
        const ez = pose.z - Math.cos(a) * (dist + C.probeMargin);
        const t = this.world.raycastWalls(pose.x, pose.z, ex, ez, pose.y + this.height - 0.15);
        room = t >= 1 ? 1 : Math.max(0.2, (t * (dist + C.probeMargin) - C.probeMargin) / dist);
      }
      this.probe = room < this.probe ? room : lerp(this.probe, room, damp(1.6, dt));
      if (!this.initialised) this.probe = room;
      dist *= this.probe;
      const want = new THREE.Vector3(pose.x - Math.sin(a) * dist, pose.y + this.height + (1 - this.probe) * 0.6, pose.z - Math.cos(a) * dist);
      // follow the car's height softly so jumps read as jumps
      if (!this.initialised) this.pos.copy(want);
      this.pos.x = want.x;
      this.pos.z = want.z;
      this.pos.y = lerp(this.pos.y, want.y, damp(9, dt));
      if (this.pos.y < 0.35) this.pos.y = 0.35;
      cam.position.copy(this.pos);
      // look slightly ahead of the car, more so at speed
      const ahead = look.back ? -2 : 2.2 + speedN * 3.5;
      this.target.set(pose.x + Math.sin(this.yaw + this.lookYaw * 0.3) * ahead, pose.y + 0.85, pose.z + Math.cos(this.yaw + this.lookYaw * 0.3) * ahead);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.target);
      // lean into corners a touch
      cam.rotateZ(clamp(-s.yawRate * 0.035 * smoothstep(5, 30, s.speed), -0.06, 0.06));
      cam.fov = this.fov + (far ? C.farFov : 0);
      this.initialised = true;
    } else if (kind === 'cockpit' && this.cockpitEye) {
      // ── Cockpit: the driver's eyes, on the sprung body, with the head moved by g-forces ──
      const eye = this.cockpitEye;
      eye.updateWorldMatrix(true, false);
      // lean away from the corner, nod forward under braking, back under power
      const lat = clamp(-s.accelL * C.headLean, -C.headLimit, C.headLimit);
      const fore = clamp(-s.accelF * C.headLean * 0.5, -C.headLimit * 0.6, C.headLimit * 0.6);
      this.head.x = lerp(this.head.x, lat, damp(6, dt));
      this.head.z = lerp(this.head.z, fore, damp(6, dt));
      this.headNod = lerp(this.headNod, clamp(-s.accelF * C.headPitch, -0.05, 0.05), damp(5, dt));
      const kerb = s.onKerb * smoothstep(3, 25, s.speed);
      const jig = kerb * 0.004 * Math.sin(this.t * 83.0);
      this.v.set(this.head.x, jig, this.head.z);
      eye.localToWorld(this.v);
      cam.position.copy(this.v);
      eye.getWorldQuaternion(this.q);
      cam.quaternion.copy(this.q);
      cam.up.set(0, 1, 0);
      const back = look.back ? Math.PI : 0;
      if (look.back && eye.parent) {
        // looking back from the cockpit: the rear camera on the tail (the seat is in the way)
        this.v.set(0, 1.05, -2.4);
        eye.parent.localToWorld(this.v);
        cam.position.copy(this.v);
      }
      cam.rotateY(this.lookYaw + back);
      cam.rotateX(-this.lookPitch * 0.9 + this.headNod);
      cam.rotateZ(-this.head.x * 0.6);
      const fovT = C.cockpitFov + C.cockpitFovSpeed * Math.min(1, speedN) + nitro * 3;
      cam.fov = lerp(cam.fov, fovT, damp(3, dt));
      this.initialised = true;
    } else {
      // ── Hood / bumper: rigidly mounted, inherits body pitch and roll ──
      const hood = kind === 'hood';
      const fwd = hood ? 0.62 : 2.62; // bumper cam sits just ahead of the nose
      const up = hood ? 1.0 : 0.4;
      const back = look.back ? Math.PI : 0;
      const yawNow = pose.yaw + this.lookYaw + back;
      cam.position.set(pose.x + sinY * fwd, pose.y + up + pose.pitch * fwd, pose.z + cosY * fwd);
      cam.rotation.set(0, 0, 0);
      cam.up.set(0, 1, 0);
      this.target.set(cam.position.x + Math.sin(yawNow) * 10, cam.position.y + pose.pitch * 10 - this.lookPitch * 4 - (hood ? 0.5 : 0.1), cam.position.z + Math.cos(yawNow) * 10);
      cam.lookAt(this.target);
      cam.rotateZ(-pose.roll * 1.2);
      cam.fov = this.fov + (hood ? C.hoodFov : C.bumperFov);
      if (!hood) cam.position.y += Math.sin(this.t * 97.0) * C.bumperRumble * Math.min(1, speedN) * (s.airborne ? 0 : 1);
      this.initialised = true;
    }

    // Shake: continuous (speed, nitrous, rough ground) + trauma from impacts
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    const rough = s.airborne ? 0 : s.onGrass * C.shakeGrass * smoothstep(3, 25, s.speed) + s.onKerb * 0.03 * smoothstep(3, 25, s.speed);
    const amount = menu ? 0 : (C.shakeSpeed * Math.pow(speedN, 2.2) + C.shakeNitro * nitro + rough + this.trauma * this.trauma * 0.55) * this.shakeScale * (kind === 'cinematic' ? 0.25 : kind === 'cockpit' ? 0.35 : 1);
    if (amount > 0.0005) {
      const t = this.t;
      const nx = Math.sin(t * 61.3) * 0.6 + Math.sin(t * 97.1 + 1.3) * 0.4;
      const ny = Math.sin(t * 71.7 + 2.1) * 0.6 + Math.sin(t * 113.9) * 0.4;
      const nr = Math.sin(t * 53.1 + 0.7);
      cam.position.x += nx * amount * 0.5;
      cam.position.y += ny * amount * 0.5;
      cam.rotateZ(nr * amount * 0.02);
      cam.rotateX(ny * amount * 0.012);
    }
    cam.updateProjectionMatrix();
  }
}
