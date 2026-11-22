// ─────────────────────────────────────────────────────────────────────────────
// Vegetation (4C) — trees, hillside forests and grass, all instanced and built in code.
// - Three tree species (pine, broadleaf, cypress) with jagged, irregular foliage, soft
//   "canopy" normals so they shade like a crown rather than a cone, baked ambient occlusion in
//   the vertex colours, and wind sway in the vertex shader. One draw call per species.
// - Hillside forests: thousands of impostors (camera-facing cards) whose pictures are rendered
//   from the real 3D trees at start-up, so near and far trees match. One draw call.
// - Grass clumps along the track edges: crossed cards with drawn blades, swaying, fading out
//   beyond ~70 m. One draw call, main camera only (no cost in reflections and mirrors).
// Density follows the graphics quality (setQuality).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../core/math';
import { mainOnly } from '../core/layers';
import { WORLD } from '../config';
import { Surface, WorldData } from './WorldData';
import { HILL_FOG, TERRAIN, forestMask, terrainHeight } from './Terrain';

/** shared by every vegetation shader: time and wind strength (rain makes it gustier) */
export const vegUniforms = { uTime: { value: 0 }, uWind: { value: 0.45 }, uWash: { value: new THREE.Vector4(0, 0, 1, 0) } };

type Quality = 'low' | 'medium' | 'high' | 'ultra';

// ── geometry helpers ───────────────────────────────────────────────────────────
const h3 = (x: number, y: number, z: number, s: number) => {
  const n = Math.sin(Math.round(x * 100) * 12.9898 + Math.round(y * 100) * 78.233 + Math.round(z * 100) * 37.719 + s * 4.1) * 43758.5453;
  return n - Math.floor(n);
};

/** Displace vertices by a hash of their position (so duplicated seam vertices move together). */
function jitter(g: THREE.BufferGeometry, amt: number, seed: number, droop = 0): void {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z);
    const k = r > 0.05 ? 1 : 0.3; // keep tips nearly in place
    p.setXYZ(
      i,
      x + (h3(x, y, z, seed) - 0.5) * amt * k,
      y + (h3(x, y, z, seed + 1) - 0.5) * amt * 0.6 - droop * (r > 0.05 ? h3(x, y, z, seed + 2) : 0),
      z + (h3(x, y, z, seed + 3) - 0.5) * amt * k,
    );
  }
}

/** Foliage: canopy normals (pointing out from the crown centre) and vertex colours with AO. */
function foliage(g: THREE.BufferGeometry, centre: THREE.Vector3, base: THREE.Color, tip: THREE.Color, y0: number, y1: number, seed: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('uv');
  ng.computeVertexNormals();
  const p = ng.getAttribute('position') as THREE.BufferAttribute;
  const n = ng.getAttribute('normal') as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  const o = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    o.copy(v).sub(centre);
    o.y *= 0.6;
    o.normalize();
    const gn = new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i));
    const out = gn.dot(o);
    o.lerp(gn, 0.35).normalize();
    n.setXYZ(i, o.x, o.y, o.z);
    const hy = Math.min(1, Math.max(0, (v.y - y0) / (y1 - y0)));
    const ao = 0.45 + 0.55 * Math.pow(hy, 0.7);
    c.copy(base).lerp(tip, Math.min(1, Math.max(0, 0.25 + 0.6 * out + (h3(v.x, v.y, v.z, seed) - 0.5) * 0.5)));
    col[i * 3] = c.r * ao;
    col[i * 3 + 1] = c.g * ao;
    col[i * 3 + 2] = c.b * ao;
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}

function trunk(r0: number, r1: number, h: number, colour: THREE.Color, tilt = 0, yaw = 0, y = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, h, 6, 1, true).toNonIndexed();
  g.translate(0, h / 2, 0);
  if (tilt) {
    g.rotateZ(tilt);
    g.rotateY(yaw);
  }
  g.translate(0, y, 0);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const ao = 0.6 + 0.4 * Math.min(1, p.getY(i) / 3);
    col[i * 3] = colour.r * ao;
    col[i * 3 + 1] = colour.g * ao;
    col[i * 3 + 2] = colour.b * ao;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

interface Species {
  geo: THREE.BufferGeometry;
  /** model height and half width, for the impostor frame */
  h: number;
  w: number;
}

function pine(): Species {
  const parts = [trunk(0.32, 0.12, 3.6, new THREE.Color(0.2, 0.13, 0.08))];
  const base = new THREE.Color(0.035, 0.085, 0.05);
  const tip = new THREE.Color(0.1, 0.2, 0.09);
  for (let i = 0; i < 5; i++) {
    const r = 2.4 - i * 0.44;
    const h = 2.7 - i * 0.2;
    const c = new THREE.ConeGeometry(r, h, 11, 3, true);
    c.translate(0, 1.9 + i * 1.38 + h / 2, 0);
    jitter(c, 0.35, i * 7 + 1, 0.35);
    parts.push(foliage(c, new THREE.Vector3(0, 5.2, 0), base, tip, 1.6, 10, i));
  }
  return { geo: mergeGeometries(parts)!, h: 10.6, w: 2.7 };
}

function broadleaf(): Species {
  const bark = new THREE.Color(0.22, 0.16, 0.1);
  const parts = [trunk(0.36, 0.2, 3.6, bark), trunk(0.16, 0.08, 2.2, bark, 0.7, 0.4, 2.6), trunk(0.15, 0.08, 2.0, bark, -0.65, -0.9, 2.9)];
  const base = new THREE.Color(0.06, 0.12, 0.04);
  const tip = new THREE.Color(0.16, 0.24, 0.08);
  const r = rng(77);
  const centre = new THREE.Vector3(0, 5.4, 0);
  for (let i = 0; i < 8; i++) {
    const rad = 1.3 + r() * 0.8;
    const s = new THREE.IcosahedronGeometry(rad, 1);
    const a = r() * Math.PI * 2;
    const d = i === 0 ? 0 : 1.1 + r() * 0.9;
    s.translate(Math.cos(a) * d, 5.0 + (r() - 0.35) * 2.2 + (i === 0 ? 0.8 : 0), Math.sin(a) * d);
    jitter(s, 0.55, i * 5 + 3);
    parts.push(foliage(s, centre, base, tip, 3, 8.2, i + 10));
  }
  return { geo: mergeGeometries(parts)!, h: 8.6, w: 3.4 };
}

function cypress(): Species {
  const parts = [trunk(0.22, 0.12, 1.6, new THREE.Color(0.18, 0.12, 0.08))];
  const s = new THREE.SphereGeometry(1, 12, 10);
  s.scale(1.15, 4.4, 1.15);
  s.translate(0, 5.6, 0);
  jitter(s, 0.32, 19);
  parts.push(foliage(s, new THREE.Vector3(0, 5.6, 0), new THREE.Color(0.03, 0.08, 0.045), new THREE.Color(0.09, 0.17, 0.08), 1.2, 10, 30));
  return { geo: mergeGeometries(parts)!, h: 10.2, w: 1.5 };
}

// ── shaders ────────────────────────────────────────────────────────────────────
function windTrees(mat: THREE.MeshStandardMaterial): void {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, vegUniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;\nuniform vec4 uWash;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        vec3 ip = instanceMatrix[3].xyz;
        float ph = ip.x * 0.071 + ip.z * 0.053;
        float hgt = max(transformed.y - 1.2, 0.0);
        float bend = hgt * hgt * 0.0035 * uWind;
        transformed.x += (sin(uTime * 1.1 + ph) * 0.7 + sin(uTime * 2.6 + ph * 1.7) * 0.3) * bend;
        transformed.z += (cos(uTime * 0.9 + ph * 1.3) * 0.5) * bend;
        // 4E: rotor wash bends the crowns away from a low helicopter, shaking them
        vec2 aw = ip.xz - uWash.xy;
        float wr = length(aw);
        float wk = uWash.w * (1.0 - smoothstep(uWash.z * 0.2, uWash.z, wr));
        if (wk > 0.001) {
          vec3 ld = normalize(transpose(mat3(instanceMatrix)) * vec3(aw.x, 0.0, aw.y) + vec3(1e-4));
          transformed.xz += ld.xz * hgt * hgt * 0.012 * wk * (1.0 + 0.35 * sin(uTime * 9.0 + ph));
        }
        // leaves flutter a little on their own
        transformed += normal * sin(uTime * 5.0 + dot(transformed, vec3(1.3, 0.7, 1.1))) * 0.04 * uWind * step(1.5, transformed.y);
      }`,
    );
  };
  mat.customProgramCacheKey = () => 'veg-tree';
}

/** cylindrical billboards: each instance faces the camera, turning about its vertical axis */
function impostorMaterial(atlas: THREE.Texture, cells: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.42, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCell;\nvarying vec3 vTW;')
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
        #endif`,
      )
      .replace(
        '#include <project_vertex>',
        `vec3 wpB = ipB + rightB * position.x * length(instanceMatrix[0].xyz) + vec3(0.0, position.y * length(instanceMatrix[1].xyz), 0.0);
        vec4 mvPosition = viewMatrix * vec4(wpB, 1.0);
        gl_Position = projectionMatrix * mvPosition;`,
      )
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(wpB, 1.0);\nvTW = wpB;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTW;').replace('#include <fog_fragment>', HILL_FOG).replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
  };
  mat.customProgramCacheKey = () => 'veg-impostor';
  return mat;
}

function grassTexture(): THREE.DataTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  const r = rng(5);
  for (let i = 0; i < 90; i++) {
    const x = 8 + r() * 240;
    const hgt = 50 + r() * 76;
    const lean = (r() - 0.5) * 50;
    const w = 2 + r() * 3.5;
    const l = 22 + r() * 30;
    const dry = r() < 0.18;
    const grad = g.createLinearGradient(0, 128, 0, 128 - hgt);
    grad.addColorStop(0, `hsl(${dry ? 48 : 95 + r() * 20}, 45%, ${l * 0.7}%)`);
    grad.addColorStop(1, `hsl(${dry ? 50 : 80 + r() * 25}, ${dry ? 40 : 55}%, ${l}%)`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x - w, 128);
    g.quadraticCurveTo(x - w * 0.5 + lean * 0.3, 128 - hgt * 0.6, x + lean, 128 - hgt);
    g.quadraticCurveTo(x + w * 0.5 + lean * 0.3, 128 - hgt * 0.6, x + w, 128);
    g.closePath();
    g.fill();
  }
  // copy the pixels out and give the transparent texels a grass colour, so mipmaps don't
  // darken the blade edges (a canvas stores transparent pixels as black)
  const img = g.getImageData(0, 0, c.width, c.height).data;
  const px = new Uint8Array(img.length);
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const o = ((c.height - 1 - y) * c.width + x) * 4; // flip: row 0 is the bottom in WebGL
      const a = img[i + 3];
      if (a > 8) {
        px[o] = img[i];
        px[o + 1] = img[i + 1];
        px[o + 2] = img[i + 2];
      } else {
        px[o] = 70;
        px[o + 1] = 96;
        px[o + 2] = 40;
      }
      px[o + 3] = a;
    }
  const t = new THREE.DataTexture(px, c.width, c.height, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function grassMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map: grassTexture(), alphaTest: 0.5, roughness: 0.9, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, vegUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;\nuniform vec4 uWash;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = instanceMatrix[3].xyz;
          float dd = distance(ip.xz, cameraPosition.xz);
          transformed *= 1.0 - smoothstep(52.0, 75.0, dd); // shrink away into the distance
          float ph = ip.x * 0.31 + ip.z * 0.27;
          float k = transformed.y * transformed.y * uWind;
          transformed.x += (sin(uTime * 2.1 + ph) * 0.6 + sin(uTime * 4.3 + ph * 2.0) * 0.25) * 0.5 * k;
          transformed.z += cos(uTime * 1.7 + ph) * 0.3 * k;
          // 4E: flattened and rippling under the rotor wash
          vec2 aw = ip.xz - uWash.xy;
          float wr = length(aw);
          float wk = uWash.w * (1.0 - smoothstep(uWash.z * 0.15, uWash.z, wr));
          if (wk > 0.001) {
            vec3 ld = normalize(transpose(mat3(instanceMatrix)) * vec3(aw.x, 0.0, aw.y) + vec3(1e-4));
            float fl = transformed.y * transformed.y * wk * (0.9 + 0.4 * sin(uTime * 14.0 + wr * 0.8));
            transformed.xz += ld.xz * fl * 1.1;
            transformed.y *= 1.0 - 0.35 * wk;
          }
        }`,
      )
      // light the blades like the ground under them, not like vertical cards
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\ntransformedNormal = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));');
    // both faces of a card take the same (upward) normal: no dark backs
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
  };
  mat.customProgramCacheKey = () => 'veg-grass';
  return mat;
}

/** Render each species from the side into one atlas, for the impostors. */
function bakeImpostors(renderer: THREE.WebGLRenderer, species: Species[]): { tex: THREE.Texture; frames: { w: number; h: number }[] } {
  const cw = 256;
  const ch = 512;
  const rt = new THREE.WebGLRenderTarget(cw * species.length, ch, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55);
  sun.position.set(0.4, 1, 0.8);
  scene.add(sun);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const prevRT = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x1a2a14, 0);
  renderer.clear();
  const frames: { w: number; h: number }[] = [];
  species.forEach((sp, i) => {
    const hgt = Math.max(sp.h, sp.w * 4) * 1.03;
    const wid = hgt / 2;
    frames.push({ w: wid, h: hgt });
    const cam = new THREE.OrthographicCamera(-wid / 2, wid / 2, hgt, 0, -50, 50);
    cam.position.set(0, 0, 10);
    const m = new THREE.Mesh(sp.geo, mat);
    scene.add(m);
    rt.viewport.set(i * cw, 0, cw, ch);
    rt.scissor.set(i * cw, 0, cw, ch);
    rt.scissorTest = true;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    scene.remove(m);
  });
  rt.scissorTest = false;
  rt.viewport.set(0, 0, cw * species.length, ch);
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(prevClear, prevAlpha);
  return { tex: rt.texture, frames };
}

export interface VegetationVisuals {
  trees: THREE.InstancedMesh[];
  forest: THREE.InstancedMesh;
  grass: THREE.InstancedMesh;
  treeMat: THREE.MeshStandardMaterial;
  setQuality(q: Quality): void;
}

export function buildVegetation(scene: THREE.Scene, renderer: THREE.WebGLRenderer, world: WorldData): VegetationVisuals {
  const species = [pine(), broadleaf(), cypress()];
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  windTrees(treeMat);

  // ── 3D trees where WorldData put them ──────────────────────────────────────
  const r = rng(9);
  const kinds = world.trees.map((t) => {
    const u = h3(t.x, 0, t.z, 3);
    return u < 0.55 ? 0 : u < 0.85 ? 1 : 2;
  });
  const trees = species.map((sp, k) => {
    const list = world.trees.filter((_, i) => kinds[i] === k);
    const im = new THREE.InstancedMesh(sp.geo, treeMat, Math.max(1, list.length));
    im.count = list.length;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    list.forEach((t, i) => {
      // a slight lean, random turn and proportions, so no two look alike
      q.setFromEuler(e.set((r() - 0.5) * 0.06, r() * 6.28, (r() - 0.5) * 0.06));
      const sc = t.s * (1.05 + r() * 0.35);
      s.set(sc * (0.85 + r() * 0.3), sc * (0.9 + r() * 0.3), sc * (0.85 + r() * 0.3));
      m.compose(v.set(t.x, terrainHeight(t.x, t.z) - 0.15, t.z), q, s);
      im.setMatrixAt(i, m);
      im.setColorAt(i, c.setHSL(0.27 + (r() - 0.5) * 0.08, 0.35 + r() * 0.3, 0.42 + r() * 0.2).multiplyScalar(1.9));
    });
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    im.name = 'trees';
    scene.add(im);
    return im;
  });

  // ── hillside forests (impostors) ──────────────────────────────────────────
  const atlas = bakeImpostors(renderer, species);
  const MAXF = 14000;
  const card = new THREE.PlaneGeometry(1, 1);
  card.translate(0, 0.5, 0);
  const cell = new Float32Array(MAXF);
  card.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 1));
  const forest = new THREE.InstancedMesh(card, impostorMaterial(atlas.tex, species.length), MAXF);
  {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const fr = rng(31);
    let n = 0;
    let guard = 0;
    while (n < MAXF && guard++ < 200000) {
      const a = fr() * Math.PI * 2;
      const d = 1000 + Math.pow(fr(), 0.8) * (TERRAIN.outer - 700 - 1000);
      const x = WORLD.boundsCenterX + Math.cos(a) * d;
      const z = WORLD.boundsCenterZ + Math.sin(a) * d;
      const y = terrainHeight(x, z);
      if (y > 360) continue;
      const sl = Math.hypot(terrainHeight(x + 4, z) - y, terrainHeight(x, z + 4) - y) / 4;
      if (sl > 0.55) continue;
      if (forestMask(x, z) < 0.46 - Math.min(0.08, y / 3000)) continue;
      const k = fr() < 0.6 ? 0 : fr() < 0.7 ? 1 : 2;
      const sc = 1.4 + fr() * 1.0;
      const f = atlas.frames[k];
      m.makeScale(f.w * sc, f.h * sc, 1);
      m.setPosition(x, y - 0.6, z);
      forest.setMatrixAt(n, m);
      forest.setColorAt(n, c.setHSL(0.27 + (fr() - 0.5) * 0.06, 0.4, 0.5 + fr() * 0.15).multiplyScalar(2));
      cell[n] = k;
      n++;
    }
    forest.count = n;
  }
  forest.frustumCulled = false; // spread all around: a bounding sphere would always intersect anyway
  forest.name = 'forest';
  mainOnly(forest);
  scene.add(forest);

  // ── grass clumps near the track ────────────────────────────────────────────
  const MAXG = 24000;
  const tuft = mergeGeometries(
    [0, 1, 2].map((i) => {
      const p = new THREE.PlaneGeometry(0.75, 0.45);
      p.translate(0, 0.225, 0);
      p.rotateY((i * Math.PI) / 3);
      return p;
    }),
  )!;
  const grass = new THREE.InstancedMesh(tuft, grassMaterial(), MAXG);
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    const gr = rng(55);
    const S = world.samples;
    const hw = world.halfWidth;
    let n = 0;
    let guard = 0;
    while (n < MAXG && guard++ < 160000) {
      const smp = S[Math.floor(gr() * S.length)];
      const side = gr() < 0.5 ? -1 : 1;
      const off = hw + 3.2 + Math.pow(gr(), 1.8) * 22;
      const along = (gr() - 0.5) * 6;
      const x = smp.x + smp.nx * off * side + smp.tx * along;
      const z = smp.z + smp.nz * off * side + smp.tz * along;
      if (world.surfaceAt(x, z) !== Surface.Grass) continue;
      const hit = world.nearestTrack(x, z);
      if (hit && Math.abs(hit.offset) < hw + 3) continue;
      if (Math.hypot(x - world.pad.x, z - world.pad.z) < world.pad.r + 6) continue;
      q.setFromEuler(e.set(0, gr() * 6.28, 0));
      const sc = 0.6 + gr() * 0.9;
      s.set(sc, sc * (0.7 + gr() * 0.6), sc);
      m.compose(v.set(x, 0, z), q, s);
      grass.setMatrixAt(n, m);
      grass.setColorAt(n, c.setHSL(0.24 + (gr() - 0.5) * 0.05, 0.3, 0.42 + gr() * 0.12).multiplyScalar(1.8));
      n++;
    }
    grass.count = n;
    grass.userData.max = n;
  }
  grass.frustumCulled = false;
  grass.receiveShadow = true;
  grass.name = 'grass';
  mainOnly(grass);
  scene.add(grass);

  const forestMax = forest.count;
  return {
    trees,
    forest,
    grass,
    treeMat,
    setQuality(q: Quality) {
      const gk = { low: 0, medium: 0.35, high: 0.7, ultra: 1 }[q];
      const fk = { low: 0.35, medium: 0.6, high: 1, ultra: 1 }[q];
      grass.count = Math.floor(grass.userData.max * gk);
      grass.visible = grass.count > 0;
      forest.count = Math.floor(forestMax * fk);
    },
  };
}
