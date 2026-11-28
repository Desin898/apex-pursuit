// ─────────────────────────────────────────────────────────────────────────────
// Hanagiri Pass (5A) — the second venue: a 10.1 km lap over a mountain.
//
// The road follows a mountain-road layout scaled 1.75× and joined into one closed lap: it leaves
// the village on the valley floor, climbs a long straight to four switchback hairpins, runs along
// the summit ridge (≈ 160 m above the start), drops down the far side through a string of
// esses, swings round the east valley and the west canyon, and comes back along the village
// straight. Cherry blossom on the lower slopes, pines and snow above, torii gates over the road.
//
// This file is the logic side (no three.js): the lap, guard rails and rock cuttings (collision),
// houses, lamps, the shrine, pursuit features. The dressing (hanagiri/dressing.ts) draws it.
// ─────────────────────────────────────────────────────────────────────────────
import { WORLD } from '../../config';
import { rng } from '../../core/math';
import type { VenueDef } from '../venues';
import type { WorldData } from '../WorldData';
import { HANAGIRI_CONTROL, HANAGIRI_HOUSES } from './data';
import { hanagiriField } from './terrain';
import { kmOf, zoneAtKm, ZoneId, zoneWeight } from './zones';
import { placeFeatures } from './features';

const control: number[][] = [];
for (let i = 0; i < HANAGIRI_CONTROL.length; i += 3) control.push([HANAGIRI_CONTROL[i], HANAGIRI_CONTROL[i + 1], HANAGIRI_CONTROL[i + 2]]);

export const HANAGIRI_PASS: VenueDef = {
  id: 'hanagiri-pass',
  name: 'Hanagiri Pass',
  blurb: 'Mountain pass · 10.1 km lap · sakura, snow and hairpins',
  available: true,
  control,
  start: [299, 1029],
  bounds: { x: 30, z: 80, r: 1700 },
  terrain: hanagiriField,
  look: 'mountain',
  pursuitScale: 1.4,
  pad: { x: 1e5, z: 1e5, r: 0 },
  aprons: [],
  facility,
};

function facility(wd: WorldData): void {
  const S = wd.samples;
  const N = S.length;
  const F = wd.field!;
  const hw = wd.halfWidth;
  const edge = hw + WORLD.kerbWidth + WORLD.runoffWidth; // outer edge of the paved shoulder
  const rand = rng(5150);
  const lapDist = (a: number, b: number) => {
    const d = Math.abs(a - b);
    return Math.min(d, N - d);
  };
  /** far enough from every part of the lap (not just the nearest leg) */
  const clearOfRoad = (x: number, z: number, m: number) => {
    const hit = wd.nearestTrack(x, z);
    return !hit || Math.abs(hit.offset) > m;
  };

  // ── Guard rails on the drops and round the outside of the bends; rock walls along the cuttings ──
  {
    const railOff = edge + 0.4;
    const runs: { pts: { x: number; z: number; b?: number }[]; kind: 'rail' | 'rock' }[] = [];
    const cur: (null | { pts: { x: number; z: number; b?: number }[]; kind: 'rail' | 'rock' })[] = [null, null];
    wd.rockBack = new Float32Array(N * 2);
    const STEP = 2; // every 4 m
    for (let i = 0; i <= N; i += STEP) {
      const s = S[i % N];
      for (let k = 0; k < 2; k++) {
        const sd = k === 0 ? 1 : -1;
        const px = s.x + s.nx * (edge + 10) * sd;
        const pz = s.z + s.nz * (edge + 10) * sd;
        const ground = F.at(px, pz);
        const drop = s.y - ground;
        const outside = (s.curv > 1 / 110 && sd < 0) || (s.curv < -1 / 110 && sd > 0);
        // another part of the lap right there (a hairpin's other leg): no wall between them
        const other = (() => {
          const hit = wd.nearestTrack(s.x + s.nx * (edge + 6) * sd, s.z + s.nz * (edge + 6) * sd);
          return !!hit && lapDist(hit.index, i % N) > 40;
        })();
        let want: 'rail' | 'rock' | null = null;
        // 5C: on the cliff descent the mountain side rises hard 20-40 m out: a rock face is cut
        // right up from the road's edge to meet it (the road "cut along a huge dark rock face")
        let back = 14;
        const cliff = zoneAtKm(kmOf(wd, i % N)).id === 'cliff';
        if (cliff && !other) {
          const p35 = F.at(s.x + s.nx * (edge + 34) * sd, s.z + s.nz * (edge + 34) * sd) - s.y;
          if (p35 > 9) {
            want = 'rock';
            back = 34;
          }
        }
        if (!other && !want) {
          if (-drop > 4.5) want = 'rock';
          else if (drop > 2.2 || outside) want = 'rail';
        }
        if (want === 'rock') for (let q = -1; q <= STEP; q++) wd.rockBack[(((i + q) % N + N) % N) * 2 + (sd > 0 ? 1 : 0)] = back;
        const c = cur[k];
        const pt = { x: s.x + s.nx * railOff * sd, z: s.z + s.nz * railOff * sd, b: back };
        if (want && c && c.kind === want) c.pts.push(pt);
        else {
          if (c && c.pts.length > 3) runs.push(c);
          cur[k] = want ? { kind: want, pts: [pt] } : null;
        }
      }
    }
    for (const c of cur) if (c && c.pts.length > 3) runs.push(c);
    for (const r of runs) {
      wd.barrierRuns.push({ pts: r.pts, kind: r.kind });
      const top = r.kind === 'rock' ? 3 : 0.95;
      for (let i = 0; i < r.pts.length - 1; i++) wd.segments.push({ x1: r.pts[i].x, z1: r.pts[i].z, x2: r.pts[i + 1].x, z2: r.pts[i + 1].z, top1: top, top2: top });
    }
  }

  // ── 5B: point-to-point routes: the climb from the village to the shrine, and the descent back ──
  {
    let top = 0;
    for (let i = 0; i < N; i++) if (S[i].y > S[top].y) top = i;
    const L = wd.trackLength;
    const along = (a: number, b: number) => (((S[b].s - S[a].s) % L) + L) % L;
    const upTo = (top + 8) % N;
    const downFrom = (top + 14) % N;
    wd.routes.push(
      { id: 'uphill', name: 'Hanagiri Uphill', blurb: 'Village to the summit shrine: the long straight, four hairpins, the ridge', from: wd.startIndex, to: upTo, len: along(wd.startIndex, upTo) },
      { id: 'downhill', name: 'Hanagiri Downhill', blurb: 'Summit shrine to the village: fast esses, the steep descent, the valley sweepers', from: downFrom, to: wd.startIndex, len: along(downFrom, wd.startIndex) },
    );
  }

  // ── The village car park: a level patch of paving near the start (the menus' showroom,
  //    a place to hide from the police) ──
  {
    const st0 = S[wd.startIndex];
    let best: { x: number; z: number; e: number } | null = null;
    for (let k = -90; k <= 90 && true; k += 6) {
      const s = S[(wd.startIndex + k + N) % N];
      for (const sd of [1, -1])
        for (const off of [edge + 30, edge + 42, edge + 56]) {
          const x = s.x + s.nx * off * sd;
          const z = s.z + s.nz * off * sd;
          if (!clearOfRoad(x, z, edge + 20)) continue;
          const h0 = F.at(x, z);
          let e = 0;
          for (let a = 0; a < 12; a++) for (const r of [10, 20]) e = Math.max(e, Math.abs(F.at(x + Math.cos(a * 0.52) * r, z + Math.sin(a * 0.52) * r) - h0));
          e += Math.hypot(x - st0.x, z - st0.z) / 400;
          if (!best || e < best.e) best = { x, z, e };
        }
    }
    if (best) {
      wd.pad.x = best.x;
      wd.pad.z = best.z;
      wd.pad.r = 22;
      wd.hides.push({ x: best.x, z: best.z, r: 26, name: 'village car park' });
    }
  }

  // ── Houses: the village by the start straight and the hamlets along the pass ──
  const yawAt = (x: number, z: number) => {
    const hit = wd.nearestTrack(x, z);
    if (!hit) return rand() * Math.PI;
    const s = S[hit.index];
    return Math.atan2(s.tx, s.tz);
  };
  const houseOk = (x: number, z: number, r: number) => {
    if (!clearOfRoad(x, z, edge + r + 3)) return false;
    if (Math.hypot(x - wd.pad.x, z - wd.pad.z) < wd.pad.r + r + 3) return false;
    for (const b of wd.buildings) if (Math.hypot(b.x - x, b.z - z) < (Math.max(b.w, b.d) + r) * 0.75 + 2) return false;
    // keep them on fairly level land
    const h0 = F.at(x, z);
    return Math.abs(F.at(x + r, z) - h0) < 3 && Math.abs(F.at(x, z + r) - h0) < 3 && Math.abs(F.at(x - r, z) - h0) < 3 && Math.abs(F.at(x, z - r) - h0) < 3;
  };
  const addHouse = (x: number, z: number, w: number, d: number) => {
    if (!houseOk(x, z, Math.max(w, d) / 2)) return;
    wd.addBox({ x, z, w, d, h: 6 + rand() * 3, yaw: yawAt(x, z), kind: 'hut' });
  };
  for (const [x, z, w, d] of HANAGIRI_HOUSES) addHouse(x, z, Math.max(8, w), Math.max(7, d));
  // more of the village, on both sides of the start straight
  const st = S[wd.startIndex];
  for (let k = -70; k <= 70; k += 3) {
    const s = S[(wd.startIndex + k + N) % N];
    for (const sd of [1, -1]) {
      if (rand() < 0.35) continue;
      const off = edge + 9 + rand() * 30;
      addHouse(s.x + s.nx * off * sd + s.tx * (rand() - 0.5) * 6, s.z + s.nz * off * sd + s.tz * (rand() - 0.5) * 6, 8 + rand() * 5, 7 + rand() * 4);
    }
  }

  // the lanes between the village houses: a hiding spot (houses on both sides block the view)
  {
    const near = wd.buildings.filter((b) => b.kind === 'hut' && Math.hypot(b.x - st.x, b.z - st.z) < 170);
    if (near.length > 4) {
      let x = 0;
      let z = 0;
      for (const b of near) {
        x += b.x;
        z += b.z;
      }
      x /= near.length;
      z /= near.length;
      if (clearOfRoad(x, z, edge + 6)) wd.hides.push({ x, z, r: 30, name: 'village lanes' });
    }
  }

  // ── The shrine at the summit and its torii gates; lanterns up the approach ──
  let top = 0;
  for (let i = 0; i < N; i++) if (S[i].y > S[top].y) top = i;
  {
    const s = S[top];
    // on the side where the land is level, set back from the road
    let sd = 1;
    for (const c of [1, -1]) if (Math.abs(F.at(s.x + s.nx * 40 * c, s.z + s.nz * 40 * c) - s.y) < Math.abs(F.at(s.x - s.nx * 40 * c, s.z - s.nz * 40 * c) - s.y)) sd = c;
    const x = s.x + s.nx * (edge + 34) * sd;
    const z = s.z + s.nz * (edge + 34) * sd;
    const yaw = Math.atan2(-s.nx * sd, -s.nz * sd);
    wd.decor.push({ kind: 'shrine', x, z, yaw });
    wd.hides.push({ x: x - Math.sin(yaw) * 14, z: z - Math.cos(yaw) * 14, r: 16, name: 'behind the shrine' });
    wd.addBox({ x, z, w: 16, d: 12, h: 9, yaw, kind: 'hut' });
    wd.buildings.pop(); // (keep its walls; the dressing draws the shrine, not a house)
  }
  const torii = [top, (wd.startIndex + Math.round(240 / WORLD.sampleSpacing)) % N, Math.round(N * 0.18), Math.round(N * 0.62)];
  for (const i of torii) {
    const s = S[i % N];
    const yaw = Math.atan2(s.tx, s.tz);
    wd.decor.push({ kind: 'torii', x: s.x, z: s.z, yaw, s: 1 });
    for (const e of [-edge - 0.8, edge + 0.8]) wd.circles.push({ x: s.x + s.nx * e, z: s.z + s.nz * e, r: 0.55, top: 9 });
  }
  for (let k = -60; k <= 60; k += 6) {
    if (Math.abs(k) < 6) continue;
    const s = S[(top + k + N) % N];
    for (const sd of [1, -1]) {
      const x = s.x + s.nx * (edge + 2.2) * sd;
      const z = s.z + s.nz * (edge + 2.2) * sd;
      wd.decor.push({ kind: 'lantern', x, z, yaw: Math.atan2(s.tx, s.tz) });
      wd.circles.push({ x, z, r: 0.45, top: 1.9 });
    }
  }

  // ── Chevron boards round the outside of the hairpins; snow poles up high ──
  for (let i = 0; i < N; i += 5) {
    const s = S[i];
    if (Math.abs(s.curv) > 1 / 55) {
      const sd = s.curv > 0 ? -1 : 1;
      const x = s.x + s.nx * (edge + 1.6) * sd;
      const z = s.z + s.nz * (edge + 1.6) * sd;
      if (!clearOfRoad(x, z, edge)) continue;
      wd.decor.push({ kind: 'chevron', x, z, yaw: Math.atan2(-s.nx * sd, -s.nz * sd) });
    }
  }
  for (let i = 0; i < N; i += 12) {
    const s = S[i];
    if (s.y < 95) continue;
    for (const sd of [1, -1]) {
      const x = s.x + s.nx * (edge + 0.9) * sd;
      const z = s.z + s.nz * (edge + 0.9) * sd;
      if (clearOfRoad(x, z, edge)) wd.decor.push({ kind: 'snowpole', x, z, yaw: 0 });
    }
  }

  // ── Spectators: the village straight and the summit ──
  // (5C: the high pass is isolated: few or no spectators up there, so only the village has them)
  for (const [i0, n] of [[wd.startIndex, 40]]) {
    for (let k = -n; k <= n; k += 4) {
      const s = S[(i0 + k + N) % N];
      for (const sd of [1, -1]) {
        const x = s.x + s.nx * (edge + 3.5) * sd;
        const z = s.z + s.nz * (edge + 3.5) * sd;
        if (rand() < 0.4 || !clearOfRoad(x, z, edge + 1)) continue;
        if (Math.abs(F.at(x, z) - s.y) > 1.5) continue;
        wd.decor.push({ kind: 'crowd', x, z, yaw: Math.atan2(-s.nx * sd, -s.nz * sd), s: 4 + Math.floor(rand() * 4) });
      }
    }
  }

  // ── Street lamps: the whole lap (it is lit at night), on whichever side the land is level ──
  {
    const back = edge + 2.8;
    // 5C: lamps by zone: the village is lit, the forest and the cliff now and then, the open
    // slopes only at the hairpins, the valley sparsely, and the high pass not at all
    const every: Record<ZoneId, number> = { village: 50, forest: 140, switchbacks: 0, summit: 0, cliff: 150, valley: 210 };
    const step = Math.round(10 / WORLD.sampleSpacing);
    let last = -1e9;
    for (let i = 0; i < N; i += step) {
      const smp = S[i];
      const km = kmOf(wd, i);
      const zid = zoneAtKm(km).id;
      const gap = every[zid];
      const hairpin = zid === 'switchbacks' && Math.abs(smp.curv) > 1 / 32;
      const along = i * WORLD.sampleSpacing;
      if (!hairpin && (gap === 0 || along - last < gap)) continue;
      if (hairpin && along - last < 60) continue;
      last = along;
      const sd0 = smp.curv > 0.0015 ? 1 : smp.curv < -0.0015 ? -1 : (i / step) % 2 === 0 ? 1 : -1;
      for (const sd of [sd0, -sd0]) {
        const x = smp.x + smp.nx * back * sd;
        const z = smp.z + smp.nz * back * sd;
        if (Math.abs(F.at(x, z) - smp.y) > 1.2) continue;
        if (!clearOfRoad(x, z, back - 0.5)) continue;
        if (wd.decor.some((d) => (d.kind === 'torii' || d.kind === 'shrine') && Math.hypot(d.x - x, d.z - z) < 18)) continue;
        const yaw = Math.atan2(-smp.nx * sd, -smp.nz * sd); // the arm points at the road
        wd.poles.push({ x, z, h: 9.5, yaw, arm: 3.2 });
        wd.circles.push({ x, z, r: 0.25, top: 9.5 });
        break;
      }
    }
    for (const p of wd.poles) {
      const yaw = p.yaw ?? 0;
      const arm = p.arm ?? 0.9;
      const hx = p.x + Math.sin(yaw) * arm;
      const hz = p.z + Math.cos(yaw) * arm;
      wd.lampHeads.push({ x: hx, y: p.h + F.at(p.x, p.z), z: hz, pad: false });
    }
  }

  // ── Start gantry posts ──
  for (const e of [-hw - 2.6, hw + 2.6]) wd.circles.push({ x: st.x + st.nx * e, z: st.z + st.nz * e, r: 0.4, top: 8 });

  // ── Village signs (fictional) ──
  const boards: [number, string, string, number][] = [
    [0.02, 'HANAGIRI PASS', 'WELCOME · ようこそ', 0.98],
    [0.3, 'YUKIMI ONSEN', 'HOT SPRINGS · 2 KM', 0.55],
    [0.55, 'APEX PURSUIT', 'MOUNTAIN STAGE', 0.58],
    [0.82, 'KORSA TYRES', 'WINTER COMPOUND', 0.33],
  ];
  for (const [f, text, sub, hue] of boards) {
    for (let tries = 0; tries < 40; tries++) {
      const i = (wd.startIndex + Math.floor(f * N) + tries * 7) % N;
      const s = S[i];
      const sd = s.curv > 0 ? -1 : 1;
      const d = edge + 9;
      const x = s.x + s.nx * d * sd;
      const z = s.z + s.nz * d * sd;
      if (Math.abs(F.at(x, z) - s.y) > 1.5 || !clearOfRoad(x, z, d - 1)) continue;
      const yaw = Math.atan2(-s.nx * sd, -s.nz * sd);
      wd.billboards.push({ x, z, yaw, text, sub, hue });
      const cs = Math.cos(yaw);
      const sn = Math.sin(yaw);
      for (const e of [-5.2, 5.2]) wd.circles.push({ x: x + e * cs, z: z - e * sn, r: 0.3, top: 9 });
      break;
    }
  }

  // ── Pursuit features: speed traps, work zones, breakers (as on the Proving Grounds) ──
  {
    const W = 30;
    const sharp = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let m = 0;
      for (let k = -W; k <= W; k += 3) m = Math.max(m, Math.abs(S[(i + k + N) % N].curv));
      sharp[i] = m;
    }
    const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => sharp[a] - sharp[b]);
    for (const i of order) {
      if (wd.speedTraps.length >= 3) break;
      if (lapDist(i, wd.startIndex) < 150) continue;
      if (wd.speedTraps.some((t) => lapDist(t.index, i) < N / 5)) continue;
      const smp = S[i];
      wd.speedTraps.push({ index: i, x: smp.x, z: smp.z, yaw: Math.atan2(smp.tx, smp.tz) });
      for (const e of [-hw - 2.6, hw + 2.6]) wd.circles.push({ x: smp.x + smp.nx * e, z: smp.z + smp.nz * e, r: 0.35, top: 7 });
    }
    wd.pitExitIndex = (wd.startIndex + Math.round(70 / WORLD.sampleSpacing)) % N;
    for (const f of [0.22, 0.47, 0.71, 0.9]) {
      const i0 = (wd.startIndex + Math.floor(f * N)) % N;
      const len = Math.round(56 / WORLD.sampleSpacing);
      let curvSum = 0;
      for (let k = 0; k < len + 20; k++) curvSum += S[(i0 + k) % N].curv;
      const side: 1 | -1 = curvSum > 0 ? -1 : 1;
      const pieces: { kind: 'cone' | 'water' | 'saw'; x: number; z: number; yaw: number }[] = [];
      for (let k = 0; k <= len; k++) {
        const smp = S[(i0 + k) % N];
        const yaw = Math.atan2(smp.tx, smp.tz);
        const t = k / len;
        const lane = t < 0.18 ? (t / 0.18) * 3.6 : t > 0.86 ? ((1 - t) / 0.14) * 3.6 : 3.6;
        const off = side * (hw - lane);
        const px = smp.x + smp.nx * off;
        const pz = smp.z + smp.nz * off;
        if (t < 0.18 || t > 0.86) {
          if (k % 2 === 0) pieces.push({ kind: 'cone', x: px, z: pz, yaw });
        } else pieces.push({ kind: k % 4 === 2 ? 'saw' : 'water', x: px, z: pz, yaw });
      }
      wd.workZones.push({ index: i0, length: len, side, pieces });
    }
    const kinds: ['scaffold', 'containers', 'tower'] = ['scaffold', 'containers', 'tower'];
    [0.12, 0.4, 0.66].forEach((f, k) => {
      let i = (wd.startIndex + Math.floor(f * N)) % N;
      for (let tries = 0; tries < 60; tries++) {
        const smp = S[i];
        const side: 1 | -1 = smp.curv > 0 ? -1 : 1;
        const d = edge + 4.5;
        const x = smp.x + smp.nx * d * side;
        const z = smp.z + smp.nz * d * side;
        const busy = wd.workZones.some((z0) => lapDist(z0.index + z0.length / 2, i) < z0.length / 2 + 25) || wd.speedTraps.some((t) => lapDist(t.index, i) < 25);
        if (!busy && Math.abs(F.at(x, z) - smp.y) < 1.5 && clearOfRoad(x, z, d - 1)) {
          wd.breakers.push({ index: i, side, kind: kinds[k], x, z, yaw: Math.atan2(smp.tx, smp.tz) });
          break;
        }
        i = (i + 6) % N;
      }
    });
  }

  // ── 5C: the new landmarks (and what you can hit) ──
  placeFeatures(wd, edge, clearOfRoad);

  // ── Trees (5C): by zone. Kinds on the mountain: 0 tall spruce, 1 spruce, 2 young spruce,
  //    3 cherry, 4 bare birch. A dense corridor through the forest climb, scattered on the open
  //    slopes, none above the tree line, cherry trees and bare birches round the village. ──
  {
    // per zone: trees per 100 m of road on each side, how far back they reach, and the mix
    const MIX: Record<ZoneId, { per100: number; reach: number; mix: number[] }> = {
      village: { per100: 3.2, reach: 60, mix: [0.06, 0.12, 0.08, 0.5, 0.24] },
      forest: { per100: 27, reach: 58, mix: [0.42, 0.3, 0.13, 0.0, 0.15] },
      switchbacks: { per100: 3.6, reach: 70, mix: [0.28, 0.36, 0.16, 0.02, 0.18] },
      summit: { per100: 1.0, reach: 45, mix: [0.1, 0.35, 0.55, 0, 0] },
      cliff: { per100: 2.6, reach: 50, mix: [0.35, 0.35, 0.2, 0, 0.1] },
      valley: { per100: 2.2, reach: 80, mix: [0.62, 0.2, 0.06, 0.02, 0.1] },
    };
    const pick = (mix: number[]) => {
      let u = rand();
      for (let k = 0; k < mix.length; k++) if ((u -= mix[k]) < 0) return k;
      return 0;
    };
    const scaleOf = (k: number) => (k === 0 ? 1.55 + rand() * 1.0 : k === 1 ? 1.6 + rand() * 1.1 : k === 2 ? 0.8 + rand() * 0.8 : k === 3 ? 6 + rand() * 2.8 : 2.6 + rand() * 1.9);
    const step = 100 / WORLD.sampleSpacing;
    let forestKm = false;
    const place = (i: number, sd: number, kind: number, off: number) => {
      const s = S[i];
      const x = s.x + s.nx * off * sd + s.tx * (rand() - 0.5) * 8;
      const z = s.z + s.nz * off * sd + s.tz * (rand() - 0.5) * 8;
      if (!clearOfRoad(x, z, edge + (kind === 3 ? 3 : 3.5))) return false;
      const y = F.at(x, z);
      // the tree line: nothing above it (ragged), only young trees just below
      const line = 128 + 18 * Math.sin(x * 0.013) * Math.cos(z * 0.011);
      if (y > line) return false;
      if (y > line - 18 && kind !== 2) kind = 2;
      const sl = Math.hypot(F.at(x + 3, z) - y, F.at(x, z + 3) - y) / 3;
      // (spruces cling to steeper banks in the forest climb: it is a corridor, not a cutting)
      if (sl > (forestKm ? 1.45 : kind === 2 ? 0.8 : 0.7)) return false;
      for (const b of wd.buildings) if (Math.abs(b.x - x) < b.w / 2 + 4 && Math.abs(b.z - z) < b.d / 2 + 4) return false;
      for (const d of wd.decor) if ((d.kind === 'shrine' || d.kind === 'torii' || d.kind === 'hut' || d.kind === 'pullout' || d.kind === 'plough' || d.kind === 'stonetorii' || d.kind === 'fence') && Math.hypot(d.x - x, d.z - z) < (d.kind === 'pullout' ? 22 : 15)) return false;
      if (Math.hypot(x - wd.pad.x, z - wd.pad.z) < wd.pad.r + 4) return false;
      // nothing growing up through the gallery or shelter roofs, a rock face, or in the stream
      const ht = wd.nearestTrack(x, z);
      if (ht) {
        const rb = wd.rockBack[ht.index * 2 + (ht.offset > 0 ? 1 : 0)];
        if (rb > 0 && Math.abs(ht.offset) < edge + rb + 4) return false;
      }
      if (ht && Math.abs(ht.offset) < edge + 14) for (const sp of wd.spans) if (inSpan(ht.index, sp.i0, sp.i1, 6)) return false;
      for (const st of wd.streams) for (const p of st.pts) if (Math.abs(p.x - x) < 6 && Math.abs(p.z - z) < 6) return false;
      wd.trees.push({ x, z, s: scaleOf(kind), k: kind });
      if (off < 40) wd.circles.push({ x, z, r: kind === 2 ? 0.25 : kind === 4 ? 0.3 : 0.45, top: kind === 2 ? 3 : 6 });
      return true;
    };
    for (let i0 = 0; i0 < N; i0 += step) {
      const km = kmOf(wd, i0);
      const zone = zoneAtKm(km).id;
      const z = MIX[zone];
      forestKm = zone === 'forest';
      // the forest thins into the slopes at its ends
      const fw = zoneWeight(km, 'forest', 0.12);
      const per = z.per100 * (zone === 'forest' ? 0.35 + 0.65 * fw : 1);
      for (const sd of [1, -1]) {
        let n = Math.floor(per) + (rand() < per % 1 ? 1 : 0);
        let guard = 0;
        while (n > 0 && guard++ < n * 5 + 10) {
          const i = (i0 + Math.floor(rand() * step)) % N;
          // the forest crowds right up to the road; elsewhere trees stand further back
          const off = edge + (zone === 'forest' ? 3.5 + Math.pow(rand(), 1.25) * z.reach : 6 + Math.pow(rand(), 1.4) * z.reach);
          if (place(i, sd, pick(z.mix), off)) n--;
        }
      }
    }
    // the cherry avenue: blossom lining the road up to the village torii
    const toriiI = (wd.startIndex + Math.round(240 / WORLD.sampleSpacing)) % N;
    forestKm = false;
    for (let k = -Math.round(160 / WORLD.sampleSpacing); k <= Math.round(90 / WORLD.sampleSpacing); k += 6) {
      for (const sd of [1, -1]) if (rand() < 0.8) place((toriiI + k + N) % N, sd, 3, edge + 4 + rand() * 6);
    }
  }

  // ── The edge of the world: an invisible fence round the play area ──
  {
    const { x: cx, z: cz, r: R } = wd.bounds;
    const K = 160;
    for (let i = 0; i < K; i++) {
      const a0 = (i / K) * Math.PI * 2;
      const a1 = ((i + 1) / K) * Math.PI * 2;
      wd.segments.push({ x1: cx + Math.cos(a0) * R, z1: cz + Math.sin(a0) * R, x2: cx + Math.cos(a1) * R, z2: cz + Math.sin(a1) * R, top1: 80, top2: 80 });
    }
  }
}

/** 5C: whether lap index i lies within [i0, i1] (wrapping), with a margin in samples */
function inSpan(i: number, i0: number, i1: number, m: number): boolean {
  if (i0 <= i1) return i >= i0 - m && i <= i1 + m;
  return i >= i0 - m || i <= i1 + m;
}
