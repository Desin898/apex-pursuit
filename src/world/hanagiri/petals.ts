// ─────────────────────────────────────────────────────────────────────────────
// Sakura petals (5D) — the sakura tunnels' petals:
//   · a carpet on the road: thick along the edges and the shoulders, thinner across the lanes and
//     swept almost clear in the wheel tracks, petals of a few pinks lying every which way;
//   · petals drifting down round the camera while you drive through a tunnel (and a few in the
//     village), tumbling as they fall.
// Neither shows in the Snow weather (the cherries are bare then). Both are a single draw.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { WORLD } from '../../config';
import { mainOnly } from '../../core/layers';
import { groundUniforms } from '../../fx/Reflections';
import type { WorldData } from '../WorldData';
import { mountainUniforms } from './MountainTerrain';
import { indexAtKm, SAKURA_TUNNELS } from './zones';

/** The petal carpet along each sakura tunnel. */
export function buildPetalCarpet(scene: THREE.Scene, world: WorldData): THREE.Mesh {
  const S = world.samples;
  const N = S.length;
  const hw = world.halfWidth;
  const edge = world.roadBand - 0.6;
  const offs = [edge + 1.6, edge, hw + 0.6, hw * 0.7, hw * 0.35, 0, -hw * 0.35, -hw * 0.7, -hw - 0.6, -edge, -edge - 1.6];
  const C = offs.length;
  const v: number[] = [];
  const at: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const t of SAKURA_TUNNELS) {
    const i0 = indexAtKm(world, t.from - 0.03);
    const n = Math.round(((t.to - t.from + 0.06) * 1000) / WORLD.sampleSpacing);
    for (let k = 0; k <= n; k++) {
      const s = S[(i0 + k) % N];
      // fade in and out over the first and last 50 m
      const fade = Math.min(1, Math.min(k, n - k) / (50 / WORLD.sampleSpacing));
      for (const o of offs) {
        v.push(s.x + s.nx * o, s.y + 0.016, s.z + s.nz * o);
        at.push(o, fade);
      }
      if (k < n)
        for (let c = 0; c < C - 1; c++) {
          const a = base + k * C + c;
          idx.push(a, a + 1, a + C, a + 1, a + C + 1, a + C);
        }
    }
    base += (n + 1) * C;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('aPet', new THREE.Float32BufferAttribute(at, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.7,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -9,
    polygonOffsetUnits: -9,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSnowCover = mountainUniforms.uSnowCover;
    sh.uniforms.uWet = groundUniforms.uWet;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aPet;\nvarying vec2 vPet;\nvarying vec2 vPW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPet = aPet;\nvPW = (modelMatrix * vec4(position, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uSnowCover;
        uniform float uWet;
        float petalGlow;
        varying vec2 vPet;
        varying vec2 vPW;
        float pH(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        float pN(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(pH(i), pH(i + vec2(1, 0)), f.x), mix(pH(i + vec2(0, 1)), pH(i + vec2(1, 1)), f.x), f.y);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `{
          float o = abs(vPet.x);
          // thick along the edges, thinner over the lanes, swept nearly clear in the wheel tracks
          float edgeK = smoothstep(${(hw * 0.35).toFixed(2)}, ${(hw + 0.8).toFixed(2)}, o);
          float tr = exp(-pow((o - ${(hw * 0.5 - 0.8).toFixed(2)}) / 0.45, 2.0)) + exp(-pow((o - ${(hw * 0.5 + 0.8).toFixed(2)}) / 0.45, 2.0));
          float drift = pN(vPW * 0.35) * 0.6 + pN(vPW * 1.3) * 0.4;
          float dens = (0.16 + 0.8 * edgeK) * (1.0 - 0.8 * tr * (1.0 - edgeK)) * (0.55 + 0.9 * drift) * vPet.y;
          float a = 0.0;
          vec3 col = vec3(0.0);
          for (int L = 0; L < 3; L++) {
            float cs = L == 0 ? 0.24 : L == 1 ? 0.17 : 0.12;
            vec2 gq = vPW / cs + float(L) * 17.3;
            vec2 id = floor(gq);
            float h = pH(id);
            if (h < dens * (L == 2 ? 0.7 : 1.0)) {
              vec2 f = fract(gq) - 0.5 - (vec2(pH(id + 1.7), pH(id + 5.3)) - 0.5) * 0.4;
              float ang = pH(id + 3.1) * 6.2832;
              vec2 r = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * f;
              // a petal: an oval with a notch at its tip
              float e = length(r * vec2(1.0, 1.75));
              float p = 1.0 - smoothstep(0.24, 0.31, e);
              p *= 1.0 - smoothstep(0.03, 0.06, length(r - vec2(0.0, 0.17))) * 0.9;
              vec3 c = mix(vec3(0.97, 0.62, 0.76), vec3(1.0, 0.88, 0.92), pH(id + 9.1));
              c *= 0.85 + 0.15 * pH(id + 4.4);
              if (p > a) { a = p; col = c; }
            }
          }
          // a pink drift of crushed petals along the edges
          float haze = edgeK * smoothstep(0.25, 0.75, drift) * 0.6 * vPet.y;
          petalGlow = 0.0;
          col = mix(vec3(0.96, 0.6, 0.74), col, a / max(a + haze, 1e-3));
          a = max(a, haze);
          // wet petals in the rain: darker, glossier
          col *= 1.0 - 0.3 * uWet;
          diffuseColor.rgb = col;
          petalGlow = a;
          diffuseColor.a = a * (1.0 - smoothstep(0.02, 0.2, uSnowCover));
          if (diffuseColor.a < 0.02) discard;
        }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.72, 0.35, uWet);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.09 * petalGlow;');
  };
  mat.customProgramCacheKey = () => 'petal-carpet-5d2';
  const m = new THREE.Mesh(g, mat);
  m.name = 'petal-carpet';
  m.receiveShadow = true;
  m.renderOrder = 6;
  mainOnly(m);
  scene.add(m);
  return m;
}

/** Petals drifting down round the camera (like the snow, on the GPU). */
export class PetalFall {
  readonly points: THREE.Points;
  private u = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uScale: { value: 600 }, uAmt: { value: 0 }, uLight: { value: new THREE.Color(1, 1, 1) } };
  private max: number;

  constructor(scene: THREE.Scene, max = 2600) {
    this.max = max;
    const pos = new Float32Array(max * 3);
    const ph = new Float32Array(max);
    let s = 777;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < max; i++) {
      pos[i * 3] = (r() * 2 - 1) * 28;
      pos[i * 3 + 1] = r() * 16;
      pos[i * 3 + 2] = (r() * 2 - 1) * 28;
      ph[i] = r() * 100;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aPh;
        uniform float uTime, uScale, uAmt;
        uniform vec3 uCam;
        varying float vA;
        varying float vAng;
        varying float vTone;
        void main() {
          vec3 p = position;
          float t = uTime + aPh;
          // petals fall slowly and swing from side to side as they go
          p.y -= t * (0.55 + fract(aPh * 3.7) * 0.45);
          p.x += t * 0.6 + sin(t * 1.3 + aPh) * 1.1;
          p.z += sin(t * 0.9 + aPh * 2.3) * 1.1 + t * 0.25;
          p.xz = mod(p.xz - uCam.xz + 28.0, 56.0) - 28.0 + uCam.xz;
          p.y = mod(p.y - uCam.y + 4.0, 16.0) - 4.0 + uCam.y;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = max(0.3, -mv.z);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uScale * 0.035 / d, 1.0, 22.0);
          // only the share of petals the amount asks for
          vA = step(fract(aPh * 13.37), uAmt) * smoothstep(0.4, 1.8, d) * (1.0 - smoothstep(16.0, 28.0, length(p.xz - uCam.xz)));
          vAng = t * (1.5 + fract(aPh * 5.1) * 2.0);
          vTone = fract(aPh * 7.7);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uLight;
        varying float vA;
        varying float vAng;
        varying float vTone;
        void main() {
          if (vA < 0.01) discard;
          vec2 c = gl_PointCoord - 0.5;
          // a tumbling petal: an oval that turns and narrows as it flips
          float ca = cos(vAng), sa = sin(vAng);
          vec2 r = mat2(ca, -sa, sa, ca) * c;
          float flip = 0.35 + 0.65 * abs(sin(vAng * 0.7));
          float e = length(r * vec2(1.0 / flip, 1.7));
          float a = (1.0 - smoothstep(0.32, 0.45, e)) * vA;
          if (a < 0.02) discard;
          vec3 col = mix(vec3(0.98, 0.72, 0.82), vec3(1.0, 0.93, 0.95), vTone) * uLight;
          gl_FragColor = vec4(col, a * 0.95);
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.renderOrder = 9;
    this.points.name = 'petals';
    mainOnly(this.points);
    scene.add(this.points);
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.u.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /** amount 0..1 of petals falling here; light: how bright they look */
  update(time: number, cam: THREE.Vector3, amount: number, light: number): void {
    this.u.uAmt.value += (amount - this.u.uAmt.value) * 0.05;
    this.points.visible = this.u.uAmt.value > 0.01;
    if (!this.points.visible) return;
    this.u.uTime.value = time;
    this.u.uCam.value.copy(cam);
    this.u.uLight.value.setScalar(light);
    this.points.geometry.setDrawRange(0, this.max);
  }
}
