// ─────────────────────────────────────────────────────────────────────────────
// PursuitView — draws everything the Pursuit logic owns: police units, the helicopter,
// work-zone pieces, roadblocks, spike strips, speed-trap gantries and the pursuit breakers
// (scaffolding, a container stack, a timing tower) with their collapse.
// The gantries and breakers are part of the scenery in every race; the rest only in pursuit.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { PHYSICS_DT, POLICE_LOOK } from '../config';
import { Particles } from '../fx/Particles';
import { Obstacle, Pursuit, type Drop } from '../game/Pursuit';
import { POLICE } from '../config';
import { vegUniforms } from './Vegetation';
import { mainOnly } from '../core/layers';
import { Helicopter } from '../vehicle/Helicopter';
import { FlashPattern, PoliceCar } from '../vehicle/PoliceCar';
import { mergeByMaterial } from '../core/merge';
import { WorldData } from './WorldData';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function labelTexture(lines: [string, number, string][], w = 512, h = 128, bg = '#101316'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const [text, y, font] of lines) {
    g.font = font;
    g.fillStyle = '#eef3f6';
    g.fillText(text, w / 2, y);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stripeTexture(a: string, b: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = a;
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = b;
  for (let x = -32; x < 160; x += 32) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 32);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 0);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

interface BreakerVis {
  group: THREE.Group;
  pivot: THREE.Group;
  marker: THREE.Mesh;
  fallT: number;
  down: boolean;
}

export class PursuitView {
  private units: PoliceCar[] = [];
  private blockPool: PoliceCar[] = [];
  private obs = new Map<number, { mesh: THREE.Object3D; car?: PoliceCar; brokenSeen: boolean; spin: number; t: number }>();
  private gantries: { flash: THREE.MeshStandardMaterial; led: THREE.MeshStandardMaterial; flashT: number }[] = [];
  private breakers: BreakerVis[] = [];
  readonly heli: Helicopter;
  private lights: THREE.PointLight[] = [];
  private pursuit: Pursuit | null = null;
  private night = 0;
  private mats: Record<string, THREE.Material> = {};
  private geos: Record<string, THREE.BufferGeometry> = {};
  private heliSpotAdded = false;
  private tmpC = new THREE.Color();
  // 4E: Air One's drops: the falling canister, the warning marker on the road, the smoke and bang
  private dropVis = new Map<number, { obj: THREE.Object3D; led?: THREE.MeshStandardMaterial; marker: THREE.Mesh; mmat: THREE.MeshBasicMaterial; booms: boolean; emit: number }>();
  private boomLight: THREE.PointLight | null = null;
  private boomT = 0;
  private flash: THREE.Sprite;
  private flashMat: THREE.SpriteMaterial;
  // 4F: cars in the searchlight throw shadows away from the helicopter (soft dark decals)
  private shadows: THREE.InstancedMesh;
  private shadowMat: THREE.MeshBasicMaterial;
  /** the race cars (set by the game): position and heading */
  carsForShadow: () => { x: number; z: number; yaw: number }[] = () => [];
  /** last frame's bangs, for the game to shake / sound (x, z) */
  readonly booms: { x: number; z: number }[] = [];

  constructor(private scene: THREE.Scene, private world: WorldData, private particles: Particles) {
    this.heli = new Helicopter(scene);
    this.buildMaterials();
    // the white flash of a shock charge
    const fc = document.createElement('canvas');
    fc.width = fc.height = 64;
    const fg = fc.getContext('2d')!;
    const gr = fg.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.3, 'rgba(255,220,160,0.6)');
    gr.addColorStop(1, 'rgba(255,160,80,0)');
    fg.fillStyle = gr;
    fg.fillRect(0, 0, 64, 64);
    this.flashMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(fc), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 });
    // searchlight shadows: a soft dark shape stretched away from the lamp
    {
      const sc = document.createElement('canvas');
      sc.width = 64;
      sc.height = 128;
      const sg = sc.getContext('2d')!;
      const grd = sg.createLinearGradient(0, 0, 0, 128);
      grd.addColorStop(0, 'rgba(0,0,0,1)');
      grd.addColorStop(0.6, 'rgba(0,0,0,0.85)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      sg.fillStyle = grd;
      sg.filter = 'blur(5px)';
      sg.beginPath();
      sg.roundRect(10, 6, 44, 116, 18);
      sg.fill();
      this.shadowMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -9, polygonOffsetUnits: -9 });
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0, 0.5); // starts at the car, stretches out along +z
      this.shadows = new THREE.InstancedMesh(g, this.shadowMat, 16);
      this.shadows.count = 0;
      // after the beam's haze (9), so the shadow cuts the lit mist as well as the ground
      this.shadows.renderOrder = 10;
      this.shadows.frustumCulled = false;
      mainOnly(this.shadows);
      scene.add(this.shadows);
    }
    this.flash = new THREE.Sprite(this.flashMat);
    this.flash.visible = false;
    this.flash.renderOrder = 11;
    mainOnly(this.flash);
    scene.add(this.flash);
    this.buildGantries();
    this.buildBreakers();
  }

  private buildMaterials(): void {
    const m = this.mats;
    m.cone = new THREE.MeshStandardMaterial({ color: 0xff5a14, roughness: 0.6 });
    m.waterR = new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.45, flatShading: true });
    m.waterW = new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.45, flatShading: true });
    m.saw = new THREE.MeshStandardMaterial({ map: stripeTexture('#f4f2ec', '#ff6a12'), roughness: 0.6 });
    m.wood = new THREE.MeshStandardMaterial({ color: 0x8a6a46, roughness: 0.9 });
    m.jersey = new THREE.MeshStandardMaterial({ color: 0xa9a7a1, roughness: 0.92, flatShading: true });
    m.spikes = new THREE.MeshStandardMaterial({ map: stripeTexture('#1a1a1a', '#e8c21a'), roughness: 0.5, metalness: 0.6 });
    m.steel = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.45, metalness: 0.85 });
    m.canGrey = new THREE.MeshStandardMaterial({ color: 0x6c7076, roughness: 0.5, metalness: 0.5 });
    m.canRed = new THREE.MeshStandardMaterial({ color: 0xb0161c, roughness: 0.45, metalness: 0.4 });
    m.charge = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.4, metalness: 0.6 });
    const g = this.geos;
    g.can = new THREE.CylinderGeometry(0.11, 0.11, 0.42, 12);
    g.can.rotateZ(Math.PI / 2);
    g.puck = new THREE.CylinderGeometry(0.26, 0.3, 0.16, 16);
    g.puck.translate(0, 0.08, 0);
    g.led = new THREE.SphereGeometry(0.06, 8, 6);
    g.roll = new THREE.CylinderGeometry(0.16, 0.16, 0.9, 10);
    g.roll.rotateZ(Math.PI / 2);
    g.ring = new THREE.RingGeometry(0.86, 1, 56);
    g.ring.rotateX(-Math.PI / 2);
    g.disc = new THREE.CircleGeometry(1, 40);
    g.disc.rotateX(-Math.PI / 2);
    g.bar = new THREE.PlaneGeometry(1, 1);
    g.bar.rotateX(-Math.PI / 2);
    g.cone = new THREE.ConeGeometry(0.2, 0.7, 10);
    g.cone.translate(0, 0.35, 0);
    g.water = new THREE.BoxGeometry(1.9, 0.82, 0.55, 1, 1, 1);
    g.water.translate(0, 0.41, 0);
    g.plank = new THREE.BoxGeometry(1.8, 0.24, 0.05);
    g.plank.translate(0, 0.92, 0);
    g.leg = new THREE.BoxGeometry(0.06, 0.95, 0.06);
    g.leg.translate(0, 0.47, 0);
    // jersey barrier cross-section, extruded 1 m along x (scaled to length)
    const sh = new THREE.Shape();
    sh.moveTo(-0.32, 0);
    sh.lineTo(0.32, 0);
    sh.lineTo(0.24, 0.12);
    sh.lineTo(0.1, 0.32);
    sh.lineTo(0.08, 0.82);
    sh.lineTo(-0.08, 0.82);
    sh.lineTo(-0.1, 0.32);
    sh.lineTo(-0.24, 0.12);
    sh.closePath();
    const j = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false });
    j.translate(0, 0, -0.5);
    j.rotateY(Math.PI / 2);
    g.jersey = j;
    g.spikes = new THREE.BoxGeometry(1, 0.05, 0.4);
    g.spikes.translate(0, 0.025, 0);
  }

  // ── Speed-trap gantries ──
  private buildGantries(): void {
    const hw = this.world.halfWidth;
    const steel = this.mats.steel;
    const sign = new THREE.MeshStandardMaterial({ map: labelTexture([['SPEED CAMERA', 44, '700 44px Outfit, Arial, sans-serif'], ['LIMIT 200', 96, '600 38px Outfit, Arial, sans-serif']]), emissive: 0xffffff, emissiveIntensity: 0.25 });
    sign.emissiveMap = sign.map;
    for (const t of this.world.speedTraps) {
      const grp = new THREE.Group();
      grp.position.set(t.x, 0, t.z);
      grp.rotation.y = t.yaw;
      for (const e of [-hw - 2.6, hw + 2.6]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7, 0.4), steel);
        post.position.set(e, 3.5, 0);
        post.castShadow = true;
        grp.add(post);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 6, 0.45, 0.5), steel);
      beam.position.y = 6.8;
      grp.add(beam);
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1), sign);
      sg.position.set(0, 7.75, -0.27);
      sg.rotation.y = Math.PI;
      grp.add(sg);
      const flash = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 0 });
      const led = new THREE.MeshStandardMaterial({ color: 0x110000, emissive: 0xff2020, emissiveIntensity: 0 });
      for (const x of [-3.5, 3.5]) {
        const cam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.7), steel);
        cam.position.set(x, 6.3, -0.2);
        const lens = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.05), flash);
        lens.position.set(x, 6.3, -0.58);
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), led);
        dot.position.set(x + 0.18, 6.55, -0.56);
        grp.add(cam, lens, dot);
      }
      this.scene.add(grp);
      this.gantries.push({ flash, led, flashT: 0 });
    }
  }

  /** The camera flash on a gantry the player just went through too fast. */
  flashTrap(): void {
    // the nearest gantry to the player is the one that flashed: just flash both, they are far apart
    for (const g of this.gantries) g.flashT = 0.35;
  }

  // ── Pursuit breakers ──
  private buildBreakers(): void {
    const S = this.world.samples;
    const markTex = (() => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 64;
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, 256, 64);
      g.fillStyle = 'rgba(255,138,42,0.9)';
      for (let x = 8; x < 256; x += 48) {
        g.beginPath();
        g.moveTo(x, 6);
        g.lineTo(x + 22, 32);
        g.lineTo(x, 58);
        g.lineTo(x + 12, 58);
        g.lineTo(x + 34, 32);
        g.lineTo(x + 12, 6);
        g.fill();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const markMat = new THREE.MeshBasicMaterial({ map: markTex, transparent: true, depthWrite: false, color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7 });
    for (const b of this.world.breakers) {
      const smp = S[b.index];
      const nx = smp.nx * b.side;
      const nz = smp.nz * b.side;
      const grp = new THREE.Group();
      grp.userData.noBake = true; // it falls down: not part of the baked shadow
      grp.position.set(b.x, 0, b.z);
      // local +z points at the track (the way it falls); local +x runs along the track
      grp.rotation.y = Math.atan2(-nx, -nz);
      const pivot = new THREE.Group(); // hinge on the track-side bottom edge
      const depth = b.kind === 'containers' ? 2.6 : b.kind === 'tower' ? 2.4 : 3;
      pivot.position.z = depth / 2;
      grp.add(pivot);
      const inner = new THREE.Group();
      inner.position.z = -depth / 2;
      pivot.add(inner);
      if (b.kind === 'scaffold') this.scaffold(inner);
      else if (b.kind === 'containers') this.containers(inner);
      else this.tower(inner);
      mergeByMaterial(inner, []); // it falls as one piece: one draw call per material
      this.scene.add(grp);
      // chevrons across the track mark the spot
      const mg = new THREE.PlaneGeometry(this.world.halfWidth * 2, 3.2);
      mg.rotateX(-Math.PI / 2);
      const marker = new THREE.Mesh(mg, markMat);
      marker.position.set(smp.x, 0.05, smp.z);
      marker.rotation.y = Math.atan2(smp.tx, smp.tz) + Math.PI / 2;
      marker.renderOrder = 6;
      marker.visible = false;
      this.scene.add(marker);
      this.breakers.push({ group: grp, pivot, marker, fallT: 0, down: false });
    }
  }

  private scaffold(g: THREE.Group): void {
    const pipe = this.mats.steel;
    const plank = this.mats.wood;
    const W = 12;
    const H = 11;
    const D = 3;
    const pg = new THREE.CylinderGeometry(0.05, 0.05, 1, 6);
    const add = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
      const a = new THREE.Vector3(x1, y1, z1);
      const b = new THREE.Vector3(x2, y2, z2);
      const m = new THREE.Mesh(pg, pipe);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.scale.y = a.distanceTo(b);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      g.add(m);
    };
    for (let x = -W / 2; x <= W / 2; x += 2) for (const z of [-D / 2, D / 2]) add(x, 0, z, x, H, z);
    for (let y = 2.2; y <= H; y += 2.2) {
      for (const z of [-D / 2, D / 2]) add(-W / 2, y, z, W / 2, y, z);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, D), plank);
      deck.position.y = y - 0.05;
      deck.castShadow = true;
      g.add(deck);
    }
    for (let x = -W / 2; x < W / 2; x += 4) add(x, 0, D / 2, x + 4, H * 0.8, D / 2); // bracing
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.2), new THREE.MeshStandardMaterial({ map: labelTexture([['PG WORKS', 64, '800 70px Outfit, Arial, sans-serif']], 512, 128, '#ff6a12'), side: THREE.DoubleSide }));
    banner.position.set(0, 5.5, D / 2 + 0.06);
    g.add(banner);
  }

  private containers(g: THREE.Group): void {
    const cols = [0x8c3a22, 0x1f6d70, 0x6d7177, 0x9a7a2c, 0x2b4a7a, 0x7a2f3a];
    let k = 0;
    const L = 6;
    const H = 2.6;
    const rows = [[-3.2, 3.2], [-3.2, 3.2], [0]];
    rows.forEach((xs, row) => {
      for (const x of xs) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(L, H, 2.5), new THREE.MeshStandardMaterial({ color: cols[k++ % cols.length], roughness: 0.7, metalness: 0.4, flatShading: true }));
        m.position.set(x, H / 2 + row * H, 0);
        m.castShadow = true;
        g.add(m);
        // corrugation hint: dark ribs
        for (let r = -L / 2 + 0.3; r < L / 2; r += 0.6) {
          const rib = new THREE.Mesh(new THREE.BoxGeometry(0.05, H * 0.9, 2.52), this.mats.steel);
          rib.position.set(x + r, H / 2 + row * H, 0);
          g.add(rib);
        }
      }
    });
  }

  private tower(g: THREE.Group): void {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 15, 2.2), new THREE.MeshStandardMaterial({ color: 0x1d2126, roughness: 0.6, metalness: 0.5 }));
    body.position.y = 7.5;
    body.castShadow = true;
    g.add(body);
    const board = new THREE.MeshStandardMaterial({
      map: labelTexture([['1  VOSS', 40, '700 40px monospace'], ['2  OKAFOR', 100, '700 40px monospace'], ['3  TANAKA', 160, '700 40px monospace'], ['4  MOREAU', 220, '700 40px monospace'], ['5  SILVA', 280, '700 40px monospace'], ['6  PETROV', 340, '700 40px monospace'], ['7  REYES', 400, '700 40px monospace']], 256, 440, '#05070a'),
      emissive: 0xffffff,
      emissiveIntensity: 1.2,
    });
    board.emissiveMap = board.map;
    for (const z of [1.11, -1.11]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 3.6 * 1.0), board);
      p.position.set(0, 11.5, z);
      if (z < 0) p.rotation.y = Math.PI;
      g.add(p);
    }
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.4, 2.6), this.mats.steel);
    cap.position.y = 15.2;
    g.add(cap);
  }

  /** Switch the pursuit-only parts on for a Pursuit Race (null: a clean race). */
  attach(p: Pursuit | null, quality: string): void {
    this.pursuit = p;
    for (const [, o] of this.obs) this.dropObstacle(o);
    this.obs.clear();
    if (p && !this.units.length) {
      p.units.forEach((u) => {
        const v = new PoliceCar(u.kind, u.id);
        v.root.visible = false;
        this.scene.add(v.root);
        this.units.push(v);
      });
    }
    for (const v of this.units) v.root.visible = false;
    // a few real flashing lights shared by the units nearest the camera (by quality)
    const want = p ? (POLICE_LOOK.dynamicLights as Record<string, number>)[quality] ?? 0 : 0;
    while (this.lights.length > want) this.scene.remove(this.lights.pop()!);
    while (this.lights.length < want) {
      const l = new THREE.PointLight(0xff0000, 0, 30, 2);
      this.scene.add(l);
      this.lights.push(l);
    }
    if (p && quality !== 'low' && !this.boomLight) {
      this.boomLight = new THREE.PointLight(0xffd2a0, 0, 60, 2);
      this.scene.add(this.boomLight);
    }
    for (const [, v] of this.dropVis) this.dropDrop(v);
    this.dropVis.clear();
    const spot = !!p && quality !== 'low';
    if (spot && !this.heliSpotAdded) this.scene.add(this.heli.spot, this.heli.spot.target);
    if (!spot && this.heliSpotAdded) this.scene.remove(this.heli.spot, this.heli.spot.target);
    this.heliSpotAdded = spot;
    for (const b of this.breakers) {
      b.down = false;
      b.fallT = 0;
      b.pivot.rotation.x = 0;
      b.group.position.y = 0;
      b.group.visible = true;
    }
  }

  setNight(k: number, wet = this.wet): void {
    this.night = k;
    this.wet = wet;
    for (const v of this.units) v.setNight(k, wet);
    for (const v of this.blockPool) v.setNight(k, wet);
    for (const [, o] of this.obs) o.car?.setNight(k, wet);
  }
  private wet = 0;
  /** police lights near the camera this frame, for the rain and the wet-road streaks */
  readonly glowList: { x: number; y: number; z: number; r: number; g: number; b: number; d: number }[] = [];
  private tmpV = new THREE.Vector3();
  private sprayAcc = new Map<number, number>();

  private dropObstacle(o: { mesh: THREE.Object3D; car?: PoliceCar }): void {
    if (o.car) {
      o.car.root.visible = false;
      this.blockPool.push(o.car);
    } else this.scene.remove(o.mesh);
  }

  private dropDrop(v: { obj: THREE.Object3D; marker: THREE.Mesh; mmat: THREE.MeshBasicMaterial }): void {
    this.scene.remove(v.obj, v.marker);
    v.mmat.dispose();
  }

  /** the canister and its warning marker on the road */
  private makeDrop(d: Drop): { obj: THREE.Object3D; led?: THREE.MeshStandardMaterial; marker: THREE.Mesh; mmat: THREE.MeshBasicMaterial; booms: boolean; emit: number } {
    const m = this.mats;
    const g = this.geos;
    let obj: THREE.Object3D;
    let led: THREE.MeshStandardMaterial | undefined;
    if (d.kind === 'smoke') obj = new THREE.Mesh(g.can, d.red ? m.canRed : m.canGrey);
    else if (d.kind === 'spikes') obj = new THREE.Mesh(g.roll, m.spikes);
    else {
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(g.puck, m.charge));
      led = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a1a, emissiveIntensity: 0 });
      const l = new THREE.Mesh(g.led, led);
      l.position.y = 0.17;
      grp.add(l);
      obj = grp;
    }
    obj.userData.noBake = true;
    this.scene.add(obj);
    // the warning: a red ring for a charge, a red bar across the lane for spikes, an amber
    // circle where smoke will land
    const mmat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -10, side: THREE.DoubleSide });
    let marker: THREE.Mesh;
    if (d.kind === 'charge') {
      marker = new THREE.Mesh(g.ring, mmat);
      marker.scale.setScalar(POLICE.chargeRadius);
    } else if (d.kind === 'spikes') {
      marker = new THREE.Mesh(g.bar, mmat);
      marker.scale.set(POLICE.spikeLength + 1, 1, 1.6);
      marker.rotation.y = Math.atan2(-d.az, d.ax);
    } else {
      marker = new THREE.Mesh(g.ring, mmat);
      marker.scale.setScalar(3);
    }
    marker.position.set(d.x, 0.05, d.z);
    marker.renderOrder = 7;
    mainOnly(marker);
    this.scene.add(marker);
    return { obj, led, marker, mmat, booms: false, emit: 0 };
  }

  /** Air One's drops this frame */
  private updateDrops(p: Pursuit, time: number, dt: number): void {
    this.booms.length = 0;
    const seen = new Set<number>();
    for (const d of p.air.drops) {
      seen.add(d.id);
      let v = this.dropVis.get(d.id);
      if (!v) {
        v = this.makeDrop(d);
        this.dropVis.set(d.id, v);
      }
      const u = Math.max(0, Math.min(1, d.age / d.fall));
      // falling: straight-ish line from the helicopter, accelerating, tumbling
      if (!d.landed) {
        v.obj.visible = d.age >= 0;
        v.obj.position.set(lerp(d.sx, d.x, u), Math.max(0.12, d.sy * (1 - u * u)), lerp(d.sz, d.z, u));
        v.obj.rotation.set(time * 7 + d.id, time * 3, time * 5);
      } else {
        v.obj.visible = d.kind !== 'spikes' && !d.boomed;
        v.obj.position.set(d.x, d.kind === 'smoke' ? 0.11 : 0, d.z);
        v.obj.rotation.set(0, d.id, 0);
      }
      // warning marker: blinking, faster as a charge is about to go
      const armed = d.kind === 'charge' && d.landed ? (d.age - d.fall) / POLICE.chargeArm : 0;
      const rate = d.kind === 'charge' ? 3 + armed * 9 : 2.5;
      const on = (time * rate) % 1 < 0.55;
      const showMarker = d.age >= -0.05 && (d.kind === 'charge' ? !d.boomed : !d.landed || d.age < d.fall + 0.4);
      v.marker.visible = showMarker;
      if (showMarker) {
        const k = on ? 1 : 0.35;
        if (d.kind === 'smoke') v.mmat.color.setRGB(0.9 * k, 0.55 * k, 0.1 * k);
        else v.mmat.color.setRGB(1.0 * k, 0.08 * k, 0.06 * k);
      }
      if (v.led) v.led.emissiveIntensity = on ? 18 : 2;
      // smoke pours out for ~6 s, thinning
      if (d.kind === 'smoke' && d.landed) {
        const t = d.age - d.fall;
        if (t < 6.5 && dt > 0) {
          const k = 1 - t / 7;
          v.emit += dt * 60 * k;
          while (v.emit >= 1) {
            v.emit -= 1;
            this.particles.smokeScreen(d.x, d.z, d.red, k, 0.6 + t * 0.25);
          }
        }
      }
      // the bang
      if (d.kind === 'charge' && d.boomed && !v.booms) {
        v.booms = true;
        this.particles.blast(d.x, d.z);
        for (let i = 0; i < 8; i++) this.particles.dust(d.x + (Math.random() - 0.5) * 3, 0, d.z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, 1);
        this.booms.push({ x: d.x, z: d.z });
        this.boomT = 0.35;
        this.flash.position.set(d.x, 1.2, d.z);
        if (this.boomLight) this.boomLight.position.set(d.x, 2.5, d.z);
      }
    }
    for (const [id, v] of this.dropVis) {
      if (!seen.has(id)) {
        this.dropDrop(v);
        this.dropVis.delete(id);
      }
    }
    // the flash and its light fade fast
    this.boomT = Math.max(0, this.boomT - dt);
    const f = this.boomT / 0.35;
    this.flash.visible = f > 0;
    this.flashMat.opacity = f;
    this.flash.scale.setScalar(6 + (1 - f) * 10);
    if (this.boomLight) this.boomLight.intensity = 900 * f * f;
  }

  private sm = new THREE.Matrix4();
  private sq = new THREE.Quaternion();
  private sv = new THREE.Vector3();
  private ss = new THREE.Vector3();
  private yAxis = new THREE.Vector3(0, 1, 0);
  /** cars inside the searchlight's pool throw a shadow away from the lamp */
  private updateShadows(p: Pursuit): void {
    const h = p.heli;
    const beam = Math.max(this.night, this.wet * 0.5);
    let n = 0;
    if (h.active && this.heliSpotAdded && beam > 0.2) {
      const lamp = this.heli.lampPos;
      const ly = Math.max(4, lamp.y);
      const reach = Math.max(4, Math.hypot(h.lx - lamp.x, ly, h.lz - lamp.z) * 0.14);
      const list = this.carsForShadow();
      for (const u of p.units) if (u.active) list.push({ x: u.car.s.x, z: u.car.s.z, yaw: u.car.s.yaw });
      for (const c of list) {
        if (n >= 16) break;
        const inBeam = 1 - Math.max(0, Math.min(1, (Math.hypot(c.x - h.lx, c.z - h.lz) - reach * 0.6) / (reach * 0.6)));
        if (inBeam <= 0.3) continue;
        const dx = c.x - lamp.x;
        const dz = c.z - lamp.z;
        const hd = Math.hypot(dx, dz) || 1;
        // a 1.2 m tall car, lit from ly above at hd away: the shadow reaches 1.2 * hd / ly behind it
        const len = Math.min(16, 1.2 * (hd / ly) + 6);
        // width: how much of the car's side faces the light
        const across = Math.abs(Math.sin(Math.atan2(dx, dz) - c.yaw));
        this.sq.setFromAxisAngle(this.yAxis, Math.atan2(dx, dz));
        this.sv.set(c.x - (dx / hd) * 2.0, 0.05, c.z - (dz / hd) * 2.0);
        this.ss.set(1.9 + across * 2.4, 1, len);
        this.sm.compose(this.sv, this.sq, this.ss);
        this.shadows.setMatrixAt(n, this.sm);
        n++;
        this.shadowMat.opacity = 0.92 * Math.min(1, beam);
      }
    }
    this.shadows.count = n;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.shadows.visible = n > 0;
  }

  /** red light from the burning red canisters, for the smoke and rain */
  private flareGlows(p: Pursuit, cam: THREE.Vector3, out: { x: number; y: number; z: number; r: number; g: number; b: number; d: number }[]): void {
    for (const d of p.air.drops) {
      if (d.kind !== 'smoke' || !d.red || !d.landed || d.age - d.fall > POLICE.smokeLife - 1 || out.length >= 8) continue;
      const dd = Math.hypot(d.x - cam.x, d.z - cam.z);
      if (dd > 140) continue;
      const flick = 0.8 + 0.2 * Math.sin(this.flickT * 23 + d.id) * Math.sin(this.flickT * 7.3);
      out.push({ x: d.x, y: 0.6, z: d.z, r: 3.2 * flick, g: 0.35 * flick, b: 0.25 * flick, d: dd });
    }
  }
  private flickT = 0;

  private makeObstacle(o: Obstacle): { mesh: THREE.Object3D; car?: PoliceCar } {
    const m = this.mats;
    const g = this.geos;
    const yaw = Math.atan2(-o.az, o.ax); // local +x along the long axis
    if (o.kind === 'blockCar') {
      const car = this.blockPool.pop() ?? new PoliceCar('cruiser', 9 + this.obs.size);
      if (!car.root.parent) this.scene.add(car.root);
      car.setNight(this.night, this.wet);
      car.pattern = 'alternate';
      car.root.visible = true;
      // the car's length (local z) lies along the obstacle's long axis
      car.root.position.set(o.x, 0, o.z);
      car.root.rotation.set(0, Math.atan2(o.ax, o.az), 0);
      return { mesh: car.root, car };
    }
    let mesh: THREE.Object3D;
    if (o.kind === 'cone') mesh = new THREE.Mesh(g.cone, m.cone);
    else if (o.kind === 'water') mesh = new THREE.Mesh(g.water, o.id % 2 ? m.waterR : m.waterW);
    else if (o.kind === 'saw') {
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(g.plank, m.saw));
      for (const sx of [-0.75, 0.75]) {
        for (const sz of [-0.18, 0.18]) {
          const leg = new THREE.Mesh(g.leg, m.wood);
          leg.position.set(sx, 0, sz);
          leg.rotation.x = sz > 0 ? -0.2 : 0.2;
          grp.add(leg);
        }
      }
      mesh = grp;
    } else if (o.kind === 'jersey') {
      mesh = new THREE.Mesh(g.jersey, m.jersey);
      mesh.scale.x = o.hl * 2;
      mesh.castShadow = true;
    } else {
      mesh = new THREE.Mesh(g.spikes, m.spikes);
      mesh.scale.x = o.hl * 2;
    }
    mesh.position.set(o.x, 0, o.z);
    mesh.rotation.y = yaw;
    mesh.userData.noBake = true;
    this.scene.add(mesh);
    return { mesh };
  }

  /** Per frame. `alpha`: render interpolation between physics steps. */
  update(time: number, dt: number, alpha: number, camera: THREE.Camera): void {
    const p = this.pursuit;
    // gantry lights: red LED while the cameras are live, white flash on a capture
    for (const gt of this.gantries) {
      gt.flashT = Math.max(0, gt.flashT - dt);
      gt.flash.emissiveIntensity = gt.flashT > 0 ? 40 * gt.flashT : 0;
      gt.led.emissiveIntensity = p && p.trapsLive ? ((time * 1.2) % 1 < 0.5 ? 6 : 1) : 0;
    }
    // breakers: marked while police are out; collapse animation
    this.breakers.forEach((b, k) => {
      const down = !!p && p.breakerDown[k] !== undefined && p.breakerDown[k] >= 0;
      b.marker.visible = !!p && p.joined && !down;
      if (down && !b.down) {
        b.down = true;
        b.fallT = 0;
      } else if (!down && b.down) {
        b.down = false;
        b.pivot.rotation.x = 0;
        b.group.position.y = 0;
        b.group.visible = true;
      }
      if (b.down) {
        b.fallT += dt;
        const t = Math.min(1, b.fallT / 1.3);
        b.pivot.rotation.x = (Math.PI / 2) * 0.96 * t * t;
        if (b.fallT > 1.25 && b.fallT < 1.4) {
          for (let i = 0; i < 6; i++) {
            const g = b.group.position;
            this.particles.dust(g.x + (Math.random() - 0.5) * 10, 0, g.z + (Math.random() - 0.5) * 10, 0, 0, 1);
          }
        }
        // after a while the wreckage is cleared away
        if (b.fallT > 7) b.group.position.y = -Math.min(20, (b.fallT - 7) * 3);
        b.group.visible = b.fallT < 14;
      }
    });
    if (!p) {
      this.heli.update(0, 0, 0, 0, 0, 0, 0, 0, time, dt, 0, false, false);
      for (const l of this.lights) l.intensity = 0;
      vegUniforms.uWash.value.w = 0;
      for (const [, v] of this.dropVis) this.dropDrop(v);
      this.dropVis.clear();
      this.flash.visible = false;
      if (this.boomLight) this.boomLight.intensity = 0;
      return;
    }
    // units: pattern from the chase (Heat is shared with guests, so everyone sees the same)
    const cam = camera.position;
    const lvl = p.level;
    p.units.forEach((u, i) => {
      const v = this.units[i];
      v.root.visible = u.active;
      if (!u.active) return;
      const c = u.car;
      v.damage = u.damage;
      const pattern: FlashPattern = !p.joined || p.cooldown > 0 ? 'cruise' : lvl >= 4 || u.kind === 'rammer' ? 'wigwag' : lvl >= 2 ? 'quad' : 'alternate';
      v.pattern = pattern;
      const pose = {
        x: lerp(c.prev.x, c.s.x, alpha),
        y: lerp(c.prev.y, c.s.y, alpha),
        z: lerp(c.prev.z, c.s.z, alpha),
        yaw: c.prev.yaw + wrap(c.s.yaw - c.prev.yaw) * alpha,
        pitch: c.s.pitch,
        roll: c.s.roll,
      };
      v.update(c.s, pose, time, Math.hypot(pose.x - cam.x, pose.z - cam.z));
      // spray in the wet, smoke from a battered unit
      if (dt > 0 && v.root.visible) this.unitParticles(v, c.s, dt, i);
    });
    // obstacles: create, animate broken ones, remove expired
    const seen = new Set<number>();
    for (const o of p.obstacles) {
      seen.add(o.id);
      let e = this.obs.get(o.id);
      if (!e) {
        e = { ...this.makeObstacle(o), brokenSeen: false, spin: 0, t: 0 };
        this.obs.set(o.id, e);
      }
      if (e.car) e.car.update(null, null, time, e.car.root.position.distanceTo(cam));
      if (o.broken) {
        if (!e.brokenSeen) {
          e.brokenSeen = true;
          e.spin = (o.id % 2 ? 1 : -1) * (3 + (o.id % 5));
          e.t = 0;
        }
        e.t += dt;
        const mesh = e.mesh;
        mesh.position.x = o.x;
        mesh.position.z = o.z;
        // a hop, a tumble, then it lies on its side where it stopped
        const hop = Math.max(0, Math.sin(Math.min(1, e.t / 0.55) * Math.PI)) * (o.kind === 'cone' ? 0.9 : 0.6);
        mesh.position.y = hop;
        mesh.rotation.x = Math.min(Math.PI / 2, e.t * Math.abs(e.spin)) * Math.sign(e.spin);
        mesh.rotation.y += e.t < 0.6 ? e.spin * dt * 0.6 : 0;
      }
    }
    for (const [id, e] of this.obs) {
      if (!seen.has(id)) {
        this.dropObstacle(e);
        this.obs.delete(id);
      }
    }
    // helicopter
    const h = p.heli;
    this.heli.haze = this.wet;
    this.heli.gust = this.wet;
    this.heli.update(h.x, h.y, h.z, h.yaw, h.vx, h.vz, h.lx, h.lz, time, dt, Math.max(this.night, 0.15), h.active, this.heliSpotAdded, h.low);
    // rotor wash: strongest when it's low. Dust off a dry track, a ring of spray off a wet one,
    // smoke and spray pushed away, grass and trees bending
    const washK = h.active ? Math.max(0, Math.min(1, (42 - h.y) / 26)) : 0;
    vegUniforms.uWash.value.set(h.x, h.z, 26, washK);
    if (washK > 0 && dt > 0) {
      this.particles.wash(h.x, h.z, 18, 40 * washK, dt);
      const rate = dt * (this.wet > 0.3 ? 90 : 45) * washK;
      const n = Math.min(14, Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 3 + Math.random() * 7;
        const sp = 10 + 8 * washK;
        if (this.wet > 0.3) this.particles.spray(h.x + Math.cos(a) * r, 0, h.z + Math.sin(a) * r, Math.cos(a) * sp, Math.sin(a) * sp, 0.6 + 0.4 * washK, this.night > 0.5);
        else this.particles.dust(h.x + Math.cos(a) * r, 0, h.z + Math.sin(a) * r, Math.cos(a) * sp * 0.8, Math.sin(a) * sp * 0.8, 0.4 + 0.5 * washK);
      }
    }
    this.flickT += dt;
    this.updateDrops(p, time, dt);
    this.updateShadows(p);
    // the units nearest the camera share a few real flashing lights; all of them light the
    // rain and streak on the wet road
    const near: { v: PoliceCar; d: number }[] = [];
    p.units.forEach((u, i) => {
      if (u.active) near.push({ v: this.units[i], d: this.units[i].root.position.distanceToSquared(cam) });
    });
    for (const [, e] of this.obs) if (e.car) near.push({ v: e.car, d: e.car.root.position.distanceToSquared(cam) });
    near.sort((a, b) => a.d - b.d);
    this.lights.forEach((l, k) => {
      const n = near[k];
      if (!n || n.d > 100 * 100) {
        l.intensity = 0;
        return;
      }
      const r = n.v.root;
      l.position.set(r.position.x, 2.3, r.position.z);
      // one colour at a time: when red and blue are both lit, the light alternates between them
      const g = n.v.glow;
      const both = g.r > 0.05 && g.b > 0.05;
      const red = both ? Math.floor(time * 10 + k) % 2 === 0 : g.r >= g.b;
      this.tmpC.setRGB(red ? 1 : 0.03, 0.03, red ? 0.04 : 1);
      l.color.copy(this.tmpC);
      l.intensity = (g.r + g.b > 0.05 ? 1 : 0) * (12 + 34 * Math.max(this.night, this.wet * 0.4));
    });
    const gl = this.glowList;
    gl.length = 0;
    this.flareGlows(p, cam, gl);
    for (const n of near) {
      if (n.d > 120 * 120 || gl.length >= 6) break;
      const g = n.v.glow;
      if (g.r + g.b < 0.05) continue;
      const r = n.v.root.position;
      gl.push({ x: r.x, y: 1.9, z: r.z, r: g.r * 2.2, g: 0.05 + g.w * 0.3, b: g.b * 2.6, d: Math.sqrt(n.d) });
    }
    void PHYSICS_DT;
  }

  /** Spray off the rear tyres in the wet; smoke from the bonnet of a battered unit. */
  private unitParticles(v: PoliceCar, s: import('../vehicle/VehiclePhysics').VehicleState, dt: number, i: number): void {
    if (this.wet > 0 && s.speed > 6) {
      const acc = (this.sprayAcc.get(i) ?? 0) + this.wet * Math.min(1, s.speed / 45) * 22 * dt;
      let a = acc;
      while (a >= 1) {
        a -= 1;
        const w = v.rearWheel(Math.random() < 0.5 ? 0 : 1, this.tmpV);
        this.particles.spray(w.x, w.y - 0.3, w.z, s.vx, s.vz, Math.min(1, s.speed / 60), this.night > 0.5);
      }
      this.sprayAcc.set(i, a);
    }
    if (v.damage >= POLICE_LOOK.smokeFrom && Math.random() < dt * (6 + 10 * v.damage)) {
      const b = v.bonnet(this.tmpV);
      this.particles.smoke(b.x, b.y, b.z, s.vx * 0.6, s.vz * 0.6, 0.25 + 0.4 * v.damage);
    }
    // tyre smoke when it slides
    const slip = Math.max(s.wheelSlip[2], s.wheelSlip[3]);
    if (slip > 0.45 && this.wet < 0.5 && Math.random() < dt * 30 * slip) {
      const w = v.rearWheel(Math.random() < 0.5 ? 0 : 1, this.tmpV);
      this.particles.smoke(w.x, w.y - 0.3, w.z, s.vx, s.vz, slip * 0.7);
    }
  }

  /** 4E: show the helicopter for a shader warm-up compile (then hide it again) */
  warm(on: boolean): void {
    this.heli.root.visible = on;
    this.heli.cone.visible = on;
    this.flash.visible = on;
  }

  /** roots of the police cars on the road (for motion blur) */
  unitRoots(): THREE.Object3D[] {
    return this.units.filter((v) => v.root.visible).map((v) => v.root);
  }

  /** Map marks for the HUD minimap. */
  mapIcons(out: import('../ui/HUD').MapIcon[]): import('../ui/HUD').MapIcon[] {
    out.length = 0;
    const p = this.pursuit;
    if (!p) return out;
    for (const u of p.units) if (u.active) out.push({ x: u.car.s.x, z: u.car.s.z, kind: 'police' });
    let rb = false;
    for (const o of p.obstacles) {
      if (o.group === 'roadblock' && !rb && o.kind === 'blockCar') {
        rb = true;
        out.push({ x: o.x, z: o.z, kind: 'roadblock', ax: o.ax, az: o.az });
      } else if (o.kind === 'spikes') out.push({ x: o.x, z: o.z, kind: 'spikes', ax: o.ax, az: o.az });
    }
    if (p.zonesLive) for (const z of this.world.workZones) out.push({ x: z.pieces[Math.floor(z.pieces.length / 2)].x, z: z.pieces[Math.floor(z.pieces.length / 2)].z, kind: 'zone' });
    if (p.trapsLive) for (const t of this.world.speedTraps) out.push({ x: t.x, z: t.z, kind: 'trap' });
    if (p.joined) this.world.breakers.forEach((b, k) => p.breakerDown[k] < 0 && out.push({ x: b.x, z: b.z, kind: 'breaker' }));
    // 4F: the roadblock's gap, the search circle and the hiding spots
    const gap = rb ? p.roadblockGap() : null;
    if (gap) out.push({ x: gap.x, z: gap.z, kind: 'gap' });
    if (p.searching) {
      out.push({ x: p.lastSeenX, z: p.lastSeenZ, kind: 'search', r: p.searchR });
      for (const h of p.hideSpots) out.push({ x: h.x, z: h.z, kind: 'hide', r: h.r });
    }
    if (p.heli.active) out.push({ x: p.heli.x, z: p.heli.z, kind: 'heli', lx: p.heli.lx, lz: p.heli.lz });
    for (const d of p.air.drops) {
      if (d.done || d.age < 0) continue;
      if (d.kind === 'charge' && !d.boomed) out.push({ x: d.x, z: d.z, kind: 'charge', r: POLICE.chargeRadius });
      else if (d.kind === 'smoke' && d.landed) out.push({ x: d.x, z: d.z, kind: 'smoke', r: p.air.smokeRadius(d) });
      else if (d.kind === 'spikes' && !d.landed) out.push({ x: d.x, z: d.z, kind: 'spikes', ax: d.ax, az: d.az });
    }
    return out;
  }
}
