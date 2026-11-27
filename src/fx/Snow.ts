// ─────────────────────────────────────────────────────────────────────────────
// Snow (5A) — the snow weather's falling flakes: soft discs drifting down round the camera,
// entirely on the GPU (positions wrap round the eye, as the rain does). Flakes close to the lens
// are big and blurred, far ones small; they tumble a little on the wind.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mainOnly } from '../core/layers';

export class Snow {
  readonly points: THREE.Points;
  private u = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uR: { value: 34 }, uH: { value: 26 }, uAmt: { value: 0 }, uLight: { value: new THREE.Color(1, 1, 1) }, uScale: { value: 600 } };
  private max: number;

  constructor(scene: THREE.Scene, max = 9000) {
    this.max = max;
    const pos = new Float32Array(max * 3);
    const ph = new Float32Array(max);
    let s = 12345;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < max; i++) {
      pos[i * 3] = (r() * 2 - 1) * 34;
      pos[i * 3 + 1] = r() * 26;
      pos[i * 3 + 2] = (r() * 2 - 1) * 34;
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
        uniform float uTime, uR, uH, uScale;
        uniform vec3 uCam;
        varying float vA;
        void main() {
          vec3 p = position;
          float t = uTime + aPh;
          float fall = 1.1 + fract(aPh * 7.13) * 0.9;
          p.y -= t * fall;
          p.x += t * 0.9 + sin(t * 0.8 + aPh) * 0.9;
          p.z += sin(t * 0.6 + aPh * 1.7) * 0.9;
          p.xz = mod(p.xz - uCam.xz + uR, 2.0 * uR) - uR + uCam.xz;
          p.y = mod(p.y - uCam.y + 8.0, uH) - 8.0 + uCam.y;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = max(0.3, -mv.z);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uScale * 0.045 / d, 1.0, 26.0);
          vA = smoothstep(0.3, 1.6, d) * (1.0 - smoothstep(uR * 0.55, uR, length(p.xz - uCam.xz)));
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAmt;
        uniform vec3 uLight;
        varying float vA;
        void main() {
          float e = length(gl_PointCoord - 0.5);
          float a = (1.0 - smoothstep(0.15, 0.5, e)) * vA * 0.85;
          if (a < 0.02) discard;
          gl_FragColor = vec4(uLight, a);
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.renderOrder = 9;
    this.points.name = 'snow';
    mainOnly(this.points);
    scene.add(this.points);
  }

  /** amount 0..1 (0 = off); light: how bright the flakes look (dark at night) */
  configure(amount: number, light: number, quality: 'low' | 'medium' | 'high' | 'ultra'): void {
    this.u.uAmt.value = amount;
    this.u.uLight.value.setScalar(light);
    const n = Math.floor(this.max * amount * { low: 0.25, medium: 0.5, high: 0.8, ultra: 1 }[quality]);
    this.points.geometry.setDrawRange(0, n);
    this.points.visible = n > 0;
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.u.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  update(time: number, cam: THREE.Vector3): void {
    if (!this.points.visible) return;
    this.u.uTime.value = time;
    this.u.uCam.value.copy(cam);
  }
}
