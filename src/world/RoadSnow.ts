// ─────────────────────────────────────────────────────────────────────────────
// Road snow (5B) — in the Snow weather, the snow lying on the road, drawn from the same map the
// tyres read (WorldData.roadCover), so what you see is what you feel:
//   · packed snow over most of the road, two darker wheel tracks in each lane worn down to wet,
//     dark asphalt, cleaner stretches and drifted patches along the lap;
//   · banks along the edges, and the paved shoulders of a mountain road fully snowed over.
// One transparent strip over the road; it is hidden in every other weather.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { SNOW_COLS } from './surfaceMaps';
import type { WorldData } from './WorldData';

/** 0..1 how much snow lies on the road (set by the Environment from the weather) */
export const roadSnowUniforms = { uRoadSnow: { value: 0 } };
let mesh: THREE.Mesh | null = null;

export function setRoadSnow(amount: number): void {
  roadSnowUniforms.uRoadSnow.value = amount;
  if (mesh) mesh.visible = amount > 0.001;
}

export function buildRoadSnowMesh(scene: THREE.Scene, world: WorldData): THREE.Mesh {
  const S = world.samples;
  const N = S.length;
  const hw = world.halfWidth;
  const map = world.roadSnow;
  const tex = new THREE.DataTexture(new Uint8Array(map), SNOW_COLS, N, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  const v: number[] = [];
  const uv: number[] = [];
  const uv1: number[] = [];
  const idx: number[] = [];
  // columns across: the road itself (u 0..1 = offset +hw..−hw) and, on a mountain road, the
  // shoulders out to the edge of the paving (u < 0 or > 1: fully banked)
  const edge = world.venue.look === 'mountain' ? world.roadBand - 0.6 : hw;
  const offs: number[] = [];
  if (edge > hw) offs.push(edge, hw + 0.6);
  for (let k = 0; k <= 8; k++) offs.push(hw - (k / 8) * 2 * hw);
  if (edge > hw) offs.push(-hw - 0.6, -edge);
  const C = offs.length;
  for (let i = 0; i <= N; i++) {
    const s = S[i % N];
    const vv = (i + 0.5) / N;
    for (const o of offs) {
      const x = s.x + s.nx * o;
      const z = s.z + s.nz * o;
      v.push(x, s.y + 0.012, z);
      // beyond the road: u pushed outside 0..1 (the shader banks it)
      uv.push(Math.abs(o) > hw + 0.01 ? (o > 0 ? -0.5 : 1.5) : (hw - o) / (2 * hw), vv);
      uv1.push(x / 3.2, z / 3.2);
    }
    if (i < N)
      for (let c = 0; c < C - 1; c++) {
        const a = i * C + c;
        idx.push(a, a + 1, a + C, a + 1, a + C + 1, a + C);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    color: 0xf1f4f9,
    roughness: 0.78,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, roadSnowUniforms, { tRoadSnow: { value: tex } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 uv1;\nvarying vec2 vRS;\nvarying vec2 vRW;\nvarying float vRY;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRS = uv;\nvRW = uv1;\nvRY = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tRoadSnow;
        uniform float uRoadSnow;
        varying vec2 vRS;
        varying vec2 vRW;
        varying float vRY;
        float rsIce;
        float rsn(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5);
          float b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5);
          float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5);
          float d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5);
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        float rsCover;`,
      )
      .replace(
        '#include <map_fragment>',
        `{
          float r = (vRS.x < 0.0 || vRS.x > 1.0) ? 0.94 : texture2D(tRoadSnow, vRS).r;
          float grain = rsn(vRW * 4.0) * 0.55 + rsn(vRW * 13.0) * 0.3 + rsn(vRW * 0.7) * 0.15;
          // ragged edges where the snow thins out; compacted, greyer snow where it is thin
          // 5C: tongues of snow blown across the road, most on the exposed high ground
          vec2 wp = vRW * 3.2;
          vec2 wd = normalize(vec2(0.82, 0.57));
          vec2 q = vec2(dot(wp, wd) * 0.07, dot(wp, vec2(-wd.y, wd.x)) * 0.55);
          float tongue = smoothstep(0.6, 0.82, rsn(q) * 0.7 + rsn(q * 2.3 + 4.1) * 0.3);
          float exposed = ${world.field ? '0.3 + 0.7 * smoothstep(95.0, 140.0, vRY)' : '0.0'};
          r = max(r, tongue * exposed * 0.85);
          rsCover = smoothstep(0.22, 0.62, r + (grain - 0.5) * 0.35) * uRoadSnow;
          float packed = smoothstep(0.3, 0.85, r);
          diffuseColor.rgb *= mix(vec3(0.66, 0.7, 0.76), vec3(1.0), packed) * (0.92 + 0.08 * grain);
          // 5C: glossy black ice where the snow has worn thin (in patches, not everywhere)
          rsIce = ${world.field ? 'smoothstep(0.66, 0.8, rsn(wp * 0.045) * 0.75 + rsn(wp * 0.21) * 0.25) * (1.0 - smoothstep(0.25, 0.55, r)) * uRoadSnow' : '0.0'};
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.17, 0.2, 0.25), rsIce);
          diffuseColor.a *= max(rsCover, rsIce * 0.6);
        }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(0.45, 0.82, rsCover), 0.06, rsIce);');
  };
  mat.customProgramCacheKey = () => (world.field ? 'road-snow-5c-m' : 'road-snow-5b');
  const m = new THREE.Mesh(g, mat);
  m.name = 'road-snow';
  m.receiveShadow = true;
  m.renderOrder = 6;
  m.visible = roadSnowUniforms.uRoadSnow.value > 0.001;
  scene.add(m);
  mesh = m;
  return m;
}
