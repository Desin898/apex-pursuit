// ─────────────────────────────────────────────────────────────────────────────
// Proving Grounds dressing (4D): everything around the circuit that makes it a place.
//   grandstands with a crowd that jumps up when cars pass · pit garages lit from inside ·
//   marshal posts · catch fences with banners · tyre walls · gravel traps · flags in the wind ·
//   floodlight towers · a car park · power lines over the hills · a town's lights at night ·
//   a highway with moving headlights · birds by day.
// Placement comes from WorldData (venues.ts); this file only draws and animates.
// Nearly everything is instanced or merged: about 30 draw calls for all of it, and the small
// moving things are drawn by the main camera only (not in reflections or mirrors).
// Every brand and team name is invented.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../../core/math';
import { mainOnly } from '../../core/layers';
import { WORLD } from '../../config';
import type { WorldData } from '../WorldData';
import type { BakedSet } from '../MaterialBaker';
import { terrainHeight, TERRAIN, HILL_FOG } from '../Terrain';
import { BANNERS, bannerAtlas, crowdAtlas, flagAtlas, garageAtlas, glowSprite, lampPanel, wireMesh } from './canvasArt';

export interface DressingContext {
  scene: THREE.Scene;
  world: WorldData;
  baked: Record<string, BakedSet>;
  /** emissive materials the time of day re-tunes */
  signs: THREE.MeshStandardMaterial[];
  windows: THREE.MeshStandardMaterial[];
  floods: THREE.MeshStandardMaterial[];
}

export interface CarDot {
  x: number;
  z: number;
  speed: number;
}

export interface Dressing {
  /** once per frame: crowd reactions, flags, birds, traffic; `night` 0..1, `rain` 0..1 */
  update(dt: number, time: number, cars: readonly CarDot[], night: number, rain: number): void;
  setQuality(q: 'low' | 'medium' | 'high' | 'ultra'): void;
}

type Quality = 'low' | 'medium' | 'high' | 'ultra';

// ── small geometry helpers ─────────────────────────────────────────────────────
function colorize(g: THREE.BufferGeometry, c: THREE.Color | number): THREE.BufferGeometry {
  const col = new THREE.Color(c);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = col.r;
    a[i * 3 + 1] = col.g;
    a[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, color?: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  return color === undefined ? g : colorize(g, color);
}

/** a thin square beam from a to b (for lattice towers) */
function beam(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 4, 1, true).toNonIndexed();
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  g.deleteAttribute('uv');
  return g;
}

/** texture coordinates from world position, so concrete tiles at `size` metres on every face */
function worldUV(g: THREE.BufferGeometry, size: number): void {
  g.computeVertexNormals();
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    const [u, v] = ay > ax && ay > az ? [p.getX(i), p.getZ(i)] : ax > az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)];
    uv[i * 2] = u / size;
    uv[i * 2 + 1] = v / size;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** place a local-frame geometry at (x, z) turned by yaw (local +z = facing) */
function place(g: THREE.BufferGeometry, x: number, z: number, yaw: number, y = 0): THREE.BufferGeometry {
  g.rotateY(yaw);
  g.translate(x, y, z);
  return g;
}

/** a generic road car (body tinted by instance colour; glass, tyres and lamps keep their own) */
export function genericCar(): THREE.BufferGeometry {
  const W = 0xffffff;
  const parts = [
    box(1.84, 0.62, 4.4, 0, 0.62, 0, W),
    box(1.7, 0.2, 4.2, 0, 0.36, 0, 0x202226),
    box(1.64, 0.6, 2.4, 0, 1.22, -0.25, 0x0d1116),
    box(1.5, 0.07, 2.0, 0, 1.55, -0.3, W),
    box(0.4, 0.13, 0.05, -0.62, 0.72, 2.2, 0xfff2d0),
    box(0.4, 0.13, 0.05, 0.62, 0.72, 2.2, 0xfff2d0),
    box(0.44, 0.13, 0.05, -0.6, 0.78, -2.2, 0xb0141a),
    box(0.44, 0.13, 0.05, 0.6, 0.78, -2.2, 0xb0141a),
  ];
  for (const [x, z] of [
    [-0.82, 1.38],
    [0.82, 1.38],
    [-0.82, -1.35],
    [0.82, -1.35],
  ]) {
    const wh = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10).toNonIndexed();
    wh.rotateZ(Math.PI / 2);
    wh.translate(x, 0.34, z);
    parts.push(colorize(wh, 0x111214));
  }
  for (const p of parts) p.deleteAttribute('uv');
  return mergeGeometries(parts)!;
}

const nearestOut = (world: WorldData, x: number, z: number): [number, number] => {
  const h = world.nearestTrack(x, z);
  if (!h) return [0, 1];
  const s = world.samples[h.index];
  const dx = x - s.x;
  const dz = z - s.z;
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
};

export function buildProvingGroundsDressing(ctx: DressingContext): Dressing {
  const { scene, world, baked } = ctx;
  const S = world.samples;
  const N = S.length;
  const uTime = { value: 0 };
  const uWind = { value: 0.5 };
  const updaters: ((dt: number, time: number, cars: readonly CarDot[], night: number, rain: number) => void)[] = [];
  const qualityHooks: ((q: Quality) => void)[] = [];

  const concrete = new THREE.MeshStandardMaterial({ map: baked.concrete.map, normalMap: baked.concrete.normal, roughness: 0.85 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3e45, metalness: 0.75, roughness: 0.45 });
  const painted = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 });
  const bannerTex = bannerAtlas();
  const banners = new THREE.MeshStandardMaterial({ map: bannerTex, emissiveMap: bannerTex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.6 });
  ctx.signs.push(banners);
  const bannerGeos: THREE.BufferGeometry[] = [];
  /** a banner quad from a to b (ground points), between heights y0..y1, facing direction n */
  const banner = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number, row: number, uMax = 0.55) => {
    const g = new THREE.BufferGeometry();
    const v0 = 1 - (row + 1) / BANNERS.length + 0.002;
    const v1 = 1 - row / BANNERS.length - 0.002;
    g.setAttribute('position', new THREE.Float32BufferAttribute([ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, v0, uMax, v0, uMax, v1, 0, v0, uMax, v1, 0, v1], 2));
    g.computeVertexNormals();
    bannerGeos.push(g);
  };

  // ── Grandstands ──────────────────────────────────────────────────────────────
  {
    const steps: THREE.BufferGeometry[] = [];
    const seats: THREE.BufferGeometry[] = [];
    const roofs: THREE.BufferGeometry[] = [];
    const strips: THREE.BufferGeometry[] = [];
    const seatCols = [0x1f5fbf, 0xc22a2a, 0x1a8f9a];
    const crowdTex = crowdAtlas();
    crowdTex.generateMipmaps = true;
    const person = new THREE.PlaneGeometry(0.62, 1.08);
    person.translate(0, 0.54, 0);
    const cr = rng(808);
    world.stands.forEach((st, k) => {
      const { w, d, rows, yaw } = st;
      const local: THREE.BufferGeometry[] = [];
      const lseat: THREE.BufferGeometry[] = [];
      const lroof: THREE.BufferGeometry[] = [];
      const front = d / 2;
      for (let r = 0; r < rows; r++) {
        const top = 0.6 + (r + 1) * 0.8;
        const zc = front - 1 - (r + 0.5) * 1.4;
        local.push(box(w, top, 1.4, 0, top / 2, zc));
        const sc = seatCols[k % seatCols.length];
        lseat.push(box(w - 0.6, 0.42, 0.5, 0, top + 0.21, zc - 0.3, r % 4 === 3 ? 0xd8dde2 : sc));
      }
      const backH = 0.6 + rows * 0.8 + 5.2;
      local.push(box(w, 0.9, 1, 0, 0.45, front - 0.5)); // front wall
      local.push(box(w + 0.6, backH, 0.5, 0, backH / 2, -front + 0.25)); // back wall
      // end walls follow the stepped seating, rising to the back wall
      for (const e of [-w / 2, w / 2]) {
        for (let r = 0; r < rows; r++) {
          const top = 0.6 + (r + 1) * 0.8 + 1.1;
          local.push(box(0.5, top, 1.4, e, top / 2, front - 1 - (r + 0.5) * 1.4));
        }
        local.push(box(0.5, backH, 1.2, e, backH / 2, -front + 0.6));
      }
      // roof on columns at the back, cantilevered over the seats
      lroof.push(box(w + 3, 0.35, d + 3, 0, backH + 0.2, 1.2));
      for (let x = -w / 2; x <= w / 2 + 0.01; x += w / Math.max(3, Math.round(w / 20))) lroof.push(box(0.5, 1.2, 0.5, x, backH - 0.4, -front + 0.6));
      for (const g of local) steps.push(place(g, st.x, st.z, yaw));
      for (const g of lseat) seats.push(place(g, st.x, st.z, yaw));
      for (const g of lroof) roofs.push(place(g, st.x, st.z, yaw));
      // a strip of lights under the front edge of the roof (they light the crowd at night)
      strips.push(place(box(w, 0.12, 0.35, 0, backH - 0.05, d / 2 + 2.4), st.x, st.z, yaw));
      // banners along the front wall
      const cs = Math.cos(yaw);
      const sn = Math.sin(yaw);
      const W = (lx: number, lz: number): [number, number] => [st.x + lx * cs + lz * sn, st.z - lx * sn + lz * cs];
      for (let x = -w / 2 + 1; x + 9 <= w / 2; x += 10) {
        const [ax, az] = W(x + 9, front + 0.02);
        const [bx, bz] = W(x, front + 0.02);
        banner(ax, az, bx, bz, 0.08, 0.86, (k * 3 + Math.round(x / 10) + 8) & 7);
      }

      // the crowd: masks in the texture become shirts, skin and hair in the shader
      const spots: [number, number, number][] = [];
      for (let r = 0; r < rows; r++) {
        const top = 0.6 + (r + 1) * 0.8;
        const zc = front - 1 - (r + 0.5) * 1.4 - 0.05;
        for (let x = -w / 2 + 0.8; x <= w / 2 - 0.8; x += 0.72) if (cr() < 0.78) spots.push([x + (cr() - 0.5) * 0.2, top + 0.05, zc]);
      }
      const uExcite = { value: 0.1 };
      const mat = new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 0.9, side: THREE.DoubleSide });
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = uTime;
        sh.uniforms.uExcite = uExcite;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec3 aVar;\nvarying vec3 vVar;\nuniform float uTime;\nuniform float uExcite;')
          .replace(
            '#include <uv_vertex>',
            `#include <uv_vertex>
            vec3 ipC = instanceMatrix[3].xyz;
            float phC = fract(sin(dot(ipC.xz, vec2(12.9898, 78.233))) * 43758.5453);
            float exC = uExcite * aVar.z;
            float frameC = exC > 0.3 ? (phC > 0.45 ? 3.0 : 2.0) : aVar.x;
            vMapUv = vec2((uv.x + frameC) * 0.25, uv.y);
            vVar = aVar;`,
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            transformed.y += max(0.0, sin(uTime * (7.0 + phC * 5.0) + phC * 40.0)) * 0.24 * exC + step(0.55, phC) * step(0.3, exC) * 0.22;`,
          );
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vVar;')
          .replace(
            '#include <map_fragment>',
            `vec4 tt = texture2D(map, vMapUv);
            if (tt.r + tt.g + tt.b < 0.5) discard;
            vec3 skin = mix(vec3(0.92, 0.72, 0.58), vec3(0.32, 0.2, 0.13), vVar.y);
            vec3 hair = mix(vec3(0.04, 0.035, 0.03), vec3(0.42, 0.3, 0.16), step(0.82, fract(vVar.y * 7.3)));
            #ifdef USE_COLOR
              vec3 shirt = vColor; // the instance colour (three.js passes it as the vertex colour)
            #else
              vec3 shirt = vec3(0.6);
            #endif
            diffuseColor.rgb = (tt.r * shirt + tt.g * skin + tt.b * hair) / max(0.001, tt.r + tt.g + tt.b);`,
          )
          .replace('#include <color_fragment>', '');
      };
      mat.customProgramCacheKey = () => `crowd-4d-${k}`; // one program per stand: each has its own cheer
      const geo = person.clone();
      const aVar = new Float32Array(spots.length * 3);
      geo.setAttribute('aVar', new THREE.InstancedBufferAttribute(aVar, 3));
      const crowd = new THREE.InstancedMesh(geo, mat, spots.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
      const v = new THREE.Vector3();
      const sc = new THREE.Vector3();
      const c = new THREE.Color();
      const shirts = [0xffffff, 0x1a1a1a, 0xc22a2a, 0x1f5fbf, 0xf2bf10, 0x4fd1d9, 0x2f7d32, 0x8a5cc2, 0xff7a1a, 0x9aa3ad];
      spots.forEach(([lx, ly, lz], i) => {
        const [wx, wz] = W(lx, lz);
        const s = 0.9 + cr() * 0.22;
        m.compose(v.set(wx, ly, wz), q, sc.set(s, s, s));
        crowd.setMatrixAt(i, m);
        // a stand's own colours dominate (home fans), the rest mixed
        crowd.setColorAt(i, c.set(cr() < 0.35 ? seatCols[k % seatCols.length] : shirts[Math.floor(cr() * shirts.length)]).multiplyScalar(0.75 + cr() * 0.3));
        aVar[i * 3] = cr() < 0.7 ? 0 : 1; // sitting / leaning
        aVar[i * 3 + 1] = cr();
        aVar[i * 3 + 2] = 0.4 + cr() * 0.6; // how excitable
      });
      crowd.frustumCulled = true;
      crowd.computeBoundingSphere();
      crowd.name = 'crowd';
      mainOnly(crowd);
      scene.add(crowd);
      const all = spots.length;
      qualityHooks.push((q) => (crowd.count = Math.floor(all * (q === 'low' ? 0.4 : q === 'medium' ? 0.75 : 1))));
      // cheer when a car is close to the front of the stand
      const [fx, fz] = W(0, front + 18);
      updaters.push((dt, _t, cars) => {
        let target = 0.08;
        for (const car of cars) {
          const dd = Math.hypot(car.x - fx, car.z - fz);
          if (dd < w * 0.6 + 30 && car.speed > 8) target = Math.max(target, 1 - dd / (w * 0.6 + 30) + 0.35);
        }
        uExcite.value += (Math.min(1, target) - uExcite.value) * Math.min(1, dt * (target > uExcite.value ? 4 : 0.8));
      });
    });
    const mk = (geos: THREE.BufferGeometry[], mat: THREE.Material, name: string, shadow: boolean) => {
      if (!geos.length) return;
      for (const g of geos) {
        if (!g.getAttribute('color')) colorize(g, 0xffffff);
        if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
      }
      const merged = mergeGeometries(geos)!;
      if (name === 'stands') worldUV(merged, 4);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.name = name;
      scene.add(mesh);
    };
    mk(steps, concrete, 'stands', true);
    mk(seats, painted, 'seats', false);
    mk(roofs, metal, 'stand-roofs', true);
    if (strips.length) {
      const sm = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff2d8, emissiveIntensity: 3.2 });
      ctx.floods.push(sm);
      for (const g of strips) g.deleteAttribute('uv');
      const mesh = new THREE.Mesh(mergeGeometries(strips)!, sm);
      mesh.name = 'stand-lights';
      scene.add(mesh);
    }
  }

  // ── Pit garages lit from inside ─────────────────────────────────────────────
  {
    const pit = world.buildings.find((b) => b.kind === 'pit');
    if (pit) {
      const at = garageAtlas();
      const mat = new THREE.MeshStandardMaterial({ map: at, emissiveMap: at, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.8 });
      ctx.windows.push(mat);
      const geos: THREE.BufferGeometry[] = [];
      const bays = Math.floor(pit.w / 19);
      const frontZ = pit.d / 2 + 0.03; // local front face (towards the track)
      for (let k = 0; k < bays; k++) {
        const x = -pit.w / 2 + (k + 0.5) * (pit.w / bays);
        const g = new THREE.PlaneGeometry(13, 6.2);
        const uv = g.getAttribute('uv') as THREE.BufferAttribute;
        const row = k % 6;
        for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (row + 1 - uv.getY(i)) / 6);
        g.translate(x, 3.1, frontZ);
        geos.push(place(g, pit.x, pit.z, pit.yaw));
      }
      const mesh = new THREE.Mesh(mergeGeometries(geos)!, mat);
      mesh.name = 'garages';
      scene.add(mesh);
      // a door header strip above the bays
      const hdr = new THREE.Mesh(place(new THREE.BoxGeometry(pit.w, 1, 1.2).translate(0, 6.7, pit.d / 2 + 0.5), pit.x, pit.z, pit.yaw), metal);
      hdr.castShadow = true;
      scene.add(hdr);
    }
  }

  // ── Marshal posts ───────────────────────────────────────────────────────────
  if (world.marshals.length) {
    const parts = [
      box(2.6, 2.3, 2.4, 0, 1.15, 0, 0xf1f2f4),
      box(2.62, 0.35, 2.42, 0, 1.75, 0, 0xff6a13),
      box(2.0, 0.6, 0.05, 0, 1.45, 1.22, 0x10161c),
      box(3.0, 0.18, 2.9, 0, 2.39, 0.15, 0x3a3e45),
    ];
    for (const p of parts) p.deleteAttribute('uv');
    const im = new THREE.InstancedMesh(mergeGeometries(parts)!, painted, world.marshals.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    world.marshals.forEach((h, i) => {
      m.compose(new THREE.Vector3(h.x, 0, h.z), q.setFromEuler(new THREE.Euler(0, h.yaw, 0)), new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(i, m);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    im.name = 'marshals';
    scene.add(im);
  }

  // ── Catch fences (with banners) behind the barriers ────────────────────────
  {
    const tex = wireMesh();
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 });
    const pos: number[] = [];
    const uv: number[] = [];
    const posts: [number, number, number][] = [];
    let bannerK = 0;
    world.barrierRuns.forEach((run, ri) => {
      const pitWall = ri === world.barrierRuns.length - 1 && run.pts.length > 30 && Math.abs(run.pts[0].z - run.pts[run.pts.length - 1].z) < 1;
      const H = pitWall ? 3.2 : 4.2;
      let u = 0;
      const pts = run.pts.map((p) => {
        const [ox, oz] = nearestOut(world, p.x, p.z);
        return { x: p.x + ox * 0.75, z: p.z + oz * 0.75, ox, oz };
      });
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const u1 = u + len / 2;
        pos.push(a.x, 0.95, a.z, b.x, 0.95, b.z, b.x, H, b.z, a.x, 0.95, a.z, b.x, H, b.z, a.x, H, a.z);
        const vy = (H - 0.95) / 2;
        uv.push(u, 0, u1, 0, u1, vy, u, 0, u1, vy, u, vy);
        u = u1;
        if (i % 2 === 0) posts.push([a.x, a.z, H]);
        // a banner every so often, on the track side of the fence
        if (i % 6 === 1 && i + 2 < pts.length) {
          const c = pts[i + 2];
          banner(a.x - a.ox * 0.06, a.z - a.oz * 0.06, c.x - c.ox * 0.06, c.z - c.oz * 0.06, 1.05, 2.0, bannerK++ % BANNERS.length);
        }
      }
      posts.push([pts[pts.length - 1].x, pts[pts.length - 1].z, H]);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const fence = new THREE.Mesh(g, mat);
    fence.name = 'catch-fences';
    mainOnly(fence);
    scene.add(fence);
    const pg = new THREE.BoxGeometry(0.12, 1, 0.12);
    pg.translate(0, 0.5, 0);
    const pim = new THREE.InstancedMesh(pg, metal, posts.length);
    const m = new THREE.Matrix4();
    posts.forEach(([x, z, h], i) => pim.setMatrixAt(i, m.makeScale(1, h, 1).setPosition(x, 0, z)));
    pim.name = 'fence-posts';
    mainOnly(pim);
    scene.add(pim);
  }

  // ── Tyre walls ──────────────────────────────────────────────────────────────
  if (world.tyreWalls.length) {
    const spots: [number, number, number, number][] = [];
    for (const t of world.tyreWalls) {
      const [ox, oz] = nearestOut(world, t.x, t.z);
      const tx = Math.sin(t.yaw);
      const tz = Math.cos(t.yaw);
      const n = Math.floor(t.len / 0.64);
      for (let k = 0; k < n; k++)
        for (let j = 0; j < 2; j++)
          for (let l = 0; l < 3; l++) {
            const along = (k - n / 2) * 0.64 + (l % 2) * 0.16;
            spots.push([t.x + tx * along + ox * j * 0.62, 0.13 + l * 0.25, t.z + tz * along + oz * j * 0.62, l === 2 && k % 3 === 0 ? 1 : 0]);
          }
    }
    const tg = new THREE.CylinderGeometry(0.31, 0.31, 0.24, 12);
    const tm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const im = new THREE.InstancedMesh(tg, tm, spots.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    spots.forEach(([x, y, z, painted], i) => {
      im.setMatrixAt(i, m.makeTranslation(x, y, z));
      im.setColorAt(i, c.set(painted ? (i % 2 ? 0xe9e9e9 : 0xc22a2a) : 0x121314));
    });
    im.receiveShadow = true;
    im.name = 'tyre-walls';
    mainOnly(im);
    scene.add(im);
  }

  // ── Gravel traps ────────────────────────────────────────────────────────────
  if (world.gravel.length) {
    const pos: number[] = [];
    const uv: number[] = [];
    for (const gr of world.gravel) {
      let dist = 0;
      for (let i = 0; i < gr.pts.length - 1; i++) {
        const a = gr.pts[i];
        const b = gr.pts[i + 1];
        const pa = gr.pts[Math.max(0, i - 1)];
        const pb = gr.pts[Math.min(gr.pts.length - 1, i + 2)];
        const n = (p: { x: number; z: number }, q: { x: number; z: number }) => {
          const tx = q.x - p.x;
          const tz = q.z - p.z;
          const l = Math.hypot(tx, tz) || 1;
          return [tz / l, -tx / l]; // same convention as TrackSample nx, nz
        };
        const [nax, naz] = n(i > 0 ? pa : a, b);
        const [nbx, nbz] = n(a, i + 2 < gr.pts.length ? pb : b);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const s = gr.side;
        const P = (p: { x: number; z: number }, nx: number, nz: number, off: number) => [p.x + nx * off * s, 0.025, p.z + nz * off * s];
        const a0 = P(a, nax, naz, gr.inner);
        const a1 = P(a, nax, naz, gr.outer);
        const b0 = P(b, nbx, nbz, gr.inner);
        const b1 = P(b, nbx, nbz, gr.outer);
        pos.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
        const u0 = dist / 6;
        const u1 = (dist + len) / 6;
        const w = (gr.outer - gr.inner) / 6;
        uv.push(u0, 0, u1, 0, u1, w, u0, 0, u1, w, u0, w);
        dist += len;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    // keep the normals up whichever way the triangles wound
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    const mat = new THREE.MeshStandardMaterial({ map: baked.gravel.map, normalMap: baked.gravel.normal, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.name = 'gravel';
    scene.add(mesh);
  }

  // ── Flags in the wind ───────────────────────────────────────────────────────
  {
    const list = world.flags.map((f) => ({ ...f, w: f.kind === 0 ? 2.2 : 1.8, hh: f.kind === 0 ? 1.4 : 1.1 }));
    for (const h of world.marshals) {
      const cs = Math.cos(h.yaw);
      const sn = Math.sin(h.yaw);
      list.push({ x: h.x + 1.5 * cs + 1.4 * sn, z: h.z - 1.5 * sn + 1.4 * cs, h: 4.6, kind: 4, yaw: 0, w: 1.0, hh: 0.65 });
    }
    const windYaw = 0.65; // the wind blows the same way everywhere
    const cloth = new THREE.PlaneGeometry(1, 1, 12, 4);
    cloth.translate(0.5, -0.5, 0);
    const aFrame = new Float32Array(list.length);
    cloth.setAttribute('aFrame', new THREE.InstancedBufferAttribute(aFrame, 1));
    const tex = flagAtlas();
    const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.uniforms.uWind = uWind;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aFrame;\nuniform float uTime;\nuniform float uWind;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vec2((uv.x + aFrame) / 5.0, uv.y);')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            float x01 = position.x;
            vec3 ipF = instanceMatrix[3].xyz;
            float ph = ipF.x * 0.13 + ipF.z * 0.07;
            float sp = 5.0 + uWind * 4.0;
            transformed.z += sin(x01 * 7.0 - uTime * sp + ph) * (0.05 + 0.1 * uWind) * x01;
            transformed.y += sin(x01 * 5.0 - uTime * sp * 0.7 + ph) * 0.025 - (1.0 - uWind) * 0.35 * x01 * x01;
          }`,
        );
    };
    mat.customProgramCacheKey = () => 'flags-4d';
    const im = new THREE.InstancedMesh(cloth, mat, list.length);
    const pg = new THREE.CylinderGeometry(0.05, 0.07, 1, 6);
    pg.translate(0, 0.5, 0);
    const poles = new THREE.InstancedMesh(pg, metal, list.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, windYaw - Math.PI / 2, 0));
    list.forEach((f, i) => {
      m.compose(new THREE.Vector3(f.x, f.h - 0.15, f.z), q, new THREE.Vector3(f.w, f.hh, 1));
      im.setMatrixAt(i, m);
      aFrame[i] = f.kind;
      poles.setMatrixAt(i, new THREE.Matrix4().makeScale(1, f.h, 1).setPosition(f.x, 0, f.z));
    });
    im.name = 'flags';
    mainOnly(im);
    poles.name = 'flag-poles';
    scene.add(im, poles);
  }

  // ── Pit-wall banners ────────────────────────────────────────────────────────
  {
    const pw = world.barrierRuns[world.barrierRuns.length - 1];
    if (pw && pw.pts.length > 30) {
      const z = pw.pts[0].z + 0.38;
      for (let x = pw.pts[0].x + 4; x + 9 < pw.pts[pw.pts.length - 1].x; x += 12) banner(x, z, x + 9, z, 0.12, 0.92, Math.floor(x / 12) & 7);
    }
  }

  // ── Floodlight towers ───────────────────────────────────────────────────────
  if (world.floodlights.length) {
    const L = world.floodlights;
    const mastG = new THREE.CylinderGeometry(0.35, 0.75, 1, 6);
    mastG.translate(0, 0.5, 0);
    const masts = new THREE.InstancedMesh(mastG, metal, L.length);
    const headG = new THREE.BoxGeometry(7.2, 3.6, 0.6);
    const heads = new THREE.InstancedMesh(headG, metal, L.length);
    const lp = lampPanel();
    const lampMat = new THREE.MeshStandardMaterial({ map: lp, emissiveMap: lp, emissive: 0xffffff, emissiveIntensity: 3.2, roughness: 0.4 });
    ctx.floods.push(lampMat);
    const panelG = new THREE.PlaneGeometry(6.8, 3.2);
    panelG.translate(0, 0, 0.31);
    const panels = new THREE.InstancedMesh(panelG, lampMat, L.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    L.forEach((f, i) => {
      masts.setMatrixAt(i, m.makeScale(1, f.h, 1).setPosition(f.x, 0, f.z));
      q.setFromEuler(new THREE.Euler(0.42, f.yaw, 0, 'YXZ'));
      m.compose(new THREE.Vector3(f.x, f.h + 1.6, f.z), q, new THREE.Vector3(1, 1, 1));
      heads.setMatrixAt(i, m);
      panels.setMatrixAt(i, m);
    });
    masts.castShadow = heads.castShadow = true;
    masts.name = 'floodlight-masts';
    scene.add(masts, heads, panels);
  }

  // ── Car park ────────────────────────────────────────────────────────────────
  if (world.parked.length) {
    const carG = genericCar();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.45 });
    const im = new THREE.InstancedMesh(carG, mat, world.parked.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    const pr = rng(77);
    const paints = [0xe9ebee, 0x16171a, 0x9ca2a8, 0x5a6068, 0x1b2e4a, 0x8c1218, 0x2c4a2e, 0xc9b38a, 0x3a5c8c];
    const kinds = [new THREE.Vector3(1, 1, 1), new THREE.Vector3(1.06, 1.2, 1.04), new THREE.Vector3(0.9, 0.96, 0.88)];
    world.parked.forEach((p, i) => {
      m.compose(new THREE.Vector3(p.x, 0, p.z), q.setFromEuler(new THREE.Euler(0, p.yaw, 0)), kinds[p.kind % 3]);
      im.setMatrixAt(i, m);
      im.setColorAt(i, c.set(paints[Math.floor(pr() * paints.length)]));
    });
    im.receiveShadow = true;
    im.name = 'parked-cars';
    mainOnly(im);
    scene.add(im);
    // bay lines
    const park = world.aprons[world.aprons.length - 1];
    const lines: THREE.BufferGeometry[] = [];
    for (const rowZ of [-345, -387]) for (let x = park.x0 + 4.3; x <= park.x1 - 4; x += 3.4) lines.push(box(0.12, 0.02, 5.2, x, 0.02, rowZ));
    for (const g of lines) g.deleteAttribute('uv');
    const lm = new THREE.Mesh(mergeGeometries(lines)!, new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.8 }));
    lm.name = 'bay-lines';
    mainOnly(lm);
    scene.add(lm);
  }

  // ── Power lines over the hills (behind the pits) ────────────────────────────
  {
    const C = { x: WORLD.boundsCenterX, z: WORLD.boundsCenterZ };
    const R = 1500;
    const a0 = (-148 * Math.PI) / 180;
    const a1 = (-32 * Math.PI) / 180;
    const P0 = { x: C.x + Math.cos(a0) * R, z: C.z + Math.sin(a0) * R };
    const P1 = { x: C.x + Math.cos(a1) * R, z: C.z + Math.sin(a1) * R };
    const len = Math.hypot(P1.x - P0.x, P1.z - P0.z);
    const n = Math.round(len / 160);
    const dirx = (P1.x - P0.x) / len;
    const dirz = (P1.z - P0.z) / len;
    const yaw = Math.atan2(dirx, dirz);
    // lattice pylon
    const parts: THREE.BufferGeometry[] = [];
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const leg = (y: number) => 4 - (y / 36) * 3; // half-width of the lattice at height y
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(beam(V(sx * 4, 0, sz * 4), V(sx * 1, 36, sz * 1), 0.18));
    for (const y of [8, 16, 24, 30]) {
      const h = leg(y);
      for (const [ax, az, bx, bz] of [
        [-h, -h, h, -h],
        [h, -h, h, h],
        [h, h, -h, h],
        [-h, h, -h, -h],
      ])
        parts.push(beam(V(ax, y, az), V(bx, y, bz), 0.1));
    }
    for (const [y0, y1] of [
      [0, 8],
      [8, 16],
      [16, 24],
      [24, 30],
    ]) {
      const h0 = leg(y0);
      const h1 = leg(y1);
      for (const s of [-1, 1]) {
        parts.push(beam(V(-h0, y0, s * h0), V(h1, y1, s * h1), 0.07));
        parts.push(beam(V(s * h0, y0, -h0), V(s * h1, y1, h1), 0.07));
      }
    }
    parts.push(beam(V(-8.5, 28, 0), V(8.5, 28, 0), 0.22), beam(V(-6.5, 34, 0), V(6.5, 34, 0), 0.2), beam(V(0, 36, 0), V(0, 40, 0), 0.12));
    parts.push(beam(V(-8.5, 28, 0), V(-1.3, 32, 0), 0.08), beam(V(8.5, 28, 0), V(1.3, 32, 0), 0.08));
    const pylonG = mergeGeometries(parts)!;
    const im = new THREE.InstancedMesh(pylonG, new THREE.MeshStandardMaterial({ color: 0x6b7077, metalness: 0.6, roughness: 0.5 }), n + 1);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    const tops: THREE.Vector3[][] = [];
    const attach = [V(-8.3, 27.6, 0), V(8.3, 27.6, 0), V(-6.3, 33.6, 0), V(6.3, 33.6, 0), V(0, 40, 0)];
    for (let i = 0; i <= n; i++) {
      const x = P0.x + dirx * (len * i) / n;
      const z = P0.z + dirz * (len * i) / n;
      const y = terrainHeight(x, z) - 0.5;
      m.compose(V(x, y, z), q, V(1, 1, 1));
      im.setMatrixAt(i, m);
      tops.push(attach.map((a) => a.clone().applyQuaternion(q).add(V(x, y, z))));
    }
    im.name = 'pylons';
    scene.add(im);
    const wp: number[] = [];
    for (let i = 0; i < n; i++)
      for (let k = 0; k < attach.length; k++) {
        const A = tops[i][k];
        const B = tops[i + 1][k];
        const segs = 14;
        for (let s = 0; s < segs; s++) {
          const t0 = s / segs;
          const t1 = (s + 1) / segs;
          const sag = (t: number) => 7 * 4 * t * (1 - t);
          wp.push(A.x + (B.x - A.x) * t0, A.y + (B.y - A.y) * t0 - sag(t0), A.z + (B.z - A.z) * t0);
          wp.push(A.x + (B.x - A.x) * t1, A.y + (B.y - A.y) * t1 - sag(t1), A.z + (B.z - A.z) * t1);
        }
      }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    const wires = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x2b2f34 }));
    wires.name = 'power-lines';
    mainOnly(wires);
    scene.add(wires);
  }

  // ── A town in the lowest valley: its lights at night ────────────────────────
  // and ── a highway on the hills with moving traffic ──
  {
    const C = { x: WORLD.boundsCenterX, z: WORLD.boundsCenterZ };
    // the valley: the direction where the hills stay lowest
    let bestA = 0;
    let bestH = Infinity;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 45) {
      if (Math.sin(a) < -0.5) continue; // not behind the pits, where the power line runs
      let h = 0;
      for (const r of [1300, 1700, 2100, 2500]) h += terrainHeight(C.x + Math.cos(a) * r, C.z + Math.sin(a) * r);
      if (h < bestH) {
        bestH = h;
        bestA = a;
      }
    }
    const tr = rng(4242);
    const pos: number[] = [];
    const col: number[] = [];
    const warm = [
      [1, 0.82, 0.56],
      [1, 0.9, 0.75],
      [0.92, 0.95, 1],
      [1, 0.62, 0.28],
    ];
    let blocks = 0;
    while (pos.length / 3 < 3200 && blocks++ < 900) {
      const a = bestA + (tr() + tr() + tr() - 1.5) * 0.16;
      const r = 1800 + Math.pow(tr(), 0.7) * 1000;
      const bx = C.x + Math.cos(a) * r;
      const bz = C.z + Math.sin(a) * r;
      const by = Math.max(0, terrainHeight(bx, bz));
      const floors = 1 + Math.floor(Math.pow(tr(), 3) * 14);
      const wide = 1 + Math.floor(tr() * 4);
      const cc = warm[Math.floor(tr() * warm.length)];
      for (let f = 0; f < floors; f++)
        for (let w = 0; w < wide; w++) {
          if (tr() < 0.35) continue;
          pos.push(bx + Math.cos(a + Math.PI / 2) * w * 3, by + 3 + f * 3.2, bz + Math.sin(a + Math.PI / 2) * w * 3);
          const k = 0.7 + tr() * 0.3;
          col.push(cc[0] * k, cc[1] * k, cc[2] * k);
        }
      if (floors > 10) {
        pos.push(bx, by + 4 + floors * 3.2, bz);
        col.push(1, 0.1, 0.05); // aviation light
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const lm = new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    const town = new THREE.Points(g, lm);
    town.name = 'town-lights';
    town.frustumCulled = false;
    mainOnly(town);
    scene.add(town);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1900, 520), new THREE.MeshBasicMaterial({ map: glowSprite(), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    glow.position.set(C.x + Math.cos(bestA) * 2400, 120, C.z + Math.sin(bestA) * 2400);
    glow.lookAt(C.x, 120, C.z);
    glow.name = 'town-glow';
    mainOnly(glow);
    scene.add(glow);
    let townCount = pos.length / 3;
    qualityHooks.push((q) => g.setDrawRange(0, Math.floor(townCount * (q === 'low' ? 0.4 : q === 'medium' ? 0.7 : 1))));
    updaters.push((_dt, _t, _c, night) => {
      town.visible = night > 0.05;
      lm.opacity = Math.min(1, night * 1.1);
      glow.visible = night > 0.05;
      (glow.material as THREE.MeshBasicMaterial).opacity = night * 0.45;
    });
    void townCount;
    townCount = pos.length / 3;

    // highway: an arc on the foothills on the other side, rising with the land
    const hA = bestA + Math.PI * 0.72;
    const HR = 1060;
    const path: THREE.Vector3[] = [];
    for (let a = hA - 0.55; a <= hA + 0.55; a += 8 / HR) {
      const x = C.x + Math.cos(a) * HR;
      const z = C.z + Math.sin(a) * HR;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      let y = terrainHeight(x, z);
      for (const o of [-10, -5, 5, 10]) y = Math.max(y, terrainHeight(x + nx * o, z + nz * o));
      path.push(new THREE.Vector3(x, y + 0.5, z));
    }
    // smooth the profile like a real road (it cuts and fills), never below the ground
    for (let pass = 0; pass < 3; pass++) {
      const ys = path.map((p) => p.y);
      for (let i = 0; i < path.length; i++) {
        let s = 0;
        let c = 0;
        for (let k = -8; k <= 8; k++) {
          const j = Math.max(0, Math.min(path.length - 1, i + k));
          s += ys[j];
          c++;
        }
        path[i].y = Math.max(s / c, terrainHeight(path[i].x, path[i].z) + 0.4);
      }
    }
    const HW = 9;
    const rp: number[] = [];
    const ru: number[] = [];
    const idx: number[] = [];
    let dist = 0;
    const tang: THREE.Vector3[] = [];
    path.forEach((p, i) => {
      const a = path[Math.max(0, i - 1)];
      const b = path[Math.min(path.length - 1, i + 1)];
      const t = b.clone().sub(a).setY(0).normalize();
      tang.push(t);
      const nx = t.z;
      const nz = -t.x;
      if (i > 0) dist += p.distanceTo(path[i - 1]);
      rp.push(p.x + nx * HW, p.y, p.z + nz * HW, p.x - nx * HW, p.y, p.z - nz * HW);
      ru.push(0, dist / 14, 1, dist / 14);
      if (i > 0) {
        const k = i * 2;
        idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
      }
    });
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2));
    rg.setIndex(idx);
    rg.computeVertexNormals();
    const roadMat = new THREE.MeshStandardMaterial({ map: baked.asphalt.map, roughness: 0.75, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    roadMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTW;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTW;').replace('#include <fog_fragment>', HILL_FOG);
    };
    roadMat.customProgramCacheKey = () => 'highway-4d';
    const road = new THREE.Mesh(rg, roadMat);
    road.name = 'highway';
    road.receiveShadow = false;
    scene.add(road);
    // traffic: both directions, on the right-hand lanes
    const total = dist;
    const cum: number[] = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + path[i].distanceTo(path[i - 1]));
    const at = (s: number, out: THREE.Vector3): number => {
      let lo = 0;
      let hi = cum.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= s) lo = mid;
        else hi = mid;
      }
      const f = (s - cum[lo]) / Math.max(0.001, cum[hi] - cum[lo]);
      out.copy(path[lo]).lerp(path[hi], f);
      return lo;
    };
    const CARS = 56;
    const traffic = Array.from({ length: CARS }, (_, i) => ({ s: tr() * total, v: 24 + tr() * 10, dir: i % 2 ? 1 : -1, lane: i % 4 < 2 ? 2.6 : 6.2 }));
    const carMesh = new THREE.InstancedMesh(genericCar(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.4 }), CARS);
    const cc = new THREE.Color();
    const paints = [0xe9ebee, 0x16171a, 0x9ca2a8, 0x1b2e4a, 0x8c1218, 0x5a6068];
    traffic.forEach((_, i) => carMesh.setColorAt(i, cc.set(paints[i % paints.length])));
    carMesh.frustumCulled = false;
    carMesh.name = 'highway-traffic';
    mainOnly(carMesh);
    const lp = new Float32Array(CARS * 4 * 3);
    const lc = new Float32Array(CARS * 4 * 3);
    for (let i = 0; i < CARS; i++)
      for (let k = 0; k < 4; k++) {
        const head = k < 2;
        lc.set(head ? [1, 0.95, 0.82] : [1, 0.08, 0.04], (i * 4 + k) * 3);
      }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
    const lampsMat = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    const lamps = new THREE.Points(lg, lampsMat);
    lamps.frustumCulled = false;
    lamps.name = 'highway-lights';
    mainOnly(lamps);
    scene.add(carMesh, lamps);
    const p = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const fwd = new THREE.Vector3();
    updaters.push((dt, _t, _c, night) => {
      lamps.visible = night > 0.05;
      lampsMat.opacity = Math.min(1, night * 1.2);
      for (let i = 0; i < CARS; i++) {
        const c = traffic[i];
        c.s = (((c.s + c.v * dt) % total) + total) % total;
        const s = c.dir > 0 ? c.s : total - c.s;
        const k = at(s, p);
        fwd.copy(tang[k]).multiplyScalar(c.dir);
        const nx = fwd.z;
        const nz = -fwd.x;
        p.x -= nx * c.lane;
        p.z -= nz * c.lane;
        q.setFromEuler(new THREE.Euler(0, Math.atan2(fwd.x, fwd.z), 0));
        m.compose(p, q, one);
        carMesh.setMatrixAt(i, m);
        for (let l = 0; l < 4; l++) {
          const head = l < 2;
          const side = l % 2 ? 0.65 : -0.65;
          const along = head ? 2.25 : -2.25;
          lp[(i * 4 + l) * 3] = p.x + fwd.x * along + nx * side;
          lp[(i * 4 + l) * 3 + 1] = p.y + 0.75;
          lp[(i * 4 + l) * 3 + 2] = p.z + fwd.z * along + nz * side;
        }
      }
      carMesh.instanceMatrix.needsUpdate = true;
      lg.attributes.position.needsUpdate = true;
    });
  }

  // ── Birds by day ────────────────────────────────────────────────────────────
  {
    const parts = [
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.35, -0.08, 0, -0.25, 0.08, 0, -0.25], 3)),
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-0.05, 0, 0.12, -0.6, 0.05, -0.02, -0.05, 0, -0.1, 0.05, 0, 0.12, 0.05, 0, -0.1, 0.6, 0.05, -0.02], 3)),
    ];
    const bird = mergeGeometries(parts)!;
    bird.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color: 0x1b1d20, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        { vec3 ipB = instanceMatrix[3].xyz; float w = abs(position.x); transformed.y += sin(uTime * 11.0 + ipB.x * 0.7 + ipB.z) * w * 0.8; }`,
      );
    };
    mat.customProgramCacheKey = () => 'birds-4d';
    const FLOCKS = 2;
    const PER = 14;
    const im = new THREE.InstancedMesh(bird, mat, FLOCKS * PER);
    im.frustumCulled = false;
    im.name = 'birds';
    mainOnly(im);
    scene.add(im);
    const br = rng(99);
    const birds = Array.from({ length: FLOCKS * PER }, () => ({ ox: (br() - 0.5) * 30, oy: (br() - 0.5) * 8, oz: (br() - 0.5) * 30, ph: br() * 6.28, sc: 1.3 + br() * 0.5 }));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const sv = new THREE.Vector3();
    let enabled = true;
    qualityHooks.push((qq) => (enabled = qq !== 'low'));
    updaters.push((_dt, t, _c, night, rain) => {
      im.visible = enabled && night < 0.3 && rain < 0.5;
      if (!im.visible) return;
      for (let f = 0; f < FLOCKS; f++) {
        const w = 0.035 + f * 0.012;
        const R = 220 + f * 120;
        const cx = WORLD.boundsCenterX + Math.cos(t * w + f * 2) * R;
        const cz = WORLD.boundsCenterZ + Math.sin(t * w * 1.3 + f * 2) * R * 0.7;
        const cy = 55 + f * 18 + Math.sin(t * 0.2 + f) * 8;
        const hx = -Math.sin(t * w + f * 2) * R * w;
        const hz = Math.cos(t * w * 1.3 + f * 2) * R * 0.7 * w * 1.3;
        const yaw = Math.atan2(hx, hz);
        for (let k = 0; k < PER; k++) {
          const b = birds[f * PER + k];
          v.set(cx + b.ox + Math.sin(t * 0.6 + b.ph) * 4, cy + b.oy + Math.sin(t * 0.9 + b.ph) * 2, cz + b.oz + Math.cos(t * 0.5 + b.ph) * 4);
          q.setFromEuler(e.set(Math.sin(t + b.ph) * 0.1, yaw, Math.sin(t * 0.7 + b.ph) * 0.25));
          m.compose(v, q, sv.set(b.sc, b.sc, b.sc));
          im.setMatrixAt(f * PER + k, m);
        }
      }
      im.instanceMatrix.needsUpdate = true;
    });
  }

  // ── all the banners in one mesh ─────────────────────────────────────────────
  if (bannerGeos.length) {
    const mesh = new THREE.Mesh(mergeGeometries(bannerGeos)!, banners);
    banners.side = THREE.DoubleSide;
    mesh.name = 'banners';
    scene.add(mesh);
  }

  void N;
  void TERRAIN;
  return {
    update(dt, time, cars, night, rain) {
      uTime.value = time;
      uWind.value = 0.45 + rain * 0.5;
      for (const u of updaters) u(dt, time, cars, night, rain);
    },
    setQuality(q) {
      for (const h of qualityHooks) h(q);
    },
  };
}
