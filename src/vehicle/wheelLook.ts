// ─────────────────────────────────────────────────────────────────────────────
// 5C: realistic wheels for the built-in car (every rival without an imported model uses it).
//
//  • tyre: a rounded lathe profile with a tread band, raised sidewall lettering (our own brand,
//    "APEX TRACTION"), and a vertex bulge where it meets the road (in world space, so it stays at
//    the bottom while the tyre rolls)
//  • rim: a deep barrel, a polished lip, twisted spokes, five lug bolts and a centre-lock nut
//  • brakes: a slotted disc on a hat, and a proper caliper shape hugging it; the discs glow
//    after hard braking and cool over a few seconds
//  • motion blur: at speed a soft disc fades in over the spokes, so they blur instead of strobing
//  • the surface on the tyres: wet and glossy in the rain, mud after the grass, a crust of snow
//
// Draw calls per wheel are as before (tyre, rim, disc, caliper) plus the blur disc only while
// the wheel is spinning fast.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VEHICLE as V } from '../config';
import { clamp01, smoothstep } from '../core/math';
import type { VehicleState } from './VehiclePhysics';
import { Surface } from '../world/WorldData';

export const RIM_R = 0.272;

/** Profile of the tyre (radius, axle position as a share of half the width): inner bead → outer bead. */
function tyreProfile(R: number, hw: number): THREE.Vector2[] {
  return [
    [RIM_R - 0.006, -hw],
    [RIM_R + 0.03, -hw],
    [R - 0.046, -hw * 0.99],
    [R - 0.017, -hw * 0.9],
    [R - 0.004, -hw * 0.74],
    [R, -hw * 0.5],
    [R, hw * 0.5],
    [R - 0.004, hw * 0.74],
    [R - 0.017, hw * 0.9],
    [R - 0.046, hw * 0.99],
    [RIM_R + 0.03, hw],
    [RIM_R - 0.006, hw],
  ].map(([r, y]) => new THREE.Vector2(r, y));
}
const PROFILE_N = 12;

export interface WheelParts {
  tyre: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  disc: THREE.BufferGeometry;
  caliper: THREE.BufferGeometry;
  blur: THREE.BufferGeometry;
}

/** One wheel's geometry, +x = the outer face. */
export function buildWheelParts(width: number): WheelParts {
  const R = V.wheelRadius;
  const hw = width / 2;
  const tyre = new THREE.LatheGeometry(tyreProfile(R, hw), 56);
  tyre.rotateZ(-Math.PI / 2); // lathe axis Y → wheel axle X  (+X = outer face)

  const parts: THREE.BufferGeometry[] = [];
  const barrel = new THREE.CylinderGeometry(RIM_R, RIM_R * 0.985, width * 0.96, 44, 1, true);
  barrel.rotateZ(-Math.PI / 2);
  parts.push(barrel);
  // a deep, stepped lip: the polished outer edge and the drop into the barrel behind the spokes
  const lip = new THREE.TorusGeometry(RIM_R - 0.003, 0.012, 8, 48);
  lip.rotateY(Math.PI / 2);
  lip.translate(hw - 0.012, 0, 0);
  parts.push(lip);
  const step = new THREE.CylinderGeometry(RIM_R - 0.012, RIM_R - 0.03, 0.03, 44, 1, true);
  step.rotateZ(-Math.PI / 2);
  step.translate(hw - 0.035, 0, 0);
  parts.push(step);
  const SPOKES = 10;
  const face = hw - 0.055;
  for (let i = 0; i < SPOKES; i++) {
    // split spokes, each a pair of twisted blades running from the hub out to the lip
    for (const off of [-0.022, 0.022]) {
      const len = RIM_R - 0.06;
      const spoke = new THREE.BoxGeometry(0.03, len, 0.018);
      spoke.translate(0, 0.055 + len / 2, off);
      spoke.rotateY(0.45);
      // dished: the outer end of the spoke sits further out than the hub end
      spoke.rotateZ(-0.12);
      spoke.applyMatrix4(new THREE.Matrix4().makeRotationX((i / SPOKES) * Math.PI * 2));
      spoke.translate(face, 0, 0);
      parts.push(spoke);
    }
  }
  const hub = new THREE.CylinderGeometry(0.068, 0.08, 0.06, 24);
  hub.rotateZ(-Math.PI / 2);
  hub.translate(face - 0.005, 0, 0);
  parts.push(hub);
  // five lug bolts round the hub, and the centre-lock nut over them
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const bolt = new THREE.CylinderGeometry(0.011, 0.011, 0.022, 6);
    bolt.rotateZ(-Math.PI / 2);
    bolt.translate(face + 0.03, Math.cos(a) * 0.05, Math.sin(a) * 0.05);
    parts.push(bolt);
  }
  const nut = new THREE.CylinderGeometry(0.03, 0.034, 0.03, 6);
  nut.rotateZ(-Math.PI / 2);
  nut.translate(face + 0.042, 0, 0);
  parts.push(nut);
  const cap = new THREE.SphereGeometry(0.02, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.rotateZ(-Math.PI / 2);
  cap.translate(face + 0.057, 0, 0);
  parts.push(cap);
  const rim = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => (g.deleteAttribute('uv'), g)))!;

  // disc: a slotted rotor on a darker hat (one cylinder: its caps carry the slot texture)
  const disc = new THREE.CylinderGeometry(0.205, 0.205, 0.028, 40);
  disc.rotateZ(-Math.PI / 2);
  disc.translate(hw * 0.2, 0, 0);

  // caliper: a curved block hugging the top-rear of the disc, outboard of it
  const sh = new THREE.Shape();
  const a0 = Math.PI * 0.05;
  const a1 = Math.PI * 0.45;
  const r0 = 0.125;
  const r1 = 0.228;
  sh.absarc(0, 0, r1, a0, a1, false);
  sh.absarc(0, 0, r0, a1, a0, true);
  const cal = new THREE.ExtrudeGeometry(sh, { depth: 0.062, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 10 });
  // drawn in XY (+x becomes −z, behind the axle, after the turn), extruded along +z → the axle
  cal.rotateY(Math.PI / 2);
  cal.translate(hw * 0.2 - 0.004, 0, 0);
  const caliper = cal;

  // motion blur over the spokes
  const blur = new THREE.RingGeometry(0.06, RIM_R - 0.012, 40, 1);
  blur.rotateY(Math.PI / 2);
  blur.translate(face + 0.02, 0, 0);
  return { tyre, rim, disc, caliper, blur };
}

// ── Textures (shared by every car) ───────────────────────────────────────────

let tyreTex: THREE.CanvasTexture | null = null;
/** Tread grooves and sipes on the crown, raised lettering on both sidewalls (map and bump). */
export function tyreTexture(): THREE.CanvasTexture {
  if (tyreTex) return tyreTex;
  const W = 2048;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1b1b1c';
  g.fillRect(0, 0, W, H);
  // rows by profile point (the lathe's v runs 0 → 1 from the inner bead to the outer bead; the
  // canvas is flipped on upload, so v = 0 is the bottom row)
  const rowOf = (j: number) => (1 - j / (PROFILE_N - 1)) * H;
  // the crown: points 4..7; grooves run round the tyre, short sipes across it
  const c0 = rowOf(7);
  const c1 = rowOf(4);
  g.fillStyle = '#121213';
  g.fillRect(0, c0, W, c1 - c0);
  g.fillStyle = '#050505';
  for (const f of [0.3, 0.5, 0.7]) g.fillRect(0, c0 + (c1 - c0) * f - 3, W, 6);
  for (let x = 0; x < W; x += 16) {
    g.fillRect(x, c0 + (c1 - c0) * 0.08, 3, (c1 - c0) * 0.16);
    g.fillRect(x + 8, c0 + (c1 - c0) * 0.76, 3, (c1 - c0) * 0.16);
  }
  // sidewall lettering: points 9..10 (outer) and 1..2 (inner), drawn three times round
  const side = (ja: number, jb: number, flip: boolean) => {
    const y0 = rowOf(ja);
    const y1 = rowOf(jb);
    const top = Math.min(y0, y1);
    const h = Math.abs(y1 - y0);
    g.save();
    g.beginPath();
    g.rect(0, top, W, h);
    g.clip();
    g.fillStyle = '#8b8b8d';
    g.textBaseline = 'middle';
    for (let k = 0; k < 3; k++) {
      const x = (k / 3) * W;
      g.save();
      g.translate(x + W / 6, top + h / 2);
      // text "up" points out from the rim: towards the tread
      if (flip) g.scale(-1, -1);
      else g.scale(1, 1);
      g.font = `bold ${Math.round(h * 0.62)}px Arial, Helvetica, sans-serif`;
      g.textAlign = 'center';
      g.fillText('APEX  TRACTION', 0, 0);
      g.font = `${Math.round(h * 0.34)}px Arial, Helvetica, sans-serif`;
      g.fillText('275/35 ZR20   ·   SPEED RATED Y', W / 3 - W / 6 - 40, h * 0.05);
      g.restore();
    }
    g.restore();
  };
  side(9, 10, true);
  side(1, 2, false);
  tyreTex = new THREE.CanvasTexture(c);
  tyreTex.colorSpace = THREE.SRGBColorSpace;
  tyreTex.anisotropy = 8;
  return tyreTex;
}

let discTex: THREE.CanvasTexture | null = null;
/** The rotor's face: a swept ring with curved slots, a darker hat in the middle. */
export function discTexture(): THREE.CanvasTexture {
  if (discTex) return discTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const m = S / 2;
  g.fillStyle = '#9a9ca2';
  g.fillRect(0, 0, S, S);
  // the friction ring: fine concentric scoring
  for (let r = m * 0.62; r < m; r += 2) {
    g.strokeStyle = `rgba(${r % 4 ? 70 : 150},${r % 4 ? 72 : 152},${r % 4 ? 78 : 160},0.35)`;
    g.beginPath();
    g.arc(m, m, r, 0, Math.PI * 2);
    g.stroke();
  }
  // curved slots
  g.strokeStyle = '#2a2b2e';
  g.lineWidth = 3;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    g.beginPath();
    g.arc(m + Math.cos(a) * m * 0.3, m + Math.sin(a) * m * 0.3, m * 0.5, a + 0.25, a + 0.6);
    g.stroke();
  }
  // the hat
  g.fillStyle = '#3a3b3f';
  g.beginPath();
  g.arc(m, m, m * 0.58, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2b2c30';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.beginPath();
    g.arc(m + Math.cos(a) * m * 0.25, m + Math.sin(a) * m * 0.25, m * 0.05, 0, Math.PI * 2);
    g.fill();
  }
  discTex = new THREE.CanvasTexture(c);
  discTex.colorSpace = THREE.SRGBColorSpace;
  return discTex;
}

let blurTex: THREE.CanvasTexture | null = null;
/** Spokes smeared round by the spin: soft concentric bands, denser towards the rim. */
function blurTexture(): THREE.CanvasTexture {
  if (blurTex) return blurTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const m = S / 2;
  g.clearRect(0, 0, S, S);
  for (let r = m * 0.2; r < m; r += 1) {
    const t = r / m;
    const a = 0.55 + 0.3 * t + 0.08 * Math.sin(r * 0.9);
    const v = Math.round(255 * (0.75 + 0.25 * Math.sin(r * 0.35)));
    g.strokeStyle = `rgba(${v},${v},${v},${a.toFixed(3)})`;
    g.beginPath();
    g.arc(m, m, r, 0, Math.PI * 2);
    g.stroke();
  }
  blurTex = new THREE.CanvasTexture(c);
  blurTex.colorSpace = THREE.SRGBColorSpace;
  return blurTex;
}

/**
 * The tyre material: shared texture; per car so the surface on it (water, mud, snow) can differ.
 * The vertex shader flattens the bottom of the tyre onto the road and bulges the sidewalls out a
 * little there, in world space, so the bulge stays at the bottom while the tyre rolls.
 */
export function makeTyreMaterial(): THREE.MeshStandardMaterial {
  const tex = tyreTexture();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, bumpMap: tex, bumpScale: 1.6, metalness: 0, roughness: 0.92 });
  const R = V.wheelRadius;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `
      vec4 tyC = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vec3 tyAx = normalize(modelMatrix[0].xyz);
      vec4 tyP = modelMatrix * vec4(transformed, 1.0);
      vec3 tyRel = tyP.xyz - tyC.xyz;
      vec3 tyRad = tyRel - tyAx * dot(tyRel, tyAx);
      vec3 tyDown = vec3(0.0, -1.0, 0.0) - tyAx * tyAx.y;
      tyDown = normalize(tyDown + vec3(0.0, -1e-4, 0.0));
      float tyD = dot(tyRad, tyDown);
      // the contact patch: flattened by 12 mm, and the sidewall bulges out by up to 9 mm there
      float tyOver = tyD - ${(R - 0.012).toFixed(4)};
      if (tyOver > 0.0) tyP.xyz -= tyDown * tyOver;
      float tyBul = smoothstep(${(R * 0.62).toFixed(4)}, ${(R * 0.97).toFixed(4)}, tyD) * smoothstep(0.55, 0.95, dot(normalize(tyRad + tyDown * 1e-4), tyDown));
      tyP.xyz += tyAx * sign(transformed.x) * tyBul * 0.009;
      vec4 mvPosition = viewMatrix * tyP;
      gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  m.customProgramCacheKey = () => 'tyre-5c';
  return m;
}

/** Per-car wheel state and materials: brake heat, the blur, the surface on the tyres. */
export class WheelLook {
  readonly tyre = makeTyreMaterial();
  readonly discF: THREE.MeshStandardMaterial;
  readonly discR: THREE.MeshStandardMaterial;
  readonly blur: THREE.MeshStandardMaterial;
  readonly blurMeshes: THREE.Mesh[] = [];
  private heatF = 0;
  private heatR = 0;
  private wet = 0;
  private mud = 0;
  private snowy = 0;
  private omega = 0;

  constructor(private rim: THREE.MeshStandardMaterial) {
    const base = { color: 0xffffff, map: discTexture(), metalness: 0.85, roughness: 0.4, emissive: new THREE.Color(1.0, 0.3, 0.06), emissiveIntensity: 0 };
    this.discF = new THREE.MeshStandardMaterial(base);
    this.discR = new THREE.MeshStandardMaterial(base);
    this.blur = new THREE.MeshStandardMaterial({ color: rim.color.clone(), map: blurTexture(), transparent: true, opacity: 0, depthWrite: false, metalness: 0.7, roughness: 0.45 });
  }

  /**
   * Once per frame. `weather` is the scene's rain and snow (0..1); `detail` false at a distance
   * (no blur disc).
   */
  update(s: VehicleState, dt: number, weather: { wet: number; snow: number }, detail: boolean): void {
    // brakes heat with braking power and cool by themselves and in the airflow
    const brakeW = s.gear === -1 ? 0 : s.brake * s.speed;
    const cool = (h: number) => h * (0.22 + 0.006 * s.speed);
    this.heatF = clamp01(this.heatF + (brakeW * 0.0105 - cool(this.heatF)) * dt);
    this.heatR = clamp01(this.heatR + (brakeW * 0.0062 + (s.handbrake ? s.speed * 0.006 : 0) - cool(this.heatR)) * dt);
    this.discF.emissiveIntensity = 4.5 * smoothstep(0.35, 1, this.heatF) ** 1.5;
    this.discR.emissiveIntensity = 4.5 * smoothstep(0.35, 1, this.heatR) ** 1.5;

    // spokes blur from ~30 km/h (where they start to strobe at 60 fps) to fully smeared by ~70
    this.omega += (Math.abs(s.forwardSpeed) / V.wheelRadius - this.omega) * Math.min(1, dt * 8);
    const b = detail ? smoothstep(22, 52, this.omega) * 0.92 : 0;
    this.blur.opacity = b;
    this.blur.color.copy(this.rim.color);
    for (const m of this.blurMeshes) m.visible = b > 0.02;

    // what's on the tyres: water in the rain (and spray), mud after grass and gravel, snow crust
    let off = 0;
    for (let i = 0; i < 4; i++) if (s.wheelContact[i] && (s.wheelSurface[i] === Surface.Grass || s.wheelSurface[i] === Surface.Gravel)) off += 0.25;
    this.wet += (clamp01(weather.wet * 1.2) - this.wet) * Math.min(1, dt * 0.8);
    this.mud = clamp01(this.mud + (off * (0.25 + s.speed * 0.02) - this.mud * (0.012 + weather.wet * 0.05 + (off ? 0 : s.speed * 0.0006))) * dt);
    this.snowy += (weather.snow * (0.55 + 0.45 * off) - this.snowy) * Math.min(1, dt * 0.5);
    // colour: the base map is dark rubber; mud warms and lightens it, snow whitens the shoulders
    const r = 1 + this.mud * 1.1 + this.snowy * 2.4;
    const gr = 1 + this.mud * 0.75 + this.snowy * 2.4;
    const bl = 1 + this.mud * 0.35 + this.snowy * 2.6;
    const dark = 1 - this.wet * 0.35;
    this.tyre.color.setRGB(r * dark, gr * dark, bl * dark);
    this.tyre.roughness = Math.max(0.3, 0.92 - this.wet * 0.55 + this.mud * 0.05 - this.snowy * 0.1);
    this.rim.roughness = Math.min(0.85, this.rimBaseRough + this.mud * 0.4 + this.snowy * 0.25 - this.wet * 0.08);
  }
  /** the rim's own roughness before grime (from the garage finish) */
  rimBaseRough = 0.3;
}
