// ─────────────────────────────────────────────────────────────────────────────
// Race — the simulation of everyone on track: the player plus AI rivals. Owns each car's
// physics, steps them together at the fixed rate, resolves car-to-car contact and slipstream,
// tracks laps and positions, and runs the grid countdown.
// No rendering imports: main.ts draws it, and the Stage 2D server will run this same class.
// ─────────────────────────────────────────────────────────────────────────────
import { prof } from '../core/Profiler';
import { AIDriver, Style } from '../ai/AIDriver';
import { RacingLine } from '../ai/RacingLine';
import { AI, PAINTS, RACE_FLOW, RECOVERY, RIVALS, STEER_ASSIST, VEHICLE as V, WEATHER } from '../config';
import { clamp, wrapAngle } from '../core/math';
import { CarLook, DriverAids, EXPERT_AIDS, Loadout, lookFromPaint, lookOf, modelOf, rivalEdition, tunedVehicle } from '../vehicle/Cars';
import { collideCars } from '../vehicle/CarCollisions';
import { VehicleInput, VehiclePhysics, VehicleState } from '../vehicle/VehiclePhysics';
import { WorldData } from '../world/WorldData';
import { LapTimer } from './LapTimer';
import { Pursuit } from './Pursuit';

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
}

export interface RaceCar {
  id: number;
  name: string;
  number: number;
  isPlayer: boolean;
  paint: number;
  physics: VehiclePhysics;
  s: VehicleState;
  driver: AIDriver | null;
  lap: LapTimer;
  input: VehicleInput;
  // where the car is relative to the circuit, refreshed every step
  trackIndex: number;
  trackOffset: number;
  trackS: number;
  onTrack: boolean;
  /** 1 = leading */
  place: number;
  /** pose before the latest step, for render interpolation */
  prev: Pose;
  grid: number;
  // ── online play ──
  /** true for cars simulated on someone else's machine (another player, or AI run by the host) */
  remote: boolean;
  /** who owns it: a peer id, or "ai:<n>" for a host-run rival */
  netId: string;
  /** latest state received for a remote car */
  net: NetCar | null;
  netTime: number; // seconds (local clock) when `net` arrived
  netDistance: number; // race distance reported by its owner
  /** owner has left: the car is parked out of the way and ignored */
  gone: boolean;
  edition: string;
  look: CarLook;
  /** laps target reached */
  finished: boolean;
  /** race time when it finished (s) */
  finishTime: number;
}

export interface ResultRow {
  car: RaceCar;
  place: number;
  finished: boolean;
  time: number; // total time if finished
  best: number;
  /** text for the time column: total time for the winner, +gap for others, or "+1 lap" / "Running" */
  gap: string;
}

/** What describes one car when a race is set up. */
export interface CarSpec {
  kind: 'player' | 'ai' | 'remote';
  name: string;
  number: number;
  paint: number;
  grid: number;
  style?: Style;
  netId?: string;
  /** car-select edition (tuning): the local player's car, and (4.6) AI rivals in imported cars */
  edition?: string;
  /** full garage look; defaults to the factory paint */
  look?: CarLook;
}

/**
 * Compact car state sent over the network:
 * [x, y, z, yaw, vx, vz, yawRate, pitch, roll, steer, flags, slip]
 * flags: 1 nitrous, 2 braking, 4 reverse, 8 airborne.  slip: 0..1 rear tyre slip (for smoke).
 */
export type NetCar = number[];

export function packCar(s: VehicleState): NetCar {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const flags = (s.nitroActive ? 1 : 0) | (s.brake > 0.05 || s.handbrake ? 2 : 0) | (s.gear === -1 ? 4 : 0) | (s.airborne ? 8 : 0);
  return [r2(s.x), r2(s.y), r2(s.z), r3(s.yaw), r2(s.vx), r2(s.vz), r3(s.yawRate), r3(s.pitch), r3(s.roll), r3(s.steerAngle), flags, r2(Math.max(s.wheelSlip[2], s.wheelSlip[3]))];
}

/** A received car state is untrusted input: accept it only if it is a sane list of numbers. */
export function validNetCar(a: unknown): a is NetCar {
  if (!Array.isArray(a) || a.length < 12) return false;
  for (let i = 0; i < 12; i++) if (typeof a[i] !== 'number' || !Number.isFinite(a[i])) return false;
  return Math.abs(a[0]) < 5000 && Math.abs(a[2]) < 5000 && Math.abs(a[1]) < 200 && Math.abs(a[4]) < 200 && Math.abs(a[5]) < 200;
}

export type Difficulty = 'easy' | 'medium' | 'hard';

function formatTotal(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}
const blankInput = (): VehicleInput => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, analog: false, shiftUp: false, shiftDown: false });
const COUNTDOWN = 4.2;

export class Race {
  readonly cars: RaceCar[] = [];
  readonly player: RaceCar;
  readonly line: RacingLine;
  /** seconds until the lights go out (>0 = cars are held on the grid) */
  countdown = COUNTDOWN;
  /** seconds since the start */
  time = 0;
  /** one-shot for the HUD/audio: 3, 2, 1 then 0 for GO; −1 when nothing happened this step */
  lightEvent = -1;
  /** hardest car-to-car hit involving the player this step (m/s) */
  playerContact = 0;

  /** After the last light the grid waits a random beat on "Set" before the go (part of the countdown). */
  hold = 0;
  /** how hard it is raining (0..1): set by the game (the host online) and sent to guests */
  rainK = 0.7;
  /** the game turns this on; off (a fixed hold) in tests */
  randomHold = false;
  /** seconds the player is still pinned for a jump start (stabbing the throttle on "Set") */
  jumpT = 0;
  /** true once this start has been called a jump start (for the HUD call-out) */
  jumped = false;
  private prevThrottle = 0;
  /** when true the countdown is driven from outside (the online host's clock), not counted here */
  clockExternal = false;
  private lastLight = 99;
  private clock = 0; // local seconds, for ageing network snapshots
  get netClock(): number {
    return this.clock;
  }

  /** laps to race; 0 = endless (free run) */
  targetLaps = 0;
  /** seconds since the player crossed the line (−1 = not finished) */
  sincePlayerFinish = -1;
  /** player recovery state for the HUD */
  recovery = { stuckFor: 0, wrongWay: false, offTrack: false };
  /** one-shot: the player was automatically put back on the circuit this step */
  rejoined = false;
  /** police, Heat and traps (Pursuit Race only) */
  pursuit: Pursuit | null = null;
  private trafficBuf: RaceCar[] = [];
  /** steering assist strength for the local player (0 = off) */
  steerAssist = 0;

  constructor(private world: WorldData, specs: CarSpec[], difficulty: Difficulty, bestLap: number, aids: DriverAids = EXPERT_AIDS, steerAssist = 0) {
    this.steerAssist = STEER_ASSIST[steerAssist] ?? 0;
    this.line = new RacingLine(world);
    let player: RaceCar | null = null;
    specs.forEach((sp, i) => {
      const edition = sp.edition ?? 'x1-street';
      // 4.6: an AI rival in an imported car drives with that car's engine, gearbox and aero
      const aiOwn = sp.kind === 'ai' && modelOf(edition).visual === 'imported';
      const physics = new VehiclePhysics(world, sp.kind === 'player' ? tunedVehicle(edition, aids) : aiOwn ? tunedVehicle(edition, EXPERT_AIDS) : undefined);
      const car: RaceCar = {
        id: i, name: sp.name, number: sp.number, isPlayer: sp.kind === 'player', paint: sp.paint, physics, s: physics.s,
        driver: sp.kind === 'ai' ? new AIDriver(world, this.line, sp.style ?? 'clean', AI.levels[difficulty], 1000 + sp.grid * 77) : null,
        lap: new LapTimer(world, sp.kind === 'player' ? bestLap : 0), input: blankInput(),
        trackIndex: 0, trackOffset: 0, trackS: 0, onTrack: true, place: sp.grid + 1, prev: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 }, grid: sp.grid,
        remote: sp.kind === 'remote', netId: sp.netId ?? '', net: null, netTime: 0, netDistance: 0, gone: false,
        edition, look: sp.look ?? lookFromPaint(sp.paint, edition), finished: false, finishTime: 0,
      };
      if (car.isPlayer && !player) player = car;
      else this.cars.push(car);
    });
    if (!player) throw new Error('a race needs a player car');
    this.player = player;
    this.cars.unshift(player); // cars[0] is always the player
    this.cars.forEach((c, i) => (c.id = i));
    this.toGrid();
  }

  /** The single-player field: the player at the back of the grid behind `rivals` AI cars. */
  static soloSpecs(rivals: number, loadout: Loadout): CarSpec[] {
    const look = lookOf(loadout);
    const playerPaint = look.paintIndex;
    const count = Math.min(rivals, RIVALS.length);
    // every car gets a different paint: the player keeps theirs, rivals take the rest in order
    const free = PAINTS.map((_, i) => i).filter((i) => i !== playerPaint);
    const specs: CarSpec[] = [];
    for (let i = 0; i < count; i++) specs.push(Race.rivalSpec(i, free[i % free.length], i));
    specs.push({ kind: 'player', name: 'You', number: 1, paint: playerPaint, grid: count, edition: loadout.edition, look });
    return specs;
  }

  /** 4.6: an AI rival; with imported cars in the catalogue some drive them, in their factory colours. */
  static rivalSpec(idx: number, paint: number, grid: number, editionId?: string): CarSpec {
    const edition = editionId ?? rivalEdition(idx);
    const imported = modelOf(edition).visual === 'imported';
    const look = imported ? { ...lookOf({ edition, paint: null, customColor: null, finish: null, rim: null, caliper: null, underglow: null }), paintIndex: paint } : undefined;
    return { kind: 'ai', name: RIVALS[idx].name, number: RIVALS[idx].number, paint, grid, style: RIVALS[idx].style, edition, look };
  }

  /** Race distance of any car, wherever it is simulated. */
  distanceOf(c: RaceCar): number {
    return c.remote ? c.netDistance : c.lap.distance;
  }

  get held(): boolean {
    return this.countdown > 0;
  }

  /** Where the start lights are: 3, 2, 1, then 0.5 for "Set" (the random hold), then 0 for go. */
  stage(): number {
    if (this.countdown <= 0) return 0;
    if (this.countdown > this.hold) return Math.ceil(this.countdown - this.hold);
    return 0.5;
  }

  /** 4C.2 online lobby: keep the grid waiting before the lights (call every frame while waiting). */
  lobbyHold(): void {
    if (this.cars.length > 1 || this.clockExternal) this.countdown = Math.max(this.countdown, COUNTDOWN + this.hold);
    else this.countdown = Math.max(this.countdown, 0.01);
  }

  /** 4C.2 online: a friend dropped out mid-race — an AI driver takes their car where it is. */
  takeOver(c: RaceCar, difficulty: Difficulty, seed: number): void {
    c.remote = false;
    c.net = null;
    c.gone = false;
    c.netId = `ai:${c.grid}`;
    c.driver = new AIDriver(this.world, this.line, 'clean', AI.levels[difficulty], seed);
    c.driver.wetK = 1 - this.wet * (1 - WEATHER.wetGripAsphalt * WEATHER.aiWetMargin);
    if (c.s.y < -10) c.s.y = 0; // it was parked out of sight
    // the lap counter carries on from the distance the friend had reached
    c.lap.resumeFrom(c.netDistance);
  }

  /** Put everyone back on the grid and restart the countdown. */
  toGrid(): void {
    for (const c of this.cars) {
      const g = this.cars.length > 1 ? this.world.gridPose(c.grid) : this.world.startPose();
      c.physics.reset(g.x, g.z, g.yaw);
      c.s.nitro = 1;
      c.lap.reset();
      c.driver?.reset();
      c.net = null;
      c.finished = false;
      c.finishTime = 0;
      if (c.isPlayer) c.driver = null;
      this.capture(c);
      this.locate(c);
      c.lap.update(c.s, 0); // registers where on the lap the car is sitting, so grid order ranks correctly
      c.netDistance = c.lap.distance;
    }
    const u = this.randomHold ? Math.random() : 0.5; // fixed in tests so runs stay deterministic
    this.hold = this.cars.length > 1 ? RACE_FLOW.holdMin + u * (RACE_FLOW.holdMax - RACE_FLOW.holdMin) : 0;
    this.countdown = this.cars.length > 1 ? COUNTDOWN + this.hold : 0;
    this.jumpT = 0;
    this.jumped = false;
    this.prevThrottle = 1;
    this.sincePlayerFinish = -1;
    this.recovery.stuckFor = 0;
    this.pursuit?.reset();
    this.lastLight = this.stage();
    this.time = 0;
    this.rank();
  }

  private capture(c: RaceCar): void {
    const s = c.s;
    c.prev.x = s.x;
    c.prev.y = s.y;
    c.prev.z = s.z;
    c.prev.yaw = s.yaw;
    c.prev.pitch = s.pitch;
    c.prev.roll = s.roll;
  }

  private locate(c: RaceCar): void {
    if (c.gone) {
      c.onTrack = false;
      return;
    }
    const hit = this.world.nearestTrack(c.s.x, c.s.z);
    if (hit && Math.abs(hit.offset) < this.world.halfWidth + 3.5) {
      c.trackIndex = hit.index;
      c.trackOffset = hit.offset;
      c.trackS = hit.s;
      c.onTrack = true;
    } else {
      if (hit) {
        c.trackIndex = hit.index;
        c.trackOffset = hit.offset;
        c.trackS = hit.s;
      }
      c.onTrack = false;
    }
  }

  step(playerInput: VehicleInput, dt: number): void {
    this.lightEvent = -1;
    this.playerContact = 0;
    const cars = this.cars;
    this.clock += dt;
    const held = this.countdown > 0;
    if (held && !this.clockExternal) this.countdown -= dt;
    if (!held) this.time += dt;
    const light = this.stage();
    if (light !== this.lastLight) {
      if (light <= 3 && light < this.lastLight) this.lightEvent = light;
      this.lastLight = light;
    }
    // Jump start: revving on the lights is fine, but stabbing the throttle during the "Set" hold
    // (guessing the go) keeps you pinned for a moment after everyone else leaves.
    const thr = playerInput.throttle;
    if (held && light === 0.5 && !this.jumped && !this.player.remote && thr > 0.6 && this.prevThrottle < 0.3) {
      this.jumped = true;
      this.jumpT = RACE_FLOW.jumpPenalty;
    }
    this.prevThrottle = thr;
    if (!held && this.jumpT > 0) this.jumpT = Math.max(0, this.jumpT - dt);
    const sinceGo = held ? -this.countdown : this.time;

    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      this.capture(c);
      this.locate(c);
    }
    const pd = this.player.lap.distance;
    let traffic = cars;
    if (this.pursuit) {
      traffic = this.trafficBuf;
      traffic.length = 0;
      for (const c of cars) traffic.push(c);
      for (const c of this.pursuit.traffic()) traffic.push(c);
    }
    const busted = !!this.pursuit && this.pursuit.bustedT > 0;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c.remote) {
        this.applyRemote(c, dt);
        continue;
      }
      if (c.driver) {
        const t0 = prof.now();
        c.driver.update(c, traffic, dt, sinceGo, pd - c.lap.distance);
        if (this.pursuit && !held) this.pursuit.aiReact(c); // 4E: smoke, drop markers, heli spikes
        prof.add('ai', t0);
        if (c.driver.wantRespawn && !held) {
          c.driver.wantRespawn = false;
          this.rejoin(c);
        }
      } else {
        const p = c.input;
        if (busted) {
          // serving a Busted penalty: hands off
          Object.assign(p, { throttle: 0, brake: 0, steer: 0, handbrake: true, nitro: false, shiftUp: false, shiftDown: false });
          c.physics.step(p, dt);
          continue;
        }
        p.throttle = playerInput.throttle;
        p.brake = held ? 0 : playerInput.brake;
        p.steer = held ? playerInput.steer : clamp(playerInput.steer + this.assistSteer(c, playerInput.steer), -1, 1);
        p.handbrake = playerInput.handbrake;
        p.nitro = held ? false : playerInput.nitro;
        p.analog = playerInput.analog;
        p.shiftUp = playerInput.shiftUp;
        p.shiftDown = playerInput.shiftDown;
      }
      if (held || (c === this.player && this.jumpT > 0)) {
        // On the grid the car is pinned in place, but the engine still revs and the rears can spin.
        const s = c.s;
        const x = s.x;
        const z = s.z;
        const yaw = s.yaw;
        c.physics.step(c.input, dt);
        s.x = x;
        s.z = z;
        s.yaw = yaw;
        s.vx = s.vz = s.yawRate = 0;
        s.speed = s.forwardSpeed = 0;
        s.impacts.length = 0;
      } else c.physics.step(c.input, dt);
    }

    if (!held) {
      for (let i = 0; i < cars.length; i++) if (cars[i].s.ghost > 0) cars[i].s.ghost = Math.max(0, cars[i].s.ghost - dt);
      this.updateRecovery(dt);
      // car-to-car contact
      for (let i = 0; i < cars.length; i++) {
        for (let j = i + 1; j < cars.length; j++) {
          // A remote car is moved by its owner; here it only acts as an obstacle for local cars.
          if ((cars[i].remote && cars[j].remote) || cars[i].gone || cars[j].gone || cars[i].s.ghost > 0 || cars[j].s.ghost > 0) continue;
          const hit = collideCars(cars[i].s, cars[j].s);
          if (cars[i].remote) cars[i].s.impacts.length = 0;
          if (cars[j].remote) cars[j].s.impacts.length = 0;
          if (hit > 0 && (i === 0 || j === 0) && hit > this.playerContact) this.playerContact = hit;
        }
      }
      // slipstream: tucked in behind another car, in its wake
      for (let i = 0; i < cars.length; i++) {
        const a = cars[i].s;
        let best = 0;
        if (a.speed > 25 && !cars[i].remote) {
          const fx = Math.sin(a.yaw);
          const fz = Math.cos(a.yaw);
          for (let j = 0; j < cars.length; j++) {
            if (j === i || cars[j].gone) continue;
            const b = cars[j].s;
            if (b.speed < 25) continue;
            const rx = b.x - a.x;
            const rz = b.z - a.z;
            const ahead = rx * fx + rz * fz;
            if (ahead < 3 || ahead > V.draftRange) continue;
            const side = Math.abs(rx * fz - rz * fx);
            if (side > 1.3 + ahead * 0.035) continue;
            const k = 1 - (ahead - 3) / (V.draftRange - 3);
            if (k > best) best = k;
          }
        }
        a.draft += (best - a.draft) * Math.min(1, dt * 4);
      }
      if (this.pursuit) {
        const t0 = prof.now();
        this.pursuit.step(dt);
        prof.add('police', t0);
      }
      for (let i = 0; i < cars.length; i++) if (!cars[i].remote) cars[i].lap.update(cars[i].s, dt);
      // finishing: the race ends for a car when it completes the target lap count
      if (this.targetLaps > 0) {
        for (const c of cars) {
          if (c.finished || c.gone) continue;
          const laps = c.remote ? Math.floor(c.netDistance) : c.lap.laps;
          if (laps >= this.targetLaps) {
            c.finished = true;
            c.finishTime = this.time;
            if (c.isPlayer) {
              this.sincePlayerFinish = 0;
              // a cool-down lap on autopilot
              c.driver = new AIDriver(this.world, this.line, 'clean', AI.levels.easy, 99);
              c.driver.wetK = 1 - this.wet * (1 - WEATHER.wetGripAsphalt * WEATHER.aiWetMargin);
            }
          }
        }
        if (this.sincePlayerFinish >= 0) this.sincePlayerFinish += dt;
      }
      this.rank();
    }
  }

  /** Feed a remote car's newest snapshot (called by the online session). */
  receive(c: RaceCar, car: NetCar, distance: number): void {
    if (c.net !== car) {
      c.net = car;
      c.netTime = this.clock;
    }
    c.netDistance = distance;
    c.gone = false;
  }

  /**
   * Move a remote car: project its last snapshot forward by its velocity (dead reckoning) and
   * ease towards that, so 20-30 updates a second look continuous and small errors don't pop.
   */
  applyRemote(c: RaceCar, dt: number): void {
    const s = c.s;
    const n = c.net;
    if (c.gone || !n) {
      s.vx = s.vz = s.yawRate = 0;
      s.speed = s.forwardSpeed = 0;
      if (c.gone) {
        s.y = -50; // parked out of sight
        c.onTrack = false;
      }
      return;
    }
    // 4C.2: friends at home can be 100–250 ms away: allow older snapshots before giving up on them
    const age = Math.min(0.6, this.clock - c.netTime);
    const tx = n[0] + n[4] * age;
    const tz = n[2] + n[5] * age;
    const tyaw = n[3] + n[6] * age;
    // carry on at the reported velocity, then bleed off whatever error remains
    s.x += n[4] * dt;
    s.z += n[5] * dt;
    const err = Math.hypot(tx - s.x, tz - s.z);
    // big errors snap (a respawn, a crash); small ones bleed off gently so a laggy friend doesn't jitter
    const snap = Math.max(9, Math.hypot(n[4], n[5]) * 0.4);
    const k = err > snap ? 1 : Math.min(1, dt * (err > 2 ? 8 : 5));
    s.x += (tx - s.x) * k;
    s.z += (tz - s.z) * k;
    let dy = tyaw - s.yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    s.yaw += dy * k;
    s.y += (n[1] - s.y) * Math.min(1, dt * 18);
    s.pitch += (n[7] - s.pitch) * Math.min(1, dt * 18);
    s.roll += (n[8] - s.roll) * Math.min(1, dt * 18);
    s.vx = n[4];
    s.vz = n[5];
    s.yawRate = n[6];
    s.steerAngle = n[9];
    const flags = n[10];
    s.nitroActive = (flags & 1) !== 0;
    s.brake = flags & 2 ? 1 : 0;
    s.gear = flags & 4 ? -1 : 1;
    s.airborne = (flags & 8) !== 0;
    s.speed = Math.hypot(n[4], n[5]);
    s.forwardSpeed = n[4] * Math.sin(s.yaw) + n[5] * Math.cos(s.yaw);
    s.sideSlip = 0;
    for (let i = 0; i < 4; i++) {
      s.wheelGround[i] = s.airborne ? 0 : s.y;
      s.wheelDrop[i] = s.airborne ? V.staticCompression : 0;
      s.wheelContact[i] = !s.airborne;
      s.wheelSlip[i] = i >= 2 ? n[11] : 0;
      s.wheelRot[i] += (s.forwardSpeed / V.wheelRadius) * dt;
    }
    s.impacts.length = 0;
  }

  /**
   * Steering assist: a gentle pull towards a point ahead on the circuit at the car's own lateral
   * position (clamped inside the edges), fading out when the driver steers hard or is sliding.
   * It nudges, it never takes over, and it does nothing off the circuit or at low speed.
   */
  private assistSteer(c: RaceCar, steer: number): number {
    const k = this.steerAssist;
    if (k <= 0 || !c.onTrack) return 0;
    const s = c.s;
    if (s.speed < 10 || s.forwardSpeed < 0) return 0;
    const S = this.world.samples;
    const N = S.length;
    const hw = this.world.halfWidth;
    const ahead = Math.round((8 + s.speed * 0.55) / 2);
    const j = (c.trackIndex + ahead) % N;
    const off = clamp(c.trackOffset, -(hw - 1.6), hw - 1.6);
    const tx = S[j].x + S[j].nx * off;
    const tz = S[j].z + S[j].nz * off;
    const err = wrapAngle(Math.atan2(tx - s.x, tz - s.z) - s.yaw);
    if (Math.abs(err) > 1.2) return 0; // facing well away: leave it to the driver / recovery
    const want = clamp(-err * 2.2, -1, 1);
    const free = 1 - Math.min(1, Math.abs(steer) * 1.2); // the harder you steer, the less it helps
    const edge = clamp((Math.abs(c.trackOffset) - (hw - 2.5)) / 2.5, 0, 1); // stronger near the edge
    return clamp((want - steer * 0.3) * k * (0.35 + 0.65 * Math.max(free, edge)), -k, k);
  }

  /** Off-track, stopped or wrong-way timers for the player, and the automatic rejoin. */
  private updateRecovery(dt: number): void {
    const p = this.player;
    const s = p.s;
    const r = this.recovery;
    this.rejoined = false;
    if (p.finished || this.countdown > 0 || p.remote || (this.pursuit && this.pursuit.bustedT > 0)) {
      r.stuckFor = 0;
      r.wrongWay = false;
      return;
    }
    const smp = this.world.samples[p.trackIndex];
    const heading = Math.atan2(smp.tx, smp.tz);
    const travel = s.speed > 3 ? Math.atan2(s.vx, s.vz) : s.yaw;
    r.wrongWay = p.onTrack && Math.abs(wrapAngle(travel - heading)) > 2.1 && s.speed > 3;
    r.offTrack = !p.onTrack;
    const stuck = !p.onTrack || s.speed < 2.5 || r.wrongWay;
    r.stuckFor = stuck ? r.stuckFor + dt : 0;
    if (r.stuckFor > RECOVERY.autoAfter) this.rejoin(p);
  }

  /**
   * Put a car back on the circuit: the nearest point on the racing line with clear track around
   * it, facing the right way, rolling at a sensible speed, and briefly ghosted.
   */
  rejoin(c: RaceCar): void {
    const S = this.world.samples;
    const N = S.length;
    let i = c.trackIndex;
    for (let tries = 0; tries < 40; tries++) {
      const smp = S[i];
      let clear = true;
      for (const o of this.cars) {
        if (o === c || o.gone) continue;
        if (Math.hypot(o.s.x - smp.x, o.s.z - smp.z) < RECOVERY.clearGap) clear = false;
      }
      if (clear) break;
      i = (i + 4) % N; // move forward past traffic
    }
    const smp = S[i];
    const off = this.line.off[i];
    const yaw = Math.atan2(smp.tx, smp.tz);
    const nitro = c.s.nitro;
    c.physics.reset(smp.x + smp.nx * off, smp.z + smp.nz * off, yaw);
    const v = Math.min(RECOVERY.rejoinSpeed, this.line.v[i] * 0.7);
    c.s.vx = Math.sin(yaw) * v;
    c.s.vz = Math.cos(yaw) * v;
    c.s.nitro = nitro;
    c.s.ghost = RECOVERY.ghostTime;
    c.s.gear = 2;
    c.driver?.reset();
    this.capture(c);
    this.locate(c);
    if (c.isPlayer) {
      this.recovery.stuckFor = 0;
      this.rejoined = true;
    }
  }

  /** Turn this race into a Pursuit Race. */
  enablePursuit(seed = 7): Pursuit {
    this.pursuit = new Pursuit(this.world, this, seed);
    this.setWet(this.wet);
    return this.pursuit;
  }

  /** 0 dry .. 1 wet: every car's grip, and the AI's planned speeds. */
  wet = 0;
  setWet(w: number): void {
    this.wet = w;
    const k = 1 - w * (1 - WEATHER.wetGripAsphalt * WEATHER.aiWetMargin);
    for (const c of this.cars) {
      c.physics.wet = w;
      if (c.driver) c.driver.wetK = k;
    }
    if (this.pursuit) for (const u of this.pursuit.units) (u.car.physics.wet = w), (u.driver.wetK = k);
  }

  /** The race is over once every car has finished, or 40 s after the player did. */
  get over(): boolean {
    if (this.targetLaps <= 0 || this.sincePlayerFinish < 0) return false;
    return this.sincePlayerFinish > 40 || this.cars.every((c) => c.finished || c.gone);
  }

  /** Results so far, in finishing order then by race distance. */
  results(): ResultRow[] {
    const rows = this.cars
      .filter((c) => !c.gone)
      .slice()
      .sort((a, b) => a.place - b.place);
    const lead = rows.find((r) => r.finished);
    const leadDist = Math.max(...rows.map((r) => this.distanceOf(r)));
    return rows.map((c) => {
      let gap: string;
      if (c.finished) gap = lead && c !== lead ? `+${(c.finishTime - lead.finishTime).toFixed(3)}` : formatTotal(c.finishTime);
      else {
        const behind = Math.floor(leadDist - this.distanceOf(c));
        gap = behind >= 1 ? `+${behind} lap${behind > 1 ? 's' : ''}` : 'Running';
      }
      return { car: c, place: c.place, finished: c.finished, time: c.finishTime, best: c.remote ? 0 : c.lap.best, gap };
    });
  }

  private order: RaceCar[] = [];
  private rank(): void {
    if (this.order.length !== this.cars.length) this.order = this.cars.slice();
    // before anyone has crossed the line, grid order stands
    this.order.sort(
      (a, b) =>
        Number(a.gone) - Number(b.gone) ||
        Number(b.finished) - Number(a.finished) ||
        (a.finished && b.finished ? a.finishTime - b.finishTime : 0) ||
        this.distanceOf(b) - this.distanceOf(a) ||
        a.grid - b.grid,
    );
    for (let i = 0; i < this.order.length; i++) this.order[i].place = i + 1;
  }

  /** Give a car a new paint; whoever had it swaps, so no two cars ever match. */
  setPaint(car: RaceCar, paint: number): void {
    const other = this.cars.find((c) => c !== car && c.paint === paint);
    if (other) {
      other.paint = car.paint;
      other.look = lookFromPaint(other.paint, other.edition);
    }
    car.paint = paint;
  }
}
