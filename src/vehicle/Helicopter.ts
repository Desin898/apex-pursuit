// ─────────────────────────────────────────────────────────────────────────────
// Helicopter — "Air One", the Proving Grounds patrol helicopter. An original design, rebuilt in
// Phase 4E so it holds up close:
// - a lathe-turned fuselage painted from one livery canvas: black over white with a red
//   pinstripe, framed side windows, a sliding-door outline, "AIR ONE" and an invented crest
//   (no real department, registration or maker)
// - a wrap-round glass nose, engine fairing with twin exhausts, antennas, a camera ball and the
//   searchlight under the nose, step bars on the skids
// - a tail boom with "AIR ONE · 07", a fenced tail rotor, a fin with the crest
// - a four-blade main rotor: faint blades turning at a calm on-screen rate over a lit, glinting
//   disc (no strobing), the same for the tail rotor
// - lights: red/blue flashers under the cabin, a white strobe, a red beacon, red/green
//   navigation lights and a landing light when it's low
// - the searchlight: a soft volumetric beam (shows in rain, fog and at night) and a real spot
//   light that lights the road, the cars and the trees where it points
// It flies like a helicopter: the view feeds it its velocity, and it pitches nose-down to
// speed up, banks into turns, flares to slow and sways a little in wind and rain.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mainOnly } from '../core/layers';
import { mergeByMaterial } from '../core/merge';

const W = 1024;
const H = 512;

/** The fuselage livery, laid out in the lathe's UVs: u = round the body (0 belly, .25 left side,
 *  .5 top, .75 right side), v = along it (0 tail end, 1 nose). */
function liveryTextures(): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const r = document.createElement('canvas');
  r.width = W;
  r.height = H;
  const q = r.getContext('2d')!;
  // body: white lower half, black upper half, a red pinstripe on the join
  g.fillStyle = '#e9ecef';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#0c0e12';
  g.fillRect(W * 0.31, 0, W * 0.38, H);
  g.fillStyle = '#c8121e';
  g.fillRect(W * 0.295, 0, W * 0.012, H);
  g.fillRect(W * 0.693, 0, W * 0.012, H);
  // body is glossy paint; windows glassier
  q.fillStyle = '#5a5a5a';
  q.fillRect(0, 0, W, H);
  // side windows (two per side), framed, and the sliding door outline behind the front pair
  const side = (u: number, flip: number) => {
    const x0 = W * u;
    // windows sit high on the side, towards the nose (v 0.55..0.85)
    for (const [v0, v1] of [
      [0.6, 0.78],
      [0.42, 0.57],
    ]) {
      const y0 = H * v0;
      const y1 = H * v1;
      const w = W * 0.095;
      const x = flip > 0 ? x0 + W * 0.01 : x0 - W * 0.01 - w;
      g.fillStyle = '#05070b';
      g.beginPath();
      g.roundRect(x - 4, y0 - 4, w + 8, y1 - y0 + 8, 18);
      g.fill(); // frame
      const gr = g.createLinearGradient(x, y0, x + w, y1);
      gr.addColorStop(0, '#1c2a3a');
      gr.addColorStop(0.5, '#0d1722');
      gr.addColorStop(1, '#22344a');
      g.fillStyle = gr;
      g.beginPath();
      g.roundRect(x, y0, w, y1 - y0, 14);
      g.fill();
      q.fillStyle = '#0a0a0a';
      q.beginPath();
      q.roundRect(x, y0, w, y1 - y0, 14);
      q.fill();
    }
    // sliding door: a thin dark outline from the belly up to the window line, and its rail
    const dx = flip > 0 ? x0 - W * 0.06 : x0 - W * 0.06;
    g.strokeStyle = 'rgba(20,22,26,0.85)';
    g.lineWidth = 3;
    g.strokeRect(dx, H * 0.41, W * 0.12, H * 0.2);
    g.fillStyle = 'rgba(20,22,26,0.7)';
    g.fillRect(dx - 6, H * 0.4, W * 0.135, 4);
  };
  side(0.25, 1);
  side(0.75, -1);
  // text and crest on each side of the white lower body (written so they read the right way
  // round from outside: the lathe's UVs are mirrored relative to the view)
  const words = (u: number, readAlongV: number) => {
    g.save();
    // local x = reading direction (along the body), local y = down the side (towards the belly)
    if (readAlongV < 0) g.setTransform(0, 1, -1, 0, W * u, H * 0.48);
    else g.setTransform(0, -1, 1, 0, W * u, H * 0.52);
    g.translate(0, W * 0.075);
    g.fillStyle = '#0c0e12';
    g.font = '800 64px Outfit, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('AIR ONE', 0, 0);
    g.font = '700 26px Outfit, Arial, sans-serif';
    g.fillStyle = '#c8121e';
    g.fillText('PROVING GROUNDS PATROL', 0, 44);
    g.restore();
  };
  words(0.25, -1);
  words(0.75, 1);
  // a red "07" on the belly, readable from below
  g.save();
  g.setTransform(0, -1, 1, 0, W * 0.02, H * 0.5);
  g.fillStyle = '#c8121e';
  g.font = '900 90px Outfit, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('07', 0, 0);
  g.restore();
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const rough = new THREE.CanvasTexture(r);
  return { map, rough };
}

/** "AIR ONE · 07" and the crest for the tail boom and fin (both sides). */
function boomTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0c0e12';
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#c8121e';
  g.fillRect(0, 70, 512, 6);
  g.fillStyle = '#e9ecef';
  g.font = '800 46px Outfit, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('AIR ONE · 07', 256, 38);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function crestTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  // an invented crest: a shield with a chequered flag band and a star
  g.fillStyle = '#0c0e12';
  g.fillRect(0, 0, 256, 256);
  g.beginPath();
  g.moveTo(128, 18);
  g.lineTo(220, 52);
  g.quadraticCurveTo(214, 170, 128, 238);
  g.quadraticCurveTo(42, 170, 36, 52);
  g.closePath();
  g.fillStyle = '#d9b44a';
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#e9ecef';
  g.stroke();
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#0c0e12' : '#e9ecef';
    g.fillRect(56 + i * 18, 100, 18, 18);
    g.fillStyle = i % 2 ? '#e9ecef' : '#0c0e12';
    g.fillRect(56 + i * 18, 118, 18, 18);
  }
  g.fillStyle = '#c8121e';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? 14 : 32;
    g.lineTo(128 + Math.cos(a) * rr, 68 + Math.sin(a) * rr);
  }
  g.fill();
  g.fillStyle = '#0c0e12';
  g.font = '900 40px Outfit, Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('PG', 128, 190);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The rotor blur as an alpha map: black = clear, white = solid (only the green channel counts). */
function discTexture(blades: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  const lum = (a: number) => {
    const v = Math.round(Math.max(0, Math.min(1, a)) * 255);
    return `rgb(${v},${v},${v})`;
  };
  const gr = g.createRadialGradient(128, 128, 8, 128, 128, 127);
  gr.addColorStop(0, lum(0));
  gr.addColorStop(0.14, lum(0.2));
  gr.addColorStop(0.8, lum(0.13));
  gr.addColorStop(0.95, lum(0.3)); // blade tips trace a brighter rim
  gr.addColorStop(1, lum(0));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(128, 128, 127, 0, Math.PI * 2);
  g.fill();
  // soft blade sweeps: each a wedge that fades behind the blade
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < blades; i++) {
    const a0 = (i * Math.PI * 2) / blades;
    for (let k = 0; k < 12; k++) {
      g.beginPath();
      g.moveTo(128, 128);
      g.arc(128, 128, 122, a0 - k * 0.035, a0 - (k + 1) * 0.035, true);
      g.closePath();
      g.fillStyle = lum(0.09 * (1 - k / 12));
      g.fill();
    }
  }
  return new THREE.CanvasTexture(c);
}

/** The volumetric searchlight beam: brightest along its axis and near the lamp. */
function beamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uK: { value: 0 }, uCol: { value: new THREE.Color(1, 0.95, 0.84) } },
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vAlong = -position.y; // 0 at the lamp, 1 on the ground
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uK;
      uniform vec3 uCol;
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 3.0); // soft at the rim of the cone
        float fall = mix(1.0, 0.2, vAlong) * smoothstep(0.0, 0.05, vAlong) * (1.0 - smoothstep(0.8, 1.0, vAlong));
        gl_FragColor = vec4(uCol * uK * edge * fall, 1.0);
      }`,
  });
}

export class Helicopter {
  readonly root = Object.assign(new THREE.Group(), { userData: { noBake: true } });
  /** the airframe (pitched, banked and swayed inside the root) */
  private body = new THREE.Group();
  private rotor = new THREE.Group();
  private disc: THREE.Mesh;
  private discMat: THREE.MeshStandardMaterial;
  private bladeMat: THREE.MeshStandardMaterial;
  private tailRotor = new THREE.Group();
  private tailDisc: THREE.Mesh;
  private beacon: THREE.MeshStandardMaterial;
  private strobe: THREE.MeshStandardMaterial;
  private flashR: THREE.MeshStandardMaterial;
  private flashB: THREE.MeshStandardMaterial;
  private landing: THREE.MeshStandardMaterial;
  /**
   * 4F.1: glints for the beacon, strobe, nav lights and flashers. They keep a fixed size on
   * screen, the way a real aircraft's lights read from far off at night (the bulbs themselves are
   * a few pixels at most past 50 m, and vanish without them).
   */
  private glare: THREE.Sprite;
  private glareMat: THREE.SpriteMaterial;
  private glareDir = new THREE.Vector3();
  private glints: { m: THREE.SpriteMaterial; kind: 'beacon' | 'strobe' | 'navR' | 'navG' | 'red' | 'blue'; size: number; s: THREE.Sprite }[] = [];
  private lampMat: THREE.MeshStandardMaterial;
  /** the visible light cone (night, rain or fog) */
  readonly cone: THREE.Mesh;
  private coneMat: THREE.ShaderMaterial;
  /** a soft pool on the ground where the beam lands, for when there is no real light (Low) */
  private pool: THREE.Mesh;
  private poolMat: THREE.MeshBasicMaterial;
  /** a real light for the searchlight (Medium quality and up) */
  readonly spot: THREE.SpotLight;
  /** 0..1 how much the air shows a beam (rain, fog); set by the view */
  haze = 0;
  /** 0..1 how windy / rainy (more wobble) */
  gust = 0;
  // flight attitude, eased
  private pitch = 0;
  private roll = 0;
  private sway = 0;
  private lastVx = 0;
  private lastVz = 0;
  private aF = 0;
  private aL = 0;
  private fresh = true;
  /** world position of the searchlight lamp, updated every frame */
  readonly lampPos = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const { map, rough } = liveryTextures();
    const livery = new THREE.MeshPhysicalMaterial({ map, roughnessMap: rough, roughness: 0.6, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.06 });
    const black = new THREE.MeshPhysicalMaterial({ color: 0x0d0f13, roughness: 0.35, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.08 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1320, roughness: 0.03, metalness: 0.2, clearcoat: 1, envMapIntensity: 1.8, transparent: true, opacity: 0.92 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.35, metalness: 0.85 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x121315, roughness: 0.8 });
    const B = this.body;
    // ── fuselage: a lathe profile (radius by length) turned round the long axis ──
    const prof: [number, number][] = [
      [0.0, -2.35], [0.42, -2.25], [0.82, -1.85], [1.08, -1.1], [1.2, -0.3], [1.22, 0.4], [1.14, 1.0], [0.96, 1.5], [0.68, 1.95], [0.34, 2.22], [0.0, 2.32],
    ];
    const lathe = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), 32);
    lathe.rotateX(Math.PI / 2); // lathe axis (y) → the long axis (z)
    lathe.scale(0.94, 0.95, 1);
    const pod = new THREE.Mesh(lathe, livery);
    pod.position.y = 0.2;
    // wrap-round glass nose over the front of the pod
    const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.44), glass);
    nose.rotation.x = Math.PI / 2 - 0.42;
    nose.scale.set(0.92, 0.96, 0.98);
    nose.position.set(0, 0.5, 1.15);
    // a frame bar down the middle of the windscreen and round its edge
    const bar = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.03, 4, 24, Math.PI * 0.9), black);
    bar.rotation.set(0, Math.PI / 2, 0);
    bar.position.set(0, 0.42, 1.28);
    // engine fairing on top, with twin exhausts out of the back
    const fair = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.6, 6, 14), black);
    fair.rotation.x = Math.PI / 2;
    fair.position.set(0, 1.22, -0.55);
    fair.scale.set(1.15, 1, 1);
    B.add(pod, nose, bar, fair);
    const sootMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
    const grilleMat = new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.9 });
    for (const sx of [1, -1]) {
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.5, 12, 1, true), steel);
      ex.rotation.set(Math.PI / 2 - 0.25, 0, sx * 0.35);
      ex.position.set(sx * 0.42, 1.3, -1.55);
      const soot = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), sootMat);
      soot.position.set(sx * 0.48, 1.38, -1.78);
      soot.rotation.y = Math.PI;
      B.add(ex, soot);
      // intake grille on the fairing sides
      const grille = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.22), grilleMat);
      grille.position.set(sx * 0.585, 1.25, -0.2);
      grille.rotation.y = (sx * Math.PI) / 2;
      B.add(grille);
    }
    // ── tail boom, fin with the crest, stabiliser with end plates, fenced tail rotor ──
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.38, 5.2, 16), black);
    boom.rotation.x = Math.PI / 2;
    boom.position.set(0, 0.62, -4.55);
    const plateMat = new THREE.MeshPhysicalMaterial({ map: boomTexture(), roughness: 0.35, clearcoat: 1, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const sx of [1, -1]) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.48), plateMat);
      plate.position.set(sx * 0.33, 0.64, -3.65);
      plate.rotation.set(0, (sx * Math.PI) / 2, sx * 0.055);
      B.add(plate);
    }
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.5, 0.95), black);
    fin.position.set(0, 1.25, -7.0);
    fin.rotation.x = -0.32;
    const crestMat = new THREE.MeshStandardMaterial({ map: crestTexture(), roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const sx of [1, -1]) {
      const cm = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), crestMat);
      cm.position.set(sx * 0.05, 1.32, -6.98);
      cm.rotation.set(-0.32, (sx * Math.PI) / 2, 0);
      B.add(cm);
    }
    const stab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.48), black);
    stab.position.set(0, 0.64, -6.4);
    B.add(boom, fin, stab);
    for (const sx of [1, -1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.42), black);
      plate.position.set(sx * 0.95, 0.68, -6.4);
      B.add(plate);
    }
    const fence = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.08, 8, 24), black);
    fence.rotation.y = Math.PI / 2;
    fence.position.set(0.12, 1.28, -7.15);
    B.add(fence);
    // ── skids with step bars, struts ──
    for (const sx of [1, -1]) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(sx * 1.08, -1.3, -1.6), new THREE.Vector3(sx * 1.08, -1.32, 0.6), new THREE.Vector3(sx * 1.08, -1.25, 1.55), new THREE.Vector3(sx * 1.08, -0.98, 2.0)]);
      B.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.065, 8), steel));
      for (const z of [0.9, -0.75]) {
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.85, 8), steel);
        strut.position.set(sx * 0.9, -0.92, z);
        strut.rotation.z = sx * 0.42;
        B.add(strut);
      }
      // step bar along the skid, below the door
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 1.3), rubber);
      step.position.set(sx * 1.2, -1.0, 0.25);
      B.add(step);
      for (const z of [-0.3, 0.8]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.32, 6), steel);
        leg.position.set(sx * 1.14, -1.15, z);
        B.add(leg);
      }
    }
    // ── antennas: two blades under the belly, a whip on the boom, a mast aerial on top ──
    for (const [x, z, h] of [
      [0.2, -0.9, 0.38],
      [-0.25, 0.4, 0.3],
    ] as const) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.03, h, 0.16), black);
      a.position.set(x, -0.82 - h / 2, z);
      a.rotation.x = 0.3;
      B.add(a);
    }
    const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.9, 5), black);
    whip.position.set(0, 1.12, -3.4);
    whip.rotation.x = -0.5;
    B.add(whip);
    // ── under the nose: the camera ball (left) and the searchlight (right) ──
    const gimbal = new THREE.Mesh(new THREE.SphereGeometry(0.23, 16, 12), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.3, metalness: 0.7 }));
    gimbal.position.set(0.35, -0.72, 1.65);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), new THREE.MeshPhysicalMaterial({ color: 0x07090c, roughness: 0.02, metalness: 0.5, clearcoat: 1 }));
    lens.position.set(0.35, -0.75, 1.88);
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 8), steel);
    mount.position.set(0.35, -0.5, 1.65);
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff2dc, emissiveIntensity: 6 });
    const lampHead = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.34, 14), steel);
    lampHead.position.set(-0.35, -0.82, 1.6);
    const lampFace = new THREE.Mesh(new THREE.CircleGeometry(0.19, 16), this.lampMat);
    lampFace.position.set(-0.35, -1.0, 1.6);
    lampFace.rotation.x = Math.PI / 2;
    B.add(gimbal, lens, mount, lampHead, lampFace);
    // ── main rotor: hub, faint blades and the lit blur disc ──
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.6, 10), steel);
    mast.position.y = 1.72;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.16, 12), steel);
    hub.position.y = 2.0;
    B.add(mast, hub);
    this.bladeMat = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.45, metalness: 0.3, transparent: true, opacity: 0.32, depthWrite: false });
    const bladeGeo = new THREE.BoxGeometry(0.32, 0.035, 5.6);
    bladeGeo.translate(0, 0, 2.95);
    for (let i = 0; i < 4; i++) {
      const bl = new THREE.Mesh(bladeGeo, this.bladeMat);
      bl.rotation.y = (i * Math.PI) / 2;
      this.rotor.add(bl);
    }
    this.rotor.position.y = 2.06;
    this.discMat = new THREE.MeshStandardMaterial({ color: 0x1c1f24, alphaMap: discTexture(4), transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.22, metalness: 0.6 });
    const discG = new THREE.CircleGeometry(5.9, 48);
    discG.rotateX(-Math.PI / 2);
    this.disc = new THREE.Mesh(discG, this.discMat);
    this.disc.position.y = 2.07;
    B.add(this.rotor, this.disc);
    const tbGeo = new THREE.BoxGeometry(0.03, 1.1, 0.12);
    for (let i = 0; i < 2; i++) {
      const bl = new THREE.Mesh(tbGeo, this.bladeMat);
      bl.rotation.x = (i * Math.PI) / 2;
      this.tailRotor.add(bl);
    }
    this.tailRotor.position.set(0.14, 1.28, -7.15);
    const tdG = new THREE.CircleGeometry(0.56, 24);
    tdG.rotateY(Math.PI / 2);
    this.tailDisc = new THREE.Mesh(tdG, this.discMat);
    this.tailDisc.position.copy(this.tailRotor.position);
    B.add(this.tailRotor, this.tailDisc);
    // ── lights ──
    const glow = (col: number, e = 0) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: col, emissiveIntensity: e });
    this.beacon = glow(0xff2020);
    const bc = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), this.beacon);
    bc.position.set(0, 1.62, -1.45);
    this.strobe = glow(0xffffff);
    const sb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), this.strobe);
    sb.position.set(0, 2.0, -7.4);
    const navR = new THREE.Mesh(new THREE.SphereGeometry(0.065, 6, 4), glow(0xff1010, 5));
    navR.position.set(0.98, 0.74, -6.4); // left (+x)
    const navG = new THREE.Mesh(new THREE.SphereGeometry(0.065, 6, 4), glow(0x20ff40, 5));
    navG.position.set(-0.98, 0.74, -6.4);
    // red / blue flashers on the cabin flanks and a pair on the nose
    this.flashR = glow(0xff1a24);
    this.flashB = glow(0x2a5bff);
    const fl = new THREE.BoxGeometry(0.08, 0.1, 0.42);
    for (const [x, y, z, m] of [
      [0.99, -0.35, 0.6, this.flashR],
      [-0.99, -0.35, 0.6, this.flashB],
      [0.32, -0.42, 1.9, this.flashR],
      [-0.32, -0.42, 1.9, this.flashB],
    ] as const) {
      const f = new THREE.Mesh(fl, m);
      f.position.set(x, y, z);
      B.add(f);
    }
    // landing light in the belly
    this.landing = glow(0xfff6e6);
    const ll = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), this.landing);
    ll.position.set(0, -0.96, 0.9);
    ll.rotation.x = Math.PI / 2;
    B.add(bc, sb, navR, navG, ll);
    this.body.position.y = 0;
    // one draw call per material for everything that doesn't spin
    const keep: THREE.Mesh[] = [this.disc, this.tailDisc];
    for (const g of [this.rotor, this.tailRotor]) g.traverse((o) => (o as THREE.Mesh).isMesh && keep.push(o as THREE.Mesh));
    mergeByMaterial(B, keep);
    // glints (after the merge: sprites stay separate)
    const gc = document.createElement('canvas');
    gc.width = gc.height = 64;
    const gx = gc.getContext('2d')!;
    const rg = gx.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.12, 'rgba(255,255,255,0.85)');
    rg.addColorStop(0.35, 'rgba(255,255,255,0.1)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    gx.fillStyle = rg;
    gx.fillRect(0, 0, 64, 64);
    // a faint horizontal streak, like a lens catching a bright point
    const hg = gx.createLinearGradient(0, 0, 64, 0);
    hg.addColorStop(0, 'rgba(255,255,255,0)');
    hg.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    gx.fillStyle = hg;
    gx.fillRect(0, 31, 64, 2);
    const gtex = new THREE.CanvasTexture(gc);
    gtex.colorSpace = THREE.SRGBColorSpace;
    const glint = (col: number, x: number, y: number, z: number, kind: (typeof this.glints)[number]['kind'], size: number) => {
      const m = new THREE.SpriteMaterial({ map: gtex, color: col, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false, fog: false, transparent: true, opacity: 0 });
      const sp = new THREE.Sprite(m);
      sp.position.set(x, y, z);
      sp.scale.setScalar(size);
      sp.renderOrder = 8;
      B.add(sp);
      this.glints.push({ m, kind, size, s: sp });
    };
    glint(0xff3030, 0, 1.62, -1.45, 'beacon', 0.045);
    glint(0xffffff, 0, 2.0, -7.4, 'strobe', 0.07);
    glint(0xff2a20, 0.98, 0.74, -6.4, 'navR', 0.022);
    glint(0x40ff60, -0.98, 0.74, -6.4, 'navG', 0.022);
    glint(0xff2030, 0.99, -0.35, 0.6, 'red', 0.04);
    glint(0x3a6bff, -0.99, -0.35, 0.6, 'blue', 0.045);
    // the searchlight's lamp: blinding when it points at you
    this.glareMat = new THREE.SpriteMaterial({ map: gtex, color: 0xfff1d6, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false, fog: false, transparent: true, opacity: 0 });
    this.glare = new THREE.Sprite(this.glareMat);
    this.glare.renderOrder = 12;
    this.glare.visible = false;
    scene.add(this.glare);
    this.root.add(B);
    this.root.visible = false;
    scene.add(this.root);

    // ── searchlight: volumetric cone, a ground pool (Low) and a real spot light ──
    const cg = new THREE.ConeGeometry(1, 1, 32, 1, true);
    cg.translate(0, -0.5, 0); // apex at the origin, opening down −Y
    this.coneMat = beamMaterial();
    this.cone = new THREE.Mesh(cg, this.coneMat);
    this.cone.visible = false;
    this.cone.renderOrder = 9;
    mainOnly(this.cone);
    scene.add(this.cone);
    const pg = new THREE.CircleGeometry(1, 32);
    pg.rotateX(-Math.PI / 2);
    const pc = document.createElement('canvas');
    pc.width = pc.height = 128;
    const px = pc.getContext('2d')!;
    const gr = px.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.55, 'rgba(255,255,255,0.75)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    px.fillStyle = gr;
    px.fillRect(0, 0, 128, 128);
    this.poolMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(pc), color: 0x000000, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    this.pool = new THREE.Mesh(pg, this.poolMat);
    this.pool.visible = false;
    this.pool.renderOrder = 6;
    scene.add(this.pool);
    // a narrow beam with a soft edge (PursuitView adds it to the scene when it can afford a light)
    this.spot = new THREE.SpotLight(0xfff1d6, 0, 160, 0.13, 0.55, 1.6);
  }

  /**
   * Position, attitude, rotors, lights and the searchlight.
   * vx/vz: its velocity (for the attitude); lx/lz: where the searchlight points; `low`: how close
   * to the ground (0..1, turns the landing light on); night 0..1; `spotOn`: the real light is in
   * the scene.
   */
  update(x: number, y: number, z: number, yaw: number, vx: number, vz: number, lx: number, lz: number, time: number, dt: number, night: number, active: boolean, spotOn: boolean, low = 0, cam?: THREE.Vector3): void {
    this.root.visible = active;
    const show = Math.max(night, this.haze * 0.7);
    this.cone.visible = active && show > 0.05;
    if (!active) {
      this.glare.visible = false;
      this.spot.intensity = 0;
      this.pool.visible = false;
      this.fresh = true;
      return;
    }
    this.root.position.set(x, y, z);
    // ── attitude from the motion: nose down to accelerate and at speed, bank into turns ──
    if (this.fresh) {
      this.fresh = false;
      this.lastVx = vx;
      this.lastVz = vz;
    }
    if (dt > 0) {
      const ax = (vx - this.lastVx) / dt;
      const az = (vz - this.lastVz) / dt;
      this.lastVx = vx;
      this.lastVz = vz;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const k = Math.min(1, dt * 2.5);
      this.aF += (Math.max(-15, Math.min(15, ax * fx + az * fz)) - this.aF) * k; // forward accel
      this.aL += (Math.max(-15, Math.min(15, ax * fz - az * fx)) - this.aL) * k; // accel to the left
      const vF = vx * fx + vz * fz;
      const wantPitch = Math.max(-0.32, Math.min(0.4, vF * 0.0045 + this.aF * 0.022));
      const wantRoll = Math.max(-0.5, Math.min(0.5, -this.aL * 0.04));
      const e = Math.min(1, dt * 2.2);
      this.pitch += (wantPitch - this.pitch) * e;
      this.roll += (wantRoll - this.roll) * e;
      // the tail swings a little behind the turns, and the whole thing wobbles in gusts
      this.sway += (Math.max(-0.12, Math.min(0.12, this.aL * 0.012)) - this.sway) * Math.min(1, dt * 1.2);
    }
    const g = 0.012 + this.gust * 0.03;
    this.root.rotation.set(0, yaw, 0, 'YXZ');
    this.body.rotation.set(this.pitch + Math.sin(time * 1.7) * g * 0.6, this.sway + Math.sin(time * 0.6) * 0.02, this.roll + Math.sin(time * 1.1 + 1.3) * g, 'YXZ');
    this.body.position.y = Math.sin(time * 0.9) * (0.15 + this.gust * 0.25);
    // ── rotors: faint blades at a calm on-screen rate (no strobing) over the blur disc ──
    this.rotor.rotation.y += dt * 4.3;
    this.disc.rotation.y += dt * 1.7;
    this.tailRotor.rotation.x += dt * 6.5;
    this.tailDisc.rotation.x += dt * 2.1;
    // ── lights ──
    this.beacon.emissiveIntensity = (time * 1.4) % 1 < 0.12 ? 14 : 0;
    this.strobe.emissiveIntensity = (time * 0.9) % 1 < 0.05 ? 40 : 0;
    const ph = (time * 2.2) % 1;
    const red = ph < 0.5;
    const blink = ph % 0.5 < 0.12 || (ph % 0.5 > 0.2 && ph % 0.5 < 0.32);
    this.flashR.emissiveIntensity = red && blink ? 22 : 0;
    this.flashB.emissiveIntensity = !red && blink ? 26 : 0;
    this.landing.emissiveIntensity = 12 * low;
    // glints: strongest at night; the strobe and beacon still catch the eye by day
    const nk = 0.25 + 0.75 * night;
    for (const g of this.glints) {
      let a = 0;
      if (g.kind === 'beacon') a = this.beacon.emissiveIntensity > 0 ? 1 : 0;
      else if (g.kind === 'strobe') a = this.strobe.emissiveIntensity > 0 ? 1.4 : 0;
      else if (g.kind === 'navR' || g.kind === 'navG') a = 0.75 * night;
      else if (g.kind === 'red') a = this.flashR.emissiveIntensity > 0 ? 1 : 0;
      else a = this.flashB.emissiveIntensity > 0 ? 1 : 0;
      g.m.opacity = Math.min(1, a * nk);
      g.s.visible = a > 0;
    }
    // ── searchlight from under the nose to where it points ──
    this.root.updateMatrixWorld(true);
    const lamp = this.lampPos.set(-0.35, -1.0, 1.6);
    this.body.localToWorld(lamp);
    const dx = lx - lamp.x;
    const dy = 0 - lamp.y;
    const dz = lz - lamp.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    this.cone.position.copy(lamp);
    const spread = 0.13;
    this.cone.scale.set(len * spread, len, len * spread);
    this.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
    // the beam shows in the dark, and more so in rain and fog
    this.coneMat.uniforms.uK.value = 0.085 * show * (1 + 1.6 * this.haze);
    this.lampMat.emissiveIntensity = 3 + 6 * Math.max(night, 0.3);
    const lit = Math.max(night, this.haze * 0.4, 0.2);
    this.spot.position.copy(lamp);
    this.spot.target.position.set(lx, 0, lz);
    this.spot.target.updateMatrixWorld();
    // 4F: when Air One drops low the beam is close, so it's held to its 30 m brightness
    // instead of burning the car under it white
    this.spot.intensity = spotOn ? 5200 * lit * Math.min(1, Math.pow(len / 30, 1.6)) : 0;
    // 4F.1: look up the beam and the lamp flares (a real searchlight is blinding head-on)
    this.glare.visible = false;
    if (cam) {
      const v = this.glareDir.set(cam.x - lamp.x, cam.y - lamp.y, cam.z - lamp.z);
      const dc = v.length() || 1;
      const k = (v.x * dx + v.y * dy + v.z * dz) / (dc * len); // 1 = straight down the beam
      const sm = (a: number, b: number, t: number) => {
        const u = Math.max(0, Math.min(1, (t - a) / (b - a)));
        return u * u * (3 - 2 * u);
      };
      const head = sm(0.95, 0.996, k);
      const g = (0.22 * sm(0.4, 0.95, k) + head) * Math.max(night, 0.25) * (spotOn || show > 0.05 ? 1 : 0);
      if (g > 0.01) {
        this.glare.visible = true;
        // a little towards you, so the nose doesn't cut the flare in half
        this.glare.position.set(lamp.x + (v.x / dc) * 1.6, lamp.y + (v.y / dc) * 1.6, lamp.z + (v.z / dc) * 1.6);
        this.glare.scale.setScalar(0.045 + 0.2 * head);
        this.glareMat.opacity = Math.min(1, g);
      }
    }
    // without a real light, a soft pool on the ground shows where the beam lands
    this.pool.visible = !spotOn && show > 0.05;
    if (this.pool.visible) {
      const r = len * spread * 1.05;
      this.pool.position.set(lx, 0.06, lz);
      this.pool.scale.set(r, 1, r);
      const k = 0.9 * show;
      this.poolMat.color.setRGB(k, k * 0.95, k * 0.84);
    }
  }
}
