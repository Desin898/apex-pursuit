// ─────────────────────────────────────────────────────────────────────────────
// Cockpit (Phase 4A): the Phantom X1's interior for the cockpit camera. An original design that
// follows the car's angular style:
// - one central seat under the bubble canopy
// - an angular dash with a cyan LED line
// - a binnacle over a digital cluster that shows live rpm, speed, gear and nitrous
// - a flat-bottomed wheel with shift lights and paddles
// - gloved hands that stay on the wheel
// - a roll hoop
// - door mirrors plus a camera-based rear-view mirror, all fed by one shared render target
// - windscreen rain with a wiper
// Built only for the player's car and attached to its sprung body, so it pitches and rolls with it.
// Car-body space: +z forward, +x left, y up from the ground.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { COCKPIT as K, VEHICLE as V } from '../config';
import { clamp, damp, lerp } from '../core/math';
import { buildCanopy } from './PhantomX1';
import { VehicleState } from './VehiclePhysics';

const CYAN = 0x4fd1d9;

function shapeZY(pts: [number, number][]): THREE.Shape {
  const sh = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y)));
  sh.closePath();
  return sh;
}
/** Extrude a profile drawn in (z, y) across the car from x = −half to +half. */
function across(pts: [number, number][], half: number, bevel = 0.006): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shapeZY(pts), { depth: half * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1 });
  g.rotateY(-Math.PI / 2); // shape x (=z) → +z, extrusion → −x
  g.translate(half, 0, 0);
  return g;
}

export class Cockpit {
  readonly root = new THREE.Group();
  /** where the driver's eyes are (the camera follows this) */
  readonly eye = new THREE.Object3D();
  /** true on the frame the wiper reaches the end of a sweep (for a light rumble) */
  wiperKick = false;

  private spin = new THREE.Group(); // turns with the steering
  private hands: THREE.Group[] = [];
  private paddles: THREE.Mesh[] = [];
  private arms: THREE.Mesh[] = [];
  private elbows = [new THREE.Vector3(-0.27, 0.56, -0.17), new THREE.Vector3(0.27, 0.56, -0.17)]; // right arm, left arm
  private shiftLeds: THREE.MeshBasicMaterial[] = [];
  private dashCanvas = document.createElement('canvas');
  private dashCtx: CanvasRenderingContext2D;
  private dashTex: THREE.CanvasTexture;
  private dashKey = '';
  private dashFrame = 0;
  private interior: THREE.MeshStandardMaterial[] = [];
  private led: THREE.MeshBasicMaterial;
  private paddleT = [0, 0];
  private lastGear = 1;
  // mirrors
  readonly mirrorTarget: THREE.WebGLRenderTarget;
  private mirrorCams: THREE.PerspectiveCamera[] = [];
  private mirrorSpots: { pos: THREE.Vector3; look: THREE.Vector3 }[] = [];
  private mirrorStatic: THREE.Texture;
  private mirrorMats: THREE.MeshBasicMaterial[] = [];
  private mirrorFrame = 0;
  // windscreen rain
  private rainMat: THREE.ShaderMaterial;
  private wipePhase = Math.PI * 1.5; // parked
  private wipePause = 0;
  private wet = 0;

  constructor() {
    this.root.name = 'cockpit';
    this.eye.position.set(0, K.eyeY, K.eyeZ);
    this.eye.rotation.set(K.eyeTilt, Math.PI, 0, 'YXZ'); // Object3D looks down −z: turn it to face +z
    this.root.add(this.eye);

    const std = (color: number, rough: number, metal = 0, side: THREE.Side = THREE.FrontSide) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, side });
      this.interior.push(m);
      return m;
    };
    const lining = std(0x15181b, 0.95, 0, THREE.BackSide);
    const pillar = std(0x0d0f11, 0.8, 0, THREE.BackSide);
    const leather = std(0x23272b, 0.78);
    const soft = std(0x17191c, 0.92);
    const carbon = std(0x101214, 0.35, 0.4);
    const metal = std(0x9aa3a8, 0.35, 0.9);
    const glove = std(0x1d2024, 0.7);
    const suit = std(0x13171a, 0.85);
    this.led = new THREE.MeshBasicMaterial({ color: CYAN });
    const add = (g: THREE.BufferGeometry, m: THREE.Material) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.receiveShadow = true;
      this.root.add(mesh);
      return mesh;
    };

    // ── Canopy lining and pillars (the outside skin is culled from in here) ──
    const can = buildCanopy();
    add(can.paint, lining);
    add(can.trim, pillar);

    // ── Tub: floor, door cards, bulkhead and roll hoop ──
    const floor = new THREE.PlaneGeometry(1.24, 1.9);
    floor.rotateX(-Math.PI / 2);
    floor.translate(0, 0.16, 0);
    add(floor, soft);
    for (const sx of [1, -1]) {
      const door = new THREE.ExtrudeGeometry(
        shapeZY([
          [-0.95, 0.16],
          [0.78, 0.16],
          [0.78, 0.64],
          [0.32, 0.72],
          [-0.2, 0.77],
          [-0.95, 0.79],
        ]),
        { depth: 0.05, bevelEnabled: false },
      );
      door.rotateY(-Math.PI / 2);
      door.translate(sx * 0.6 + (sx > 0 ? 0.05 : 0), 0, 0);
      add(door, leather);
      // carbon armrest and the cyan line along the window sill
      const rest = new THREE.BoxGeometry(0.07, 0.035, 0.7);
      rest.translate(sx * 0.565, 0.58, -0.2);
      add(rest, carbon);
      const strip = new THREE.BoxGeometry(0.006, 0.006, 0.95);
      strip.rotateX(-0.055);
      strip.translate(sx * 0.585, 0.745, -0.12);
      add(strip, this.led);
    }
    const bulk = new THREE.PlaneGeometry(1.24, 0.75);
    bulk.translate(0, 0.53, -0.92);
    add(bulk, soft);
    const hoop = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([new THREE.Vector3(0.56, 0.74, -0.86), new THREE.Vector3(0.42, 0.98, -0.86), new THREE.Vector3(0, 1.06, -0.86), new THREE.Vector3(-0.42, 0.98, -0.86), new THREE.Vector3(-0.56, 0.74, -0.86)]),
      24,
      0.024,
      8,
      false,
    );
    add(hoop, metal);
    // seat shell sides (seen in the side views)
    for (const sx of [1, -1]) {
      const side = new THREE.BoxGeometry(0.05, 0.42, 0.5);
      side.rotateX(0.32);
      side.translate(sx * 0.25, 0.48, -0.62);
      add(side, carbon);
    }

    // ── Dash: angular top, knee panel, binnacle, vents, LED line ──
    add(
      across(
        [
          [0.16, 0.5],
          [0.16, 0.69],
          [0.27, 0.742],
          [0.6, 0.705],
          [0.86, 0.64],
          [0.86, 0.42],
          [0.4, 0.4],
        ],
        0.58,
      ),
      leather,
    );
    add(across([[0.2, 0.3], [0.2, 0.5], [0.34, 0.5], [0.42, 0.3]], 0.5, 0), soft);
    // binnacle: a thin carbon hood over the screen
    add(across([[0.25, 0.843], [0.26, 0.855], [0.46, 0.855], [0.46, 0.843]], 0.155, 0.003), carbon);
    for (const sx of [1, -1]) {
      const cheek = new THREE.BoxGeometry(0.008, 0.11, 0.2);
      cheek.translate(sx * 0.152, 0.795, 0.36);
      add(cheek, carbon);
    }
    const dashLed = new THREE.BoxGeometry(1.08, 0.005, 0.005);
    dashLed.translate(0, 0.687, 0.157);
    add(dashLed, this.led);
    for (const sx of [1, -1]) {
      for (let i = 0; i < 3; i++) {
        const vent = new THREE.BoxGeometry(0.11, 0.008, 0.02);
        vent.translate(sx * 0.4, 0.62 + i * 0.018, 0.155);
        add(vent, carbon);
      }
    }
    // centre console strip with a row of toggle switches
    const cons = new THREE.BoxGeometry(0.2, 0.05, 0.16);
    cons.rotateX(-0.5);
    cons.translate(0, 0.47, 0.22);
    add(cons, carbon);
    for (let i = 0; i < 4; i++) {
      const sw = new THREE.CylinderGeometry(0.005, 0.005, 0.03, 6);
      sw.rotateX(-1.2);
      sw.translate(-0.06 + i * 0.04, 0.49, 0.2);
      add(sw, metal);
    }

    // ── Digital cluster (canvas) inside the binnacle ──
    this.dashCanvas.width = 512;
    this.dashCanvas.height = 176;
    this.dashCtx = this.dashCanvas.getContext('2d')!;
    this.dashTex = new THREE.CanvasTexture(this.dashCanvas);
    this.dashTex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.PlaneGeometry(0.27, 0.093);
    screen.rotateY(Math.PI);
    screen.rotateX(0.42);
    screen.translate(0, 0.797, 0.34);
    add(screen, new THREE.MeshBasicMaterial({ map: this.dashTex, toneMapped: false }));

    // ── Steering wheel: column, tilted plane, spinning group ──
    const wheel = new THREE.Group();
    wheel.position.set(0, K.wheelY, K.wheelZ);
    wheel.rotation.set(K.wheelTilt, Math.PI, 0); // face the driver
    this.root.add(wheel);
    const column = new THREE.CylinderGeometry(0.026, 0.034, 0.3, 10);
    column.rotateX(Math.PI / 2);
    column.translate(0, 0, -0.17);
    wheel.add(new THREE.Mesh(column, carbon));
    wheel.add(this.spin);
    const R = K.wheelRadius;
    const rimPts: THREE.Vector3[] = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      let x = Math.cos(a) * R;
      let y = Math.sin(a) * R * 0.92;
      if (y < -R * 0.62) y = -R * 0.62; // flat bottom
      if (y > R * 0.84) y = R * 0.84 + (y - R * 0.84) * 0.4; // flatter top
      x *= 1.06;
      rimPts.push(new THREE.Vector3(x, y, 0));
    }
    const rim = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts, true), 80, 0.017, 10, true);
    this.spin.add(new THREE.Mesh(rim, leather));
    // grips in carbon at the top
    const hub = new THREE.BoxGeometry(0.11, 0.075, 0.035);
    this.spin.add(new THREE.Mesh(hub, carbon));
    for (const sx of [1, -1]) {
      const spoke = new THREE.BoxGeometry(0.1, 0.03, 0.018);
      spoke.translate(sx * 0.1, -0.005, 0);
      this.spin.add(new THREE.Mesh(spoke, carbon));
    }
    const low = new THREE.BoxGeometry(0.03, 0.08, 0.016);
    low.translate(0, -0.075, 0);
    this.spin.add(new THREE.Mesh(low, carbon));
    // shift lights across the top of the hub
    for (let i = 0; i < 9; i++) {
      const m = new THREE.MeshBasicMaterial({ color: 0x111416, toneMapped: false });
      this.shiftLeds.push(m);
      const led = new THREE.BoxGeometry(0.008, 0.006, 0.004);
      led.translate(-0.04 + i * 0.01, 0.03, 0.019);
      this.spin.add(new THREE.Mesh(led, m));
    }
    // little rotary knobs on the hub
    for (const sx of [1, -1]) {
      const knob = new THREE.CylinderGeometry(0.009, 0.009, 0.01, 10);
      knob.rotateX(Math.PI / 2);
      knob.translate(sx * 0.035, -0.012, 0.02);
      this.spin.add(new THREE.Mesh(knob, metal));
    }
    // paddles behind the rim (right one = up-shift)
    for (const sx of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.05, 0.085, 0.006);
      g.translate(sx * 0.025, 0, 0);
      const p = new THREE.Mesh(g, carbon);
      p.position.set(sx * 0.1, 0.012, -0.03);
      this.spin.add(p);
      this.paddles.push(p);
    }

    // ── Hands on the rim (right at about 2:30, left at 9:30, seen from the seat) ──
    // Wheel-local axes here: x across (the wheel is turned to face you, so +x is your right),
    // +z towards you. In each hand's own frame +x points out from the wheel centre.
    for (const sx of [1, -1]) {
      const h = new THREE.Group();
      const a = Math.PI / 2 - sx * (Math.PI / 2 - 0.36);
      h.position.set(Math.cos(a) * R * 1.06, Math.sin(a) * R * 0.92, 0);
      h.rotation.z = a;
      // fingers wrapped round the rim, open towards the hub
      const grip = new THREE.TorusGeometry(0.033, 0.015, 8, 14, Math.PI * 1.5);
      grip.rotateZ(-Math.PI * 0.75);
      grip.rotateX(Math.PI / 2);
      grip.scale(1, 1.5, 1);
      h.add(new THREE.Mesh(grip, glove));
      // back of the hand on the outside, towards you
      const palm = new THREE.CapsuleGeometry(0.027, 0.045, 4, 8);
      palm.scale(1, 1, 0.75);
      palm.translate(0.022, 0, 0.026);
      h.add(new THREE.Mesh(palm, glove));
      const thumb = new THREE.CapsuleGeometry(0.01, 0.036, 4, 6);
      thumb.rotateX(0.5);
      thumb.translate(-0.016, sx * 0.018, 0.016);
      h.add(new THREE.Mesh(thumb, glove));
      const cuff = new THREE.CylinderGeometry(0.031, 0.034, 0.04, 10);
      cuff.rotateX(Math.PI / 2);
      cuff.rotateY(-0.7);
      cuff.translate(0.045, 0, 0.06);
      h.add(new THREE.Mesh(cuff, glove));
      const band = new THREE.CylinderGeometry(0.0345, 0.0345, 0.006, 10);
      band.rotateX(Math.PI / 2);
      band.rotateY(-0.7);
      band.translate(0.052, 0, 0.068);
      h.add(new THREE.Mesh(band, this.led));
      this.spin.add(h);
      this.hands.push(h);
      // forearm: a sleeve stretched between the wrist and a fixed elbow every frame
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.044, 1, 10), suit);
      this.root.add(arm);
      this.arms.push(arm);
    }

    // ── Mirrors: one render target, three views (left door, rear camera, right door) ──
    this.mirrorTarget = new THREE.WebGLRenderTarget(K.mirrorW, K.mirrorH, { type: THREE.HalfFloatType });
    this.mirrorStatic = this.staticMirror();
    const third = (i: number) => [i / 3, (i + 1) / 3];
    const mirrorMesh = (w: number, h: number, slot: number, pos: THREE.Vector3, rotY: number) => {
      const g = new THREE.PlaneGeometry(w, h);
      // flip left-right like a mirror, and pick this mirror's third of the shared target
      const [u0, u1] = third(slot);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) < 0.5 ? u1 : u0);
      // mirror glass reflects a bit less than it receives, with a faint blue tint
      const m = new THREE.MeshBasicMaterial({ map: this.mirrorTarget.texture, color: 0x9aa8b4 });
      this.mirrorMats.push(m);
      const mesh = new THREE.Mesh(g, m);
      mesh.position.copy(pos);
      mesh.rotation.y = rotY;
      this.root.add(mesh);
      return mesh;
    };
    // door mirror glasses sit on the back of the exterior mirror pods
    mirrorMesh(0.17, 0.075, 0, new THREE.Vector3(0.9, 0.9, 0.418), Math.PI - 0.12);
    mirrorMesh(0.17, 0.075, 2, new THREE.Vector3(-0.9, 0.9, 0.418), Math.PI + 0.12);
    // camera mirror hanging from the canopy, above the line of sight
    const frame = new THREE.BoxGeometry(0.14, 0.042, 0.014);
    frame.rotateX(-0.12);
    frame.translate(0, 1.025, 0.14);
    add(frame, carbon);
    const stem = new THREE.BoxGeometry(0.014, 0.04, 0.014);
    stem.translate(0, 1.06, 0.15);
    add(stem, carbon);
    const centre = mirrorMesh(0.13, 0.034, 1, new THREE.Vector3(0, 1.025, 0.132), Math.PI);
    centre.rotation.x = 0.12;
    for (let i = 0; i < 3; i++) {
      const c = new THREE.PerspectiveCamera(i === 1 ? 26 : 22, 1, 0.3, K.mirrorFar);
      this.mirrorCams.push(c);
    }
    this.mirrorSpots = [
      { pos: new THREE.Vector3(0.93, 0.92, 0.42), look: new THREE.Vector3(1.6, 0.8, -20) },
      { pos: new THREE.Vector3(0, 0.98, -2.42), look: new THREE.Vector3(0, 0.75, -40) },
      { pos: new THREE.Vector3(-0.93, 0.92, 0.42), look: new THREE.Vector3(-1.6, 0.8, -20) },
    ];

    // ── Windscreen rain and wiper: a shader on the inside of the windscreen glass ──
    const idx = can.glass.getIndex()!;
    const pos = can.glass.getAttribute('position');
    const keep: number[] = [];
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i);
      const b = idx.getX(i + 1);
      const c = idx.getX(i + 2);
      if ((pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3 > 0.2) keep.push(a, b, c);
    }
    const screenGeo = new THREE.BufferGeometry();
    screenGeo.setAttribute('position', pos);
    screenGeo.setIndex(keep);
    this.rainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: {
        uTime: { value: 0 },
        uWet: { value: 0 },
        uWipe: { value: 0 }, // wiper phase, radians
        uAmp: { value: K.wiperAmp },
        uSpeed: { value: 0 },
        uLight: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vP;
        void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uWet, uWipe, uAmp, uSpeed, uLight;
        varying vec3 vP;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        const float TAU = 6.2831853;
        void main() {
          if (uWet < 0.01) discard;
          // windscreen laid out flat: u across, v up from the wiper pivot at the bottom centre
          vec2 q = vec2(vP.x, (vP.y - 0.6) + (1.04 - vP.z) * 0.55);
          float th = atan(q.x, q.y);
          float r = length(q);
          float wiper = uAmp * sin(uWipe);
          // time (in wipe cycles) since the blade last crossed this angle
          float since = 9.0;
          if (abs(th) < uAmp) {
            float p0 = asin(clamp(th / uAmp, -1.0, 1.0));
            float now = mod(uWipe, TAU);
            float d1 = mod(now - p0, TAU);
            float d2 = mod(now - (3.14159265 - p0), TAU);
            since = min(d1, d2) / TAU;
          }
          // drops arrive at random times in each little cell; air pushes them up the glass
          vec2 g = q * vec2(38.0, 38.0);
          g.y -= since * uSpeed * 6.0;
          vec2 id = floor(g);
          vec2 f = fract(g) - 0.5;
          float h = hash(id);
          float arrive = h * 1.6 / max(uWet, 0.05);
          if (hash(id + 13.7) < 0.5) arrive = 99.0; // only some cells ever hold a drop
          float a = 0.0;
          float hl = 0.0;
          if (since * 1.1 > arrive) {
            vec2 c = (vec2(hash(id + 4.1), hash(id + 9.3)) - 0.5) * 0.5;
            vec2 d = f - c;
            d.y /= 1.0 + uSpeed * 2.5; // streaks at speed
            float rad = 0.08 + 0.14 * hash(id + 2.7);
            float k = smoothstep(rad, rad * 0.55, length(d));
            a = k * 0.28;
            hl = k * smoothstep(0.0, -rad, d.y) * smoothstep(rad * 0.2, 0.0, abs(d.x + rad * 0.3));
          }
          // a film of water between the drops in heavy rain, thinnest just behind the blade
          a += uWet * 0.05 * min(1.0, since * 3.0);
          // the blade itself
          float blade = (r < 0.56 && r > 0.04) ? smoothstep(0.012, 0.004, abs(th - wiper) * r) : 0.0;
          vec3 col = mix(vec3(0.5, 0.56, 0.6), vec3(0.95), hl) * uLight;
          col = mix(col, vec3(0.02), blade);
          float alpha = max(a, blade * 0.95);
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    const rainMesh = new THREE.Mesh(screenGeo, this.rainMat);
    rainMesh.renderOrder = 5;
    this.root.add(rainMesh);
    this.root.traverse((o) => {
      o.castShadow = false;
      o.frustumCulled = false; // always right in front of the camera
    });
    this.root.visible = false;
  }

  /** a soft grey-blue gradient for the mirrors on Low quality (no live render) */
  private staticMirror(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 32;
    const g = c.getContext('2d')!;
    const gr = g.createLinearGradient(0, 0, 0, 32);
    gr.addColorStop(0, '#3a4a55');
    gr.addColorStop(0.55, '#202a30');
    gr.addColorStop(1, '#14191c');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 32);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** Steering wheel angle in radians for a road-wheel angle (left positive). */
  static wheelAngle(steerAngle: number): number {
    return steerAngle * K.steeringRatio;
  }

  update(s: VehicleState, dt: number, time: number, night: number, rain: number, light: number, mph: boolean): void {
    // wheel, hands and paddles
    this.spin.rotation.z = -Cockpit.wheelAngle(s.steerAngle);
    if (s.gear !== this.lastGear) {
      if (s.gear > this.lastGear) this.paddleT[1] = 0.18;
      else this.paddleT[0] = 0.18;
      this.lastGear = s.gear;
    }
    for (let i = 0; i < 2; i++) {
      this.paddleT[i] = Math.max(0, this.paddleT[i] - dt);
      const k = Math.sin((this.paddleT[i] / 0.18) * Math.PI);
      this.paddles[i].rotation.x = -k * 0.22;
      // the hand on that side (right for up, left for down) pulls back on the paddle
      const hand = this.hands[1 - i];
      hand.position.z = k * 0.018;
    }
    // forearms from each wrist to its elbow
    this.root.updateMatrixWorld();
    const wrist = new THREE.Vector3();
    const mid = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 2; i++) {
      const h = this.hands[i];
      wrist.set(0.06, 0, 0.08);
      h.localToWorld(wrist);
      this.root.worldToLocal(wrist);
      const e = this.elbows[i];
      const len = wrist.distanceTo(e);
      mid.addVectors(wrist, e).multiplyScalar(0.5);
      const arm = this.arms[i];
      arm.position.copy(mid);
      arm.scale.set(1, len, 1);
      arm.quaternion.setFromUnitVectors(up, mid.subVectors(wrist, e).normalize());
    }
    // shift lights: green → amber → red, all blink at the limiter
    const rpmN = clamp((s.rpm - 4500) / (V.upshiftRpm - 4500), 0, 1);
    const lit = Math.round(rpmN * 9);
    const blink = s.rpm > V.upshiftRpm - 120 && Math.floor(time * 12) % 2 === 0;
    this.shiftLeds.forEach((m, i) => {
      const on = !blink && i < lit;
      m.color.setHex(on ? (i < 3 ? 0x3cff7a : i < 6 ? 0xffb000 : 0xff3040) : blink ? 0x2a0004 : 0x111416);
    });
    // the dash glows a little at night
    const glow = 0.002 + night * 0.022;
    for (const m of this.interior) m.emissive.setRGB(0.3 * glow, 0.8 * glow, 0.85 * glow);
    const ledK = 0.35 - night * 0.22; // dimmed at night so it doesn't dazzle
    this.led.color.setRGB(0.31 * ledK, 0.82 * ledK, 0.85 * ledK);
    // dash cluster: redraw when something changes, at most every other frame
    if (++this.dashFrame % 2 === 0) this.drawDash(s, mph);
    // windscreen rain and the wiper (it runs while it rains, and parks a moment after)
    this.wet = lerp(this.wet, rain, damp(rain > this.wet ? 0.5 : 0.25, dt));
    const before = Math.cos(this.wipePhase);
    // wiper speed follows the rain: intermittent in a light shower, normal, fast in a downpour
    const period = this.wet > 0.75 ? K.wiperFast : K.wiperPeriod;
    const step = (dt / period) * Math.PI * 2;
    const park = Math.PI * 1.5 + Math.ceil((this.wipePhase - Math.PI * 1.5) / (Math.PI * 2) - 1e-6) * Math.PI * 2;
    if (this.wet > 0.04 && this.wet < 0.35) {
      // intermittent: one sweep, rest at the end, sweep again
      if (this.wipePause > 0) this.wipePause -= dt;
      else {
        const next = this.wipePhase + step;
        if (next >= park && this.wipePhase < park) {
          this.wipePhase = park;
          this.wipePause = K.wiperPause;
        } else this.wipePhase = next;
      }
    } else if (this.wet > 0.04) this.wipePhase += step;
    else {
      // rain stopped: finish the stroke and park at one end
      this.wipePhase = Math.min(park, this.wipePhase + step);
    }
    this.wiperKick = Math.sign(before) !== Math.sign(Math.cos(this.wipePhase)) && this.wet > 0.04;
    const u = this.rainMat.uniforms;
    u.uTime.value = time;
    u.uWet.value = this.wet;
    u.uWipe.value = this.wipePhase;
    u.uSpeed.value = clamp(s.speed / 70, 0, 1);
    u.uLight.value = light;
  }

  private drawDash(s: VehicleState, mph: boolean): void {
    const speed = Math.round(Math.abs(s.speed) * (mph ? 2.23694 : 3.6));
    const gear = s.gear === -1 ? 'R' : s.gear === 0 ? 'N' : String(s.gear);
    const rpmK = Math.round(s.rpm / 100);
    const nos = Math.round(s.nitro * 40);
    const key = `${speed}|${gear}|${rpmK}|${nos}|${s.nitroActive ? 1 : 0}|${mph}`;
    if (key === this.dashKey) return;
    this.dashKey = key;
    const g = this.dashCtx;
    const W = 512;
    const H = 176;
    g.fillStyle = '#060a0c';
    g.fillRect(0, 0, W, H);
    // rpm bar along the top: segments, cyan into amber into red
    const segs = 40;
    const rpmN = clamp(s.rpm / 10000, 0, 1);
    for (let i = 0; i < segs; i++) {
      const on = i / segs < rpmN;
      const r = (i / segs) * 10000;
      g.fillStyle = !on ? '#13222a' : r >= 8000 ? '#ff3a46' : r >= 6500 ? '#ffb020' : '#4fd1d9';
      const x = 20 + i * 11.8;
      const h = 14 + (i / segs) * 12;
      g.fillRect(x, 40 - h, 9, h);
    }
    g.fillStyle = '#5d7275';
    g.font = '600 14px Outfit, system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText('RPM ×1000', 20, 62);
    // gear in the middle, speed to the right, nitrous to the left
    g.textAlign = 'center';
    g.fillStyle = s.rpm > V.upshiftRpm - 250 ? '#ff4d55' : '#eef5f5';
    g.font = '700 92px Outfit, system-ui, sans-serif';
    g.fillText(gear, W / 2, 158);
    g.fillStyle = '#4fd1d9';
    g.font = '600 64px Outfit, system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillText(String(speed), W - 26, 140);
    g.fillStyle = '#8fa5a8';
    g.font = '500 16px Outfit, system-ui, sans-serif';
    g.fillText(mph ? 'MPH' : 'KM/H', W - 26, 162);
    g.textAlign = 'left';
    g.fillStyle = '#8fa5a8';
    g.fillText('N₂O', 26, 106);
    g.fillStyle = '#13222a';
    g.fillRect(26, 116, 150, 12);
    g.fillStyle = s.nitroActive ? '#bff6ff' : s.nitro < V.nitroMinToFire ? '#ff4d55' : '#4fd1d9';
    g.fillRect(26, 116, 150 * clamp(s.nitro, 0, 1), 12);
    this.dashTex.needsUpdate = true;
  }

  /**
   * Render the three mirror views into the shared target. Medium: every other frame;
   * High / Ultra: every frame; Low: a static gradient instead.
   */
  renderMirrors(renderer: THREE.WebGLRenderer, scene: THREE.Scene, body: THREE.Object3D, quality: string): void {
    if (this.own) return;
    const live = quality !== 'low';
    for (const m of this.mirrorMats) {
      const want = live ? this.mirrorTarget.texture : this.mirrorStatic;
      if (m.map !== want) {
        m.map = want;
        m.needsUpdate = true;
      }
    }
    if (!live) return;
    // 4B.2: one of the three mirrors per frame, in turn (each one ~20 Hz on High; ~10 Hz on Medium)
    this.mirrorFrame++;
    if (quality === 'medium' && this.mirrorFrame % 2 === 1) return;
    const only = (quality === 'medium' ? this.mirrorFrame >> 1 : this.mirrorFrame) % 3;
    body.updateWorldMatrix(true, false);
    const W = K.mirrorW;
    const H = K.mirrorH;
    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    const wasVisible = this.root.visible;
    this.root.visible = false;
    const rt = this.mirrorTarget;
    rt.scissorTest = true;
    const aspects = [0.17 / 0.075, 0.13 / 0.034, 0.17 / 0.075];
    for (let i = only; i === only; i++) {
      const cam = this.mirrorCams[i];
      const spot = this.mirrorSpots[i];
      cam.position.copy(spot.pos);
      body.localToWorld(cam.position);
      const look = body.localToWorld(spot.look.clone());
      cam.up.set(0, 1, 0);
      cam.lookAt(look);
      cam.aspect = aspects[i];
      cam.updateProjectionMatrix();
      const x = Math.round((i * W) / 3);
      const w = Math.round(((i + 1) * W) / 3) - x;
      // the target's own viewport and scissor (the canvas viewport is left alone)
      rt.viewport.set(x, 0, w, H);
      rt.scissor.set(x, 0, w, H);
      renderer.setRenderTarget(rt);
      renderer.clear(true, true, false);
      renderer.render(scene, cam);
    }
    rt.scissorTest = false;
    rt.viewport.set(0, 0, W, H);
    rt.scissor.set(0, 0, W, H);
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadow;
    this.root.visible = wasVisible;
  }

  setVisible(on: boolean): void {
    this.root.visible = on;
  }

  /**
   * 4.5: an imported car brings its own interior. Then this cockpit only keeps the eye point
   * (moved to the model's driver's seat); its own dash, wheel, hands, mirrors and rain are hidden.
   */
  useOwnInterior(eye: THREE.Vector3 | null): void {
    this.own = !!eye;
    for (const c of this.root.children) if (c !== this.eye) c.visible = !eye;
    if (eye) this.eye.position.copy(eye);
    else this.eye.position.set(0, K.eyeY, K.eyeZ);
  }
  private own = false;
}
