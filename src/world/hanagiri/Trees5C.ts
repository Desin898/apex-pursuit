// ─────────────────────────────────────────────────────────────────────────────
// Hanagiri trees (5C) — real models from two CC-BY-4.0 packs, by zone, in every weather.
//
//   0 tall spruce, 1 spruce, 2 young spruce, 4 bare birch: "Snow Pine Tree and Bush Pack LOWPOLY"
//   by EFX;  3 cherry: "Sakura Tree 01 – Low Poly Model" by Jogoss  (credits: README, Settings → About)
//
// One look per weather, from the same trees:
//   · Snow weather: the spruces snow-laden (snow on every branch that faces up, heavier on some
//     trees than others), the birches frosted, the cherries bare with snow along their limbs;
//   · other weathers: green spruces with snow only up near the tree line, cherries in bloom.
// They sway in the wind (harder up on the pass and in storms), and a car brushing past shakes
// the branches and knocks snow or petals off (see `treeEvents`).
//
// Near the camera they are real instanced models in 220 m cells; further out the same trees are
// cards baked from these models (one atlas for green, one for snow), so nothing pops. The cherry
// model is heavy (7,000 triangles), so it turns into a card sooner.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import packs from '../../../assets/packs.json';
import pineBin from '../../../assets/snow-pine-pack/snow-pine-pack.bin';
import sakuraBin from '../../../assets/sakura-tree/sakura-tree.bin';
import branchUrl from '../../../assets/snow-pine-pack/branch.webp';
import bareUrl from '../../../assets/snow-pine-pack/bare.webp';
import trunkNUrl from '../../../assets/snow-pine-pack/trunk-normal.webp';
import bloomUrl from '../../../assets/sakura-tree/bloom.webp';
import barkUrl from '../../../assets/sakura-tree/bark.webp';
import { rng } from '../../core/math';
import { mainOnly } from '../../core/layers';
import { HILL_FOG } from '../Terrain';
import type { WorldData } from '../WorldData';
import { mountainUniforms } from './MountainTerrain';

type Quality = 'low' | 'medium' | 'high' | 'ultra';

/** shared with the rest of the vegetation (wind and time are set by the game every frame) */
export const treeUniforms = {
  uTime: { value: 0 },
  uWind: { value: 0.45 },
  /** up to four cars near trees: x, z, speed, 0 */
  uCars: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
};

/** Snow knocked off a branch, or petals: drained by the game each frame into its particles. */
export const treeEvents: { x: number; y: number; z: number; snow: boolean; n: number }[] = [];

interface Part {
  geo: THREE.BufferGeometry;
  mat: THREE.MeshStandardMaterial;
  /** shown only without snow (the blossom) */
  bloom?: boolean;
}
interface Species {
  parts: Part[];
  /** model height and half width at scale 1, for the cards */
  h: number;
  w: number;
  /** how far from the camera the real model is drawn before the card takes over (m) */
  near: number;
  /** height on the model where the canopy starts (for the wind and the snow drop) */
  crown: number;
}

type PackPart = { pos: number[]; nor: number[]; uv: number[]; idx: number[]; min: number[]; max: number[] };
function partGeo(bin: Uint8Array, p: PackPart): THREE.BufferGeometry {
  const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  const f = (o: number[]) => new Float32Array(buf, o[0], o[1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(f(p.pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(f(p.nor), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(f(p.uv), 2));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(buf, p.idx[0], p.idx[1]), 1));
  g.computeBoundingSphere();
  return g;
}

let pending = 0;
const waiters: (() => void)[] = [];
function tex(url: string, srgb = true): THREE.Texture {
  pending++;
  const t = new THREE.TextureLoader().load(url, () => {
    if (--pending === 0) for (const w of waiters.splice(0)) w();
  });
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * The tree shader: wind, a shake near passing cars, and snow by weather and height.
 * `kind`: what this part is (needles get snow on top, the birch is frosted all over, bark gets a
 * line of snow along the top of its limbs).
 */
function treeMaterial(opts: THREE.MeshStandardMaterialParameters, kind: 'needles' | 'trunk' | 'bare' | 'bark' | 'bloom', height: number, sway: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...opts });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, treeUniforms, { uSnowCover: mountainUniforms.uSnowCover, uSnowLine: mountainUniforms.uSnowLine });
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime, uWind;
        uniform vec4 uCars[4];
        varying vec3 vTW;
        varying vec3 vTWN;
        varying float vLoad;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = instanceMatrix[3].xyz;
          float ph = ip.x * 0.071 + ip.z * 0.053;
          float hgt = clamp(transformed.y / ${height.toFixed(3)}, 0.0, 1.2);
          // stronger wind up on the pass
          float wind = uWind * (1.0 + 0.9 * smoothstep(90.0, 150.0, ip.y));
          // a car brushing past shakes the whole crown for a moment
          float shake = 0.0;
          for (int c = 0; c < 4; c++) {
            vec4 cv = uCars[c];
            float d = length(ip.xz - cv.xy);
            shake += (1.0 - smoothstep(2.5, 9.0, d)) * smoothstep(4.0, 25.0, cv.z);
          }
          float bend = hgt * hgt * ${sway.toFixed(4)};
          transformed.x += (sin(uTime * 1.1 + ph) * 0.7 + sin(uTime * 2.6 + ph * 1.7) * 0.3) * bend * wind;
          transformed.z += cos(uTime * 0.9 + ph * 1.3) * 0.5 * bend * wind;
          transformed.xz += vec2(sin(uTime * 23.0 + ph * 3.0), cos(uTime * 19.0 + ph)) * bend * 0.9 * min(shake, 1.0);
          ${kind === 'needles' || kind === 'bloom' ? 'transformed += normal * sin(uTime * 5.0 + dot(transformed, vec3(1.3, 0.7, 1.1))) * 0.012 * ' + height.toFixed(3) + ' * wind * hgt;' : ''}
          // how much snow this tree holds: some are loaded down, some have shaken theirs off
          vLoad = 0.55 + 0.45 * fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
        }`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        {
          vec4 tw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          vTW = tw.xyz;
          vTWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uSnowCover, uSnowLine;
        varying vec3 vTW;
        varying vec3 vTWN;
        varying float vLoad;
        float tSnow;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          // snow: everywhere in the Snow weather; otherwise only up near the tree line
          float alt = smoothstep(uSnowLine - 45.0, uSnowLine - 5.0, vTW.y);
          float amount = max(uSnowCover * vLoad, alt * 0.8);
          float up = vTWN.y * (gl_FrontFacing ? 1.0 : -1.0);
          float n = fract(sin(dot(floor(vTW.xz * 3.0 + vTW.y * 2.0), vec2(12.9898, 78.233))) * 43758.5);
          ${
            kind === 'needles'
              ? `// the needles: green when there's no snow; snow sits on the branches that face up
                 diffuseColor.rgb *= mix(vec3(0.72, 1.0, 0.66), vec3(0.42, 0.6, 0.44), uSnowCover);
                 tSnow = amount * smoothstep(0.12, 0.62, up + (n - 0.5) * 0.45 - 0.25 * (1.0 - amount));`
              : kind === 'bare'
                ? `// a birch: frosted all over in the snow, white bark low down
                 tSnow = amount * (0.55 + 0.4 * smoothstep(0.0, 0.6, up));`
                : kind === 'bloom'
                  ? 'tSnow = 0.0;'
                  : `// bark: a line of snow along the top of each limb
                 tSnow = amount * smoothstep(0.35, 0.8, up + (n - 0.5) * 0.25);`
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 1.0), clamp(tSnow, 0.0, 1.0));
        }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.7, tSnow);')
      .replace('#include <fog_fragment>', HILL_FOG);
  };
  m.customProgramCacheKey = () => `tree-5c-${kind}`;
  return m;
}

/** cards for the far trees: two atlases (green, snow), mixed by the weather and the height */
export const treeCardUniforms = { uNear: { value: 330 }, tSnowAtlas: { value: null as THREE.Texture | null } };
function cardMaterial(green: THREE.Texture, cells: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map: green, alphaTest: 0.42, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, treeCardUniforms, { uSnowCover: mountainUniforms.uSnowCover, uSnowLine: mountainUniforms.uSnowLine });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCell;\nattribute float aProxy;\nuniform float uNear;\nvarying vec3 vTW;\nvarying float vSnowK;\nuniform float uSnowCover, uSnowLine;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = vec2((uv.x + aCell) / ${cells.toFixed(1)}, uv.y);`)
      .replace(
        '#include <defaultnormal_vertex>',
        `vec3 ipB = instanceMatrix[3].xyz;
        vec3 toC = cameraPosition - ipB;
        toC.y = 0.0;
        toC = normalize(toC + vec3(1e-4, 0.0, 0.0));
        vec3 rightB = vec3(toC.z, 0.0, -toC.x);
        vec3 transformedNormal = normalize(mat3(viewMatrix) * normalize(toC + vec3(0.0, 0.9, 0.0)));
        #ifdef USE_TANGENT
          vec3 transformedTangent = vec3(1.0, 0.0, 0.0);
        #endif
        float ld = 0.55 + 0.45 * fract(sin(dot(ipB.xz, vec2(12.9898, 78.233))) * 43758.5453);
        vSnowK = max(uSnowCover * ld, smoothstep(uSnowLine - 45.0, uSnowLine - 5.0, ipB.y) * 0.8);`,
      )
      .replace(
        '#include <project_vertex>',
        `float showB = (aProxy > 0.5 && length(cameraPosition.xz - ipB.xz) < aProxy * uNear / 330.0) ? 0.0 : 1.0;
        vec3 wpB = ipB + (rightB * position.x * length(instanceMatrix[0].xyz) + vec3(0.0, position.y * length(instanceMatrix[1].xyz), 0.0)) * showB;
        vec4 mvPosition = viewMatrix * vec4(wpB, 1.0);
        gl_Position = projectionMatrix * mvPosition;`,
      )
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(wpB, 1.0);\nvTW = wpB;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTW;\nvarying float vSnowK;\nuniform sampler2D tSnowAtlas;')
      .replace(
        '#include <map_fragment>',
        `vec4 sampledDiffuseColor = mix(texture2D(map, vMapUv), texture2D(tSnowAtlas, vMapUv), clamp(vSnowK, 0.0, 1.0));
        diffuseColor *= sampledDiffuseColor;`,
      )
      .replace('#include <fog_fragment>', HILL_FOG)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
  };
  mat.customProgramCacheKey = () => 'tree-card-5c';
  return mat;
}

function makeSpecies(): Species[] {
  const P = packs as unknown as { pine: { parts: Record<string, PackPart> }; sakura: { parts: Record<string, PackPart> } };
  const pp = P.pine.parts;
  const sp = P.sakura.parts;
  const branchT = tex(branchUrl);
  const bareT = tex(bareUrl);
  const trunkN = tex(trunkNUrl, false);
  trunkN.wrapS = trunkN.wrapT = THREE.RepeatWrapping;
  const bloomT = tex(bloomUrl);
  const barkT = tex(barkUrl);
  barkT.wrapS = barkT.wrapT = THREE.RepeatWrapping;
  // the trunk colour from the pack's own material (it has no texture of its own)
  const trunkCol = new THREE.Color().setRGB(0.119, 0.0897, 0.056, THREE.LinearSRGBColorSpace).multiplyScalar(1.6);
  const needles = (h: number) => treeMaterial({ map: branchT, alphaTest: 0.38, side: THREE.DoubleSide }, 'needles', h, 0.035 * h);
  const trunk = (h: number) => treeMaterial({ color: trunkCol, normalMap: trunkN, normalScale: new THREE.Vector2(0.8, 0.8) }, 'trunk', h, 0.02 * h);
  const hA = pp.spruceA_branch.max[1];
  const hB = pp.spruceB_branch.max[1];
  const hS = pp.sapling_branch.max[1];
  const hBare = pp.bare.max[1];
  const pine = new Uint8Array(pineBin);
  const sak = new Uint8Array(sakuraBin);
  return [
    { parts: [{ geo: partGeo(pine, pp.spruceB_trunk), mat: trunk(hB) }, { geo: partGeo(pine, pp.spruceB_branch), mat: needles(hB) }], h: hB, w: 2.7, near: 330, crown: hB * 0.3 },
    { parts: [{ geo: partGeo(pine, pp.spruceA_trunk), mat: trunk(hA) }, { geo: partGeo(pine, pp.spruceA_branch), mat: needles(hA) }], h: hA, w: 2.2, near: 330, crown: hA * 0.25 },
    { parts: [{ geo: partGeo(pine, pp.sapling_branch), mat: needles(hS) }], h: hS, w: 1.15, near: 260, crown: 0.2 },
    {
      parts: [
        { geo: partGeo(sak, sp.sakura_bark), mat: treeMaterial({ map: barkT }, 'bark', 1, 0.025) },
        { geo: partGeo(sak, sp.sakura_bloom), mat: treeMaterial({ map: bloomT, alphaTest: 0.4, side: THREE.DoubleSide }, 'bloom', 1, 0.03), bloom: true },
      ],
      h: 1,
      w: 0.5,
      near: 88, // 5D: the heaviest tree (and the tunnels are full of it): its card takes over sooner
      crown: 0.35,
    },
    { parts: [{ geo: partGeo(pine, pp.bare), mat: treeMaterial({ map: bareT, alphaTest: 0.3, side: THREE.DoubleSide }, 'bare', hBare, 0.03 * hBare) }], h: hBare, w: 1.6, near: 300, crown: hBare * 0.3 },
  ];
}

/** Render each species from the side into one atlas row (with the given snow cover). */
function bakeCards(renderer: THREE.WebGLRenderer, species: Species[], rt: THREE.WebGLRenderTarget, snow: number): { w: number; h: number }[] {
  const cw = 256;
  const ch = 512;
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(0.4, 1, 0.8);
  scene.add(sun);
  const prevRT = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const keep = { cover: mountainUniforms.uSnowCover.value, line: mountainUniforms.uSnowLine.value, wind: treeUniforms.uWind.value };
  mountainUniforms.uSnowCover.value = snow;
  mountainUniforms.uSnowLine.value = 1e5;
  treeUniforms.uWind.value = 0;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(snow > 0.5 ? 0xd8dce2 : 0x1a2a14, 0);
  renderer.clear();
  const frames: { w: number; h: number }[] = [];
  const one = new THREE.Matrix4();
  species.forEach((sp, i) => {
    const hgt = Math.max(sp.h, sp.w * 4) * 1.03;
    const wid = hgt / 2;
    frames.push({ w: wid, h: hgt });
    const cam = new THREE.OrthographicCamera(-wid / 2, wid / 2, hgt, 0, -50, 50);
    cam.position.set(0, 0, 10);
    const meshes = sp.parts.filter((p) => !(p.bloom && snow > 0.5)).map((p) => {
      const im = new THREE.InstancedMesh(p.geo, p.mat, 1);
      im.setMatrixAt(0, one);
      im.frustumCulled = false;
      scene.add(im);
      return im;
    });
    rt.viewport.set(i * cw, 0, cw, ch);
    rt.scissor.set(i * cw, 0, cw, ch);
    rt.scissorTest = true;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    for (const m of meshes) scene.remove(m);
  });
  rt.scissorTest = false;
  rt.viewport.set(0, 0, cw * species.length, ch);
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(prevClear, prevAlpha);
  mountainUniforms.uSnowCover.value = keep.cover;
  mountainUniforms.uSnowLine.value = keep.line;
  treeUniforms.uWind.value = keep.wind;
  return frames;
}

export interface MountainTrees {
  meshes: THREE.InstancedMesh[];
  forest: THREE.InstancedMesh;
  setQuality(q: Quality): void;
  /** once a frame: the cars near trees (shake, snow and petals knocked off), the weather */
  update(cars: readonly { x: number; z: number; speed: number }[], dt: number): void;
  /** triangles drawn by the near trees right now (for the per-zone report) */
  stats(): { trees: number; tris: number; calls: number };
}

/** The forest mask the old vegetation used (re-exported so the hillsides stay where they were). */
export function buildMountainTrees(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  world: WorldData,
  forestMask: (x: number, z: number) => number,
): MountainTrees {
  const F = world.field!;
  const species = makeSpecies();
  const r = rng(9);
  const CELLSZ = 220;
  const cellMeshes: { mesh: THREE.InstancedMesh; x: number; z: number; near: number; bloom: boolean; tris: number }[] = [];
  const proxies: { x: number; y: number; z: number; sc: number; k: number; c: THREE.Color }[] = [];
  /** near-road trees, by 20 m grid square, for the brush-past check */
  const grid = new Map<number, { x: number; y: number; z: number; k: number; h: number; t: number }[]>();
  const gkey = (x: number, z: number) => Math.floor(x / 20) * 100003 + Math.floor(z / 20);

  // ── the real trees, in 220 m cells ─────────────────────────────────────────
  {
    const cells = new Map<number, { x: number; z: number; per: THREE.Matrix4[][]; cols: THREE.Color[][] }>();
    const q = new THREE.Quaternion();
    const qLean = new THREE.Quaternion();
    const axis = new THREE.Vector3();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (const t of world.trees) {
      const k = t.k ?? 0;
      if (k < 0 || k >= species.length) continue;
      // a lean (more for the young and the bare trees), a random turn and proportions
      const lean = k === 2 || k === 4 ? 0.09 : 0.05;
      q.setFromEuler(e.set((r() - 0.5) * lean, r() * 6.28, (r() - 0.5) * lean));
      // 5D: the tunnel cherries lean in over the road
      if (t.lean) {
        const dx = Math.sin(t.ld ?? 0);
        const dz = Math.cos(t.ld ?? 0);
        q.premultiply(qLean.setFromAxisAngle(axis.set(dz, 0, -dx), t.lean));
      }
      const sc = t.s;
      s.set(sc * (0.85 + r() * 0.3), sc * (0.9 + r() * 0.25), sc * (0.85 + r() * 0.3));
      const y = F.at(t.x, t.z) - 0.12;
      const m = new THREE.Matrix4().compose(v.set(t.x, y, t.z), q, s);
      // colour: a little variety in every tree (cherries pinker or paler)
      const c = k === 3 ? new THREE.Color(1, 0.94 + r() * 0.06, 0.95 + r() * 0.05) : new THREE.Color().setHSL(0.3, 0.1 + r() * 0.15, 0.5).multiplyScalar(1.45 + r() * 0.35);
      const ix = Math.floor(t.x / CELLSZ);
      const iz = Math.floor(t.z / CELLSZ);
      const key = ix * 100003 + iz;
      let cell = cells.get(key);
      if (!cell) cells.set(key, (cell = { x: (ix + 0.5) * CELLSZ, z: (iz + 0.5) * CELLSZ, per: species.map(() => []), cols: species.map(() => []) }));
      cell.per[k].push(m);
      cell.cols[k].push(c);
      proxies.push({ x: t.x, y, z: t.z, sc: s.y, k, c });
      const gk = gkey(t.x, t.z);
      let gl = grid.get(gk);
      if (!gl) grid.set(gk, (gl = []));
      gl.push({ x: t.x, y, z: t.z, k, h: species[k].h * s.y, t: -10 });
    }
    for (const cell of cells.values()) {
      cell.per.forEach((list, k) => {
        if (!list.length) return;
        for (const part of species[k].parts) {
          const im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
          list.forEach((m, i) => {
            im.setMatrixAt(i, m);
            im.setColorAt(i, cell.cols[k][i]);
          });
          // (the blossom's alpha-tested cards are costly in the shadow pass; the limbs still cast)
          im.castShadow = !part.bloom;
          im.receiveShadow = true;
          im.computeBoundingSphere();
          im.name = 'trees';
          scene.add(im);
          const tris = (part.geo.index ? part.geo.index.count : part.geo.getAttribute('position').count) / 3;
          cellMeshes.push({ mesh: im, x: cell.x, z: cell.z, near: species[k].near, bloom: !!part.bloom, tris: tris * list.length });
        }
      });
    }
  }

  // ── the cards: hillside forests, and the roadside trees beyond the near radius ──
  const cw = 256;
  const rtGreen = new THREE.WebGLRenderTarget(cw * species.length, 512, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const rtSnow = new THREE.WebGLRenderTarget(cw * species.length, 512, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  rtGreen.texture.colorSpace = rtSnow.texture.colorSpace = THREE.SRGBColorSpace;
  // frame sizes are known before the bake (they only depend on the species)
  const frames = species.map((sp) => {
    const h = Math.max(sp.h, sp.w * 4) * 1.03;
    return { w: h / 2, h };
  });
  const bake = () => {
    bakeCards(renderer, species, rtGreen, 0);
    bakeCards(renderer, species, rtSnow, 1);
  };
  if (pending === 0) bake();
  else waiters.push(bake);
  treeCardUniforms.tSnowAtlas.value = rtSnow.texture;

  const fr = rng(31);
  const MAXF = 26000 + proxies.length;
  void 0;
  const card = new THREE.PlaneGeometry(1, 1);
  card.translate(0, 0.5, 0);
  const cell = new Float32Array(MAXF);
  card.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 1));
  const proxyA = new Float32Array(MAXF);
  card.setAttribute('aProxy', new THREE.InstancedBufferAttribute(proxyA, 1));
  const forest = new THREE.InstancedMesh(card, cardMaterial(rtGreen.texture, species.length), MAXF);
  let hillFrom = 0;
  {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    let n = 0;
    // the roadside trees first (they stand in for the 3D trees, so every quality keeps them all)
    for (const p of proxies) {
      if (n >= MAXF) break;
      const f = frames[p.k];
      m.makeScale(f.w * p.sc, f.h * p.sc, 1);
      m.setPosition(p.x, p.y - 0.1, p.z);
      forest.setMatrixAt(n, m);
      forest.setColorAt(n, p.c);
      cell[n] = p.k;
      // the card hides within this tree's own near radius (scaled with the quality)
      proxyA[n] = species[p.k].near;
      n++;
    }
    hillFrom = n;
    let guard = 0;
    while (n < MAXF && guard++ < 500000) {
      const x = F.x0 + fr() * (F.nx - 1) * F.cell;
      const z = F.z0 + fr() * (F.nz - 1) * F.cell;
      const y = F.at(x, z);
      // the tree line, ragged; the forest thins out towards it
      const line = 150 + 40 * Math.sin(x * 0.006) * Math.cos(z * 0.007);
      if (y > line) continue;
      if (y > line - 35 && fr() < (y - line + 35) / 35) continue;
      const sl = Math.hypot(F.at(x + 4, z) - y, F.at(x, z + 4) - y) / 4;
      if (sl > 0.65) continue;
      if (forestMask(x, z) < 0.4) continue;
      const hit = world.nearestTrack(x, z);
      if (hit && Math.abs(hit.offset) < 46) continue;
      const u = fr();
      // the valley floor has cherries and birches among the spruces; higher up it is all spruce
      const k = y < 40 ? (u < 0.2 ? 3 : u < 0.35 ? 4 : u < 0.75 ? 0 : 1) : y < line - 30 ? (u < 0.55 ? 0 : u < 0.88 ? 1 : u < 0.95 ? 4 : 2) : u < 0.5 ? 1 : 2;
      const sc = k === 3 ? 6 + fr() * 3 : k === 4 ? 2.6 + fr() * 2 : k === 2 ? 1 + fr() : 1.6 + fr() * 1.2;
      const f = frames[k];
      m.makeScale(f.w * sc, f.h * sc, 1);
      m.setPosition(x, y - 0.5, z);
      forest.setMatrixAt(n, m);
      forest.setColorAt(n, k === 3 ? c.setRGB(1, 0.97, 0.98) : c.setHSL(0.3, 0.15, 0.5).multiplyScalar(1.5 + fr() * 0.3));
      cell[n] = k;
      n++;
    }
    forest.count = n;
  }
  const forestMax = forest.count;
  forest.frustumCulled = false;
  forest.name = 'forest';
  mainOnly(forest);
  scene.add(forest);

  // the near cells follow the camera (decided while the forest draws: one frame late, unseen)
  let nearK = 1;
  let snowNow = 0;
  forest.onBeforeRender = (_r, _s, cam) => {
    const cx = cam.position.x;
    const cz = cam.position.z;
    snowNow = mountainUniforms.uSnowCover.value;
    for (const c of cellMeshes) {
      const lim = c.near * nearK + CELLSZ * 0.72;
      c.mesh.visible = Math.hypot(c.x - cx, c.z - cz) < lim && !(c.bloom && snowNow > 0.5);
    }
  };

  const tmp = new THREE.Vector4();
  return {
    meshes: cellMeshes.map((c) => c.mesh),
    forest,
    setQuality(q) {
      nearK = { low: 0.6, medium: 0.8, high: 1, ultra: 1.27 }[q];
      treeCardUniforms.uNear.value = 330 * nearK;
      const fk = { low: 0.35, medium: 0.6, high: 1, ultra: 1 }[q];
      forest.count = hillFrom + Math.floor((forestMax - hillFrom) * fk);
    },
    update(cars, dt) {
      const U = treeUniforms.uCars.value;
      for (let i = 0; i < 4; i++) U[i].set(1e6, 1e6, 0, 0);
      let n = 0;
      for (const car of cars) {
        if (n >= 4) break;
        if (car.speed < 4) continue;
        U[n++].set(car.x, car.z, car.speed, 0);
        // a car brushing a tree knocks snow (or blossom) off it
        const gk0 = Math.floor(car.x / 20);
        const gk1 = Math.floor(car.z / 20);
        for (let a = -1; a <= 1; a++)
          for (let b = -1; b <= 1; b++) {
            const list = grid.get((gk0 + a) * 100003 + (gk1 + b));
            if (!list) continue;
            for (const t of list) {
              t.t -= dt;
              const d = Math.hypot(t.x - car.x, t.z - car.z);
              if (d > 6.5 || t.t > 0) continue;
              const snow = snowNow > 0.5 || t.y > mountainUniforms.uSnowLine.value - 40;
              if (!snow && t.k !== 3) continue; // a green spruce in the rain has nothing to drop
              if (snow && t.k === 3 && snowNow < 0.5) continue;
              t.t = 2.5;
              treeEvents.push({ x: t.x, y: t.y + t.h * 0.55, z: t.z, snow, n: Math.round(10 + car.speed * 0.6) });
            }
          }
      }
      void tmp;
    },
    stats() {
      let tris = 0;
      let calls = 0;
      let trees = 0;
      for (const c of cellMeshes)
        if (c.mesh.visible) {
          tris += c.tris;
          calls++;
          trees += c.mesh.count;
        }
      return { trees, tris, calls };
    },
  };
}
