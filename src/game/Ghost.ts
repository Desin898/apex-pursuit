// ─────────────────────────────────────────────────────────────────────────────
// Ghost car (Phase 3D): in Free run (time trial) your best lap is recorded and replayed as a
// see-through car, so you can race yourself. Poses are sampled 20 times a second and kept on
// this device (localStorage), one ghost per car edition.
// ─────────────────────────────────────────────────────────────────────────────
const RATE = 20;
const KEY = 'apex-pursuit.ghost.v1';

export interface GhostPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export class Ghost {
  /** the best lap: time and its samples (x, y, z, yaw per sample) */
  best: { time: number; edition: string; data: Float32Array } | null = null;
  private rec: number[] = [];
  private recT = 0;
  private recording = false;

  constructor(private edition: string) {
    this.load();
  }

  setEdition(edition: string): void {
    if (edition === this.edition) return;
    this.edition = edition;
    this.load();
  }

  private load(): void {
    this.best = null;
    try {
      const all = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, { time: number; data: string }>;
      const g = all[this.edition];
      if (g && typeof g.time === 'number' && typeof g.data === 'string') {
        const bin = atob(g.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        this.best = { time: g.time, edition: this.edition, data: new Float32Array(bytes.buffer) };
      }
    } catch {
      /* storage unavailable or corrupt: no ghost */
    }
  }

  private save(): void {
    if (!this.best) return;
    try {
      const all = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>;
      const bytes = new Uint8Array(this.best.data.buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      all[this.edition] = { time: this.best.time, data: btoa(bin) };
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      /* quota: keep it for this session only */
    }
  }

  /** Lap line crossed: the lap that just ended may become the ghost; a new recording starts. */
  lapDone(lapTime: number, valid: boolean): boolean {
    let improved = false;
    if (this.recording && valid && lapTime > 20 && (!this.best || lapTime < this.best.time) && this.rec.length > 40) {
      this.best = { time: lapTime, edition: this.edition, data: new Float32Array(this.rec) };
      this.save();
      improved = true;
    }
    this.rec = [];
    this.recT = 0;
    this.recording = true;
    return improved;
  }

  /** Stop recording (reset to the grid, rejoin, busted…): the current lap can't become a ghost. */
  abort(): void {
    this.recording = false;
    this.rec = [];
  }

  /** Every frame while a lap is running (`lapTime`: seconds into this lap). */
  record(lapTime: number, x: number, y: number, z: number, yaw: number): void {
    if (!this.recording) return;
    this.recT = lapTime;
    while (this.recT * RATE >= this.rec.length / 4) this.rec.push(x, y, z, yaw);
    if (this.rec.length > RATE * 4 * 400) this.abort(); // a lap this long isn't a lap
  }

  /** Where the ghost is `t` seconds into its lap (null once it has finished). */
  pose(t: number, out: GhostPose): GhostPose | null {
    const b = this.best;
    if (!b || t < 0) return null;
    const n = b.data.length / 4;
    const f = t * RATE;
    const i = Math.floor(f);
    if (i >= n - 1) return null;
    const k = f - i;
    const d = b.data;
    const a = i * 4;
    out.x = d[a] + (d[a + 4] - d[a]) * k;
    out.y = d[a + 1] + (d[a + 5] - d[a + 1]) * k;
    out.z = d[a + 2] + (d[a + 6] - d[a + 2]) * k;
    let dy = d[a + 7] - d[a + 3];
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    out.yaw = d[a + 3] + dy * k;
    return out;
  }
}
