// ─────────────────────────────────────────────────────────────────────────────
// StaticBatch — performance pass (Phase 3D). The scenery is built from hundreds of small meshes
// (stands, pit buildings, walls, signs, posts…). Meshes that never move and share a material are
// merged per 160 m cell of the map, so one draw call draws many pieces while frustum culling still
// skips the cells behind the camera. Every extra view (mirror, paint probe, shadow, AO) benefits.
// Anything that moves or changes is left alone: cars, police, props, flagged groups
// (userData.noBake / noBatch), instanced meshes, transparent and shader materials.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const CELL = 160;

export function staticBatch(scene: THREE.Scene): { before: number; after: number } {
  scene.updateMatrixWorld(true);
  const groups = new Map<string, { mat: THREE.Material; meshes: THREE.Mesh[] }>();
  let before = 0;
  const skip = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.noBake || p.userData.noBatch) return true;
    return false;
  };
  const sphere = new THREE.Sphere();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    before++;
    const mat = m.material as THREE.Material;
    if (Array.isArray(m.material) || !mat || mat.transparent || !m.frustumCulled || !m.visible) return;
    if (!((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial || (mat as THREE.MeshBasicMaterial).isMeshBasicMaterial || (mat as THREE.MeshLambertMaterial).isMeshLambertMaterial)) return;
    if (m.geometry.morphAttributes && Object.keys(m.geometry.morphAttributes).length) return;
    if (skip(m)) return;
    const g = m.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    sphere.copy(g.boundingSphere!).applyMatrix4(m.matrixWorld);
    if (sphere.radius > CELL * 2) return; // the ground, the road: already one piece each
    const attrs = Object.keys(g.attributes).sort().join(',');
    const key = [mat.uuid, m.castShadow ? 1 : 0, m.receiveShadow ? 1 : 0, m.renderOrder, attrs, g.index ? 1 : 0, Math.floor(sphere.center.x / CELL), Math.floor(sphere.center.z / CELL)].join('|');
    let e = groups.get(key);
    if (!e) groups.set(key, (e = { mat, meshes: [] }));
    e.meshes.push(m);
  });
  let merged = 0;
  for (const { mat, meshes } of groups.values()) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => {
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      return g;
    });
    const out = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!out) continue;
    const mesh = new THREE.Mesh(out, mat);
    const ref = meshes[0];
    mesh.castShadow = ref.castShadow;
    mesh.receiveShadow = ref.receiveShadow;
    mesh.renderOrder = ref.renderOrder;
    mesh.name = `batch:${meshes.length}`;
    scene.add(mesh);
    for (const m of meshes) m.removeFromParent();
    merged += meshes.length - 1;
  }
  return { before, after: before - merged };
}
