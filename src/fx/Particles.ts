// Pooled point-sprite particles: tyre smoke, grass dust, collision sparks. One draw call each
// for the soft (alpha-blended) and bright (additive) pools.
import * as THREE from 'three';

const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  varying vec4 vColor;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
/**
 * Soft particles are lit: scene ambient, plus up to eight point glows (tail lights, brake lights,
 * police light bars) that colour the smoke they sit in — red tail-light glow through a burnout.
 */
const VERT_SOFT = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  varying vec4 vColor;
  uniform float uScale;
  uniform vec3 uAmb;
  uniform vec3 uGlowPos[8];
  uniform vec3 uGlowCol[8];
  void main() {
    vec3 lit = uAmb;
    for (int i = 0; i < 8; i++) {
      vec3 d = position - uGlowPos[i];
      lit += uGlowCol[i] / (1.0 + dot(d, d) * 0.55);
    }
    vColor = vec4(aColor.rgb * lit, aColor.a);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG_SOFT = /* glsl */ `
  varying vec4 vColor;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    float a = smoothstep(1.0, 0.15, d);
    if (a * vColor.a < 0.004) discard;
    gl_FragColor = vec4(vColor.rgb, a * vColor.a);
  }`;
const FRAG_SPARK = /* glsl */ `
  varying vec4 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(max(0.0, 1.0 - d), 2.0);
    gl_FragColor = vec4(max(vColor.rgb * a * vColor.a, 0.0), 1.0);
  }`;

class Pool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size0: Float32Array;
  private grow: Float32Array;
  private alpha0: Float32Array;
  private rgb: Float32Array;
  private head = 0;
  private mat: THREE.ShaderMaterial;

  constructor(private n: number, additive: boolean, private gravity: number, private dragK: number) {
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n).fill(1);
    this.size0 = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.alpha0 = new Float32Array(n);
    this.rgb = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: additive
        ? { uScale: { value: 600 } }
        : {
            uScale: { value: 600 },
            uAmb: { value: new THREE.Color(1, 1, 1) },
            uGlowPos: { value: Array.from({ length: 8 }, () => new THREE.Vector3(0, -999, 0)) },
            uGlowCol: { value: Array.from({ length: 8 }, () => new THREE.Color(0, 0, 0)) },
          },
      vertexShader: additive ? VERT : VERT_SOFT,
      fragmentShader: additive ? FRAG_SPARK : FRAG_SOFT,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  get uniforms(): Record<string, THREE.IUniform> {
    return this.mat.uniforms;
  }
  setViewport(heightPx: number, fovDeg: number): void {
    this.mat.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, r: number, g: number, b: number, a: number): void {
    const i = this.head;
    this.head = (this.head + 1) % this.n;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size;
    this.grow[i] = grow;
    this.alpha0[i] = a;
    this.rgb[i * 3] = r;
    this.rgb[i * 3 + 1] = g;
    this.rgb[i * 3 + 2] = b;
  }

  update(dt: number): void {
    const drag = Math.max(0, 1 - this.dragK * dt);
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        this.col[i * 4 + 3] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      this.vel[i * 3 + 1] -= this.gravity * dt;
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.gravity > 0 && this.pos[i * 3 + 1] < 0.02) {
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3 + 1] *= -0.4;
      }
      this.size[i] = this.size0[i] + this.grow[i] * t;
      // fade in quickly, fade out slowly
      const fade = Math.min(1, t * 8) * (1 - t) * (1 - t);
      this.col[i * 4] = this.rgb[i * 3];
      this.col[i * 4 + 1] = this.rgb[i * 3 + 1];
      this.col[i * 4 + 2] = this.rgb[i * 3 + 2];
      this.col[i * 4 + 3] = this.alpha0[i] * (this.gravity > 0 ? 1 - t : fade);
    }
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class Particles {
  private soft = new Pool(2200, false, -0.9, 1.6); // smoke rises (negative gravity) and slows
  /** tyre smoke density by graphics preset (thicker on High and Ultra) */
  smokeScale = 1;
  private bright = new Pool(260, true, 9.8, 0.4); // sparks fall and bounce
  /** rain spray: thrown up off the tyres, hangs as mist and settles (4B) */
  private mist = new Pool(3200, false, 1.1, 1.35);
  /** the point clouds (for render-layer setup) */
  objects(): THREE.Object3D[] {
    return [this.soft.points, this.bright.points, this.mist.points];
  }
  /** spray density by graphics preset */
  sprayScale = 1;
  private seed = 1;

  constructor(scene: THREE.Scene) {
    scene.add(this.soft.points, this.bright.points, this.mist.points);
    // the mist shares the smoke's light (lamps, tail lights, police bars)
    const su = this.soft.uniforms;
    const mu = this.mist.uniforms;
    mu.uAmb = su.uAmb;
    mu.uGlowPos = su.uGlowPos;
    mu.uGlowCol = su.uGlowCol;
  }
  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }
  setViewport(heightPx: number, fovDeg: number): void {
    this.soft.setViewport(heightPx, fovDeg);
    this.bright.setViewport(heightPx, fovDeg);
    this.mist.setViewport(heightPx, fovDeg);
  }

  /** Warm-lit tyre smoke. `amount` 0..1 scales density and opacity. */
  smoke(x: number, y: number, z: number, vx: number, vz: number, amount: number): void {
    const r = () => this.rnd() - 0.5;
    const k = this.smokeScale;
    // thick, slow-rising clouds that spread and linger (longer and bigger on the higher presets)
    this.soft.emit(x + r() * 0.3, y + 0.1, z + r() * 0.3, vx * 0.25 + r() * 1.4, 0.4 + this.rnd() * 0.8, vz * 0.25 + r() * 1.4, (1.0 + this.rnd() * 1.1) * (0.8 + 0.25 * k), 0.6 * (0.85 + 0.15 * k), (2.8 + this.rnd() * 1.8) * (0.8 + 0.25 * k), 0.86, 0.84, 0.82, Math.min(0.75, (0.16 + 0.28 * amount) * (0.8 + 0.25 * k)));
  }

  /** Scene light on smoke and spray: ambient colour and point glows (xyz + colour). */
  setLighting(amb: THREE.Color, glows: { x: number; y: number; z: number; r: number; g: number; b: number }[]): void {
    const u = this.soft.uniforms;
    (u.uAmb.value as THREE.Color).copy(amb);
    const pos = u.uGlowPos.value as THREE.Vector3[];
    const col = u.uGlowCol.value as THREE.Color[];
    for (let i = 0; i < 8; i++) {
      const g = glows[i];
      if (g) {
        pos[i].set(g.x, g.y, g.z);
        col[i].setRGB(g.r, g.g, g.b);
      } else col[i].setRGB(0, 0, 0);
    }
  }
  dust(x: number, y: number, z: number, vx: number, vz: number, amount: number): void {
    const r = () => this.rnd() - 0.5;
    this.soft.emit(x + r() * 0.4, y + 0.1, z + r() * 0.4, vx * 0.35 + r() * 2, 0.8 + this.rnd() * 1.4, vz * 0.35 + r() * 2, 0.8 + this.rnd() * 0.8, 0.7, 2.4 + this.rnd() * 1.5, 0.62, 0.5, 0.33, 0.2 + 0.25 * amount);
  }
  /**
   * Rain spray off a tyre on a wet road (4B): a rooster tail that is thrown up and back, spreads
   * into mist, hangs for a second or two and settles. Lit by the scene (tail lights glow red in
   * it). `amount` 0..1 (speed); `front`: the thinner mist off a front tyre.
   */
  spray(x: number, y: number, z: number, vx: number, vz: number, amount: number, night: boolean, front = false): void {
    const r = () => this.rnd() - 0.5;
    const c = night ? 0.8 : 0.9;
    const k = front ? 0.45 : 1;
    // most of the water keeps much of the car's speed, so it trails just behind the wheel
    const carry = 0.62 + this.rnd() * 0.2;
    this.mist.emit(
      x + r() * 0.3,
      y + 0.12,
      z + r() * 0.3,
      vx * carry + r() * 3.2,
      (1.4 + this.rnd() * 3.2) * (0.5 + 0.5 * amount) * k,
      vz * carry + r() * 3.2,
      (0.9 + this.rnd() * 0.9) * (0.7 + 0.3 * amount),
      0.5 + this.rnd() * 0.35,
      (2.4 + this.rnd() * 3.2) * (0.6 + 0.4 * amount) * k,
      c,
      c * 1.02,
      c * 1.05,
      (0.08 + 0.22 * amount) * k,
    );
  }
  /** Nitrous purge haze behind the exhausts. */
  haze(x: number, y: number, z: number, vx: number, vz: number): void {
    const r = () => this.rnd() - 0.5;
    this.soft.emit(x + r() * 0.2, y, z + r() * 0.2, vx + r(), 0.2 + this.rnd() * 0.4, vz + r(), 0.35 + this.rnd() * 0.25, 0.3, 1.4, 0.55, 0.72, 1.0, 0.22);
  }
  sparks(x: number, y: number, z: number, nx: number, nz: number, vx: number, vz: number, count: number): void {
    const r = () => this.rnd() - 0.5;
    for (let i = 0; i < count; i++) {
      const sp = 3 + this.rnd() * 9;
      this.bright.emit(x, y + r() * 0.5, z, vx * 0.55 + nx * sp + r() * 6, 1 + this.rnd() * 5, vz * 0.55 + nz * sp + r() * 6, 0.35 + this.rnd() * 0.6, 0.11 + this.rnd() * 0.1, -0.06, 1.0, 0.72 + this.rnd() * 0.2, 0.3, 2.6);
    }
  }
  update(dt: number): void {
    this.soft.update(dt);
    this.bright.update(dt);
    this.mist.update(dt);
  }
}
