// ─────────────────────────────────────────────────────────────────────────────
// ImportedCars (4.5) — real 3D car models brought into the game from a personal car pack.
//
// tools/car-import turns a model (.blend / .fbx / .obj) into a pack entry in cars/cars.js: two
// meshopt-compressed glTF files (full detail and a far-away copy) plus a little metadata, all as
// base64 so the game finds them with a plain <script> tag, even from a double-clicked file.
//
// The converter names the model's parts and material slots in a fixed way (see
// tools/car-import/README.md): body, cabin, under, steer, wheel_FL..RR, hub_FL..RR and ap_<slot>
// materials. Here every slot gets the game's own material: the paint, rims and callipers follow
// the garage, the lamps follow the brake pedal and the headlight switch, the glass gets the rain
// beads, the same as on the Phantom X1.
//
// Packs are personal (cars/ is git-ignored). Online, a friend who does not have your pack sees
// your car as a Phantom X1 in your colours.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { VEHICLE as V } from '../config';
import { CAR_MODELS, ImportedCarInfo, modelOf, registerImportedCar } from './Cars';
import { addBeads, CarKit, CarKitBuilder, KitMats, PhantomX1, sharedMaterials } from './PhantomX1';

interface PackWheel {
  pos: [number, number, number];
  radius: number;
  width: number;
}
interface PackEntry extends ImportedCarInfo {
  lod0: string; // base64 .glb
  lod1?: string;
  shadow?: string; // data: URL of a baked ground shadow (white = lit)
  meta: {
    wheels: Record<'FL' | 'FR' | 'RL' | 'RR', PackWheel>;
    steer?: { pos: [number, number, number]; axis: [number, number, number] };
    exhaust?: [number, number, number][];
    eye?: [number, number, number];
  };
}

interface LoadedModel {
  entry: PackEntry;
  lod0: THREE.Group;
  lod1: THREE.Group | null;
  shadow: THREE.Texture | null;
  /** model space → car space: the model's axle midpoint goes over the physics axle midpoint */
  dz: number;
  zFront: number;
  zRear: number;
  halfW: number;
}

const models = new Map<string, LoadedModel>();

function packEntries(): PackEntry[] {
  const list = (window as unknown as { __APEX_CARS__?: unknown }).__APEX_CARS__;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (e): e is PackEntry => !!e && typeof e === 'object' && typeof (e as PackEntry).id === 'string' && typeof (e as PackEntry).lod0 === 'string' && !!(e as PackEntry).meta?.wheels,
  );
}

/** Put the pack's cars in the catalogue (car select, garage, online). Synchronous; call first. */
export function registerImportedCars(): void {
  for (const e of packEntries()) registerImportedCar(e);
}

function decode(b64: string): ArrayBuffer {
  const s = atob(b64.replace(/^data:[^,]*,/, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

async function parse(loader: GLTFLoader, b64: string): Promise<THREE.Group> {
  const gltf = await loader.parseAsync(decode(b64), '');
  return gltf.scene;
}

/** Decode and parse every pack car. A car that fails to load drops back to the Phantom X1. */
export async function loadImportedCars(onProgress?: (name: string) => void): Promise<void> {
  const entries = packEntries();
  if (!entries.length) return;
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  for (const e of entries) {
    if (!CAR_MODELS.some((m) => m.id === e.id) || models.has(e.id)) continue;
    onProgress?.(e.name);
    try {
      const lod0 = await parse(loader, e.lod0);
      const lod1 = e.lod1 ? await parse(loader, e.lod1).catch(() => null) : null;
      let shadow: THREE.Texture | null = null;
      if (e.shadow) {
        shadow = await new THREE.TextureLoader().loadAsync(e.shadow).catch(() => null);
        if (shadow) prepShadow(shadow);
      }
      const w = e.meta.wheels;
      const mid = (w.FL.pos[2] + w.RL.pos[2]) / 2;
      const dz = (V.cgToFront - V.cgToRear) / 2 - mid;
      const box = new THREE.Box3().setFromObject(lod0);
      models.set(e.id, { entry: e, lod0, lod1, shadow, dz, zFront: box.max.z + dz, zRear: box.min.z + dz, halfW: Math.max(-box.min.x, box.max.x) });
    } catch (err) {
      console.warn(`car pack: ${e.name} could not be loaded`, err);
    }
  }
}

/** The baked shadow is white where lit; the blob shader wants black with alpha. */
function prepShadow(t: THREE.Texture): void {
  const img = t.image as HTMLImageElement;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const a = 255 - d.data[i];
    d.data[i] = d.data[i + 1] = d.data[i + 2] = 0;
    d.data[i + 3] = a;
  }
  ctx.putImageData(d, 0, 0);
  t.image = c;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
}

/** True when this edition's model is an imported car that has loaded. */
export function hasImportedModel(editionId: string): boolean {
  const m = modelOf(editionId);
  return m.visual === 'imported' && models.has(m.id);
}

/** Build the right visual for an edition: the imported model when it is here, else the Phantom X1. */
export function makeCarVisual(editionId: string): PhantomX1 {
  const m = modelOf(editionId);
  const lm = m.visual === 'imported' ? models.get(m.id) : undefined;
  return lm ? new PhantomX1(kitBuilder(lm)) : new PhantomX1();
}

// ── Materials ───────────────────────────────────────────────────────────────
type Shared = Record<string, THREE.Material>;
let shared: Shared | null = null;

function sharedSlots(): Shared {
  if (shared) return shared;
  const M = sharedMaterials();
  const std = (color: number, roughness: number, metalness: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0b1216, metalness: 0.1, roughness: 0.02, ior: 1.52, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.015,
    envMapIntensity: 1.9, transparent: true, opacity: 0.62, depthWrite: false,
  });
  glass.clearcoatNormalMap = M.peel;
  glass.clearcoatNormalScale = new THREE.Vector2(0.015, 0.015);
  addBeads(glass, 'glass-imp', 'vBeadP.xz * 34.0 + vBeadP.y * 9.0', true);
  shared = {
    glass,
    lens: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.03, transmission: 0, transparent: true, opacity: 0.16, depthWrite: false, clearcoat: 1, envMapIntensity: 2 }),
    head: M.head,
    lamp: std(0xb8bcc4, 0.12, 1),
    rim_dark: std(0x141518, 0.35, 0.8),
    tyre: M.tyre,
    disc: M.disc,
    black: new THREE.MeshPhysicalMaterial({ color: 0x08090a, metalness: 0.2, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
    trim: std(0x0b0b0c, 0.85, 0.05),
    chrome: std(0xd4d8de, 0.07, 1),
    dark_chrome: std(0x3c3e43, 0.18, 1),
    metal: std(0x1d1e21, 0.55, 0.7),
    mirror: std(0xe8eef4, 0.02, 1),
    int: std(0x141416, 0.78, 0.02),
    int_red: std(0x8c1010, 0.62, 0.02),
    int_trim: std(0x5a5c61, 0.32, 0.85),
  };
  return shared;
}

/** One copy per model of the materials that carry the model's own textures. */
const texturedCache = new Map<string, Shared>();
function texturedSlots(id: string, src: Record<string, THREE.MeshStandardMaterial>): Shared {
  let t = texturedCache.get(id);
  if (t) return t;
  const map = (k: string) => src[k]?.map ?? null;
  t = {
    carbon: new THREE.MeshPhysicalMaterial({ color: 0x9a9da4, map: map('carbon'), metalness: 0.35, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.06 }),
    grille: new THREE.MeshStandardMaterial({ color: 0x0c0c0d, metalness: 0.6, roughness: 0.45, alphaMap: null, map: map('grille'), alphaTest: 0.5, side: THREE.DoubleSide }),
    dash: new THREE.MeshStandardMaterial({ color: 0xffffff, map: map('dash'), metalness: 0.1, roughness: 0.6 }),
    emblem: new THREE.MeshStandardMaterial({ color: 0xffffff, map: map('emblem'), metalness: 0.55, roughness: 0.3 }),
  };
  // the grille's opacity lives in the colour texture: use it as the alpha map instead
  const g = t.grille as THREE.MeshStandardMaterial;
  if (g.map) {
    g.alphaMap = g.map;
    g.map = null;
  }
  texturedCache.set(id, t);
  return t;
}

function kitBuilder(lm: LoadedModel): CarKitBuilder {
  return (mats: KitMats): CarKit => {
    const S = sharedSlots();
    // the source materials by slot (for their textures)
    const src: Record<string, THREE.MeshStandardMaterial> = {};
    lm.lod0.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (m.name.startsWith('ap_')) src[m.name.slice(3)] = m as THREE.MeshStandardMaterial;
    });
    const T = texturedSlots(lm.entry.id, src);
    const own: Record<string, THREE.Material> = { paint: mats.paint, tail: mats.tail, rim: mats.rim, caliper: mats.caliper };
    const dress = (root: THREE.Object3D, shadows: boolean) => {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const name = (mesh.material as THREE.Material).name.replace(/^ap_/, '');
        mesh.material = own[name] ?? T[name] ?? S[name] ?? S.black;
        const see = name !== 'glass' && name !== 'lens' && name !== 'head' && name !== 'tail';
        mesh.castShadow = shadows && see;
        mesh.receiveShadow = false;
      });
    };
    const scene = lm.lod0.clone(true);
    dress(scene, true);
    const node = (n: string) => scene.getObjectByName(n) ?? null;
    const place = (o: THREE.Object3D | null) => {
      if (o) o.position.z += lm.dz;
      return o;
    };
    const body: THREE.Object3D[] = [];
    const detail1: THREE.Object3D[] = [];
    for (const n of ['body', 'cabin', 'under']) {
      const o = place(node(n));
      if (!o) continue;
      o.removeFromParent();
      body.push(o);
      if (n !== 'body') detail1.push(o);
    }
    const st = lm.entry.meta.steer;
    const steerObj = place(node('steer'));
    let steer: CarKit['steer'] = null;
    if (steerObj) {
      steerObj.removeFromParent();
      body.push(steerObj);
      detail1.push(steerObj);
      if (st) steer = { obj: steerObj, axis: new THREE.Vector3(...st.axis).normalize() };
    }
    const w = lm.entry.meta.wheels;
    const wheels: CarKit['wheels'] = (['FL', 'FR', 'RL', 'RR'] as const).map((k) => {
      const spin = node(`wheel_${k}`)!;
      const hub = node(`hub_${k}`);
      spin.removeFromParent();
      spin.position.set(0, 0, 0);
      if (hub) {
        hub.removeFromParent();
        hub.position.set(0, 0, 0);
        detail1.push(hub);
      }
      return { spin, hub, x: w[k].pos[0], z: w[k].pos[2] + lm.dz, r: w[k].radius };
    });
    let far: THREE.Object3D | null = null;
    if (lm.lod1) {
      far = lm.lod1.clone(true);
      dress(far, false);
      far.position.z = lm.dz;
    }
    const v3 = (p: [number, number, number]) => new THREE.Vector3(p[0], p[1], p[2] + lm.dz);
    return {
      body, detail1, far, wheels, steer,
      zFront: lm.zFront, zRear: lm.zRear, halfW: lm.halfW,
      exhaust: (lm.entry.meta.exhaust ?? []).map(v3),
      eye: lm.entry.meta.eye ? v3(lm.entry.meta.eye) : null,
      shadow: lm.shadow,
    };
  };
}
