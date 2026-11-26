// ─────────────────────────────────────────────────────────────────────────────
// VehiclePhysics — deterministic fixed-step arcade vehicle model.
//
//  • Planar "bicycle" tyre model with saturating slip curves (grip → slide → drift)
//  • Rear-wheel drive with a friction-circle so throttle can break the rear loose
//  • 3-DOF body (heave / pitch / roll) on four spring-dampers with hard bump stops:
//    gives weight transfer, kerb and landing hits, and real jumps off ramps
//  • Engine torque curve, 7-speed gearbox (auto or manual), nitrous
//  • Impulse-based collisions against the static world
//
// Conventions: Y is up. yaw = 0 faces +Z. forward = (sin yaw, cos yaw), left = (cos yaw, −sin yaw).
// Positive steer angle / yaw rate / lateral values point LEFT. No rendering imports: the same
// class can run on the server for reconciliation in the multiplayer stage.
// ─────────────────────────────────────────────────────────────────────────────
import { POLICE, VEHICLE, WEATHER } from '../config';

type VehicleParams = typeof VEHICLE;
const V = VEHICLE; // geometry shared by every edition (wheel positions, radius)
import { clamp, clamp01, curve1, smoothstep } from '../core/math';
import { Surface, WorldData } from '../world/WorldData';

export interface VehicleInput {
  throttle: number; // 0..1
  brake: number; // 0..1 (also reverse when stopped)
  steer: number; // −1 (left) .. +1 (right)
  handbrake: boolean;
  nitro: boolean;
  /** true when steer comes from an analog stick (less smoothing) */
  analog: boolean;
  shiftUp: boolean; // edge-triggered by the caller
  shiftDown: boolean;
}

export interface ImpactEvent {
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
  /** velocity change in m/s — a good "how hard" number */
  strength: number;
}

// Wheel order: 0 FL, 1 FR, 2 RL, 3 RR.  (+x is LEFT in car space.)
export const WHEEL_X = [V.halfTrack, -V.halfTrack, V.halfTrack, -V.halfTrack];
export const WHEEL_Z = [V.cgToFront, V.cgToFront, -V.cgToRear, -V.cgToRear];

const G = 9.81;
const WHEELBASE = V.cgToFront + V.cgToRear;
// Normalised torque curve: fat mid-range, tails off towards the redline (4.6: from the car's params)
const curveCache = new WeakMap<object, (x: number) => number>();
function torqueCurveOf(p: VehicleParams): (x: number) => number {
  let c = curveCache.get(p.torqueCurve);
  if (!c) curveCache.set(p.torqueCurve, (c = curve1(p.torqueCurve)));
  return c;
}

function tyre(slip: number): number {
  return Math.sin(V.tyreC * Math.atan(V.tyreB * slip));
}

export class VehicleState {
  // Pose. y is the height of the car's origin, which rests at ground level.
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  pitch = 0; // + = nose up
  roll = 0; // + = left side up
  // Velocities (world frame)
  vx = 0;
  vy = 0;
  vz = 0;
  yawRate = 0;
  pitchRate = 0;
  rollRate = 0;
  // Controls after smoothing
  steerInput = 0; // −1..1 (right positive, like the input)
  steerAngle = 0; // actual road-wheel angle, rad, left positive
  // Drivetrain
  rpm = V.idleRpm;
  gear = 1; // −1 reverse, 1..7
  shiftTimer = 0;
  reverseTimer = 0;
  manual = false;
  nitro = 1;
  nitroActive = false;
  // set by the physics from its edition (used by car-to-car contact)
  mass = VEHICLE.mass;
  yawInertia = VEHICLE.yawInertia;
  restitution = VEHICLE.carRestitution;
  /** seconds of punctured tyres left (spike strips, Phase 3C) */
  puncture = 0;
  // Telemetry for rendering / audio / haptics (not part of the simulation state proper)
  speed = 0; // m/s, horizontal
  forwardSpeed = 0;
  lateralSpeed = 0;
  sideSlip = 0; // rad, + = sliding to the left
  accelF = 0;
  accelL = 0;
  throttle = 0;
  brake = 0;
  handbrake = false;
  wheelSpinSlip = 0; // 0..1 rear wheelspin under power
  drift = 0; // 0..1 how committed the car is to a sustained drift
  draft = 0; // 0..1 slipstream from a car ahead (set by the race each step); cuts aero drag
  wheelSlip = [0, 0, 0, 0]; // 0..1 per wheel: how hard it is sliding
  wheelLoad = [0, 0, 0, 0];
  wheelContact = [true, true, true, true];
  wheelSurface: Surface[] = [0, 0, 0, 0];
  wheelGround = [0, 0, 0, 0]; // ground height under each wheel
  wheelDrop = [0, 0, 0, 0]; // how far each wheel hangs below its rest position (− = compressed)
  wheelRot = [0, 0, 0, 0]; // spin angle, rad
  airborne = false;
  airTime = 0;
  onGrass = 0; // 0..1 fraction of wheels on grass
  onKerb = 0;
  onRunoff = 0;
  /** 4E: 0..1 fraction of wheels on gravel */
  onGravel = 0;
  nitroLevel = 0; // 0..1 how much of the nitrous effect is on (ramps in)
  /** seconds left passing through other cars after a rejoin */
  ghost = 0;
  // One-shot events, cleared by whoever consumes them
  impacts: ImpactEvent[] = [];
  landing = 0; // m/s closing speed of the hardest suspension hit this step
  shiftEvent = 0; // +1 upshift, −1 downshift
  lastAirTime = 0; // set on touchdown
}

export class VehiclePhysics {
  readonly s = new VehicleState();
  private prevGround = [0, 0, 0, 0];
  private wob = 0;
  /** this car's tuning (an edition's values; defaults to the base car) */
  p: VehicleParams;
  /** 0 dry .. 1 fully wet track: scales grip per surface (WEATHER in config) */
  wet = 0;
  // Per-axle spring rates chosen so the car sits level: front and rear carry different loads.
  private K_FRONT: number;
  private K_REAR: number;
  private C_FRONT: number;
  private C_REAR: number;
  private STATIC_LOAD: number;

  constructor(private world: WorldData, params: VehicleParams = VEHICLE) {
    this.p = params;
    this.K_FRONT = this.K_REAR = this.C_FRONT = this.C_REAR = this.STATIC_LOAD = 0;
    this.setParams(params);
  }

  /** Swap tuning (edition, stability, driver aids) without resetting the car. */
  setParams(params: VehicleParams): void {
    this.p = params;
    const P = params;
    const kTotal = (P.mass * G) / P.staticCompression;
    this.K_FRONT = (kTotal * (P.cgToRear / WHEELBASE)) / 2;
    this.K_REAR = (kTotal * (P.cgToFront / WHEELBASE)) / 2;
    this.C_FRONT = 2 * P.dampingRatio * Math.sqrt(this.K_FRONT * (P.mass / 4));
    this.C_REAR = 2 * P.dampingRatio * Math.sqrt(this.K_REAR * (P.mass / 4));
    this.STATIC_LOAD = (P.mass * G) / 4;
    this.s.mass = P.mass;
    this.s.yawInertia = P.yawInertia;
    this.s.restitution = P.carRestitution;
  }

  reset(x: number, z: number, yaw: number): void {
    const s = this.s;
    const V = this.p;
    s.x = x;
    s.z = z;
    s.yaw = yaw;
    s.y = this.world.heightAt(x, z);
    s.pitch = s.roll = 0;
    s.vx = s.vy = s.vz = 0;
    s.yawRate = s.pitchRate = s.rollRate = 0;
    s.steerInput = s.steerAngle = 0;
    s.gear = 1;
    s.rpm = V.idleRpm;
    s.shiftTimer = 0;
    s.airTime = 0;
    s.airborne = false;
    s.drift = 0;
    s.draft = 0;
    s.nitroLevel = 0;
    s.ghost = 0;
    s.wheelSpinSlip = 0;
    s.nitroActive = false;
    s.reverseTimer = 0;
    s.impacts.length = 0;
    for (let i = 0; i < 4; i++) {
      this.prevGround[i] = s.y;
      s.wheelGround[i] = s.y;
      s.wheelDrop[i] = 0;
      s.wheelSlip[i] = 0;
    }
  }

  step(inp: VehicleInput, dt: number): void {
    const s = this.s;
    const V = this.p;
    const { K_FRONT, K_REAR, C_FRONT, C_REAR, STATIC_LOAD } = this;
    const W = this.world;

    const sinY = Math.sin(s.yaw);
    const cosY = Math.cos(s.yaw);
    const fx = sinY;
    const fz = cosY;
    const lx = cosY;
    const lz = -sinY;
    const vF = s.vx * fx + s.vz * fz;
    const vL = s.vx * lx + s.vz * lz;
    const speed = Math.hypot(s.vx, s.vz);

    // ── Pedals, reverse logic ──────────────────────────────────────────────
    const thr = clamp01(inp.throttle);
    const brk = clamp01(inp.brake);
    if (s.gear === -1) {
      if (thr > 0.05 && vF > -1.2) {
        s.gear = 1;
        s.shiftEvent = 1;
      }
    } else if (brk > 0.05 && thr < 0.05 && vF < 0.8) {
      s.reverseTimer += dt;
      if (s.reverseTimer > 0.14) {
        s.gear = -1;
        s.shiftEvent = -1;
      }
    } else {
      s.reverseTimer = 0;
    }
    const drive = s.gear === -1 ? brk : thr;
    const brakeCmd = s.gear === -1 ? thr : brk;
    s.throttle = drive;
    s.brake = brakeCmd;
    s.handbrake = inp.handbrake;

    // ── Steering ───────────────────────────────────────────────────────────
    // The lock shrinks with speed so that full stick ≈ the tyres' grip limit at any speed.
    const steerMax = Math.min(
      V.steerMax,
      V.steerGain * (Math.atan((WHEELBASE * V.steerGripRef) / Math.max(vF * vF, 1)) + V.steerBase),
    );
    const target = clamp(inp.steer, -1, 1);
    const turningIn = Math.abs(target) > Math.abs(s.steerInput) && target * s.steerInput >= 0;
    const rate = inp.analog ? V.steerRateAnalog : (turningIn ? V.steerRateDigital : V.steerReturnDigital) * (1 - V.steerRateSpeedDrop * smoothstep(15, 70, speed));
    s.steerInput += clamp(target - s.steerInput, -rate * dt, rate * dt);
    const sideSlip = Math.atan2(vL, Math.max(Math.abs(vF), V.minSlipSpeed));
    const assist = vF > 0 ? V.counterSteerAssist * sideSlip * smoothstep(6, 16, speed) : 0;
    const delta = clamp(-s.steerInput * steerMax + assist, -V.steerMax, V.steerMax);
    s.steerAngle = delta;

    // ── Suspension: spring forces at the four corners ──────────────────────
    let sumF = 0;
    let sumFz = 0;
    let sumFx = 0;
    let contacts = 0;
    let grass = 0;
    let kerb = 0;
    let runoff = 0;
    let gravel = 0;
    const load = s.wheelLoad;
    for (let i = 0; i < 4; i++) {
      const ax = WHEEL_X[i];
      const az = WHEEL_Z[i];
      const wx = s.x + fx * az + lx * ax;
      const wz = s.z + fz * az + lz * ax;
      const surf = W.surfaceAt(wx, wz);
      // 4E: gravel is lumpy: a little noise in the ground height under each wheel
      const h = W.heightAt(wx, wz) + (surf === Surface.Gravel ? V.gravelWobble * 0.012 * (Math.sin(wx * 3.1 + wz * 1.7) * Math.sin(wz * 2.3 - wx * 0.9) + 0.6) : 0);
      const H = s.y + az * s.pitch + ax * s.roll;
      const Hdot = s.vy + az * s.pitchRate + ax * s.rollRate;
      let hdot = (h - this.prevGround[i]) / dt;
      if (hdot > 60) hdot = 60;
      if (hdot < -60) hdot = -60;
      this.prevGround[i] = h;
      const comp = V.staticCompression - (H - h);
      let F = 0;
      if (comp > 0) {
        const front = i < 2;
        F = (front ? K_FRONT : K_REAR) * comp - (front ? C_FRONT : C_REAR) * (Hdot - hdot);
        F = clamp(F, 0, STATIC_LOAD * 3.2);
        contacts++;
        if (surf === Surface.Grass) grass++;
        else if (surf === Surface.Kerb) kerb++;
        else if (surf === Surface.Runoff) runoff++;
        else if (surf === Surface.Gravel) gravel++;
      }
      s.wheelContact[i] = comp > 0;
      s.wheelSurface[i] = surf;
      s.wheelGround[i] = h;
      load[i] = F;
      sumF += F;
      sumFz += F * az;
      sumFx += F * ax;
    }
    const wasAirborne = s.airborne;
    s.airborne = contacts === 0;
    s.onGrass = contacts ? grass / contacts : 0;
    s.onKerb = contacts ? kerb / contacts : 0;
    s.onRunoff = contacts ? runoff / contacts : 0;
    s.onGravel = contacts ? gravel / contacts : 0;

    // ── Tyre loads and grip per axle ───────────────────────────────────────
    const df = V.downforce * speed * speed;
    const w = this.wet;
    const wA = 1 - w * (1 - WEATHER.wetGripAsphalt);
    const wK = 1 - w * (1 - WEATHER.wetGripKerb);
    const wG = 1 - w * (1 - WEATHER.wetGripGrass);
    const wR = 1 - w * (1 - WEATHER.wetGripRunoff);
    // spike strips: punctured tyres hold less and can't take the full torque
    const punct = s.puncture > 0 ? 1 : 0;
    if (s.puncture > 0) s.puncture = Math.max(0, s.puncture - dt);
    const pG = 1 - punct * (1 - POLICE.punctureGrip);
    const mu0 = (i: number) =>
      s.wheelSurface[i] === Surface.Grass ? V.gripGrass * wG : s.wheelSurface[i] === Surface.Gravel ? V.gripGravel * wG : s.wheelSurface[i] === Surface.Kerb ? V.gripKerb * wK : s.wheelSurface[i] === Surface.Runoff ? V.gripRunoff * wR : V.gripAsphalt * wA;
    const frontOn = s.wheelContact[0] || s.wheelContact[1];
    const rearOn = s.wheelContact[2] || s.wheelContact[3];
    // Tyre load = suspension load. Under braking it is pulled part-way back towards the static
    // split, so the unloaded rear does not snap round when you brake into a corner.
    const k = 1 - (1 - V.loadTransferGrip) * brakeCmd;
    const sprung = load[0] + load[1] + load[2] + load[3];
    const fShare = V.cgToRear / WHEELBASE;
    const Nf = (frontOn ? (load[0] + load[1]) * k + sprung * fShare * (1 - k) + df * 0.45 : 0);
    const Nr = (rearOn ? (load[2] + load[3]) * k + sprung * (1 - fShare) * (1 - k) + df * 0.55 : 0);
    const mu = (i: number) => mu0(i) * pG;
    const muF = load[0] + load[1] > 1 ? (mu(0) * load[0] + mu(1) * load[1]) / (load[0] + load[1]) : V.gripAsphalt * wA;
    const muR = load[2] + load[3] > 1 ? (mu(2) * load[2] + mu(3) * load[3]) / (load[2] + load[3]) : V.gripAsphalt * wA;
    const gripF = muF * Nf;
    const gripR = muR * Nr;

    // ── Engine and gearbox ─────────────────────────────────────────────────
    const R = V.wheelRadius;
    const ratioOf = (g: number) => (g === -1 ? V.reverseRatio : V.gearRatios[g - 1]) * V.finalDrive;
    s.shiftTimer = Math.max(0, s.shiftTimer - dt);
    const toRpm = (Math.abs(vF) / R) * 9.5493;
    if (s.gear >= 1 && s.shiftTimer === 0) {
      if (s.manual) {
        if (inp.shiftUp && s.gear < V.gearRatios.length) {
          s.gear++;
          s.shiftTimer = V.shiftTime;
          s.shiftEvent = 1;
        } else if (inp.shiftDown && s.gear > 1 && toRpm * ratioOf(s.gear - 1) < V.redlineRpm) {
          s.gear--;
          s.shiftTimer = 0.08;
          s.shiftEvent = -1;
        }
      } else {
        const rpmNow = toRpm * ratioOf(s.gear);
        if (rpmNow > V.upshiftRpm && s.gear < V.gearRatios.length && drive > 0.05 && rearOn) {
          s.gear++;
          s.shiftTimer = V.shiftTime;
          s.shiftEvent = 1;
        } else if (s.gear > 1) {
          const rpmLower = toRpm * ratioOf(s.gear - 1);
          const kick = drive > 0.9 ? 6700 : brakeCmd > 0.2 ? 6300 : 4700;
          if (rpmLower < kick) {
            s.gear--;
            s.shiftTimer = 0.07;
            s.shiftEvent = -1;
          }
        }
      }
    }
    const ratio = ratioOf(s.gear);
    let rpm = Math.max(V.idleRpm, toRpm * ratio);
    if ((s.gear === 1 || s.gear === -1) && rpm < 3600 && drive > 0.05) {
      rpm = Math.max(rpm, 1900 + drive * 2300); // slipping clutch off the line
    }

    // Nitrous
    if (s.nitroActive) {
      if (!inp.nitro || s.nitro <= 0 || s.gear === -1) s.nitroActive = false;
    } else if (inp.nitro && s.nitro > V.nitroMinToFire && s.gear !== -1) {
      s.nitroActive = true;
    }
    if (s.nitroActive) s.nitro = Math.max(0, s.nitro - V.nitroBurn * dt);
    else {
      const driftBonus = smoothstep(0.15, 0.6, Math.abs(sideSlip)) * smoothstep(8, 20, speed);
      s.nitro = Math.min(
        1,
        s.nitro + (V.nitroRegen + V.nitroRegenDrift * driftBonus + (s.airborne ? V.nitroRegenAir : 0)) * dt,
      );
    }

    let torque = V.torque * torqueCurveOf(V)(rpm) * drive;
    if (rpm >= V.redlineRpm - 40) torque = 0; // rev limiter
    if (s.shiftTimer > 0) torque *= V.shiftTorqueCut;
    if (punct) torque *= POLICE.punctureTorque;
    // nitrous builds in over nitroRamp seconds instead of kicking all at once
    s.nitroLevel = V.nitroRamp > 0 ? clamp01(s.nitroLevel + (s.nitroActive ? dt / V.nitroRamp : -dt / 0.15)) : s.nitroActive ? 1 : 0;
    if (s.nitroLevel > 0) torque *= 1 + V.nitroTorque * s.nitroLevel;
    // traction control trims power while the rear is already stepping out
    if (V.tractionControl > 0) torque *= 1 - 0.55 * V.tractionControl * smoothstep(0.22, 0.6, Math.abs(sideSlip)) * smoothstep(8, 16, speed);
    let Fdrive = (torque * ratio * V.driveEfficiency) / R;

    // Traction limit → wheelspin
    let spin = 0;
    // loose surfaces: extra bite at walking pace so a car can always drive itself out of the grass
    const loose = (s.onGrass + s.onGravel) * (V.looseTraction - 1) * (1 - smoothstep(4, 15, speed));
    const tractionCap = Math.max(gripR * V.tractionBoost * (1 + loose), 1);
    const usage = Fdrive / tractionCap;
    if (usage > 1) {
      spin = clamp01((usage - 1) * 1.5 + 0.25) * (1 - 0.75 * V.tractionControl);
      Fdrive = tractionCap * (V.tractionControl > 0 ? 0.98 : 0.94);
    }
    if (!rearOn) {
      Fdrive = 0;
      spin = drive > 0.2 ? 1 : 0; // wheels free-rev in the air
    }
    s.wheelSpinSlip += (spin - s.wheelSpinSlip) * Math.min(1, dt * 12);
    rpm = Math.min(V.redlineRpm, rpm * (1 + 0.3 * s.wheelSpinSlip));
    s.rpm += (rpm - s.rpm) * Math.min(1, dt * 16);

    // ── Longitudinal forces ────────────────────────────────────────────────
    const dir = vF > 0.05 ? 1 : vF < -0.05 ? -1 : 0;
    const brakeTotal = brakeCmd * V.brakeDecel * V.mass;
    let FbF = Math.min(brakeTotal * V.brakeFrontBias, gripF * 0.97);
    let FbR = Math.min(brakeTotal * (1 - V.brakeFrontBias), gripR * 0.97);
    if (inp.handbrake) FbR = Math.max(FbR, gripR * V.handbrakeDrag);
    const lowSpeedFade = clamp01(Math.abs(vF) / 0.6);
    FbF *= lowSpeedFade;
    FbR *= lowSpeedFade;
    const grassFrac = s.onGrass;
    // 4E: gravel bogs the car down; a flat tyre drags (a lower top speed)
    const rollDecel = V.rollResist * G + grassFrac * (V.grassDragBase + V.grassDragSpeed * speed) + s.onRunoff * 0.25 + s.onGravel * (V.gravelDragBase + V.gravelDragSpeed * speed) + punct * (POLICE.punctureDrag + 0.012 * speed);
    const Froll = contacts ? rollDecel * V.mass * lowSpeedFade : 0;

    const FxR = (s.gear === -1 ? -Fdrive : Fdrive) - dir * FbR - dir * Froll;
    const FxF = -dir * FbF;

    // Friction circle: longitudinal effort eats lateral grip.
    const useR = clamp01(Math.abs(FxR) / tractionCap);
    const useF = clamp01(Math.abs(FxF) / Math.max(gripF, 1));
    // Throttle loosens the rear a lot (power slides); braking only a little (stable trail-braking).
    const driving = drive > brakeCmd && !inp.handbrake;
    let latR = Math.sqrt(1 - ((driving ? V.powerSlide : V.brakeSlide) * useR) ** 2);
    const latF = Math.sqrt(1 - (V.brakeUndersteer * (1 - 0.35 * V.brakeAssist) * useF) ** 2);
    latR *= 1 - V.spinSlideLoss * s.wheelSpinSlip; // spinning tyres have little sideways bite
    // Drift sustain: once the tail is out, keeping the throttle in and steering into the corner
    // holds the slide; easing off or steering out lets the rear hook up again.
    const into = -target * Math.sign(sideSlip) < -0.15 ? 1 : 0.15; // steering the same way the car is rotating
    const driftWant =
      smoothstep(0.12, 0.3, Math.abs(sideSlip)) * smoothstep(0.25, 0.65, drive) * smoothstep(9, 16, speed) * into;
    s.drift += (driftWant - s.drift) * Math.min(1, dt * (driftWant > s.drift ? 6 : 3.5));
    latR *= 1 - V.driftSustain * s.drift;
    if (inp.handbrake) latR *= V.handbrakeGrip;
    // Spin protection: as the slide angle gets extreme the rear bites again, so drifts stay catchable.
    latR *= 1 + 1.4 * smoothstep(0.75, 1.35, Math.abs(sideSlip));

    // ── Lateral tyre forces ────────────────────────────────────────────────
    const cs = Math.cos(delta);
    const sn = Math.sin(delta);
    const r = s.yawRate;
    const vay = vL + V.cgToFront * r;
    const vwx = cs * vF + sn * vay;
    const vwy = -sn * vF + cs * vay;
    const slipF = Math.atan2(vwy, Math.max(Math.abs(vwx), V.minSlipSpeed));
    const slipR = Math.atan2(vL - V.cgToRear * r, Math.max(Math.abs(vF), V.minSlipSpeed));
    const FyF = -gripF * latF * tyre(slipF); // along the steered wheel's left axis
    const FyR = -gripR * latR * tyre(slipR);

    // Sum in the body frame
    const bodyF = FxR + FxF * cs - FyF * sn;
    const bodyL = FyR + FxF * sn + FyF * cs;
    let Mz = V.cgToFront * (FxF * sn + FyF * cs) - V.cgToRear * FyR;
    Mz -= V.yawDamping * r * (contacts ? 1 : 0.15);
    // Drift assist: beyond the drift-angle limit a restoring torque catches the slide, so a drift
    // can be held on the throttle without snapping into a spin. Looser while the handbrake is held
    // (so handbrake turns still work) and off at low speed (so donuts still work).
    if (contacts >= 2 && vF > 0) {
      const fade = smoothstep(V.driftAssistFrom, V.driftAssistFrom + 10, speed) * (inp.handbrake ? 0.6 : 1);
      // hard on the brakes the limit tightens right up: braking into a corner stays stable (ABS/ESP feel)
      const limit = inp.handbrake ? V.driftAngleLimitHandbrake : V.driftAngleLimit - (V.driftAngleLimit - V.brakeAngleLimit * (1 - 0.4 * V.brakeAssist)) * brakeCmd;
      const excess = sideSlip - clamp(sideSlip, -limit, limit);
      Mz += fade * V.driftCatch * excess;
      Mz -= fade * V.driftDamping * r * smoothstep(0.25, 0.8, Math.abs(sideSlip));
    }

    let aF = bodyF / V.mass;
    const aL = bodyL / V.mass;
    if (s.nitroLevel > 0 && rearOn) aF += V.nitroAccel * s.nitroLevel * Math.max(0, 1 - speed / V.nitroFadeSpeed);
    s.accelF += (aF - s.accelF) * Math.min(1, dt * 10);
    s.accelL += (aL - s.accelL) * Math.min(1, dt * 10);

    // ── Integrate the horizontal plane ─────────────────────────────────────
    const drag = (V.dragCoef * (s.nitroActive ? V.nitroDragScale : 1) * (1 - V.draftDrag * s.draft) * speed) / V.mass;
    const vFold = vF;
    s.vx += (aF * fx + aL * lx - drag * s.vx) * dt;
    s.vz += (aF * fz + aL * lz - drag * s.vz) * dt;
    s.yawRate += (Mz / V.yawInertia) * dt;
    // 4E: on gravel the car twitches as the stones roll under the tyres
    if (s.onGravel > 0 && speed > 3) s.yawRate += Math.sin(s.x * 0.9 + s.z * 1.3) * Math.sin(this.wob += dt * 17) * V.gravelWobble * 0.9 * s.onGravel * smoothstep(3, 25, speed) * dt;

    // Brakes must stop the car, not shove it backwards.
    if ((brakeCmd > 0.05 || inp.handbrake) && contacts) {
      const vFnew = s.vx * fx + s.vz * fz;
      if (vFold * vFnew < 0 && Math.abs(vFold) < 1.5) {
        s.vx -= vFnew * fx;
        s.vz -= vFnew * fz;
      }
    }
    // Come to a clean rest instead of creeping.
    if (contacts === 4 && drive < 0.02 && Math.hypot(s.vx, s.vz) < 0.35 && Math.abs(s.yawRate) < 0.3) {
      const k = Math.min(1, dt * 8);
      s.vx -= s.vx * k;
      s.vz -= s.vz * k;
      s.yawRate -= s.yawRate * k;
    }

    s.yaw += s.yawRate * dt;
    s.x += s.vx * dt;
    s.z += s.vz * dt;

    // ── Integrate heave / pitch / roll ─────────────────────────────────────
    s.vy += (sumF / V.mass - G) * dt;
    s.pitchRate += ((sumFz + V.mass * s.accelF * V.cgHeightPitch) / V.pitchInertia) * dt;
    s.rollRate += ((sumFx + V.mass * s.accelL * V.cgHeightRoll) / V.rollInertia) * dt;
    if (s.airborne) {
      // Gentle air stabilisation so landings are survivable: level the roll, point the nose along the arc.
      const want = clamp(Math.atan2(s.vy, Math.max(speed, 8)) * 0.55, -0.16, 0.3);
      s.pitchRate += ((want - s.pitch) * V.airPitchSpring - s.pitchRate * V.airPitchDamp) * dt;
      s.rollRate += (-s.roll * 24 - s.rollRate * 8) * dt;
      s.airTime += dt;
    }
    s.y += s.vy * dt;
    s.pitch += s.pitchRate * dt;
    s.roll += s.rollRate * dt;
    s.pitch = clamp(s.pitch, -0.6, 0.6);
    s.roll = clamp(s.roll, -0.6, 0.6);

    // Hard bump stops (position + velocity projection): the body can never sink through the ground.
    let landing = 0;
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < 4; i++) {
        const ax = WHEEL_X[i];
        const az = WHEEL_Z[i];
        const gap = s.y + az * s.pitch + ax * s.roll - s.wheelGround[i];
        const pen = -V.bumpTravel - gap;
        if (pen <= 0) continue;
        const w = 1 / V.mass + (az * az) / V.pitchInertia + (ax * ax) / V.rollInertia;
        const lam = pen / w;
        s.y += lam / V.mass;
        s.pitch += (lam * az) / V.pitchInertia;
        s.roll += (lam * ax) / V.rollInertia;
        const vrel = s.vy + az * s.pitchRate + ax * s.rollRate;
        if (vrel < 0) {
          const j = -vrel / w;
          s.vy += j / V.mass;
          s.pitchRate += (j * az) / V.pitchInertia;
          s.rollRate += (j * ax) / V.rollInertia;
          if (-vrel > landing) landing = -vrel;
        }
      }
    }
    if (landing > s.landing) s.landing = landing;
    if (wasAirborne && !s.airborne) {
      s.lastAirTime = s.airTime;
      s.airTime = 0;
      // a touchdown always registers, even a soft one
      if (s.lastAirTime > 0.25) s.landing = Math.max(s.landing, 1.5 + Math.min(4, -s.vy * 0.5));
    }

    // ── Static world collisions (three circles along the body) ─────────────
    for (let c = 0; c < V.bodyCircleOffsets.length; c++) {
      const off = V.bodyCircleOffsets[c];
      const cx = s.x + Math.sin(s.yaw) * off;
      const cz = s.z + Math.cos(s.yaw) * off;
      W.collide(cx, cz, V.bodyRadius, s.y + off * s.pitch, (nx, nz, pen, px, pz) => {
        s.x += nx * pen;
        s.z += nz * pen;
        const rx = px - s.x;
        const rz = pz - s.z;
        const vcx = s.vx + s.yawRate * rz;
        const vcz = s.vz - s.yawRate * rx;
        const vn = vcx * nx + vcz * nz;
        if (vn >= 0) return;
        const cn = rz * nx - rx * nz;
        const kn = 1 / V.mass + (cn * cn) / V.yawInertia;
        const j = (-(1 + V.wallRestitution) * vn) / kn;
        s.vx += (j * nx) / V.mass;
        s.vz += (j * nz) / V.mass;
        s.yawRate += ((j * cn) / V.yawInertia) * 0.6;
        // friction along the wall
        const tx = -nz;
        const tz = nx;
        const vt = vcx * tx + vcz * tz;
        const ct = rz * tx - rx * tz;
        const kt = 1 / V.mass + (ct * ct) / V.yawInertia;
        const jt = clamp(-vt / kt, -V.wallFriction * j, V.wallFriction * j);
        s.vx += (jt * tx) / V.mass;
        s.vz += (jt * tz) / V.mass;
        s.yawRate += ((jt * ct) / V.yawInertia) * 0.6;
        const strength = j / V.mass;
        if (strength > 0.4) s.impacts.push({ x: px, y: s.y + 0.45, z: pz, nx, nz, strength });
      });
    }
    s.yawRate = clamp(s.yawRate, -4.5, 4.5);

    // ── Telemetry ──────────────────────────────────────────────────────────
    const nvF = s.vx * Math.sin(s.yaw) + s.vz * Math.cos(s.yaw);
    const nvL = s.vx * Math.cos(s.yaw) - s.vz * Math.sin(s.yaw);
    s.speed = Math.hypot(s.vx, s.vz);
    s.forwardSpeed = nvF;
    s.lateralSpeed = nvL;
    s.sideSlip = s.speed > 2 ? Math.atan2(nvL, Math.abs(nvF)) : 0;
    const moving = smoothstep(3, 9, s.speed);
    const slideR = smoothstep(0.16, 0.5, Math.abs(slipR)) * moving;
    const slideF = smoothstep(0.2, 0.55, Math.abs(slipF)) * moving;
    const lock = inp.handbrake ? smoothstep(2, 8, s.speed) : 0;
    const rearSlip = Math.max(slideR, s.wheelSpinSlip * (rearOn ? 1 : 0), lock);
    for (let i = 0; i < 4; i++) {
      const target = s.wheelContact[i] ? (i < 2 ? slideF : rearSlip) : 0;
      s.wheelSlip[i] += (target - s.wheelSlip[i]) * Math.min(1, dt * 14);
      // visual suspension travel: clamp to the droop limit when a wheel hangs in the air
      const gap = s.y + WHEEL_Z[i] * s.pitch + WHEEL_X[i] * s.roll - s.wheelGround[i];
      s.wheelDrop[i] = clamp(gap, -V.bumpTravel, V.staticCompression + 0.04);
      // wheel rotation: rears overspin under power and stop dead on the handbrake
      let omega = nvF / R;
      if (i >= 2) {
        if (inp.handbrake) omega = 0;
        else omega += (s.gear === -1 ? -1 : 1) * s.wheelSpinSlip * 55;
      }
      s.wheelRot[i] += omega * dt;
    }
  }
}
