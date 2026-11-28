// ─────────────────────────────────────────────────────────────────────────────
// 5C: where the wheels and the body are drawn, in one chassis frame.
//
// Before 5C a car was drawn in a frame that only turned with its heading: the body was tilted by
// pitch and roll (exaggerated), while the wheels stayed upright beneath it. On a bank the body
// leant over by 40° or more and the wheels were left standing straight up, outside it.
//
// Now the whole car sits in a frame tilted with the ground under its four wheels. Inside it the
// wheels only move up and down within their suspension travel, and the body only shows how the
// springs move (a little exaggerated). In the air the frame follows the body, with the wheels
// hanging at full droop.
//
// No rendering imports: the physics test checks the same numbers the renderers use.
// ─────────────────────────────────────────────────────────────────────────────
import { VEHICLE as V } from '../config';
import type { VehicleState } from './VehiclePhysics';

const WB = V.cgToFront + V.cgToRear;

export interface ChassisFrame {
  /** ground-plane height under the car's centre */
  y: number;
  /** ground-plane gradients along and across the car (rise per metre; + = front / left up) */
  pitch: number;
  roll: number;
  ready: boolean;
}

export const newFrame = (): ChassisFrame => ({ y: 0, pitch: 0, roll: 0, ready: false });

export interface PoseLike {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
}

/** How far the body may show the springs' pitch and roll beyond the ground (radians). */
const BODY_TILT = 0.12;

/**
 * Update the chassis frame from the car's wheels. `dt` 0 snaps (a new car, a reset).
 * The plane is fitted through the four contact points; in the air it follows the body.
 */
export function updateFrame(s: VehicleState, pose: PoseLike, f: ChassisFrame, dt: number): void {
  const g = s.wheelGround;
  const air = s.airborne || !(s.wheelContact[0] || s.wheelContact[1] || s.wheelContact[2] || s.wheelContact[3]);
  let tp: number;
  let tr: number;
  let ty: number;
  if (air) {
    tp = pose.pitch;
    tr = pose.roll;
    ty = pose.y;
  } else {
    const hf = (g[0] + g[1]) / 2;
    const hr = (g[2] + g[3]) / 2;
    tp = (hf - hr) / WB;
    ty = hf - tp * V.cgToFront;
    tr = (g[0] + g[2] - g[1] - g[3]) / (4 * V.halfTrack);
  }
  tp = Math.max(-1.2, Math.min(1.2, tp));
  tr = Math.max(-1.2, Math.min(1.2, tr));
  if (!f.ready || dt <= 0 || !Number.isFinite(f.y)) {
    f.y = ty;
    f.pitch = tp;
    f.roll = tr;
    f.ready = true;
    return;
  }
  // the tilt eases a touch (a kerb under one wheel shouldn't flick the whole car); the height is exact
  const k = Math.min(1, dt * (air ? 10 : 30));
  f.pitch += (tp - f.pitch) * k;
  f.roll += (tr - f.roll) * k;
  f.y = ty;
}

export interface CarLayout {
  /** body position inside the chassis frame (only y is used) and its tilt (radians) */
  bodyY: number;
  bodyPitch: number;
  bodyRoll: number;
  /** each wheel's centre height inside the chassis frame (wheel radius not included) */
  wheelY: [number, number, number, number];
}

/**
 * Lay out body and wheels in the chassis frame. `wx`, `wz` are the drawn wheel positions (the
 * model's own axle positions, + x = left), `bodyGain` how much to exaggerate the spring motion.
 */
export function layoutCar(
  s: VehicleState,
  pose: PoseLike,
  f: ChassisFrame,
  wx: ArrayLike<number>,
  wz: ArrayLike<number>,
  out: CarLayout,
  pitchGain = 1.25,
  rollGain = 1.35,
): CarLayout {
  out.bodyY = pose.y - f.y;
  const dp = Math.max(-BODY_TILT, Math.min(BODY_TILT, Math.atan(pose.pitch) - Math.atan(f.pitch)));
  const dr = Math.max(-BODY_TILT, Math.min(BODY_TILT, Math.atan(pose.roll) - Math.atan(f.roll)));
  out.bodyPitch = dp * pitchGain;
  out.bodyRoll = dr * rollGain;
  for (let i = 0; i < 4; i++) {
    // where the body sits above this corner, minus how far the wheel hangs below it, relative to
    // the ground plane at that corner: on the ground this is ~0, in the air the full droop
    const bodyAt = pose.y + wz[i] * pose.pitch + wx[i] * pose.roll;
    const plane = f.y + wz[i] * f.pitch + wx[i] * f.roll;
    // the wheel can only be where its suspension lets it be, relative to the body corner
    const body = bodyAt - plane;
    const drop = Math.max(-V.bumpTravel, Math.min(V.staticCompression + 0.04, s.wheelDrop[i]));
    out.wheelY[i] = body - drop;
  }
  return out;
}

export const newLayout = (): CarLayout => ({ bodyY: 0, bodyPitch: 0, bodyRoll: 0, wheelY: [0, 0, 0, 0] });

/** Three.js-free Euler for the chassis frame (YXZ order, like the body has always used). */
export function frameEuler(f: ChassisFrame): { x: number; z: number } {
  return { x: -Math.atan(f.pitch), z: Math.atan(f.roll) };
}
