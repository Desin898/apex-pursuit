// ─────────────────────────────────────────────────────────────────────────────
// WorldData — the *logical* world: track centre line, surfaces, ramps and colliders.
// Pure TypeScript with no rendering imports, so the physics (and, from Stage 6, the
// authoritative server) can query it. WorldBuilder turns the same data into meshes.
// ─────────────────────────────────────────────────────────────────────────────
import { PROVING_GROUNDS, VenueDef } from './venues';
import { WORLD } from '../config';
import { rng } from '../core/math';

export const enum Surface {
  Asphalt = 0,
  Kerb = 1,
  Grass = 2,
  Runoff = 3,
  /** 4E: the gravel traps in the corners */
  Gravel = 4,
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
  kind: 'pit' | 'hangar' | 'tower' | 'stand' | 'block' | 'grand' | 'hut';
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
  /** Paved areas that are not part of the circuit (from the venue). */
  readonly pad: { x: number; z: number; r: number };
  readonly aprons: { x0: number; z0: number; x1: number; z1: number }[];
  /** 4D: grandstands (front edge faces the track), for the crowd and the dressing */
  readonly stands: { x: number; z: number; w: number; d: number; yaw: number; rows: number }[] = [];
  /** 4D: marshal posts, tyre walls, gravel traps, catch fences, flags, the car park */
  readonly marshals: { x: number; z: number; yaw: number }[] = [];
  readonly tyreWalls: { x: number; z: number; yaw: number; len: number }[] = [];
  readonly gravel: { pts: { x: number; z: number }[]; inner: number; outer: number; side: number; i0: number; i1: number }[] = [];
  readonly flags: { x: number; z: number; h: number; kind: number; yaw: number }[] = [];
  readonly parked: { x: number; z: number; yaw: number; kind: number }[] = [];
  readonly floodlights: { x: number; z: number; yaw: number; h: number }[] = [];
  /** Start/finish line sits at this sample index. */
  startIndex = 0;

  private grid = new Map<number, number[]>();
  private segGrid = new Map<number, number[]>();
  private circGrid = new Map<number, number[]>();
  private _hit: TrackHit = { index: 0, offset: 0, s: 0 };

  constructor(readonly venue: VenueDef = PROVING_GROUNDS) {
    this.pad = { ...venue.pad };
    this.aprons = venue.aprons.map((a) => ({ ...a }));
    this.buildTrack();
    this.buildFacility();
    this.buildColliderGrid();
  }

  // ── Track ────────────────────────────────────────────────────────────────
  private buildTrack(): void {
    // 1. Dense closed Catmull-Rom evaluation
    const CONTROL = this.venue.control;
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
      // 4E: gravel traps: between the run-off and the barrier through some corners
      const N = this.samples.length;
      for (let g = 0; g < this.gravel.length; g++) {
        const t = this.gravel[g];
        const span = (t.i1 - t.i0 + N) % N;
        if ((hit.index - t.i0 + N) % N > span) continue;
        const o = hit.offset * t.side;
        if (o >= t.inner && o <= t.outer + 0.5) return Surface.Gravel;
      }
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
  /** a solid box (collider walls + a building entry); used by venue facility builders */
  addBox(b: Building): void {
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

  addRamp(r: Ramp): void {
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
    this.venue.facility(this);
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
