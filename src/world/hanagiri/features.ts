// ─────────────────────────────────────────────────────────────────────────────
// Hanagiri features (5C) — where the new landmarks stand, and what you can hit (logic only).
//
//   · the pass: a pull-out at the summit with a lonely mountain hut, the pass sign
//     ("Hanagiri Pass 1,163 m", our own design) and a snow plough parked up
//   · the avalanche gallery: a concrete roof over one hairpin exit on the switchbacks
//   · the rock shelter: a short roofed cut along the cliff descent
//   · the village stream and its little bridge
//   · the frozen waterfall on the cliff face
//   · snow fences and avalanche marker poles on the open slopes
//   · a weathered stone torii, half buried, and prayer stones by the shrine
//   · pursuit hiding spots: a forest track, inside the gallery, under the shelter
// The dressing (landmarks.ts) draws them.
// ─────────────────────────────────────────────────────────────────────────────
import { WORLD } from '../../config';
import { rng } from '../../core/math';
import type { WorldData } from '../WorldData';
import { indexAtKm, kmOf, zoneAtKm } from './zones';

export function placeFeatures(wd: WorldData, edge: number, clearOfRoad: (x: number, z: number, m: number) => boolean): void {
  const S = wd.samples;
  const N = S.length;
  const F = wd.field!;
  const rand = rng(5151);
  const at = (i: number, off: number, sd: number) => {
    const s = S[((i % N) + N) % N];
    return { x: s.x + s.nx * off * sd, z: s.z + s.nz * off * sd };
  };
  const inZone = (i: number, id: string) => zoneAtKm(kmOf(wd, i)).id === id;
  const lapDist = (a: number, b: number) => {
    const d = Math.abs(a - b);
    return Math.min(d, N - d);
  };
  const shrine = wd.decor.find((d) => d.kind === 'shrine');
  /** how much higher the land is on side `sd` at `off` m (positive: the hill side) */
  const rise = (i: number, sd: number, off: number) => {
    const p = at(i, off, sd);
    return F.at(p.x, p.z) - S[((i % N) + N) % N].y;
  };
  const step = (m: number) => Math.round(m / WORLD.sampleSpacing);
  /** whether a stretch of road is free of the pursuit's road works, cameras and breakers */
  const free = (i0: number, i1: number) => {
    const len = (i1 - i0 + N) % N;
    const mid = (i0 + Math.round(len / 2)) % N;
    const r = len / 2 + step(30);
    return !wd.workZones.some((z) => lapDist((z.index + Math.round(z.length / 2)) % N, mid) < r + z.length / 2) && !wd.speedTraps.some((t) => lapDist(t.index, mid) < r) && !wd.breakers.some((b) => lapDist(b.index, mid) < r);
  };

  // ── The pass: pull-out, hut, sign, plough ──────────────────────────────────
  {
    let best = -1;
    let bestSd = 1;
    let bestScore = 1e9;
    for (let i = indexAtKm(wd, 5.35); inZone(i, 'summit'); i = (i + 3) % N) {
      if (shrine && Math.hypot(S[i].x - shrine.x, S[i].z - shrine.z) < 110) continue;
      if (Math.abs(S[i].curv) > 1 / 120) continue;
      for (const sd of [1, -1]) {
        // level land for 26 m along and 24 m back
        let worst = 0;
        for (const a of [-13, 0, 13])
          for (const o of [edge + 3, edge + 12, edge + 22]) {
            const p = at(i + step(a), o, sd);
            worst = Math.max(worst, Math.abs(F.at(p.x, p.z) - S[i].y));
            if (!clearOfRoad(p.x, p.z, edge + 1)) worst = 99;
          }
        const score = worst + Math.abs(S[i].curv) * 200;
        if (score < bestScore) {
          bestScore = score;
          best = i;
          bestSd = sd;
        }
      }
    }
    if (best >= 0) {
      const s = S[best];
      const yawIn = Math.atan2(-s.nx * bestSd, -s.nz * bestSd); // facing the road
      const along = Math.atan2(s.tx, s.tz);
      const pc = at(best, edge + 8, bestSd);
      wd.decor.push({ kind: 'pullout', x: pc.x, z: pc.z, yaw: along, s: 26 });
      const hp = at(best + step(4), edge + 20, bestSd);
      wd.decor.push({ kind: 'hut', x: hp.x, z: hp.z, yaw: yawIn });
      wd.circles.push({ x: hp.x, z: hp.z, r: 4.2, top: 6 });
      const sp = at(best - step(14), edge + 2.4, bestSd);
      wd.decor.push({ kind: 'passsign', x: sp.x, z: sp.z, yaw: yawIn });
      wd.circles.push({ x: sp.x, z: sp.z, r: 0.5, top: 3 });
      const pp = at(best - step(5), edge + 9, bestSd);
      wd.decor.push({ kind: 'plough', x: pp.x, z: pp.z, yaw: along });
      for (const e of [-2.6, 2.6]) wd.circles.push({ x: pp.x + s.tx * e, z: pp.z + s.tz * e, r: 1.4, top: 3.2 });
    }
  }

  // ── The avalanche gallery over a hairpin exit on the switchbacks ───────────
  {
    // every stretch that leaves a hairpin (tighter than 70 m within the 120 m before it), where the
    // hill rises above the road the whole way: the best one gets the gallery
    let best: { i0: number; i1: number; sd: 1 | -1; score: number } | null = null;
    const len = step(56);
    for (let i0 = indexAtKm(wd, 3.32); inZone((i0 + len) % N, 'switchbacks'); i0 = (i0 + 2) % N) {
      let hair = false;
      for (let k = 6; k <= step(120); k += 2) if (Math.abs(S[(i0 - k + N) % N].curv) > 1 / 70) hair = true;
      if (!hair) continue;
      const i1 = (i0 + len) % N;
      if (!free(i0, i1)) continue;
      for (const sd of [1, -1] as const) {
        let lo = 1e9;
        let ok = true;
        for (let k = 0; k <= len; k += 2) {
          const i = (i0 + k) % N;
          lo = Math.min(lo, rise(i, sd, edge + 40));
          if (Math.abs(S[i].curv) > 1 / 30) ok = false;
        }
        if (ok && lo > 4 && (!best || lo > best.score)) best = { i0, i1, sd, score: lo };
      }
    }
    if (best) {
      const { i0, i1, sd } = best;
      wd.spans.push({ kind: 'gallery', i0, i1, side: sd });
      // pillars on the open side, just off the road
      for (let k = 0; k <= len; k += step(6)) {
        const p = at((i0 + k) % N, edge + 0.7, -sd);
        wd.circles.push({ x: p.x, z: p.z, r: 0.45, top: 7 });
      }
      const m = at((i0 + step(28)) % N, 0, 1);
      wd.hides.push({ x: m.x, z: m.z, r: 30, name: 'avalanche gallery' });
    }
  }

  // ── The rock shelter on the cliff descent ──────────────────────────────────
  {
    let placed = false;
    for (let i0 = indexAtKm(wd, 6.75); inZone(i0, 'cliff') && !placed; i0 = (i0 + step(10)) % N) {
      const i1 = (i0 + step(42)) % N;
      if (!inZone(i1, 'cliff')) break;
      if (!free(i0, i1)) continue;
      for (const sd of [1, -1] as const) {
        let ok = true;
        // along the cliff's rock face
        for (let k = 0, len = (i1 - i0 + N) % N, i = i0; k <= len; k += 2, i = (i0 + k) % N) if (wd.rockBack[i * 2 + (sd > 0 ? 1 : 0)] < 20 || Math.abs(S[i].curv) > 1 / 45) ok = false;
        if (!ok) continue;
        if (wd.spans.some((sp) => lapDist(sp.i0, i0) < step(120))) continue;
        wd.spans.push({ kind: 'shelter', i0, i1, side: sd });
        for (let k = 0, len = (i1 - i0 + N) % N, i = i0; k <= len; k += step(7), i = (i0 + k) % N) {
          const p = at(i, edge + 0.7, -sd);
          wd.circles.push({ x: p.x, z: p.z, r: 0.5, top: 6.5 });
        }
        const m = at((i0 + step(21)) % N, 0, 1);
        wd.hides.push({ x: m.x, z: m.z, r: 24, name: 'rock shelter' });
        placed = true;
        break;
      }
    }
  }

  // ── The frozen waterfall on the cliff face ─────────────────────────────────
  {
    let best = -1;
    let bestSd = 1;
    let bestRise = 0;
    for (let i = indexAtKm(wd, 6.7); inZone(i, 'cliff'); i = (i + 4) % N)
      for (const sd of [1, -1]) {
        if (wd.rockBack[i * 2 + (sd > 0 ? 1 : 0)] < 20) continue;
        const r = rise(i, sd, edge + 34);
        if (r > bestRise && !wd.spans.some((sp) => lapDist(sp.i0, i) < step(60) || lapDist(sp.i1, i) < step(60))) {
          bestRise = r;
          best = i;
          bestSd = sd;
        }
      }
    if (best >= 0 && bestRise > 8) {
      const s = S[best];
      const p = at(best, edge + 0.9, bestSd);
      wd.falls.push({ x: p.x, z: p.z, yaw: Math.atan2(s.nx * bestSd, s.nz * bestSd), w: 6, top: bestRise });
    }
  }

  // ── The village stream and its bridge ──────────────────────────────────────
  {
    // the lowest point of the road on the village straight: the stream runs through it
    let low = -1;
    for (let km = 0.3; km < 1.05; km += 0.01) {
      const i = indexAtKm(wd, km);
      const s = S[i];
      if (wd.buildings.some((b) => Math.hypot(b.x - s.x, b.z - s.z) < 30)) continue;
      const dip = Math.min(S[(i + step(50)) % N].y, S[(i - step(50) + N) % N].y) - s.y;
      if (low < 0 || dip > Math.min(S[(low + step(50)) % N].y, S[(low - step(50) + N) % N].y) - S[low].y) low = i;
    }
    if (low >= 0) {
      const s = S[low];
      const pts: { x: number; z: number }[] = [];
      // across the road, meandering a little, for 110 m each way
      for (let d = -110; d <= 110; d += 3) {
        const m = Math.sin(d * 0.045) * 6 + Math.sin(d * 0.11) * 2;
        pts.push({ x: s.x + s.nx * d + s.tx * m, z: s.z + s.nz * d + s.tz * m });
      }
      wd.streams.push({ pts });
      const i0 = (low - step(8) + N) % N;
      const i1 = (low + step(8)) % N;
      wd.spans.push({ kind: 'bridge', i0, i1, side: 1 });
      // the parapets are walls
      for (const sd of [1, -1]) {
        const a = at(i0, edge + 0.4, sd);
        const b = at(i1, edge + 0.4, sd);
        wd.segments.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z, top1: 1.1, top2: 1.1 });
      }
    }
  }

  // ── Snow fences and avalanche marker poles on the open slopes ──────────────
  {
    let fences = 0;
    for (let k = 0; k < 400 && fences < 10; k++) {
      const km = 3.4 + rand() * 1.7;
      const i = indexAtKm(wd, km);
      const s = S[i];
      for (const sd of [1, -1]) {
        if (rise(i, sd, edge + 22) < 4) continue; // only up the slope above the road
        const off = edge + 16 + rand() * 14;
        const p = at(i, off, sd);
        if (!clearOfRoad(p.x, p.z, edge + 10)) continue;
        if (wd.decor.some((d) => d.kind === 'fence' && Math.hypot(d.x - p.x, d.z - p.z) < 40)) continue;
        wd.decor.push({ kind: 'fence', x: p.x, z: p.z, yaw: Math.atan2(s.tx, s.tz), s: 16 + rand() * 14 });
        fences++;
        break;
      }
    }
    let poles = 0;
    for (let k = 0; k < 600 && poles < 46; k++) {
      const km = 3.3 + rand() * 3.3;
      const i = indexAtKm(wd, km);
      const sd = rand() < 0.5 ? 1 : -1;
      const p = at(i, edge + 6 + rand() * 34, sd);
      if (!clearOfRoad(p.x, p.z, edge + 4)) continue;
      wd.decor.push({ kind: 'avpole', x: p.x, z: p.z, yaw: rand() * 6.28 });
      poles++;
    }
  }

  // ── By the shrine: a weathered stone torii, half buried, and prayer stones ──
  if (shrine) {
    const fx = Math.sin(shrine.yaw);
    const fz = Math.cos(shrine.yaw);
    const x = shrine.x + fx * 22;
    const z = shrine.z + fz * 22;
    wd.decor.push({ kind: 'stonetorii', x, z, yaw: shrine.yaw });
    for (const e of [-2.1, 2.1]) wd.circles.push({ x: x + Math.cos(shrine.yaw) * e, z: z - Math.sin(shrine.yaw) * e, r: 0.35, top: 3 });
    for (let k = 0; k < 7; k++) {
      const a = shrine.yaw + (rand() - 0.5) * 2.2;
      const d = 12 + rand() * 9;
      wd.decor.push({ kind: 'prayer', x: shrine.x + Math.sin(a) * d, z: shrine.z + Math.cos(a) * d, yaw: rand() * 6.28, s: 0.6 + rand() * 0.6 });
    }
  }

  // ── A hiding spot in the forest: a logging track off the road ──────────────
  {
    for (let k = 0; k < 60; k++) {
      const i = indexAtKm(wd, 1.6 + k * 0.025);
      for (const sd of [1, -1]) {
        const p = at(i, edge + 16, sd);
        if (Math.abs(F.at(p.x, p.z) - S[i].y) > 3 || !clearOfRoad(p.x, p.z, edge + 8)) continue;
        wd.hides.push({ x: p.x, z: p.z, r: 22, name: 'forest track' });
        k = 99;
        break;
      }
    }
  }

  // ── No street lamps standing up through a roof: drop those under the gallery and the shelter ──
  for (let k = wd.poles.length - 1; k >= 0; k--) {
    const p = wd.poles[k];
    const hit = wd.nearestTrack(p.x, p.z);
    if (!hit) continue;
    const under = wd.spans.some((sp) => sp.kind !== 'bridge' && within(hit.index, sp.i0, sp.i1, step(8), N));
    if (!under) continue;
    wd.poles.splice(k, 1);
    const ci = wd.circles.findIndex((c) => Math.abs(c.x - p.x) < 1e-6 && Math.abs(c.z - p.z) < 1e-6);
    if (ci >= 0) wd.circles.splice(ci, 1);
    const yaw = p.yaw ?? 0;
    const arm = p.arm ?? 0.9;
    const hx = p.x + Math.sin(yaw) * arm;
    const hz = p.z + Math.cos(yaw) * arm;
    const li = wd.lampHeads.findIndex((l) => Math.abs(l.x - hx) < 1e-6 && Math.abs(l.z - hz) < 1e-6);
    if (li >= 0) wd.lampHeads.splice(li, 1);
  }
}

function within(i: number, i0: number, i1: number, m: number, N: number): boolean {
  const len = (i1 - i0 + N) % N;
  const d = (i - i0 + m + N) % N;
  return d <= len + 2 * m;
}
