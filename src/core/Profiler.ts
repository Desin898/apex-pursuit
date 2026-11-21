// ─────────────────────────────────────────────────────────────────────────────
// Profiler (4B.2) — where the frame time goes, for the F3 overlay and the F4 benchmark.
// Sections add milliseconds during a frame; endFrame() folds them into smoothed averages.
// Draw calls are counted per render pass the same way. No allocation in the hot path.
// ─────────────────────────────────────────────────────────────────────────────
export type Section = 'physics' | 'ai' | 'police' | 'particles' | 'env' | 'hud' | 'scene' | 'mirrors' | 'reflect' | 'probe' | 'main' | 'other';
export const SECTIONS: Section[] = ['physics', 'ai', 'police', 'particles', 'env', 'hud', 'scene', 'mirrors', 'reflect', 'probe', 'main'];
export type Pass = 'mirrors' | 'reflect' | 'probe' | 'main' | 'hudMirror';
export const PASSES: Pass[] = ['mirrors', 'reflect', 'probe', 'main', 'hudMirror'];

const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

class Profiler {
  readonly frame: Record<string, number> = {};
  readonly avg: Record<string, number> = {};
  readonly calls: Record<string, number> = {};
  readonly callsAvg: Record<string, number> = {};
  /** whole CPU time of the last frame (ms), and its average */
  cpu = 0;
  cpuAvg = 0;
  on = true;
  constructor() {
    for (const s of [...SECTIONS, 'other']) {
      this.frame[s] = 0;
      this.avg[s] = 0;
    }
    for (const p of PASSES) {
      this.calls[p] = 0;
      this.callsAvg[p] = 0;
    }
  }
  now(): number {
    return now();
  }
  /** add the time since `t0` to a section */
  add(s: Section, t0: number): number {
    const t = now();
    this.frame[s] += t - t0;
    return t;
  }
  /** subtract time already counted in a sub-section (e.g. AI inside physics) */
  sub(s: Section, ms: number): void {
    this.frame[s] -= ms;
  }
  drawCalls(p: Pass, n: number): void {
    this.calls[p] += n;
  }
  endFrame(cpuMs: number): void {
    const k = 0.08;
    let known = 0;
    for (const s of SECTIONS) {
      this.avg[s] += (this.frame[s] - this.avg[s]) * k;
      known += this.frame[s];
      this.frame[s] = 0;
    }
    this.frame.other = Math.max(0, cpuMs - known);
    this.avg.other += (this.frame.other - this.avg.other) * k;
    this.frame.other = 0;
    for (const p of PASSES) {
      this.callsAvg[p] += (this.calls[p] - this.callsAvg[p]) * 0.2;
      this.calls[p] = 0;
    }
    this.cpu = cpuMs;
    this.cpuAvg += (cpuMs - this.cpuAvg) * k;
  }
}

export const prof = new Profiler();
