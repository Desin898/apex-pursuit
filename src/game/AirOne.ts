// ─────────────────────────────────────────────────────────────────────────────
// AirOne (4E) — the police helicopter's brain: when it comes, how it flies the chase, what it
// can see and what it drops. Pure logic, fixed-step, like Pursuit (which owns it).
//
// • It launches at the Heat chosen in Settings (Air support: from Heat 3 / from Heat 5 / off),
//   flies in from the horizon and stays with its target: trailing beside you, sitting ahead and
//   facing you on straights, swinging wide round the outside of corners, and now and then a low
//   pass head-on over the cars. A height map keeps it clear of the stands, towers and trees.
// • It sees you within a range (shorter in heavy rain) unless something is in the line from the
//   helicopter to your car: a grandstand, the garages, a building, a tree. While it sees you the
//   Evade meter can't fill. It runs low on fuel after a while, goes to refuel, and comes back at
//   higher Heat. An evade sends it away too.
// • Drops (Settings: Air drops), always with a warning marker on the road while they fall:
//   smoke canisters (a cloud that hides the road for ~10 s), spike strips (a flat until the end of
//   the lap) and shock charges (a blinking ring, then a bang that shoves and spins any car in it).
//   Police are never targeted: the pilot won't drop near its own units.
// • Online: the host flies it and decides the drops; guests mirror its position and the drops
//   (ages included), and work out their own car's hits locally.
// ─────────────────────────────────────────────────────────────────────────────
import { POLICE } from '../config';
import { clamp, wrapAngle } from '../core/math';
import { WorldData } from '../world/WorldData';
import type { Race, RaceCar } from './Race';
import type { PursuitEvent } from './Pursuit';

export type HeliMode = 'off' | 'inbound' | 'chase' | 'leaving';
export type HeliTactic = 'trail' | 'lead' | 'wide' | 'pass';
export interface Heli {
  active: boolean;
  mode: HeliMode;
  tactic: HeliTactic;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  /** searchlight aim on the ground */
  lx: number;
  lz: number;
  /** it sees the local player right now */
  sees: boolean;
  /** (host) it sees the car it is chasing */
  seesTarget: boolean;
  /** 0..1 how low it is (landing light, wash) */
  low: number;
}

export type DropKind = 'smoke' | 'spikes' | 'charge';
export interface Drop {
  id: number;
  kind: DropKind;
  /** where it lands */
  x: number;
  z: number;
  /** where it was released */
  sx: number;
  sy: number;
  sz: number;
  /** seconds since release */
  age: number;
  /** seconds to land */
  fall: number;
  /** across-the-road direction (spikes) */
  ax: number;
  az: number;
  /** a red smoke canister (else grey-white) */
  red: boolean;
  landed: boolean;
  boomed: boolean;
  done: boolean;
}

const KINDS: DropKind[] = ['smoke', 'spikes', 'charge'];
const TACTICS: HeliTactic[] = ['trail', 'lead', 'wide', 'pass'];
const MODES: HeliMode[] = ['off', 'inbound', 'chase', 'leaving'];
const CELL = 10;

interface Box {
  x: number;
  z: number;
  hw: number;
  hd: number;
  h: number;
  sn: number;
  cs: number;
}
interface Trunk {
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
}

export class AirOne {
  readonly heli: Heli = { active: false, mode: 'off', tactic: 'trail', x: 0, y: -100, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0, lx: 0, lz: 0, sees: false, seesTarget: false, low: 0 };
  readonly drops: Drop[] = [];
  /** Settings: launches at this Heat (0 = never) */
  from = 3;
  /** Settings: drops on */
  dropsOn = true;
  mirror = false;
  private dropId = 0;
  private dropT = 6;
  private fuel = 0;
  private backT = 0;
  private sorties = 0;
  private tacticT = 0;
  private passT = 12;
  private passPhase = 0;
  private passTime = 0;
  private seeT = 0;
  private lostT = 0;
  private seenX = 0;
  private seenZ = 0;
  private aimX = 0;
  private aimZ = 0;
  private side = 1;
  private time = 0;
  private radioT = 0;
  private target: RaceCar | null = null;
  private wasSeen = false;
  /** where it is heading for (debug / tests) */
  goalX = 0;
  goalZ = 0;
  // static world: what blocks its view, and how high it must fly where
  private boxes: Box[] = [];
  private trunks: Trunk[] = [];
  private ceil = new Float32Array(0);
  private gx0 = 0;
  private gz0 = 0;
  private gnx = 0;
  private gnz = 0;

  constructor(
    private world: WorldData,
    private race: Race,
    private emit: (e: PursuitEvent) => void,
    private say: (text: string) => void,
    private rand: () => number,
    private addSpikes: (x: number, z: number, ax: number, az: number) => void,
  ) {
    this.buildStatic();
  }

  // ── The world as the pilot sees it ───────────────────────────────────────
  private buildStatic(): void {
    const w = this.world;
    for (const b of w.buildings) this.boxes.push({ x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, h: b.h, sn: Math.sin(b.yaw), cs: Math.cos(b.yaw) });
    for (const s of w.stands) this.boxes.push({ x: s.x, z: s.z, hw: s.w / 2 + 1.5, hd: s.d / 2 + 1.5, h: 0.6 + s.rows * 0.8 + 5.8, sn: Math.sin(s.yaw), cs: Math.cos(s.yaw) });
    for (const t of w.trees) this.trunks.push({ x: t.x, z: t.z, r: 2.6 * t.s, y0: 2.2, y1: 9 * t.s + 2 });
    // height map: the lowest it may fly in each 10 m cell (tall things + 6 m)
    let x0 = 1e9;
    let x1 = -1e9;
    let z0 = 1e9;
    let z1 = -1e9;
    for (const p of w.samples) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    this.gx0 = x0 - 220;
    this.gz0 = z0 - 220;
    this.gnx = Math.ceil((x1 - x0 + 440) / CELL);
    this.gnz = Math.ceil((z1 - z0 + 440) / CELL);
    this.ceil = new Float32Array(this.gnx * this.gnz);
    const mark = (x: number, z: number, r: number, h: number) => {
      const i0 = Math.max(0, Math.floor((x - r - this.gx0) / CELL));
      const i1 = Math.min(this.gnx - 1, Math.floor((x + r - this.gx0) / CELL));
      const k0 = Math.max(0, Math.floor((z - r - this.gz0) / CELL));
      const k1 = Math.min(this.gnz - 1, Math.floor((z + r - this.gz0) / CELL));
      for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) this.ceil[k * this.gnx + i] = Math.max(this.ceil[k * this.gnx + i], h);
    };
    for (const b of this.boxes) mark(b.x, b.z, Math.hypot(b.hw, b.hd) + 6, b.h + 6);
    for (const t of this.trunks) mark(t.x, t.z, t.r + 5, t.y1 + 5);
    for (const f of w.floodlights) mark(f.x, f.z, 9, f.h + 7);
    for (const p of w.poles) mark(p.x, p.z, 5, p.h + 5);
    for (const b of w.breakers) mark(b.x, b.z, 14, 24);
  }

  /** the lowest safe height at (x, z) */
  ceilingAt(x: number, z: number): number {
    const i = Math.floor((x - this.gx0) / CELL);
    const k = Math.floor((z - this.gz0) / CELL);
    if (i < 0 || k < 0 || i >= this.gnx || k >= this.gnz) return 0;
    return this.ceil[k * this.gnx + i];
  }

  /** Is anything between the helicopter (hx, hy, hz) and a car at (tx, tz)? */
  blocked(hx: number, hy: number, hz: number, tx: number, tz: number): boolean {
    const ty = 1.1;
    for (const b of this.boxes) {
      // cheap reject: the box must be near the line on the ground
      const mx = Math.min(hx, tx) - b.hw - b.hd;
      const Mx = Math.max(hx, tx) + b.hw + b.hd;
      const mz = Math.min(hz, tz) - b.hw - b.hd;
      const Mz = Math.max(hz, tz) + b.hw + b.hd;
      if (b.x < mx || b.x > Mx || b.z < mz || b.z > Mz) continue;
      // the segment in the box's frame: slab test in x, y, z
      const ax = (hx - b.x) * b.cs - (hz - b.z) * b.sn;
      const az = (hx - b.x) * b.sn + (hz - b.z) * b.cs;
      const bx = (tx - b.x) * b.cs - (tz - b.z) * b.sn;
      const bz = (tx - b.x) * b.sn + (tz - b.z) * b.cs;
      let t0 = 0;
      let t1 = 1;
      const slab = (a: number, d: number, lo: number, hi: number) => {
        if (Math.abs(d) < 1e-9) return a >= lo && a <= hi;
        let u0 = (lo - a) / d;
        let u1 = (hi - a) / d;
        if (u0 > u1) [u0, u1] = [u1, u0];
        t0 = Math.max(t0, u0);
        t1 = Math.min(t1, u1);
        return t0 <= t1;
      };
      if (slab(ax, bx - ax, -b.hw, b.hw) && slab(az, bz - az, -b.hd, b.hd) && slab(hy, ty - hy, 0, b.h) && t1 > 0.001 && t0 < 0.985) return true;
    }
    const dx = tx - hx;
    const dz = tz - hz;
    const L2 = dx * dx + dz * dz || 1;
    for (const t of this.trunks) {
      if (Math.abs(t.x - tx) > 30 && Math.abs(t.x - hx) > 30) continue; // trees only hide you close to them
      const u = clamp(((t.x - hx) * dx + (t.z - hz) * dz) / L2, 0, 1);
      if (u < 0.6) continue; // the canopy over or just beside the car
      const px = hx + dx * u - t.x;
      const pz = hz + dz * u - t.z;
      if (px * px + pz * pz > t.r * t.r) continue;
      const y = hy + (ty - hy) * u;
      if (y >= t.y0 && y <= t.y1) return true;
    }
    return false;
  }

  // ── Every step ───────────────────────────────────────────────────────────
  /**
   * Host / offline: `level` (Heat), `cooldown` (>0 after an evade), `target` (the human it
   * chases). Guests pass the same; only the drops age and the sight of their own car runs.
   */
  step(dt: number, level: number, cooldown: number, joined: boolean, target: RaceCar | null): void {
    this.time += dt;
    this.radioT += dt;
    const h = this.heli;
    if (!this.mirror) {
      if (this.backT > 0) this.backT -= dt;
      const want = this.from > 0 ? (this.sorties > 0 ? Math.min(5, Math.max(this.from + 1, 4)) : this.from) : 99;
      if (joined && h.mode === 'off' && level >= want && cooldown <= 0 && this.backT <= 0 && target) this.launch(target);
      if (h.active && (cooldown > 0 || this.from === 0) && h.mode !== 'leaving') this.leave(this.from === 0 ? '' : 'Air One, breaking off. I lost them under the cover.');
      if (h.active) this.fly(dt, target, level, cooldown);
    }
    this.sight(dt);
    this.stepDrops(dt);
  }

  private launch(t: RaceCar): void {
    const h = this.heli;
    h.active = true;
    h.mode = 'inbound';
    h.tactic = 'trail';
    // from the horizon, off to one side behind the target
    const a = t.s.yaw + Math.PI + (this.rand() - 0.5) * 1.6;
    h.x = t.s.x + Math.sin(a) * 420;
    h.z = t.s.z + Math.cos(a) * 420;
    h.y = POLICE.heliHeight + 30;
    h.vx = h.vz = h.vy = 0;
    h.yaw = Math.atan2(t.s.x - h.x, t.s.z - h.z);
    h.lx = t.s.x;
    h.lz = t.s.z;
    this.aimX = t.s.x;
    this.aimZ = t.s.z;
    this.fuel = POLICE.heliFuel[0] + this.rand() * (POLICE.heliFuel[1] - POLICE.heliFuel[0]);
    this.sorties++;
    this.tacticT = 4;
    this.passT = 10 + this.rand() * 8;
    this.dropT = 5 + this.rand() * 3;
    this.say(this.sorties > 1 ? 'Air One, refuelled and inbound. Back in five.' : 'Dispatch: Air One is up and inbound to the circuit.');
  }

  private leave(line: string): void {
    const h = this.heli;
    h.mode = 'leaving';
    this.backT = POLICE.heliBack;
    if (line) this.say(line);
    this.emit({ type: 'heliLeave' });
  }

  /** an evade sends it away */
  breakOff(): void {
    if (this.heli.active && this.heli.mode !== 'leaving') this.leave('Air One, I have lost the suspect. Returning to base.');
  }

  private trackPoint(index: number, lateral: number): { x: number; z: number; tx: number; tz: number; curv: number } {
    const S = this.world.samples;
    const N = S.length;
    const p = S[((index % N) + N) % N];
    return { x: p.x + p.nx * lateral, z: p.z + p.nz * lateral, tx: p.tx, tz: p.tz, curv: p.curv };
  }

  private fly(dt: number, t: RaceCar | null, level: number, cooldown: number): void {
    const h = this.heli;
    if (t) this.target = t;
    const tg = this.target;
    let gx = h.x;
    let gz = h.z;
    let gy = POLICE.heliHeight;
    let face = h.yaw;
    let feedX = 0;
    let feedZ = 0;
    let maxV = POLICE.heliSpeed;
    if (h.mode === 'leaving' || !tg) {
      // away from the circuit, climbing; gone once it's far off
      const cx = this.gx0 + (this.gnx * CELL) / 2;
      const cz = this.gz0 + (this.gnz * CELL) / 2;
      const ax = h.x - cx;
      const az = h.z - cz;
      const l = Math.hypot(ax, az) || 1;
      gx = h.x + (ax / l) * 300;
      gz = h.z + (az / l) * 300;
      gy = 95;
      face = Math.atan2(gx - h.x, gz - h.z);
      if (l > 900 || h.y > 90) {
        h.active = false;
        h.mode = 'off';
        h.sees = h.seesTarget = false;
        h.y = -100;
        return;
      }
    } else {
      const ts = tg.s;
      feedX = ts.vx;
      feedZ = ts.vz;
      const dist = Math.hypot(ts.x - h.x, ts.z - h.z);
      if (h.mode === 'inbound') {
        gx = ts.x;
        gz = ts.z;
        gy = POLICE.heliHeight + 8;
        maxV = POLICE.heliSpeed * 1.25;
        face = Math.atan2(ts.x - h.x, ts.z - h.z);
        if (dist < 150) {
          h.mode = 'chase';
          this.emit({ type: 'heli' });
          this.say('Air One on scene. I have the suspect in the light.');
        }
      } else {
        // fuel
        this.fuel -= dt;
        if (this.fuel <= 0) {
          this.leave('Air One, running low on fuel. Returning to refuel, back shortly.');
          return this.fly(dt, t, level, cooldown);
        }
        // pick what to do next
        this.tacticT -= dt;
        this.passT -= dt;
        const idx = tg.trackIndex;
        let bend = 0;
        let bendSign = 0;
        for (let k = 4; k < 44; k += 4) {
          const c = this.trackPoint(idx + k, 0).curv;
          bend += Math.abs(c);
          bendSign += c;
        }
        // fallen behind: catch up first
        if (dist > 95 && h.tactic !== 'pass') {
          h.tactic = 'trail';
          this.tacticT = Math.max(this.tacticT, 2);
          maxV = POLICE.heliSpeed * 1.2;
        }
        if (h.tactic !== 'pass' && this.tacticT <= 0) {
          this.tacticT = 5 + this.rand() * 4;
          if (bend > 0.06) h.tactic = 'wide';
          else if (this.passT <= 0 && ts.speed > 20 && this.passClear(idx)) {
            h.tactic = 'pass';
            this.passPhase = 0;
            this.passTime = 0;
          } else h.tactic = this.rand() < 0.55 ? 'lead' : 'trail';
          this.side = this.rand() < 0.5 ? 1 : -1;
        }
        const ahead = (m: number) => Math.round(m / 2);
        if (h.tactic === 'trail') {
          gx = ts.x - Math.sin(ts.yaw) * 26 + Math.cos(ts.yaw) * 14 * this.side;
          gz = ts.z - Math.cos(ts.yaw) * 26 - Math.sin(ts.yaw) * 14 * this.side;
          face = Math.atan2(ts.x - h.x, ts.z - h.z);
        } else if (h.tactic === 'lead') {
          const p = this.trackPoint(idx + ahead(38 + ts.speed * 0.5), 11 * this.side);
          gx = p.x;
          gz = p.z;
          gy = POLICE.heliLeadHeight;
          face = Math.atan2(ts.x - h.x, ts.z - h.z); // facing back at you, like the reference shots
        } else if (h.tactic === 'wide') {
          const p = this.trackPoint(idx + ahead(26 + ts.speed * 0.3), -Math.sign(bendSign || 1) * 36);
          gx = p.x;
          gz = p.z;
          face = Math.atan2(ts.x - h.x, ts.z - h.z);
        } else {
          // the low pass: get ahead and low, then fly head-on along the road over the cars
          this.passTime += dt;
          gy = POLICE.heliLow;
          if (this.passPhase === 0) {
            const p = this.trackPoint(idx + ahead(80 + ts.speed * 0.6), 0);
            gx = p.x;
            gz = p.z;
            gy = POLICE.heliLeadHeight;
            face = Math.atan2(ts.x - h.x, ts.z - h.z);
            if (Math.hypot(gx - h.x, gz - h.z) < 25 || this.passTime > 7) this.passPhase = 1;
          } else {
            const p = this.trackPoint(idx - ahead(70), 0);
            gx = p.x;
            gz = p.z;
            feedX = feedZ = 0;
            maxV = 34;
            face = Math.atan2(gx - h.x, gz - h.z);
            const behind = (h.x - ts.x) * Math.sin(ts.yaw) + (h.z - ts.z) * Math.cos(ts.yaw);
            if (behind < -30 || this.passTime > 14) {
              h.tactic = 'trail';
              this.passT = 22 + this.rand() * 14;
              this.tacticT = 3;
            }
          }
        }
        // drops
        if (this.dropsOn && level >= 3 && cooldown <= 0) this.director(dt, tg, level);
      }
    }
    // ── motion: chase the goal (plus the target's own velocity), acceleration-limited ──
    this.goalX = gx;
    this.goalZ = gz;
    const dx = gx - h.x;
    const dz = gz - h.z;
    let wvx = dx * 1.05 + feedX;
    let wvz = dz * 1.05 + feedZ;
    const wl = Math.hypot(wvx, wvz);
    if (wl > maxV) {
      wvx *= maxV / wl;
      wvz *= maxV / wl;
    }
    let ddx = wvx - h.vx;
    let ddz = wvz - h.vz;
    const dl = Math.hypot(ddx, ddz);
    const amax = POLICE.heliAccel * dt;
    if (dl > amax) {
      ddx *= amax / dl;
      ddz *= amax / dl;
    }
    h.vx += ddx;
    h.vz += ddz;
    h.x += h.vx * dt;
    h.z += h.vz * dt;
    // height: what it wants, never below the height map here or just ahead
    const floor = Math.max(this.ceilingAt(h.x, h.z), this.ceilingAt(h.x + h.vx * 1.5, h.z + h.vz * 1.5), this.ceilingAt(h.x + h.vx * 3, h.z + h.vz * 3));
    const wantY = Math.max(gy, floor);
    const wvy = clamp((wantY - h.y) * 0.9, -POLICE.heliClimb, POLICE.heliClimb * (h.y < floor ? 2 : 1));
    h.vy += clamp(wvy - h.vy, -dt * 7, dt * 7);
    h.y += h.vy * dt;
    if (h.y < floor - 1) h.y = floor - 1;
    h.low = clamp((24 - h.y) / 10, 0, 1);
    // heading: towards what it watches when slow, along its path when fast
    const sp = Math.hypot(h.vx, h.vz);
    const travel = Math.atan2(h.vx, h.vz);
    const want = sp > 30 && h.mode !== 'chase' ? travel : sp > 42 ? travel + wrapAngle(face - travel) * 0.4 : face;
    h.yaw += clamp(wrapAngle(want - h.yaw), -1.3 * dt, 1.3 * dt);
    // searchlight: on the target while it sees it, sweeping round the last sighting when not
    if (tg && h.seesTarget) {
      this.seenX = tg.s.x;
      this.seenZ = tg.s.z;
      this.lostT = 0;
      const k = Math.min(1, dt * 6);
      this.aimX += (tg.s.x + tg.s.vx * 0.12 - this.aimX) * k;
      this.aimZ += (tg.s.z + tg.s.vz * 0.12 - this.aimZ) * k;
    } else {
      this.lostT += dt;
      const r = Math.min(30, 6 + this.lostT * 3);
      const k = Math.min(1, dt * 2);
      this.aimX += (this.seenX + Math.sin(this.time * 0.9) * r - this.aimX) * k;
      this.aimZ += (this.seenZ + Math.sin(this.time * 1.7) * r * 0.6 - this.aimZ) * k;
    }
    h.lx = this.aimX + Math.sin(this.time * 1.3) * 0.8;
    h.lz = this.aimZ + Math.cos(this.time * 0.9) * 0.8;
  }

  /** nothing tall along the road for the low pass */
  private passClear(idx: number): boolean {
    for (let k = -40; k < 90; k += 3) {
      const p = this.trackPoint(idx + k, 0);
      if (this.ceilingAt(p.x, p.z) > POLICE.heliLow + 0.5) return false;
    }
    return true;
  }

  // ── Sight ────────────────────────────────────────────────────────────────
  private sight(dt: number): void {
    const h = this.heli;
    this.seeT -= dt;
    if (this.seeT > 0) return;
    this.seeT = 0.2;
    if (!h.active || h.mode !== 'chase') {
      h.sees = h.seesTarget = false;
      this.wasSeen = false;
      return;
    }
    const range = POLICE.heliSight * (1 - 0.25 * this.race.wet * this.race.rainK);
    const sees = (c: RaceCar) => !c.gone && Math.hypot(c.s.x - h.x, c.s.z - h.z) < range && !this.blocked(h.x, h.y, h.z, c.s.x, c.s.z);
    const me = this.race.player;
    h.sees = sees(me);
    h.seesTarget = this.target ? (this.target === me ? h.sees : sees(this.target)) : false;
    // a line from the pilot now and then when you slip out of the light (offline / host)
    if (!this.mirror && this.wasSeen && !h.seesTarget && this.radioT > 10) {
      this.radioT = 0;
      this.say(this.rand() < 0.5 ? 'Air One, lost visual. They went under cover.' : 'Air One, I can\'t see them. Sweeping the area.');
    }
    if (!this.mirror && !this.wasSeen && h.seesTarget && this.radioT > 12) {
      this.radioT = 0;
      this.say('Air One, I have them again. Lighting them up.');
    }
    this.wasSeen = h.seesTarget;
  }

  // ── Drops ────────────────────────────────────────────────────────────────
  private director(dt: number, t: RaceCar, level: number): void {
    const h = this.heli;
    if (!h.seesTarget || t.s.speed < 10 || !t.onTrack || h.tactic === 'pass') return;
    this.dropT -= dt;
    if (this.dropT > 0) return;
    this.dropT = POLICE.dropEvery[level] * (0.8 + this.rand() * 0.4);
    // what: smoke from Heat 3; spikes and shock charges from Heat 4; more charges at 5
    const r = this.rand();
    const kind: DropKind = level <= 3 ? 'smoke' : r < 0.36 ? 'smoke' : r < (level >= 5 ? 0.56 : 0.68) ? 'spikes' : 'charge';
    const count = kind === 'charge' ? (level >= 5 ? 2 + (this.rand() < 0.4 ? 1 : 0) : 1) : 1;
    const ok = this.dropAhead(t, kind, count);
    if (ok && this.radioT > 7) {
      this.radioT = 0;
      this.say(kind === 'smoke' ? 'Air One, smoke away. Let\'s see them drive blind.' : kind === 'spikes' ? 'Air One, dropping spikes on their line.' : 'Air One, charges away. Units, keep your distance.');
    }
  }

  /** Put `count` drops of `kind` on the road ahead of the target. */
  dropAhead(t: RaceCar, kind: DropKind, count = 1, ahead?: number): boolean {
    const h = this.heli;
    const S = this.world.samples;
    const N = S.length;
    const hw = this.world.halfWidth;
    const fall = clamp(POLICE.dropFall[0] + Math.hypot(h.x - t.s.x, h.z - t.s.z) / 110, POLICE.dropFall[0], POLICE.dropFall[1]);
    // land where the target will be about when it goes off
    const lead = ahead ?? 14 + t.s.speed * (fall + (kind === 'charge' ? POLICE.chargeArm * 0.85 : 0.6));
    let idx = (t.trackIndex + Math.round(lead / 2)) % N;
    // never near its own units
    const units = this.race.pursuit?.units ?? [];
    for (let tries = 0; tries < 8; tries++) {
      const p = S[idx];
      if (!units.some((u) => u.active && Math.hypot(u.car.s.x - p.x, u.car.s.z - p.z) < 22)) break;
      idx = (idx + 6) % N;
      if (tries === 7) return false;
    }
    const baseOff = clamp(t.trackOffset + (this.rand() - 0.5) * 3, -hw + 1.5, hw - 1.5);
    for (let k = 0; k < count; k++) {
      const i = (idx + k * 5) % N;
      const p = S[i];
      const off = kind === 'spikes' ? clamp(baseOff, -(hw - POLICE.spikeLength / 2), hw - POLICE.spikeLength / 2) : clamp(baseOff + (k === 0 ? 0 : (k % 2 ? 1 : -1) * 4.2), -hw + 1, hw - 1);
      this.drops.push({
        id: this.dropId++,
        kind,
        x: p.x + p.nx * off,
        z: p.z + p.nz * off,
        sx: h.x + (this.rand() - 0.5) * 1.5,
        sy: h.y - 1.2,
        sz: h.z + (this.rand() - 0.5) * 1.5,
        age: -k * 0.25,
        fall,
        ax: p.nx,
        az: p.nz,
        red: kind === 'smoke' && this.rand() < 0.35,
        landed: false,
        boomed: false,
        done: false,
      });
    }
    this.emit({ type: 'drop', kind });
    return true;
  }

  private stepDrops(dt: number): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      if (!d.landed && d.age >= d.fall) {
        d.landed = true;
        if (d.kind === 'spikes' && !this.mirror) this.addSpikes(d.x, d.z, d.ax, d.az);
        this.emit({ type: 'landed', kind: d.kind, x: d.x, z: d.z });
      }
      if (d.kind === 'charge' && d.landed && !d.boomed && d.age >= d.fall + POLICE.chargeArm) {
        d.boomed = true;
        this.boom(d);
      }
      if (d.kind === 'smoke' && d.landed) this.smokeOn(d);
      const end = d.kind === 'smoke' ? d.fall + POLICE.smokeLife : d.kind === 'charge' ? d.fall + POLICE.chargeArm + 1.5 : d.fall + 0.6;
      if (d.age > end) {
        d.done = true;
        if (!this.mirror) this.drops.splice(i, 1);
      }
    }
  }

  /** smoke radius at this age */
  smokeRadius(d: Drop): number {
    const t = d.age - d.fall;
    return t < 0 ? 0 : POLICE.smokeRadius * Math.min(1, 0.35 + t / 2.5);
  }

  private smoked = new Set<number>();
  private smokeOn(d: Drop): void {
    const me = this.race.player;
    if (this.smoked.has(d.id)) return;
    const r = this.smokeRadius(d);
    if (Math.hypot(me.s.x - d.x, me.s.z - d.z) < r * 0.8) {
      this.smoked.add(d.id);
      this.emit({ type: 'smoked', red: d.red });
    }
  }

  /** a shock charge goes off: shove and spin every car in the ring (never police) */
  private boom(d: Drop): void {
    const me = this.race.player;
    const R = POLICE.chargeRadius;
    let hitMe = false;
    for (const c of this.race.cars) {
      if (c.gone || c.remote || c.finished) continue;
      if (this.mirror && c !== me) continue; // guests only move their own car
      const dx = c.s.x - d.x;
      const dz = c.s.z - d.z;
      const dist = Math.hypot(dx, dz);
      if (dist > R + 0.9) continue;
      const k = 1 - 0.6 * Math.min(1, dist / R);
      const nx = dist > 0.01 ? dx / dist : Math.cos(d.id);
      const nz = dist > 0.01 ? dz / dist : Math.sin(d.id);
      const s = c.s;
      s.vx = s.vx * POLICE.chargeSlow + nx * POLICE.chargeKick * k;
      s.vz = s.vz * POLICE.chargeSlow + nz * POLICE.chargeKick * k;
      s.vy += 2.2 * k;
      s.yawRate += (d.id % 2 ? 1 : -1) * 2.8 * k;
      if (c === me) hitMe = true;
    }
    this.emit({ type: 'boom', x: d.x, z: d.z, mine: hitMe });
  }

  // ── AI rivals see the markers and the smoke ──────────────────────────────
  react(c: RaceCar): void {
    if (!this.drops.length) return;
    const s = c.s;
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    const inp = c.input;
    for (const d of this.drops) {
      if (d.done) continue;
      const rx = d.x - s.x;
      const rz = d.z - s.z;
      const along = rx * fx + rz * fz;
      const lat = rx * fz - rz * fx; // + = to the car's right
      if (d.kind === 'smoke') {
        const r = this.smokeRadius(d) || 4;
        if (d.landed && along > -r && along < 45 && Math.abs(lat) < r + 2) inp.throttle = Math.min(inp.throttle, 0.55);
      } else if (!d.boomed && along > 0 && along < 60) {
        const r = d.kind === 'charge' ? POLICE.chargeRadius + 1.6 : POLICE.spikeLength / 2 + 1.4;
        if (Math.abs(lat) < r) {
          const push = (1 - Math.abs(lat) / r) * (1 - along / 60);
          inp.steer = clamp(inp.steer - Math.sign(lat || 1) * push * 0.9, -1, 1);
          if (along < 22) inp.throttle = Math.min(inp.throttle, 0.7);
        }
      }
    }
  }

  // ── Online ───────────────────────────────────────────────────────────────
  pack(): { x: number[] | 0; d: number[][] } {
    const h = this.heli;
    const r = (v: number, k = 10) => Math.round(v * k) / k;
    return {
      x: h.active ? [r(h.x), r(h.y), r(h.z), r(h.yaw, 100), Math.round(h.lx), Math.round(h.lz), r(h.vx), r(h.vz), Math.round(h.low * 100), MODES.indexOf(h.mode), TACTICS.indexOf(h.tactic)] : 0,
      d: this.drops.map((d) => [KINDS.indexOf(d.kind), r(d.x), r(d.z), r(d.sx), r(d.sy), r(d.sz), r(d.age), d.id, r(d.ax, 1000), r(d.az, 1000), d.red ? 1 : 0, r(d.fall)]),
    };
  }

  unpack(x: unknown, d: unknown): void {
    const h = this.heli;
    const fin = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
    if (Array.isArray(x) && x.length >= 6 && x.every(fin)) {
      const v = x as number[];
      const was = h.active ? h.mode : 'off';
      h.active = true;
      h.x = clamp(v[0], -6000, 6000);
      h.y = clamp(v[1], -100, 400);
      h.z = clamp(v[2], -6000, 6000);
      h.yaw = v[3];
      h.lx = clamp(v[4], -6000, 6000);
      h.lz = clamp(v[5], -6000, 6000);
      h.vx = v.length > 7 ? clamp(v[6], -200, 200) : 0;
      h.vz = v.length > 7 ? clamp(v[7], -200, 200) : 0;
      h.low = v.length > 8 ? clamp(v[8] / 100, 0, 1) : 0;
      h.mode = v.length > 9 ? MODES[clamp(Math.round(v[9]), 0, 3)] : 'chase';
      h.tactic = v.length > 10 ? TACTICS[clamp(Math.round(v[10]), 0, 3)] : 'trail';
      if (h.mode === 'chase' && was !== 'chase') this.emit({ type: 'heli' }); // on scene (as on the host)
    } else {
      if (h.active) this.emit({ type: 'heliLeave' });
      h.active = false;
      h.mode = 'off';
      h.sees = false;
    }
    if (Array.isArray(d)) {
      const keep = new Set<number>();
      for (const e of d.slice(0, 24)) {
        if (!Array.isArray(e) || e.length < 12 || !e.every(fin)) continue;
        const [ki, dx, dz, sx, sy, sz, age, id, ax, az, red, fall] = e as number[];
        const kind = KINDS[ki];
        if (!kind || Math.abs(dx) > 6000 || Math.abs(dz) > 6000) continue;
        keep.add(id);
        const have = this.drops.find((q) => q.id === id);
        if (have) {
          // the host's clock wins, but never step a drop backwards past an event already seen
          have.age = Math.max(have.age - 0.05, age);
          continue;
        }
        this.drops.push({ id, kind, x: dx, z: dz, sx, sy, sz, age, fall: clamp(fall, 0.5, 4), ax, az, red: red === 1, landed: age >= fall, boomed: kind === 'charge' && age >= fall + POLICE.chargeArm, done: false });
      }
      // drops the host has finished with: keep them here until their own timers end
      for (let i = this.drops.length - 1; i >= 0; i--) if (!keep.has(this.drops[i].id) && this.drops[i].done) this.drops.splice(i, 1);
    }
  }

  reset(): void {
    const h = this.heli;
    h.active = false;
    h.mode = 'off';
    h.sees = h.seesTarget = false;
    h.y = -100;
    this.drops.length = 0;
    this.smoked.clear();
    this.sorties = 0;
    this.backT = 0;
    this.dropT = 6;
    this.target = null;
  }
}
