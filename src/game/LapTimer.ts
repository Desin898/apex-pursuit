// Lap timing on the circuit: crossing the start line in the right direction starts a lap; it
// only counts if both sector checkpoints were passed in order (no reversing over the line).
import { VehicleState } from '../vehicle/VehiclePhysics';
import { WorldData } from '../world/WorldData';

export class LapTimer {
  running = false;
  time = 0;
  last = 0;
  best = 0;
  laps = 0;
  /** set for one update when a lap completes: 1 = lap, 2 = new best */
  event = 0;
  /** 0..1 around the lap from the start line (last known) */
  progress = 0;
  private prevP = -1;
  private sector = 0;
  /** 5B: a point-to-point route (sprint, touge): the start sample and the metres to the finish */
  private route: { from: number; len: number } | null = null;
  private routeDone = false;

  /** 5B: time a route from one sample to another instead of laps (null = laps again). */
  setRoute(r: { from: number; len: number } | null): void {
    this.route = r;
    this.reset();
  }

  constructor(private world: WorldData, best: number) {
    this.best = best;
  }

  reset(): void {
    this.running = false;
    this.time = 0;
    this.prevP = -1;
    this.sector = 0;
    this.laps = 0;
    this.last = 0;
    this.progress = 0;
    this.routeDone = false;
  }

  update(s: VehicleState, dt: number): void {
    this.event = 0;
    if (this.running) this.time += dt;
    const hit = this.world.nearestTrack(s.x, s.z);
    if (!hit || Math.abs(hit.offset) > this.world.halfWidth + 6) return;
    const L = this.world.trackLength;
    if (this.route) {
      this.updateRoute(s, hit.s, L);
      return;
    }
    const startS = this.world.samples[this.world.startIndex].s;
    const p = (((hit.s - startS) % L) + L) % L / L; // 0..1 around the lap from the line
    if (this.prevP >= 0) {
      if (this.sector === 0 && p > 0.3 && p < 0.45) this.sector = 1;
      if (this.sector === 1 && p > 0.63 && p < 0.78) this.sector = 2;
      const crossed = this.prevP > 0.9 && p < 0.1 && s.forwardSpeed > 1;
      if (crossed) {
        if (this.running && this.sector === 2) {
          this.last = this.time;
          this.laps++;
          this.event = 1;
          if (this.best === 0 || this.time < this.best) {
            this.best = this.time;
            this.event = 2;
          }
        }
        this.running = true;
        this.time = 0;
        this.sector = 0;
      }
    }
    this.prevP = p;
    this.progress = p;
  }

  /**
   * 5B: on a route, progress runs 0 at the start line to 1 at the finish (negative behind the
   * start). Crossing the start line starts the clock; reaching the finish, with both checkpoints
   * passed, completes the route (laps = 1). After the finish the progress stays at 1.
   */
  private updateRoute(s: VehicleState, at: number, L: number): void {
    const r = this.route!;
    let d = (((at - this.world.samples[r.from].s) % L) + L) % L;
    if (d > r.len + (L - r.len) / 2) d -= L; // behind the start
    const p = d / r.len;
    if (this.routeDone) {
      this.progress = 1;
      return;
    }
    if (this.prevP > -9) {
      if (!this.running && this.prevP < 0 && p >= 0 && p < 0.1 && s.forwardSpeed > -1) {
        this.running = true;
        this.time = 0;
        this.sector = 0;
      }
      if (this.running) {
        if (this.sector === 0 && p > 0.3 && p < 0.45) this.sector = 1;
        if (this.sector === 1 && p > 0.63 && p < 0.78) this.sector = 2;
        if (this.sector === 2 && this.prevP < 1 && p >= 1 && p < 1.1) {
          this.last = this.time;
          this.laps = 1;
          this.routeDone = true;
          this.running = false; // the clock stops at the finish
          this.event = 1;
          if (this.best === 0 || this.time < this.best) {
            this.best = this.time;
            this.event = 2;
          }
          this.prevP = p;
          this.progress = 1;
          return;
        }
      }
    }
    this.prevP = p;
    this.progress = Math.min(1, p);
  }

  /** 4C.2: carry on from a race distance someone else reported (an AI taking over a friend's car). */
  resumeFrom(distance: number): void {
    if (distance < 0) return;
    this.laps = Math.floor(distance);
    this.progress = distance - this.laps;
    this.prevP = this.progress;
    this.running = true;
    // sectors: assume the ones before this point were passed
    this.sector = this.progress > 0.78 ? 2 : this.progress > 0.45 ? 1 : 0;
  }

  /** Laps completed plus fraction of the current one; negative on the grid before the first crossing. */
  get distance(): number {
    if (this.route) return this.routeDone ? 1 : this.progress;
    return this.running ? this.laps + this.progress : this.progress > 0.5 ? this.progress - 1 : this.progress;
  }
}

export function formatLap(t: number): string {
  if (!t || t <= 0) return '–:––.––';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}
