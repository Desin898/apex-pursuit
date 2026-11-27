// ─────────────────────────────────────────────────────────────────────────────
// Touge (5B) — a one-on-one battle on a mountain route, in rounds, leader and chaser swapping.
//
// Each round both cars start in single file, the leader in front. A round is decided by:
//   · the leader pulling away: more than PULL_AWAY metres clear at any point → leader wins;
//   · the chaser getting past: ahead by PASS_M metres and holding it for PASS_HOLD s → chaser wins;
//   · a crash: a car that has to be put back on the road (recovery) loses the round;
//   · the finish: if the leader crosses the line FINISH_GAP s or more ahead → leader wins; a chaser
//     still on the leader's bumper (closer than that) has matched them → the round is a draw.
// Two rounds with the roles swapped; if it's level after that, sudden-death rounds until someone
// wins one (at most MAX_ROUNDS, then the faster total time across the rounds decides).
// No rendering imports: the game reads `message`, `score` and `state` for the HUD and results.
// ─────────────────────────────────────────────────────────────────────────────
import type { Race, RaceCar } from './Race';

export const TOUGE = {
  PULL_AWAY: 150,
  PASS_M: 10,
  PASS_HOLD: 2.0,
  FINISH_GAP: 1.5,
  BETWEEN: 4.5,
  MAX_ROUNDS: 6,
  /** gap between the two cars on the start line (m) */
  START_GAP: 16,
};

export type TougeOutcome = 'you' | 'rival' | 'draw';

export interface TougeRound {
  round: number;
  youLed: boolean;
  winner: TougeOutcome;
  reason: string;
  /** each car's time for the route this round (0 = didn't finish) */
  youTime: number;
  rivalTime: number;
}

export class Touge {
  round = 1;
  /** rounds won: [you, rival] */
  readonly score: [number, number] = [0, 0];
  readonly rounds: TougeRound[] = [];
  state: 'run' | 'between' | 'over' = 'run';
  /** the player leads this round */
  youLead: boolean;
  /** one-shot text for the HUD (round results, the start of a round); cleared after reading */
  message = '';
  messageSub = '';
  /** latest gap, metres: + = the leader is ahead */
  gap = 0;
  winner: TougeOutcome | null = null;
  private passT = 0;
  private leaderDoneT = -1;
  private betweenT = 0;
  private rejoinsAtStart = [0, 0];
  private totals = [0, 0];

  /** the rival leads the first round, so you see the line before you have to set it */
  constructor(private race: Race, youLeadFirst = false) {
    this.youLead = youLeadFirst;
  }

  get you(): RaceCar {
    return this.race.player;
  }
  get rival(): RaceCar {
    return this.race.cars[1];
  }
  get leader(): RaceCar {
    return this.youLead ? this.you : this.rival;
  }
  get chaser(): RaceCar {
    return this.youLead ? this.rival : this.you;
  }

  /** Grid pose for a car this round: the leader at the line, the chaser START_GAP metres back. */
  pose(c: RaceCar, from: number): { x: number; z: number; yaw: number } {
    const S = this.race.world.samples;
    const n = S.length;
    const back = c === this.leader ? 8 : 8 + TOUGE.START_GAP;
    const s = S[(from - Math.round(back / 2) + n) % n];
    return { x: s.x, z: s.z, yaw: Math.atan2(s.tx, s.tz) };
  }

  /** called by the race after it put the cars on the start line */
  onGrid(): void {
    this.passT = 0;
    this.leaderDoneT = -1;
    this.gap = 0;
    this.rejoinsAtStart = [this.you.rejoins, this.rival.rejoins];
    if (this.state !== 'over') {
      this.state = 'run';
      this.message = `ROUND ${this.round}`;
      this.messageSub = this.youLead ? 'You lead: pull away' : 'You chase: stay on them, get past';
    }
  }

  step(dt: number): void {
    if (this.state === 'over') return;
    if (this.state === 'between') {
      this.betweenT -= dt;
      if (this.betweenT <= 0) {
        this.round++;
        this.youLead = !this.youLead;
        this.race.toGrid();
      }
      return;
    }
    if (this.race.held) return;
    const len = this.race.route?.len ?? 1;
    const dL = this.race.distanceOf(this.leader);
    const dC = this.race.distanceOf(this.chaser);
    this.gap = (dL - dC) * len;
    // a crash: whoever had to be put back on the road loses the round
    const youCrashed = this.you.rejoins > this.rejoinsAtStart[0];
    const rivalCrashed = this.rival.rejoins > this.rejoinsAtStart[1];
    if (youCrashed || rivalCrashed) {
      if (youCrashed && rivalCrashed) return this.end('draw', 'Both off the road');
      return this.end(youCrashed ? 'rival' : 'you', youCrashed ? 'You went off the road' : `${this.rival.name} went off the road`);
    }
    const leaderName = this.youLead ? 'You' : this.rival.name;
    const chaserName = this.youLead ? this.rival.name : 'You';
    if (this.gap > TOUGE.PULL_AWAY && !this.leader.finished) return this.end(this.youLead ? 'you' : 'rival', `${leaderName} pulled away`);
    if (this.gap < -TOUGE.PASS_M) {
      this.passT += dt;
      if (this.passT >= TOUGE.PASS_HOLD) return this.end(this.youLead ? 'rival' : 'you', `${chaserName} got past`);
    } else this.passT = 0;
    // the finish
    if (this.chaser.finished && !this.leader.finished) return this.end(this.youLead ? 'rival' : 'you', `${chaserName} got past`);
    if (this.leader.finished) {
      if (this.leaderDoneT < 0) this.leaderDoneT = 0;
      this.leaderDoneT += dt;
      if (this.chaser.finished) {
        const gapT = this.chaser.finishTime - this.leader.finishTime;
        if (gapT >= TOUGE.FINISH_GAP) return this.end(this.youLead ? 'you' : 'rival', `${leaderName} won by ${gapT.toFixed(1)} s`);
        return this.end('draw', `${chaserName} stayed on the bumper (${gapT.toFixed(1)} s)`);
      }
      if (this.leaderDoneT > TOUGE.FINISH_GAP + 0.01) {
        // the chaser is more than FINISH_GAP behind at the line
        return this.end(this.youLead ? 'you' : 'rival', `${leaderName} won by ${this.leaderDoneT.toFixed(1)}+ s`);
      }
    }
  }

  private end(w: TougeOutcome, reason: string): void {
    const youT = this.you.finished ? this.you.finishTime : 0;
    const rivalT = this.rival.finished ? this.rival.finishTime : 0;
    this.rounds.push({ round: this.round, youLed: this.youLead, winner: w, reason, youTime: youT, rivalTime: rivalT });
    if (w === 'you') this.score[0]++;
    if (w === 'rival') this.score[1]++;
    this.totals[0] += youT || this.race.time + 10;
    this.totals[1] += rivalT || this.race.time + 10;
    const title = w === 'you' ? 'ROUND WON' : w === 'rival' ? 'ROUND LOST' : 'ROUND DRAWN';
    this.message = title;
    this.messageSub = `${reason} · ${this.score[0]} – ${this.score[1]}`;
    // decided? after two rounds a lead wins it; in sudden death the first round won does
    const decided = (this.round >= 2 && this.score[0] !== this.score[1]) || this.round >= TOUGE.MAX_ROUNDS;
    if (decided) {
      this.state = 'over';
      this.winner = this.score[0] > this.score[1] ? 'you' : this.score[1] > this.score[0] ? 'rival' : this.totals[0] < this.totals[1] ? 'you' : this.totals[1] < this.totals[0] ? 'rival' : 'draw';
      this.message = this.winner === 'you' ? 'TOUGE WON' : this.winner === 'rival' ? 'TOUGE LOST' : 'TOUGE DRAWN';
      this.messageSub = `${reason} · ${this.score[0]} – ${this.score[1]}`;
      return;
    }
    this.state = 'between';
    this.betweenT = TOUGE.BETWEEN;
  }
}
