// ─────────────────────────────────────────────────────────────────────────────
// Hanagiri Pass dressing (5A) — what makes the mountain look like Hanagiri:
//   · the village: timber-and-plaster houses with deep tiled roofs, paper windows lit at night;
//   · the shrine at the summit; vermilion torii gates over the road; stone lanterns (lit at night);
//   · chevron boards round the hairpins and red-and-white snow poles up high;
//   · spectators at the village and the summit who jump up as the cars pass;
//   · valley mist lying in the low ground, and cherry petals drifting round the camera.
// Everything is merged per material (a handful of draw calls) and stands on the height field.
// Original art only: no textures, banners or logos from the layout the map was traced from.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../../core/math';
import { mainOnly } from '../../core/layers';
import type { CarDot, Dressing, DressingContext } from '../dressing';
import { mountainUniforms } from './MountainTerrain';
import { buildLandmarks } from './landmarks';
import { buildWinterLight } from './winter';

type Quality = 'low' | 'medium' | 'high' | 'ultra';

/** Collects coloured parts per material, then merges them into one mesh each. */
class Bucket {
  private parts: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry, color: number | THREE.Color, m: THREE.Matrix4): void {
    const ng = g.index ? g.toNonIndexed() : g.clone();
    ng.applyMatrix4(m);
    for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') ng.deleteAttribute(k);
    if (!ng.getAttribute('uv')) ng.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(ng.getAttribute('position').count * 2), 2));
    const c = new THREE.Color(color);
    const n = ng.getAttribute('position').count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      a[i * 3] = c.r;
      a[i * 3 + 1] = c.g;
      a[i * 3 + 2] = c.b;
    }
    ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
    this.parts.push(ng);
  }
  mesh(mat: THREE.Material, name: string): THREE.Mesh | null {
    if (!this.parts.length) return null;
    const g = mergeGeometries(this.parts)!;
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    this.parts = [];
    return m;
  }
}

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const V = new THREE.Vector3();
const SC = new THREE.Vector3();
/** world matrix: at (x, y, z), turned by yaw, then a local offset (lx, ly, lz) and optional tilt */
function at(x: number, y: number, z: number, yaw: number, lx = 0, ly = 0, lz = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0): THREE.Matrix4 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  V.set(x + lx * c + lz * s, y + ly, z - lx * s + lz * c);
  Q.setFromEuler(E.set(rx, yaw, rz, 'YXZ'));
  return M.compose(V, Q, SC.set(sx, sy, sz));
}

/** A hip roof: eaves w × d at y = 0, ridge along the longer side, height h. */
function hipRoof(w: number, d: number, h: number): THREE.BufferGeometry {
  const long = Math.max(w, d);
  const short = Math.min(w, d);
  const r = (long - short) / 2; // half the ridge length
  const alongX = w >= d;
  const P = (a: number, y: number, b: number) => (alongX ? [a, y, b] : [b, y, a]);
  const hl = long / 2;
  const hs = short / 2;
  const e = [P(-hl, 0, -hs), P(hl, 0, -hs), P(hl, 0, hs), P(-hl, 0, hs)];
  const r0 = P(-r, h, 0);
  const r1 = P(r, h, 0);
  const tris = [
    [e[0], r0, r1], [e[0], r1, e[1]], // one long face
    [e[2], r1, r0], [e[2], r0, e[3]], // the other
    [e[1], r1, e[2]], // hip ends
    [e[3], r0, e[0]],
  ];
  const pos: number[] = [];
  for (const t of tris) for (const p of t) pos.push(...p);
  // the eaves curl up a touch at the corners: drop the middle of the eaves line instead
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // make sure every face points outwards
  const pa = g.getAttribute('position');
  const na = g.getAttribute('normal');
  for (let i = 0; i < pa.count; i += 3) {
    const cx = (pa.getX(i) + pa.getX(i + 1) + pa.getX(i + 2)) / 3;
    const cz = (pa.getZ(i) + pa.getZ(i + 1) + pa.getZ(i + 2)) / 3;
    if (na.getX(i) * cx + na.getZ(i) * cz + na.getY(i) * 0.01 < 0) {
      // swap two vertices
      for (const arr of [pa, na]) {
        const x = arr.getX(i + 1);
        const y = arr.getY(i + 1);
        const z = arr.getZ(i + 1);
        arr.setXYZ(i + 1, arr.getX(i + 2), arr.getY(i + 2), arr.getZ(i + 2));
        arr.setXYZ(i + 2, x, y, z);
      }
    }
  }
  g.computeVertexNormals();
  return g;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildHanagiriDressing(ctx: DressingContext): Dressing {
  const { scene, world } = ctx;
  const F = world.field!;
  const gy = (x: number, z: number) => F.at(x, z);
  const rand = rng(777);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 10);
  const updaters: ((dt: number, time: number, cars: readonly CarDot[], night: number) => void)[] = [];
  const qualityHooks: ((q: Quality) => void)[] = [];

  const solid = new Bucket(); // timber, plaster, stone, roofs, torii
  const glow = new Bucket(); // paper windows and lantern fire boxes (emissive)
  const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 });
  const windowMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, emissive: 0xffb062, emissiveIntensity: 1.4, roughness: 0.9 });
  ctx.windows.push(windowMat);
  const lanternMat = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffa04a, emissiveIntensity: 1, roughness: 0.9 });
  ctx.floods.push(lanternMat);
  const lanternGlow = new Bucket();

  // ── 5C: the houses, the shrine, the torii, the lanterns and the new landmarks ──
  const marks = buildLandmarks(ctx);
  updaters.push((dt, time, _cars, night) => marks.update(dt, time, night));
  // 5C: the Snow weather's pano and the low sun in the forest
  const winter = buildWinterLight(scene, world);
  updaters.push((_dt, time) => winter.update(time));
  void box;
  void cyl;
  void glow;
  void lanternGlow;
  void hipRoof;

  // ── Chevron boards and snow poles ───────────────────────────────────────────
  {
    const chevTex = canvasTex(256, 192, (g) => {
      g.fillStyle = '#f2c21b';
      g.fillRect(0, 0, 256, 192);
      g.fillStyle = '#121212';
      for (let k = 0; k < 3; k++) {
        const x0 = 22 + k * 76;
        g.beginPath();
        g.moveTo(x0, 22);
        g.lineTo(x0 + 34, 22);
        g.lineTo(x0 + 80, 96);
        g.lineTo(x0 + 34, 170);
        g.lineTo(x0, 170);
        g.lineTo(x0 + 46, 96);
        g.closePath();
        g.fill();
      }
      g.strokeStyle = '#121212';
      g.lineWidth = 10;
      g.strokeRect(5, 5, 246, 182);
    });
    const list = world.decor.filter((d) => d.kind === 'chevron');
    const boardMat = new THREE.MeshStandardMaterial({ map: chevTex, roughness: 0.5, emissiveMap: chevTex, emissive: 0xffffff, emissiveIntensity: 0.12 });
    ctx.signs.push(boardMat);
    const geo = new THREE.PlaneGeometry(1.5, 1.1);
    const fwd = new THREE.InstancedMesh(geo, boardMat, Math.max(1, list.length));
    const post = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x5a5d61, metalness: 0.5, roughness: 0.5 }), Math.max(1, list.length * 2));
    let pi = 0;
    list.forEach((d, i) => {
      const y = gy(d.x, d.z);
      // the arrows must point the way the road goes: flip the board where its +x runs backwards
      const hit = world.nearestTrack(d.x, d.z);
      const s = hit ? world.samples[hit.index] : null;
      const xl = [Math.cos(d.yaw), -Math.sin(d.yaw)];
      const flip = s ? xl[0] * s.tx + xl[1] * s.tz < 0 : false;
      fwd.setMatrixAt(i, at(d.x, y + 1.6, d.z, d.yaw, 0, 0, 0, flip ? -1 : 1, 1, 1));
      for (const e of [-0.6, 0.6]) post.setMatrixAt(pi++, at(d.x, y + 0.8, d.z, d.yaw, e, 0, -0.05, 0.08, 1.6, 0.08));
    });
    fwd.count = list.length;
    post.count = pi;
    for (const m of [fwd, post]) {
      m.castShadow = true;
      m.computeBoundingSphere();
      scene.add(m);
    }
    (fwd.material as THREE.Material).side = THREE.DoubleSide;

    const poleTex = canvasTex(16, 128, (g) => {
      for (let k = 0; k < 8; k++) {
        g.fillStyle = k % 2 ? '#f4f4f0' : '#d1261c';
        g.fillRect(0, k * 16, 16, 16);
      }
    });
    poleTex.wrapT = THREE.RepeatWrapping;
    const poles = world.decor.filter((d) => d.kind === 'snowpole');
    const pg = new THREE.CylinderGeometry(0.05, 0.05, 1, 6);
    pg.translate(0, 0.5, 0);
    const pm = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ map: poleTex, roughness: 0.5 }), Math.max(1, poles.length));
    const ag = new THREE.ConeGeometry(0.22, 0.45, 3);
    ag.rotateX(Math.PI); // the arrow points down at the road edge
    const am = new THREE.InstancedMesh(ag, new THREE.MeshStandardMaterial({ color: 0xd1261c, emissive: 0x551008, roughness: 0.5 }), Math.max(1, poles.length));
    poles.forEach((d, i) => {
      const y = gy(d.x, d.z);
      pm.setMatrixAt(i, at(d.x, y - 0.2, d.z, 0, 0, 0, 0, 1, 3.6, 1));
      am.setMatrixAt(i, at(d.x, y + 3.2, d.z, rand() * 6.28));
    });
    pm.count = am.count = poles.length;
    for (const m of [pm, am]) {
      m.castShadow = true;
      m.computeBoundingSphere();
      scene.add(m);
    }
  }

  for (const [b, mat, name] of [
    [solid, solidMat, 'hanagiri-solid'],
    [glow, windowMat, 'hanagiri-windows'],
    [lanternGlow, lanternMat, 'hanagiri-lanterns'],
  ] as const) {
    const m = b.mesh(mat, name);
    if (m) scene.add(m);
  }

  // ── Spectators ──────────────────────────────────────────────────────────────
  {
    interface Fan {
      x: number;
      y: number;
      z: number;
      yaw: number;
      ph: number;
      g: number;
    }
    const groups: { x: number; z: number; cheer: number }[] = [];
    const fans: Fan[] = [];
    for (const d of world.decor) {
      if (d.kind !== 'crowd') continue;
      const gi = groups.length;
      groups.push({ x: d.x, z: d.z, cheer: 0 });
      const n = d.s ?? 5;
      for (let k = 0; k < n; k++) {
        const lx = (k - (n - 1) / 2) * 0.8 + (rand() - 0.5) * 0.3;
        const lz = (rand() - 0.5) * 1.6 - (k % 2) * 0.7;
        const c = Math.cos(d.yaw);
        const s = Math.sin(d.yaw);
        const x = d.x + lx * c + lz * s;
        const z = d.z - lx * s + lz * c;
        fans.push({ x, z, y: gy(x, z), yaw: d.yaw + (rand() - 0.5) * 0.6, ph: rand() * 6.28, g: gi });
      }
    }
    if (fans.length) {
      const bodyG = mergeGeometries([new THREE.BoxGeometry(0.46, 0.62, 0.28).translate(0, 1.18, 0).toNonIndexed(), new THREE.BoxGeometry(0.4, 0.86, 0.24).translate(0, 0.43, 0).toNonIndexed()])!;
      const headG = new THREE.SphereGeometry(0.13, 10, 8).translate(0, 1.66, 0);
      const coats = [0x2a4b7c, 0x8a2a24, 0x2f5a3a, 0x1d1d22, 0xc9b38a, 0x6b4a8a, 0xd8d4c8, 0xb8452e];
      const bodies = new THREE.InstancedMesh(bodyG, new THREE.MeshStandardMaterial({ roughness: 0.9 }), fans.length);
      const heads = new THREE.InstancedMesh(headG, new THREE.MeshStandardMaterial({ roughness: 0.8 }), fans.length);
      const c = new THREE.Color();
      fans.forEach((f, i) => {
        bodies.setColorAt(i, c.set(coats[Math.floor(rand() * coats.length)]).multiplyScalar(0.8 + rand() * 0.3));
        heads.setColorAt(i, c.set(rand() < 0.4 ? 0x1c1815 : 0xc99a78));
      });
      const place = (time: number) => {
        fans.forEach((f, i) => {
          const g = groups[f.g];
          const jump = g.cheer * Math.max(0, Math.sin(time * 9 + f.ph)) * 0.32;
          const sway = Math.sin(time * 1.3 + f.ph) * 0.03;
          at(f.x, f.y + jump, f.z, f.yaw, 0, 0, 0, 1, 1, 1, sway, 0);
          bodies.setMatrixAt(i, M);
          heads.setMatrixAt(i, M);
        });
        bodies.instanceMatrix.needsUpdate = true;
        heads.instanceMatrix.needsUpdate = true;
      };
      place(0);
      for (const m of [bodies, heads]) {
        m.castShadow = true;
        m.computeBoundingSphere();
        m.name = 'crowd';
        mainOnly(m);
        scene.add(m);
      }
      updaters.push((dt, time, cars) => {
        for (const g of groups) {
          let near = 1e9;
          for (const car of cars) if (car.speed > 8) near = Math.min(near, Math.hypot(car.x - g.x, car.z - g.z));
          const want = near < 55 ? 1 : 0;
          g.cheer += (want - g.cheer) * Math.min(1, dt * (want ? 6 : 0.8));
        }
        place(time);
      });
    }
  }

  // ── Valley mist: two soft layers lying in the low ground ───────────────────
  const mistU = { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xdfe6ee) }, uAmount: { value: 1 }, tH: { value: null as THREE.Texture | null }, uH: { value: new THREE.Vector4() } };
  {
    // the land's height as a small texture (8 m texels), so the mist thins where the ground rises into it
    const step = 2;
    const w = Math.ceil(F.nx / step);
    const h = Math.ceil(F.nz / step);
    const data = new Float32Array(w * h);
    for (let k = 0; k < h; k++) for (let i = 0; i < w; i++) data[k * w + i] = F.h[Math.min(F.nz - 1, k * step) * F.nx + Math.min(F.nx - 1, i * step)];
    const ht = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.FloatType);
    ht.magFilter = ht.minFilter = THREE.LinearFilter;
    ht.needsUpdate = true;
    mistU.tH.value = ht;
    mistU.uH.value.set(F.x0, F.z0, (w - 1) * step * F.cell, (h - 1) * step * F.cell);
    const sx = (F.nx - 1) * F.cell;
    const sz = (F.nz - 1) * F.cell;
    for (const [ly, thick, op] of [
      [16, 24, 0.5],
      [42, 34, 0.32],
    ]) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...mistU, uY: { value: ly }, uThick: { value: thick }, uOp: { value: op } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        vertexShader: /* glsl */ `
          varying vec3 vW;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uAmount, uY, uThick, uOp;
          uniform vec3 uColor;
          uniform sampler2D tH;
          uniform vec4 uH;
          varying vec3 vW;
          float n2(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5);
            float b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5);
            float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5);
            float d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5);
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
          }
          void main() {
            float ground = texture2D(tH, (vW.xz - uH.xy) / uH.zw).r;
            float depth = uY - ground; // how deep the mist is here
            float lay = smoothstep(0.0, uThick, depth);
            vec2 p = vW.xz * 0.004 + vec2(uTime * 0.004, uTime * 0.0025);
            float cl = n2(p) * 0.55 + n2(p * 2.7 + 3.1) * 0.3 + n2(p * 7.3 - 1.7) * 0.15;
            float a = lay * smoothstep(0.35, 0.8, cl) * uOp * uAmount;
            // fade it out close to the eye (no hard sheet in front of the camera)
            float dc = length(cameraPosition - vW);
            a *= smoothstep(25.0, 140.0, dc);
            if (a < 0.003) discard;
            gl_FragColor = vec4(uColor, a);
          }`,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(F.x0 + sx / 2, ly, F.z0 + sz / 2);
      m.renderOrder = 8;
      m.frustumCulled = false;
      m.name = 'valley-mist';
      mainOnly(m);
      scene.add(m);
    }
  }

  // ── Cherry petals drifting round the camera ─────────────────────────────────
  {
    const COUNT = 1100;
    const R = 46;
    const pos = new Float32Array(COUNT * 3);
    const ph = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (rand() * 2 - 1) * R;
      pos[i * 3 + 1] = rand() * 22;
      pos[i * 3 + 2] = (rand() * 2 - 1) * R;
      ph[i] = rand() * 100;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    const pu = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uR: { value: R }, uAmt: { value: 1 }, uLight: { value: new THREE.Color(1, 1, 1) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: pu,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aPh;
        uniform float uTime, uR;
        uniform vec3 uCam;
        varying float vA;
        varying float vSpin;
        void main() {
          vec3 p = position;
          float t = uTime + aPh;
          // drift with the wind, fall slowly, flutter
          p.x += t * 1.6 + sin(t * 1.7) * 0.8;
          p.z += t * 0.7 + cos(t * 1.3) * 0.8;
          p.y -= t * 0.9;
          // wrap round the camera
          p.xz = mod(p.xz - uCam.xz + uR, 2.0 * uR) - uR + uCam.xz;
          p.y = mod(p.y - uCam.y + 6.0, 22.0) - 6.0 + uCam.y;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(95.0 / d, 1.0, 6.5);
          vA = smoothstep(2.0, 6.0, d) * (1.0 - smoothstep(uR * 0.6, uR, length(p.xz - uCam.xz)));
          vSpin = t * 3.0;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAmt;
        uniform vec3 uLight;
        varying float vA;
        varying float vSpin;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float c = cos(vSpin), s = sin(vSpin);
          q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
          float e = length(q * vec2(1.0, 1.9 + 0.8 * sin(vSpin * 0.7)));
          float a = (1.0 - smoothstep(0.3, 0.5, e)) * vA * uAmt;
          if (a < 0.02) discard;
          gl_FragColor = vec4(vec3(1.0, 0.62, 0.74) * uLight, a);
        }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.name = 'petals';
    pts.onBeforeRender = (_r, _s, cam) => {
      pu.uCam.value.setFromMatrixPosition(cam.matrixWorld);
      // only down where the cherry trees grow
      const y = pu.uCam.value.y;
      pu.uAmt.value = mountainUniforms.uPetals.value * (1 - Math.min(1, Math.max(0, (y - 70) / 45)));
    };
    mainOnly(pts);
    scene.add(pts);
    updaters.push((_dt, time, _c, night) => {
      pu.uTime.value = time;
      pu.uLight.value.setScalar(1 - night * 0.75);
    });
    qualityHooks.push((q) => (g.setDrawRange(0, q === 'low' ? COUNT / 4 : q === 'medium' ? COUNT / 2 : COUNT)));
  }

  return {
    update(dt, time, cars, night, rain) {
      mistU.uTime.value = time;
      const fog = scene.fog as THREE.FogExp2 | null;
      if (fog) mistU.uColor.value.copy(fog.color).lerp(new THREE.Color(0xffffff), 0.25 * (1 - night));
      mistU.uAmount.value = 1 + rain * 0.6;
      for (const u of updaters) u(dt, time, cars, night);
    },
    setQuality(q) {
      for (const h of qualityHooks) h(q);
    },
  };
}
