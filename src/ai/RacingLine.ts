// Racing line and speed plan for the AI. Pure data derived from the circuit centre line:
//   off[i]  sideways offset from the centre (+ = left) — wide on entry, inside at the apex, wide on exit
//   v[i]    planned speed at full skill, already limited by the braking needed for what comes next
import { AI, WORLD } from '../config';
import { WorldData } from '../world/WorldData';

function blur(src: Float32Array, radius: number): Float32Array {
  const n = src.length;
  const out = new Float32Array(n);
  let acc = 0;
  for (let k = -radius; k <= radius; k++) acc += src[(k + n) % n];
  for (let i = 0; i < n; i++) {
    out[i] = acc / (2 * radius + 1);
    acc += src[(i + radius + 1) % n] - src[(i - radius + n) % n];
  }
  return out;
}

export class RacingLine {
  readonly off: Float32Array;
  readonly v: Float32Array;
  /** signed curvature of the line itself, 1/m (+ = left): used as steering feed-forward */
  readonly k: Float32Array;

  constructor(world: WorldData) {
    const S = world.samples;
    const n = S.length;
    const ds = WORLD.sampleSpacing;
    // "inside" signal: +1 in a tight left-hander, −1 in a tight right-hander
    const inside = new Float32Array(n);
    for (let i = 0; i < n; i++) inside[i] = Math.max(-1, Math.min(1, S[i].curv * 95));
    const narrow = blur(inside, 11);
    const wide = blur(inside, 58);
    const maxOff = world.halfWidth - 2.1;
    let off: Float32Array = new Float32Array(n);
    for (let i = 0; i < n; i++) off[i] = maxOff * Math.max(-1, Math.min(1, 1.55 * narrow[i] - 1.3 * wide[i]));
    off = blur(blur(off, 7), 5);
    this.off = off;

    // curvature of the line itself
    const px = new Float32Array(n);
    const pz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      px[i] = S[i].x + S[i].nx * off[i];
      pz[i] = S[i].z + S[i].nz * off[i];
    }
    const head = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 3 + n) % n;
      const b = (i + 3) % n;
      head[i] = Math.atan2(px[b] - px[a], pz[b] - pz[a]);
    }
    let signed: Float32Array = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let dh = head[(i + 3) % n] - head[(i - 3 + n) % n];
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      signed[i] = dh / (6 * ds);
    }
    signed = blur(signed, 3);
    this.k = signed;
    const v = new Float32Array(n);
    const grip = new Float32Array(n); // lateral acceleration available at each point's corner speed
    for (let i = 0; i < n; i++) {
      const k = Math.abs(signed[i]) - AI.downforceGain; // downforce lets fast corners be taken faster
      v[i] = k > 1e-5 ? Math.min(AI.topSpeed, Math.sqrt(AI.cornerGrip / k)) : AI.topSpeed;
      grip[i] = AI.cornerGrip + AI.downforceGain * v[i] * v[i];
    }
    // 5A: hills. Over a crest the car goes light (and flies past the lift-off speed): plan to take
    // crests at a speed that keeps the wheels on the road. Braking downhill takes longer, uphill less.
    const grade = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const y0 = S[(i - 2 + n) % n].y;
      const y1 = S[i].y;
      const y2 = S[(i + 2) % n].y;
      grade[i] = (y2 - y0) / (4 * ds);
      const kv = -(y2 - 2 * y1 + y0) / (4 * ds * ds); // + over a crest
      if (kv > 1e-4) v[i] = Math.min(v[i], Math.sqrt((9.81 / kv) * 1.15));
    }
    // Braking: walk backwards (twice round, so the lap wraps) limiting each point by the next.
    // A tyre that is cornering has less left for braking (friction circle), so the plan finishes
    // most of its braking in a straight line before turn-in instead of deep into the corner.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const next = v[(i + 1) % n];
        const lat = Math.min(1, (next * next * Math.abs(signed[i])) / grip[i]);
        const decel = Math.max(3, AI.brakeDecel * Math.sqrt(Math.max(0.04, 1 - lat * lat)) + 9.81 * grade[i]);
        const lim = Math.sqrt(next * next + 2 * decel * ds);
        if (v[i] > lim) v[i] = lim;
      }
    }
    this.v = v;
  }
}
