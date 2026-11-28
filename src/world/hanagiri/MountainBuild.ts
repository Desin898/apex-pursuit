// ─────────────────────────────────────────────────────────────────────────────
// Mountain roadside (5A) — what WorldBuilder adds on a mountain venue:
//   · the paved shoulder either side of the road, the white edge lines and the centre line;
//   · steel guard rails on posts along the drops and round the outside of the bends;
//   · cut rock faces where the road is dug into the hillside;
//   · the far snow-capped ranges round the whole valley.
// All of it follows the road's height (TrackSample.y) or the land (the height field).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { WORLD } from '../../config';
import { rng } from '../../core/math';
import type { BakedSet } from '../MaterialBaker';
import { HILL_FOG } from '../Terrain';
import type { WorldData } from '../WorldData';

function geo(v: number[], uv: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A strip along the whole lap between two offsets (both sides), at the road height + lift. */
function sideStrips(world: WorldData, o0: number, o1: number, lift: number, uScale: number, vScale: number, dash?: number): THREE.BufferGeometry {
  const S = world.samples;
  const N = S.length;
  const v: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let n = 0;
  for (const side of [1, -1]) {
    for (let i = 0; i < N; i++) {
      const a = S[i];
      const b = S[(i + 1) % N];
      if (dash && Math.floor(a.s / dash) % 2 === 1) continue;
      const pa0 = [a.x + a.nx * o0 * side, a.z + a.nz * o0 * side];
      const pa1 = [a.x + a.nx * o1 * side, a.z + a.nz * o1 * side];
      const pb0 = [b.x + b.nx * o0 * side, b.z + b.nz * o0 * side];
      const pb1 = [b.x + b.nx * o1 * side, b.z + b.nz * o1 * side];
      const va = a.s / vScale;
      const vb = va + WORLD.sampleSpacing / vScale;
      v.push(pa0[0], a.y + lift, pa0[1], pa1[0], a.y + lift, pa1[1], pb0[0], b.y + lift, pb0[1], pb1[0], b.y + lift, pb1[1]);
      uv.push((o0 / uScale) * side, va, (o1 / uScale) * side, va, (o0 / uScale) * side, vb, (o1 / uScale) * side, vb);
      if (side > 0) idx.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
      else idx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
      n += 4;
    }
    if (o0 === 0) break; // a centre strip has only one side
  }
  return geo(v, uv, idx);
}

export function buildMountainRoadside(scene: THREE.Scene, world: WorldData, baked: Record<string, BakedSet>, paved: THREE.MeshStandardMaterial[]): THREE.MeshStandardMaterial {
  const hw = world.halfWidth;
  const edge = world.roadBand - 0.6;
  const F = world.field!;

  // ── Shoulder: worn grey asphalt with grit, out to the edge of the paving ──
  const shoulderMap = baked.concrete.map.clone();
  shoulderMap.wrapS = shoulderMap.wrapT = THREE.RepeatWrapping;
  shoulderMap.needsUpdate = true;
  const shoulderMat = new THREE.MeshStandardMaterial({ map: shoulderMap, normalMap: baked.asphalt.normal, normalScale: new THREE.Vector2(0.5, 0.5), color: 0x8a8580, roughness: 0.86, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  paved.push(shoulderMat);
  const shoulder = new THREE.Mesh(sideStrips(world, hw - 0.05, edge, 0, 7, 7), shoulderMat);
  shoulder.receiveShadow = true;
  shoulder.renderOrder = 2;
  shoulder.name = 'shoulder';
  scene.add(shoulder);

  // ── Lines: white edge lines, a dashed yellow centre line ──
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xe9e7df, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  paved.push(lineMat);
  const edgeLines = new THREE.Mesh(sideStrips(world, hw - 0.55, hw - 0.4, 0.004, 1, 1), lineMat);
  const centreMat = new THREE.MeshStandardMaterial({ color: 0xd9a52a, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  paved.push(centreMat);
  const centre = new THREE.Mesh(sideStrips(world, 0.08, 0.2, 0.004, 1, 1, 6), centreMat);
  for (const m of [edgeLines, centre]) {
    m.receiveShadow = true;
    m.renderOrder = 5;
    scene.add(m);
  }

  // ── Guard rails and rock faces ──
  const railV: number[] = [];
  const railUV: number[] = [];
  const railI: number[] = [];
  const rockV: number[] = [];
  const rockUV: number[] = [];
  const rockI: number[] = [];
  const posts: THREE.Matrix4[] = [];
  const reflectors: THREE.Matrix4[] = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const run of world.barrierRuns) {
    if (!run.kind) continue;
    const pts = run.pts;
    if (pts.length < 2) continue;
    // road height for each point (the run follows the road edge)
    const ys = pts.map((p) => {
      const hit = world.nearestTrack(p.x, p.z);
      return hit ? world.samples[hit.index].y : F.at(p.x, p.z);
    });
    let dist = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const tx = b.x - a.x;
      const tz = b.z - a.z;
      const l = Math.hypot(tx, tz) || 1;
      // the normal pointing away from the road
      const hit = world.nearestTrack(p.x, p.z);
      let nx = tz / l;
      let nz = -tx / l;
      if (hit) {
        const s = world.samples[hit.index];
        const sx = p.x - s.x;
        const sz = p.z - s.z;
        if (sx * nx + sz * nz < 0) {
          nx = -nx;
          nz = -nz;
        }
      }
      if (i > 0) dist += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      const y = ys[i];
      if (run.kind === 'rail') {
        // W-beam: a pressed steel band 0.32 m tall at 0.55–0.87 m, with a fold along the middle
        const f = 0.09;
        v3(railV, p.x, y + 0.55, p.z);
        v3(railV, p.x - nx * f, y + 0.71, p.z - nz * f);
        v3(railV, p.x, y + 0.87, p.z);
        railUV.push(dist / 4, 0, dist / 4, 0.5, dist / 4, 1);
        if (i < pts.length - 1) {
          const n0 = i * 3;
          railI.push(n0, n0 + 3, n0 + 1, n0 + 1, n0 + 3, n0 + 4, n0 + 1, n0 + 4, n0 + 2, n0 + 2, n0 + 4, n0 + 5);
        }
        // a post every 4 m (each run point), a reflector every 3rd post
        q.setFromAxisAngle(up, Math.atan2(nx, nz));
        m4.compose(new THREE.Vector3(p.x + nx * 0.16, F.at(p.x + nx * 0.2, p.z + nz * 0.2) - 0.4, p.z + nz * 0.16), q, new THREE.Vector3(1, Math.max(1, y + 0.9 - (F.at(p.x, p.z) - 0.4)), 1));
        posts.push(m4.clone());
        if (i % 3 === 0) {
          m4.compose(new THREE.Vector3(p.x - nx * 0.12, y + 0.95, p.z - nz * 0.12), q, new THREE.Vector3(1, 1, 1));
          reflectors.push(m4.clone());
        }
      } else {
        // a cut face: from the shoulder up to the land behind, rough and slightly overhanging at the foot
        // (5C: a cliff face runs further back to meet the mountain; the forest cuttings 14 m)
        const back = p.b ?? 14;
        const topY = Math.max(y + 3.2, F.at(p.x + nx * back, p.z + nz * back) + 0.4);
        const midY = y + 3.2 + (topY - y - 3.2) * 0.3;
        const r = Math.sin(dist * 0.37) * 0.35 + Math.sin(dist * 1.13) * 0.2;
        v3(rockV, p.x - nx * 0.1, y - 0.3, p.z - nz * 0.1);
        v3(rockV, p.x + nx * (0.6 + r), y + 1.6, p.z + nz * (0.6 + r));
        v3(rockV, p.x + nx * (2.2 + r * 0.5), midY, p.z + nz * (2.2 + r * 0.5));
        // (5C: a tall cliff stands near-vertical most of the way before it lays back)
        const high = y + (topY - y) * (back > 20 ? 0.78 : 0.5) + r * 1.5;
        v3(rockV, p.x + nx * (back > 20 ? 6 + r * 2 : 6), Math.max(midY, high), p.z + nz * (back > 20 ? 6 + r * 2 : 6));
        v3(rockV, p.x + nx * back, topY - 0.6, p.z + nz * back);
        rockUV.push(dist / 6, 0, dist / 6, 0.28, dist / 6, 0.6, dist / 6, (Math.max(midY, high) - y) / 6, dist / 6, 1.6 + (topY - y) / 8);
        if (i < pts.length - 1) {
          const n0 = i * 5;
          for (let k = 0; k < 4; k++) rockI.push(n0 + k, n0 + k + 1, n0 + k + 5, n0 + k + 1, n0 + k + 6, n0 + k + 5);
        }
      }
    }
    // each run is its own block of vertices: close it off for the next one
    if (run.kind === 'rail') {
      finishRun(railV, railUV, railI, 'rail');
    } else finishRun(rockV, rockUV, rockI, 'rock');
  }
  if (rails.v.length) {
    const g = geo(rails.v, rails.uv, rails.i);
    const mat = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 0.65, roughness: 0.38, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = 'guardrails';
    scene.add(mesh);
    const postGeo = new THREE.BoxGeometry(0.14, 1, 0.12);
    postGeo.translate(0, 0.5, 0);
    const pm = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x9a9ea3, metalness: 0.6, roughness: 0.5 }), posts.length);
    posts.forEach((m, i) => pm.setMatrixAt(i, m));
    pm.castShadow = true;
    pm.computeBoundingSphere();
    scene.add(pm);
    const refGeo = new THREE.BoxGeometry(0.08, 0.14, 0.03);
    const rm = new THREE.InstancedMesh(refGeo, new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: 0xff9a2a, emissiveIntensity: 0.6, roughness: 0.3 }), Math.max(1, reflectors.length));
    rm.count = reflectors.length;
    reflectors.forEach((m, i) => rm.setMatrixAt(i, m));
    rm.computeBoundingSphere();
    scene.add(rm);
  }
  if (rocks.v.length) {
    const g = geo(rocks.v, rocks.uv, rocks.i);
    const map = baked.rock.map.clone();
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.needsUpdate = true;
    const nm = baked.rock.normal.clone();
    nm.wrapS = nm.wrapT = THREE.RepeatWrapping;
    nm.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({ map, normalMap: nm, normalScale: new THREE.Vector2(1.4, 1.4), color: 0x9a968f, roughness: 0.92, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = 'rockfaces';
    scene.add(mesh);
  }
  rails.v = [];
  rocks.v = [];
  return shoulderMat;
}

// accumulated runs (each run is appended with its own vertex offset)
const rails = { v: [] as number[], uv: [] as number[], i: [] as number[] };
const rocks = { v: [] as number[], uv: [] as number[], i: [] as number[] };
function finishRun(v: number[], uv: number[], idx: number[], kind: 'rail' | 'rock'): void {
  const dst = kind === 'rail' ? rails : rocks;
  const base = dst.v.length / 3;
  dst.v.push(...v);
  dst.uv.push(...uv);
  for (const k of idx) dst.i.push(k + base);
  v.length = 0;
  uv.length = 0;
  idx.length = 0;
}
function v3(a: number[], x: number, y: number, z: number): void {
  a.push(x, y, z);
}

/** Far ranges round the valley: two ridgelines with snow on the peaks, fading into the haze. */
export function buildFarRanges(scene: THREE.Scene, world: WorldData, sunDir: THREE.Vector3, horizon: THREE.Color, ridges: THREE.MeshBasicMaterial[], from = 0): void {
  const r = rng(808);
  const cx = world.bounds.x;
  const cz = world.bounds.z;
  for (let layer = 0; layer < 2; layer++) {
    if (layer < from) {
      // keep the random sequence the same for the layers that are drawn
      for (let i = 0; i < 220 * 2; i++) r();
      continue;
    }
    const R = 3600 + layer * 1500;
    const K = 220;
    const heights: number[] = [];
    let h = 600;
    for (let i = 0; i < K; i++) {
      h += (r() - 0.5) * 260;
      h = Math.max(320, Math.min(1150 + layer * 450, h));
      heights.push(h + (i % 3 === 0 ? 140 * r() : 0));
    }
    const ROWS = 4;
    const v: number[] = [];
    const c: number[] = [];
    const idx: number[] = [];
    const rockC = layer === 0 ? new THREE.Color(0x3c4250) : new THREE.Color(0x6a7486);
    const snowC = new THREE.Color(0xe9eef6);
    for (let i = 0; i <= K; i++) {
      const a = (i / K) * Math.PI * 2;
      const top = (heights[i % K] + heights[(i + 1) % K]) / 2;
      const lit = Math.max(0, Math.cos(a) * sunDir.x + Math.sin(a) * sunDir.z);
      for (let k = 0; k <= ROWS; k++) {
        const t = k / ROWS;
        // a little wider at the foot: the range has a slope, not a wall
        const rr = R + (1 - t) * 420;
        const y = -60 + (top + 60) * Math.pow(t, 0.85);
        v.push(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr);
        const snow = Math.min(1, Math.max(0, (y - 520 - layer * 120) / 180));
        const col = rockC.clone().lerp(snowC, snow * 0.92).lerp(new THREE.Color(0xf2c9a0), lit * 0.25 * snow);
        const foot = horizon.clone().lerp(col, 0.35 + 0.65 * t);
        c.push(foot.r, foot.g, foot.b);
      }
      if (i < K)
        for (let k = 0; k < ROWS; k++) {
          const p = i * (ROWS + 1) + k;
          idx.push(p, p + 1, p + ROWS + 1, p + 1, p + ROWS + 2, p + ROWS + 1);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    g.setIndex(idx);
    const rm = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, side: THREE.DoubleSide });
    rm.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTW;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTW;').replace('#include <fog_fragment>', HILL_FOG);
    };
    rm.customProgramCacheKey = () => 'ridge-4c';
    ridges.push(rm);
    const mesh = new THREE.Mesh(g, rm);
    mesh.renderOrder = -1 - layer;
    mesh.name = 'far-range';
    scene.add(mesh);
  }
}
