// ─────────────────────────────────────────────────────────────────────────────
// Rain — falling streaks and splashes around the camera, entirely on the GPU (4B rework).
// Each drop is one short line segment. Positions are fixed random points in a box; the vertex
// shader moves them down (with a little gusting wind) and wraps them into a box that follows
// the camera, so the rain never runs out and costs one draw call.
// What makes it read as rain rather than a particle effect:
// - Streaks are short. Their length follows the drop's motion relative to the camera, but is
//   capped, so at speed they never fan out from the middle of the screen.
// - They are lit. A drop is nearly invisible in the dark and bright where it passes through a
//   street lamp, a headlight, a tail light or a police bar (the same lights the smoke uses).
// - They fade out close to the lens, so nothing smears across the screen.
// Splashes: small rings that flash on the road round the camera, lit the same way.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { RAIN as R } from '../config';

const BOX = new THREE.Vector3(56, 30, 56);
const LIGHTS = 12;

const LIGHTING = /* glsl */ `
  uniform vec3 uAmb;
  uniform vec4 uLightPos[${LIGHTS}]; // xyz + falloff
  uniform vec3 uLightCol[${LIGHTS}];
  vec3 lightAt(vec3 p) {
    vec3 c = uAmb;
    for (int i = 0; i < ${LIGHTS}; i++) {
      vec3 d = p - uLightPos[i].xyz;
      c += uLightCol[i] / (1.0 + dot(d, d) * uLightPos[i].w);
    }
    return c;
  }`;

export class Rain {
  readonly lines: THREE.LineSegments;
  readonly splashes: THREE.Points;
  private mat: THREE.ShaderMaterial;
  private splashMat: THREE.ShaderMaterial;
  private count = 0;
  private lastTime = 0;
  private fall = new THREE.Vector3();
  private lights = { amb: new THREE.Color(), pos: [] as THREE.Vector4[], col: [] as THREE.Color[] };

  constructor(scene: THREE.Scene, private maxDrops = 16000, private maxSplash = 900) {
    for (let i = 0; i < LIGHTS; i++) {
      this.lights.pos.push(new THREE.Vector4(0, -999, 0, 1));
      this.lights.col.push(new THREE.Color(0, 0, 0));
    }
    const pos = new Float32Array(maxDrops * 2 * 3);
    const end = new Float32Array(maxDrops * 2);
    let seed = 99;
    const r = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < maxDrops; i++) {
      const x = r() * BOX.x;
      const y = r() * BOX.y;
      const z = r() * BOX.z;
      for (let k = 0; k < 2; k++) {
        pos.set([x, y, z], (i * 2 + k) * 3);
        end[i * 2 + k] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const lightU = {
      uAmb: { value: this.lights.amb },
      uLightPos: { value: this.lights.pos },
      uLightCol: { value: this.lights.col },
    };
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        ...lightU,
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uOff: { value: new THREE.Vector3() }, // how far the rain has fallen (and drifted) so far
        uRel: { value: new THREE.Vector3(0, -R.fallSpeed, 0) },
        uBox: { value: BOX.clone() },
        uExposure: { value: R.exposure },
        uMaxLen: { value: R.maxStreak },
        uNear: { value: R.nearFade },
        uOpacity: { value: 0.5 },
      },
      vertexShader: /* glsl */ `
        attribute float aEnd;
        uniform float uTime, uExposure, uMaxLen, uNear;
        uniform vec3 uCam, uOff, uRel, uBox;
        varying vec3 vCol;
        varying float vFade;
        ${LIGHTING}
        float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        void main() {
          vec3 p = position + uOff;
          p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
          // the streak: drop motion relative to the camera over one "exposure", capped
          vec3 rel = uRel * uExposure;
          float L = length(rel);
          if (L > uMaxLen) rel *= uMaxLen / L;
          p -= rel * aEnd;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = length(p - uCam);
          // gusts: patches of heavier and lighter rain drift through
          float gust = 0.55 + 0.45 * sin(position.x * 0.21 + uTime * 0.7) * sin(position.z * 0.17 - uTime * 0.5);
          vFade = smoothstep(uBox.x * 0.5, uBox.x * 0.25, d) * smoothstep(uNear, uNear + 2.5, d) * mix(1.0, 0.15, aEnd) * gust;
          vCol = lightAt(p);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vCol;
        varying float vFade;
        void main() { gl_FragColor = vec4(vCol * uOpacity * vFade, 1.0); }`,
    });
    this.lines = new THREE.LineSegments(g, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 8;
    this.lines.visible = false;
    scene.add(this.lines);

    // splashes on the road: each point re-rolls its spot every cycle, in a disc round the camera
    const sp = new Float32Array(maxSplash * 3);
    for (let i = 0; i < maxSplash; i++) sp.set([r(), r(), r()], i * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.splashMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        ...lightU,
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uGround: { value: 0 },
        uRadius: { value: R.splashRadius },
        uScale: { value: 600 },
        uOpacity: { value: 0.5 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime, uGround, uRadius, uScale;
        uniform vec3 uCam;
        varying vec3 vCol;
        varying float vT;
        ${LIGHTING}
        float hash(float n) { return fract(sin(n) * 43758.5453); }
        void main() {
          float period = 0.32 + position.z * 0.25;
          float t = uTime / period + position.x * 7.0;
          float cyc = floor(t);
          vT = fract(t);
          float a = hash(cyc * 1.7 + position.y * 91.0) * 6.2831;
          float rr = sqrt(hash(cyc * 3.1 + position.x * 57.0)) * uRadius;
          vec3 p = vec3(uCam.x + cos(a) * rr, uGround + 0.03, uCam.z + sin(a) * rr);
          vCol = lightAt(p + vec3(0.0, 0.4, 0.0));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (0.04 + 0.1 * vT) * uScale / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vCol;
        varying float vT;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          q.y *= 2.4; // seen at a grazing angle the ring is flat
          float r = length(q) * 2.0;
          float ring = smoothstep(0.25, 0.0, abs(r - mix(0.2, 0.95, vT)));
          float a = ring * (1.0 - vT) * uOpacity;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vCol * a, 1.0);
        }`,
    });
    this.splashes = new THREE.Points(sg, this.splashMat);
    this.splashes.frustumCulled = false;
    this.splashes.renderOrder = 7;
    this.splashes.visible = false;
    scene.add(this.splashes);
  }

  /** drops: how many streaks (0 hides the rain); intensity 0..1; splashes per preset */
  configure(drops: number, intensity: number, night: boolean, splashes = 0): void {
    this.count = Math.min(this.maxDrops, Math.round(drops * intensity));
    this.lines.visible = this.count > 0;
    this.lines.geometry.setDrawRange(0, this.count * 2);
    // heavier rain: more drops, brighter and longer streaks (still capped)
    const k = Math.min(1, intensity);
    this.mat.uniforms.uOpacity.value = (night ? R.opacityNight : R.opacityDay) * (0.7 + 0.6 * k);
    this.mat.uniforms.uMaxLen.value = R.maxStreak + R.maxStreakHeavy * k;
    this.mat.uniforms.uExposure.value = R.exposure * (1 + 0.6 * k);
    const ns = Math.min(this.maxSplash, Math.round(splashes * intensity));
    this.splashes.visible = ns > 0;
    this.splashes.geometry.setDrawRange(0, ns);
    this.splashMat.uniforms.uOpacity.value = night ? 0.3 : 0.18;
  }

  /**
   * The light the rain shows up in: an ambient level (sky) and up to 12 point lights
   * (street lamps, car lights, police bars). `falloff`: 1 / metres² roughly; lamps reach far.
   */
  setLights(amb: THREE.Color, lights: { x: number; y: number; z: number; r: number; g: number; b: number; falloff: number }[]): void {
    this.lights.amb.copy(amb);
    for (let i = 0; i < LIGHTS; i++) {
      const l = lights[i];
      if (l) {
        this.lights.pos[i].set(l.x, l.y, l.z, l.falloff);
        this.lights.col[i].setRGB(l.r, l.g, l.b);
      } else this.lights.col[i].setRGB(0, 0, 0);
    }
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.splashMat.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  update(time: number, cam: THREE.Vector3, camVel: THREE.Vector3, ground: number): void {
    if (!this.lines.visible) return;
    const u = this.mat.uniforms;
    const t = time % 600;
    u.uTime.value = t;
    (u.uCam.value as THREE.Vector3).copy(cam);
    // wind that comes and goes; the fall is integrated so a change of wind never jumps the drops
    const dt = Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const gust = Math.sin(t * 0.13) * 0.6 + Math.sin(t * 0.41 + 1.3) * 0.4;
    const fall = this.fall.set(R.wind * (0.6 + 0.6 * gust), -R.fallSpeed, R.wind * 0.4 * gust);
    const off = u.uOff.value as THREE.Vector3;
    off.addScaledVector(fall, dt);
    // keep it small (the box wraps it anyway) so float precision never runs out
    off.set(off.x % BOX.x, off.y % BOX.y, off.z % BOX.z);
    (u.uRel.value as THREE.Vector3).copy(fall).sub(camVel);
    const su = this.splashMat.uniforms;
    su.uTime.value = t;
    (su.uCam.value as THREE.Vector3).copy(cam);
    su.uGround.value = ground;
  }
}
