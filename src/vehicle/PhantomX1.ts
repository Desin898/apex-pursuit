// ─────────────────────────────────────────────────────────────────────────────
// PhantomX1 — the hero car, modelled procedurally from the concept sketch.
//
// The body is a lofted surface: ~120 cross-sections ("stations") swept from tail to nose, each
// built from a handful of profile curves (width, floor, hood/deck line, fender crest line). That
// gives the sketch's key shapes — long low nose, fenders that stand proud of the hood, deep
// side scallop feeding an intake ahead of the rear wheel, muscular rear haunches — as one
// continuous sculpted skin with real wheel-arch cut-outs. The bubble canopy is a second loft.
//
// Car space: origin on the ground under the centre of gravity, +Z forward, +Y up, +X left.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { addSnowLayer } from './carSnow';
import { mainOnly } from '../core/layers';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COCKPIT, PAINTS, VEHICLE as V } from '../config';
import { CarLook, FINISHES } from './Cars';
import { clamp, curve1, smoothstep } from '../core/math';
import { VehicleState, WHEEL_X, WHEEL_Z } from './VehiclePhysics';
import { frameEuler, layoutCar, newFrame, newLayout, updateFrame } from './wheelPose';
import { buildWheelParts, WheelLook } from './wheelLook';
import { beamTexture, poolTexture } from '../world/textures';
import { groundUniforms } from '../fx/Reflections';

/** The cabin volume cut out of the body skin in the cockpit view (car-body space). */
const COCKPIT_CUT = { halfW: 0.6, y0: 0.3, z0: -0.92, z1: 0.8 };

// ── Body profile curves (metres, as a function of z along the car) ───────────
const Z_REAR = -2.32;
const Z_NOSE0 = 2.06; // where the rounded nose begins
const Z_TIP = 2.42;
const NOSE_P = 2.6; // superellipse exponent of the nose in plan view (higher = squarer)

const HALF_W = curve1([
  [-2.32, 0.84],
  [-2.05, 0.965],
  [-1.35, 1.02],
  [-0.65, 0.985],
  [0.2, 0.955],
  [0.9, 0.975],
  [1.4, 1.0],
  [1.85, 0.985],
  [2.06, 0.955],
]);
const FLOOR_Y = curve1([
  [-2.32, 0.34],
  [-1.95, 0.24],
  [-1.5, 0.15],
  [-0.9, 0.125],
  [1.9, 0.125],
  [2.42, 0.13],
]);
/** Centre-line height: hood, cowl, engine deck, ducktail. */
const CENTER_Y = curve1([
  [-2.32, 0.85],
  [-2.2, 0.865],
  [-1.85, 0.835],
  [-1.3, 0.84],
  [-0.5, 0.83],
  [0.4, 0.76],
  [0.9, 0.675],
  [1.4, 0.615],
  [1.9, 0.545],
  [2.2, 0.485],
  [2.36, 0.43],
  [2.42, 0.4],
]);
/** Fender crest height: front fender peak, door shoulder, rear haunch. */
const FENDER_Y = curve1([
  [-2.32, 0.845],
  [-2.1, 0.88],
  [-1.35, 0.905],
  [-0.75, 0.84],
  [0.0, 0.775],
  [0.7, 0.8],
  [1.4, 0.85],
  [1.85, 0.745],
  [2.1, 0.62],
  [2.3, 0.5],
  [2.42, 0.42],
]);
/** Depth of the side scallop; the sharp ramp at its rear end is the side intake mouth. */
const SCALLOP = curve1([
  [-0.95, 0],
  [-0.92, 0.0],
  [-0.66, 0.15],
  [-0.3, 0.12],
  [0.3, 0.07],
  [0.86, 0.0],
  [0.97, 0],
]);

const ARCH_R = 0.42;
const AXLE_Y = V.wheelRadius;
const ARCHES = [V.cgToFront, -V.cgToRear];
const WELL_X = 0.58; // inner wall of the wheel wells

// Points per region of a half cross-section (centre-top → fender → side → sill → centre-bottom)
const N_TOP = 13;
const N_SHOULDER = 5;
const N_SIDE_UP = 8;
const N_SIDE_LOW = 6;
const N_SILL = 3;
const N_FLOOR = 4;
const enum Reg {
  Top,
  Shoulder,
  SideUp,
  Split,
  SideLow,
  Sill,
  Floor,
}
const enum Mat {
  Paint,
  Gloss, // gloss black / carbon: intakes, vents
  Matte, // wheel wells, underbody, grilles
}

interface SectionPoint {
  x: number;
  y: number;
  reg: Reg;
  sub: number;
}
interface Station {
  z: number;
  /** half width of this section */
  w: number;
  /** 0 on the main body; 0→1 along the rounded nose */
  nose: number;
  arch: number; // index into ARCHES or −1
}

function archAt(z: number): number {
  for (let i = 0; i < ARCHES.length; i++) if (Math.abs(z - ARCHES[i]) < ARCH_R) return i;
  return -1;
}

function halfSection(st: Station): SectionPoint[] {
  const z = st.z;
  const w = st.w;
  const yb = FLOOR_Y(z);
  const yc = CENTER_Y(z);
  const yf = FENDER_Y(z);
  // Fender shoulders tighten over the wheels and along the nose's leading edge.
  let nearArch = 0;
  for (const a of ARCHES) nearArch = Math.max(nearArch, Math.exp(-(((z - a) / 0.5) ** 2)));
  const tail = smoothstep(-1.9, -2.32, z);
  let rcx = 0.17 - 0.08 * nearArch - 0.05 * tail;
  let rcy = 0.115 - 0.065 * nearArch - 0.055 * tail;
  if (st.nose > 0) {
    rcy = 0.115 + (0.035 - 0.115) * smoothstep(0, 0.35, st.nose);
    rcx = Math.min(0.17 + (0.05 - 0.17) * smoothstep(0, 0.35, st.nose), w * 0.45);
  }
  const rb = Math.min(0.035, w * 0.3);
  const yTopSide = yf - rcy;
  const ySill = yb + rb;
  const inArch = st.arch >= 0;
  let ySplit = AXLE_Y;
  if (inArch) {
    const dz = z - ARCHES[st.arch];
    ySplit = AXLE_Y + Math.sqrt(Math.max(0, ARCH_R * ARCH_R - dz * dz));
  }
  ySplit = clamp(ySplit, ySill + 0.004, yTopSide - 0.012);
  const depth = st.nose > 0 ? 0 : SCALLOP(z);
  const sideX = (y: number): number => {
    const v = clamp((y - ySill) / (yTopSide - ySill), 0, 1);
    const scallop = depth * Math.pow(Math.sin(Math.PI * v), 0.75);
    const tuck = st.nose > 0 ? 0 : 0.035 * (1 - v) * (1 - v) * (1 - smoothstep(1.7, Z_NOSE0, z));
    return w - scallop - tuck;
  };

  const pts: SectionPoint[] = [];
  const xt = w - rcx;
  for (let k = 0; k < N_TOP; k++) {
    const xi = k / (N_TOP - 1);
    pts.push({ x: xi * xt, y: yc + (yf - yc) * smoothstep(0.28, 0.9, xi), reg: Reg.Top, sub: k });
  }
  for (let k = 1; k <= N_SHOULDER; k++) {
    const th = (k / N_SHOULDER) * (Math.PI / 2);
    pts.push({ x: xt + rcx * Math.sin(th), y: yTopSide + rcy * Math.cos(th), reg: Reg.Shoulder, sub: k - 1 });
  }
  for (let k = 1; k <= N_SIDE_UP; k++) {
    const y = yTopSide + (ySplit - yTopSide) * (k / N_SIDE_UP);
    pts.push({ x: sideX(y), y, reg: Reg.SideUp, sub: k - 1 });
  }
  // Duplicate of the split vertex: gives the wheel-arch edge a hard crease.
  pts.push({ x: sideX(ySplit), y: ySplit, reg: Reg.Split, sub: 0 });
  for (let k = 0; k < N_SIDE_LOW; k++) {
    if (inArch) {
      const y = ySplit + (ySill - ySplit) * (k / (N_SIDE_LOW - 1));
      pts.push({ x: Math.min(WELL_X, w), y, reg: Reg.SideLow, sub: k });
    } else {
      const y = ySplit + (ySill - ySplit) * ((k + 1) / N_SIDE_LOW);
      pts.push({ x: sideX(y), y, reg: Reg.SideLow, sub: k });
    }
  }
  const xs = inArch ? Math.min(WELL_X, w) : sideX(ySill);
  for (let k = 1; k <= N_SILL; k++) {
    const th = (k / N_SILL) * (Math.PI / 2);
    pts.push({
      x: inArch ? xs : xs - rb + rb * Math.cos(th),
      y: ySill - rb * Math.sin(th),
      reg: Reg.Sill,
      sub: k - 1,
    });
  }
  const xe = inArch ? xs : xs - rb;
  for (let k = 1; k <= N_FLOOR; k++) pts.push({ x: xe * (1 - k / N_FLOOR), y: yb, reg: Reg.Floor, sub: k - 1 });
  return pts;
}

function buildStations(): Station[] {
  const zs: number[] = [];
  const stepZ = 0.045;
  for (let z = Z_REAR; z < Z_NOSE0 - 1e-6; z += stepZ) zs.push(z);
  // extra stations hugging both ends of each wheel arch so the cut-out has crisp vertical legs
  for (const a of ARCHES) {
    for (const e of [a - ARCH_R, a + ARCH_R]) zs.push(e - 0.004, e + 0.004);
    for (const f of [0.86, 0.94, 0.985]) zs.push(a - ARCH_R * f, a + ARCH_R * f);
  }
  zs.sort((p, q) => p - q);
  const st: Station[] = [];
  let last = -99;
  for (const z of zs) {
    if (z - last < 0.006) continue;
    last = z;
    st.push({ z, w: HALF_W(z), nose: 0, arch: archAt(z) });
  }
  // Rounded nose: superellipse in plan view, tangent to the body sides and flat across the front.
  const w0 = HALF_W(Z_NOSE0);
  const NN = 20;
  for (let k = 0; k <= NN; k++) {
    const t = k / NN;
    const th = Math.min(t, 0.985) * (Math.PI / 2);
    st.push({
      z: Z_NOSE0 + (Z_TIP - Z_NOSE0) * Math.pow(Math.sin(th), 2 / NOSE_P),
      w: w0 * Math.pow(Math.cos(th), 2 / NOSE_P),
      nose: Math.max(t, 1e-4),
      arch: -1,
    });
  }
  return st;
}

function classify(regA: SectionPoint, a: Station, b: Station): Mat {
  const reg = regA.reg;
  const z = (a.z + b.z) / 2;
  if (reg === Reg.Floor || reg === Reg.Sill) return Mat.Matte;
  if ((reg === Reg.SideLow || reg === Reg.Split) && (a.arch >= 0 || b.arch >= 0)) return Mat.Matte;
  // front grille: the lower three-quarters of the nose's leading face
  if (a.nose > 0.12 && b.nose > 0.12) {
    if (reg === Reg.SideLow || reg === Reg.Split || (reg === Reg.SideUp && regA.sub >= 2)) return Mat.Matte;
  }
  // side intake mouth ahead of the rear wheel
  if (z > -0.93 && z < -0.66) {
    if ((reg === Reg.SideUp && regA.sub >= 2) || (reg === Reg.SideLow && regA.sub <= 2) || reg === Reg.Split) return Mat.Gloss;
  }
  // hood vents
  if (reg === Reg.Top && regA.sub === 5 && z > 1.3 && z < 1.86) return Mat.Gloss;
  return Mat.Paint;
}

interface Loft {
  geos: THREE.BufferGeometry[]; // one per Mat
  /** the nose's fascia-top edge, left side, from the body corner to the tip: used for the LED bar */
  ledPath: THREE.Vector3[];
}

function buildBodyLoft(): Loft {
  const stations = buildStations();
  const half0 = halfSection(stations[0]);
  const H = half0.length;
  const RING = 2 * H - 2;
  const hIdx = (j: number) => (j < H ? j : RING - j);
  const nS = stations.length;
  const pos = new Float32Array(nS * RING * 3);
  const uv = new Float32Array(nS * RING * 2);
  const halves: SectionPoint[][] = [];
  const ledPath: THREE.Vector3[] = [];
  const ledIndex = N_TOP + N_SHOULDER - 1; // last shoulder point = top edge of the side / fascia
  for (let i = 0; i < nS; i++) {
    const half = halfSection(stations[i]);
    halves.push(half);
    for (let j = 0; j < RING; j++) {
      const p = half[hIdx(j)];
      const o = (i * RING + j) * 3;
      pos[o] = j < H ? p.x : -p.x;
      pos[o + 1] = p.y;
      pos[o + 2] = stations[i].z;
      uv[(i * RING + j) * 2] = stations[i].z * 9;
      uv[(i * RING + j) * 2 + 1] = (j / RING) * 40;
    }
    if (stations[i].nose > 0.05) ledPath.push(new THREE.Vector3(half[ledIndex].x, half[ledIndex].y, stations[i].z));
  }
  const idx: number[][] = [[], [], []];
  for (let i = 0; i < nS - 1; i++) {
    for (let j = 0; j < RING; j++) {
      const j2 = (j + 1) % RING;
      const segPoint = halves[i][Math.max(hIdx(j), hIdx(j2))];
      const m = classify(segPoint, stations[i], stations[i + 1]);
      const a = i * RING + j;
      const b = (i + 1) * RING + j;
      const c = (i + 1) * RING + j2;
      const d = i * RING + j2;
      idx[m].push(a, b, c, a, c, d);
    }
  }
  // Smooth normals over the whole skin (shared by all material groups). Zero-area faces at the
  // duplicated arch vertex contribute nothing, which is what keeps that edge crisp.
  const nrm = new Float32Array(pos.length);
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (const list of idx) {
    for (let t = 0; t < list.length; t += 3) {
      vA.fromArray(pos, list[t] * 3);
      vB.fromArray(pos, list[t + 1] * 3);
      vC.fromArray(pos, list[t + 2] * 3);
      e1.subVectors(vB, vA);
      e2.subVectors(vC, vA);
      e1.cross(e2);
      for (let k = 0; k < 3; k++) {
        const o = list[t + k] * 3;
        nrm[o] += e1.x;
        nrm[o + 1] += e1.y;
        nrm[o + 2] += e1.z;
      }
    }
  }
  for (let o = 0; o < nrm.length; o += 3) {
    const l = Math.hypot(nrm[o], nrm[o + 1], nrm[o + 2]) || 1;
    nrm[o] /= l;
    nrm[o + 1] /= l;
    nrm[o + 2] /= l;
  }
  const posAttr = new THREE.BufferAttribute(pos, 3);
  const nrmAttr = new THREE.BufferAttribute(nrm, 3);
  const uvAttr = new THREE.BufferAttribute(uv, 2);
  const geos = idx.map((list) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', posAttr);
    g.setAttribute('normal', nrmAttr);
    g.setAttribute('uv', uvAttr);
    g.setIndex(list);
    return g;
  });
  return { geos, ledPath };
}

/** Flat fan closing an open end of a loft. */
function capGeometry(outline: THREE.Vector3[], center: THREE.Vector3, flip: boolean): THREE.BufferGeometry {
  const p: number[] = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if (flip) p.push(center.x, center.y, center.z, b.x, b.y, b.z, a.x, a.y, a.z);
    else p.push(center.x, center.y, center.z, a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

// ── Canopy: a teardrop glass bubble with a painted roof spine ────────────────
const CAN_W = curve1([
  [-1.62, 0.04],
  [-1.45, 0.2],
  [-1.1, 0.44],
  [-0.7, 0.585],
  [-0.2, 0.665],
  [0.3, 0.64],
  [0.68, 0.53],
  [0.9, 0.36],
  [1.0, 0.2],
  [1.04, 0.04],
]);
const CAN_TOP = curve1([
  [-1.62, 0.855],
  [-1.4, 0.905],
  [-1.0, 0.985],
  [-0.6, 1.075],
  [-0.2, 1.115],
  [0.15, 1.075],
  [0.5, 0.955],
  [0.8, 0.805],
  [0.96, 0.7],
  [1.04, 0.655],
]);

export function buildCanopy(): { glass: THREE.BufferGeometry; paint: THREE.BufferGeometry; trim: THREE.BufferGeometry } {
  const NS = 64;
  const NR = 28;
  const pos: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i <= NS; i++) {
    // cosine spacing packs stations into the tight front and rear ends
    const t = 0.5 - 0.5 * Math.cos((i / NS) * Math.PI);
    const z = -1.62 + (1.04 - -1.62) * t;
    zs.push(z);
    const w = CAN_W(z);
    const top = CAN_TOP(z);
    const base = CENTER_Y(z) - 0.05;
    for (let j = 0; j <= NR; j++) {
      const th = (j / NR) * Math.PI; // 0 = right base, π = left base
      const cx = Math.cos(th);
      const sx = Math.sin(th);
      pos.push(-w * Math.sign(cx) * Math.pow(Math.abs(cx), 2 / 2.7), base + (top - base) * Math.pow(sx, 2 / 2.3), z);
    }
  }
  const idx: number[][] = [[], [], []]; // glass, paint, trim
  for (let i = 0; i < NS; i++) {
    const z = (zs[i] + zs[i + 1]) / 2;
    for (let j = 0; j < NR; j++) {
      const tau = (j + 0.5) / NR;
      const side = Math.abs(tau - 0.5) * 2; // 0 = roof centre line, 1 = base
      let m = 1;
      if (z > 0.2) m = 0; // wrap-around windscreen
      else if (z > -0.62 && side > 0.36) m = 0; // side windows
      else if (z < -0.5 && z > -1.28 && side < 0.3) m = 0; // engine-cover glass
      // thin dark pillars / seals around the glass
      if (m === 0 && z < 0.2 && z > 0.12) m = 2;
      if (m === 0 && z < -0.5 && z > -0.62 && side > 0.36) m = 2;
      const a = i * (NR + 1) + j;
      const b = (i + 1) * (NR + 1) + j;
      idx[m].push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const all = new THREE.BufferGeometry();
  all.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  all.setIndex(idx.flat());
  all.computeVertexNormals();
  const make = (list: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', all.getAttribute('position'));
    g.setAttribute('normal', all.getAttribute('normal'));
    g.setIndex(list);
    return g;
  };
  return { glass: make(idx[0]), paint: make(idx[1]), trim: make(idx[2]) };
}

// ── Wheels: low-profile tyre, deep-dish barrel, twisted turbine spokes ───────
function flakeNormalMap(): THREE.CanvasTexture {
  // Tiny random normal perturbations: reads as metallic flake under the clear coat.
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < S * S; i++) {
    img.data[i * 4] = 128 + (r() - 0.5) * 70;
    img.data[i * 4 + 1] = 128 + (r() - 0.5) * 70;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 4G.2: "orange peel": the gentle waviness every real clear coat has, so reflections ripple a little. */
function peelNormalMap(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  // smooth height field from a few soft blobs, then its slope as the normal
  const h = new Float32Array(S * S);
  let seed = 11;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 220; k++) {
    const cx = r() * S;
    const cy = r() * S;
    const rad = 4 + r() * 9;
    const a = (r() - 0.5) * 2;
    for (let y = -16; y <= 16; y++)
      for (let x = -16; x <= 16; x++) {
        const d = (x * x + y * y) / (rad * rad);
        if (d > 4) continue;
        const px = (Math.floor(cx + x) + S) % S;
        const py = (Math.floor(cy + y) + S) % S;
        h[py * S + px] += a * Math.exp(-d);
      }
  }
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = h[y * S + ((x + 1) % S)] - h[y * S + ((x + S - 1) % S)];
      const dy = h[((y + 1) % S) * S + x] - h[((y + S - 1) % S) * S + x];
      const i = (y * S + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, 128 - dx * 90));
      img.data[i + 1] = Math.max(0, Math.min(255, 128 - dy * 90));
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  return t;
}

/**
 * 4G.2: rain beads on the paint and glass. Water stands in round drops on a waxed car: each one
 * a little dome (it bends the reflections), glossy, a touch darker underneath. They come with the
 * wetness of the track and dry off with it. `q` is the shader expression for 2D surface coords.
 */
export function addBeads(m: THREE.MeshPhysicalMaterial, key: string, q: string, objectPos: boolean): void {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBeadWet = groundUniforms.uWet;
    if (objectPos) {
      sh.vertexShader = 'varying vec3 vBeadP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vBeadP = position;');
    }
    sh.fragmentShader = (objectPos ? 'varying vec3 vBeadP;\n' : '') + 'uniform float uBeadWet;\n' + sh.fragmentShader
      .replace(
        '#include <clearcoat_normal_fragment_maps>',
        `#include <clearcoat_normal_fragment_maps>
        if (uBeadWet > 0.02) {
          vec2 bq = ${q};
          vec2 bc = floor(bq);
          vec2 bf = fract(bq);
          float bh = fract(sin(dot(bc, vec2(127.1, 311.7))) * 43758.5453);
          // a wet car is glossier all over
          roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.55, uBeadWet);
          if (bh < uBeadWet * 0.45) {
            vec2 cc = vec2(fract(bh * 13.7), fract(bh * 71.3)) * 0.5 + 0.25;
            float rr = 0.08 + 0.16 * fract(bh * 37.1);
            vec2 d = (bf - cc) / rr;
            float l = dot(d, d);
            if (l < 1.0) {
              mat3 btb = getTangentFrame(-vViewPosition, nonPerturbedNormal, bq);
              vec3 bn = normalize(btb * vec3(d * 0.9, sqrt(1.0 - l)));
              normal = normalize(mix(normal, bn, 0.85));
              #ifdef USE_CLEARCOAT
                clearcoatNormal = bn;
              #endif
              roughnessFactor = min(roughnessFactor, 0.04);
              diffuseColor.rgb *= 0.96;
            }
          }
        }`,
      );
  };
  m.customProgramCacheKey = () => key;
}

function blobShadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.scale(1, 2);
  const g = ctx.createRadialGradient(32, 32, 6, 32, 32, 31);
  g.addColorStop(0, 'rgba(0,0,0,0.95)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.75)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}


// ── Shared resources ─────────────────────────────────────────────────────────
// Every car on the grid is a Phantom X1, so geometry and all non-paint materials are built once
// and reused. Each car only owns its paint, its tail / reverse lamps and its nitrous flame.
type PartKey = 'paint' | 'gloss' | 'matte' | 'carbon' | 'glass' | 'head' | 'tail' | 'reverse' | 'steel';

function mergeParts(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const norm = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g.clone();
    if (!n.getAttribute('normal')) n.computeVertexNormals();
    if (!n.getAttribute('uv')) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.getAttribute('position').count * 2), 2));
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
    return n;
  });
  return mergeGeometries(norm)!;
}

let bodyCache: Record<PartKey, THREE.BufferGeometry> | null = null;
/** The whole sprung body, merged into one geometry per material. Built on first use. */
function sharedBody(): Record<PartKey, THREE.BufferGeometry> {
  if (bodyCache) return bodyCache;
  const lists: Record<PartKey, THREE.BufferGeometry[]> = { paint: [], gloss: [], matte: [], carbon: [], glass: [], head: [], tail: [], reverse: [], steel: [] };
  const put = (key: PartKey, geo: THREE.BufferGeometry) => lists[key].push(geo);

  // Body skin
  const loft = buildBodyLoft();
  put('paint', loft.geos[Mat.Paint]);
  put('gloss', loft.geos[Mat.Gloss]);
  put('matte', loft.geos[Mat.Matte]);

  // Tail panel (dark mesh) and nose tip closure
  const rear = halfSection({ z: Z_REAR, w: HALF_W(Z_REAR), nose: 0, arch: -1 });
  const outline: THREE.Vector3[] = [];
  for (let j = 0; j < rear.length; j++) outline.push(new THREE.Vector3(rear[j].x, rear[j].y, Z_REAR));
  for (let j = rear.length - 2; j > 0; j--) outline.push(new THREE.Vector3(-rear[j].x, rear[j].y, Z_REAR));
  put('matte', capGeometry(outline, new THREE.Vector3(0, 0.6, Z_REAR), false));
  const tipBox = new THREE.BoxGeometry(0.12, 0.26, 0.02);
  tipBox.translate(0, 0.27, Z_TIP - 0.012);
  put('matte', tipBox);

  // Canopy
  const can = buildCanopy();
  put('glass', can.glass);
  put('paint', can.paint);
  put('gloss', can.trim);

  // Front LED light bar: follows the leading edge right across the nose, dipping at the centre
  // exactly like the line in the sketch.
  const left = loft.ledPath.map((p) => new THREE.Vector3(p.x, p.y - 0.006, p.z));
  const path: THREE.Vector3[] = [];
  for (let i = 0; i < left.length; i++) path.push(left[i]);
  path.push(new THREE.Vector3(0, left[left.length - 1].y, Z_TIP));
  for (let i = left.length - 1; i >= 0; i--) path.push(new THREE.Vector3(-left[i].x, left[i].y, left[i].z));
  // push the bar a few millimetres proud of the skin, along the nose outline's outward normal
  const noseD = Z_TIP - Z_NOSE0;
  const w0n = HALF_W(Z_NOSE0);
  const proud = path.map((p) => {
    const gx = (Math.sign(p.x) * Math.pow(Math.abs(p.x) / w0n, NOSE_P - 1)) / w0n;
    const gz = Math.pow(Math.max(0, p.z - Z_NOSE0) / noseD, NOSE_P - 1) / noseD;
    const n = new THREE.Vector3(gx, 0, gz).normalize();
    return p.clone().addScaledVector(n, 0.007);
  });
  const ledGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(proud, false, 'centripetal'), 140, 0.014, 6, false);
  put('head', ledGeo);
  // Lower running lights tucked into the outer corners of the grille
  for (const sx of [1, -1]) {
    const drl = new THREE.BoxGeometry(0.2, 0.014, 0.02);
    drl.rotateY(sx * -0.55);
    drl.translate(sx * 0.74, 0.3, 2.262);
    put('head', drl);
  }

  // Front splitter: flat carbon blade following the nose outline
  const w0 = HALF_W(Z_NOSE0);
  const shape = new THREE.Shape();
  const SP = 28;
  for (let k = 0; k <= SP * 2; k++) {
    const th = (k / (SP * 2)) * Math.PI; // 0 = left corner, π/2 = tip, π = right corner
    const cx = Math.cos(th);
    const sx = Math.sin(th);
    const x = (w0 + 0.035) * Math.sign(cx) * Math.pow(Math.abs(cx), 2 / NOSE_P);
    const z = Z_NOSE0 + (Z_TIP - Z_NOSE0 + 0.075) * Math.pow(sx, 2 / NOSE_P);
    if (k === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  }
  shape.lineTo(-(w0 + 0.035), 1.86);
  shape.lineTo(w0 + 0.035, 1.86);
  const splitter = new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: false });
  splitter.rotateX(Math.PI / 2);
  splitter.translate(0, 0.122, 0);
  put('carbon', splitter);
  // Splitter end plates and the two slanted struts that divide the grille (as in the sketch)
  for (const sx of [1, -1]) {
    const plate = new THREE.BoxGeometry(0.016, 0.1, 0.3);
    plate.translate(sx * (w0 + 0.03), 0.16, 2.02);
    put('carbon', plate);
    const strut = new THREE.BoxGeometry(0.03, 0.27, 0.05);
    strut.rotateZ(sx * -0.42);
    strut.translate(sx * 0.37, 0.275, 2.4);
    put('paint', strut);
  }

  // Side skirts
  for (const sx of [1, -1]) {
    const skirt = new THREE.BoxGeometry(0.03, 0.03, 1.62);
    skirt.translate(sx * 0.955, 0.128, 0.02);
    put('carbon', skirt);
  }

  // Mirrors: slim pods on carbon stalks
  for (const sx of [1, -1]) {
    const pod = new THREE.SphereGeometry(0.075, 16, 12);
    pod.scale(1.25, 0.62, 0.9);
    pod.translate(sx * 0.9, 0.9, 0.5);
    put('paint', pod);
    const stalk = new THREE.BoxGeometry(0.26, 0.016, 0.05);
    stalk.rotateZ(sx * 0.32);
    stalk.translate(sx * 0.75, 0.86, 0.5);
    put('carbon', stalk);
  }

  // Tail: full-width light blade, reverse lamp, centre exhausts, diffuser strakes
  const tail = new THREE.BoxGeometry(1.42, 0.022, 0.03);
  tail.translate(0, 0.745, Z_REAR - 0.012);
  put('tail', tail);
  for (const sx of [1, -1]) {
    const hook = new THREE.BoxGeometry(0.022, 0.13, 0.03);
    hook.translate(sx * 0.72, 0.69, Z_REAR - 0.012);
    put('tail', hook);
  }
  const rev = new THREE.BoxGeometry(0.16, 0.02, 0.03);
  rev.translate(0, 0.4, Z_REAR - 0.012);
  put('reverse', rev);
  for (const sx of [1, -1]) {
    const pipe = new THREE.CylinderGeometry(0.058, 0.058, 0.16, 20, 1, true);
    pipe.rotateX(Math.PI / 2);
    pipe.translate(sx * 0.105, 0.555, Z_REAR - 0.03);
    put('steel', pipe);
  }
  for (let i = -2; i <= 2; i++) {
    if (i === 0) continue;
    const fin = new THREE.BoxGeometry(0.014, 0.11, 0.6);
    fin.rotateX(0.24);
    fin.translate(i * 0.2, 0.225, -2.02);
    put('carbon', fin);
  }


  const out = {} as Record<PartKey, THREE.BufferGeometry>;
  for (const k of Object.keys(lists) as PartKey[]) out[k] = mergeParts(lists[k]);
  bodyCache = out;
  return out;
}

export interface SharedMaterials {
  gloss: THREE.Material;
  matte: THREE.Material;
  carbon: THREE.Material;
  glass: THREE.Material;
  head: THREE.Material;
  steel: THREE.Material;
  rim: THREE.Material;
  tyre: THREE.Material;
  disc: THREE.Material;
  caliper: THREE.MeshStandardMaterial;
  flake: THREE.Texture;
  peel: THREE.Texture;
  blob: THREE.Texture;
}
let matCache: SharedMaterials | null = null;
let lightTexCache: { beam: THREE.Texture; pool: THREE.Texture } | null = null;
function lightTextures(): { beam: THREE.Texture; pool: THREE.Texture } {
  if (!lightTexCache) lightTexCache = { beam: beamTexture(), pool: poolTexture() };
  return lightTexCache;
}

export function sharedMaterials(): SharedMaterials {
  if (matCache) return matCache;
  matCache = {
    gloss: new THREE.MeshPhysicalMaterial({ color: 0x08090b, metalness: 0.6, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
    matte: new THREE.MeshStandardMaterial({ color: 0x070708, metalness: 0.1, roughness: 0.9 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x101114, metalness: 0.55, roughness: 0.42 }),
    // 4G.2: smoked glass: a little green-blue in the tint, a true glass reflection (IOR 1.5)
    glass: new THREE.MeshPhysicalMaterial({ color: 0x040a0c, metalness: 0.15, roughness: 0.02, ior: 1.52, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.015, envMapIntensity: 1.9 }),
    head: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xdcebff, emissiveIntensity: 5 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x2a2b2f, metalness: 1, roughness: 0.25, side: THREE.DoubleSide }),
    rim: new THREE.MeshStandardMaterial({ color: 0x1b1c20, metalness: 1, roughness: 0.3, side: THREE.DoubleSide }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x0a0a0b, metalness: 0, roughness: 0.93 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x7d8086, metalness: 1, roughness: 0.42 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xc8141c, metalness: 0.3, roughness: 0.4 }),
    flake: flakeNormalMap(),
    peel: peelNormalMap(),
    blob: blobShadowTexture(),
  };
  const g = matCache.glass as THREE.MeshPhysicalMaterial;
  g.clearcoatNormalMap = matCache.peel;
  g.clearcoatNormalScale = new THREE.Vector2(0.015, 0.015);
  addBeads(g, 'glass-4g2', 'vBeadP.xz * 34.0 + vBeadP.y * 9.0', true);
  // 5D: snow settles on the car in the snow (glass: the roof only, never the windscreen)
  addSnowLayer(g, { minUp: 0.86, spray: false });
  addSnowLayer(matCache.gloss as THREE.MeshStandardMaterial);
  addSnowLayer(matCache.carbon as THREE.MeshStandardMaterial);
  addSnowLayer(matCache.matte as THREE.MeshStandardMaterial, { amount: 0.85 });
  return matCache;
}
const wheelCache = new Map<number, ReturnType<typeof buildWheelParts>>();
function sharedWheel(width: number): ReturnType<typeof buildWheelParts> {
  let w = wheelCache.get(width);
  if (!w) wheelCache.set(width, (w = buildWheelParts(width)));
  return w;
}
const SHADOW_CASTERS: PartKey[] = ['paint', 'gloss', 'matte', 'carbon', 'glass'];

interface WheelRig {
  pivot: THREE.Group; // position + steer
  spin: THREE.Group; // rolling
  dir: number; // +1 left side, −1 right side (mirrored)
  x: number; // where the wheel sits on the model (car space)
  z: number;
  r: number; // its radius
}

/** The per-car materials an imported model is dressed with (the rest are shared). */
export interface KitMats {
  paint: THREE.MeshPhysicalMaterial;
  tail: THREE.MeshStandardMaterial;
  reverse: THREE.MeshStandardMaterial;
  rim: THREE.MeshStandardMaterial;
  caliper: THREE.MeshStandardMaterial;
}

/**
 * 4.5: an imported car's parts, ready to ride on the rig. Car space as above (origin under the
 * centre of gravity). Wheels in the order FL, FR, RL, RR, each with its origin at the wheel centre.
 */
export interface CarKit {
  body: THREE.Object3D[]; // the sprung body at full detail
  detail1: THREE.Object3D[]; // hidden from detail level 1 (interior, underbody, callipers)
  mid: THREE.Object3D[]; // 4.6: the body at detail level 1 (a lighter copy; empty = keep the full one)
  far: THREE.Object3D | null; // the whole car at detail level 2 (static wheels)
  wheels: { spin: THREE.Object3D; spinMid?: THREE.Object3D | null; hub: THREE.Object3D | null; x: number; z: number; r: number }[];
  steer: { obj: THREE.Object3D; axis: THREE.Vector3 } | null;
  zFront: number;
  zRear: number;
  halfW: number;
  exhaust: THREE.Vector3[];
  eye: THREE.Vector3 | null; // the driver's eyes, for the cockpit camera
  shadow: THREE.Texture | null; // a baked ground shadow, if the model has one
}
export type CarKitBuilder = (m: KitMats) => CarKit;

export class PhantomX1 {
  /** Place this in the scene; move/rotate it with the car's ground pose (x, y, z, yaw). */
  readonly root = Object.assign(new THREE.Group(), { userData: { noBake: true } });
  /** Sprung mass: gets heave, pitch and roll from the suspension. */
  readonly body = new THREE.Group();
  readonly paint: THREE.MeshPhysicalMaterial;
  paintIndex = 0;
  private wheels: WheelRig[] = [];
  /** 5C: the chassis frame and the drawn layout (see wheelPose.ts) */
  private frame = newFrame();
  private layout = newLayout();
  private wheelXs: number[] = [0, 0, 0, 0];
  private wheelZs: number[] = [0, 0, 0, 0];
  /** 5C: per-frame wheel effects (spoke blur, brake glow, dirt), set up with the wheels */
  private wheelFx: ((s: VehicleState, dt: number) => void) | null = null;
  private wheelLook: WheelLook | null = null;
  /** 5C: the scene's rain and snow, for what the tyres pick up (set once a frame by the game) */
  static weather = { wet: 0, snow: 0 };
  private tailMat: THREE.MeshStandardMaterial;
  private reverseMat: THREE.MeshStandardMaterial;
  private flames: THREE.Mesh[] = [];
  private flameMat: THREE.ShaderMaterial;
  private shadowBlob: THREE.Mesh;
  private flameLevel = 0;
  private rimMat: THREE.MeshStandardMaterial;
  private caliperMat: THREE.MeshStandardMaterial;
  private glow: THREE.Mesh;
  private glowMat: THREE.MeshBasicMaterial;
  // night: light the road ahead (beam), behind (tail glow) and under the nose (LED bar)
  private lightCards = new THREE.Group();
  private beamMat: THREE.MeshBasicMaterial;
  private tailGlowMat: THREE.MeshBasicMaterial;
  private barGlowMat: THREE.MeshBasicMaterial;
  private nightK = 0;
  // level of detail: parts dropped at a distance (fewer draw calls for far cars)
  private lod = 0;
  private lodFar1: THREE.Object3D[] = []; // brake discs, calipers
  private lodFar2: THREE.Object3D[] = []; // small trim, lamps, carbon, steel
  private lodShadow: THREE.Mesh[] = [];
  // cockpit camera: the body is one closed skin, so the cabin volume is cut out of it (4A)
  private skin: THREE.Mesh[] = [];
  private cabinCut = { value: 0 };
  private cabinPatched = false;

  /** 4.5: an imported model's driver eye point (null for the Phantom X1, which has its own cockpit) */
  readonly eye: THREE.Vector3 | null = null;
  readonly imported: boolean;
  private kit: CarKit | null = null;
  private zFront = Z_TIP;
  /** 4.6: the tip of the nose (car space z) */
  get noseZ(): number {
    return this.zFront;
  }
  /** 4.6: the tail (car space z) */
  get tailZ(): number {
    return this.zRear;
  }
  private zRear = Z_REAR;
  private exhaust: THREE.Vector3[] = [new THREE.Vector3(0.105, 0.555, Z_REAR - 0.1), new THREE.Vector3(-0.105, 0.555, Z_REAR - 0.1)];
  private steerWheel: { obj: THREE.Object3D; axis: THREE.Vector3 } | null = null;

  constructor(build?: CarKitBuilder) {
    this.imported = !!build;
    const M = sharedMaterials();
    const p = PAINTS[0];
    this.paint = new THREE.MeshPhysicalMaterial({
      color: p.color,
      metalness: p.metalness,
      roughness: p.roughness,
      clearcoat: p.clearcoat,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.15,
      normalMap: M.flake,
      normalScale: new THREE.Vector2(0.08, 0.08),
      // 4G.2: the clear coat ripples a little (orange peel), so reflections aren't a perfect mirror
      clearcoatNormalMap: M.peel,
      clearcoatNormalScale: new THREE.Vector2(0.05, 0.05),
      iridescenceIOR: 1.35,
      iridescenceThicknessRange: [220, 520],
    });
    addBeads(this.paint, 'paint-4g2', 'vNormalMapUv * vec2(3.2, 4.0)', false);
    addSnowLayer(this.paint);
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1508, emissiveIntensity: 2.2 });
    this.reverseMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 0 });
    this.rimMat = (M.rim as THREE.MeshStandardMaterial).clone();
    this.caliperMat = M.caliper.clone();
    const kit = build ? build({ paint: this.paint, tail: this.tailMat, reverse: this.reverseMat, rim: this.rimMat, caliper: this.caliperMat }) : null;
    this.kit = kit;
    if (kit) {
      this.zFront = kit.zFront;
      this.zRear = kit.zRear;
      this.exhaust = kit.exhaust.length ? kit.exhaust : [new THREE.Vector3(0, 0.4, kit.zRear)];
      this.steerWheel = kit.steer;
      this.eye = kit.eye;
      for (const o of kit.body) this.body.add(o);
      for (const o of kit.mid) {
        o.visible = false;
        this.body.add(o);
      }
      if (kit.far) {
        kit.far.visible = false;
        this.body.add(kit.far);
      }
    }
    const mats: Record<PartKey, THREE.Material> = { paint: this.paint, gloss: M.gloss, matte: M.matte, carbon: M.carbon, glass: M.glass, head: M.head, tail: this.tailMat, reverse: this.reverseMat, steel: M.steel };
    const body = kit ? ({} as Record<PartKey, THREE.BufferGeometry>) : sharedBody();
    for (const k of Object.keys(body) as PartKey[]) {
      const m = new THREE.Mesh(body[k], mats[k]);
      m.castShadow = SHADOW_CASTERS.includes(k);
      this.body.add(m);
      this.skin.push(m);
    }
    // rims and calipers are per car so the garage can colour them (made above, before the kit)
    const rimMat = this.rimMat;
    const discMat = M.disc;
    const caliperMat = this.caliperMat;

    // Nitrous flames (hidden until fired)
    this.flameMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uLevel: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; uniform float uTime; uniform float uLevel;
        void main() {
          // Clamp before pow(): with multisampling the interpolated coordinate can land a hair
          // outside 0..1, and pow() of a negative number is NaN. One NaN pixel is enough for the
          // bloom blur to smear into a large black rectangle.
          float base = clamp(vUv.y, 0.0, 1.0);             // 1 at the pipe, 0 at the tip
          float flick = 0.75 + 0.25 * sin(uTime * 70.0 + vUv.x * 18.0) * sin(uTime * 43.0);
          float a = pow(base, 1.6) * flick * uLevel;
          vec3 col = mix(vec3(0.25, 0.55, 1.0), vec3(0.9, 0.97, 1.0), pow(base, 4.0));
          gl_FragColor = vec4(max(col * a * 3.2, 0.0), max(a, 0.0));
        }`,
    });
    for (const tip of this.exhaust) {
      const cone = new THREE.ConeGeometry(kit ? 0.045 : 0.052, 1.0, 14, 1, true);
      cone.translate(0, -0.5, 0); // base at origin, tip at −Y
      cone.rotateX(Math.PI / 2); // tip points −Z (backwards)
      const f = new THREE.Mesh(cone, this.flameMat);
      f.position.copy(tip);
      f.visible = false;
      this.body.add(f);
      this.flames.push(f);
    }

    // Wheels
    if (kit) {
      for (const kw of kit.wheels) {
        const pivot = new THREE.Group();
        const spin = new THREE.Group();
        pivot.position.set(kw.x, kw.r, kw.z);
        spin.add(kw.spin);
        if (kw.spinMid) {
          kw.spinMid.visible = false;
          spin.add(kw.spinMid);
        }
        pivot.add(spin);
        if (kw.hub) pivot.add(kw.hub);
        this.root.add(pivot);
        // the model's wheels are modelled in place: they all roll about +x
        this.wheels.push({ pivot, spin, dir: 1, x: kw.x, z: kw.z, r: kw.r });
      }
    }
    const frontParts = sharedWheel(0.275);
    const rearParts = sharedWheel(0.335);
    // 5C: per-car wheel look (brake heat, spoke blur, what's on the tyres)
    const look = kit ? null : new WheelLook(this.rimMat);
    if (look) {
      this.wheelLook = look;
      this.wheelFx = (st, dt) => look.update(st, dt, PhantomX1.weather, this.lod < 1);
      caliperMat.side = THREE.DoubleSide;
    }
    for (let i = 0; i < 4 && look; i++) {
      const parts = i < 2 ? frontParts : rearParts;
      const width = i < 2 ? 0.275 : 0.335;
      const dir = WHEEL_X[i] > 0 ? 1 : -1;
      const pivot = new THREE.Group();
      const side = new THREE.Group();
      const spin = new THREE.Group();
      side.rotation.y = dir > 0 ? 0 : Math.PI;
      const tyre = new THREE.Mesh(parts.tyre, look.tyre);
      const rim = new THREE.Mesh(parts.rim, rimMat);
      const disc = new THREE.Mesh(parts.disc, i < 2 ? look.discF : look.discR);
      tyre.castShadow = rim.castShadow = true;
      spin.add(tyre, rim, disc);
      const blur = new THREE.Mesh(parts.blur, look.blur);
      blur.visible = false;
      blur.renderOrder = 3;
      look.blurMeshes.push(blur);
      side.add(spin, blur);
      // the caliper doesn't turn with the wheel; mirrored (not rotated) on the right, so both
      // sides have it behind the axle
      const cal = new THREE.Mesh(parts.caliper, caliperMat);
      cal.scale.x = dir;
      pivot.add(side, cal);
      // tuck the wheel just inside the fender lip
      const lipX = (i < 2 ? HALF_W(V.cgToFront) : HALF_W(-V.cgToRear)) - 0.012;
      pivot.position.set(dir * (lipX - width / 2), V.wheelRadius, WHEEL_Z[i]);
      this.root.add(pivot);
      this.wheels.push({ pivot, spin, dir, x: WHEEL_X[i], z: WHEEL_Z[i], r: V.wheelRadius });
    }

    for (let i = 0; i < 4 && i < this.wheels.length; i++) {
      this.wheelXs[i] = this.wheels[i].x;
      this.wheelZs[i] = this.wheels[i].z;
    }

    // Soft contact shadow so the car stays grounded even with shadow maps off
    const blobLen = kit ? (kit.zFront - kit.zRear) * (kit.shadow ? 1.55 : 1.36) : 6.2;
    const blobW = kit ? kit.halfW * 2 * (kit.shadow ? 1.75 : 1.6) : 3.1;
    this.shadowBlob = new THREE.Mesh(
      // (plane +y becomes −z once it is laid flat)
      new THREE.PlaneGeometry(blobW, blobLen).translate(0, kit ? -(kit.zFront + kit.zRear) / 2 : 0, 0),
      new THREE.MeshBasicMaterial({ map: kit?.shadow ?? M.blob, transparent: true, depthWrite: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    this.shadowBlob.rotation.x = -Math.PI / 2;
    this.shadowBlob.position.y = 0.03;
    this.shadowBlob.renderOrder = 2;
    this.root.add(this.shadowBlob);

    // Underglow: a soft coloured pool of light on the ground beneath the car (off by default)
    this.glowMat = new THREE.MeshBasicMaterial({ map: M.blob, color: 0x2ad8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 6.4), this.glowMat);
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.035;
    this.glow.renderOrder = 3;
    this.glow.visible = false;
    this.root.add(this.glow);

    // Night light cards: additive decals lying on the road, faded in by setNight()
    const lightTex = lightTextures();
    const card = (w: number, l: number, z0: number, mat: THREE.MeshBasicMaterial) => {
      const g = new THREE.PlaneGeometry(w, l);
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0, z0 + l / 2);
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 6;
      this.lightCards.add(m);
    };
    const cardMat = (map: THREE.Texture, color: number) =>
      new THREE.MeshBasicMaterial({ map, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8, fog: true, toneMapped: true });
    this.beamMat = cardMat(lightTex.beam, 0x000000);
    this.tailGlowMat = cardMat(lightTex.pool, 0x000000);
    this.barGlowMat = cardMat(lightTex.pool, 0x000000);
    card(11, 34, this.zFront - 0.6, this.beamMat);
    card(3.4, 3.2, this.zRear - 2.4, this.tailGlowMat);
    card(3.6, 2.6, this.zFront - 1.4, this.barGlowMat);
    this.lightCards.visible = false;
    this.root.add(this.lightCards);
    // decals on the road and hidden effects: never drawn in reflections or mirrors
    for (const o of [this.lightCards, this.shadowBlob, this.glow, ...this.flames]) mainOnly(o);

    this.root.add(this.body);

    // sort the parts for the level-of-detail switch
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.material === discMat || m.material === caliperMat || (this.wheelLook && (m.material === this.wheelLook.discF || m.material === this.wheelLook.discR || m.material === this.wheelLook.blur))) {
        this.lodFar1.push(m);
        mainOnly(m);
      }
      else if (m.material === M.gloss || m.material === M.carbon || m.material === M.steel || m.material === this.reverseMat || m.material === M.head) this.lodFar2.push(m);
      if (m.castShadow) this.lodShadow.push(m);
    });
    if (kit)
      for (const o of kit.detail1) {
        this.lodFar1.push(o);
        mainOnly(o);
      }
  }

  /** Turn this car into a see-through ghost (one material, no shadows, no light cards). */
  makeGhost(mat: THREE.Material): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      m.receiveShadow = false;
      m.material = mat;
    });
    this.shadowBlob.visible = false;
    this.glow.visible = false;
    this.lightCards.visible = false;
    this.lightCards.removeFromParent();
    this.shadowBlob.removeFromParent();
    this.glow.removeFromParent();
    for (const f of this.flames) f.removeFromParent();
    this.lodShadow.length = 0;
  }

  /** 0 = full detail (near the camera), 1 = no brake detail, 2 = a far-away silhouette. */
  /**
   * Cut the cabin out of this car's body skin (for the cockpit camera). Only the car it is called
   * on is affected: shared materials are cloned for it the first time.
   */
  setCabinCut(on: boolean): void {
    if (this.kit) return; // imported cars keep their own interior
    this.cabinCut.value = on ? 1 : 0;
    if (!on || this.cabinPatched) return;
    this.cabinPatched = true;
    const cut = this.cabinCut;
    const patch = (m: THREE.Material) => {
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (sh, r) => {
        prev.call(m, sh, r);
        sh.uniforms.uCabinCut = cut;
        sh.vertexShader = 'varying vec3 vCabinP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vCabinP = position;');
        sh.fragmentShader =
          'varying vec3 vCabinP;\nuniform float uCabinCut;\n' +
          sh.fragmentShader.replace(
            'void main() {',
            `void main() {
  if (uCabinCut > 0.5 && abs(vCabinP.x) < ${COCKPIT_CUT.halfW.toFixed(3)} && vCabinP.y > ${COCKPIT_CUT.y0.toFixed(3)} && vCabinP.y < 1.3 && vCabinP.z > ${COCKPIT_CUT.z0.toFixed(3)} && vCabinP.z < ${COCKPIT_CUT.z1.toFixed(3)}) discard;`,
          );
      };
      const key = m.customProgramCacheKey.bind(m);
      m.customProgramCacheKey = () => key() + '|cabin';
      m.needsUpdate = true;
    };
    for (const mesh of this.skin) {
      if (mesh.material !== this.paint && mesh.material !== this.tailMat && mesh.material !== this.reverseMat) mesh.material = (mesh.material as THREE.Material).clone();
      patch(mesh.material as THREE.Material);
    }
  }

  setDetail(level: number): void {
    if (level === this.lod) return;
    this.lod = level;
    for (const o of this.lodFar1) o.visible = level < 1;
    for (const o of this.lodFar2) o.visible = level < 2;
    for (const m of this.lodShadow) m.castShadow = level < 2;
    const k = this.kit;
    if (k) {
      // 4.6: full model near, a lighter copy in the middle distance, one low-poly car far away
      const hasMid = k.mid.length > 0;
      if (k.far) k.far.visible = level >= 2;
      for (const o of k.body) o.visible = level === 0 || (level === 1 && !hasMid && !k.detail1.includes(o));
      for (const o of k.mid) o.visible = level === 1;
      k.wheels.forEach((kw, i) => {
        this.wheels[i].pivot.visible = level < 2 || !k.far;
        kw.spin.visible = level === 0 || !kw.spinMid;
        if (kw.spinMid) kw.spinMid.visible = level === 1;
        if (kw.hub) kw.hub.visible = level === 0;
      });
    }
  }

  /** 0 = daylight (no light cards) .. 1 = full night. */
  setNight(k: number): void {
    this.nightK = k;
    this.lightCards.visible = k > 0.01;
    this.beamMat.color.setRGB(1.35 * k, 1.45 * k, 1.6 * k);
    this.barGlowMat.color.setRGB(0.32 * k, 0.4 * k, 0.46 * k);
  }

  /** Apply a full garage look: paint colour and finish, rims, calipers, underglow. */
  setLook(look: CarLook): void {
    this.paintIndex = look.paintIndex;
    const f = FINISHES.find((x) => x.id === look.finish) ?? FINISHES[0];
    this.paint.color.setHex(look.color);
    this.paint.metalness = f.metalness;
    this.paint.roughness = f.roughness;
    this.paint.clearcoat = f.clearcoat;
    this.paint.normalScale.set(look.finish === 'metallic' || look.finish === 'pearl' ? 0.1 : 0.03, look.finish === 'metallic' || look.finish === 'pearl' ? 0.1 : 0.03);
    this.paint.sheen = look.finish === 'pearl' ? 0.6 : 0;
    // 4G.2: pearl shifts colour with the angle, like real pearlescent paint
    this.paint.iridescence = look.finish === 'pearl' ? 0.55 : 0;
    this.paint.clearcoatNormalScale.setScalar(look.finish === 'matte' ? 0 : 0.05);
    this.paint.sheenColor.setHex(0xbfe8ff);
    this.rimMat.color.setHex(look.rim);
    this.caliperMat.color.setHex(look.caliper);
    this.glow.visible = look.underglow !== 0;
    this.glowMat.color.setHex(look.underglow || 0x000000);
    this.glowMat.opacity = look.underglow ? 0.85 : 0;
    this.look = look;
  }
  look: CarLook | null = null;

  setPaint(index: number): void {
    this.paintIndex = ((index % PAINTS.length) + PAINTS.length) % PAINTS.length;
    const p = PAINTS[this.paintIndex];
    this.paint.color.setHex(p.color);
    this.paint.metalness = p.metalness;
    this.paint.roughness = p.roughness;
    this.paint.clearcoat = p.clearcoat;
  }

  /** World position of the exhaust tips' midpoint (for particles / lights). */
  exhaustWorld(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    for (const t of this.exhaust) out.add(t);
    return this.body.localToWorld(out.multiplyScalar(1 / this.exhaust.length));
  }

  /**
   * Pose the car from a physics state. `x,y,z,yaw` etc. are passed separately so the caller can
   * hand in render-interpolated values.
   */
  update(
    s: VehicleState,
    pose: { x: number; y: number; z: number; yaw: number; pitch: number; roll: number },
    time: number,
    dt: number,
  ): void {
    // 5C: the whole car sits in a frame tilted with the ground under its wheels (wheelPose.ts):
    // the wheels stay within their travel under the body instead of standing upright beside it.
    updateFrame(s, pose, this.frame, dt);
    const L = layoutCar(s, pose, this.frame, this.wheelXs, this.wheelZs, this.layout);
    const e = frameEuler(this.frame);
    this.root.position.set(pose.x, this.frame.y, pose.z);
    this.root.rotation.set(e.x, pose.yaw, e.z, 'YXZ');
    // Sprung body: heave relative to the ground plane plus (slightly exaggerated) spring pitch and roll.
    this.body.position.y = L.bodyY;
    this.body.rotation.set(-L.bodyPitch, 0, L.bodyRoll, 'YXZ');

    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.pivot.position.y = L.wheelY[i] + w.r;
      if (i < 2) w.pivot.rotation.y = s.steerAngle;
      // (a bigger wheel turns a little slower for the same road speed)
      w.spin.rotation.x = w.dir * s.wheelRot[i] * (V.wheelRadius / w.r);
    }
    this.wheelFx?.(s, dt);
    // an imported car's own steering wheel (seen in the cockpit view)
    if (this.steerWheel) this.steerWheel.obj.quaternion.setFromAxisAngle(this.steerWheel.axis, -s.steerAngle * COCKPIT.steeringRatio);

    // Lights
    const braking = s.brake > 0.05 && s.gear !== -1;
    this.tailMat.emissiveIntensity = braking || s.handbrake ? 9 : 2.2;
    this.reverseMat.emissiveIntensity = s.gear === -1 ? 5 : 0;

    // Nitrous flames
    this.flameLevel += ((s.nitroActive ? 1 : 0) - this.flameLevel) * Math.min(1, dt * 14);
    const on = this.flameLevel > 0.02;
    this.flameMat.uniforms.uTime.value = time;
    this.flameMat.uniforms.uLevel.value = this.flameLevel;
    for (const f of this.flames) {
      f.visible = on;
      f.scale.set(1 + this.flameLevel * 0.5, 1 + this.flameLevel * 0.5, 0.6 + this.flameLevel * (1.1 + 0.25 * Math.sin(time * 61)));
    }

    // Contact shadow fades and shrinks with height
    const ground = (s.wheelGround[0] + s.wheelGround[1] + s.wheelGround[2] + s.wheelGround[3]) / 4;
    const base = this.frame.y;
    const h = Math.max(0, pose.y - ground);
    const sm = this.shadowBlob.material as THREE.MeshBasicMaterial;
    sm.opacity = 0.55 * clamp(1 - h / 5, 0, 1);
    this.shadowBlob.position.y = ground - base + 0.03;
    this.shadowBlob.scale.setScalar(1 + h * 0.08);
    if (this.lightCards.visible) {
      this.lightCards.position.y = ground - base + 0.04;
      const k = this.nightK * clamp(1 - h / 3, 0, 1);
      const tail = braking || s.handbrake ? 0.45 : 0.15;
      this.tailGlowMat.color.setRGB(tail * k, 0.05 * k, 0.03 * k);
    }
    if (this.glow.visible) {
      this.glow.position.y = ground - base + 0.035;
      this.glowMat.opacity = 0.85 * clamp(1 - h / 2.5, 0, 1);
    }
  }
}
