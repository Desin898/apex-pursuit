// ─────────────────────────────────────────────────────────────────────────────
// Surface maps (5B): what lies on the road, shared by the physics and the road shader, so what
// you see is what the tyres feel.
//   · Puddles: standing water in the wet. The same map makes the glossy patches in the road's
//     roughness (textures.puddleTexture) and the water the tyres plough through (aquaplaning).
//   · Road snow (the Snow weather): packed snow over the road with two darker wheel tracks in
//     each lane, cleaner stretches and drifted patches, and banks along the edges. One row per
//     track sample (2 m), 32 columns across the road. The road shader reads it as a texture.
// No DOM and no three.js here: the physics tests use it in node.
// ─────────────────────────────────────────────────────────────────────────────
import { rng } from '../core/math';

// ── Puddles ──────────────────────────────────────────────────────────────────
export const PUDDLE_SIZE = 256;
/** how the road's uv maps onto the puddle map (same as the roughness map's repeat) */
export const PUDDLE_REPEAT = { u: 1.4, v: 0.35 };
/** road uv: across the road 0..1, along it = metres / ROAD_V_METRES */
export const ROAD_V_METRES = 14;

let puddles: Float32Array | null = null;

/**
 * The puddle map as roughness values (0..255, 150 = plain wet road, lower = standing water),
 * painted exactly as the old canvas version: soft ellipses, alpha 0.85 → 0.5 → 0 from the
 * middle, wrapped round the tile.
 */
export function puddleRoughness(): Float32Array {
  if (puddles) return puddles;
  const N = PUDDLE_SIZE;
  const v = new Float32Array(N * N).fill(150);
  const r = rng(77);
  for (let i = 0; i < 26; i++) {
    const x = r() * N;
    const y = r() * N;
    const rad = 10 + r() * 34;
    const ry = rad * (0.35 + r() * 0.4);
    const rot = r() * 3;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    for (const [dx, dy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
      const cx = x + dx;
      const cy = y + dy;
      const x0 = Math.max(0, Math.floor(cx - rad));
      const x1 = Math.min(N - 1, Math.ceil(cx + rad));
      const y0 = Math.max(0, Math.floor(cy - rad));
      const y1 = Math.min(N - 1, Math.ceil(cy + rad));
      for (let py = y0; py <= y1; py++)
        for (let px = x0; px <= x1; px++) {
          // position in the ellipse's own frame, scaled so its rim is at 1
          const ux = px + 0.5 - cx;
          const uy = py + 0.5 - cy;
          const ex = (ux * cs + uy * sn) / rad;
          const ey = (-ux * sn + uy * cs) / ry;
          // the canvas gradient runs over the radius in the unscaled frame (rad), clipped by the ellipse
          if (ex * ex + ey * ey > 1) continue;
          const t = Math.hypot(ux, uy) / rad;
          let a: number;
          let c: number;
          if (t < 0.6) {
            const k = t / 0.6;
            a = 0.85 + (0.5 - 0.85) * k;
            c = 70 + 20 * k;
          } else {
            const k = Math.min(1, (t - 0.6) / 0.4);
            a = 0.5 * (1 - k);
            c = 90 + 60 * k;
          }
          const j = py * N + px;
          v[j] = c * a + v[j] * (1 - a);
        }
    }
  }
  puddles = v;
  return v;
}

/** Standing water 0..1 at road uv (u across 0..1, v = metres / ROAD_V_METRES). */
export function puddleDepth(u: number, vv: number): number {
  const m = puddleRoughness();
  const N = PUDDLE_SIZE;
  let tu = u * PUDDLE_REPEAT.u;
  let tv = vv * PUDDLE_REPEAT.v;
  tu -= Math.floor(tu);
  tv -= Math.floor(tv);
  // canvas textures are flipped: texture v = 0 is the bottom row of the canvas
  const px = Math.min(N - 1, Math.floor(tu * N));
  const py = Math.min(N - 1, Math.floor((1 - tv) * N));
  const rough = m[py * N + px];
  return Math.max(0, Math.min(1, (138 - rough) / 55));
}

// ── Road snow ────────────────────────────────────────────────────────────────
export const SNOW_COLS = 32;

/**
 * Snow on the road (0 = clear wet asphalt .. 1 = packed snow), one row per track sample.
 * halfWidth: the road's half width (the columns span −hw..+hw, column 0 at offset +hw).
 */
export function buildRoadSnow(samples: number, halfWidth: number, seed = 31): Uint8Array {
  const r = rng(seed);
  const out = new Uint8Array(samples * SNOW_COLS);
  // smooth random along the lap (wavelength ≈ 40–120 m): how much snow lies on each stretch
  const wave = (n: number, len: number) => {
    const k = Math.ceil(samples / len) + 2;
    const pts = Array.from({ length: k }, () => r());
    return (i: number) => {
      const f = (i / len) % (k - 1);
      const a = Math.floor(f);
      const t = f - a;
      const s = t * t * (3 - 2 * t);
      return pts[a] + (pts[(a + 1) % (k - 1)] - pts[a]) * s;
    };
  };
  const big = wave(1, 60); // 120 m (samples are 2 m)
  const mid = wave(2, 20); // 40 m
  const fine = wave(3, 4); // 8 m
  const hw = halfWidth;
  // wheel tracks: each lane's centre ± 0.8 m
  const lane = hw / 2;
  const tracks = [lane - 0.8, lane + 0.8, -lane - 0.8, -lane + 0.8];
  const jitter = wave(4, 15);
  for (let i = 0; i < samples; i++) {
    // how much lies on this stretch: ploughed and cleaner in places, drifted in others
    const amount = Math.min(1, Math.max(0.1, big(i) * 0.72 + mid(i) * 0.42 - 0.16));
    const wear = 0.72 + 0.26 * mid((i + 977) % samples); // how worn the tracks are here (always visible)
    const drift = jitter(i) - 0.5;
    for (let c = 0; c < SNOW_COLS; c++) {
      const o = hw - ((c + 0.5) / SNOW_COLS) * 2 * hw; // column 0 at +hw
      let tr = 0;
      for (const t of tracks) tr = Math.max(tr, Math.exp(-(((o - t - drift * 0.5) / 0.7) ** 2)));
      const edge = Math.min(1, Math.max(0, (Math.abs(o) - (hw - 2.2)) / 1.6));
      const crown = Math.exp(-((o / 0.9) ** 2)) * 0.35;
      let v = amount * (0.86 - wear * tr * 1.05) + edge * 0.95 + crown * amount + (fine((i + c * 37) % samples) - 0.5) * 0.18;
      v = Math.min(1, Math.max(0, v));
      out[i * SNOW_COLS + c] = Math.round(v * 255);
    }
  }
  return out;
}
