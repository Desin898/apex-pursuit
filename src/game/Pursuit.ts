// ─────────────────────────────────────────────────────────────────────────────
// Pursuit — police, Heat and traps for a Pursuit Race (Phase 3C-3).
//
// Pacing by share of the race (not fixed laps):
//   lap 1            clean racing; trap gantries visible but off
//   from lap 2       speed traps live, work zones narrow the track
//   from `joinAt`    police leave the pit lane (start of lap 2 of 3, lap 3 of 5, lap 4 of 8)
//   then Heat 1–5    more units, PIT manoeuvres and rolling blocks, roadblocks (3),
//                    spike strips and rammers (4), the helicopter (5)
// Heat rises with trap flashes, hitting police, smashing barriers and long chases; it cools
// while you are out of sight. BUSTED fills while you are slow with police close; EVADE fills
// while nothing can see you.
//
// Pure logic, fixed-step and seeded like the rest of the simulation. The online host runs the
// director; guests run this in mirror mode (units, obstacles and Heat come from the host) and
// work out their own Busted / Evade / spikes / traps locally.
// ─────────────────────────────────────────────────────────────────────────────
import { AIDriver } from '../ai/AIDriver';
import { POLICE, VEHICLE as V } from '../config';
import { clamp, rng, smoothstep, wrapAngle } from '../core/math';
import { collideCars } from '../vehicle/CarCollisions';
import { VehiclePhysics } from '../vehicle/VehiclePhysics';
import type { VehicleParams } from '../vehicle/Cars';
import { WorldData } from '../world/WorldData';
import { LapTimer } from './LapTimer';
import { AirOne, type DropKind, type Heli } from './AirOne';
export type { Heli, Drop, DropKind } from './AirOne';
import type { NetCar, Race, RaceCar } from './Race';

/** cruiser: the patrol sedan; unmarked: a dark sedan from Heat 4; rammer: the heavy pickup from Heat 3 */
export type UnitKind = 'cruiser' | 'unmarked' | 'rammer';
export interface PoliceUnit {
  id: number;
  kind: UnitKind;
  car: RaceCar;
  driver: AIDriver;
  /** on the road (false: parked off the map waiting to deploy or respawn) */
  active: boolean;
  respawnIn: number;
  target: RaceCar | null;
  /** box-in side: −1 / +1, 0 = ram */
  side: number;
  slowT: number;
  /** can see its target right now */
  sees: boolean;
  /** seconds this unit is locked onto a rival that rammed it */
  aggroT: number;
  aggro: RaceCar | null;
  /** 0..1 how battered the car looks (from hits; sent to guests); 1 = wrecked */
  damage: number;
  /** seconds since the last horn blast (a blast warns before a ram) */
  hornT: number;
}

export type ObstacleKind = 'cone' | 'water' | 'saw' | 'jersey' | 'blockCar' | 'spikes';
export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  group: 'zone' | 'roadblock' | 'spikes';
  x: number;
  z: number;
  /** unit vector of the long axis, half length along it, half depth across it */
  ax: number;
  az: number;
  hl: number;
  hd: number;
  solid: boolean;
  broken: boolean;
  /** debris motion once broken (for the renderer) */
  vx: number;
  vz: number;
  brokenAt: number;
  life: number;
  /** 4E: dropped by Air One: the flat lasts until the end of the lap */
  lapLong?: boolean;
}


export type PursuitEvent =
  | { type: 'radio'; text: string }
  | { type: 'join' }
  | { type: 'heat'; level: number }
  | { type: 'trap'; speed: number; mine: boolean }
  | { type: 'zones' }
  | { type: 'roadblock' }
  | { type: 'spikes' }
  | { type: 'heli' }
  | { type: 'heliLeave' }
  | { type: 'drop'; kind: DropKind }
  | { type: 'landed'; kind: DropKind; x: number; z: number }
  | { type: 'smoked'; red: boolean }
  | { type: 'boom'; x: number; z: number; mine: boolean }
  | { type: 'spiked'; mine: boolean }
  | { type: 'smash'; kind: ObstacleKind; mine: boolean }
  | { type: 'policeHit'; strength: number }
  | { type: 'busted'; fine: number }
  | { type: 'freed' }
  | { type: 'restart' }
  | { type: 'evaded'; bounty: number }
  | { type: 'breaker'; index: number; wrecked: number; bounty: number }
  | { type: 'wrecked'; unit: number };

const SECTOR = ['the pit straight', 'sector one', 'the back of sector one', 'sector two', 'the far side', 'sector three', 'the run to the line'];
const UNIT_NAMES = ['Unit two', 'Unit four', 'Unit six', 'Unit seven', 'Unit nine', 'Unit eleven'];

/** Police tuning: the base car scaled by a multiplier table. */
export function policeVehicle(kind: UnitKind): VehicleParams {
  const v = { ...V } as Record<string, unknown>;
  const tune = kind === 'rammer' ? POLICE.rammerTune : kind === 'unmarked' ? POLICE.unmarkedTune : POLICE.cruiserTune;
  for (const [k, m] of Object.entries(tune)) if (typeof v[k] === 'number') v[k] = (v[k] as number) * m;
  v.tractionControl = 1;
  v.brakeAssist = 1;
  return v as unknown as VehicleParams;
}

const blankInput = () => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, analog: true, shiftUp: false, shiftDown: false });

export class Pursuit {
  readonly units: PoliceUnit[] = [];
  readonly obstacles: Obstacle[] = [];
  /** 4E: the helicopter's brain (flight, sight, drops) */
  readonly air: AirOne;
  get heli(): Heli {
    return this.air.heli;
  }
  events: PursuitEvent[] = [];
  /** shared Heat, 0..5.99 (level = floor, at least 1 once police are out) */
  heat = 0;
  /** police have joined the race */
  joined = false;
  trapsLive = false;
  zonesLive = false;
  /** local player's meters, 0..1 */
  bust = 0;
  evade = 0;
  /** >0 while the local player is busted and serving the penalty */
  bustedT = 0;
  /** police have had eyes on the local player since the last evade (Evade only counts then) */
  hot = false;
  /** seconds left of "patrol" after an evade */
  cooldown = 0;
  /** true on online guests: units / obstacles / Heat come from the host */
  mirror = false;
  /** the breakers that are down, and the lead lap they went down on */
  breakerDown: number[] = [];
  /** guest → host: counters of heat-raising things this client did (trap flashes, police hits, smashes) */
  heatReport = 0;
  private rand: () => number;
  private obstacleId = 0;
  private zoneLap = -1;
  private seeT = 0;
  private trapCool: number[] = [];
  private lastIndex = new Map<RaceCar, number>();
  private roadblockT = 0;
  private spikeT = 0;
  private spiked = new Set<string>();
  private deployT = 0;
  private arresting: PoliceUnit | null = null;
  private chaseTime = 0;
  private radioT = 0;
  private lastLevel = 0;
  private time = 0;
  private breakerFall: { index: number; t: number }[] = [];

  constructor(private world: WorldData, private race: Race, seed = 7) {
    this.rand = rng(seed);
    const kinds: UnitKind[] = ['cruiser', 'cruiser', 'cruiser', 'unmarked', 'rammer', 'rammer'];
    kinds.forEach((kind, i) => {
      const physics = new VehiclePhysics(world, policeVehicle(kind));
      const driver = new AIDriver(world, race.line, 'aggressive', { grip: POLICE.chaseGrip, power: 1, nitro: false }, 500 + i * 31);
      driver.gripCap = POLICE.catchUpGrip;
      const car: RaceCar = {
        id: 100 + i, name: UNIT_NAMES[i], number: 0, isPlayer: false, paint: 0, physics, s: physics.s, driver: null,
        lap: new LapTimer(world, 0), input: blankInput(), trackIndex: 0, trackOffset: 0, trackS: 0, onTrack: false, place: 0,
        prev: { x: 0, y: -60, z: 0, yaw: 0, pitch: 0, roll: 0 }, grid: 0, remote: false, netId: `pol:${i}`, net: null, netTime: 0, netDistance: 0,
        gone: true, edition: 'police', look: race.player.look, finished: false, finishTime: 0,
      };
      this.units.push({ id: i, kind, car, driver, active: false, respawnIn: 0, target: null, side: i % 2 === 0 ? 1 : -1, slowT: 0, sees: false, aggroT: 0, aggro: null, damage: 0, hornT: 99 });
      this.park(this.units[i]);
    });
    for (let k = 0; k < world.speedTraps.length; k++) this.trapCool.push(0);
    this.air = new AirOne(world, race, (e) => this.events.push(e), (t) => this.radio(t), this.rand, (x, z, ax, az) => {
      const o = this.newObstacle('spikes', 'spikes', x, z, ax, az, POLICE.spikeLength / 2, 0.3, POLICE.spikeLife);
      o.lapLong = true;
    });
  }

  /** an online guest mirrors the host (set by the session) */
  setMirror(m: boolean): void {
    this.mirror = m;
    this.air.mirror = m;
  }

  get level(): number {
    return this.joined ? clamp(Math.floor(this.heat), 1, 5) : 0;
  }

  /** humans on the grid: the local player and other players' cars */
  humans(): RaceCar[] {
    return this.race.cars.filter((c) => c.isPlayer || (c.remote && !c.netId.startsWith('ai:') && !c.gone));
  }

  private radio(text: string): void {
    this.events.push({ type: 'radio', text });
    this.radioT = 0;
  }

  private sectorName(i: number): string {
    const N = this.world.samples.length;
    const f = (((i - this.world.startIndex) % N) + N) % N / N;
    return SECTOR[Math.min(SECTOR.length - 1, Math.floor(f * SECTOR.length))];
  }

  private park(u: PoliceUnit): void {
    u.active = false;
    u.car.gone = true;
    u.car.physics.reset(-2000 - u.id * 20, -2000, 0);
    u.car.s.y = -60;
    u.target = null;
  }

  /** Put a unit on the circuit `back` metres behind `ref` (or at the pit exit). */
  private deploy(u: PoliceUnit, ref: RaceCar | null, back: number, lateral = 0): void {
    const S = this.world.samples;
    const N = S.length;
    let i: number;
    if (ref) i = (ref.trackIndex - Math.round(back / 2) + N * 4) % N;
    else i = this.world.pitExitIndex;
    // keep clear of other cars
    for (let tries = 0; tries < 20; tries++) {
      const p = S[i];
      const busy = this.race.cars.some((c) => !c.gone && Math.hypot(c.s.x - p.x, c.s.z - p.z) < 12) || this.units.some((o) => o !== u && o.active && Math.hypot(o.car.s.x - p.x, o.car.s.z - p.z) < 10);
      if (!busy) break;
      i = (i - 5 + N) % N;
    }
    const p = S[i];
    const yaw = Math.atan2(p.tx, p.tz);
    const off = lateral || (u.id % 2 === 0 ? 3 : -3);
    u.car.physics.reset(p.x + p.nx * off, p.z + p.nz * off, yaw);
    const v = Math.min(30, this.race.line.v[i] * 0.8);
    u.car.s.vx = Math.sin(yaw) * v;
    u.car.s.vz = Math.cos(yaw) * v;
    u.car.s.gear = 3;
    u.car.physics.wet = this.race.wet;
    u.driver.wetK = 1 - this.race.wet * 0.15;
    u.driver.reset();
    u.car.gone = false;
    u.active = true;
    u.slowT = 0;
    u.damage = 0;
    u.hornT = 99;
    u.car.prev.x = u.car.s.x;
    u.car.prev.y = u.car.s.y;
    u.car.prev.z = u.car.s.z;
    u.car.prev.yaw = yaw;
  }

  private locate(c: RaceCar): void {
    const hit = this.world.nearestTrack(c.s.x, c.s.z);
    if (hit) {
      c.trackIndex = hit.index;
      c.trackOffset = hit.offset;
      c.trackS = hit.s;
      c.onTrack = Math.abs(hit.offset) < this.world.halfWidth + 3.5;
    } else c.onTrack = false;
  }

  /** Lead human's race distance in laps. */
  private leadLaps(): number {
    let d = 0;
    for (const h of this.humans()) d = Math.max(d, this.race.distanceOf(h));
    return d;
  }

  /** Called by Race.step after every racer has moved. */
  step(dt: number): void {
    const race = this.race;
    this.time += dt;
    this.radioT += dt;
    if (race.held) return;
    const me = race.player;
    const lead = this.leadLaps();
    const laps = Math.max(1, race.targetLaps);

    // ── Pacing ──
    if (!this.mirror) {
      if (!this.trapsLive && lead >= 1) {
        this.trapsLive = true;
        this.zonesLive = true;
        this.events.push({ type: 'zones' });
        this.radio('Dispatch: speed cameras are live, and there are road crews out on the circuit.');
      }
      if (!this.joined && lead >= Math.floor(POLICE.joinAt * laps) && lead >= 1) {
        this.joined = true;
        this.heat = Math.max(this.heat, 1);
        this.events.push({ type: 'join' });
        this.radio('All units, suspects on the Proving Grounds circuit. Rolling out of the pit lane now.');
        this.deployT = 0;
      }
    }
    // work zones: built when they open, rebuilt (whole again) each new lap of the leader
    const lapNow = Math.floor(lead);
    if (this.zonesLive && lapNow !== this.zoneLap && !this.mirror) {
      this.zoneLap = lapNow;
      this.buildZones();
      for (let k = 0; k < this.breakerDown.length; k++) if (this.breakerDown[k] >= 0 && lapNow - this.breakerDown[k] >= POLICE.breakerReset) this.breakerDown[k] = -1;
    }

    // ── Heat level changes ──
    const lvl = this.level;
    if (lvl !== this.lastLevel) {
      if (lvl > this.lastLevel && this.lastLevel > 0) {
        this.events.push({ type: 'heat', level: lvl });
        const air = this.air.from;
        const lines = ['', '', 'Dispatch: Heat level two. Units, you are cleared for contact.', `Dispatch: Heat three. Setting up a roadblock ahead of the suspect${air === 3 ? ', and calling Air One' : ''}.`, 'Dispatch: Heat four. Spike strips and heavy units are authorised.', `Dispatch: Heat five. ${air === 5 ? 'Air One is in the air.' : 'Everything we have, all units.'}`];
        if (lines[lvl]) this.radio(lines[lvl]);
      }
      this.lastLevel = lvl;
    }

    // ── Director (host / offline) ──
    if (!this.mirror && this.joined) this.direct(dt);

    // ── Units ──
    for (const u of this.units) {
      if (!u.active) continue;
      const c = u.car;
      c.prev.x = c.s.x;
      c.prev.y = c.s.y;
      c.prev.z = c.s.z;
      c.prev.yaw = c.s.yaw;
      c.prev.pitch = c.s.pitch;
      c.prev.roll = c.s.roll;
      if (this.mirror) {
        race.applyRemote(c, dt);
        this.locate(c);
        continue;
      }
      this.locate(c);
      this.drive(u, dt);
      c.physics.step(c.input, dt);
      // written off: stuck, or wandered far off the circuit
      const atTarget = !!u.target && Math.hypot(u.target.s.x - c.s.x, u.target.s.z - c.s.z) < 25;
      u.slowT = (c.s.speed < POLICE.wreckSpeed || !c.onTrack) && !atTarget ? u.slowT + dt : Math.max(0, u.slowT - dt);
      if (u.slowT > POLICE.wreckTime || u.driver.wantRespawn) {
        u.driver.wantRespawn = false;
        this.park(u);
        u.respawnIn = 2;
      }
    }

    this.contacts(dt);
    this.updateObstacles(dt);
    this.traps(dt);
    this.stepAir(dt);
    this.meters(dt);
    if (!this.mirror) this.breakers(dt);
  }

  // ── Director: how many units, which tactics, traps ──
  private direct(dt: number): void {
    const race = this.race;
    const lvl = this.level;
    const humans = this.humans();
    if (!humans.length) return;
    const leader = humans.reduce((a, b) => (race.distanceOf(b) > race.distanceOf(a) ? b : a));
    // Heat: long chases warm it, being out of sight cools it
    if (this.cooldown > 0) this.cooldown -= dt;
    const anySees = this.units.some((u) => u.active && u.sees) || this.heli.sees;
    if (anySees && this.cooldown <= 0) {
      this.heat = Math.min(5.99, this.heat + POLICE.heatChase * dt);
      this.chaseTime += dt;
    } else this.heat = Math.max(1, this.heat - POLICE.heatCool * dt * (this.cooldown > 0 ? 0.3 : 1));

    // units on the road for this level
    const [wantC, wantR, wantU] = POLICE.units[lvl - 1];
    this.deployT -= dt;
    for (const u of this.units) {
      if (u.active) continue;
      if (u.respawnIn > 0) {
        u.respawnIn -= dt;
        continue;
      }
      const activeOfKind = this.units.filter((o) => o.active && o.kind === u.kind).length;
      if (activeOfKind >= (u.kind === 'cruiser' ? wantC : u.kind === 'rammer' ? wantR : wantU) || this.deployT > 0) continue;
      const first = this.units.every((o) => !o.active) && this.chaseTime < 1;
      const target = this.nearestHuman(u, humans);
      if (first) this.deploy(u, null, 0);
      else this.deploy(u, target, POLICE.spawnBehind[0] + this.rand() * (POLICE.spawnBehind[1] - POLICE.spawnBehind[0]));
      this.deployT = 1.3;
      if (!first && this.radioT > 6) this.radio(`${u.kind === 'rammer' ? 'Heavy unit' : u.kind === 'unmarked' ? 'Unmarked unit' : u.car.name}, joining the pursuit near ${this.sectorName(u.car.trackIndex)}.`);
    }
    // units that fell hopelessly behind come back closer (out of sight, behind)
    for (const u of this.units) {
      if (!u.active || !u.target) continue;
      const gap = this.trackGap(u.car, u.target);
      if (gap < -420) {
        this.park(u);
        u.respawnIn = 0.5;
      }
    }

    // roadblocks (Heat 3+) and spike strips (Heat 4+), ahead of the leader
    if (lvl >= 3 && this.cooldown <= 0) {
      this.roadblockT -= dt;
      if (this.roadblockT <= 0 && !this.obstacles.some((o) => o.group === 'roadblock' && !o.broken)) {
        this.roadblockT = POLICE.roadblockEvery;
        if (this.placeRoadblock(leader)) {
          this.events.push({ type: 'roadblock' });
          this.radio(`All units, roadblock is set ahead of the suspect in ${this.sectorName(leader.trackIndex + 140)}.`);
        }
      }
    }
    if (lvl >= 4 && this.cooldown <= 0) {
      this.spikeT -= dt;
      if (this.spikeT <= 0) {
        this.spikeT = POLICE.spikeEvery;
        this.placeSpikes(leader);
        this.events.push({ type: 'spikes' });
        this.radio('Spike strip is down. Let them run into it.');
      }
    }
    // a chatty dispatcher, now and then
    if (this.radioT > 16 && anySees) {
      const u = this.units.find((o) => o.active && o.sees && o.target);
      if (u && u.target) {
        const lines = [
          `${u.car.name}, suspect heading for ${this.sectorName(u.target.trackIndex + 60)}.`,
          `${u.car.name}, I'm right on them. Box them in.`,
          'Dispatch: keep the pressure on, do not let them reach the line clean.',
          `${u.car.name}, suspect is doing ${Math.round(u.target.s.speed * 3.6)} through ${this.sectorName(u.target.trackIndex)}.`,
        ];
        this.radio(lines[Math.floor(this.rand() * lines.length)]);
      }
    }
  }

  private nearestHuman(u: PoliceUnit, humans: RaceCar[]): RaceCar | null {
    let best: RaceCar | null = null;
    let bd = 1e9;
    for (const h of humans) {
      if (h.finished && h.isPlayer) continue;
      const d = Math.abs(this.trackGap(u.car, h));
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }

  /** metres from a to b along the lap (+ = b is ahead of a) */
  private trackGap(a: RaceCar, b: RaceCar): number {
    const L = this.world.trackLength;
    let d = b.trackS - a.trackS;
    if (d > L / 2) d -= L;
    else if (d < -L / 2) d += L;
    return d;
  }

  // ── One unit's driving: the rival AI follows the circuit; near the target, pursuit steering ──
  private drive(u: PoliceUnit, dt: number): void {
    const race = this.race;
    const c = u.car;
    if (u.aggroT > 0) u.aggroT -= dt;
    else u.aggro = null;
    if (!u.target || this.time % 1 < dt) u.target = u.aggro ?? this.nearestHuman(u, this.humans());
    const t = u.target;
    const patrol = this.cooldown > 0 || !t || t.finished;
    const gap = t ? this.trackGap(c, t) : 0; // + = target ahead
    // base: follow the circuit; pace depends on how far behind the target the unit is
    u.driver.level.grip = patrol ? 0.66 : gap > 80 ? POLICE.catchUpGrip : POLICE.chaseGrip;
    u.driver.update(c, this.trafficFor(c), dt, 99, 0);
    if (patrol || !t) {
      c.input.throttle = Math.min(c.input.throttle, 0.7);
      return;
    }
    const ts = t.s;
    const s = c.s;
    const dx = ts.x - s.x;
    const dz = ts.z - s.z;
    const dist = Math.hypot(dx, dz);
    if (dist > POLICE.engageRange || !t.onTrack) {
      // closing in: never ease off on the straights
      if (gap > 30 && c.input.brake === 0) c.input.throttle = 1;
      return;
    }
    const lvl = this.level;
    const fx = Math.sin(ts.yaw);
    const fz = Math.cos(ts.yaw);
    const rx = fz; // target's right (x, z)
    const rz = -fx;
    const along = -(dx * fx + dz * fz); // how far the unit is ahead of the target along its heading
    const lateral = -(dx * rx + dz * rz);
    const lead = clamp(dist / 40, 0, 0.55);
    let px = ts.x + ts.vx * lead;
    let pz = ts.z + ts.vz * lead;
    let wantV = ts.speed + clamp(dist * 0.7, 0, 22);
    if (u.kind === 'rammer') {
      wantV += 6;
    } else if (lvl >= 2 && Math.abs(along) < 3.2 && Math.abs(lateral) < 3.6) {
      // PIT: alongside, turn into the target's rear quarter
      px = ts.x - fx * 2 + rx * Math.sign(lateral || 1) * 0.3;
      pz = ts.z - fz * 2 + rz * Math.sign(lateral || 1) * 0.3;
      wantV = ts.speed + 1.5;
    } else if (lvl >= 2 && along > 4 && along < 40) {
      // rolling block: ahead of the target, sit in its lane and slow it down
      px = ts.x + fx * along + ts.vx * 0.2;
      pz = ts.z + fz * along + ts.vz * 0.2;
      wantV = Math.max(8, ts.speed - 4);
    } else if (dist < 26) {
      // box in: aim beside the target
      px += rx * u.side * POLICE.boxOffset;
      pz += rz * u.side * POLICE.boxOffset;
    }
    const err = wrapAngle(Math.atan2(px - s.x, pz - s.z) - s.yaw);
    const chaseSteer = clamp(-err * 2.4, -1, 1);
    const w = smoothstep(POLICE.engageRange, POLICE.engageRange * 0.45, dist);
    c.input.steer = clamp(c.input.steer * (1 - w) + chaseSteer * w, -1, 1);
    const dv = wantV - s.speed;
    // keep the circuit's own braking for corners; otherwise chase the target's speed
    if (c.input.brake < 0.2 || dist < 18) {
      if (dv > 0) {
        c.input.throttle = clamp(0.4 + dv * 0.3, 0, 1);
        c.input.brake = 0;
      } else {
        c.input.throttle = 0;
        c.input.brake = clamp(-dv / 6, 0, 0.8);
      }
    }
    void race;
  }

  // pseudo cars standing for obstacles, so drivers steer around work zones and roadblocks
  private pseudo: RaceCar[] = [];
  private trafficFor(c: RaceCar): RaceCar[] {
    void c;
    return this.pseudo;
  }
  /** Rivals avoid police and obstacles too: Race passes this to their drivers. */
  private trafficBuf: RaceCar[] = [];
  traffic(): RaceCar[] {
    const t = this.trafficBuf;
    t.length = 0;
    for (const p of this.pseudo) t.push(p);
    for (const u of this.units) if (u.active) t.push(u.car);
    return t;
  }
  private rebuildPseudo(): void {
    this.pseudo.length = 0;
    for (const o of this.obstacles) {
      if (o.broken || o.group === 'spikes' || o.kind === 'cone') continue;
      const hit = this.world.nearestTrack(o.x, o.z);
      if (!hit) continue;
      const s = { x: o.x, z: o.z, speed: 0, yaw: 0, vx: 0, vz: 0 } as unknown as RaceCar['s'];
      this.pseudo.push({ s, trackIndex: hit.index, trackOffset: hit.offset, trackS: hit.s, onTrack: true, gone: false } as unknown as RaceCar);
    }
  }

  // ── Car contact: police against everyone, and against each other ──
  private contacts(dt: number): void {
    void dt;
    const race = this.race;
    const cars = race.cars;
    const me = race.player;
    for (const u of this.units) {
      if (!u.active) continue;
      const us = u.car.s;
      for (const c of cars) {
        if (c.gone || c.s.ghost > 0) continue;
        if (this.mirror && !c.isPlayer) continue; // a guest only resolves its own car against police
        if (c.remote && u.car.remote) continue;
        const hit = collideCars(us, c.s);
        if (c.remote) c.s.impacts.length = 0;
        if (hit <= 0) continue;
        if (c === me && hit > 3) {
          this.events.push({ type: 'policeHit', strength: hit });
          // ramming a police car raises Heat (gentle bumps from them don't)
          const meFaster = c.s.speed > us.speed + 1;
          if (meFaster || hit > 6) this.addHeat(POLICE.heatHit);
          if (this.bustedT > 0) continue;
        }
        if (!c.isPlayer && !c.remote && c.driver && hit > 3) {
          u.aggro = c; // a rival who rams police gets chased for a while
          u.aggroT = 12;
          u.target = c;
        }
        // co-op: a teammate rams the cruiser that is arresting you
        if (this.bustedT > 0 && this.arresting === u && c.remote && !c.netId.startsWith('ai:') && hit > 4 && this.bustedT > POLICE.bustPenalty - POLICE.freeWindow) {
          this.bustedT = 0;
          this.bust = 0;
          this.arresting = null;
          this.events.push({ type: 'freed' });
          this.radio('Dispatch: the suspect is loose again! Their crew broke the arrest.');
        }
      }
      if (this.mirror) continue;
      for (const o of this.units) {
        if (o === u || !o.active || o.id < u.id) continue;
        collideCars(us, o.car.s);
      }
    }
    for (const u of this.units) {
      // dents: every hard knock adds a little (sent to guests; they don't add their own)
      if (!this.mirror) for (const im of u.car.s.impacts) if (im.strength > 2) u.damage = Math.min(1, u.damage + (im.strength - 2) * POLICE.damagePerHit);
      u.car.s.impacts.length = 0;
    }
  }

  addHeat(k: number): void {
    if (this.mirror) this.heatReport += k;
    else this.heat = Math.min(5.99, this.heat + k);
  }

  // ── Obstacles: work zones, roadblocks, spike strips ──
  private newObstacle(kind: ObstacleKind, group: Obstacle['group'], x: number, z: number, ax: number, az: number, hl: number, hd: number, life: number): Obstacle {
    const solid = kind === 'jersey' || kind === 'blockCar';
    const o: Obstacle = { id: this.obstacleId++, kind, group, x, z, ax, az, hl, hd, solid, broken: false, vx: 0, vz: 0, brokenAt: 0, life };
    this.obstacles.push(o);
    return o;
  }

  private buildZones(): void {
    for (let i = this.obstacles.length - 1; i >= 0; i--) if (this.obstacles[i].group === 'zone') this.obstacles.splice(i, 1);
    for (const z of this.world.workZones) {
      for (const p of z.pieces) {
        const ax = Math.sin(p.yaw);
        const az = Math.cos(p.yaw);
        if (p.kind === 'cone') this.newObstacle('cone', 'zone', p.x, p.z, ax, az, 0.22, 0.22, 1e9);
        else if (p.kind === 'water') this.newObstacle('water', 'zone', p.x, p.z, ax, az, 0.95, 0.3, 1e9);
        else this.newObstacle('saw', 'zone', p.x, p.z, ax, az, 0.9, 0.25, 1e9);
      }
    }
    this.rebuildPseudo();
  }

  /** Two cruisers and concrete barriers across the circuit, with one gap. */
  placeRoadblock(target: RaceCar, ahead?: number): boolean {
    const S = this.world.samples;
    const N = S.length;
    const d = ahead ?? POLICE.roadblockAhead[0] + this.rand() * (POLICE.roadblockAhead[1] - POLICE.roadblockAhead[0]);
    let i = (target.trackIndex + Math.round(d / 2)) % N;
    // on a reasonably straight bit, so it can be seen in time
    for (let k = 0; k < 40 && Math.abs(S[i].curv) > 1 / 180; k++) i = (i + 2) % N;
    const p = S[i];
    const reach = this.world.halfWidth + 1.4 + 4.5 + 4; // across the run-off and onto the grass
    const gapW = 5.2;
    const gapC = (this.rand() - 0.5) * (this.world.halfWidth * 2 - gapW - 2);
    // pieces from one side to the other, skipping the gap
    const across = (o: number) => [p.x + p.nx * o, p.z + p.nz * o] as const;
    const pieces: [ObstacleKind, number, number][] = []; // kind, centre offset, half length
    const gapL = gapC - gapW / 2;
    const gapR = gapC + gapW / 2;
    // a cruiser parked across the road either side of the gap, concrete out to the edges
    const fill = (a: number, b: number) => {
      for (let o = a; o < b - 0.3; ) {
        const len = Math.min(3, b - o);
        pieces.push(['jersey', o + len / 2, len / 2]);
        o += len + 0.04;
      }
    };
    pieces.push(['blockCar', gapL - 2.45, 2.4]);
    pieces.push(['blockCar', gapR + 2.45, 2.4]);
    fill(-reach, gapL - 4.9);
    fill(gapR + 4.9, reach);
    for (const [kind, off, hl] of pieces) {
      const [x, z] = across(off);
      this.newObstacle(kind, 'roadblock', x, z, p.nx, p.nz, hl, kind === 'blockCar' ? 1.05 : 0.32, POLICE.roadblockLife);
    }
    this.rebuildPseudo();
    return true;
  }

  placeSpikes(target: RaceCar, ahead?: number): void {
    const S = this.world.samples;
    const N = S.length;
    const d = ahead ?? POLICE.spikeAhead[0] + this.rand() * (POLICE.spikeAhead[1] - POLICE.spikeAhead[0]);
    const i = (target.trackIndex + Math.round(d / 2)) % N;
    const p = S[i];
    const off = clamp(target.trackOffset + (this.rand() - 0.5) * 3, -(this.world.halfWidth - POLICE.spikeLength / 2), this.world.halfWidth - POLICE.spikeLength / 2);
    this.newObstacle('spikes', 'spikes', p.x + p.nx * off, p.z + p.nz * off, p.nx, p.nz, POLICE.spikeLength / 2, 0.3, POLICE.spikeLife);
  }

  private updateObstacles(dt: number): void {
    const race = this.race;
    let changed = false;
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      o.life -= dt;
      if (o.life <= 0 && !this.mirror) {
        this.obstacles.splice(i, 1);
        changed = true;
        continue;
      }
      if (o.broken) {
        // debris slides to a stop
        o.x += o.vx * dt;
        o.z += o.vz * dt;
        const k = Math.max(0, 1 - dt * 3);
        o.vx *= k;
        o.vz *= k;
        continue;
      }
      // cars against this obstacle
      for (const c of race.cars) {
        if (c.gone) continue;
        if (this.collideObstacle(o, c, c.isPlayer, c.remote)) changed = true;
        if (o.broken) break;
      }
      if (o.broken || o.group === 'roadblock' || o.group === 'spikes') continue;
      for (const u of this.units) if (u.active && !this.mirror && this.collideObstacle(o, u.car, false, false)) changed = true;
    }
    // a roadblock is cleared away once the field has gone past it
    if (!this.mirror) {
      const humans = this.humans();
      for (let i = this.obstacles.length - 1; i >= 0; i--) {
        const o = this.obstacles[i];
        if (o.group !== 'roadblock' || o.life > POLICE.roadblockLife - 6) continue;
        const hit = this.world.nearestTrack(o.x, o.z);
        if (!hit) continue;
        const L = this.world.trackLength;
        const passed = humans.every((h) => {
          let g = h.trackS - hit.s;
          if (g < -L / 2) g += L;
          if (g > L / 2) g -= L;
          return g > 90;
        });
        if (passed) o.life = Math.min(o.life, 0.01);
      }
    }
    if (changed) this.rebuildPseudo();
  }

  /** Returns true if the obstacle broke. */
  private collideObstacle(o: Obstacle, c: RaceCar, mine: boolean, remote: boolean): boolean {
    const s = c.s;
    if (Math.abs(s.x - o.x) > o.hl + 4 || Math.abs(s.z - o.z) > o.hl + 4) return false;
    const bx = -o.az; // across the long axis
    const bz = o.ax;
    for (let k = 0; k < V.bodyCircleOffsets.length; k++) {
      const off = V.bodyCircleOffsets[k];
      const cx = s.x + Math.sin(s.yaw) * off;
      const cz = s.z + Math.cos(s.yaw) * off;
      const rx = cx - o.x;
      const rz = cz - o.z;
      const u = clamp(rx * o.ax + rz * o.az, -o.hl, o.hl);
      const w = clamp(rx * bx + rz * bz, -o.hd, o.hd);
      const qx = o.x + o.ax * u + bx * w;
      const qz = o.z + o.az * u + bz * w;
      let nx = cx - qx;
      let nz = cz - qz;
      const d = Math.hypot(nx, nz);
      const r = V.bodyRadius * (o.kind === 'spikes' ? 0.9 : 1);
      if (d >= r) continue;
      if (d > 1e-6) {
        nx /= d;
        nz /= d;
      } else {
        const sd = rx * bx + rz * bz >= 0 ? 1 : -1;
        nx = bx * sd;
        nz = bz * sd;
      }
      if (o.kind === 'spikes') {
        const key = `${o.id}:${c.netId || c.id}`;
        if (!this.spiked.has(key) && !remote) {
          this.spiked.add(key);
          if (o.lapLong) {
            s.puncture = 999;
            this.punctLap.set(c, { lap: c.lap.laps, t: 0 });
          } else s.puncture = Math.max(s.puncture, POLICE.punctureTime);
          this.events.push({ type: 'spiked', mine });
          if (mine) this.radio('Dispatch: they hit the spikes! Tyres are shredded, move in.');
        }
        return false;
      }
      const vn = s.vx * nx + s.vz * nz;
      const impact = -vn;
      if (!o.solid && (impact > POLICE.breakSpeed || o.kind === 'cone')) {
        // smashed: the piece flies off, the car loses a little speed
        o.broken = true;
        o.brokenAt = this.time;
        o.vx = s.vx * (o.kind === 'cone' ? 0.9 : 0.6) + nx * -2;
        o.vz = s.vz * (o.kind === 'cone' ? 0.9 : 0.6) + nz * -2;
        if (!remote) {
          const slow = o.kind === 'cone' ? 0.995 : o.kind === 'saw' ? 0.96 : 0.92;
          s.vx *= slow;
          s.vz *= slow;
        }
        this.events.push({ type: 'smash', kind: o.kind, mine });
        if (mine && o.kind !== 'cone') this.addHeat(POLICE.heatBarrier);
        return true;
      }
      if (remote) return false;
      // solid (or a slow nudge): push out and bounce
      const pen = r - d;
      s.x += nx * pen;
      s.z += nz * pen;
      if (vn < 0) {
        const e = o.solid ? 0.25 : 0.1;
        s.vx -= (1 + e) * vn * nx;
        s.vz -= (1 + e) * vn * nz;
        // scrub some speed along the barrier
        const tx = -nz;
        const tz = nx;
        const vt = s.vx * tx + s.vz * tz;
        s.vx -= tx * vt * 0.18;
        s.vz -= tz * vt * 0.18;
        if (impact > 1) s.impacts.push({ x: qx, y: s.y + 0.4, z: qz, nx, nz, strength: impact * (o.solid ? 1 : 0.5) });
      }
    }
    return false;
  }

  // ── Speed traps ──
  private traps(dt: number): void {
    const me = this.race.player;
    const N = this.world.samples.length;
    for (let k = 0; k < this.trapCool.length; k++) this.trapCool[k] = Math.max(0, this.trapCool[k] - dt);
    if (!this.trapsLive) return;
    // only the local player is measured here; each player reports their own flashes
    const prev = this.lastIndex.get(me) ?? me.trackIndex;
    this.lastIndex.set(me, me.trackIndex);
    this.world.speedTraps.forEach((t, k) => {
      const a = (t.index - prev + N) % N;
      const b = (me.trackIndex - prev + N) % N;
      if (b > 0 && b < 40 && a > 0 && a <= b && Math.abs(me.trackOffset) < this.world.halfWidth + 6 && this.trapCool[k] <= 0) {
        this.trapCool[k] = POLICE.trapCooldown;
        if (me.s.speed > POLICE.trapLimit && this.bustedT <= 0) {
          this.events.push({ type: 'trap', speed: me.s.speed, mine: true });
          this.addHeat(POLICE.heatTrap);
          if (this.joined) this.radio(`Speed camera flashed the suspect at ${Math.round(me.s.speed * 3.6)}.`);
        }
      }
    });
  }

  // ── Air One (4E) and helicopter punctures ──
  private punctLap = new Map<RaceCar, { lap: number; t: number }>();
  private stepAir(dt: number): void {
    let target: RaceCar | null = null;
    if (!this.mirror) {
      const humans = this.humans().filter((h) => !h.finished);
      const chased = this.units.find((u) => u.active && u.target && humans.includes(u.target))?.target ?? null;
      target = chased ?? (humans.length ? humans.reduce((a, b) => (this.race.distanceOf(b) > this.race.distanceOf(a) ? b : a)) : null);
    }
    this.air.step(dt, this.level, this.cooldown, this.joined, target);
    // a flat from a helicopter spike strip lasts until the end of the lap
    for (const [c, p] of this.punctLap) {
      p.t += dt;
      if (c.s.puncture <= 0) this.punctLap.delete(c);
      else if (c.lap.laps > p.lap && p.t >= POLICE.heliSpikeMin) {
        c.s.puncture = 0;
        this.punctLap.delete(c);
      }
    }
  }

  /** Race calls this for each AI rival after it has decided its inputs. */
  aiReact(c: RaceCar): void {
    this.air.react(c);
    // and they steer round a helicopter spike strip they can see
    const s = c.s;
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    for (const o of this.obstacles) {
      if (!o.lapLong) continue;
      const rx = o.x - s.x;
      const rz = o.z - s.z;
      const along = rx * fx + rz * fz;
      const lat = rx * fz - rz * fx;
      const r = o.hl + 1.4;
      if (along > 0 && along < 55 && Math.abs(lat) < r) c.input.steer = clamp(c.input.steer - Math.sign(lat || 1) * (1 - Math.abs(lat) / r) * 0.9, -1, 1);
    }
  }

  // ── Line of sight, Busted and Evade for the local player ──
  private blocked(ax: number, az: number, bx: number, bz: number): boolean {
    const segs = this.world.segments;
    const far = Math.hypot(bx - ax, bz - az);
    for (let i = 0; i < segs.length; i++) {
      const sg = segs[i];
      const top = Math.max(sg.top1, sg.top2);
      if (top < 0.9 || (top < 2 && far < 60)) continue; // trackside barriers only hide you from further away
      // proper segment intersection
      const d1x = bx - ax;
      const d1z = bz - az;
      const d2x = sg.x2 - sg.x1;
      const d2z = sg.z2 - sg.z1;
      const den = d1x * d2z - d1z * d2x;
      if (Math.abs(den) < 1e-9) continue;
      const ex = sg.x1 - ax;
      const ez = sg.z1 - az;
      const t = (ex * d2z - ez * d2x) / den;
      const u = (ex * d1z - ez * d1x) / den;
      if (t > 0.02 && t < 0.98 && u >= 0 && u <= 1) return true;
    }
    return false;
  }

  private meters(dt: number): void {
    const me = this.race.player;
    const s = me.s;
    // sight checks five times a second
    this.seeT -= dt;
    if (this.seeT <= 0) {
      this.seeT = 0.2;
      for (const u of this.units) {
        if (!u.active) {
          u.sees = false;
          continue;
        }
        const t = u.target ?? me;
        const d = Math.hypot(t.s.x - u.car.s.x, t.s.z - u.car.s.z);
        u.sees = this.cooldown <= 0 && (d < 30 || (d < POLICE.sightRange && !this.blocked(u.car.s.x, u.car.s.z, t.s.x, t.s.z)));
      }
    }
    if (!this.joined || me.finished) {
      this.bust = Math.max(0, this.bust - dt);
      this.evade = Math.max(0, this.evade - dt);
      return;
    }
    // ── Busted ──
    if (this.bustedT > 0) {
      this.bustedT -= dt;
      s.vx *= Math.max(0, 1 - dt * 4);
      s.vz *= Math.max(0, 1 - dt * 4);
      if (this.bustedT <= 0) this.rollingRestart();
      return;
    }
    let close: PoliceUnit | null = null;
    let cd = 1e9;
    for (const u of this.units) {
      if (!u.active) continue;
      const d = Math.hypot(u.car.s.x - s.x, u.car.s.z - s.z);
      if (d < cd) {
        cd = d;
        close = u;
      }
    }
    const pinned = this.cooldown <= 0 && s.speed < POLICE.bustSpeed && cd < POLICE.bustRange && me.s.ghost <= 0;
    this.bust = clamp(this.bust + (pinned ? POLICE.bustFill : -POLICE.bustDrain) * dt, 0, 1);
    if (this.bust >= 1) {
      this.bust = 0;
      this.bustedT = POLICE.bustPenalty;
      this.arresting = close;
      const fine = POLICE.bustFine * this.level;
      this.events.push({ type: 'busted', fine });
      this.radio('Dispatch: suspect in custody. Nice work, all units.');
      this.evade = 0;
      return;
    }
    // ── Evade ──
    const seen = this.units.some((u) => u.active && u.sees && (u.target === me || !u.target)) || (this.heli.active && this.heli.sees);
    if (this.cooldown > 0) {
      this.evade = 0;
      this.hot = false;
      return;
    }
    if (seen) this.hot = true;
    if (!this.hot) {
      this.evade = 0; // still searching for you: nothing to evade yet
      return;
    }
    const anyOut = this.units.some((u) => u.active);
    this.evade = clamp(this.evade + (seen || !anyOut ? -POLICE.evadeDrain : POLICE.evadeFill) * dt, 0, 1);
    if (this.evade >= 1) {
      this.evade = 0;
      const bounty = POLICE.evadeBounty * this.level;
      this.events.push({ type: 'evaded', bounty });
      this.radio("We've lost them. All units, fall back and search.");
      if (!this.mirror) {
        this.heat = Math.max(1, Math.floor(this.heat) - 1 + 0.2);
        this.cooldown = POLICE.evadeCooldown;
        this.air.breakOff();
      }
      this.hot = false;
    }
  }

  /** Busted penalty served: back in behind the whole field, rolling. */
  private rollingRestart(): void {
    const race = this.race;
    const me = race.player;
    // the back of the field: the racer furthest behind on the lap, then 50 m further back
    let last: RaceCar | null = null;
    for (const c of race.cars) {
      if (c === me || c.gone || c.finished) continue;
      if (!last || race.distanceOf(c) < race.distanceOf(last)) last = c;
    }
    const ref = last ?? me;
    const N = this.world.samples.length;
    const back = last ? 25 : 0;
    me.trackIndex = (ref.trackIndex - back + N) % N;
    race.rejoin(me);
    me.s.ghost = 3;
    this.arresting = null;
    this.bust = 0;
    // police regroup behind you
    if (!this.mirror) {
      this.heat = Math.max(1, Math.floor(this.heat) - 1 + 0.1);
      for (const u of this.units) if (u.active) this.park(u), (u.respawnIn = 2 + u.id * 0.6);
    }
    this.events.push({ type: 'restart' });
  }

  // ── Pursuit breakers ──
  private breakers(dt: number): void {
    const world = this.world;
    const N = world.samples.length;
    if (!this.breakerDown.length) this.breakerDown = world.breakers.map(() => -1);
    for (let k = this.breakerFall.length - 1; k >= 0; k--) {
      const f = this.breakerFall[k];
      f.t -= dt;
      if (f.t <= 0) this.breakerFall.splice(k, 1);
    }
    if (!this.joined) return;
    world.breakers.forEach((b, k) => {
      if (this.breakerDown[k] >= 0) return;
      for (const h of this.humans()) {
        const rel = (h.trackIndex - b.index + N) % N;
        if (rel > 8 || Math.abs(h.trackOffset) > world.halfWidth + 6) continue; // not passing it right now
        // only worth bringing down with police on your tail
        const chasers = this.units.filter((u) => u.active && this.trackGap(u.car, h) > 0 && this.trackGap(u.car, h) < 110);
        if (!chasers.length) continue;
        this.breakerDown[k] = Math.floor(this.leadLaps());
        let wrecked = 0;
        for (const u of this.units) {
          if (!u.active) continue;
          const g = (b.index - u.car.trackIndex + N) % N;
          // anyone at the structure, or about to arrive within the next couple of seconds
          if (g * 2 < POLICE.breakerRadius + u.car.s.speed * 1.6 || (N - g) * 2 < 8) {
            this.park(u);
            u.respawnIn = POLICE.respawnDelay;
            wrecked++;
            this.events.push({ type: 'wrecked', unit: u.id });
          }
        }
        const bounty = POLICE.breakerBounty * Math.max(1, wrecked);
        this.events.push({ type: 'breaker', index: k, wrecked, bounty });
        this.radio(wrecked ? `Units down at the ${b.kind === 'scaffold' ? 'scaffolding' : b.kind === 'containers' ? 'container stack' : 'timing tower'}! We need recovery out here.` : 'Dispatch: debris on the circuit, watch yourselves.');
        this.breakerFall.push({ index: b.index, t: 4 });
        if (!this.mirror) this.heat = Math.min(5.99, this.heat + 0.15);
        break;
      }
    });
    // units that drive into a fresh collapse are wrecked too
    for (const f of this.breakerFall) {
      for (const u of this.units) {
        if (!u.active) continue;
        const g = Math.abs(((u.car.trackIndex - f.index + N + N / 2) % N) - N / 2);
        if (g < 6) {
          this.park(u);
          u.respawnIn = POLICE.respawnDelay;
          this.events.push({ type: 'wrecked', unit: u.id });
        }
      }
    }
  }

  // ── Online: the host's view of police, packed small ──
  pack(packCar: (s: RaceCar['s']) => NetCar): unknown {
    const units = this.units.map((u) => (u.active ? packCar(u.car.s) : 0));
    const obs = this.obstacles.filter((o) => o.group !== 'zone').map((o) => [['jersey', 'blockCar', 'spikes'].indexOf(o.kind), Math.round(o.x * 10) / 10, Math.round(o.z * 10) / 10, Math.round(o.ax * 1000) / 1000, Math.round(o.az * 1000) / 1000, Math.round(o.hl * 100) / 100, o.id, o.lapLong ? 1 : 0]);
    let zoneBroken = '';
    for (const o of this.obstacles) if (o.group === 'zone') zoneBroken += o.broken ? '1' : '0';
    const air = this.air.pack();
    return {
      h: Math.round(this.heat * 100) / 100,
      j: this.joined ? 1 : 0,
      t: this.trapsLive ? 1 : 0,
      c: Math.round(this.cooldown * 10) / 10,
      u: units,
      dm: this.units.map((u) => Math.round(u.damage * 10)),
      o: obs,
      z: zoneBroken,
      zl: this.zoneLap,
      b: this.breakerDown,
      x: air.x,
      ad: air.d,
    };
  }

  /** Guests: take the host's police state (untrusted input: checked as it is read). */
  unpack(d: unknown, clock: number, validNetCar: (a: unknown) => a is NetCar): void {
    if (typeof d !== 'object' || d === null) return;
    const o = d as Record<string, unknown>;
    const num = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : dflt);
    this.heat = num(o.h, 0, 5.99, this.heat);
    const joined = o.j === 1;
    if (joined && !this.joined) this.events.push({ type: 'join' });
    this.joined = joined;
    const traps = o.t === 1;
    if (traps && !this.trapsLive) this.events.push({ type: 'zones' });
    this.trapsLive = this.zonesLive = traps;
    this.cooldown = num(o.c, 0, 60, 0);
    const lvl = this.level;
    if (lvl > this.lastLevel && this.lastLevel > 0) this.events.push({ type: 'heat', level: lvl });
    this.lastLevel = lvl;
    if (Array.isArray(o.u)) {
      o.u.slice(0, this.units.length).forEach((st, i) => {
        const u = this.units[i];
        if (validNetCar(st)) {
          if (!u.active) {
            u.active = true;
            u.car.gone = false;
            u.car.s.x = st[0];
            u.car.s.z = st[2];
            u.car.s.yaw = st[3];
          }
          u.car.remote = true;
          if (u.car.net !== st) {
            u.car.net = st;
            u.car.netTime = clock;
          }
        } else if (u.active) this.park(u);
      });
    }
    if (Array.isArray(o.dm)) o.dm.slice(0, this.units.length).forEach((v, i) => (this.units[i].damage = num(v, 0, 10, 0) / 10));
    // work zones follow the host's lap; pieces broken on the host are broken here too
    const zl = num(o.zl, -1, 999, -1);
    if (this.trapsLive && zl !== this.zoneLap) {
      this.zoneLap = zl;
      this.buildZones();
    }
    if (typeof o.z === 'string') {
      let k = 0;
      for (const ob of this.obstacles) {
        if (ob.group !== 'zone') continue;
        if (o.z[k] === '1' && !ob.broken) {
          ob.broken = true;
          ob.brokenAt = this.time;
        }
        k++;
      }
    }
    // roadblocks and spikes: replace with the host's list
    if (Array.isArray(o.o)) {
      const keep = new Set<number>();
      for (const e of o.o.slice(0, 40)) {
        if (!Array.isArray(e) || e.length < 7 || e.some((v) => typeof v !== 'number' || !Number.isFinite(v))) continue;
        const [ki, x, z, ax, az, hl, id] = e as number[];
        const kind = (['jersey', 'blockCar', 'spikes'] as ObstacleKind[])[ki];
        if (!kind || Math.abs(x) > 5000 || Math.abs(z) > 5000) continue;
        const nid = 100000 + id;
        keep.add(nid);
        if (this.obstacles.some((ob) => ob.id === nid)) continue;
        const ob = this.newObstacle(kind, kind === 'spikes' ? 'spikes' : 'roadblock', x, z, ax, az, clamp(hl, 0.1, 6), kind === 'blockCar' ? 1.05 : kind === 'spikes' ? 0.3 : 0.32, 1e9);
        ob.id = nid;
        if (e.length > 7 && e[7] === 1) ob.lapLong = true;
        this.obstacleId--;
        if (kind === 'blockCar' && !this.obstacles.some((q) => q.kind === 'blockCar' && q.id !== nid)) this.events.push({ type: 'roadblock' });
      }
      for (let i = this.obstacles.length - 1; i >= 0; i--) {
        const ob = this.obstacles[i];
        if (ob.group !== 'zone' && !keep.has(ob.id)) this.obstacles.splice(i, 1);
      }
      this.rebuildPseudo();
    }
    if (Array.isArray(o.b)) this.breakerDown = o.b.slice(0, 3).map((v) => num(v, -1, 999, -1));
    this.air.unpack(o.x, o.ad);
  }

  /** Back to the start of a race (restart). */
  reset(): void {
    for (const u of this.units) this.park(u), (u.respawnIn = 0), (u.aggro = null), (u.aggroT = 0);
    this.obstacles.length = 0;
    this.pseudo.length = 0;
    this.heat = 0;
    this.joined = this.trapsLive = this.zonesLive = false;
    this.bust = this.evade = this.bustedT = this.cooldown = 0;
    this.hot = false;
    this.zoneLap = -1;
    this.lastLevel = 0;
    this.chaseTime = 0;
    this.air.reset();
    this.punctLap.clear();
    this.spiked.clear();
    this.lastIndex.clear();
    this.breakerDown = this.world.breakers.map(() => -1);
    this.breakerFall.length = 0;
    this.events.length = 0;
    this.heatReport = 0;
  }
}
