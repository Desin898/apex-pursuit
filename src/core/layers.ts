// Render layers (4B.2). Layer 0 is everything. Small details, particles, rain and decals that
// lie on the road are moved to layer 2: the main camera sees layer 2 too, but the extra passes
// (wet-road mirror, paint probe, cockpit and hood mirrors) only draw layer 0, which saves a
// lot of draw calls where nobody would notice the difference.
import type * as THREE from 'three';

export const DETAIL_LAYER = 2;

/** Mark an object (and everything under it) as main-camera-only detail. */
export function mainOnly(o: THREE.Object3D): void {
  o.traverse((c) => c.layers.set(DETAIL_LAYER));
}
