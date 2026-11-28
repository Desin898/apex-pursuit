// ─────────────────────────────────────────────────────────────────────────────
// Snow (5A) — the snow weather's falling flakes: soft discs drifting down round the camera,
// entirely on the GPU (positions wrap round the eye, as the rain does). Flakes close to the lens
// are big and blurred, far ones small; they tumble a little on the wind.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mainOnly } from '../core/layers';

export class Snow {
  readonly points: THREE.Points;
  private u = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uR: { value: 34 }, uH: { value: 26 }, uAmt: { value: 0 }, uLight: { value: new THREE.Color(1, 1, 1) }, uScale: { value: 600 }, uGust: { value: 0 } };
  private max: number;

  constructor(scene: THREE.Scene, max = 13000) {
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
        uniform float uTime, uR, uH, uScale, uGust;
        uniform vec3 uCam;
        varying float vA;
        varying float vSoft;
        varying float vSpark;
        void main() {
          vec3 p = position;
          float t = uTime + aPh;
          float fall = 1.1 + fract(aPh * 7.13) * 0.9;
          // 5C: up on the pass the wind drives the snow sideways (spindrift), low over the ground
          p.y -= t * fall * (1.0 - 0.55 * uGust);
          p.x += t * (0.9 + 11.0 * uGust) + sin(t * 0.8 + aPh) * 0.9;
          p.z += sin(t * 0.6 + aPh * 1.7) * 0.9;
          // 5D: each flake spirals a little as it falls
          p.xz += vec2(cos(t * 2.1 + aPh * 3.0), sin(t * 2.1 + aPh * 3.0)) * 0.12 * (0.5 + fract(aPh * 5.3));
          p.xz = mod(p.xz - uCam.xz + uR, 2.0 * uR) - uR + uCam.xz;
          p.y = mod(p.y - uCam.y + 8.0, uH) - 8.0 + uCam.y;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = max(0.3, -mv.z);
          gl_Position = projectionMatrix * mv;
          // 5D: flakes of different sizes; the ones right in front of the lens are big, soft and
          // out of focus, the far ones fine points; a few catch the light and sparkle
          float sz = 0.55 + 1.15 * fract(aPh * 3.71) * fract(aPh * 1.37 + 0.3);
          float nearK = 1.0 - smoothstep(0.6, 3.0, d);
          gl_PointSize = clamp(uScale * 0.045 * sz * (1.0 + nearK * 1.6) / d, 1.0, 44.0);
          vA = smoothstep(0.25, 1.2, d) * (1.0 - smoothstep(uR * 0.55, uR, length(p.xz - uCam.xz))) * (1.0 - nearK * 0.55);
          vSoft = nearK;
          vSpark = step(0.93, fract(aPh * 11.3)) * (0.6 + 0.4 * sin(t * 9.0 + aPh * 5.0));
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAmt;
        uniform vec3 uLight;
        varying float vA;
        varying float vSoft;
        varying float vSpark;
        void main() {
          float e = length(gl_PointCoord - 0.5);
          // a crisp flake with a soft edge; out of focus near the lens (a flat, faint disc)
          float a = mix(1.0 - smoothstep(0.12, 0.5, e), (1.0 - smoothstep(0.38, 0.5, e)) * 0.55, vSoft) * vA * 0.85;
          if (a < 0.02) discard;
          gl_FragColor = vec4(uLight * (1.0 + vSpark * 0.8), a);
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

  /** 5C: how windy it is on the high ground (0 off: the Proving Grounds, which has no pass) */
  gust = 0;

  setViewport(heightPx: number, fovDeg: number): void {
    this.u.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  update(time: number, cam: THREE.Vector3): void {
    if (!this.points.visible) return;
    // 5C: gusts above ~110 m (the high pass)
    this.u.uGust.value = Math.min(1, Math.max(0, (cam.y - 105) / 35)) * this.gust;
    this.u.uTime.value = time;
    this.u.uCam.value.copy(cam);
  }
}
