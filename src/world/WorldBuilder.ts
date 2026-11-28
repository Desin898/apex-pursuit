// ─────────────────────────────────────────────────────────────────────────────
// WorldBuilder — turns WorldData into meshes: sky, lighting, circuit, skid pad, ramps,
// barriers, buildings, billboards, trees and the distant mountain ring.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { bakeMaterials } from './MaterialBaker';
import { HILL_FOG, buildTerrain } from './Terrain';
import { buildVegetation, VegetationVisuals } from './Vegetation';
import { DRESSINGS, Dressing } from './dressing';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLD } from '../config';
import { rng } from '../core/math';
import * as tex from './textures';
import { WorldData } from './WorldData';
import { buildMountainTerrain } from './hanagiri/MountainTerrain';
import { buildRoadSnowMesh } from './RoadSnow';
import { buildFarRanges, buildMountainRoadside } from './hanagiri/MountainBuild';
import { buildPeaks } from './hanagiri/Peaks';

export interface WorldVisuals {
  sunDir: THREE.Vector3;
  sun: THREE.DirectionalLight;
  clouds: THREE.Mesh;
  sky: Sky;
  hemi: THREE.HemisphereLight;
  /** materials and objects the weather / time of day re-tune (see Environment) */
  mats: {
    ground: THREE.MeshStandardMaterial;
    road: THREE.MeshStandardMaterial;
    kerb: THREE.MeshStandardMaterial;
    paved: THREE.MeshStandardMaterial[];
    buildings: THREE.MeshStandardMaterial[];
    glass: THREE.MeshStandardMaterial;
    signs: THREE.MeshStandardMaterial[];
    lamps: THREE.MeshStandardMaterial;
    ridges: THREE.MeshBasicMaterial[];
    trees: THREE.MeshStandardMaterial;
    terrain: THREE.MeshStandardMaterial;
    /** 4D: floodlight panels (they follow the lamps' brightness) */
    floods: THREE.MeshStandardMaterial[];
  };
  veg: VegetationVisuals;
  /** 4D: the venue's dressing (crowd, flags, traffic, birds…), or null */
  dressing: Dressing | null;
  /** call once per frame so the shadow frustum follows the player */
  follow(x: number, y: number, z: number): void;
  setShadowQuality(size: number): void;
}

const GROUND_Y = 0;

function strip(verts: number[], uvs: number[], idx: number[], closed: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  void closed;
  return g;
}

/** Box whose UVs tile in world units instead of stretching 0..1 over each face. */
function tiledBox(w: number, h: number, d: number, tileW: number, tileH: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // BoxGeometry face order: +x, −x, +y, −y, +z, −z (4 verts each)
  const dims = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tileW, f === 2 || f === 3 ? 0.02 : uv.getY(i) * Math.max(1, Math.round(dims[f][1] / tileH)));
    }
  }
  return g;
}

export function buildWorld(scene: THREE.Scene, renderer: THREE.WebGLRenderer, world: WorldData): WorldVisuals {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const withAniso = <T extends THREE.Texture>(t: T): T => {
    t.anisotropy = aniso;
    return t;
  };

  // ── Sky, sun, image-based lighting ───────────────────────────────────────
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 13), THREE.MathUtils.degToRad(-42));
  const sky = new Sky();
  sky.scale.setScalar(9000);
  const su = sky.material.uniforms;
  su.sunPosition.value.copy(sunDir);
  su.turbidity.value = 7.5;
  su.rayleigh.value = 2.4;
  su.mieCoefficient.value = 0.007;
  su.mieDirectionalG.value = 0.86;
  (sky.material as THREE.ShaderMaterial).fog = false;
  scene.add(sky);

  // Environment map: the sky plus a dark ground disc so paint reflects tarmac from below.
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(9000);
  for (const k of ['sunPosition', 'turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'] as const) {
    const src = su[k].value;
    envSky.material.uniforms[k].value = src instanceof THREE.Vector3 ? src.clone() : src;
  }
  envScene.add(envSky);
  const envGround = new THREE.Mesh(new THREE.CircleGeometry(4000, 24), new THREE.MeshBasicMaterial({ color: 0x1c1a17 }));
  envGround.rotation.x = -Math.PI / 2;
  envGround.position.y = -1.2;
  envScene.add(envGround);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const prevExposure = renderer.toneMappingExposure;
  renderer.toneMappingExposure = 0.5;
  scene.environment = pmrem.fromScene(envScene, 0.02, 1, 10000).texture;
  renderer.toneMappingExposure = prevExposure;
  scene.environmentIntensity = 0.95;
  pmrem.dispose();

  const horizon = new THREE.Color(0xd9a878);
  scene.fog = new THREE.FogExp2(horizon, 0.00105);

  const sun = new THREE.DirectionalLight(0xffc995, 3.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -42;
  sc.right = 42;
  sc.top = 42;
  sc.bottom = -42;
  sc.near = 1;
  sc.far = 420;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xa9c4ff, 0x4d3a26, 0.75);
  scene.add(hemi);
  const mats = {} as WorldVisuals['mats'];
  // 5A: a mountain venue stands on its height field; the flat venue on y = 0, as before
  const mountain = world.venue.look === 'mountain' && !!world.field;
  const gy = (x: number, z: number) => (world.field ? world.field.at(x, z) : 0);
  mats.paved = [];
  mats.buildings = [];
  mats.signs = [];
  mats.ridges = [];

  // ── 4C: surface textures painted on the GPU (asphalt, kerb, grass, concrete) ──
  const maxTex = renderer.capabilities.maxTextureSize;
  const baked = bakeMaterials(renderer, maxTex >= 4096 ? 2048 : 1024, Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  const rep = (t: THREE.Texture, x: number, y: number) => {
    const c = t.clone();
    c.repeat.set(x, y);
    c.needsUpdate = true;
    return c;
  };

  // ── Ground ───────────────────────────────────────────────────────────────
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(5200, 48),
    (mats.ground = new THREE.MeshStandardMaterial({ map: rep(baked.grass.map, 260, 260), normalMap: rep(baked.grass.normal, 260, 260), normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.96, metalness: 0 })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y - 0.02;
  ground.receiveShadow = true;
  if (mountain) {
    // 5A: the whole valley is one height field (chunks, three levels of detail)
    const t = buildMountainTerrain(world, baked.grass, baked.rock);
    mats.terrain = t.mat;
    scene.add(t.group);
  } else {
    // 4C: hills and ranges around the circuit
    const t = buildTerrain(baked.grass, baked.rock);
    mats.terrain = t.mat;
    scene.add(t.mesh);
    scene.add(ground);
  }

  // ── Paved aprons and the skid pad ────────────────────────────────────────
  const concreteMat = (rx: number, rz: number) => {
    const mat = new THREE.MeshStandardMaterial({ map: rep(baked.concrete.map, rx, rz), normalMap: rep(baked.concrete.normal, rx, rz), normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.82, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    mats.paved.push(mat);
    return mat;
  };
  for (const a of world.aprons) {
    const w = a.x1 - a.x0;
    const d = a.z1 - a.z0;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), concreteMat(w / 7, d / 7));
    m.rotation.x = -Math.PI / 2;
    m.position.set((a.x0 + a.x1) / 2, 0.0, (a.z0 + a.z1) / 2);
    m.receiveShadow = true;
    m.renderOrder = 1;
    scene.add(m);
  }
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(world.pad.r, 96),
    new THREE.MeshStandardMaterial({ map: withAniso(tex.padTexture()), roughness: 0.78, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  mats.paved.push(pad.material as THREE.MeshStandardMaterial);
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(world.pad.x, 0.0, world.pad.z);
  pad.receiveShadow = true;
  pad.renderOrder = 2;
  if (mountain && world.pad.r > 0) {
    // 5A: the village car park: concrete laid over the land (it follows the ground)
    const g = new THREE.CircleGeometry(world.pad.r, 48, 0, Math.PI * 2);
    g.rotateX(-Math.PI / 2);
    const pa = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) pa.setY(i, gy(pa.getX(i) + world.pad.x, pa.getZ(i) + world.pad.z) + 0.05);
    g.computeVertexNormals();
    const uvs = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uvs.count; i++) uvs.setXY(i, pa.getX(i) / 7, pa.getZ(i) / 7);
    const park = new THREE.Mesh(g, concreteMat(1, 1));
    park.position.set(world.pad.x, 0, world.pad.z);
    park.receiveShadow = true;
    park.renderOrder = 2;
    scene.add(park);
  } else if (world.pad.r > 0) scene.add(pad);

  // ── Circuit surface ──────────────────────────────────────────────────────
  const S = world.samples;
  const N = S.length;
  const hw = world.halfWidth;
  {
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= N; i++) {
      const s = S[i % N];
      v.push(s.x + s.nx * hw, s.y, s.z + s.nz * hw, s.x - s.nx * hw, s.y, s.z - s.nz * hw);
      const dist = i * WORLD.sampleSpacing;
      uv.push(0, dist / 14, 1, dist / 14);
      if (i < N) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const road = new THREE.Mesh(
      strip(v, uv, idx, true),
      (mats.road = new THREE.MeshStandardMaterial({ map: baked.asphalt.map, normalMap: baked.asphalt.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.62, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })),
    );
    road.receiveShadow = true;
    road.renderOrder = 3;
    scene.add(road);
  }
  // Kerbs
  {
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const kw = WORLD.kerbWidth;
    let n = 0;
    for (let i = 0; i < N; i++) {
      const a = S[i];
      const b = S[(i + 1) % N];
      for (const side of [1, -1]) {
        const on = side > 0 ? a.kerbL && b.kerbL : a.kerbR && b.kerbR;
        if (!on) continue;
        const inA = [a.x + a.nx * hw * side, a.z + a.nz * hw * side];
        const outA = [a.x + a.nx * (hw + kw) * side, a.z + a.nz * (hw + kw) * side];
        const inB = [b.x + b.nx * hw * side, b.z + b.nz * hw * side];
        const outB = [b.x + b.nx * (hw + kw) * side, b.z + b.nz * (hw + kw) * side];
        const va = a.s / 3;
        const vb = va + WORLD.sampleSpacing / 3;
        if (side > 0) {
          v.push(outA[0], a.y + 0.035, outA[1], inA[0], a.y, inA[1], outB[0], b.y + 0.035, outB[1], inB[0], b.y, inB[1]);
          uv.push(0, va, 1, va, 0, vb, 1, vb);
        } else {
          v.push(inA[0], a.y, inA[1], outA[0], a.y + 0.035, outA[1], inB[0], b.y, inB[1], outB[0], b.y + 0.035, outB[1]);
          uv.push(1, va, 0, va, 1, vb, 0, vb);
        }
        idx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
        n += 4;
      }
    }
    const kerbs = new THREE.Mesh(
      strip(v, uv, idx, false),
      (mats.kerb = new THREE.MeshStandardMaterial({ map: baked.kerb.map, normalMap: baked.kerb.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })),
    );
    kerbs.receiveShadow = true;
    kerbs.renderOrder = 4;
    if (n > 0) scene.add(kerbs);
  }
  // 5A: a mountain road has a paved shoulder, painted lines, guard rails and rock cuttings
  if (mountain) buildMountainRoadside(scene, world, baked, mats.paved);
  // 5B: snow lying on the road in the Snow weather (the same map the tyres read)
  buildRoadSnowMesh(scene, world);
  // Start/finish line and grid slots
  {
    const s = S[world.startIndex];
    const yaw = Math.atan2(s.tx, s.tz);
    const cm = tex.checkerTexture();
    cm.repeat.set(14, 2);
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 2, 2),
      new THREE.MeshStandardMaterial({ map: cm, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
    );
    line.rotation.set(-Math.PI / 2, 0, 0);
    const holder = new THREE.Group();
    holder.position.set(s.x, s.y + 0.002, s.z);
    holder.rotation.y = yaw;
    holder.add(line);
    const slotMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e2, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    for (let k = 0; k < 8; k++) {
      const x = k % 2 === 0 ? 3 : -3;
      const slot = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.18), slotMat);
      slot.rotation.x = -Math.PI / 2;
      slot.position.set(x, 0, -9 - k * 8);
      holder.add(slot);
      for (const e of [-1.3, 1.3]) {
        const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 1.2), slotMat);
        tick.rotation.x = -Math.PI / 2;
        tick.position.set(x + e, 0, -9.6 - k * 8);
        holder.add(tick);
      }
    }
    line.renderOrder = 5;
    scene.add(holder);

    // Gantry over the line
    const steel = new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.8, roughness: 0.45 });
    const gantry = new THREE.Group();
    gantry.position.set(s.x, s.y, s.z);
    gantry.rotation.y = yaw;
    for (const e of [-hw - 2.6, hw + 2.6]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8.4, 0.5), steel);
      post.position.set(e, 4.2, 0);
      post.castShadow = true;
      gantry.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 6, 0.5, 0.7), steel);
    beam.position.y = 8.4;
    beam.castShadow = true;
    gantry.add(beam);
    const signTex = tex.billboardTexture('APEX PURSUIT', 'START  ·  FINISH', 0.58);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(13, 2.6),
      (mats.signs[mats.signs.length] = new THREE.MeshStandardMaterial({ map: signTex, emissiveMap: signTex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.6, side: THREE.DoubleSide })),
    );
    sign.position.set(0, 7.0, -0.38);
    sign.rotation.y = Math.PI; // faces cars approaching the line
    gantry.add(sign);
    scene.add(gantry);
  }

  // ── Barriers and the pit wall ────────────────────────────────────────────
  {
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let n = 0;
    const T = 0.28;
    const H = 1.0;
    for (const run of world.barrierRuns) {
      if (run.kind) continue; // 5A: rails and rock faces are drawn with the mountain roadside
      let dist = 0;
      for (let i = 0; i < run.pts.length; i++) {
        const p = run.pts[i];
        const a = run.pts[Math.max(0, i - 1)];
        const b = run.pts[Math.min(run.pts.length - 1, i + 1)];
        const tx = b.x - a.x;
        const tz = b.z - a.z;
        const l = Math.hypot(tx, tz) || 1;
        const nx = tz / l;
        const nz = -tx / l;
        if (i > 0) dist += Math.hypot(p.x - run.pts[i - 1].x, p.z - run.pts[i - 1].z);
        const u = dist / 16; // 4G.2: one 16 m texture (eight panels, each worn differently)
        // cross-section: inner foot, inner top, outer top, outer foot (slightly splayed like a Jersey barrier)
        const by = gy(p.x, p.z);
        v.push(p.x + nx * (T + 0.1), by, p.z + nz * (T + 0.1), p.x + nx * T * 0.5, by + H, p.z + nz * T * 0.5, p.x - nx * T * 0.5, by + H, p.z - nz * T * 0.5, p.x - nx * (T + 0.1), by, p.z - nz * (T + 0.1));
        uv.push(u, 0, u, 0.82, u, 1, u, 0);
        if (i < run.pts.length - 1) {
          for (let k = 0; k < 3; k++) idx.push(n + k, n + k + 4, n + k + 1, n + k + 1, n + k + 4, n + k + 5);
        }
        n += 4;
      }
    }
    const g = strip(v, uv, idx, false).toNonIndexed();
    g.computeVertexNormals();
    const barrier = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: withAniso(tex.barrierTexture()), roughness: 0.8, side: THREE.DoubleSide }));
    barrier.castShadow = true;
    barrier.receiveShadow = true;
    if (v.length) scene.add(barrier);
  }

  // ── Ramps ────────────────────────────────────────────────────────────────
  {
    const topMat = new THREE.MeshStandardMaterial({ map: tex.rampTopTexture(), roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
    const hz = tex.hazardTexture();
    const sideMat = new THREE.MeshStandardMaterial({ map: hz, roughness: 0.7, side: THREE.DoubleSide });
    for (const r of world.ramps) {
      const SEG = 18;
      const hwid = r.width / 2;
      const tv: number[] = [];
      const tuv: number[] = [];
      const tidx: number[] = [];
      const sv: number[] = [];
      const suv: number[] = [];
      const sidx: number[] = [];
      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG;
        const u = t * r.length;
        const y = r.height * t * t;
        tv.push(hwid, y, u, -hwid, y, u);
        tuv.push(0, t, 1, t);
        if (i < SEG) tidx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
        // side skirts (both sides) down to the ground
        for (const sx of [hwid, -hwid]) {
          sv.push(sx, y, u, sx, 0, u);
          suv.push(u / 2, y / 2, u / 2, 0);
        }
        if (i < SEG) {
          const a = i * 4;
          sidx.push(a, a + 1, a + 4, a + 1, a + 5, a + 4, a + 2, a + 6, a + 3, a + 3, a + 6, a + 7);
        }
      }
      // back wall
      const b = sv.length / 3;
      sv.push(hwid, r.height, r.length, -hwid, r.height, r.length, hwid, 0, r.length, -hwid, 0, r.length);
      suv.push(0, r.height / 2, r.width / 2, r.height / 2, 0, 0, r.width / 2, 0);
      sidx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      const grp = new THREE.Group();
      const top = new THREE.Mesh(strip(tv, tuv, tidx, false), topMat);
      const sides = new THREE.Mesh(strip(sv, suv, sidx, false), sideMat);
      top.receiveShadow = top.castShadow = true;
      sides.castShadow = true;
      grp.add(top, sides);
      grp.position.set(r.x, gy(r.x, r.z) + 0.005, r.z);
      grp.rotation.y = r.yaw;
      scene.add(grp);
    }
  }

  // ── Buildings ────────────────────────────────────────────────────────────
  {
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.7, metalness: 0.4 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x18222c, roughness: 0.08, metalness: 0.9, emissive: 0xffb469, emissiveIntensity: 0.55 });
    mats.glass = glassMat;
    const styles: Record<string, { base: string; doors: boolean; tile: number }> = {
      pit: { base: '#8f949b', doors: true, tile: 22 },
      hangar: { base: '#6f7780', doors: true, tile: 23 },
      stand: { base: '#565b64', doors: false, tile: 18 },
      tower: { base: '#7d838b', doors: false, tile: 14 },
      block: { base: '#857c70', doors: false, tile: 15 },
    };
    let seed = 31;
    for (const b of world.buildings) {
      const st = styles[b.kind];
      if (!st) continue; // 4D: grandstands and huts are drawn by the venue's dressing
      const t = tex.buildingTextures(seed++, st.base, st.doors);
      const mat = new THREE.MeshStandardMaterial({ map: withAniso(t.map), emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.75, metalness: 0.15 });
      mats.buildings.push(mat);
      const grp = new THREE.Group();
      grp.position.set(b.x, 0, b.z);
      if (mountain) grp.position.y = Math.min(gy(b.x - b.w / 2, b.z - b.d / 2), gy(b.x + b.w / 2, b.z - b.d / 2), gy(b.x - b.w / 2, b.z + b.d / 2), gy(b.x + b.w / 2, b.z + b.d / 2)) - 0.3;
      grp.rotation.y = b.yaw;
      const box = new THREE.Mesh(tiledBox(b.w, b.h, b.d, st.tile, 99), [mat, mat, roofMat, roofMat, mat, mat]);
      box.position.y = b.h / 2;
      box.castShadow = box.receiveShadow = true;
      grp.add(box);
      if (b.kind === 'hangar') {
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(b.w / 2, b.w / 2, b.d, 24, 1, false, 0, Math.PI), roofMat);
        roof.rotation.set(Math.PI / 2, 0, Math.PI / 2);
        roof.scale.set(1, 1, 0.32);
        roof.position.y = b.h;
        roof.castShadow = true;
        grp.add(roof);
      } else if (b.kind === 'tower') {
        const cab = new THREE.Mesh(new THREE.BoxGeometry(b.w + 5, 5, b.d + 5), glassMat);
        cab.position.y = b.h + 2.5;
        cab.castShadow = true;
        const cap = new THREE.Mesh(new THREE.BoxGeometry(b.w + 6.5, 0.6, b.d + 6.5), roofMat);
        cap.position.y = b.h + 5.3;
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 12, 6), roofMat);
        mast.position.y = b.h + 11.5;
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
        beacon.position.y = b.h + 17.6;
        grp.add(cab, cap, mast, beacon);
      } else if (b.kind === 'stand') {
        const canopy = new THREE.Mesh(new THREE.BoxGeometry(b.w + 4, 0.5, b.d + 8), roofMat);
        canopy.position.set(0, b.h + 5, 3);
        canopy.rotation.x = -0.12;
        canopy.castShadow = true;
        grp.add(canopy);
        for (let x = -b.w / 2; x <= b.w / 2; x += b.w / 5) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.4, 0.5), roofMat);
          post.position.set(x, b.h + 2.6, -b.d / 2 + 1);
          grp.add(post);
        }
      } else if (b.kind === 'pit') {
        const deck = new THREE.Mesh(new THREE.BoxGeometry(b.w + 2, 0.4, b.d + 5), roofMat);
        deck.position.set(0, b.h + 0.2, 1.5);
        deck.castShadow = true;
        grp.add(deck);
      }
      scene.add(grp);
    }
  }

  // ── Light poles ──────────────────────────────────────────────────────────
  {
    const poleGeo = new THREE.CylinderGeometry(0.11, 0.17, 1, 8);
    poleGeo.translate(0, 0.5, 0);
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x33363b, metalness: 0.7, roughness: 0.5 }), world.poles.length);
    const lampGeo = new THREE.BoxGeometry(2.2, 0.22, 0.6);
    lampGeo.translate(0, -0.06, 0);
    mats.lamps = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffe2b0, emissiveIntensity: 3.2 });
    const lamps = new THREE.InstancedMesh(lampGeo, mats.lamps, world.poles.length);
    const armGeo = new THREE.BoxGeometry(0.12, 0.12, 1);
    armGeo.translate(0, 0, 0.5);
    const armed = world.poles.filter((p) => p.arm !== undefined);
    const arms = new THREE.InstancedMesh(armGeo, poles.material as THREE.Material, Math.max(1, armed.length));
    arms.count = armed.length;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let ai = 0;
    world.poles.forEach((p, i) => {
      const py = gy(p.x, p.z) - (mountain ? 0.3 : 0);
      m.compose(new THREE.Vector3(p.x, py, p.z), q.identity(), new THREE.Vector3(1, p.h - py + gy(p.x, p.z), 1));
      poles.setMatrixAt(i, m);
      const head = world.lampHeads[i];
      const yaw = Math.atan2(head.x - p.x, head.z - p.z);
      if (p.arm !== undefined) {
        q.setFromEuler(new THREE.Euler(0, yaw, 0));
        m.compose(new THREE.Vector3(p.x, p.h + gy(p.x, p.z), p.z), q, new THREE.Vector3(1, 1, p.arm));
        arms.setMatrixAt(ai++, m);
      }
      q.setFromEuler(new THREE.Euler(0, yaw + Math.PI / 2, 0));
      m.compose(new THREE.Vector3(head.x, head.y, head.z), q, new THREE.Vector3(1, 1, 1));
      lamps.setMatrixAt(i, m);
    });
    poles.castShadow = true;
    scene.add(poles, lamps, arms);
  }

  // ── Billboards ───────────────────────────────────────────────────────────
  {
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2c2f34, metalness: 0.7, roughness: 0.5 });
    for (const b of world.billboards) {
      const t = withAniso(tex.billboardTexture(b.text, b.sub, b.hue));
      const grp = new THREE.Group();
      grp.position.set(b.x, gy(b.x, b.z) - (mountain ? 0.4 : 0), b.z);
      grp.rotation.y = b.yaw;
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(12, 4.9, 0.3),
        [postMat, postMat, postMat, postMat, (mats.signs[mats.signs.length] = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.55 })), postMat],
      );
      panel.position.y = 7.2;
      panel.castShadow = true;
      grp.add(panel);
      for (const e of [-5.2, 5.2]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.8, 0.4), postMat);
        post.position.set(e, 2.4, -0.1);
        post.castShadow = true;
        grp.add(post);
      }
      scene.add(grp);
    }
  }

  // ── 4D: the venue's dressing ─────────────────────────────────────────────────
  mats.floods = [];
  const dressing = DRESSINGS[world.venue.id]?.({ scene, world, baked, signs: mats.signs, windows: mats.buildings, floods: mats.floods }) ?? null;

  // ── 4C: trees, hillside forests and grass (see Vegetation) ─────────────────
  const veg = buildVegetation(scene, renderer, world);
  mats.trees = veg.treeMat;

  // ── Perimeter fence ──────────────────────────────────────────────────────
  if (mountain) {
    // 5C: real peaks 2-3 km out and the giant face over the valley; one far ridge stays as the horizon
    buildPeaks(scene, world);
    buildFarRanges(scene, world, sunDir, horizon, mats.ridges, 1);
  }
  else {
    const ft = tex.fenceTexture();
    ft.repeat.set((Math.PI * 2 * WORLD.boundsRadius) / 3, 1);
    const fence = new THREE.Mesh(
      new THREE.CylinderGeometry(WORLD.boundsRadius, WORLD.boundsRadius, 3.4, 160, 1, true),
      new THREE.MeshBasicMaterial({ map: ft, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide }),
    );
    fence.position.set(WORLD.boundsCenterX, 1.7, WORLD.boundsCenterZ);
    scene.add(fence);
  }

  // ── Distant mountains (two hazy ridgelines) ──────────────────────────────
  if (!mountain) {
    const r = rng(1234);
    for (let layer = 0; layer < 2; layer++) {
      const R = 3000 + layer * 900;
      const K = 180;
      const v: number[] = [];
      const c: number[] = [];
      const idx: number[] = [];
      let h = 200;
      const heights: number[] = [];
      for (let i = 0; i < K; i++) {
        h += (r() - 0.5) * 150;
        h = Math.max(70, Math.min(520 + layer * 260, h));
        heights.push(h + (i % 2) * 40 * r());
      }
      for (let i = 0; i <= K; i++) {
        const a = (i / K) * Math.PI * 2;
        const hh = (heights[i % K] + heights[(i + 1) % K]) / 2 + layer * 160;
        v.push(Math.cos(a) * R, -40, Math.sin(a) * R, Math.cos(a) * R, hh, Math.sin(a) * R);
        // lit side of the range (facing the sun) is warmer; the foot of every ridge fades into haze
        const lit = Math.max(0, Math.cos(a) * sunDir.x + Math.sin(a) * sunDir.z);
        const crest = (layer === 0 ? new THREE.Color(0x4f4763) : new THREE.Color(0x7f6f86)).lerp(new THREE.Color(0xc98a62), lit * 0.55);
        const foot = horizon.clone().lerp(crest, 0.25);
        c.push(foot.r, foot.g, foot.b, crest.r, crest.g, crest.b);
        if (i < K) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      g.setIndex(idx);
      // 4C: the ranges take the same altitude haze as the hills in front of them, so in rain or
      // fog they fade together (before, they stayed dark behind fogged-out hills)
      const rm = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, side: THREE.DoubleSide });
      rm.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vTW;')
          .replace('#include <fog_vertex>', '#include <fog_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTW;').replace('#include <fog_fragment>', HILL_FOG);
      };
      rm.customProgramCacheKey = () => 'ridge-4c';
      mats.ridges.push(rm);
      const ridge = new THREE.Mesh(g, rm);
      ridge.renderOrder = -1 - layer;
      scene.add(ridge);
    }
  }

  // ── Cloud deck ───────────────────────────────────────────────────────────
  const cloudMap = tex.cloudTexture();
  cloudMap.repeat.set(5, 5);
  const clouds = new THREE.Mesh(
    new THREE.PlaneGeometry(26000, 26000),
    new THREE.MeshBasicMaterial({ map: cloudMap, color: 0xffc9a8, transparent: true, opacity: 0.8, depthWrite: false, fog: false, side: THREE.DoubleSide }),
  );
  clouds.rotation.x = Math.PI / 2;
  clouds.position.y = 1500;
  clouds.renderOrder = -5;
  clouds.userData.noBatch = true;
  scene.add(clouds);

  return {
    veg,
    dressing,
    sunDir,
    sun,
    clouds,
    sky,
    hemi,
    mats,
    follow(x: number, y: number, z: number) {
      // snap to texel-sized steps so shadow edges don't shimmer as the car moves
      const step = 84 / sun.shadow.mapSize.x;
      const sx = Math.round(x / step) * step;
      const sz = Math.round(z / step) * step;
      sun.target.position.set(sx, y, sz);
      sun.position.set(sx + sunDir.x * 200, y + sunDir.y * 200, sz + sunDir.z * 200);
      sun.target.updateMatrixWorld();
    },
    setShadowQuality(size: number) {
      sun.castShadow = size > 0;
      if (size > 0 && sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.set(size, size);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
    },
  };
}
