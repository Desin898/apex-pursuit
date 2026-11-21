// ─────────────────────────────────────────────────────────────────────────────
// AIDriver — one rival's brain. It only produces the same VehicleInput a human would
// (throttle, brake, steer, nitrous), so rivals obey exactly the same physics as the player.
//
// Each step: aim at a point ahead on the racing line (plus a personal "lane" shift used to pass
// or defend), follow the planned speed, react to traffic, and get itself out of trouble.
// Pure logic with a seeded random generator: deterministic, and able to run on a server.
// ─────────────────────────────────────────────────────────────────────────────
import { AI, WORLD } from '../config';
import { clamp, rng, wrapAngle } from '../core/math';
import type { RaceCar } from '../game/Race';
import { WorldData } from '../world/WorldData';
import { RacingLine } from './RacingLine';

export type Style = 'aggressive' | 'clean' | 'blocker';
export interface Level {
  grip: number;
  power: number;
  nitro: boolean;
}

export class AIDriver {
  /** sideways shift from the racing line, metres (+ = left) */
  lane = 0;
  /** set when the driver is hopelessly stuck; the race puts the car back on the circuit */
  wantRespawn = false;
  private rand: () => number;
  private mistakeIn: number;
  private mistakeT = 0;
  private stuckT = 0;
  private reverseT = 0;
  private troubleT = 0;
  private reaction: number;
  private burning = false;
  private fresh = true;

  /** < 1 on a wet track: scales the planned speeds (set by Race.setWet) */
  wetK = 1;
  /** ceiling on grip use (police may push harder than rivals) */
  gripCap = AI.maxGrip;

  constructor(private world: WorldData, private line: RacingLine, readonly style: Style, public level: Level, seed: number) {
    this.rand = rng(seed);
    this.mistakeIn = this.nextMistake();
    this.reaction = 0.12 + this.rand() * 0.28;
  }

  private nextMistake(): number {
    return AI.mistakeEvery[0] + this.rand() * (AI.mistakeEvery[1] - AI.mistakeEvery[0]);
  }

  reset(): void {
    this.lane = 0;
    this.stuckT = this.reverseT = this.troubleT = this.mistakeT = 0;
    this.wantRespawn = false;
    this.burning = false;
    this.fresh = true;
  }

  /**
   * @param sinceGo seconds since the lights went out (negative while waiting on the grid)
   * @param playerGap player's race distance minus this car's, in laps (for the mild rubber band)
   */
  update(me: RaceCar, cars: RaceCar[], dt: number, sinceGo: number, playerGap: number): void {
    const s = me.s;
    const inp = me.input;
    const S = this.world.samples;
    const N = S.length;
    const L = this.world.trackLength;
    const hw = this.world.halfWidth;
    inp.handbrake = false;
    inp.nitro = false;
    inp.analog = true;
    inp.shiftUp = inp.shiftDown = false;

    if (sinceGo < this.reaction) {
      // on the grid: hold revs, then launch after a human-ish reaction time
      inp.throttle = sinceGo < 0 ? 0.35 : 0;
      inp.brake = 0;
      inp.steer = 0;
      return;
    }

    const i = me.trackIndex;
    const speed = s.speed;
    if (this.fresh) {
      // leave the grid in your own lane; drift over to the racing line gradually
      this.fresh = false;
      this.lane = me.trackOffset - this.line.off[i];
    }

    // ── Steering target ──
    const look = AI.lookAheadBase + speed * AI.lookAheadSpeed;
    const j = (i + Math.max(2, Math.round(look / WORLD.sampleSpacing))) % N;
    const tOff = clamp(this.line.off[j] + this.lane, -(hw - 1.1), hw - 1.1);
    const tx = S[j].x + S[j].nx * tOff;
    const tz = S[j].z + S[j].nz * tOff;
    const err = wrapAngle(Math.atan2(tx - s.x, tz - s.z) - s.yaw);
    // feed-forward: the lock this corner needs at this speed, plus correction towards the target point
    const ff = (speed * speed * this.line.k[(i + 2) % N]) / AI.steerFullLockAccel;
    let steer = clamp(-ff - err * AI.steerGain, -1, 1);

    // ── Trouble handling: stuck, facing the wrong way, or lost off the circuit ──
    const slow = speed < 1.6;
    this.stuckT = slow ? this.stuckT + dt : Math.max(0, this.stuckT - dt * 2);
    this.troubleT = slow || !me.onTrack ? this.troubleT + dt : Math.max(0, this.troubleT - dt * 3);
    if (this.troubleT > AI.respawnTime) {
      this.wantRespawn = true;
      this.troubleT = 0;
    }
    if (this.reverseT <= 0 && (this.stuckT > AI.stuckTime || (Math.abs(err) > 2.0 && speed < 5))) {
      this.reverseT = 1.4;
      this.stuckT = 0;
    }
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      inp.throttle = 0;
      inp.brake = 0.8; // brake at a standstill selects reverse
      inp.steer = -steer; // steering is mirrored going backwards
      return;
    }

    // ── Planned speed ──
    const jv = (i + Math.round((2 + speed * 0.12) / WORLD.sampleSpacing)) % N;
    this.mistakeIn -= dt;
    if (this.mistakeIn <= 0) {
      this.mistakeT = 1.5; // arrives too hot at whatever comes next
      this.mistakeIn = this.nextMistake() * (0.6 + this.level.grip * 0.6);
    }
    if (this.mistakeT > 0) this.mistakeT -= dt;
    const band = 1 + clamp((playerGap * L) / AI.rubberBandGap, -1, 1) * AI.rubberBand;
    const styleK = this.style === 'aggressive' ? 1.012 : this.style === 'blocker' ? 0.996 : 1;
    const grip = Math.min(this.gripCap, this.level.grip * styleK * styleK * band * band);
    let vT = this.line.v[jv] * Math.sqrt(grip * this.wetK) * (this.mistakeT > 0 ? 1.06 : 1);

    // ── Traffic ──
    const lineHere = this.line.off[i];
    const myOff = me.trackOffset;
    let want = 0;
    let vCap = 1e9;
    let nearestAhead = 1e9;
    const gapWanted = this.style === 'aggressive' ? AI.passGap - 0.25 : AI.passGap;
    for (let k = 0; k < cars.length; k++) {
      const o = cars[k];
      if (o === me || !o.onTrack || !me.onTrack) continue;
      let ds = o.trackS - me.trackS;
      if (ds > L / 2) ds -= L;
      else if (ds < -L / 2) ds += L;
      if (ds > 60 || ds < -18) continue;
      const dOff = o.trackOffset - myOff;
      const closing = speed - o.s.speed;
      if (ds > 5.2) {
        const reach = 13 + Math.max(0, closing) * 1.5;
        if (ds < reach && ds < nearestAhead && Math.abs(dOff) < 2.4) {
          nearestAhead = ds;
          let side = dOff >= 0 ? -1 : 1;
          if (Math.abs(dOff) < 0.5) side = o.trackOffset > 0 ? -1 : 1; // dead ahead: take the wider side
          let goal = o.trackOffset + side * gapWanted;
          if (Math.abs(goal) > hw - 1.15) {
            side = -side;
            goal = o.trackOffset + side * gapWanted;
          }
          if (Math.abs(goal) > hw - 1.15) {
            vCap = Math.min(vCap, o.s.speed + (ds - 6) * 0.5); // nowhere to go: tuck in behind
          } else {
            want = goal - lineHere;
            if (ds < 8 && Math.abs(dOff) < 1.95) vCap = Math.min(vCap, o.s.speed + 1.2); // don't ram while pulling out
          }
        }
      } else if (ds > -5.2) {
        // alongside: hold a gap, and give racing room
        if (Math.abs(dOff) < 2.6) want = myOff - lineHere + (dOff >= 0 ? -1 : 1) * (2.6 - Math.abs(dOff)) * 1.3;
        if (ds > 0 && Math.abs(dOff) < 1.9) vCap = Math.min(vCap, o.s.speed + 0.5);
      } else if (this.style === 'blocker' && ds > -15 && -closing > 1.5 && nearestAhead > 1e8) {
        want = clamp((o.trackOffset - lineHere) * 0.8, -3, 3); // cover the side the chasing car is on
      }
    }
    const rate = sinceGo < 9 ? AI.laneRate * 0.3 : AI.laneRate; // no darting about in the start scrum
    this.lane += clamp(want - this.lane, -rate * dt, rate * dt);
    this.lane = clamp(this.lane, -(hw - 1.1) - lineHere, hw - 1.1 - lineHere);
    if (vT > vCap) vT = Math.max(vCap, 4);

    // ── Pedals ──
    const dv = vT - speed;
    let throttle = 0;
    let brake = 0;
    if (dv > 0) throttle = clamp(0.35 + dv * 0.5, 0, 1) * this.level.power;
    else if (dv < -1.2) brake = clamp(-dv / 5, 0.15, 1);
    else throttle = 0.25;
    // keep the car tidy: ease off if it is sliding or pointing well away from the target
    if (speed > 12 && Math.abs(s.sideSlip) > 0.2) throttle = Math.min(throttle, 0.3);
    if (speed > 14 && Math.abs(err) > 0.5) {
      throttle = Math.min(throttle, 0.2);
      brake = Math.max(brake, 0.3);
    }
    // Nitrous on the straights, same tank and rules as the player
    const straight = Math.abs(err) < 0.06 && Math.abs(s.sideSlip) < 0.05 && speed > 22;
    const fireAt = this.style === 'aggressive' ? 0.35 : 0.6;
    if (this.burning) this.burning = straight && dv > 3 && s.nitro > 0.02;
    else this.burning = straight && dv > 10 && s.nitro > fireAt && me.onTrack;
    inp.nitro = this.burning && this.level.nitro;
    if (!me.onTrack) {
      // off the tarmac: steer back gently, don't floor it sideways
      throttle = Math.min(throttle, 0.6);
      steer = clamp(steer, -0.7, 0.7);
    }
    inp.throttle = throttle;
    inp.brake = brake;
    inp.steer = steer;
  }
}
