// ─────────────────────────────────────────────────────────────────────────────
// Mountain terrain (5A) — the Hanagiri height field as meshes.
//
// The field (4 m cells, ≈ 3.2 × 3.1 km) is cut into 512 m chunks. Each chunk has three levels of
// detail (4, 8 and 16 m) and a skirt round its edge, so the seams between levels never open.
// Normals come straight from the field, so neighbouring chunks shade alike.
// Under the road and its shoulders the land is pushed down a little: the road strips are laid on
// top at the exact road height, and the land never pokes through them.
//
// One shader for all of it, blending on the GPU:
//   · grass low down, darker and greener higher up, with fallen cherry petals on the valley floor;
//   · rock (triplanar, so cliffs don't stretch) on the steep faces and the high crags;
//   · snow above the snow line and on the flatter ground, thicker in the snow weather.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import type { BakedSet } from '../MaterialBaker';
import { HILL_FOG } from '../Terrain';
import type { WorldData } from '../WorldData';
import type { HeightField } from './terrain';

/** re-tuned by the weather: snow line (m), snow cover (0..1, the snow weather), petals (0..1) */
export const mountainUniforms = {
  uSnowLine: { value: 150 },
  uSnowCover: { value: 0 },
  uPetals: { value: 1 },
};

const CHUNK = 128; // cells per chunk side (512 m)
const LODS = [1, 2, 4]; // vertex step in cells
const LOD_DIST = [0, 620, 1500];

/** How far each field vertex is from the road, and the road height there (for the push-down). */
function roadMask(world: WorldData, F: HeightField): { dist: Float32Array; y: Float32Array } {
  const dist = new Float32Array(F.nx * F.nz).fill(1e9);
  const y = new Float32Array(F.nx * F.nz);
  const R = world.halfWidth + 9;
  for (const s of world.samples) {
    const i0 = Math.max(0, Math.floor((s.x - R - F.x0) / F.cell));
    const i1 = Math.min(F.nx - 1, Math.ceil((s.x + R - F.x0) / F.cell));
    const k0 = Math.max(0, Math.floor((s.z - R - F.z0) / F.cell));
    const k1 = Math.min(F.nz - 1, Math.ceil((s.z + R - F.z0) / F.cell));
    for (let k = k0; k <= k1; k++) {
      const pz = F.z0 + k * F.cell - s.z;
      for (let i = i0; i <= i1; i++) {
        const px = F.x0 + i * F.cell - s.x;
        const along = px * s.tx + pz * s.tz;
        if (along < -1.2 || along > 1.2) continue;
        const off = Math.abs(px * s.nx + pz * s.nz);
        const j = k * F.nx + i;
        if (off < dist[j]) {
          dist[j] = off;
          y[j] = s.y;
        }
      }
    }
  }
  return { dist, y };
}

export function buildMountainTerrain(world: WorldData, grass: BakedSet, rock: BakedSet): { group: THREE.Group; mat: THREE.MeshStandardMaterial } {
  const F = world.field!;
  const edge = world.roadBand - 0.6; // the paved shoulder's outer edge
  const mask = roadMask(world, F);
  // the land, pushed down under the road strips
  const H = new Float32Array(F.h.length);
  for (let j = 0; j < H.length; j++) H[j] = mask.dist[j] < edge - 0.4 ? Math.min(F.h[j], mask.y[j] - 0.22) : F.h[j];
  const hAt = (i: number, k: number) => H[Math.min(F.nz - 1, Math.max(0, k)) * F.nx + Math.min(F.nx - 1, Math.max(0, i))];

  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  const uniforms = { tGrass: { value: grass.map }, tRock: { value: rock.map }, tRockN: { value: rock.normal } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, mountainUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTW;\nvarying vec3 vTN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTW;
        varying vec3 vTN;
        uniform sampler2D tGrass;
        uniform sampler2D tRock;
        uniform float uSnowLine, uSnowCover, uPetals;
        float mSnow;
        float mvn(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5);
          float b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5);
          float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5);
          float d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5);
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `{
          vec3 n = normalize(vTN);
          // 5C: a second, larger scale mixed in with distance so the grass doesn't tile
          float camD = length(cameraPosition - vTW);
          vec3 gr = mix(texture2D(tGrass, vec2(vTW.x, -vTW.z) / 40.0).rgb, texture2D(tGrass, vec2(vTW.x, -vTW.z) / 173.0 + 0.37).rgb, smoothstep(60.0, 380.0, camD) * 0.75);
          vec3 bw = pow(abs(n), vec3(4.0));
          bw /= bw.x + bw.y + bw.z;
          vec3 rk = texture2D(tRock, vTW.zy / 22.0).rgb * bw.x + texture2D(tRock, vTW.xz / 22.0).rgb * bw.y + texture2D(tRock, vTW.xy / 22.0).rgb * bw.z;
          rk *= vec3(0.86, 0.88, 0.92);
          // 5C: rock strata: bands of darker and paler stone along the height, tilted a little
          float strata = sin((vTW.y + vTW.x * 0.08 - vTW.z * 0.05) * 0.55 + mvn(vTW.xz * 0.02) * 5.0);
          rk *= 0.82 + 0.22 * smoothstep(-0.4, 0.9, strata);
          float macro = mvn(vTW.xz * 0.011) * 0.6 + mvn(vTW.xz * 0.043) * 0.4;
          // 5C: the Snow weather freezes the grass where the snow lies thin: straw and grey
          gr = mix(gr, vec3(dot(gr, vec3(0.33))) * vec3(1.15, 1.08, 0.9), uSnowCover * 0.55);
          float fine = mvn(vTW.xz * 0.31);
          float slope = 1.0 - n.y;
          float rockW = smoothstep(0.34, 0.55, slope + (macro - 0.5) * 0.3 + smoothstep(330.0, 520.0, vTW.y) * 0.3);
          float dirtW = smoothstep(0.2, 0.33, slope + (macro - 0.5) * 0.2) * (1.0 - rockW);
          vec3 dirt = mix(vec3(0.16, 0.12, 0.085), gr * 0.8, 0.3);
          // mossy green low down, darker scrub and pine needles higher, straw-brown near the snow
          gr = mix(gr * vec3(0.95, 1.05, 0.9), gr * vec3(0.62, 0.8, 0.62), smoothstep(30.0, 140.0, vTW.y));
          gr = mix(gr, gr * vec3(1.12, 0.98, 0.72), smoothstep(uSnowLine - 70.0, uSnowLine, vTW.y) * 0.6);
          vec3 alb = mix(gr, dirt, dirtW);
          // fallen cherry petals on the valley floor, in drifts
          float pet = smoothstep(0.62, 0.9, mvn(vTW.xz * 0.9) * 0.55 + mvn(vTW.xz * 0.07) * 0.45) * (1.0 - smoothstep(55.0, 95.0, vTW.y)) * (1.0 - slope * 2.0);
          alb = mix(alb, vec3(0.95, 0.72, 0.78), clamp(pet, 0.0, 1.0) * 0.75 * uPetals);
          alb = mix(alb, rk, rockW);
          alb *= 0.84 + 0.32 * macro;
          // snow: above the line (ragged), on the flatter ground, and over everything in the snow weather
          // 5C: more snow on the faces turned away from the sun (north), less on the sunny ones
          float aspect = dot(normalize(n.xz + vec2(1e-4)), normalize(vec2(-0.35, -0.94))) * smoothstep(0.05, 0.3, slope);
          float line = smoothstep(uSnowLine - 35.0, uSnowLine + 35.0, vTW.y + (macro - 0.5) * 110.0 + (fine - 0.5) * 18.0 + aspect * 30.0);
          // steep faces shed their snow: rock shows through on the cuttings and the crags
          float hold = 1.0 - smoothstep(0.24 + 0.12 * line + 0.06 * aspect, 0.46 + 0.2 * line, slope + (fine - 0.5) * 0.14);
          mSnow = clamp(max(line, uSnowCover * smoothstep(0.25, 0.6, macro * 0.6 + fine * 0.4 + uSnowCover * 0.35)) * hold, 0.0, 1.0);
          vec3 snow = vec3(0.9, 0.93, 0.98) * (0.93 + 0.07 * fine);
          alb = mix(alb, snow, mSnow);
          diffuseColor.rgb *= alb;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.62, mSnow);
        // 5C: fresh snow glints: a few crystals turned to the light, changing as you move
        {
          vec2 gc = floor(vTW.xz * 9.0) + floor(cameraPosition.xz * 0.35);
          float gl = fract(sin(dot(gc, vec2(127.1, 311.7))) * 43758.5453);
          if (mSnow > 0.6 && gl > 0.985) roughnessFactor = 0.04;
        }`,
      )
      .replace('#include <fog_fragment>', HILL_FOG);
  };
  mat.customProgramCacheKey = () => 'mountain-terrain-5a';

  const group = new THREE.Group();
  group.name = 'terrain';
  for (let ck = 0; ck < F.nz - 1; ck += CHUNK) {
    for (let ci = 0; ci < F.nx - 1; ci += CHUNK) {
      const lod = new THREE.LOD();
      const cw = Math.min(CHUNK, F.nx - 1 - ci);
      const chh = Math.min(CHUNK, F.nz - 1 - ck);
      LODS.forEach((step, li) => {
        const g = chunkGeometry(ci, ck, cw, chh, step, hAt, F);
        const mesh = new THREE.Mesh(g, mat);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        lod.addLevel(mesh, LOD_DIST[li]);
      });
      lod.matrixAutoUpdate = false;
      group.add(lod);
    }
  }
  return { group, mat };
}

function chunkGeometry(ci: number, ck: number, cw: number, chh: number, step: number, hAt: (i: number, k: number) => number, F: HeightField): THREE.BufferGeometry {
  const nI = Math.ceil(cw / step) + 1;
  const nK = Math.ceil(chh / step) + 1;
  const skirt = 2 * (nI + nK);
  const pos = new Float32Array((nI * nK + skirt * 2) * 3);
  const nor = new Float32Array(pos.length);
  const idx: number[] = [];
  const c = F.cell;
  let v = 0;
  const put = (i: number, k: number, drop: number) => {
    const y = hAt(i, k);
    // normal from the field's slope (central differences, the same on both sides of a seam)
    const dx = (hAt(i + step, k) - hAt(i - step, k)) / (2 * step * c);
    const dz = (hAt(i, k + step) - hAt(i, k - step)) / (2 * step * c);
    const l = Math.hypot(dx, 1, dz);
    pos[v * 3] = F.x0 + i * c;
    pos[v * 3 + 1] = y - drop;
    pos[v * 3 + 2] = F.z0 + k * c;
    nor[v * 3] = -dx / l;
    nor[v * 3 + 1] = 1 / l;
    nor[v * 3 + 2] = -dz / l;
    return v++;
  };
  const gi = (a: number) => Math.min(ci + a * step, ci + cw);
  const gk = (b: number) => Math.min(ck + b * step, ck + chh);
  for (let b = 0; b < nK; b++) for (let a = 0; a < nI; a++) put(gi(a), gk(b), 0);
  for (let b = 0; b < nK - 1; b++)
    for (let a = 0; a < nI - 1; a++) {
      const p = b * nI + a;
      idx.push(p, p + nI, p + 1, p + 1, p + nI, p + nI + 1);
    }
  // skirts: each edge gets a strip hanging 6 m down (hides the cracks where levels meet)
  const edgeRun = (list: number[], flip: boolean) => {
    const base = list.map((p) => {
      const i = Math.round((pos[p * 3] - F.x0) / c);
      const k = Math.round((pos[p * 3 + 2] - F.z0) / c);
      return put(i, k, 6 * step);
    });
    for (let j = 0; j < list.length - 1; j++) {
      const a = list[j];
      const b = list[j + 1];
      const a2 = base[j];
      const b2 = base[j + 1];
      if (flip) idx.push(a, b, a2, b, b2, a2);
      else idx.push(a, a2, b, b, a2, b2);
    }
  };
  const row = (b: number) => Array.from({ length: nI }, (_, a) => b * nI + a);
  const col = (a: number) => Array.from({ length: nK }, (_, b) => b * nI + a);
  edgeRun(row(0), true);
  edgeRun(row(nK - 1), false);
  edgeRun(col(0), false);
  edgeRun(col(nI - 1), true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
