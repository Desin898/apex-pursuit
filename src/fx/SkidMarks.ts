// Tyre marks: a ring buffer of quads laid on the ground behind any wheel that is sliding.
import * as THREE from 'three';

const MAX_QUADS = 5200;

export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private pos = new Float32Array(MAX_QUADS * 4 * 3);
  private alpha = new Float32Array(MAX_QUADS * 4);
  private head = 0;
  // one slot per wheel per car (slot = car index × 4 + wheel)
  private last: ({ x: number; y: number; z: number; lx: number; lz: number; a: number } | null)[] = [];

  constructor(scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array(MAX_QUADS * 6);
    for (let q = 0; q < MAX_QUADS; q++) idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2], q * 6);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -8,
      polygonOffsetUnits: -8,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute float aAlpha; varying float vA;
        void main() { vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() { gl_FragColor = vec4(0.015, 0.015, 0.018, vA); }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
  }

  /**
   * Feed one wheel's contact patch. `lx,lz` is the car's left axis (sets mark width direction),
   * `intensity` 0 ends the current mark.
   */
  add(wheel: number, x: number, y: number, z: number, lx: number, lz: number, halfWidth: number, intensity: number): void {
    const prev = this.last[wheel];
    if (intensity < 0.06) {
      this.last[wheel] = null;
      return;
    }
    const a = Math.min(0.78, intensity * 0.85);
    if (!prev) {
      this.last[wheel] = { x, y, z, lx: lx * halfWidth, lz: lz * halfWidth, a };
      return;
    }
    const d = Math.hypot(x - prev.x, z - prev.z);
    if (d < 0.35) return;
    if (d > 6) {
      this.last[wheel] = { x, y, z, lx: lx * halfWidth, lz: lz * halfWidth, a };
      return;
    }
    const q = this.head;
    this.head = (this.head + 1) % MAX_QUADS;
    const o = q * 12;
    const yy = y + 0.012;
    const p = this.pos;
    p[o] = prev.x + prev.lx;
    p[o + 1] = prev.y + 0.012;
    p[o + 2] = prev.z + prev.lz;
    p[o + 3] = prev.x - prev.lx;
    p[o + 4] = prev.y + 0.012;
    p[o + 5] = prev.z - prev.lz;
    p[o + 6] = x + lx * halfWidth;
    p[o + 7] = yy;
    p[o + 8] = z + lz * halfWidth;
    p[o + 9] = x - lx * halfWidth;
    p[o + 10] = yy;
    p[o + 11] = z - lz * halfWidth;
    this.alpha[q * 4] = this.alpha[q * 4 + 1] = prev.a;
    this.alpha[q * 4 + 2] = this.alpha[q * 4 + 3] = a;
    this.last[wheel] = { x, y, z, lx: lx * halfWidth, lz: lz * halfWidth, a };
    const g = this.mesh.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.alpha.fill(0);
    this.pos.fill(0);
    this.last = [];
    (this.mesh.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    (this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
