// ─────────────────────────────────────────────────────────────────────────────
// Route marks (5B) — the start and finish of a point-to-point route (sprint, touge): a gantry
// over the road with a chequered banner, and a painted line across it. Ends that fall on the
// circuit's own start line use the gantry already there.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import type { RaceRoute, WorldData } from './WorldData';

function banner(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const g = c.getContext('2d')!;
  // chequered ends, a dark middle with the word
  const sq = 16;
  for (let y = 0; y < 128; y += sq)
    for (let x = 0; x < 1024; x += sq) {
      const end = x < 160 || x >= 864;
      g.fillStyle = end ? ((x / sq + y / sq) % 2 ? '#111' : '#f2f2f2') : '#14181c';
      g.fillRect(x, y, sq, sq);
    }
  g.fillStyle = '#f4f6f8';
  g.font = 'bold 76px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 512, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class RouteMarks {
  private group = new THREE.Group();

  constructor(
    scene: THREE.Scene,
    private world: WorldData,
  ) {
    this.group.name = 'route-marks';
    scene.add(this.group);
  }

  set(route: RaceRoute | null): void {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      o.traverse((m) => {
        const mesh = m as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
        if (mat) {
          mat.map?.dispose();
          mat.dispose();
        }
      });
    }
    if (!route) return;
    if (route.from !== this.world.startIndex) this.gantry(route.from, 'START');
    if (route.to !== this.world.startIndex) this.gantry(route.to, 'FINISH');
  }

  private gantry(i: number, text: string): void {
    const W = this.world;
    const s = W.samples[i];
    const half = W.halfWidth + 1.6;
    const g = new THREE.Group();
    g.position.set(s.x, s.y, s.z);
    g.rotation.y = Math.atan2(s.tx, s.tz);
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0.6, roughness: 0.45 });
    for (const e of [-half, half]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6.4, 0.4), steel);
      post.position.set(e, 3.2, 0);
      post.castShadow = true;
      g.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.4, 0.5, 0.5), steel);
    beam.position.y = 6.2;
    g.add(beam);
    const tex = banner(text);
    const bmat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.6, side: THREE.DoubleSide });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 - 1, (half * 2 - 1) / 8), bmat);
    panel.position.y = 5.1;
    panel.rotation.y = Math.PI; // faces the cars coming up to it
    g.add(panel);
    // the line across the road
    const line = new THREE.Mesh(new THREE.PlaneGeometry(W.halfWidth * 2, 0.6), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -10 }));
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.03;
    line.receiveShadow = true;
    g.add(line);
    this.group.add(g);
  }
}
