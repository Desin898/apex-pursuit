// ─────────────────────────────────────────────────────────────────────────────
// Hanagiri peaks (5C) — big, close mountains instead of a painted ring.
//
// A ring of real 3D peaks 2–3.3 km out (600–1,050 m high), and one giant face standing over the
// valley sweepers, where the road points straight at it (≈1,250 m, 1.6 km wide). Each is a
// height field built from ridged noise on a cone, so it has ridges, gullies and cliffs.
// The shader paints them: rock in strata, snow lying by slope and aspect (more on the north faces
// and in the gullies, wind-scoured off the ridges), the aerial haze of the distance (HILL_FOG),
// and in the Snow weather the snow comes further down. Cloud caps hang on the summits.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { rng } from '../../core/math';
import { mainOnly } from '../../core/layers';
import { HILL_FOG } from '../Terrain';
import type { WorldData } from '../WorldData';
import { mountainUniforms } from './MountainTerrain';
import { indexAtKm } from './zones';

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
/** ridged multifractal: sharp crests, deep gullies */
function ridged(x: number, y: number, oct: number): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let prev = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1);
    n *= n;
    sum += n * amp * prev;
    prev = n;
    f *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

interface PeakDef {
  x: number;
  z: number;
  h: number;
  r: number;
  seed: number;
  /** stretch across (a wide face rather than a cone) and its facing */
  wide: number;
  yaw: number;
  res: number;
}

function peakGeometry(p: PeakDef): THREE.BufferGeometry {
  const n = p.res;
  const R = p.r;
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  const idx: number[] = [];
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const u = (i / n) * 2 - 1;
      const v = (j / n) * 2 - 1;
      // local frame: u across (stretched for a wide face), v front to back
      const lx = u * R * p.wide;
      const lz = v * R;
      const d = Math.hypot(u, v);
      // the massif: a cone with a broad top, ridges carved by noise
      const cone = Math.max(0, 1 - d);
      const base = Math.pow(cone, 1.35);
      const rg = ridged(u * 2.2 + p.seed, v * 2.2 - p.seed, 5);
      // a steep face on the front (−v) side of a wide mountain: cliffs
      const face = p.wide > 1.2 ? Math.max(0, -v) * 0.35 : 0;
      let h = p.h * (base * (0.62 + 0.55 * rg) + base * base * face);
      h += (vnoise(u * 9 + p.seed, v * 9) - 0.5) * 18 * base;
      // foot sinks below the haze
      h -= 60 * (1 - cone);
      const k = (j * (n + 1) + i) * 3;
      pos[k] = p.x + lx * c + lz * s;
      pos[k + 1] = h - 40;
      pos[k + 2] = p.z - lx * s + lz * c;
      if (i < n && j < n) {
        const a = j * (n + 1) + i;
        idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function buildPeaks(scene: THREE.Scene, world: WorldData): { tris: number; giant: THREE.Vector3 } {
  const r = rng(2026);
  const F = world.field!;
  const cx = world.bounds.x;
  const cz = world.bounds.z;
  // the field reaches about 1.6 km from the centre; peaks stand beyond its corners' reach
  const fieldR = Math.hypot(((F.nx - 1) * F.cell) / 2, ((F.nz - 1) * F.cell) / 2);
  const defs: PeakDef[] = [];

  // the giant face: straight ahead along the valley sweepers
  const S = world.samples;
  const iA = indexAtKm(world, 8.25);
  const iB = indexAtKm(world, 8.7);
  let dx = S[iB].x - S[iA].x;
  let dz = S[iB].z - S[iA].z;
  const dl = Math.hypot(dx, dz) || 1;
  dx /= dl;
  dz /= dl;
  const mid = S[indexAtKm(world, 8.45)];
  // walk out along that line until clear of the field
  let gx = mid.x;
  let gz = mid.z;
  for (let k = 0; k < 400; k++) {
    gx += dx * 25;
    gz += dz * 25;
    if (Math.hypot(gx - cx, gz - cz) > fieldR + 380) break;
  }
  const giant = new THREE.Vector3(gx, 0, gz);
  defs.push({ x: gx, z: gz, h: 1480, r: 1050, seed: 3.7, wide: 1.9, yaw: Math.atan2(dx, dz), res: 128 });
  const gAng = Math.atan2(gz - cz, gx - cx);

  // the ring
  const K = 11;
  for (let k = 0; k < K; k++) {
    const a = (k / K) * Math.PI * 2 + (r() - 0.5) * 0.25;
    let da = a - gAng;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    if (Math.abs(da) < 0.42) continue; // room for the giant
    const d = fieldR + 420 + r() * 900;
    const h = 600 + r() * 450;
    defs.push({ x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d, h, r: 520 + h * 0.45, seed: k * 1.37 + 0.5, wide: 1 + r() * 0.5, yaw: r() * 6.28, res: 84 });
  }

  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uSnowCover: mountainUniforms.uSnowCover });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTW;\nvarying vec3 vTN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTW;
        varying vec3 vTN;
        uniform float uSnowCover;
        float pSnow;
        float pn(vec2 p) {
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
          float slope = 1.0 - n.y;
          float nz = pn(vTW.xz * 0.012) * 0.6 + pn(vTW.xz * 0.05) * 0.3 + pn(vTW.xz * 0.21) * 0.1;
          // rock in strata: bands of grey, brown-grey and near-black, tilted, broken by noise
          float band = sin(vTW.y * 0.075 + vTW.x * 0.004 + nz * 4.0);
          vec3 rock = mix(vec3(0.20, 0.20, 0.21), vec3(0.34, 0.31, 0.28), smoothstep(-0.6, 0.6, band));
          rock = mix(rock, vec3(0.12, 0.12, 0.13), smoothstep(0.7, 0.95, sin(vTW.y * 0.21 + nz * 7.0)) * 0.6);
          rock *= 0.8 + 0.4 * nz;
          // scrub and forest low down
          vec3 low = mix(vec3(0.11, 0.15, 0.09), vec3(0.17, 0.19, 0.12), nz);
          vec3 alb = mix(low, rock, smoothstep(180.0, 360.0, vTW.y + nz * 120.0) * 0.85 + smoothstep(0.45, 0.7, slope) * 0.6);
          // snow: by height, held on gentler ground, more on the north faces and in gullies
          float north = dot(normalize(n.xz + 1e-4), normalize(vec2(-0.35, -0.94))) * smoothstep(0.05, 0.35, slope);
          float line = mix(470.0, 220.0, uSnowCover);
          float hgt = smoothstep(line - 80.0, line + 120.0, vTW.y + nz * 140.0 + north * 90.0);
          float hold = 1.0 - smoothstep(0.42 + 0.12 * north, 0.78, slope + (nz - 0.5) * 0.25);
          pSnow = clamp(hgt * hold, 0.0, 1.0);
          alb = mix(alb, vec3(0.9, 0.93, 0.98) * (0.94 + 0.06 * nz), pSnow);
          diffuseColor.rgb *= alb;
        }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.7, pSnow);')
      .replace('#include <fog_fragment>', HILL_FOG);
  };
  mat.customProgramCacheKey = () => 'peaks-5c';

  let tris = 0;
  const group = new THREE.Group();
  group.name = 'peaks';
  for (const p of defs) {
    const g = peakGeometry(p);
    tris += (g.index ? g.index.count : 0) / 3;
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = false;
    m.castShadow = false;
    m.renderOrder = -1;
    group.add(m);
  }
  scene.add(group);

  // ── cloud caps on the summits: soft billboards that drift and breathe ──────
  {
    const caps: { x: number; y: number; z: number; s: number }[] = [];
    for (const p of defs) {
      const n = p === defs[0] ? 6 : 2 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) caps.push({ x: p.x + (r() - 0.5) * p.r * 0.9 * p.wide, y: p.h * (0.72 + r() * 0.25) - 40, z: p.z + (r() - 0.5) * p.r * 0.6, s: 260 + r() * 340 });
    }
    const quad = new THREE.PlaneGeometry(1, 0.42);
    const im = new THREE.InstancedMesh(
      quad,
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color(0xe8ecf2) } },
        transparent: true,
        depthWrite: false,
        fog: false,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying float vSeed;
          void main() {
            vUv = uv;
            vec3 c = instanceMatrix[3].xyz;
            float s = length(instanceMatrix[0].xyz);
            vSeed = fract(c.x * 0.0137 + c.z * 0.0071);
            vec3 toC = cameraPosition - c;
            toC.y = 0.0;
            toC = normalize(toC + 1e-4);
            vec3 right = vec3(toC.z, 0.0, -toC.x);
            vec3 p = c + right * position.x * s + vec3(0.0, position.y * s, 0.0);
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uCol;
          varying vec2 vUv;
          varying float vSeed;
          float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
          float n2(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
          }
          void main() {
            vec2 q = vUv * vec2(4.0, 1.7) + vec2(uTime * 0.01 + vSeed * 10.0, 0.0);
            float c = n2(q) * 0.5 + n2(q * 2.3) * 0.3 + n2(q * 5.1) * 0.2;
            vec2 d = (vUv - 0.5) * vec2(2.0, 2.0);
            float shape = 1.0 - smoothstep(0.35, 1.0, length(d * vec2(0.9, 1.6)));
            float a = smoothstep(0.38, 0.75, c) * shape * 0.75;
            if (a < 0.01) discard;
            gl_FragColor = vec4(uCol * (0.82 + 0.25 * c), a);
          }`,
      }),
      caps.length,
    );
    const m4 = new THREE.Matrix4();
    caps.forEach((c, i) => im.setMatrixAt(i, m4.makeScale(c.s, c.s, c.s).setPosition(c.x, c.y, c.z)));
    im.frustumCulled = false;
    im.renderOrder = 6;
    im.name = 'cloud-caps';
    mainOnly(im);
    scene.add(im);
    const u = (im.material as THREE.ShaderMaterial).uniforms;
    const white = new THREE.Color(1, 1, 1);
    im.onBeforeRender = () => {
      u.uTime.value = performance.now() / 1000;
      const fog = scene.fog as THREE.FogExp2 | null;
      if (fog) {
        // lit like the sky: bright by day, barely there at night (the fog's own brightness says which)
        const L = fog.color.r * 0.3 + fog.color.g * 0.59 + fog.color.b * 0.11;
        const day = Math.min(1, Math.max(0, (L - 0.08) / 0.37));
        u.uCol.value.copy(fog.color).multiplyScalar(1.15).lerp(white, 0.5 * day * day);
      }
    };
  }
  return { tris, giant };
}
