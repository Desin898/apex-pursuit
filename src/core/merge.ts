// Merge static meshes into one per material, to cut draw calls (4B.2).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Merge the static meshes of a group into one mesh per material (4B.2: police cars and the pursuit
 * breakers). Meshes in `keep` (dented panels) stay separate.
 */
export function mergeByMaterial(g: THREE.Group, keep: THREE.Mesh[]): void {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const shadow = new Map<THREE.Material, boolean>();
  const remove: THREE.Object3D[] = [];
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || keep.includes(m) || Array.isArray(m.material)) return;
    let geo = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (geo.index) geo = geo.toNonIndexed();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    geo.morphAttributes = {};
    const list = byMat.get(m.material) ?? [];
    list.push(geo);
    byMat.set(m.material, list);
    if (m.castShadow) shadow.set(m.material, true);
    remove.push(m);
  });
  for (const o of remove) o.parent?.remove(o);
  for (const [mat, list] of byMat) {
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = !!shadow.get(mat);
    g.add(mesh);
  }
}

