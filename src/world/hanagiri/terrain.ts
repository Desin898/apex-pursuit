// ─────────────────────────────────────────────────────────────────────────────
// Hanagiri Pass terrain (5A) — the height field the mountain is built on, decoded once.
// 4 m cells; the road is carved in already (cut and fill), and the road surface itself is
// computed exactly from the lap's centre line (see WorldData.heightAt), so the field only has to
// carry the land. No three.js here: the physics tests load it in node.
// ─────────────────────────────────────────────────────────────────────────────
import { unzlibSync } from 'three/examples/jsm/libs/fflate.module.js';
import { HANAGIRI_HF, HANAGIRI_HF_DATA } from './data';

export class HeightField {
  readonly h: Float32Array;
  constructor(
    readonly x0: number,
    readonly z0: number,
    readonly cell: number,
    readonly nx: number,
    readonly nz: number,
    h: Float32Array,
  ) {
    this.h = h;
  }

  /** Bilinear height at x, z (clamped at the edges). */
  at(x: number, z: number): number {
    let fx = (x - this.x0) / this.cell;
    let fz = (z - this.z0) / this.cell;
    const mx = this.nx - 1.001;
    const mz = this.nz - 1.001;
    fx = fx < 0 ? 0 : fx > mx ? mx : fx;
    fz = fz < 0 ? 0 : fz > mz ? mz : fz;
    const ix = fx | 0;
    const iz = fz | 0;
    const tx = fx - ix;
    const tz = fz - iz;
    const i = iz * this.nx + ix;
    const h = this.h;
    const a = h[i] + (h[i + 1] - h[i]) * tx;
    const b = h[i + this.nx] + (h[i + this.nx + 1] - h[i + this.nx]) * tx;
    return a + (b - a) * tz;
  }

  /** True when x, z lies on the field (the land beyond it is only scenery). */
  contains(x: number, z: number): boolean {
    return x >= this.x0 && z >= this.z0 && x <= this.x0 + (this.nx - 1) * this.cell && z <= this.z0 + (this.nz - 1) * this.cell;
  }
}

let cached: HeightField | null = null;

function b64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The decoded height field (≈ 600 k cells; decoded on first use, about 30 ms). */
export function hanagiriField(): HeightField {
  if (cached) return cached;
  const H = HANAGIRI_HF;
  const raw = unzlibSync(b64(HANAGIRI_HF_DATA));
  const d = new Uint16Array(raw.buffer, raw.byteOffset, H.nx * H.nz);
  const h = new Float32Array(H.nx * H.nz);
  for (let z = 0; z < H.nz; z++) {
    let q = 0;
    const row = z * H.nx;
    for (let x = 0; x < H.nx; x++) {
      q = (q + d[row + x]) & 0xffff; // row deltas, wrapped
      h[row + x] = H.base + q * H.step;
    }
  }
  cached = new HeightField(H.x0, H.z0, H.cell, H.nx, H.nz, h);
  return cached;
}
