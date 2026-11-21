// ─────────────────────────────────────────────────────────────────────────────
// Venues (4D): each venue is a track definition plus its own facility layout (collision data,
// ramps, barriers, buildings, trees…) and, on the rendering side, its own dressing set
// (src/world/dressing/). WorldData takes a venue; race logic never needs to know which one.
// Adding a venue = a new VenueDef here + a dressing builder registered in dressing/index.ts.
// This file is plain data + logic (no three.js) so the headless physics tests can load it.
// ─────────────────────────────────────────────────────────────────────────────
import { WORLD } from '../config';
import { rng } from '../core/math';
import type { WorldData } from './WorldData';
import { Surface } from './WorldData';

export interface VenueDef {
  id: string;
  name: string;
  /** one line for the event card */
  blurb: string;
  /** false = shown as "coming" in menus, not selectable yet */
  available: boolean;
  /** circuit control points (x, z), driven in list order; closed Catch-Rom loop */
  control: [number, number][];
  /** paved areas that are not part of the circuit */
  pad: { x: number; z: number; r: number };
  aprons: { x0: number; z0: number; x1: number; z1: number }[];
  /** ramps, barriers, buildings, poles, trees, pursuit features… (collision + placement data) */
  facility(w: WorldData): void;
}

// ── Proving Grounds ──────────────────────────────────────────────────────────
export const PROVING_GROUNDS: VenueDef = {
  id: 'proving-grounds',
  name: 'Proving Grounds',
  blurb: 'Apex test circuit · clockwise',
  available: true,
  control: [
    [-300, -220],
    [-20, -220],
    [250, -220],
    [362, -178],
    [404, -80],
    [366, 22],
    [262, 62],
    [182, 2],
    [100, -62],
    [2, -22],
    [-62, 80],
    [18, 182],
    [160, 222],
    [300, 258],
    [334, 340],
    [244, 402],
    [60, 384],
    [-140, 332],
    [-322, 250],
    [-424, 100],
    [-442, -60],
    [-398, -176],
  ],
  pad: { x: -220, z: 60, r: 82 },
  aprons: [
    { x0: -262, z0: -214, x1: -178, z1: 0 }, // link road: main straight → skid pad
    { x0: -330, z0: -292, x1: 210, z1: -228 }, // pit lane / paddock strip behind the pit wall
  ],
  facility(wd: WorldData): void {
    const rand = rng(20261);

    const S = wd.samples;
    const N = S.length;

    // Ramps: a small kicker on the link road and a big one on the skid pad.
    wd.addRamp({ x: -220, z: -150, yaw: 0, length: 12, width: 9, height: 1.45 });
    wd.addRamp({ x: -288, z: 60, yaw: Math.PI / 2, length: 18, width: 11, height: 2.0 });

    // Barriers on the outside of real corners, set back behind a strip of run-off.
    const off = wd.halfWidth + 8;
    let run: { x: number; z: number }[] | null = null;
    let side = 0;
    const flush = () => {
      if (run && run.length > 6) {
        wd.barrierRuns.push({ pts: run });
        for (let i = 0; i < run.length - 1; i++) {
          wd.segments.push({ x1: run[i].x, z1: run[i].z, x2: run[i + 1].x, z2: run[i + 1].z, top1: 1.0, top2: 1.0 });
        }
      }
      run = null;
    };
    for (let i = 0; i <= N; i += 2) {
      const s = S[i % N];
      const want = Math.abs(s.curv) > 1 / 140 ? (s.curv > 0 ? -1 : 1) : 0; // outside = opposite the turn
      if (want !== side) {
        flush();
        side = want;
      }
      if (want !== 0) {
        if (!run) run = [];
        run.push({ x: s.x + s.nx * off * want, z: s.z + s.nz * off * want });
      }
    }
    flush();

    // Pit wall along the outside (north) of the main straight.
    const wall: { x: number; z: number }[] = [];
    for (let x = -330; x <= 210; x += 12) wall.push({ x, z: -220 - wd.halfWidth - 1.2 });
    wd.barrierRuns.push({ pts: wall });
    wd.segments.push({ x1: -330, z1: wall[0].z, x2: 210, z2: wall[0].z, top1: 1.0, top2: 1.0 });

    // Buildings
    wd.addBox({ x: -60, z: -306, w: 230, d: 16, h: 9, yaw: 0, kind: 'pit' });
    wd.addBox({ x: 120, z: -310, w: 70, d: 18, h: 14, yaw: 0, kind: 'stand' });
    wd.addBox({ x: -205, z: -312, w: 14, d: 14, h: 30, yaw: 0, kind: 'tower' });
    wd.addBox({ x: -345, z: -70, w: 46, d: 60, h: 15, yaw: 0, kind: 'hangar' });
    wd.addBox({ x: -345, z: 10, w: 46, d: 60, h: 15, yaw: 0, kind: 'hangar' });
    wd.addBox({ x: -120, z: 190, w: 30, d: 20, h: 7, yaw: 0.5, kind: 'block' });
    wd.addBox({ x: 210, z: 140, w: 26, d: 40, h: 8, yaw: -0.4, kind: 'block' });

    // ── 4D: dressing data (grandstands, marshal posts, tyre walls, gravel, flags, car park) ──
    {
      const hw = wd.halfWidth;
      const outward = (i: number) => (S[i].curv > 0 ? -1 : 1); // outside of the bend
      const lapDist = (a: number, b: number) => Math.min(Math.abs(a - b), N - Math.abs(a - b));
      // the extreme sample of the lap in a box, by a score
      const pick = (inBox: (x: number, z: number) => boolean, score: (x: number, z: number) => number) => {
        let best = -1;
        let bs = -Infinity;
        for (let i = 0; i < N; i++) {
          const s = S[i];
          if (!inBox(s.x, s.z)) continue;
          const v = score(s.x, s.z);
          if (v > bs) {
            bs = v;
            best = i;
          }
        }
        return best;
      };
      const addStand = (x: number, z: number, w: number, yaw: number, rows: number) => {
        const d = rows * 1.4 + 2;
        wd.stands.push({ x, z, w, d, yaw, rows });
        wd.addBox({ x, z, w, d, h: rows * 0.8 + 6, yaw, kind: 'grand' });
      };
      // main grandstand: the infield side of the start straight, facing the pits
      addStand(-75, -220 + hw + WORLD.kerbWidth + WORLD.runoffWidth + 16 + 6, 100, Math.PI, 10);
      // the right-hand hairpin and the far corner: outside, facing the track
      for (const [inBox, score, w] of [
        [(x: number, z: number) => z > 250 && z < 430, (x: number) => x, 80],
        [(x: number, z: number) => z > -150 && z < 0, (x: number) => x, 64],
      ] as [(x: number, z: number) => boolean, (x: number, z: number) => number, number][]) {
        const i = pick(inBox, score);
        if (i < 0) continue;
        const s = S[i];
        const o = outward(i);
        const rows = 9;
        const off = hw + 8 + 6 + (rows * 1.4 + 2) / 2;
        addStand(s.x + s.nx * off * o, s.z + s.nz * off * o, w, Math.atan2(-s.nx * o, -s.nz * o), rows);
      }

      // the sharpest corners (one per bend): marshal posts, tyre walls and gravel traps
      const corners: number[] = [];
      const bySharp = Array.from({ length: N }, (_, i) => i).sort((a, b) => Math.abs(S[b].curv) - Math.abs(S[a].curv));
      for (const i of bySharp) {
        if (corners.length >= 8) break;
        if (Math.abs(S[i].curv) < 1 / 140) break;
        if (lapDist(i, wd.startIndex) < 40) continue;
        if (corners.some((c) => lapDist(c, i) < 90)) continue;
        corners.push(i);
      }
      corners.sort((a, b) => a - b);
      corners.forEach((i, k) => {
        const s = S[i];
        const o = outward(i);
        const yaw = Math.atan2(s.tx, s.tz);
        // marshal post a little after the apex, behind the barrier
        const m = S[(i + 14) % N];
        const mo = outward((i + 14) % N);
        const mx = m.x + m.nx * (hw + 19) * mo;
        const mz = m.z + m.nz * (hw + 19) * mo;
        wd.marshals.push({ x: mx, z: mz, yaw: Math.atan2(-m.nx * mo, -m.nz * mo) });
        wd.circles.push({ x: mx, z: mz, r: 1.8, top: 3 });
        // tyre wall stacked behind the barrier line at the apex (the six sharpest)
        if (k < 6) wd.tyreWalls.push({ x: s.x + s.nx * (hw + 8.9) * o, z: s.z + s.nz * (hw + 8.9) * o, yaw, len: 18 });
        // gravel between the run-off and the barrier through the corner
        const span = 22;
        const pts: { x: number; z: number }[] = [];
        for (let q = -span; q <= span; q += 2) {
          const t = S[(i + q + N) % N];
          pts.push({ x: t.x, z: t.z });
        }
        wd.gravel.push({ pts, inner: hw + WORLD.kerbWidth + WORLD.runoffWidth + 0.2, outer: hw + 7.6, side: o, i0: (i - span + N) % N, i1: (i + span) % N });
      });

      // flags: start/finish (chequered), along the pit roof, on the grandstand roofs
      const g = S[wd.startIndex];
      for (const e of [-hw - 4, hw + 4]) wd.flags.push({ x: g.x + g.nx * e, z: g.z + g.nz * e, h: 9.5, kind: 0, yaw: 0 });
      for (let k = 0; k < 6; k++) wd.flags.push({ x: -150 + k * 36, z: -300, h: 14.5, kind: 1 + (k % 3), yaw: 0 });
      for (const st of wd.stands) {
        const cs = Math.cos(st.yaw);
        const sn = Math.sin(st.yaw);
        for (const e of [-st.w / 2 + 2, st.w / 2 - 2]) {
          const lz = -st.d / 2 + 0.5;
          wd.flags.push({ x: st.x + e * cs + lz * sn, z: st.z - e * sn + lz * cs, h: st.rows * 0.8 + 12, kind: 1 + (Math.abs(Math.round(e)) % 3), yaw: 0 });
        }
      }
      for (const f of wd.flags) wd.circles.push({ x: f.x, z: f.z, r: 0.12, top: f.h });

      // floodlight towers: behind the grandstands and at both ends of the pit lane
      const towers: [number, number][] = [
        [-345, -262],
        [232, -262],
      ];
      for (const st of wd.stands) {
        const cs = Math.cos(st.yaw);
        const sn = Math.sin(st.yaw);
        for (const e of [-st.w / 2 - 6, st.w / 2 + 6]) {
          const lz = -st.d / 2 - 4;
          towers.push([st.x + e * cs + lz * sn, st.z - e * sn + lz * cs]);
        }
      }
      for (const [x, z] of towers) {
        // aim at the nearest bit of track
        const hit = wd.nearestTrack(x, z);
        const s = hit ? S[hit.index] : S[0];
        wd.floodlights.push({ x, z, h: 32, yaw: Math.atan2(s.x - x, s.z - z) });
        wd.circles.push({ x, z, r: 1.3, top: 32 });
      }

      // car park behind the paddock: a concrete apron with two rows of parked cars
      const park = { x0: -250, z0: -398, x1: 60, z1: -334 };
      wd.aprons.push(park);
      const prk = rng(4401);
      for (const [rowZ, yaw] of [
        [-345, Math.PI],
        [-387, 0],
      ] as [number, number][]) {
        for (let x = park.x0 + 6; x <= park.x1 - 6; x += 3.4) {
          if (prk() < 0.3) continue;
          const px = x + (prk() - 0.5) * 0.25;
          const pz = rowZ + (prk() - 0.5) * 0.4;
          const yw = yaw + (prk() - 0.5) * 0.06;
          wd.parked.push({ x: px, z: pz, yaw: yw, kind: Math.floor(prk() * 3) });
          for (const u of [-1.2, 1.2]) wd.circles.push({ x: px + Math.sin(yw) * u, z: pz + Math.cos(yw) * u, r: 1.05, top: 1.5 });
        }
      }
    }

    // Light poles: along the main straight and around the skid pad.
    for (let x = -300; x <= 200; x += 50) wd.poles.push({ x, z: -234.5, h: 13 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      wd.poles.push({ x: wd.pad.x + Math.cos(a) * (wd.pad.r + 6), z: wd.pad.z + Math.sin(a) * (wd.pad.r + 6), h: 13 });
    }
    for (const p of wd.poles) wd.circles.push({ x: p.x, z: p.z, r: 0.28, top: p.h });

    // Start/finish gantry posts
    {
      const g = S[wd.startIndex];
      for (const e of [-wd.halfWidth - 2.6, wd.halfWidth + 2.6]) wd.circles.push({ x: g.x + g.nx * e, z: g.z + g.nz * e, r: 0.4, top: 8 });
    }

    // Billboards (original, fictional sponsors) set back from the outside of the lap.
    const boards: [number, string, string, number][] = [
      [0.1, 'APEX PURSUIT', 'PROVING GROUNDS', 0.58],
      [0.22, 'NITROVOLT', 'ENERGY SYSTEMS', 0.12],
      [0.36, 'PHANTOM X1', 'BUILT TO DISAPPEAR', 0.0],
      [0.5, 'KORSA TYRES', 'GRIP IS EVERYTHING', 0.33],
      [0.64, 'HALCYON OIL', 'SINCE NEVER', 0.08],
      [0.78, 'VELOCE RADIO', '108.8 FM', 0.78],
      [0.9, 'APEX PURSUIT', 'STAGE ONE BUILD', 0.58],
    ];
    for (const [f, text, sub, hue] of boards) {
      const s = S[Math.floor(f * N) % N];
      const sd = s.curv > 0 ? -1 : 1;
      const d = wd.halfWidth + 22;
      const x = s.x + s.nx * d * sd;
      const z = s.z + s.nz * d * sd;
      const yaw = Math.atan2(-s.nx * sd, -s.nz * sd); // face the track
      wd.billboards.push({ x, z, yaw, text, sub, hue });
      const cs = Math.cos(yaw);
      const sn = Math.sin(yaw);
      for (const e of [-5.2, 5.2]) wd.circles.push({ x: x + e * cs, z: z - e * sn, r: 0.3, top: 9 });
    }

    // ── Pursuit features ──
    {
      // straightness of each sample: the sharpest bend within ±60 m
      const W = 30;
      const sharp = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        let m = 0;
        for (let k = -W; k <= W; k++) m = Math.max(m, Math.abs(S[(i + k + N) % N].curv));
        sharp[i] = m;
      }
      const lapDist = (a: number, b: number) => {
        const d = Math.abs(a - b);
        return Math.min(d, N - d);
      };
      // speed traps: the two straightest places away from the start line and from each other
      const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => sharp[a] - sharp[b]);
      for (const i of order) {
        if (wd.speedTraps.length >= 2) break;
        if (lapDist(i, wd.startIndex) < 120) continue;
        if (wd.speedTraps.some((t) => lapDist(t.index, i) < N / 4)) continue;
        const smp = S[i];
        wd.speedTraps.push({ index: i, x: smp.x, z: smp.z, yaw: Math.atan2(smp.tx, smp.tz) });
        for (const e of [-wd.halfWidth - 2.6, wd.halfWidth + 2.6]) wd.circles.push({ x: smp.x + smp.nx * e, z: smp.z + smp.nz * e, r: 0.35, top: 7 });
      }
      wd.pitExitIndex = (wd.startIndex + Math.round(70 / WORLD.sampleSpacing)) % N;
      // work zones: three stretches, the narrowing on the outside of the bend that follows
      const zoneAt = [0.27, 0.52, 0.8];
      for (const f of zoneAt) {
        const i0 = Math.floor(f * N) % N;
        const len = Math.round(56 / WORLD.sampleSpacing);
        let curvSum = 0;
        for (let k = 0; k < len + 20; k++) curvSum += S[(i0 + k) % N].curv;
        const side: 1 | -1 = curvSum > 0 ? -1 : 1; // outside of the bend (curv > 0 bends towards +n)
        const pieces: { kind: 'cone' | 'water' | 'saw'; x: number; z: number; yaw: number }[] = [];
        const hw = wd.halfWidth;
        for (let k = 0; k <= len; k += 1) {
          const smp = S[(i0 + k) % N];
          const yaw = Math.atan2(smp.tx, smp.tz);
          // taper in over the first 10 m with cones, hold a closed lane, taper out with cones
          const t = k / len;
          const lane = t < 0.18 ? (t / 0.18) * 3.6 : t > 0.86 ? ((1 - t) / 0.14) * 3.6 : 3.6;
          const off = side * (hw - lane);
          const px = smp.x + smp.nx * off;
          const pz = smp.z + smp.nz * off;
          if (t < 0.18 || t > 0.86) {
            if (k % 2 === 0) pieces.push({ kind: 'cone', x: px, z: pz, yaw });
          } else {
            pieces.push({ kind: k % 4 === 2 ? 'saw' : 'water', x: px, z: pz, yaw });
          }
        }
        wd.workZones.push({ index: i0, length: len, side, pieces });
      }
      // pursuit breakers: scaffolding by the pit straight, a stack of containers, a timing tower
      const kinds: ['scaffold', 'containers', 'tower'] = ['scaffold', 'containers', 'tower'];
      const at = [wd.startIndex + Math.round(170 / WORLD.sampleSpacing), Math.floor(0.4 * N), Math.floor(0.68 * N)];
      at.forEach((i, k) => {
        i %= N;
        // move along a little if it would sit on a work zone or a speed trap
        for (let tries = 0; tries < 30; tries++) {
          const busy = wd.workZones.some((z) => lapDist(z.index + z.length / 2, i) < z.length / 2 + 25) || wd.speedTraps.some((t) => lapDist(t.index, i) < 25);
          if (!busy) break;
          i = (i + 6) % N;
        }
        const smp = S[i];
        const side: 1 | -1 = smp.curv > 0 ? -1 : 1;
        const d = wd.halfWidth + WORLD.kerbWidth + WORLD.runoffWidth + 4.5;
        wd.breakers.push({ index: i, side, kind: kinds[k], x: smp.x + smp.nx * d * side, z: smp.z + smp.nz * d * side, yaw: Math.atan2(smp.tx, smp.tz) });
      });
    }

    // Street lamps all the way round the lap (Phase 3C-2: they light the circuit at night).
    // Set well back beyond the run-off, on the inside of each bend, with the head hanging out over
    // the edge of the track. Skipped where something else is already standing.
    {
      const back = wd.halfWidth + WORLD.kerbWidth + WORLD.runoffWidth + 3.5;
      const clear = (x: number, z: number) => {
        for (const q of wd.poles) if (Math.hypot(q.x - x, q.z - z) < 34) return false;
        for (const b of wd.billboards) if (Math.hypot(b.x - x, b.z - z) < 16) return false;
        for (const b of wd.buildings) if (Math.abs(b.x - x) < b.w / 2 + 10 && Math.abs(b.z - z) < b.d / 2 + 10) return false;
        for (const r of wd.ramps) if (Math.hypot(r.x - x, r.z - z) < 30) return false;
        for (const b of wd.breakers) if (Math.hypot(b.x - x, b.z - z) < 22) return false;
        for (const t of wd.speedTraps) if (Math.hypot(t.x - x, t.z - z) < 14) return false;
        if (Math.hypot(wd.pad.x - x, wd.pad.z - z) < wd.pad.r + 10) return false;
        if (Math.hypot(WORLD.boundsCenterX - x, WORLD.boundsCenterZ - z) > WORLD.boundsRadius - 12) return false;
        if (z < -226 && z > -246 && x > -340 && x < 230) return false; // the main-straight pit wall has its own row
        // nowhere near another part of the circuit
        for (let k = 0; k < N; k += 3) {
          const o = S[k];
          if (Math.hypot(o.x - x, o.z - z) < back - 0.5) return false;
        }
        return true;
      };
      const step = Math.round(62 / WORLD.sampleSpacing);
      for (let i = 0; i < N; i += step) {
        const smp = S[i];
        const sd0 = smp.curv > 0.0015 ? 1 : smp.curv < -0.0015 ? -1 : (i / step) % 2 === 0 ? 1 : -1;
        for (const sd of [sd0, -sd0]) {
          const x = smp.x + smp.nx * back * sd;
          const z = smp.z + smp.nz * back * sd;
          if (!clear(x, z)) continue;
          const yaw = Math.atan2(-smp.nx * sd, -smp.nz * sd); // the arm points at the track
          wd.poles.push({ x, z, h: 11, yaw, arm: 4.5 });
          wd.circles.push({ x, z, r: 0.28, top: 11 });
          break;
        }
      }
    }
    for (const p of wd.poles) {
      const pad = p.arm === undefined && Math.hypot(p.x - wd.pad.x, p.z - wd.pad.z) < wd.pad.r + 12;
      const yaw = p.yaw ?? (pad ? Math.atan2(wd.pad.x - p.x, wd.pad.z - p.z) : 0);
      const arm = p.arm ?? 0.9;
      wd.lampHeads.push({ x: p.x + Math.sin(yaw) * arm, y: p.h, z: p.z + Math.cos(yaw) * arm, pad });
    }

    // Cones: a slalom down the link road, a ring on the skid pad, markers at the ramps.
    for (let i = 0; i < 9; i++) wd.props.push({ x: -240 + (i % 2) * 6, z: -110 + i * 12, kind: 'cone' });
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      wd.props.push({ x: wd.pad.x + Math.cos(a) * 34, z: wd.pad.z + Math.sin(a) * 34, kind: 'cone' });
    }
    for (let i = 0; i < 7; i++) {
      wd.props.push({ x: -180 + i * 9, z: 22 + (i % 2) * 5, kind: 'cone' });
    }
    for (const r of wd.ramps) {
      const sn = Math.sin(r.yaw);
      const cs = Math.cos(r.yaw);
      for (const w of [-r.width / 2 - 0.8, r.width / 2 + 0.8]) {
        for (const u of [-6, -1]) wd.props.push({ x: r.x + u * sn + w * cs, z: r.z + u * cs - w * sn, kind: 'cone' });
      }
    }
    // Barrels: little stacks to plough through.
    const clusters: [number, number][] = [
      [-196, 104],
      [-250, 112],
      [-170, 40],
      [-205, -40],
    ];
    for (const [cx, cz] of clusters) {
      for (let i = 0; i < 6; i++) {
        wd.props.push({ x: cx + (i % 3) * 1.0 - 1.0, z: cz + Math.floor(i / 3) * 1.0, kind: 'barrel' });
      }
    }

    // Trees: scattered outside the lap, never on tarmac or run-off.
    let guard = 0;
    while (wd.trees.length < 520 && guard++ < 20000) {
      const a = rand() * Math.PI * 2;
      const r = 120 + rand() * (WORLD.boundsRadius + 240);
      const x = WORLD.boundsCenterX + Math.cos(a) * r;
      const z = WORLD.boundsCenterZ + Math.sin(a) * r;
      const hit = wd.nearestTrack(x, z);
      if (hit && Math.abs(hit.offset) < 34) continue;
      if (wd.surfaceAt(x, z) !== Surface.Grass) continue;
      if (Math.hypot(x - wd.pad.x, z - wd.pad.z) < wd.pad.r + 30) continue;
      if (x > -400 && x < 260 && z > -340 && z < -190) continue; // pit complex
      if (x > -420 && x < -150 && z > -230 && z < 160) continue; // hangars + link road
      if (x > -270 && x < 80 && z > -410 && z < -320) continue; // 4D: car park
      let nearBuilding = false;
      for (const b of wd.buildings) if (Math.hypot(x - b.x, z - b.z) < Math.max(b.w, b.d) * 0.75 + 8) nearBuilding = true;
      if (nearBuilding) continue;
      // keep the infield mostly open so jumps and drifts have room
      const inside = r < WORLD.boundsRadius - 60;
      if (inside && rand() < 0.72) continue;
      wd.trees.push({ x, z, s: 0.8 + rand() * 0.9 });
      if (r < WORLD.boundsRadius) wd.circles.push({ x, z, r: 0.45, top: 6 });
    }

    // Perimeter fence
    const R = WORLD.boundsRadius;
    const K = 120;
    for (let i = 0; i < K; i++) {
      const a0 = (i / K) * Math.PI * 2;
      const a1 = ((i + 1) / K) * Math.PI * 2;
      wd.segments.push({
        x1: WORLD.boundsCenterX + Math.cos(a0) * R,
        z1: WORLD.boundsCenterZ + Math.sin(a0) * R,
        x2: WORLD.boundsCenterX + Math.cos(a1) * R,
        z2: WORLD.boundsCenterZ + Math.sin(a1) * R,
        top1: 50,
        top2: 50,
      });
    }
    },
};

// ── Phase 5 (planned): a mountain-pass venue. Listed so menus and online can show it as coming. ──
export const HANAGIRI_PASS: VenueDef = {
  id: 'hanagiri-pass',
  name: 'Hanagiri Pass',
  blurb: 'Mountain pass · sprints and touge battles · coming in Phase 5',
  available: false,
  control: PROVING_GROUNDS.control,
  pad: PROVING_GROUNDS.pad,
  aprons: [],
  facility: () => {},
};

export const VENUES: VenueDef[] = [PROVING_GROUNDS, HANAGIRI_PASS];

export function venueById(id: string | undefined): VenueDef {
  const v = VENUES.find((x) => x.id === id);
  return v && v.available ? v : PROVING_GROUNDS;
}
