// ─────────────────────────────────────────────────────────────────────────────
// PoliceCar (4B) — the Proving Grounds police, modelled procedurally. Original designs, and
// invented words only on the livery:
// - Patrol sedan (the main unit): a full-size four-door with real proportions. Bevelled
//   panels, separate doors, windows and pillars, a push bar, mirrors and A-pillar spotlights.
//   Black-and-white two-tone with clearcoat and a reflective stripe, steel wheels, and two
//   officers inside.
// - Unmarked (from Heat 4): the same sedan in dark metallic, no roof bar. Hidden grille strobes,
//   a dash light bar, rear-deck strobes and wig-wag headlights.
// - Heavy pickup (from Heat 3): the faceted crew-cab from 3C, now with the same light system.
// Every unit has:
// - A light bar of four module groups. Patterns: alternating, wig-wag, quad flash and cruise.
// - Headlight wig-wag, grille and rear-deck strobes, alley lights on the bar ends.
// - Brake and reversing lights, suspension pitch and roll, and dents that grow with damage.
//   A wrecked unit loses half its light bar.
// - Three levels of detail: full within 60 m, a plain shell to 200 m, a glowing light-bar
//   sprite beyond that.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mainOnly } from '../core/layers';
import { mergeByMaterial } from '../core/merge';
import { POLICE_LOOK as PL } from '../config';
import { beamTexture, poolTexture } from '../world/textures';
import type { VehicleState } from './VehiclePhysics';
import { frameEuler, layoutCar, newFrame, newLayout, updateFrame } from './wheelPose';

export type PoliceStyle = 'sedan' | 'unmarked' | 'pickup';
export type FlashPattern = 'alternate' | 'wigwag' | 'quad' | 'cruise' | 'off';

/** Light levels for one moment of a pattern: red outer, red inner, blue inner, blue outer, left head, right head. */
export type Flash = [number, number, number, number, number, number];

interface Shared {
  black: THREE.MeshPhysicalMaterial;
  white: THREE.MeshPhysicalMaterial;
  dark: THREE.MeshPhysicalMaterial;
  trim: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  tyre: THREE.MeshStandardMaterial;
  steelRim: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  stripe: THREE.MeshStandardMaterial;
  officer: THREE.MeshStandardMaterial;
  livery: THREE.MeshStandardMaterial;
  roofNo: THREE.MeshStandardMaterial;
  tailgate: THREE.MeshStandardMaterial;
  sedanLower: THREE.BufferGeometry;
  sedanCabin: THREE.BufferGeometry;
  sedanGlass: THREE.BufferGeometry;
  sedanDoors: THREE.BufferGeometry;
  pickLower: THREE.BufferGeometry;
  pickCab: THREE.BufferGeometry;
  pickWin: THREE.BufferGeometry;
  wheelSedan: { tyre: THREE.BufferGeometry; rim: THREE.BufferGeometry };
  wheelPick: { tyre: THREE.BufferGeometry; rim: THREE.BufferGeometry };
  beam: THREE.Texture;
  pool: THREE.Texture;
  glow: THREE.Texture;
}
let shared: Shared | null = null;

/** A side profile (z, y) extruded across the car, with one chamfer so every edge catches light. */
function slab(profile: [number, number][], width: number, bevel: number): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  profile.forEach(([z, y], i) => (i === 0 ? sh.moveTo(z, y) : sh.lineTo(z, y)));
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelSegments: 2, bevelSize: bevel, bevelThickness: bevel, curveSegments: 1 });
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2 - bevel, 0, 0);
  const n = g.toNonIndexed();
  n.computeVertexNormals();
  return n;
}

/**
 * Two dent shapes the damage blends in (morph targets): the nose pushed in and down, and the
 * doors and front wing caved in on both sides.
 */
function addDents(g: THREE.BufferGeometry, noseZ: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const nose = new Float32Array(pos.count * 3);
  const side = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const f = Math.max(0, (z - (noseZ - 0.9)) / 0.9);
    nose[i * 3 + 1] = -f * f * 0.12 * Math.min(1, y / 0.6);
    nose[i * 3 + 2] = -f * f * 0.28;
    const crease = Math.sin(z * 4.3 + 1.1) * 0.5 + 0.5;
    const along = z > -1.4 && z < 1.4 ? Math.cos((z / 1.4) * (Math.PI / 2)) : 0;
    const mid = y > 0.45 && y < 0.95 ? Math.sin(((y - 0.45) / 0.5) * Math.PI) : 0;
    side[i * 3] = -Math.sign(x) * along * mid * (0.05 + 0.07 * crease) * (Math.abs(x) > 0.6 ? 1 : 0);
  }
  g.morphAttributes.position = [new THREE.Float32BufferAttribute(nose, 3), new THREE.Float32BufferAttribute(side, 3)];
  g.morphTargetsRelative = true;
  return g;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function wheelGeo(r: number, w: number, lugs: number): { tyre: THREE.BufferGeometry; rim: THREE.BufferGeometry } {
  const tyre = new THREE.CylinderGeometry(r, r, w, lugs, 1);
  tyre.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(r * 0.64, r * 0.64, w + 0.02, 16, 1);
  rim.rotateZ(Math.PI / 2);
  // a domed hub cap on each face
  const cap = new THREE.SphereGeometry(r * 0.22, 10, 6);
  cap.scale(0.5, 1, 1);
  const a = cap.clone().translate(w / 2 + 0.012, 0, 0);
  const b = cap.clone().translate(-w / 2 - 0.012, 0, 0);
  const merged = mergeGeos([rim.toNonIndexed(), a.toNonIndexed(), b.toNonIndexed()]);
  return { tyre, rim: merged };
}

function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const g of list) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    const p = g.getAttribute('position');
    const q = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.set([p.getX(i), p.getY(i), p.getZ(i)], (o + i) * 3);
      nor.set([q.getX(i), q.getY(i), q.getZ(i)], (o + i) * 3);
    }
    o += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

function getShared(): Shared {
  if (shared) return shared;
  const paint = (color: number, rough: number, metal: number) => new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: metal, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.1 });
  // door livery: the name in two lines over a reflective stripe (invented words only)
  const livery = canvasTex(1024, 256, (g) => {
    g.clearRect(0, 0, 1024, 256);
    g.fillStyle = '#16233a';
    g.font = '600 40px Outfit, "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('PROVING GROUNDS', 512, 62);
    g.font = '800 104px Outfit, "Arial Narrow", Arial, sans-serif';
    g.fillText('HIGHWAY PATROL', 512, 160);
    g.fillStyle = '#c9d3dc';
    g.fillRect(40, 196, 944, 16);
    g.fillStyle = '#16233a';
    g.fillRect(40, 214, 944, 10);
  });
  const roofNo = canvasTex(256, 256, (g) => {
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#111418';
    g.font = '800 120px Outfit, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('PG', 128, 82);
    g.fillText('12', 128, 186);
  });
  const glow = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  });
  const sedanLower: [number, number][] = [
    [-2.56, 0.3], [2.5, 0.3], [2.6, 0.46], [2.57, 0.72], [2.26, 0.86], [0.95, 0.98], [-1.5, 1.0], [-2.36, 0.99], [-2.6, 0.84], [-2.62, 0.48],
  ];
  const sedanCabin: [number, number][] = [
    [-1.48, 0.97], [0.93, 0.97], [0.16, 1.47], [-1.05, 1.49],
  ];
  const sedanGlass: [number, number][] = [
    [-1.5, 0.99], [0.96, 0.99], [0.24, 1.42], [-1.0, 1.43],
  ];
  const sedanDoors: [number, number][] = [
    [-1.36, 0.44], [0.98, 0.44], [0.98, 0.975], [-1.36, 0.995],
  ];
  const pickLower: [number, number][] = [
    [-2.62, 0.48], [2.42, 0.48], [2.66, 0.72], [2.6, 1.06], [1.3, 1.24], [-2.62, 1.24],
  ];
  shared = {
    black: paint(0x0b0c0e, 0.42, 0.25),
    white: paint(0xeef1f4, 0.38, 0.05),
    dark: paint(0x1a1d22, 0.32, 0.6),
    trim: new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.8, metalness: 0.1 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0a1018, roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.62, envMapIntensity: 1.6 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.95, flatShading: true }),
    steelRim: new THREE.MeshStandardMaterial({ color: 0x5b6067, roughness: 0.45, metalness: 0.85 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.5, metalness: 0.7 }),
    stripe: new THREE.MeshStandardMaterial({ color: 0x1a2b48, roughness: 0.35, metalness: 0.3 }),
    officer: new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.9 }),
    livery: new THREE.MeshStandardMaterial({ map: livery, transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    roofNo: new THREE.MeshStandardMaterial({ map: roofNo, transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    tailgate: new THREE.MeshStandardMaterial({
      map: canvasTex(1024, 256, (g) => {
        g.fillStyle = 'rgba(214,220,226,0.92)';
        g.font = '600 46px Outfit, "Arial Narrow", Arial, sans-serif';
        g.textAlign = 'center';
        g.fillText('PROVING GROUNDS', 512, 70);
        g.font = '800 128px Outfit, "Arial Narrow", Arial, sans-serif';
        g.fillText('PATROL', 512, 200);
        g.fillRect(300, 92, 424, 4);
      }),
      transparent: true,
      roughness: 0.5,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
    sedanLower: addDents(slab(sedanLower, 1.94, 0.07), 2.6),
    sedanCabin: slab(sedanCabin, 1.62, 0.08),
    sedanGlass: slab(sedanGlass, 1.66, 0.03),
    sedanDoors: addDents(slab(sedanDoors, 1.955, 0.03), 2.6),
    pickLower: addDents(slab(pickLower, 2.08, 0.1), 2.66),
    pickCab: slab([[-0.9, 1.2], [1.24, 1.2], [0.42, 1.93], [-0.68, 1.96]], 1.86, 0.09),
    pickWin: slab([[-0.78, 1.32], [1.02, 1.32], [0.38, 1.84], [-0.6, 1.86]], 1.9, 0.02),
    wheelSedan: wheelGeo(0.355, 0.26, 20),
    wheelPick: wheelGeo(0.5, 0.42, 14),
    beam: beamTexture(),
    pool: poolTexture(),
    glow,
  };
  return shared;
}

const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
};

export class PoliceCar {
  readonly root = Object.assign(new THREE.Group(), { userData: { noBake: true } });
  readonly style: PoliceStyle;
  private body = new THREE.Group();
  private detail = new THREE.Group(); // dropped beyond `PL.lodDetail`
  private shell = new THREE.Group(); // dropped beyond `PL.lodFar` (the far sprite takes over)
  private wheels: { pivot: THREE.Group; spin: THREE.Group }[] = [];
  private dentMeshes: THREE.Mesh[] = [];
  // light groups: red outer, red inner, blue inner, blue outer, headlight left / right
  private lights: THREE.MeshStandardMaterial[] = [];
  private brake: THREE.MeshStandardMaterial;
  private reverse: THREE.MeshStandardMaterial;
  private alley: THREE.MeshStandardMaterial;
  private cards = new THREE.Group();
  private redPool: THREE.MeshBasicMaterial;
  private bluePool: THREE.MeshBasicMaterial;
  private beam: THREE.MeshBasicMaterial;
  private farSprite: THREE.Sprite;
  private farMat: THREE.SpriteMaterial;
  private night = 0;
  private wet = 0;
  private phase: number;
  private wheelR: number;
  /** 5C: chassis frame and wheel layout (wheelPose.ts) */
  private frame = newFrame();
  private layout = newLayout();
  private wheelXs: number[] = [0, 0, 0, 0];
  private wheelZs: number[] = [0, 0, 0, 0];
  private lastT = -1;
  private lod = 0;
  /** current light levels (for the shared dynamic lights and the rain): red, blue, white */
  readonly glow = { r: 0, b: 0, w: 0 };
  /** 0..1, set by the view from the unit's damage */
  damage = 0;
  pattern: FlashPattern = 'quad';

  constructor(kind: 'cruiser' | 'unmarked' | 'rammer', unit = 0) {
    const M = getShared();
    this.style = kind === 'rammer' ? 'pickup' : kind === 'unmarked' ? 'unmarked' : 'sedan';
    this.phase = unit * 0.137;
    const L = (color: number, emissive: number) => {
      const m = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0, roughness: 0.3 });
      this.lights.push(m);
      return m;
    };
    const rO = L(0x220000, 0xff1424);
    const rI = L(0x220000, 0xff1424);
    const bI = L(0x000822, 0x2058ff);
    const bO = L(0x000822, 0x2058ff);
    const hL = L(0x111111, 0xf2f6ff);
    const hR = L(0x111111, 0xf2f6ff);
    this.brake = new THREE.MeshStandardMaterial({ color: 0x200000, emissive: 0xff1a10, emissiveIntensity: 1.6 });
    this.reverse = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 0 });
    this.alley = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xf8fbff, emissiveIntensity: 0 });
    const b = this.body;
    const D = this.detail;
    const S = this.shell;
    b.add(S, D);

    if (this.style === 'pickup') {
      this.wheelR = 0.5;
      b.position.y = 0.2;
      const lower = new THREE.Mesh(M.pickLower, M.black);
      const cab = new THREE.Mesh(M.pickCab, M.black);
      const win = new THREE.Mesh(M.pickWin, M.glass);
      lower.castShadow = cab.castShadow = true;
      this.dentMeshes.push(lower);
      S.add(lower, cab, win);
      S.add(box(1.86, 0.03, 1.66, M.trim, 0, 1.255, -1.72));
      for (const [z, l] of [[1.62, 1.3], [-1.55, 1.3]] as [number, number][]) {
        for (const sx of [1, -1]) {
          const f = box(0.12, 0.2, l, M.trim, sx * 1.08, 0.98, z);
          f.rotation.z = sx * -0.18;
          D.add(f);
        }
      }
      S.add(box(2.18, 0.26, 0.24, M.trim, 0, 0.6, 2.58), box(2.12, 0.24, 0.2, M.trim, 0, 0.6, -2.66));
      // white LED bar across the nose doubles as the wig-wag headlights (two halves)
      S.add(box(0.96, 0.045, 0.06, hL, 0.5, 1.04, 2.585), box(0.96, 0.045, 0.06, hR, -0.5, 1.04, 2.585));
      this.lightBar(S, D, 0, 1.99, -0.18, 1.5, [rO, rI, bI, bO]);
      D.add(box(0.22, 0.06, 0.04, rI, 0.62, 0.62, 2.71), box(0.22, 0.06, 0.04, bI, -0.62, 0.62, 2.71));
      for (const sx of [1, -1]) {
        D.add(box(0.03, 0.04, 1.6, sx > 0 ? rO : bO, sx * 1.075, 0.55, 0.85));
        D.add(box(0.03, 0.04, 1.6, sx > 0 ? bO : rO, sx * 1.075, 0.55, -0.85));
        S.add(box(0.06, 0.4, 0.04, this.brake, sx * 0.94, 1.0, -2.645));
        D.add(box(0.06, 0.08, 0.04, this.reverse, sx * 0.94, 0.74, -2.645));
      }
      for (const sx of [1, -1]) {
        const l = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.5), M.tailgate);
        l.position.set(sx * 1.052, 0.93, 0.2);
        l.rotation.y = (sx * Math.PI) / 2;
        D.add(l);
      }
      const tg = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.375), M.tailgate);
      tg.position.set(0, 0.95, -2.665);
      tg.rotation.y = Math.PI;
      D.add(tg);
      // steel push bar
      for (const sx of [-0.62, 0.62]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8), M.steel);
        post.position.set(sx, 0.7, 2.88);
        D.add(post);
      }
      for (const y of [0.42, 0.82, 1.12]) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, y > 1 ? 1.4 : 2.1, 8), M.steel);
        bar.rotation.z = Math.PI / 2;
        bar.position.set(0, y, 2.9);
        D.add(bar);
      }
    } else {
      this.wheelR = 0.355;
      const unmarked = this.style === 'unmarked';
      const lower = new THREE.Mesh(M.sedanLower, unmarked ? M.dark : M.black);
      const cabin = new THREE.Mesh(M.sedanCabin, unmarked ? M.dark : M.white);
      const glass = new THREE.Mesh(M.sedanGlass, M.glass);
      lower.castShadow = cabin.castShadow = true;
      this.dentMeshes.push(lower);
      S.add(lower, cabin, glass);
      if (!unmarked) {
        const doors = new THREE.Mesh(M.sedanDoors, M.white);
        this.dentMeshes.push(doors);
        S.add(doors);
      }
      // pillars between the windows, door seams, handles, mirrors
      for (const sx of [1, -1]) {
        const x = sx * 0.835;
        const bp = box(0.03, 0.44, 0.1, M.trim, x, 1.2, -0.22);
        bp.rotation.x = 0.06;
        D.add(bp);
        for (const z of [0.98, -0.2, -1.36]) D.add(box(0.012, 0.52, 0.012, M.trim, sx * 0.982, 0.71, z));
        for (const z of [0.55, -0.55]) D.add(box(0.012, 0.025, 0.14, M.steel, sx * 0.985, 0.86, z));
        const mirror = box(0.16, 0.1, 0.13, unmarked ? M.dark : M.black, sx * 1.03, 1.05, 0.88);
        D.add(mirror, box(0.12, 0.025, 0.05, M.trim, sx * 0.95, 1.02, 0.9));
        // reflective stripe low on the sides
        if (!unmarked) D.add(box(0.008, 0.05, 4.6, M.stripe, sx * 0.976, 0.52, 0));
        // livery
        if (!unmarked) {
          const l = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.52), M.livery);
          l.position.set(sx * 0.985, 0.7, -0.18);
          l.rotation.y = (sx * Math.PI) / 2;
          D.add(l);
        }
        // tail lights: wide red bars in the rear corners, reversing light inboard
        S.add(box(0.42, 0.11, 0.04, this.brake, sx * 0.62, 0.86, -2.6));
        D.add(box(0.12, 0.06, 0.04, this.reverse, sx * 0.32, 0.86, -2.6));
        // headlights: the wig-wag pair
        S.add(box(0.36, 0.09, 0.05, sx > 0 ? hL : hR, sx * 0.62, 0.76, 2.56));
      }
      // grille with hidden strobes, front bumper
      S.add(box(0.8, 0.16, 0.05, M.trim, 0, 0.66, 2.58));
      D.add(box(0.14, 0.04, 0.03, rI, 0.22, 0.64, 2.61), box(0.14, 0.04, 0.03, bI, -0.22, 0.64, 2.61));
      // two officers inside (silhouettes through the glass)
      for (const sx of [0.38, -0.38]) {
        D.add(box(0.42, 0.42, 0.3, M.officer, sx, 1.08, -0.15));
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), M.officer);
        head.position.set(sx, 1.36, -0.12);
        D.add(head);
      }
      // rear-deck strobes inside the rear window
      D.add(box(0.3, 0.04, 0.04, rO, 0.35, 1.34, -1.12), box(0.3, 0.04, 0.04, bO, -0.35, 1.34, -1.12));
      if (unmarked) {
        // dash light bar behind the windscreen, a short antenna
        D.add(box(0.26, 0.035, 0.05, rI, 0.18, 1.33, 0.22), box(0.26, 0.035, 0.05, bI, -0.18, 1.33, 0.22));
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, 0.5, 5), M.trim);
        ant.position.set(0, 1.25, -2.1);
        D.add(ant);
      } else {
        this.lightBar(S, D, 0, 1.52, -0.32, 1.28, [rO, rI, bI, bO]);
        // roof number for the helicopter
        const rn = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), M.roofNo);
        rn.rotation.x = -Math.PI / 2;
        rn.position.set(0, 1.497, -0.75);
        D.add(rn);
        // A-pillar spotlight and the push bar
        const spot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.14, 10), M.steel);
        spot.rotation.x = Math.PI / 2;
        spot.position.set(0.9, 1.12, 0.84);
        D.add(spot);
        for (const sx of [-0.42, 0.42]) D.add(box(0.07, 0.5, 0.07, M.steel, sx, 0.62, 2.7));
        D.add(box(1.0, 0.07, 0.07, M.steel, 0, 0.84, 2.72), box(1.0, 0.07, 0.07, M.steel, 0, 0.48, 2.72));
      }
    }
    this.root.add(b);
    // one draw call per material per group; small details stay out of reflections and mirrors
    mergeByMaterial(S, this.dentMeshes);
    mergeByMaterial(D, this.dentMeshes);
    mainOnly(D);

    // wheels (spun from the physics state)
    const W = this.style === 'pickup' ? M.wheelPick : M.wheelSedan;
    const r = this.wheelR;
    const pos: [number, number][] = this.style === 'pickup' ? [[0.94, 1.62], [-0.94, 1.62], [0.94, -1.55], [-0.94, -1.55]] : [[0.84, 1.5], [-0.84, 1.5], [0.84, -1.48], [-0.84, -1.48]];
    pos.forEach(([x, z]) => {
      const pivot = new THREE.Group();
      const spin = new THREE.Group();
      const tyre = new THREE.Mesh(W.tyre, M.tyre);
      const rim = new THREE.Mesh(W.rim, M.steelRim);
      tyre.castShadow = true;
      spin.add(tyre, rim);
      pivot.add(spin);
      pivot.position.set(x, r, z);
      this.root.add(pivot);
      this.wheelXs[this.wheels.length] = x;
      this.wheelZs[this.wheels.length] = z;
      this.wheels.push({ pivot, spin });
    });

    // night and wet: a white beam ahead, red / blue pools either side
    const card = (w: number, l: number, x: number, z0: number, map: THREE.Texture) => {
      const mat = new THREE.MeshBasicMaterial({ map, color: 0x000000, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
      const g = new THREE.PlaneGeometry(w, l);
      g.rotateX(-Math.PI / 2);
      g.translate(x, 0.04, z0 + l / 2);
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 6;
      this.cards.add(m);
      return mat;
    };
    this.beam = card(11, 30, 0, 2.2, M.beam);
    this.redPool = card(10, 10, 3.4, -5, M.pool);
    this.bluePool = card(10, 10, -3.4, -5, M.pool);
    this.cards.visible = false;
    this.root.add(this.cards);
    mainOnly(this.cards);
    // far away: a glowing light-bar sprite stands in for the car
    this.farMat = new THREE.SpriteMaterial({ map: M.glow, color: 0x000000, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.farSprite = new THREE.Sprite(this.farMat);
    this.farSprite.position.set(0, 1.7, 0);
    this.farSprite.scale.set(3.2, 1.6, 1);
    this.farSprite.visible = false;
    this.root.add(this.farSprite);
    mainOnly(this.farSprite);
  }

  /** A low light bar of four module groups, alley lights on the ends and a clear centre. */
  private lightBar(S: THREE.Group, D: THREE.Group, x: number, y: number, z: number, w: number, mats: THREE.MeshStandardMaterial[]): void {
    const M = getShared();
    S.add(box(w, 0.06, 0.3, M.trim, x, y, z));
    const mod = (w - 0.24) / 4;
    // +x is the car's left: red on the left, blue on the right
    const xs = [x + mod * 1.5 + 0.12, x + mod * 0.5 + 0.06, x - mod * 0.5 - 0.06, x - mod * 1.5 - 0.12];
    for (let i = 0; i < 4; i++) S.add(box(mod - 0.02, 0.07, 0.26, mats[i], xs[i], y + 0.06, z));
    D.add(box(0.1, 0.06, 0.22, this.alley, x + w / 2 + 0.01, y + 0.05, z), box(0.1, 0.06, 0.22, this.alley, x - w / 2 - 0.01, y + 0.05, z));
    D.add(box(0.2, 0.05, 0.06, this.alley, x, y + 0.05, z + 0.14));
  }

  /** 0 = daylight .. 1 = night, and how wet the road is: how strongly the lights paint the road. */
  setNight(k: number, wet = this.wet): void {
    this.night = k;
    this.wet = wet;
    this.beam.color.setRGB(0.6 * k, 0.65 * k, 0.72 * k);
    if (k <= 0.01 && wet <= 0.01) this.cards.visible = false;
  }

  /** One moment of a flash pattern. */
  static flash(pattern: FlashPattern, time: number, phase: number): Flash {
    const f: Flash = [0, 0, 0, 0, 0, 0];
    if (pattern === 'off') return f;
    if (pattern === 'cruise') {
      // steady, dim markers on the bar ends
      f[0] = f[3] = 0.18;
      return f;
    }
    const on = (t: number, a: number, w: number) => (t > a && t < a + w ? 1 : 0);
    if (pattern === 'alternate') {
      // red twice, then blue twice
      const t = (time * 1.6 + phase) % 1;
      const r = on(t, 0, 0.09) || on(t, 0.14, 0.09);
      const b = on(t, 0.5, 0.09) || on(t, 0.64, 0.09);
      f[0] = f[1] = r;
      f[2] = f[3] = b;
      f[4] = r;
      f[5] = b;
    } else if (pattern === 'quad') {
      // four fast flashes a side; the inner modules answer between them
      const t = (time * 1.25 + phase) % 1;
      const half = t < 0.5;
      const q = (t % 0.5) / 0.5;
      const flick = Math.floor(q * 8) % 2 === 0 ? 1 : 0;
      f[0] = half ? flick : 0;
      f[1] = half ? 1 - flick : 0;
      f[2] = half ? 0 : 1 - flick;
      f[3] = half ? 0 : flick;
      f[4] = half ? flick : 0;
      f[5] = half ? 0 : flick;
    } else {
      // wig-wag: corners cross over, fast
      const t = (time * 3.2 + phase) % 1;
      const a = t < 0.5 ? 1 : 0;
      f[0] = a;
      f[2] = a;
      f[1] = 1 - a;
      f[3] = 1 - a;
      f[4] = a;
      f[5] = 1 - a;
    }
    return f;
  }

  /** Pose from a physics state (moving units), or just animate the lights (`s` null: parked). */
  update(s: VehicleState | null, pose: { x: number; y: number; z: number; yaw: number; pitch: number; roll: number } | null, time: number, camDist = 0): void {
    if (pose) {
      if (s) {
        // 5C: the car sits in a frame tilted with the ground; wheels stay within their travel
        const dt = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.lastT));
        this.lastT = time;
        updateFrame(s, pose, this.frame, dt);
        const L = layoutCar(s, pose, this.frame, this.wheelXs, this.wheelZs, this.layout, 1.1, 1.2);
        const e = frameEuler(this.frame);
        this.root.position.set(pose.x, this.frame.y - 0.02, pose.z);
        this.root.rotation.set(e.x, pose.yaw, e.z, 'YXZ');
        this.body.position.y = L.bodyY;
        this.body.rotation.set(-L.bodyPitch, 0, L.bodyRoll, 'YXZ');
        for (let i = 0; i < 4; i++) this.wheels[i].pivot.position.y = L.wheelY[i] + this.wheelR;
      } else {
        this.root.position.set(pose.x, pose.y - 0.02, pose.z);
        this.root.rotation.set(0, pose.yaw, 0);
        this.body.rotation.set(-(pose.pitch ?? 0) * 1.1, 0, (pose.roll ?? 0) * 1.2, 'YXZ');
      }
    }
    // level of detail
    const lod = camDist > PL.lodFar ? 2 : camDist > PL.lodDetail ? 1 : 0;
    if (lod !== this.lod) {
      this.lod = lod;
      this.detail.visible = lod === 0;
      this.shell.visible = lod < 2;
      for (const w of this.wheels) w.pivot.visible = lod < 2;
    }
    if (s && lod < 2) {
      for (let i = 0; i < 4; i++) {
        const w = this.wheels[i];
        if (i < 2) w.pivot.rotation.y = s.steerAngle;
        w.spin.rotation.x = s.wheelRot[i] * (0.33 / this.wheelR);
      }
      this.brake.emissiveIntensity = s.brake > 0.08 && s.gear !== -1 ? 5 : 1.6;
      this.reverse.emissiveIntensity = s.gear === -1 ? 3 : 0;
    }
    // dents
    for (const m of this.dentMeshes) {
      if (!m.morphTargetInfluences) m.updateMorphTargets();
      const inf = m.morphTargetInfluences!;
      inf[0] = Math.min(1, this.damage * 1.2);
      inf[1] = Math.max(0, (this.damage - 0.25) * 1.3);
    }
    // lights: a wrecked unit has lost half its bar
    const f = PoliceCar.flash(this.pattern, time, this.phase);
    const broken = this.damage >= PL.barBreak;
    const k = PL.emissive;
    this.lights[0].emissiveIntensity = f[0] * k;
    this.lights[1].emissiveIntensity = broken ? 0 : f[1] * k;
    this.lights[2].emissiveIntensity = f[2] * k * 1.2;
    this.lights[3].emissiveIntensity = broken ? 0 : f[3] * k * 1.2;
    const head = this.pattern === 'cruise' || this.pattern === 'off' ? 1.4 : 1.4;
    this.lights[4].emissiveIntensity = head + f[4] * 5;
    this.lights[5].emissiveIntensity = head + f[5] * 5;
    this.alley.emissiveIntensity = this.night > 0.3 && this.pattern !== 'off' && this.pattern !== 'cruise' ? 4 : 0;
    const red = Math.max(f[0], broken ? 0 : f[1]);
    const blue = Math.max(f[2], broken ? 0 : f[3]);
    this.glow.r = red;
    this.glow.b = blue;
    this.glow.w = Math.max(f[4], f[5]);
    // road light: at night, and on a wet road at any time
    const kk = Math.max(this.night, this.wet * 0.55);
    this.cards.visible = kk > 0.01 && lod < 2;
    if (this.cards.visible) {
      this.beam.color.setRGB(0.6 * this.night, 0.65 * this.night, 0.72 * this.night);
      this.redPool.color.setRGB(0.6 * red * kk, 0.03 * red * kk, 0.05 * red * kk);
      this.bluePool.color.setRGB(0.04 * blue * kk, 0.13 * blue * kk, 0.7 * blue * kk);
    }
    this.farSprite.visible = lod === 2 && red + blue > 0;
    if (this.farSprite.visible) this.farMat.color.setRGB(red * 1.6, 0.1, blue * 1.8);
  }

  /** current flash colour for a dynamic light (black when dark) */
  lightColour(out: THREE.Color): THREE.Color {
    return out.setRGB(this.glow.r, 0.04 + 0.2 * this.glow.w, this.glow.b);
  }

  /** world position of a rear wheel (for spray and smoke) */
  rearWheel(i: 0 | 1, out: THREE.Vector3): THREE.Vector3 {
    const w = this.wheels[2 + i].pivot;
    return w.getWorldPosition(out);
  }
  /** world position of the bonnet (smoke from a wrecked unit) */
  bonnet(out: THREE.Vector3): THREE.Vector3 {
    return this.root.localToWorld(out.set(0, 1.0, this.style === 'pickup' ? 2.0 : 1.8));
  }
}
