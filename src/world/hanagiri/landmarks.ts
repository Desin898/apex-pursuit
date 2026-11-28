// ─────────────────────────────────────────────────────────────────────────────
// Hanagiri landmarks (5C) — realistic proportions, materials and wear, so none look toy-like.
//
//   the village houses (stone footings, dark boards, lime plaster, exposed posts and beams, deep
//   tiled roofs on rafters, paper windows, some with chimneys and smoke), the shrine (dark timber,
//   a verdigris copper roof, stone steps, a sacred rope), the torii (tapered posts, a curved
//   lintel), stone lanterns, the half-buried stone torii and prayer stones up at the pass, the
//   mountain hut and its pull-out, the pass sign, a parked snow plough, the avalanche gallery, the
//   rock shelter, the village bridge and stream, the frozen waterfall, snow fences, avalanche
//   marker poles.
//
// The Snow weather adds its own layer (`winter`): snow on every roof, icicles along the eaves,
// plough banks along the road, drifts against the snow fences, cornices on the ridge, the stream
// frozen and the waterfall solid ice. In every other weather that layer is hidden, and the
// stream runs (and the waterfall is only half frozen). Switching is one flag: nothing is left over.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../../core/math';
import { mainOnly } from '../../core/layers';
import type { DressingContext } from '../dressing';
import type { WorldData } from '../WorldData';
import { mountainUniforms } from './MountainTerrain';
import { concreteTex, copperTex, iceTex, logTex, metalRoofTex, passSignTex, plasterTex, shojiTex, stoneTex, tileTex, timberTex } from './textures5C';
import { kmOf, zoneAtKm } from './zones';

type Quality = 'low' | 'medium' | 'high' | 'ultra';

// ── A bucket of parts that share one material, with world-space UVs ───────────
const NM = new THREE.Matrix3();
const TV = new THREE.Vector3();
class TexBucket {
  private parts: THREE.BufferGeometry[] = [];
  /**
   * `scale`: metres per texture repeat, projected from the world along the face's main axis.
   * `keepUV`: use the part's own UVs (times `uvScale`) instead (roofs: tile rows along the eaves).
   */
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, color: number | THREE.Color = 0xffffff, scale = 2, keepUV = false, uvScale = 1): void {
    const ng = g.index ? g.toNonIndexed() : g.clone();
    ng.applyMatrix4(m);
    for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') ng.deleteAttribute(k);
    if (!ng.getAttribute('normal')) ng.computeVertexNormals();
    const pa = ng.getAttribute('position');
    const na = ng.getAttribute('normal');
    const n = pa.count;
    let uv = ng.getAttribute('uv') as THREE.BufferAttribute | undefined;
    if (!keepUV || !uv) {
      const a = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const nx = Math.abs(na.getX(i));
        const ny = Math.abs(na.getY(i));
        const nz = Math.abs(na.getZ(i));
        const x = pa.getX(i);
        const y = pa.getY(i);
        const z = pa.getZ(i);
        if (ny >= nx && ny >= nz) {
          a[i * 2] = x / scale;
          a[i * 2 + 1] = z / scale;
        } else if (nx >= nz) {
          a[i * 2] = z / scale;
          a[i * 2 + 1] = y / scale;
        } else {
          a[i * 2] = x / scale;
          a[i * 2 + 1] = y / scale;
        }
      }
      uv = new THREE.BufferAttribute(a, 2);
      ng.setAttribute('uv', uv);
    } else if (uvScale !== 1) for (let i = 0; i < n; i++) uv.setXY(i, uv.getX(i) * uvScale, uv.getY(i) * uvScale);
    const c = new THREE.Color(color);
    const ca = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      ca[i * 3] = c.r;
      ca[i * 3 + 1] = c.g;
      ca[i * 3 + 2] = c.b;
    }
    ng.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    this.parts.push(ng);
  }
  get size(): number {
    return this.parts.length;
  }
  mesh(mat: THREE.Material, name: string, shadow = true): THREE.Mesh | null {
    if (!this.parts.length) return null;
    const g = mergeGeometries(this.parts)!;
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.castShadow = shadow;
    m.receiveShadow = true;
    this.parts = [];
    return m;
  }
}
void NM;
void TV;

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const V = new THREE.Vector3();
const SC = new THREE.Vector3();
/** world matrix: at (x, y, z), turned by yaw, then a local offset (lx, ly, lz), scale and tilt */
function at(x: number, y: number, z: number, yaw: number, lx = 0, ly = 0, lz = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0): THREE.Matrix4 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  V.set(x + lx * c + lz * s, y + ly, z - lx * s + lz * c);
  Q.setFromEuler(E.set(rx, yaw, rz, 'YXZ'));
  return M.compose(V, Q, SC.set(sx, sy, sz));
}

/**
 * A hip roof over w × d (eaves at y = 0, ridge height h) with UVs in metres: u along the eaves,
 * v up the slope, so tile rows run parallel to the eaves. Faces point outwards.
 */
function hipRoof(w: number, d: number, h: number): THREE.BufferGeometry {
  const alongX = w >= d;
  const L = Math.max(w, d) / 2;
  const S = Math.min(w, d) / 2;
  const r = L - S; // half the ridge length
  const P = (a: number, y: number, b: number): [number, number, number] => (alongX ? [a, y, b] : [b, y, a]);
  const slopeLen = Math.hypot(S, h);
  const pos: number[] = [];
  const uv: number[] = [];
  const tri = (p: [number, number, number][], t: [number, number][]) => {
    for (const q of p) pos.push(...q);
    for (const q of t) uv.push(...q);
  };
  // the two long faces (+b and −b): u = a, v = distance up the slope
  for (const sb of [1, -1]) {
    const e0 = P(-L, 0, sb * S);
    const e1 = P(L, 0, sb * S);
    const r0 = P(-r, h, 0);
    const r1 = P(r, h, 0);
    const t0: [number, number] = [-L, 0];
    const t1: [number, number] = [L, 0];
    const tr0: [number, number] = [-r, slopeLen];
    const tr1: [number, number] = [r, slopeLen];
    if (sb > 0) {
      tri([e0, e1, r1], [t0, t1, tr1]);
      tri([e0, r1, r0], [t0, tr1, tr0]);
    } else {
      tri([e1, e0, r0], [t1, t0, tr0]);
      tri([e1, r0, r1], [t1, tr0, tr1]);
    }
  }
  // the hip ends
  const hipLen = Math.hypot(S, h);
  for (const sa of [1, -1]) {
    const e0 = P(sa * L, 0, -S);
    const e1 = P(sa * L, 0, S);
    const rr = P(sa * r, h, 0);
    if (sa > 0) tri([e0, rr, e1], [[-S, 0], [0, hipLen], [S, 0]]);
    else tri([e1, rr, e0], [[S, 0], [0, hipLen], [-S, 0]]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  // make sure every face points outwards / up
  const pa = g.getAttribute('position');
  const na = g.getAttribute('normal');
  for (let i = 0; i < pa.count; i += 3) {
    const cx = (pa.getX(i) + pa.getX(i + 1) + pa.getX(i + 2)) / 3;
    const cz = (pa.getZ(i) + pa.getZ(i + 1) + pa.getZ(i + 2)) / 3;
    if (na.getX(i) * cx + na.getZ(i) * cz + na.getY(i) * 0.05 < 0) {
      for (const arr of [pa, na, g.getAttribute('uv')]) {
        const sz = arr.itemSize;
        const tmp: number[] = [];
        for (let k = 0; k < sz; k++) tmp.push(arr.getComponent(i + 1, k));
        for (let k = 0; k < sz; k++) arr.setComponent(i + 1, k, arr.getComponent(i + 2, k));
        for (let k = 0; k < sz; k++) arr.setComponent(i + 2, k, tmp[k]);
      }
    }
  }
  g.computeVertexNormals();
  return g;
}

/** A gable roof (two slopes, open ends filled by the walls), UVs like the hip roof. */
function gableRoof(w: number, d: number, h: number): THREE.BufferGeometry {
  const hw = w / 2;
  const hd = d / 2;
  const sl = Math.hypot(hd, h);
  const pos = [
    -hw, 0, hd, hw, 0, hd, hw, h, 0, -hw, 0, hd, hw, h, 0, -hw, h, 0,
    hw, 0, -hd, -hw, 0, -hd, -hw, h, 0, hw, 0, -hd, -hw, h, 0, hw, h, 0,
  ];
  const uv = [-hw, 0, hw, 0, hw, sl, -hw, 0, hw, sl, -hw, sl, hw, 0, -hw, 0, -hw, sl, hw, 0, -hw, sl, hw, sl];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** a triangular gable end wall (for the hut) */
function gableEnd(w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2, 0, 0, w / 2, 0, 0, 0, h, 0], 3));
  g.computeVertexNormals();
  return g;
}

export interface Landmarks {
  update(dt: number, time: number, night: number): void;
  setQuality(q: Quality): void;
  /** triangles in the landmarks (for the per-zone report) */
  tris: number;
}

export function buildLandmarks(ctx: DressingContext): Landmarks {
  const { scene, world } = ctx;
  const F = world.field!;
  const gy = (x: number, z: number) => F.at(x, z);
  const rand = rng(4321);
  const S = world.samples;
  const N = S.length;
  const edge = world.roadBand - 0.6;

  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = (seg = 12) => new THREE.CylinderGeometry(1, 1, 1, seg);
  const cyl12 = cyl(12);
  const cyl8 = cyl(8);
  const cone4 = new THREE.ConeGeometry(1, 1, 4);

  // materials (one draw call each)
  const T = {
    tile: tileTex(),
    tileGreen: copperTex(),
    timber: timberTex(true),
    timberLight: timberTex(false),
    plaster: plasterTex(),
    stone: stoneTex(),
    concrete: concreteTex(),
    shoji: shojiTex(),
    logs: logTex(),
    metal: metalRoofTex(),
    ice: iceTex(),
  };
  const std = (map: THREE.Texture, rough = 0.85, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: rough, metalness: 0, ...extra });
  const B = {
    tile: new TexBucket(),
    copper: new TexBucket(),
    timber: new TexBucket(),
    timberLight: new TexBucket(),
    plaster: new TexBucket(),
    stone: new TexBucket(),
    concrete: new TexBucket(),
    logs: new TexBucket(),
    metal: new TexBucket(),
    paint: new TexBucket(), // painted metal and vermilion lacquer (no texture: vertex colour)
    glow: new TexBucket(), // paper windows (emissive at night)
    lantern: new TexBucket(), // lantern fire boxes (lit at night)
    iceWater: new TexBucket(), // the waterfall when it isn't frozen solid
  };
  const W = {
    snow: new TexBucket(), // the winter layer: snow on roofs, banks, drifts, cornices
    ice: new TexBucket(), // icicles, the frozen stream, the solid waterfall
  };
  // (the flowing water over the half-frozen fall has its own copy of the ice, so only it moves)
  const flowTex = T.ice.clone();
  flowTex.needsUpdate = true;
  const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  blank.needsUpdate = true;
  const MAT = {
    tile: std(T.tile, 0.62),
    copper: std(T.tileGreen, 0.55, { metalness: 0.35 }),
    timber: std(T.timber, 0.88),
    timberLight: std(T.timberLight, 0.85),
    plaster: std(T.plaster, 0.92),
    stone: std(T.stone, 0.9),
    concrete: std(T.concrete, 0.92),
    logs: std(T.logs, 0.9),
    metal: std(T.metal, 0.5, { metalness: 0.45 }),
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 }),
    glow: new THREE.MeshStandardMaterial({ map: T.shoji, vertexColors: true, emissive: 0xffb062, emissiveMap: T.shoji, emissiveIntensity: 1.4, roughness: 0.9 }),
    lantern: new THREE.MeshStandardMaterial({ map: T.shoji, vertexColors: true, emissive: 0xffa04a, emissiveMap: T.shoji, emissiveIntensity: 1, roughness: 0.9 }),
    iceWater: new THREE.MeshStandardMaterial({ map: flowTex, color: 0xbfd8e6, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.85 }),
    snow: new THREE.MeshStandardMaterial({ map: blank, vertexColors: true, color: 0xf2f5fa, roughness: 0.68, metalness: 0 }),
    ice: new THREE.MeshStandardMaterial({ map: T.ice, vertexColors: true, roughness: 0.2, metalness: 0.05, transparent: true, opacity: 0.92 }),
  };
  ctx.windows.push(MAT.glow);
  ctx.floods.push(MAT.lantern);
  const updaters: ((dt: number, time: number, night: number) => void)[] = [];
  const smoke: { x: number; y: number; z: number }[] = [];
  const roofSnow = (g: THREE.BufferGeometry, m: THREE.Matrix4, lift = 0.22) => {
    // the same roof, a little bigger and lifted: a blanket of snow with a soft rounded edge
    const mm = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, lift, 0)).multiply(new THREE.Matrix4().makeScale(1.03, 1.18, 1.03));
    W.snow.add(g, mm, 0xffffff, 3);
  };
  /** icicles hanging along a line (world points), only in the Snow weather */
  const icicles = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, every = 0.45) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.floor(L / every);
    for (let i = 0; i <= n; i++) {
      if (rand() < 0.3) continue;
      const t = i / Math.max(1, n);
      const len = 0.15 + Math.pow(rand(), 2) * 0.75;
      const g = new THREE.ConeGeometry(0.035 + rand() * 0.03, len, 5);
      g.rotateX(Math.PI);
      W.ice.add(g, at(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - len / 2, z0 + (z1 - z0) * t, rand() * 6), 0xffffff, 1);
    }
  };
  /** world-space point of a local offset (lx, lz) from (x, z) turned by yaw */
  const wp = (x: number, z: number, yaw: number, lx: number, lz: number) => ({ x: x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z: z - lx * Math.sin(yaw) + lz * Math.cos(yaw) });

  // ── The village houses ──────────────────────────────────────────────────────
  const shrine = world.decor.find((d) => d.kind === 'shrine');
  for (const b of world.buildings) {
    if (b.kind !== 'hut') continue;
    if (shrine && Math.hypot(shrine.x - b.x, shrine.z - b.z) < 4) continue;
    const { x, z, yaw, w, d } = b;
    const corners = [gy(x - w / 2, z - d / 2), gy(x + w / 2, z - d / 2), gy(x - w / 2, z + d / 2), gy(x + w / 2, z + d / 2), gy(x, z)];
    const y0 = Math.min(...corners);
    const yTop = Math.max(...corners);
    const found = yTop - y0 + 0.55;
    const two = b.h > 7.5;
    const wallH = two ? 5.7 : 3.3;
    const base = y0 - 0.3;
    const fy = base + found;
    const tint = 0.88 + rand() * 0.2;
    // stone footing, dark boarding below, lime plaster above, posts and beams over it
    B.stone.add(box, at(x, base + found / 2, z, yaw, 0, 0, 0, w + 0.5, found, d + 0.5), 0xffffff, 1.6);
    B.timber.add(box, at(x, fy + 0.55, z, yaw, 0, 0, 0, w + 0.06, 1.1, d + 0.06), new THREE.Color(tint, tint, tint), 2.4);
    B.plaster.add(box, at(x, fy + wallH / 2, z, yaw, 0, 0, 0, w, wallH, d), 0xffffff, 3);
    const postEvery = 1.8;
    for (const [lw, ld, alongX] of [
      [w, d, true],
      [d, w, false],
    ] as [number, number, boolean][]) {
      const n = Math.max(2, Math.round(lw / postEvery));
      for (let k = 0; k <= n; k++) {
        const a = -lw / 2 + (k * lw) / n;
        for (const sd of [-1, 1]) {
          const lx = alongX ? a : (sd * w) / 2;
          const lz = alongX ? (sd * d) / 2 : a;
          B.timber.add(box, at(x, fy + wallH / 2, z, yaw, lx, 0, lz, 0.2, wallH, 0.2), 0xffffff, 2.4);
        }
      }
      void ld;
    }
    for (const yy of [1.1, wallH - 0.15, ...(two ? [2.85] : [])]) B.timber.add(box, at(x, fy + yy, z, yaw, 0, 0, 0, w + 0.12, 0.22, d + 0.12), 0xffffff, 2.4);
    // paper windows (and a timber lattice over some of the ground-floor ones)
    for (const side of [-1, 1]) {
      const nwin = Math.max(1, Math.floor(w / 3.0));
      for (let k = 0; k < nwin; k++) {
        if (rand() < 0.22) continue;
        const lx = (k - (nwin - 1) / 2) * 2.9;
        B.glow.add(box, at(x, fy + 1.95, z, yaw, lx, 0, (side * d) / 2 + side * 0.02, 1.5, 1.1, 0.06), 0xffffff, 1.2);
        if (rand() < 0.55) for (let bar = -3; bar <= 3; bar++) B.timber.add(box, at(x, fy + 1.95, z, yaw, lx + bar * 0.21, 0, (side * d) / 2 + side * 0.09, 0.05, 1.2, 0.05), 0xffffff, 2.4);
        if (two && rand() < 0.75) B.glow.add(box, at(x, fy + 4.3, z, yaw, lx, 0, (side * d) / 2 + side * 0.02, 1.3, 0.9, 0.06), 0xffffff, 1.2);
      }
    }
    // the entrance: two sliding doors under a little lintel, on the side facing the road
    B.glow.add(box, at(x, fy + 1.05, z, yaw, -w * 0.18, 0, d / 2 + 0.03, 1.8, 1.9, 0.06), 0xffffff, 1.2);
    B.timber.add(box, at(x, fy + 2.15, z, yaw, -w * 0.18, 0, d / 2 + 0.12, 2.2, 0.16, 0.24), 0xffffff, 2.4);
    if (two) {
      // a pent roof round the house between the floors
      const g = hipRoof(w + 1.5, d + 1.5, 0.7);
      B.tile.add(g, at(x, fy + 2.75, z, yaw), new THREE.Color(tint, tint, tint), 2, true, 0.5);
      roofSnow(g, at(x, fy + 2.75, z, yaw), 0.12);
    }
    // the main roof: deep eaves on rafters, a timber fascia, tiles, the ridge
    const ow = w + 2.3;
    const od = d + 2.3;
    const rh = Math.min(w, d) * 0.42;
    const roof = hipRoof(ow, od, rh);
    const roofM = at(x, fy + wallH, z, yaw).clone();
    B.tile.add(roof, roofM, new THREE.Color(tint, tint, tint), 2, true, 0.5);
    roofSnow(roof, roofM);
    B.timber.add(box, at(x, fy + wallH - 0.08, z, yaw, 0, 0, 0, ow, 0.16, od), 0xffffff, 2.4); // soffit
    for (const sd of [-1, 1]) {
      B.timber.add(box, at(x, fy + wallH - 0.04, z, yaw, 0, 0, (sd * od) / 2, ow + 0.1, 0.24, 0.1), 0xffffff, 2.4); // fascia
      B.timber.add(box, at(x, fy + wallH - 0.04, z, yaw, (sd * ow) / 2, 0, 0, 0.1, 0.24, od + 0.1), 0xffffff, 2.4);
      // rafter tails under the long eaves
      for (let a = -ow / 2 + 0.3; a < ow / 2 - 0.2; a += 0.55) B.timber.add(box, at(x, fy + wallH - 0.2, z, yaw, a, 0, sd * (d / 2 + 0.6), 0.1, 0.12, 1.2), 0xffffff, 2.4);
      // icicles along the long eaves
      const p0 = wp(x, z, yaw, -ow / 2, (sd * od) / 2);
      const p1 = wp(x, z, yaw, ow / 2, (sd * od) / 2);
      icicles(p0.x, fy + wallH - 0.1, p0.z, p1.x, fy + wallH - 0.1, p1.z);
    }
    const ridgeL = Math.abs(ow - od) + 0.6;
    const along = w >= d;
    B.paint.add(box, at(x, fy + wallH + rh + 0.1, z, yaw, 0, 0, 0, along ? ridgeL : 0.45, 0.32, along ? 0.45 : ridgeL), 0x2b2f35);
    for (const e of [-1, 1]) B.paint.add(box, at(x, fy + wallH + rh + 0.25, z, yaw, along ? (e * ridgeL) / 2 : 0, 0, along ? 0 : (e * ridgeL) / 2, 0.5, 0.55, 0.5), 0x2b2f35); // end tiles
    // some houses have a stove flue, and smoke
    if (rand() < 0.45) {
      const cx = (rand() - 0.5) * w * 0.5;
      const cz = (rand() - 0.5) * d * 0.4;
      const p = wp(x, z, yaw, cx, cz);
      const top = fy + wallH + rh * 0.75 + 1.2;
      B.stone.add(box, at(p.x, top - 1.1, p.z, yaw, 0, 0, 0, 0.55, 2.2, 0.55), 0xffffff, 1.2);
      B.paint.add(box, at(p.x, top + 0.1, p.z, yaw, 0, 0, 0, 0.7, 0.12, 0.7), 0x3a3a3a);
      smoke.push({ x: p.x, y: top + 0.2, z: p.z });
    }
  }

  // ── The shrine at the pass ──────────────────────────────────────────────────
  const verm = 0xb8361e;
  if (shrine) {
    const { x, z, yaw } = shrine;
    const y0 = Math.min(gy(x - 9, z - 7), gy(x + 9, z - 7), gy(x - 9, z + 7), gy(x + 9, z + 7)) - 0.3;
    const top = Math.max(gy(x - 9, z - 7), gy(x + 9, z + 7), gy(x, z)) + 1.0;
    // a stone-faced terrace where the ground is high, and on the low side a timber stage on posts
    // (kakezukuri, as mountain shrines are built out over a slope)
    B.stone.add(box, at(x, top - 0.6, z, yaw, 0, 0, 0, 19, 1.2, 15), 0xffffff, 1.4);
    for (let ix = -4; ix <= 4; ix++)
      for (let iz = -3; iz <= 3; iz++) {
        const p = wp(x, z, yaw, ix * 2.3, iz * 2.3);
        const g = gy(p.x, p.z) - 0.2;
        const h = top - 1.2 - g;
        if (h < 0.4) continue;
        B.timber.add(box, at(p.x, g + h / 2, p.z, yaw, 0, 0, 0, 0.42, h, 0.42), 0xffffff, 2.4);
        // tie beams through the posts every 2.5 m of height
        for (let t = 2.5; t < h - 0.5; t += 2.5) {
          if (ix < 4) B.timberLight.add(box, at(p.x, g + t, p.z, yaw, 1.15, 0, 0, 2.3, 0.22, 0.16), 0xffffff, 2.4);
          if (iz < 3) B.timberLight.add(box, at(p.x, g + t, p.z, yaw, 0, 0, 1.15, 0.16, 0.22, 2.3), 0xffffff, 2.4);
        }
        B.stone.add(box, at(p.x, g + 0.1, p.z, yaw, 0, 0, 0, 0.8, 0.4, 0.8), 0xffffff, 1);
      }
    void y0;
    for (let k = 0; k < 5; k++) B.stone.add(box, at(x, top - 0.2 - k * 0.22, z, yaw, 0, 0, 7.6 + k * 0.45, 4.4, 0.24, 0.6), 0xffffff, 1.4); // steps
    const fy = top;
    B.timber.add(box, at(x, fy + 0.45, z, yaw, 0, 0, 0, 16.5, 0.9, 12.5), 0xffffff, 2.4); // raised floor
    for (let ix = -2; ix <= 2; ix++)
      for (const iz of [-1, 1]) B.timber.add(cyl12, at(x, fy + 3.2, z, yaw, ix * 3.8, 0, iz * 5.6, 0.3, 5.6, 0.3), 0xffffff, 2.4); // dark timber posts
    B.timber.add(box, at(x, fy + 3.2, z, yaw, 0, 0, -0.4, 14.6, 5.0, 10), 0xffffff, 2.4); // walls: dark boards
    for (const yy of [1.4, 4.6, 5.75]) B.timberLight.add(box, at(x, fy + yy, z, yaw, 0, 0, 0, 16.2, 0.32, 12), 0xffffff, 2.4); // beams
    // the copper roof, deep and swept, with a ridge
    const roof = hipRoof(22, 17.5, 5.4);
    const rm = at(x, fy + 6.0, z, yaw).clone();
    B.copper.add(roof, rm, 0xffffff, 2, true, 0.35);
    roofSnow(roof, rm, 0.25);
    B.copper.add(box, at(x, fy + 11.5, z, yaw, 0, 0, 0, 5.2, 0.55, 0.8), 0xffffff, 1);
    for (const e of [-2.4, 2.4]) B.paint.add(box, at(x, fy + 12.1, z, yaw, e, 0, 0, 0.16, 1.3, 0.85, 0, e > 0 ? 0.5 : -0.5), 0x9c7a34); // gilded ridge ornaments
    for (const sd of [-1, 1]) {
      const p0 = wp(x, z, yaw, -11, sd * 8.75);
      const p1 = wp(x, z, yaw, 11, sd * 8.75);
      icicles(p0.x, fy + 6.0, p0.z, p1.x, fy + 6.0, p1.z, 0.35);
    }
    B.timber.add(box, at(x, fy + 1.3, z, yaw, 0, 0, 6.6, 2.4, 1.1, 1.0), 0xffffff, 1.2); // offering box
    // the sacred rope, thick and twisted, with paper streamers
    const rope = new THREE.TorusGeometry(4.2, 0.2, 8, 24, Math.PI * 0.82);
    rope.rotateZ(Math.PI * 1.09);
    B.paint.add(rope, at(x, fy + 8.8, z, yaw, 0, 0, 6.3), 0xcdb98a);
    for (let k = -3; k <= 3; k += 2) B.paint.add(box, at(x, fy + 4.6, z, yaw, k, 0, 6.32, 0.25, 0.6, 0.02), 0xf5f2ea);
  }

  // ── The weathered stone torii, half buried, and the prayer stones ───────────
  for (const d of world.decor) {
    if (d.kind === 'stonetorii') {
      const y = gy(d.x, d.z);
      const H = 4.2;
      for (const e of [-2.1, 2.1]) {
        const p = wp(d.x, d.z, d.yaw, e, 0);
        B.stone.add(cyl12, at(p.x, y + H / 2 - 0.9, p.z, d.yaw, 0, 0, 0, 0.32, H, 0.32), 0xd8d4cc, 1.2); // sunk 0.9 m into the ground
      }
      B.stone.add(box, at(d.x, y + 2.25, d.z, d.yaw, 0, 0, 0, 5.4, 0.4, 0.45), 0xd8d4cc, 1.2);
      B.stone.add(box, at(d.x, y + 3.2, d.z, d.yaw, 0, 0, 0, 6.6, 0.5, 0.7, 0, 0.04), 0xcfcac1, 1.2); // the lintel has settled askew
      W.snow.add(box, at(d.x, y + 3.52, d.z, d.yaw, 0, 0, 0, 6.5, 0.2, 0.72, 0, 0.04), 0xffffff, 2);
    } else if (d.kind === 'prayer') {
      // a little cairn of rounded stones
      let y = gy(d.x, d.z) - 0.05;
      const sc = d.s ?? 1;
      for (let k = 0; k < 3 + Math.floor(rand() * 3); k++) {
        const r = (0.32 - k * 0.05) * sc;
        const g = new THREE.SphereGeometry(1, 9, 6);
        B.stone.add(g, at(d.x + (rand() - 0.5) * 0.06, y + r * 0.6, d.z + (rand() - 0.5) * 0.06, rand() * 6, 0, 0, 0, r * 1.2, r * 0.7, r), 0xffffff, 0.8);
        y += r * 1.15;
      }
      W.snow.add(new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), at(d.x, y - 0.05, d.z, 0, 0, 0, 0, 0.16 * sc, 0.08, 0.16 * sc), 0xffffff, 1);
    }
  }

  // ── Torii over the road ─────────────────────────────────────────────────────
  for (const d of world.decor) {
    if (d.kind !== 'torii') continue;
    const sc = d.s ?? 1;
    const half = edge + 0.8;
    const hit = world.nearestTrack(d.x, d.z);
    const ry = hit ? world.samples[hit.index].y : gy(d.x, d.z);
    const H = 9.0 * sc;
    const col = new THREE.Color(verm).multiplyScalar(0.9 + rand() * 0.15);
    for (const e of [-half, half]) {
      const p = wp(d.x, d.z, d.yaw, e, 0);
      const g0 = Math.min(gy(p.x, p.z), ry) - 0.3;
      // posts taper and lean in a touch; black-lacquered feet
      const post = new THREE.CylinderGeometry(0.46, 0.56, 1, 16);
      B.paint.add(post, at(p.x, (g0 + ry + H) / 2, p.z, d.yaw, 0, 0, 0, 1, ry + H - g0, 1, 0, -Math.sign(e) * 0.025), col);
      B.paint.add(new THREE.CylinderGeometry(0.66, 0.7, 1, 16), at(p.x, g0 + (ry - g0 + 1.3) / 2, p.z, d.yaw, 0, 0, 0, 1, ry - g0 + 1.3, 1), 0x181614);
      B.stone.add(new THREE.CylinderGeometry(0.95, 1.05, 0.35, 16), at(p.x, ry + 0.05, p.z, d.yaw), 0xffffff, 1.2);
    }
    B.paint.add(box, at(d.x, ry + H - 2.2, d.z, d.yaw, 0, 0, 0, half * 2 + 2.6, 0.62, 0.42), col); // nuki
    for (const e of [-1, 1]) B.paint.add(box, at(d.x, ry + H - 2.2, d.z, d.yaw, e * (half - 0.9), 0, 0, 0.4, 0.5, 0.7), 0x181614); // wedges
    B.paint.add(box, at(d.x, ry + H - 0.05, d.z, d.yaw, 0, 0, 0, half * 2 + 3.4, 0.55, 0.75), col); // shimaki
    // kasagi: black, sweeping up towards the ends in five pieces
    const span = half * 2 + 5.0;
    for (let k = -2; k <= 2; k++) {
      const t = k / 2;
      const seg = span / 5 + 0.05;
      const lift = Math.pow(Math.abs(t), 2.2) * 0.55;
      B.paint.add(box, at(d.x, ry + H + 0.48 + lift, d.z, d.yaw, (k * span) / 5, 0, 0, seg, 0.5, 1.15, 0, -Math.sign(t) * Math.abs(t) * 0.13), 0x181614);
      W.snow.add(box, at(d.x, ry + H + 0.8 + lift, d.z, d.yaw, (k * span) / 5, 0, 0, seg, 0.18, 1.1, 0, -Math.sign(t) * Math.abs(t) * 0.13), 0xffffff, 2);
    }
    B.paint.add(box, at(d.x, ry + H - 1.15, d.z, d.yaw, 0, 0, 0, 0.45, 1.4, 0.4), col); // centre strut
    B.paint.add(box, at(d.x, ry + H - 1.15, d.z, d.yaw, 0, 0, 0.0, 1.5, 1.5, 0.55), 0x1d1a18); // plaque
  }

  // ── Stone lanterns ──────────────────────────────────────────────────────────
  for (const d of world.decor) {
    if (d.kind !== 'lantern') continue;
    const y = gy(d.x, d.z);
    const hex = (r: number, h: number) => new THREE.CylinderGeometry(r, r, h, 6);
    B.stone.add(hex(0.5, 0.28), at(d.x, y + 0.14, d.z, d.yaw), 0xffffff, 0.8);
    B.stone.add(hex(0.38, 0.12), at(d.x, y + 0.34, d.z, d.yaw), 0xffffff, 0.8);
    B.stone.add(new THREE.CylinderGeometry(0.13, 0.16, 0.95, 10), at(d.x, y + 0.87, d.z, d.yaw), 0xffffff, 0.8);
    B.stone.add(hex(0.42, 0.16), at(d.x, y + 1.4, d.z, d.yaw), 0xffffff, 0.8);
    B.lantern.add(hex(0.27, 0.42), at(d.x, y + 1.69, d.z, d.yaw), 0xffffff, 0.5);
    for (let k = 0; k < 6; k++) B.stone.add(box, at(d.x, y + 1.69, d.z, d.yaw + (k * Math.PI) / 3, 0.28, 0, 0, 0.06, 0.44, 0.08), 0xffffff, 0.8);
    const roof = new THREE.ConeGeometry(0.66, 0.42, 6);
    B.stone.add(roof, at(d.x, y + 2.11, d.z, d.yaw), 0xffffff, 0.8);
    for (let k = 0; k < 6; k++) B.stone.add(box, at(d.x, y + 1.95, d.z, d.yaw + (k * Math.PI) / 3 + Math.PI / 6, 0.62, 0.06, 0, 0.12, 0.1, 0.14, 0, 0.45), 0xffffff, 0.8); // curled corners
    B.stone.add(new THREE.SphereGeometry(0.1, 8, 6), at(d.x, y + 2.42, d.z, d.yaw), 0xffffff, 0.8);
    W.snow.add(new THREE.ConeGeometry(0.62, 0.22, 6), at(d.x, y + 2.3, d.z, d.yaw), 0xffffff, 1);
  }

  // ── The pull-out, the mountain hut, the pass sign and the snow plough ───────
  for (const d of world.decor) {
    if (d.kind === 'pullout') {
      // a paved lay-by: a slab following the land, the road's own grey
      const L = d.s ?? 26;
      const g = new THREE.PlaneGeometry(L, 10, 10, 4);
      g.rotateX(-Math.PI / 2);
      const pa = g.getAttribute('position');
      const c = Math.cos(d.yaw);
      const s = Math.sin(d.yaw);
      for (let i = 0; i < pa.count; i++) {
        // local x along the road (the yaw), local z away from it
        const lx = pa.getX(i);
        const lz = pa.getZ(i);
        const px = d.x + lz * c + lx * s;
        const pz = d.z - lz * s + lx * c;
        pa.setXYZ(i, px, gy(px, pz) + 0.06, pz);
      }
      g.computeVertexNormals();
      B.concrete.add(g, new THREE.Matrix4(), 0x8b8b88, 3);
    } else if (d.kind === 'hut') {
      // a small log cabin: stone base, log walls, a steep red tin roof, a stove pipe smoking
      const y = gy(d.x, d.z);
      const w = 7.2;
      const dd = 5.6;
      const wallH = 2.7;
      B.stone.add(box, at(d.x, y + 0.2, d.z, d.yaw, 0, 0, 0, w + 0.4, 0.9, dd + 0.4), 0xffffff, 1.2);
      B.logs.add(box, at(d.x, y + 0.6 + wallH / 2, d.z, d.yaw, 0, 0, 0, w, wallH, dd), 0xffffff, 2.2);
      for (const sd of [-1, 1]) B.logs.add(gableEnd(dd, 2.4), at(d.x, y + 0.6 + wallH, d.z, d.yaw + Math.PI / 2, 0, 0, (sd * w) / 2), 0xffffff, 2.2);
      for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.logs.add(box, at(d.x, y + 0.6 + wallH / 2, d.z, d.yaw, (cx * w) / 2, 0, (cz * dd) / 2, 0.3, wallH + 0.2, 0.3), 0xffffff, 2.2);
      const roof = gableRoof(w + 1.4, dd + 1.6, 2.5);
      const rm = at(d.x, y + 0.6 + wallH, d.z, d.yaw).clone();
      B.metal.add(roof, rm, 0xffffff, 2, true, 0.6);
      roofSnow(roof, rm, 0.2);
      B.timber.add(box, at(d.x, y + 1.6, d.z, d.yaw, 1.4, 0, dd / 2 + 0.04, 1.0, 1.95, 0.08), 0xffffff, 2); // door
      B.glow.add(box, at(d.x, y + 2.0, d.z, d.yaw, -1.6, 0, dd / 2 + 0.04, 1.1, 0.8, 0.06), 0xffffff, 1);
      B.glow.add(box, at(d.x, y + 2.0, d.z, d.yaw, w / 2 + 0.04, 0, 0, 0.06, 0.8, 1.1), 0xffffff, 1);
      const pipe = wp(d.x, d.z, d.yaw, -2.2, -0.8);
      B.paint.add(cyl8, at(pipe.x, y + 0.6 + wallH + 2.4, pipe.z, d.yaw, 0, 0, 0, 0.14, 2.0, 0.14), 0x2a2a2a);
      smoke.push({ x: pipe.x, y: y + 0.6 + wallH + 3.4, z: pipe.z });
      // a woodpile against the wall, under its own little roof
      for (let k = 0; k < 18; k++) {
        const lp = wp(d.x, d.z, d.yaw, -w / 2 - 0.55, -1.8 + (k % 6) * 0.42);
        B.timberLight.add(cyl8, at(lp.x, y + 0.2 + Math.floor(k / 6) * 0.36, lp.z, d.yaw, 0, 0, 0, 0.17, 0.9, 0.17, 0, Math.PI / 2), 0xd6b48a, 1);
      }
      for (const sd of [-1, 1]) {
        const p0 = wp(d.x, d.z, d.yaw, -(w + 1.4) / 2, (sd * (dd + 1.6)) / 2);
        const p1 = wp(d.x, d.z, d.yaw, (w + 1.4) / 2, (sd * (dd + 1.6)) / 2);
        icicles(p0.x, y + 0.6 + wallH - 0.05, p0.z, p1.x, y + 0.6 + wallH - 0.05, p1.z, 0.35);
      }
    } else if (d.kind === 'passsign') {
      const y = gy(d.x, d.z);
      for (const e of [-1.5, 1.5]) {
        const p = wp(d.x, d.z, d.yaw, e, 0);
        B.paint.add(cyl8, at(p.x, y + 1.4, p.z, d.yaw, 0, 0, 0, 0.07, 2.8, 0.07), 0x6d7177);
      }
      B.paint.add(box, at(d.x, y + 2.2, d.z, d.yaw, 0, 0, -0.04, 3.7, 1.9, 0.06), 0x123f2d);
      W.snow.add(box, at(d.x, y + 3.2, d.z, d.yaw, 0, 0, -0.04, 3.7, 0.14, 0.14), 0xffffff, 2);
    } else if (d.kind === 'plough') {
      const y = gy(d.x, d.z);
      const orange = 0xe0761c;
      // chassis, cab, the dump body with the salt spreader, the blade, wheels, beacon
      B.paint.add(box, at(d.x, y + 0.95, d.z, d.yaw, 0, 0, 0, 2.4, 0.4, 8.2), 0x1c1c1e);
      B.paint.add(box, at(d.x, y + 2.05, d.z, d.yaw, 0, 0, 2.55, 2.45, 1.9, 2.1), orange);
      B.paint.add(box, at(d.x, y + 2.35, d.z, d.yaw, 0, 0, 3.62, 2.25, 0.85, 0.05), 0x1a242c); // windscreen
      B.paint.add(box, at(d.x, y + 1.95, d.z, d.yaw, 0, 0, -1.2, 2.5, 1.6, 5.0), 0x5b5f64); // body
      B.paint.add(box, at(d.x, y + 1.0, d.z, d.yaw, 0, 0, -3.9, 1.6, 0.8, 0.9), 0x3a3d40); // spreader
      for (let k = -2; k <= 2; k++) B.paint.add(box, at(d.x, y + 0.75, d.z, d.yaw + 0.42, k * 0.62, 0, 4.85 + k * 0.27, 0.66, 1.1, 0.14, -0.2, 0), 0xf0a21a); // angled blade
      for (const [wx, wz] of [[-1.05, 2.6], [1.05, 2.6], [-1.05, -1.4], [1.05, -1.4], [-1.05, -2.7], [1.05, -2.7]]) {
        const tyre = new THREE.CylinderGeometry(0.55, 0.55, 0.45, 16);
        tyre.rotateZ(Math.PI / 2);
        B.paint.add(tyre, at(d.x, y + 0.55, d.z, d.yaw, wx, 0, wz), 0x151516);
      }
      B.lantern.add(box, at(d.x, y + 3.1, d.z, d.yaw, 0, 0, 2.6, 0.9, 0.18, 0.25), 0xffb020, 0.5); // amber light bar
      W.snow.add(box, at(d.x, y + 3.05, d.z, d.yaw, 0, 0, 2.5, 2.3, 0.15, 1.8), 0xffffff, 2);
      W.snow.add(box, at(d.x, y + 2.82, d.z, d.yaw, 0, 0, -1.2, 2.4, 0.18, 4.8), 0xffffff, 2);
    }
  }

  // ── The avalanche gallery and the rock shelter ──────────────────────────────
  for (const sp of world.spans) {
    if (sp.kind === 'bridge') continue;
    const gallery = sp.kind === 'gallery';
    const len = (sp.i1 - sp.i0 + N) % N;
    const roofH = gallery ? 6.6 : 6.2;
    const hill = sp.side;
    const outer = edge + 0.7; // the pillar line on the open side
    const inner = edge + (gallery ? 1.6 : 1.0); // the back wall on the hill side
    // roof slab: a strip from beyond the pillars, over the road, into the hill
    const rows: number[] = [];
    const rv: number[] = [];
    const ri: number[] = [];
    const prof = [-(outer + 0.9), -(outer + 0.9), inner + 6, inner + 6];
    const ph = [roofH - 0.7, roofH, roofH + 0.6, roofH - 0.9];
    for (let k = 0; k <= len; k++) {
      const s = S[(sp.i0 + k) % N];
      for (let c = 0; c < 4; c++) {
        const off = prof[c] * hill;
        rv.push(s.x + s.nx * off, s.y + ph[c], s.z + s.nz * off);
      }
      rows.push(k);
      if (k < len) {
        const a = k * 4;
        for (let c = 0; c < 3; c++) ri.push(a + c, a + c + 4, a + c + 1, a + c + 1, a + c + 4, a + c + 5);
      }
    }
    const roofG = new THREE.BufferGeometry();
    roofG.setAttribute('position', new THREE.Float32BufferAttribute(rv, 3));
    roofG.setIndex(ri);
    roofG.computeVertexNormals();
    const roofGeo = roofG.toNonIndexed();
    // make the slab double-sided by adding its underside
    const under = roofGeo.clone();
    {
      const pa = under.getAttribute('position');
      for (let i = 0; i < pa.count; i += 3) {
        const x = pa.getX(i + 1);
        const y = pa.getY(i + 1);
        const z = pa.getZ(i + 1);
        pa.setXYZ(i + 1, pa.getX(i + 2), pa.getY(i + 2) - 0.02, pa.getZ(i + 2));
        pa.setXYZ(i + 2, x, y - 0.02, z);
      }
      under.computeVertexNormals();
    }
    const one = new THREE.Matrix4();
    if (gallery) {
      B.concrete.add(roofGeo, one, 0xffffff, 3);
      B.concrete.add(under, one, 0xb9b6b0, 3);
    } else {
      B.stone.add(roofGeo, one, 0x5d5a55, 4);
      B.stone.add(under, one, 0x4b4945, 4);
    }
    // snow on top (Snow weather), else a layer of earth and grass on the gallery
    {
      const top = roofGeo.clone();
      top.translate(0, 0.25, 0);
      W.snow.add(top, one, 0xffffff, 4);
    }
    // pillars on the open side, a beam along them, and the back wall
    for (let k = 0; k <= len; k += 3) {
      const s = S[(sp.i0 + k) % N];
      const px = s.x - s.nx * outer * hill;
      const pz = s.z - s.nz * outer * hill;
      const g0 = Math.min(gy(px, pz), s.y) - 1.5;
      if (gallery) B.concrete.add(box, at(px, (g0 + s.y + roofH) / 2, pz, Math.atan2(s.tx, s.tz), 0, 0, 0, 0.75, s.y + roofH - g0, 0.75), 0xffffff, 3);
      else B.concrete.add(box, at(px, (g0 + s.y + roofH) / 2, pz, Math.atan2(s.tx, s.tz), 0, 0, 0, 0.8, s.y + roofH - g0, 0.8), 0x9a958c, 3);
      const wx = s.x + s.nx * inner * hill;
      const wz = s.z + s.nz * inner * hill;
      if (k < len) {
        const s2 = S[(sp.i0 + Math.min(len, k + 3)) % N];
        const L = Math.hypot(s2.x - s.x, s2.z - s.z) + 0.05;
        const mx = (s.x + s2.x) / 2;
        const mz = (s.z + s2.z) / 2;
        const yaw = Math.atan2(s.tx, s.tz);
        if (gallery) {
          B.concrete.add(box, at(mx + s.nx * inner * hill, s.y + roofH / 2 - 0.2, mz + s.nz * inner * hill, yaw, 0, 0, 0, 0.5, roofH + 0.4, L), 0xc9c6bf, 3);
          // a strip light under the roof every other bay
          if ((k / 3) % 2 === 0) B.lantern.add(box, at(mx, s.y + roofH - 0.75, mz, yaw, 0, 0, 0, 0.18, 0.06, 1.4), 0xfff0d0, 0.5);
        }
        B.concrete.add(box, at(mx - s.nx * outer * hill, s.y + roofH - 0.95, mz - s.nz * outer * hill, yaw, 0, 0, 0, 0.8, 0.6, L), gallery ? 0xffffff : 0x9a958c, 3);
      }
      void wx;
      void wz;
      // icicles along the open edge of the roof
      if (k < len) {
        const s2 = S[(sp.i0 + Math.min(len, k + 3)) % N];
        icicles(s.x - s.nx * (outer + 0.9) * hill, s.y + roofH - 0.7, s.z - s.nz * (outer + 0.9) * hill, s2.x - s2.nx * (outer + 0.9) * hill, s2.y + roofH - 0.7, s2.z - s2.nz * (outer + 0.9) * hill, 0.5);
      }
    }
  }

  // ── The village bridge: stone parapets and abutments over the stream ────────
  for (const sp of world.spans) {
    if (sp.kind !== 'bridge') continue;
    const len = (sp.i1 - sp.i0 + N) % N;
    for (const sd of [-1, 1]) {
      for (let k = 0; k < len; k++) {
        const a = S[(sp.i0 + k) % N];
        const b = S[(sp.i0 + k + 1) % N];
        const off = (edge + 0.4) * sd;
        const mx = (a.x + b.x) / 2 + a.nx * off;
        const mz = (a.z + b.z) / 2 + a.nz * off;
        const L = Math.hypot(b.x - a.x, b.z - a.z) + 0.02;
        const yaw = Math.atan2(a.tx, a.tz);
        B.stone.add(box, at(mx, a.y + 0.45, mz, yaw, 0, 0, 0, 0.5, 1.1, L), 0xffffff, 1);
        B.stone.add(box, at(mx, a.y + 1.04, mz, yaw, 0, 0, 0, 0.62, 0.1, L), 0xbdb8ae, 1); // coping
        W.snow.add(box, at(mx, a.y + 1.15, mz, yaw, 0, 0, 0, 0.6, 0.14, L), 0xffffff, 2);
      }
      for (const end of [sp.i0, sp.i1]) {
        const s = S[end];
        const p = { x: s.x + s.nx * (edge + 0.4) * sd, z: s.z + s.nz * (edge + 0.4) * sd };
        B.stone.add(box, at(p.x, s.y + 0.65, p.z, Math.atan2(s.tx, s.tz), 0, 0, 0, 0.8, 1.5, 0.8), 0xd0ccc3, 1); // end posts
        B.stone.add(new THREE.SphereGeometry(0.32, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), at(p.x, s.y + 1.4, p.z, 0), 0xd0ccc3, 1);
      }
    }
  }

  // ── The stream: water in most weathers, ice in the Snow weather ─────────────
  const streamWater: THREE.Mesh[] = [];
  for (const st of world.streams) {
    const pts = st.pts.filter((p) => {
      const h = world.nearestTrack(p.x, p.z);
      return !h || Math.abs(h.offset) > edge + 0.6;
    });
    // two ribbons (one each side of the road), each made of the consecutive points
    const runs: { x: number; z: number }[][] = [];
    let cur: { x: number; z: number }[] = [];
    for (let i = 0; i < pts.length; i++) {
      if (i > 0 && Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) > 5) {
        if (cur.length > 1) runs.push(cur);
        cur = [];
      }
      cur.push(pts[i]);
    }
    if (cur.length > 1) runs.push(cur);
    for (const run of runs) {
      const v: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      let dist = 0;
      run.forEach((p, i) => {
        const a = run[Math.max(0, i - 1)];
        const b = run[Math.min(run.length - 1, i + 1)];
        const tx = b.x - a.x;
        const tz = b.z - a.z;
        const l = Math.hypot(tx, tz) || 1;
        const nx = tz / l;
        const nz = -tx / l;
        const w = 1.6 + Math.sin(i * 0.7) * 0.4;
        if (i > 0) dist += Math.hypot(p.x - run[i - 1].x, p.z - run[i - 1].z);
        for (const e of [-w, w]) {
          const x = p.x + nx * e;
          const z = p.z + nz * e;
          v.push(x, gy(x, z) + 0.07, z);
          uv.push(e / 3, dist / 3);
        }
        // stones along the banks
        if (rand() < 0.25) B.stone.add(new THREE.SphereGeometry(1, 7, 5), at(p.x + nx * (w + 0.3) * (rand() < 0.5 ? 1 : -1), gy(p.x, p.z) + 0.05, p.z + nz * (w + 0.3), rand() * 6, 0, 0, 0, 0.35 + rand() * 0.4, 0.22, 0.3 + rand() * 0.3), 0xffffff, 0.8);
        if (i < run.length - 1) {
          const a0 = i * 2;
          idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const water = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x1d3a44, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.9 }));
      water.name = 'stream';
      water.receiveShadow = true;
      water.renderOrder = 3;
      scene.add(water);
      streamWater.push(water);
      const iceG = g.clone();
      iceG.translate(0, 0.03, 0);
      W.ice.add(iceG, new THREE.Matrix4(), 0xe6f0f6, 3, true);
    }
  }

  // ── The frozen waterfall on the cliff face ──────────────────────────────────
  for (const f of world.falls) {
    const y0 = gy(f.x, f.z);
    const hit = world.nearestTrack(f.x, f.z);
    const ry = hit ? S[hit.index].y : y0;
    // it hangs down the rock face: a curtain of ice columns, wider at the foot, leaning back
    // with the face (which stands near-vertical for its first 6 m out from the road)
    const H = Math.min(26, f.top * 0.45);
    const n = 15;
    const wFall = Math.max(f.w, 9);
    for (let k = 0; k < n; k++) {
      const t0 = k / (n - 1);
      const lx = (t0 - 0.5) * wFall;
      const h = H * (0.5 + 0.5 * Math.sin(t0 * Math.PI)) * (0.85 + rand() * 0.15);
      const r = 0.75 + rand() * 0.7;
      const g = new THREE.CylinderGeometry(r * 0.45, r * 1.25, h, 8, 8);
      const pa = g.getAttribute('position');
      for (let i = 0; i < pa.count; i++) {
        const t = (pa.getY(i) + h / 2) / h;
        // flatten against the face, lean back as it rises, bulge where the ice flowed over a ledge
        pa.setZ(i, pa.getZ(i) * 0.55 + t * 3.8 + Math.sin(t * 9 + k) * 0.25);
        pa.setX(i, pa.getX(i) * (1 + 0.25 * Math.sin(t * 7 + k * 2)));
      }
      g.computeVertexNormals();
      const m = at(f.x, ry + h / 2 - 0.3, f.z, f.yaw + Math.PI, lx, 0, 0.6);
      W.ice.add(g, m, 0xffffff, 3);
      B.iceWater.add(g, m, 0xffffff, 3);
    }
    W.ice.add(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), at(f.x, ry - 0.2, f.z, f.yaw, 0, 0, 0, Math.max(f.w, 9) * 0.65, 1.4, 2.0), 0xffffff, 3);
  }

  // ── Snow fences and avalanche marker poles ──────────────────────────────────
  for (const d of world.decor) {
    if (d.kind === 'fence') {
      const L = d.s ?? 20;
      const n = Math.round(L / 2.5);
      for (let k = 0; k <= n; k++) {
        const p = wp(d.x, d.z, d.yaw, 0, -L / 2 + (k * L) / n);
        const y = gy(p.x, p.z);
        B.timberLight.add(box, at(p.x, y + 1.05, p.z, d.yaw, 0, 0, 0, 0.12, 2.6, 0.12), 0xffffff, 1.2);
        if (k < n) {
          const q = wp(d.x, d.z, d.yaw, 0, -L / 2 + ((k + 0.5) * L) / n);
          const yq = gy(q.x, q.z);
          for (let r = 0; r < 6; r++) B.timberLight.add(box, at(q.x, yq + 0.45 + r * 0.32, q.z, d.yaw, 0.08, 0, 0, 0.03, 0.14, L / n + 0.1), 0xd8c9b0, 1.2);
          // the drift piled against it (half buries it in the Snow weather)
          W.snow.add(new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), at(q.x, yq - 0.1, q.z, d.yaw, -0.6, 0, 0, 1.7, 1.1, L / n * 0.75), 0xffffff, 3);
        }
      }
    } else if (d.kind === 'avpole') {
      const y = gy(d.x, d.z);
      B.paint.add(cyl8, at(d.x, y + 2.0, d.z, d.yaw, 0, 0, 0, 0.045, 4.2, 0.045), 0xf0c419);
      for (let k = 0; k < 4; k++) B.paint.add(cyl8, at(d.x, y + 0.6 + k * 1.0, d.z, d.yaw, 0, 0, 0, 0.05, 0.4, 0.05), 0x151515);
      B.paint.add(box, at(d.x, y + 3.9, d.z, d.yaw, 0.18, 0, 0, 0.36, 0.24, 0.01), 0xe24a12);
    }
  }

  // ── The winter layer along the road: plough banks, and cornices on the ridge ─
  {
    // banks: thrown up by the plough along both edges, higher in the forest and at the pass,
    // lower on the drop side; gaps under the roofs, on the bridge and at the lay-by
    const v: number[] = [];
    const idx: number[] = [];
    const prof = [
      [-0.35, 0],
      [0.25, 0.55],
      [0.9, 0.95],
      [1.7, 0.75],
      [2.6, 0],
    ];
    const pull = world.decor.find((d) => d.kind === 'pullout');
    const under = (i: number) => world.spans.some((sp) => {
      const len = (sp.i1 - sp.i0 + N) % N;
      return (i - sp.i0 + N + 4) % N <= len + 8;
    });
    for (const sd of [-1, 1]) {
      let open = false;
      let base = 0;
      for (let i = 0; i <= N; i += 2) {
        const s = S[i % N];
        const z = zoneAtKm(kmOf(world, i % N)).id;
        const hBase = z === 'forest' ? 1.35 : z === 'summit' ? 1.55 : z === 'switchbacks' ? 0.95 : z === 'cliff' ? 1.05 : z === 'village' ? 0.8 : 0.7;
        const drop = s.y - gy(s.x + s.nx * (edge + 6) * sd, s.z + s.nz * (edge + 6) * sd);
        const h = hBase * (drop > 1.5 ? 0.55 : 1) * (0.85 + 0.3 * Math.sin(i * 0.37 + sd));
        const gap = under(i % N) || (pull && Math.hypot(pull.x - s.x, pull.z - s.z) < 18);
        if (gap) {
          open = false;
          continue;
        }
        const start = v.length / 3;
        for (const [o, hh] of prof) {
          const off = (edge - 0.1 + o) * sd;
          const x = s.x + s.nx * off;
          const zz = s.z + s.nz * off;
          v.push(x, Math.max(s.y, gy(x, zz)) + hh * h, zz);
        }
        if (open) {
          for (let c = 0; c < prof.length - 1; c++) {
            const a = base + c;
            const b = start + c;
            if (sd > 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
            else idx.push(a, a + 1, b, a + 1, b + 1, b);
          }
        }
        base = start;
        open = true;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    W.snow.add(g, new THREE.Matrix4(), 0xf4f6fa, 4);

    // cornices: curling lips of snow on the crests above the pass road
    for (let i = 0; i < N; i += 15) {
      if (zoneAtKm(kmOf(world, i)).id !== 'summit') continue;
      const s = S[i];
      for (const sd of [-1, 1]) {
        let best = -1e9;
        let bo = 0;
        for (let o = 30; o <= 130; o += 5) {
          const h = gy(s.x + s.nx * o * sd, s.z + s.nz * o * sd);
          if (h > best) {
            best = h;
            bo = o;
          }
        }
        if (bo < 35 || bo > 125 || best < s.y + 12) continue;
        const x = s.x + s.nx * bo * sd;
        const z = s.z + s.nz * bo * sd;
        const lip = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false, 0, Math.PI);
        lip.rotateZ(Math.PI / 2);
        W.snow.add(lip, at(x, best - 0.2, z, Math.atan2(s.tx, s.tz), 0, 0, 0, 7 + rand() * 6, 1.5 + rand(), 2.2 + rand() * 1.5, 0, 0), 0xffffff, 4);
      }
    }
  }

  // ── Build the meshes ────────────────────────────────────────────────────────
  let tris = 0;
  const add = (b: TexBucket, mat: THREE.Material, name: string, shadow = true): THREE.Mesh | null => {
    const m = b.mesh(mat, name, shadow);
    if (m) {
      tris += m.geometry.getAttribute('position').count / 3;
      scene.add(m);
    }
    return m;
  };
  add(B.tile, MAT.tile, 'roof-tiles');
  add(B.copper, MAT.copper, 'copper-roofs');
  add(B.timber, MAT.timber, 'timber');
  add(B.timberLight, MAT.timberLight, 'timber-light');
  add(B.plaster, MAT.plaster, 'plaster');
  add(B.stone, MAT.stone, 'stonework');
  add(B.concrete, MAT.concrete, 'concrete');
  add(B.logs, MAT.logs, 'logs');
  add(B.metal, MAT.metal, 'tin-roofs');
  add(B.paint, MAT.paint, 'painted');
  add(B.glow, MAT.glow, 'paper-windows', false);
  add(B.lantern, MAT.lantern, 'lantern-lights', false);
  const fallWater = add(B.iceWater, MAT.iceWater, 'waterfall-flowing', false);
  // the winter layer
  const winter: THREE.Object3D[] = [];
  const ws = add(W.snow, MAT.snow, 'winter-snow');
  const wi = add(W.ice, MAT.ice, 'winter-ice', false);
  if (ws) winter.push(ws);
  if (wi) winter.push(wi);
  if (wi) wi.renderOrder = 4;

  // the stream ripples: drift its normal pattern (cheap: the texture's offset)
  const waterMats = streamWater.map((m) => m.material as THREE.MeshStandardMaterial);
  const rip = ctx.baked.asphalt.normal.clone();
  rip.wrapS = rip.wrapT = THREE.RepeatWrapping;
  rip.needsUpdate = true;
  waterMats.forEach((m) => {
    m.normalMap = rip;
    m.normalScale = new THREE.Vector2(0.35, 0.35);
  });

  // ── Chimney smoke: soft puffs rising and drifting off ───────────────────────
  const smokeU = { uTime: { value: 0 }, uLight: { value: new THREE.Color(1, 1, 1) }, uAmt: { value: 1 } };
  if (smoke.length) {
    const P = 18;
    const pos = new Float32Array(smoke.length * P * 3);
    const ph = new Float32Array(smoke.length * P);
    smoke.forEach((c, i) => {
      for (let k = 0; k < P; k++) {
        pos.set([c.x, c.y, c.z], (i * P + k) * 3);
        ph[i * P + k] = k / P + i * 0.137;
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: smokeU,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aPh;
        uniform float uTime;
        varying float vA;
        void main() {
          float t = fract(uTime * 0.07 + aPh);
          vec3 p = position + vec3(t * 9.0 + sin(t * 6.0 + aPh * 20.0) * 0.6, t * 11.0, t * 3.5);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp((0.6 + t * 4.5) * 420.0 / -mv.z, 1.0, 140.0);
          vA = smoothstep(0.0, 0.12, t) * (1.0 - t) * smoothstep(8.0, 30.0, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uLight;
        uniform float uAmt;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = (1.0 - smoothstep(0.15, 0.5, d)) * vA * 0.32 * uAmt;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.82, 0.83, 0.86) * uLight, a);
        }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.name = 'chimney-smoke';
    mainOnly(pts);
    scene.add(pts);
  }

  let snowOn = -1;
  let fallT = 0;
  return {
    tris,
    update(dt, time, night) {
      const snow = mountainUniforms.uSnowCover.value > 0.5 ? 1 : 0;
      if (snow !== snowOn) {
        snowOn = snow;
        for (const o of winter) o.visible = !!snow;
        for (const m of streamWater) m.visible = !snow;
        // outside the Snow weather the waterfall is half frozen: ice columns with water over them
        if (fallWater) fallWater.visible = !snow;
      }
      smokeU.uTime.value = time;
      smokeU.uLight.value.setScalar(1 - night * 0.7);
      fallT += dt;
      flowTex.offset.y = -fallT * 0.25;
      rip.offset.set(time * 0.05, time * 0.2);
    },
    setQuality(_q) {},
  };
}
