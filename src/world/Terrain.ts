// ─────────────────────────────────────────────────────────────────────────────
// Terrain (4C) — the hills around the proving ground. A height field ring starts just outside
// the perimeter fence as gentle grassy foothills and climbs to ridged, rocky ranges 2–3 km out.
// One mesh, one draw call. The shader blends grass, dirt and rock by slope and height (rock is
// sampled triplanar so steep faces don't stretch), and fog thins with altitude so the peaks keep
// their shape through the haze — aerial perspective.
// terrainHeight() is shared with tree and forest placement.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { WORLD } from '../config';
import type { BakedSet } from './MaterialBaker';

export const TERRAIN = { inner: 700, outer: 2900, rings: 64, segments: 288 };

function hash(ix: number, iz: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function fbm(x: number, z: number, oct: number): number {
  let s = 0;
  let a = 0.5;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x, z);
    n += a;
    x = x * 2.03 + 17.1;
    z = z * 2.03 + 3.7;
    a *= 0.5;
  }
  return s / n;
}
function ridged(x: number, z: number, oct: number): number {
  let s = 0;
  let a = 0.5;
  let n = 0;
  let w = 1;
  for (let i = 0; i < oct; i++) {
    let r = 1 - Math.abs(vnoise(x, z) * 2 - 1);
    r *= r * w;
    w = Math.min(1, r * 1.6);
    s += a * r;
    n += a;
    x = x * 2.1 + 5.3;
    z = z * 2.1 + 9.2;
    a *= 0.5;
  }
  return s / n;
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Height of the land at (x, z): 0 inside the circuit's ring, rising to the ranges outside. */
export function terrainHeight(x: number, z: number): number {
  const d = Math.hypot(x - WORLD.boundsCenterX, z - WORLD.boundsCenterZ);
  if (d < TERRAIN.inner) return 0;
  // the inner edge starts just under the flat ground disc, so there's no lip, then lifts clear of it
  const lift = -0.3 + 0.8 * smooth(TERRAIN.inner, TERRAIN.inner + 40, d);
  const foot = smooth(TERRAIN.inner, TERRAIN.inner + 220, d);
  const rise = smooth(TERRAIN.inner + 60, TERRAIN.outer - 300, d);
  const roll = fbm(x / 170, z / 170, 3);
  const r = ridged(x / 820 + 11, z / 820 - 7, 5);
  const gap = 0.55 + 0.45 * fbm(x / 1500 + 3, z / 1500 + 1, 2); // some valleys stay low
  return lift + foot * (3 + roll * 16) * (1 - rise * 0.5) + rise * rise * gap * (70 + 430 * r);
}

/** 0..1 — where the hillside forests grow (clumps and clearings). */
export function forestMask(x: number, z: number): number {
  return fbm(x / 420 + 40, z / 420 - 13, 3);
}

/** Fog for the hills and their forests (needs varying vec3 vTW = world position): half the
 *  haze of the flat world, thinner with height, and a cooler, greyer tint than the ground fog,
 *  so distant ranges fade to blue-grey air rather than into the warm ground haze. */
export const HILL_FOG = /* glsl */ `
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fd = fogDensity * 0.5 * vFogDepth;
      float fogFactor = 1.0 - exp( - fd * fd );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    fogFactor *= mix(1.0, 0.7, smoothstep(30.0, 420.0, vTW.y));
    vec3 haze = mix(fogColor, vec3(dot(fogColor, vec3(0.3, 0.59, 0.11))) * vec3(0.72, 0.82, 1.02), 0.55 * smoothstep(250.0, 1400.0, vFogDepth));
    gl_FragColor.rgb = mix( gl_FragColor.rgb, haze, fogFactor );
  #endif
`;

export function buildTerrain(grass: BakedSet, rock: BakedSet): { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial } {
  const { inner, outer, rings, segments } = TERRAIN;
  const cx = WORLD.boundsCenterX;
  const cz = WORLD.boundsCenterZ;
  const pos = new Float32Array((rings + 1) * (segments + 1) * 3);
  let k = 0;
  for (let i = 0; i <= rings; i++) {
    const r = inner + (outer - inner) * Math.pow(i / rings, 1.6);
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      // the outer edge drops below the horizon so no rim shows against the distant ranges
      const y = i === rings ? -60 : terrainHeight(x, z);
      pos[k++] = x;
      pos[k++] = y;
      pos[k++] = z;
    }
  }
  const idx: number[] = [];
  const W = segments + 1;
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < segments; j++) {
      const a = i * W + j;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const uniforms = { tGrass: { value: grass.map }, tRock: { value: rock.map } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTW;\nvarying vec3 vTN;')
      .replace(
        '#include <fog_vertex>',
        '#include <fog_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTN = normalize(mat3(modelMatrix) * objectNormal);',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTW;
        varying vec3 vTN;
        uniform sampler2D tGrass;
        uniform sampler2D tRock;
        float tvn(vec2 p) {
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
          // grass at the same scale and phase as the flat ground (40 m per tile), so the seam vanishes
          vec3 gr = texture2D(tGrass, vec2(vTW.x, -vTW.z) / 40.0).rgb;
          // rock, triplanar
          vec3 bw = pow(abs(n), vec3(4.0));
          bw /= bw.x + bw.y + bw.z;
          vec3 rk = texture2D(tRock, vTW.zy / 26.0).rgb * bw.x + texture2D(tRock, vTW.xz / 26.0).rgb * bw.y + texture2D(tRock, vTW.xy / 26.0).rgb * bw.z;
          float macro = tvn(vTW.xz * 0.011) * 0.6 + tvn(vTW.xz * 0.043) * 0.4;
          float slope = 1.0 - n.y;
          float rockW = smoothstep(0.3, 0.52, slope + (macro - 0.5) * 0.25 + smoothstep(180.0, 420.0, vTW.y) * 0.25);
          float dirtW = smoothstep(0.2, 0.32, slope + (macro - 0.5) * 0.2) * (1.0 - rockW);
          vec3 dirt = mix(vec3(0.17, 0.13, 0.09), gr * 0.8, 0.35);
          // higher up the grass gets darker and greener (scrub and pine needles), lower it matches the field
          gr = mix(gr, gr * vec3(0.7, 0.85, 0.7), smoothstep(20.0, 160.0, vTW.y));
          vec3 alb = mix(gr, dirt, dirtW);
          alb = mix(alb, rk, rockW);
          alb *= 0.84 + 0.32 * macro;
          diffuseColor.rgb *= alb;
        }`,
      )
      .replace('#include <fog_fragment>', HILL_FOG);
  };
  mat.customProgramCacheKey = () => 'terrain-4c';
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return { mesh, mat };
}
