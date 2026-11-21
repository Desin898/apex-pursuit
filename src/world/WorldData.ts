// ─────────────────────────────────────────────────────────────────────────────
// WorldData — the *logical* world: track centre line, surfaces, ramps and colliders.
// Pure TypeScript with no rendering imports, so the physics (and, from Stage 6, the
// authoritative server) can query it. WorldBuilder turns the same data into meshes.
// ─────────────────────────────────────────────────────────────────────────────
import { WORLD } from '../config';
import { rng } from '../core/math';

export const enum Surface {
  Asphalt = 0,
  Kerb = 1,
  Grass = 2,
  Runoff = 3,
}

export interface TrackSample {
  x: number;
  z: number;
  /** unit tangent (direction of travel) */
  tx: number;
  tz: number;
  /** unit normal pointing to the LEFT of the direction of travel */
  nx: number;
  nz: number;
  /** distance along the lap, metres */
  s: number;
  /** signed curvature, 1/m (positive = left-hander) */
  curv: number;
  kerbL: boolean;
  kerbR: boolean;
}

export interface Ramp {
  x: number;
  z: number;
  yaw: number;
  length: number;
  width: number;
  height: number;
}

export interface Segment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  top1: number;
  top2: number;
  /** index into ramps[] when this wall belongs to a ramp (cars already on the ramp ignore it) */
  ramp?: number;
}
export interface CircleCollider {
  x: number;
  z: number;
  r: number;
  top: number;
}
export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  yaw: number;
  kind: 'pit' | 'hangar' | 'tower' | 'stand' | 'block';
}
export interface PropSpawn {
  x: number;
  z: number;
  kind: 'cone' | 'barrel';
}
export interface Billboard {
  x: number;
  z: number;
  yaw: number;
  text: string;
  sub: string;
  hue: number;
}
export interface BarrierRun {
  pts: { x: number; z: number }[];
}
export interface TrackHit {
  index: number;
  /** signed sideways offset from the centre line (positive = left) */
  offset: number;
  /** distance along the lap */
  s: number;
}

// Control points of the circuit (x, z), driven in list order.
const CONTROL: [number, number][] = [
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
];

const CELL = 24;
const COL_CELL = 16;
function key(ix: number, iz: number): number {
  return (ix + 2048) * 4096 + (iz + 2048);
}

export class WorldData {
  readonly samples: TrackSample[] = [];
  trackLength = 0;
  readonly halfWidth = WORLD.trackHalfWidth;
  readonly ramps: Ramp[] = [];
  readonly segments: Segment[] = [];
  readonly circles: CircleCollider[] = [];
  readonly buildings: Building[] = [];
  readonly props: PropSpawn[] = [];
  readonly billboards: Billboard[] = [];
  readonly barrierRuns: BarrierRun[] = [];
  /** light poles. `arm`/`yaw`: a street lamp whose head hangs `arm` metres out towards the track */
  readonly poles: { x: number; z: number; h: number; yaw?: number; arm?: number }[] = [];
  // ── Pursuit features (Phase 3C-3): fixed places on the lap; the Pursuit class switches them on ──
  /** speed-trap gantries over the track */
  readonly speedTraps: { index: number; x: number; z: number; yaw: number }[] = [];
  /** work zones: a stretch where cones, water barriers and sawhorses close one side of the track */
  readonly workZones: { index: number; length: number; side: 1 | -1; pieces: { kind: 'cone' | 'water' | 'saw'; x: number; z: number; yaw: number }[] }[] = [];
  /** pursuit breakers: a structure beside the track that can be brought down on chasing police */
  readonly breakers: { index: number; side: 1 | -1; kind: 'scaffold' | 'containers' | 'tower'; x: number; z: number; yaw: number }[] = [];
  /** where police leave the pits */
  pitExitIndex = 0;
  /** where every lamp head is (for night lighting) */
  readonly lampHeads: { x: number; y: number; z: number; pad: boolean }[] = [];
  readonly trees: { x: number; z: number; s: number }[] = [];
  /** Paved areas that are not part of the circuit. */
  readonly pad = { x: -220, z: 60, r: 82 };
  readonly aprons: { x0: number; z0: number; x1: number; z1: number }[] = [
    { x0: -262, z0: -214, x1: -178, z1: 0 }, // link road: main straight → skid pad
    { x0: -330, z0: -292, x1: 210, z1: -228 }, // pit lane / paddock strip behind the pit wall
  ];
  /** Start/finish line sits at this sample index. */
  startIndex = 0;

  private grid = new Map<number, number[]>();
  private segGrid = new Map<number, number[]>();
  private circGrid = new Map<number, number[]>();
  private _hit: TrackHit = { index: 0, offset: 0, s: 0 };

  constructor() {
    this.buildTrack();
    this.buildFacility();
    this.buildColliderGrid();
  }

  // ── Track ────────────────────────────────────────────────────────────────
  private buildTrack(): void {
    // 1. Dense closed Catmull-Rom evaluation
    const n = CONTROL.length;
    const dense: [number, number][] = [];
    const SUB = 48;
    for (let i = 0; i < n; i++) {
      const p0 = CONTROL[(i - 1 + n) % n];
      const p1 = CONTROL[i];
      const p2 = CONTROL[(i + 1) % n];
      const p3 = CONTROL[(i + 2) % n];
      for (let j = 0; j < SUB; j++) {
        const t = j / SUB;
        const t2 = t * t;
        const t3 = t2 * t;
        const cr = (a: number, b: number, c: number, d: number) =>
          0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        dense.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    // 2. Arc-length resample at a fixed spacing
    const m = dense.length;
    const cum: number[] = [0];
    for (let i = 1; i <= m; i++) {
      const a = dense[i - 1];
      const b = dense[i % m];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[m];
    const count = Math.round(total / WORLD.sampleSpacing);
    const step = total / count;
    this.trackLength = total;
    let j = 0;
    const pts: [number, number][] = [];
    for (let i = 0; i < count; i++) {
      const d = i * step;
      while (cum[j + 1] < d) j++;
      const f = (d - cum[j]) / (cum[j + 1] - cum[j]);
      const a = dense[j % m];
      const b = dense[(j + 1) % m];
      pts.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
    // 3. Tangents, normals, curvature
    const headings: number[] = [];
    for (let i = 0; i < count; i++) {
      const a = pts[(i - 1 + count) % count];
      const b = pts[(i + 1) % count];
      const tx = b[0] - a[0];
      const tz = b[1] - a[1];
      const len = Math.hypot(tx, tz);
      headings.push(Math.atan2(tx, tz));
      this.samples.push({
        x: pts[i][0],
        z: pts[i][1],
        tx: tx / len,
        tz: tz / len,
        nx: tz / len,
        nz: -tx / len,
        s: i * step,
        curv: 0,
        kerbL: false,
        kerbR: false,
      });
    }
    const raw: number[] = [];
    for (let i = 0; i < count; i++) {
      let dh = headings[(i + 1) % count] - headings[(i - 1 + count) % count];
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      raw.push(dh / (2 * step));
    }
    // smooth curvature a little so kerbs/barriers start and stop cleanly
    for (let i = 0; i < count; i++) {
      let acc = 0;
      for (let k = -4; k <= 4; k++) acc += raw[(i + k + count) % count];
      this.samples[i].curv = acc / 9;
    }
    // 4. Kerbs: inside of every real corner, both sides of the tight ones
    for (let i = 0; i < count; i++) {
      const c = this.samples[i].curv;
      const ac = Math.abs(c);
      if (ac > 1 / 300) {
        if (c > 0) this.samples[i].kerbL = true;
        else this.samples[i].kerbR = true;
      }
      if (ac > 1 / 150) {
        this.samples[i].kerbL = true;
        this.samples[i].kerbR = true;
      }
    }
    // 5. Spatial hash of samples for nearest-point queries
    for (let i = 0; i < count; i++) {
      const s = this.samples[i];
      const k = key(Math.floor(s.x / CELL), Math.floor(s.z / CELL));
      let list = this.grid.get(k);
      if (!list) this.grid.set(k, (list = []));
      list.push(i);
    }
    // Start/finish: on the main straight
    let best = 0;
    let bd = 1e9;
    for (let i = 0; i < count; i++) {
      const s = this.samples[i];
      const d = Math.hypot(s.x - -150, s.z - -220);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    this.startIndex = best;
  }

  /** Nearest point on the circuit centre line. Returns null when further than ~one grid cell away. */
  nearestTrack(x: number, z: number): TrackHit | null {
    const ix = Math.floor(x / CELL);
    const iz = Math.floor(z / CELL);
    let best = -1;
    let bd = 1e12;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.grid.get(key(ix + dx, iz + dz));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const s = this.samples[list[k]];
          const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
          if (d < bd) {
            bd = d;
            best = list[k];
          }
        }
      }
    }
    if (best < 0) return null;
    const s = this.samples[best];
    const along = (x - s.x) * s.tx + (z - s.z) * s.tz;
    const hit = this._hit;
    hit.index = best;
    hit.offset = (x - s.x) * s.nx + (z - s.z) * s.nz;
    hit.s = s.s + along;
    return hit;
  }

  // ── Surfaces and height ──────────────────────────────────────────────────
  surfaceAt(x: number, z: number): Surface {
    const hit = this.nearestTrack(x, z);
    if (hit) {
      const a = Math.abs(hit.offset);
      if (a <= this.halfWidth) return Surface.Asphalt;
      if (a <= this.halfWidth + WORLD.kerbWidth) {
        const s = this.samples[hit.index];
        if (hit.offset > 0 ? s.kerbL : s.kerbR) return Surface.Kerb;
      }
      if (a <= this.halfWidth + WORLD.kerbWidth + WORLD.runoffWidth) return Surface.Runoff;
    }
    const p = this.pad;
    if ((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) <= p.r * p.r) return Surface.Asphalt;
    for (let i = 0; i < this.aprons.length; i++) {
      const a = this.aprons[i];
      if (x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1) return Surface.Asphalt;
    }
    return Surface.Grass;
  }

  /** Ground height. The proving ground is flat; ramps are the only raised surfaces. */
  heightAt(x: number, z: number): number {
    let h = 0;
    for (let i = 0; i < this.ramps.length; i++) {
      const r = this.ramps[i];
      const dx = x - r.x;
      const dz = z - r.z;
      const sn = Math.sin(r.yaw);
      const cs = Math.cos(r.yaw);
      const u = dx * sn + dz * cs; // along the ramp
      if (u < 0 || u > r.length) continue;
      const w = dx * cs - dz * sn; // across
      if (w < -r.width / 2 || w > r.width / 2) continue;
      const t = u / r.length;
      const rh = r.height * t * t; // parabolic kicker: flat entry, steepest at the lip
      if (rh > h) h = rh;
    }
    return h;
  }

  // ── Facility: ramps, buildings, barriers, props ──────────────────────────
  private addBox(b: Building): void {
    this.buildings.push(b);
    const sn = Math.sin(b.yaw);
    const cs = Math.cos(b.yaw);
    const hw = b.w / 2;
    const hd = b.d / 2;
    const c: [number, number][] = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ].map(([lx, lz]) => [b.x + lx * cs + lz * sn, b.z - lx * sn + lz * cs]);
    for (let i = 0; i < 4; i++) {
      const p = c[i];
      const q = c[(i + 1) % 4];
      this.segments.push({ x1: p[0], z1: p[1], x2: q[0], z2: q[1], top1: b.h, top2: b.h });
    }
  }

  private addRamp(r: Ramp): void {
    const ramp = this.ramps.length;
    this.ramps.push(r);
    const sn = Math.sin(r.yaw);
    const cs = Math.cos(r.yaw);
    const pt = (u: number, w: number): [number, number] => [r.x + u * sn + w * cs, r.z + u * cs - w * sn];
    const hw = r.width / 2;
    // Side walls follow the ramp surface height; the tall end is a full-height wall.
    const N = 6;
    for (const side of [-hw, hw]) {
      for (let i = 0; i < N; i++) {
        const u0 = (i / N) * r.length;
        const u1 = ((i + 1) / N) * r.length;
        const a = pt(u0, side);
        const b = pt(u1, side);
        this.segments.push({
          x1: a[0],
          z1: a[1],
          x2: b[0],
          z2: b[1],
          top1: r.height * (u0 / r.length) ** 2,
          top2: r.height * (u1 / r.length) ** 2,
          ramp,
        });
      }
    }
    const a = pt(r.length, -hw);
    const b = pt(r.length, hw);
    this.segments.push({ x1: a[0], z1: a[1], x2: b[0], z2: b[1], top1: r.height, top2: r.height, ramp });
  }

  private onRamp(r: Ramp, x: number, z: number): boolean {
    const dx = x - r.x;
    const dz = z - r.z;
    const sn = Math.sin(r.yaw);
    const cs = Math.cos(r.yaw);
    const u = dx * sn + dz * cs;
    const w = dx * cs - dz * sn;
    return u >= 0 && u <= r.length && Math.abs(w) <= r.width / 2;
  }

  private buildFacility(): void {
    const rand = rng(20261);
    const S = this.samples;
    const N = S.length;

    // Ramps: a small kicker on the link road and a big one on the skid pad.
    this.addRamp({ x: -220, z: -150, yaw: 0, length: 12, width: 9, height: 1.45 });
    this.addRamp({ x: -288, z: 60, yaw: Math.PI / 2, length: 18, width: 11, height: 2.0 });

    // Barriers on the outside of real corners, set back behind a strip of run-off.
    const off = this.halfWidth + 8;
    let run: { x: number; z: number }[] | null = null;
    let side = 0;
    const flush = () => {
      if (run && run.length > 6) {
        this.barrierRuns.push({ pts: run });
        for (let i = 0; i < run.length - 1; i++) {
          this.segments.push({ x1: run[i].x, z1: run[i].z, x2: run[i + 1].x, z2: run[i + 1].z, top1: 1.0, top2: 1.0 });
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
    for (let x = -330; x <= 210; x += 12) wall.push({ x, z: -220 - this.halfWidth - 1.2 });
    this.barrierRuns.push({ pts: wall });
    this.segments.push({ x1: -330, z1: wall[0].z, x2: 210, z2: wall[0].z, top1: 1.0, top2: 1.0 });

    // Buildings
    this.addBox({ x: -60, z: -306, w: 230, d: 16, h: 9, yaw: 0, kind: 'pit' });
    this.addBox({ x: 120, z: -310, w: 70, d: 18, h: 14, yaw: 0, kind: 'stand' });
    this.addBox({ x: -205, z: -312, w: 14, d: 14, h: 30, yaw: 0, kind: 'tower' });
    this.addBox({ x: -345, z: -70, w: 46, d: 60, h: 15, yaw: 0, kind: 'hangar' });
    this.addBox({ x: -345, z: 10, w: 46, d: 60, h: 15, yaw: 0, kind: 'hangar' });
    this.addBox({ x: -120, z: 190, w: 30, d: 20, h: 7, yaw: 0.5, kind: 'block' });
    this.addBox({ x: 210, z: 140, w: 26, d: 40, h: 8, yaw: -0.4, kind: 'block' });

    // Light poles: along the main straight and around the skid pad.
    for (let x = -300; x <= 200; x += 50) this.poles.push({ x, z: -234.5, h: 13 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      this.poles.push({ x: this.pad.x + Math.cos(a) * (this.pad.r + 6), z: this.pad.z + Math.sin(a) * (this.pad.r + 6), h: 13 });
    }
    for (const p of this.poles) this.circles.push({ x: p.x, z: p.z, r: 0.28, top: p.h });

    // Start/finish gantry posts
    {
      const g = S[this.startIndex];
      for (const e of [-this.halfWidth - 2.6, this.halfWidth + 2.6]) this.circles.push({ x: g.x + g.nx * e, z: g.z + g.nz * e, r: 0.4, top: 8 });
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
      const d = this.halfWidth + 22;
      const x = s.x + s.nx * d * sd;
      const z = s.z + s.nz * d * sd;
      const yaw = Math.atan2(-s.nx * sd, -s.nz * sd); // face the track
      this.billboards.push({ x, z, yaw, text, sub, hue });
      const cs = Math.cos(yaw);
      const sn = Math.sin(yaw);
      for (const e of [-5.2, 5.2]) this.circles.push({ x: x + e * cs, z: z - e * sn, r: 0.3, top: 9 });
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
        if (this.speedTraps.length >= 2) break;
        if (lapDist(i, this.startIndex) < 120) continue;
        if (this.speedTraps.some((t) => lapDist(t.index, i) < N / 4)) continue;
        const smp = S[i];
        this.speedTraps.push({ index: i, x: smp.x, z: smp.z, yaw: Math.atan2(smp.tx, smp.tz) });
        for (const e of [-this.halfWidth - 2.6, this.halfWidth + 2.6]) this.circles.push({ x: smp.x + smp.nx * e, z: smp.z + smp.nz * e, r: 0.35, top: 7 });
      }
      this.pitExitIndex = (this.startIndex + Math.round(70 / WORLD.sampleSpacing)) % N;
      // work zones: three stretches, the narrowing on the outside of the bend that follows
      const zoneAt = [0.27, 0.52, 0.8];
      for (const f of zoneAt) {
        const i0 = Math.floor(f * N) % N;
        const len = Math.round(56 / WORLD.sampleSpacing);
        let curvSum = 0;
        for (let k = 0; k < len + 20; k++) curvSum += S[(i0 + k) % N].curv;
        const side: 1 | -1 = curvSum > 0 ? -1 : 1; // outside of the bend (curv > 0 bends towards +n)
        const pieces: { kind: 'cone' | 'water' | 'saw'; x: number; z: number; yaw: number }[] = [];
        const hw = this.halfWidth;
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
        this.workZones.push({ index: i0, length: len, side, pieces });
      }
      // pursuit breakers: scaffolding by the pit straight, a stack of containers, a timing tower
      const kinds: ['scaffold', 'containers', 'tower'] = ['scaffold', 'containers', 'tower'];
      const at = [this.startIndex + Math.round(170 / WORLD.sampleSpacing), Math.floor(0.4 * N), Math.floor(0.68 * N)];
      at.forEach((i, k) => {
        i %= N;
        // move along a little if it would sit on a work zone or a speed trap
        for (let tries = 0; tries < 30; tries++) {
          const busy = this.workZones.some((z) => lapDist(z.index + z.length / 2, i) < z.length / 2 + 25) || this.speedTraps.some((t) => lapDist(t.index, i) < 25);
          if (!busy) break;
          i = (i + 6) % N;
        }
        const smp = S[i];
        const side: 1 | -1 = smp.curv > 0 ? -1 : 1;
        const d = this.halfWidth + WORLD.kerbWidth + WORLD.runoffWidth + 4.5;
        this.breakers.push({ index: i, side, kind: kinds[k], x: smp.x + smp.nx * d * side, z: smp.z + smp.nz * d * side, yaw: Math.atan2(smp.tx, smp.tz) });
      });
    }

    // Street lamps all the way round the lap (Phase 3C-2: they light the circuit at night).
    // Set well back beyond the run-off, on the inside of each bend, with the head hanging out over
    // the edge of the track. Skipped where something else is already standing.
    {
      const back = this.halfWidth + WORLD.kerbWidth + WORLD.runoffWidth + 3.5;
      const clear = (x: number, z: number) => {
        for (const q of this.poles) if (Math.hypot(q.x - x, q.z - z) < 34) return false;
        for (const b of this.billboards) if (Math.hypot(b.x - x, b.z - z) < 16) return false;
        for (const b of this.buildings) if (Math.abs(b.x - x) < b.w / 2 + 10 && Math.abs(b.z - z) < b.d / 2 + 10) return false;
        for (const r of this.ramps) if (Math.hypot(r.x - x, r.z - z) < 30) return false;
        for (const b of this.breakers) if (Math.hypot(b.x - x, b.z - z) < 22) return false;
        for (const t of this.speedTraps) if (Math.hypot(t.x - x, t.z - z) < 14) return false;
        if (Math.hypot(this.pad.x - x, this.pad.z - z) < this.pad.r + 10) return false;
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
          this.poles.push({ x, z, h: 11, yaw, arm: 4.5 });
          this.circles.push({ x, z, r: 0.28, top: 11 });
          break;
        }
      }
    }
    for (const p of this.poles) {
      const pad = p.arm === undefined && Math.hypot(p.x - this.pad.x, p.z - this.pad.z) < this.pad.r + 12;
      const yaw = p.yaw ?? (pad ? Math.atan2(this.pad.x - p.x, this.pad.z - p.z) : 0);
      const arm = p.arm ?? 0.9;
      this.lampHeads.push({ x: p.x + Math.sin(yaw) * arm, y: p.h, z: p.z + Math.cos(yaw) * arm, pad });
    }

    // Cones: a slalom down the link road, a ring on the skid pad, markers at the ramps.
    for (let i = 0; i < 9; i++) this.props.push({ x: -240 + (i % 2) * 6, z: -110 + i * 12, kind: 'cone' });
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      this.props.push({ x: this.pad.x + Math.cos(a) * 34, z: this.pad.z + Math.sin(a) * 34, kind: 'cone' });
    }
    for (let i = 0; i < 7; i++) {
      this.props.push({ x: -180 + i * 9, z: 22 + (i % 2) * 5, kind: 'cone' });
    }
    for (const r of this.ramps) {
      const sn = Math.sin(r.yaw);
      const cs = Math.cos(r.yaw);
      for (const w of [-r.width / 2 - 0.8, r.width / 2 + 0.8]) {
        for (const u of [-6, -1]) this.props.push({ x: r.x + u * sn + w * cs, z: r.z + u * cs - w * sn, kind: 'cone' });
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
        this.props.push({ x: cx + (i % 3) * 1.0 - 1.0, z: cz + Math.floor(i / 3) * 1.0, kind: 'barrel' });
      }
    }

    // Trees: scattered outside the lap, never on tarmac or run-off.
    let guard = 0;
    while (this.trees.length < 520 && guard++ < 20000) {
      const a = rand() * Math.PI * 2;
      const r = 120 + rand() * (WORLD.boundsRadius + 240);
      const x = WORLD.boundsCenterX + Math.cos(a) * r;
      const z = WORLD.boundsCenterZ + Math.sin(a) * r;
      const hit = this.nearestTrack(x, z);
      if (hit && Math.abs(hit.offset) < 34) continue;
      if (this.surfaceAt(x, z) !== Surface.Grass) continue;
      if (Math.hypot(x - this.pad.x, z - this.pad.z) < this.pad.r + 30) continue;
      if (x > -400 && x < 260 && z > -340 && z < -190) continue; // pit complex
      if (x > -420 && x < -150 && z > -230 && z < 160) continue; // hangars + link road
      let nearBuilding = false;
      for (const b of this.buildings) if (Math.hypot(x - b.x, z - b.z) < Math.max(b.w, b.d) * 0.75 + 8) nearBuilding = true;
      if (nearBuilding) continue;
      // keep the infield mostly open so jumps and drifts have room
      const inside = r < WORLD.boundsRadius - 60;
      if (inside && rand() < 0.72) continue;
      this.trees.push({ x, z, s: 0.8 + rand() * 0.9 });
      if (r < WORLD.boundsRadius) this.circles.push({ x, z, r: 0.45, top: 6 });
    }

    // Perimeter fence
    const R = WORLD.boundsRadius;
    const K = 120;
    for (let i = 0; i < K; i++) {
      const a0 = (i / K) * Math.PI * 2;
      const a1 = ((i + 1) / K) * Math.PI * 2;
      this.segments.push({
        x1: WORLD.boundsCenterX + Math.cos(a0) * R,
        z1: WORLD.boundsCenterZ + Math.sin(a0) * R,
        x2: WORLD.boundsCenterX + Math.cos(a1) * R,
        z2: WORLD.boundsCenterZ + Math.sin(a1) * R,
        top1: 50,
        top2: 50,
      });
    }
  }

  // ── Collision queries ────────────────────────────────────────────────────
  private buildColliderGrid(): void {
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i];
      const x0 = Math.floor((Math.min(s.x1, s.x2) - 1.5) / COL_CELL);
      const x1 = Math.floor((Math.max(s.x1, s.x2) + 1.5) / COL_CELL);
      const z0 = Math.floor((Math.min(s.z1, s.z2) - 1.5) / COL_CELL);
      const z1 = Math.floor((Math.max(s.z1, s.z2) + 1.5) / COL_CELL);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const k = key(ix, iz);
          let l = this.segGrid.get(k);
          if (!l) this.segGrid.set(k, (l = []));
          l.push(i);
        }
      }
    }
    for (let i = 0; i < this.circles.length; i++) {
      const c = this.circles[i];
      const x0 = Math.floor((c.x - c.r - 1.5) / COL_CELL);
      const x1 = Math.floor((c.x + c.r + 1.5) / COL_CELL);
      const z0 = Math.floor((c.z - c.r - 1.5) / COL_CELL);
      const z1 = Math.floor((c.z + c.r + 1.5) / COL_CELL);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const k = key(ix, iz);
          let l = this.circGrid.get(k);
          if (!l) this.circGrid.set(k, (l = []));
          l.push(i);
        }
      }
    }
  }

  /**
   * Test a circle (centre x,z radius r, base height y) against static colliders.
   * Calls `cb(nx, nz, penetration, px, pz)` for each overlap; n points away from the obstacle.
   */
  collide(
    x: number,
    z: number,
    r: number,
    y: number,
    cb: (nx: number, nz: number, pen: number, px: number, pz: number) => void,
  ): void {
    const k = key(Math.floor(x / COL_CELL), Math.floor(z / COL_CELL));
    const segs = this.segGrid.get(k);
    if (segs) {
      for (let i = 0; i < segs.length; i++) {
        const s = this.segments[segs[i]];
        const ex = s.x2 - s.x1;
        const ez = s.z2 - s.z1;
        const l2 = ex * ex + ez * ez;
        let t = l2 > 0 ? ((x - s.x1) * ex + (z - s.z1) * ez) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const top = s.top1 + (s.top2 - s.top1) * t;
        if (s.ramp !== undefined) {
          // Ramp walls only stop cars that are beside or in front of the ramp, not ones driving on it
          // or launching off the lip.
          if (y > top - 0.7 || this.onRamp(this.ramps[s.ramp], x, z)) continue;
        } else if (y > top - 0.3) continue; // car is above this obstacle
        const px = s.x1 + ex * t;
        const pz = s.z1 + ez * t;
        const dx = x - px;
        const dz = z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r || d2 < 1e-9) continue;
        const d = Math.sqrt(d2);
        cb(dx / d, dz / d, r - d, px, pz);
      }
    }
    const circs = this.circGrid.get(k);
    if (circs) {
      for (let i = 0; i < circs.length; i++) {
        const c = this.circles[circs[i]];
        if (y > c.top - 0.3) continue;
        const dx = x - c.x;
        const dz = z - c.z;
        const rr = r + c.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-9) continue;
        const d = Math.sqrt(d2);
        cb(dx / d, dz / d, rr - d, c.x + (dx / d) * c.r, c.z + (dz / d) * c.r);
      }
    }
  }

  /**
   * First wall or post along the line (x0,z0) → (x1,z1) that stands taller than `y`
   * (Phase 4A camera probe). Returns the fraction 0..1 along the line where it is hit, or 1.
   */
  raycastWalls(x0: number, z0: number, x1: number, z1: number, y: number): number {
    let best = 1;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const cx0 = Math.floor(Math.min(x0, x1) / COL_CELL);
    const cx1 = Math.floor(Math.max(x0, x1) / COL_CELL);
    const cz0 = Math.floor(Math.min(z0, z1) / COL_CELL);
    const cz1 = Math.floor(Math.max(z0, z1) / COL_CELL);
    for (let ix = cx0; ix <= cx1; ix++) {
      for (let iz = cz0; iz <= cz1; iz++) {
        const k = key(ix, iz);
        const segs = this.segGrid.get(k);
        if (segs) {
          for (let i = 0; i < segs.length; i++) {
            const s = this.segments[segs[i]];
            if (Math.max(s.top1, s.top2) < y) continue;
            const ex = s.x2 - s.x1;
            const ez = s.z2 - s.z1;
            const den = dx * ez - dz * ex;
            if (Math.abs(den) < 1e-9) continue;
            const t = ((s.x1 - x0) * ez - (s.z1 - z0) * ex) / den;
            const u = ((s.x1 - x0) * dz - (s.z1 - z0) * dx) / den;
            if (t < 0 || t >= best || u < 0 || u > 1) continue;
            if (s.top1 + (s.top2 - s.top1) * u < y) continue;
            best = t;
          }
        }
        const circs = this.circGrid.get(k);
        if (circs) {
          for (let i = 0; i < circs.length; i++) {
            const c = this.circles[circs[i]];
            if (c.top < y) continue;
            // ray-circle: |p0 + t d - c|² = r²
            const fx = x0 - c.x;
            const fz = z0 - c.z;
            const A = dx * dx + dz * dz;
            const B = 2 * (fx * dx + fz * dz);
            const C = fx * fx + fz * fz - c.r * c.r;
            const disc = B * B - 4 * A * C;
            if (disc < 0 || A < 1e-9) continue;
            const t = (-B - Math.sqrt(disc)) / (2 * A);
            if (t >= 0 && t < best) best = t;
          }
        }
      }
    }
    return best;
  }

  /** True if the point is inside (closer than `r` to) a wall or post taller than `y`. */
  insideWall(x: number, z: number, y: number, r: number): boolean {
    let hit = false;
    this.collide(x, z, r, y - 0.31, () => (hit = true)); // collide() skips obstacles lower than y + 0.3
    return hit;
  }

  /** Grid slot `k` (0 = pole). Slots are staggered left/right, 8 m apart, behind the start line. */
  gridPose(k: number): { x: number; z: number; yaw: number } {
    const n = this.samples.length;
    const back = Math.round((11.6 + k * 8) / WORLD.sampleSpacing);
    const s = this.samples[(this.startIndex - back + n) % n];
    const side = k % 2 === 0 ? 3 : -3;
    return { x: s.x + s.nx * side, z: s.z + s.nz * side, yaw: Math.atan2(s.tx, s.tz) };
  }

  /** Spawn pose on the grid, a few metres behind the start line. */
  startPose(): { x: number; z: number; yaw: number } {
    const s = this.samples[(this.startIndex - 6 + this.samples.length) % this.samples.length];
    return { x: s.x, z: s.z, yaw: Math.atan2(s.tx, s.tz) };
  }
}
