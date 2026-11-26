// Studio renders of each car edition for the car-select cards. Made once at start-up with a
// small throwaway WebGL renderer, so they always match the real 3D car and any new edition
// gets its picture for free.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CarLook } from '../vehicle/Cars';
import { PhantomX1 } from '../vehicle/PhantomX1';
import { hasImportedModel, makeCarVisual } from '../vehicle/ImportedCars';
import { modelOf } from '../vehicle/Cars';
import { VehicleState } from '../vehicle/VehiclePhysics';

export function renderCards(looks: CarLook[], editions: string[] = [], width = 960, height = 600): string[] {
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1416);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    scene.fog = new THREE.Fog(0x0a1416, 9, 20);

    // floor with a soft glossy sheen, and a teal back wall glow
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x0c1a1d, roughness: 0.35, metalness: 0.2 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
    scene.add(key);
    // cyan rim lights trace the silhouette from behind
    for (const [x, z] of [[-5, -6], [6, -4.5]]) {
      const rim = new THREE.DirectionalLight(0x4fd1d9, 2.4);
      rim.position.set(x, 2.2, z);
      scene.add(rim);
    }
    // a soft teal glow on the back wall, out of shot of the floor under the car
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), new THREE.MeshBasicMaterial({ color: 0x0f2a2e }));
    wall.position.set(0, 5, -12);
    scene.add(wall);

    // one studio car per model (4.5: imported cars get their own model)
    const cars = new Map<string, PhantomX1>();
    const carFor = (edition: string): PhantomX1 => {
      const key = hasImportedModel(edition) ? modelOf(edition).id : 'phantom-x1';
      let c = cars.get(key);
      if (!c) {
        c = makeCarVisual(edition);
        c.root.traverse((o) => (o.castShadow = (o as THREE.Mesh).isMesh ? o.castShadow : false));
        scene.add(c.root);
        cars.set(key, c);
      }
      for (const v of cars.values()) v.root.visible = v === c;
      return c;
    };
    const st = new VehicleState();
    st.steerAngle = 0.28;
    const cam = new THREE.PerspectiveCamera(26, width / height, 0.1, 100);
    const a = THREE.MathUtils.degToRad(38);
    cam.position.set(Math.sin(a) * 7.6, 1.9, Math.cos(a) * 7.6);
    cam.lookAt(0, 0.5, -0.05);

    const out: string[] = [];
    const r = renderer;
    // 4.6: frame every model the same way: its length fills the card as the Phantom X1's does
    const size = new THREE.Vector3();
    looks.forEach((look, i) => {
      const car = carFor(editions[i] ?? '');
      car.setLook(look);
      car.update(st, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 }, 1, 0.016);
      // (the car's own length: the root also holds the 34 m headlight card and the ground shadow)
      const len = Math.hypot(car.noseZ - car.tailZ, 2 * 0.6);
      size.set(2, 1.3, len);
      const k = car.imported ? (len / 4.95) * 0.97 : 1; // (4.95: the Phantom X1's measure)
      cam.position.set(Math.sin(a) * 7.6 * k, 1.9 * k + (car.imported ? 0.05 : 0), Math.cos(a) * 7.6 * k);
      cam.lookAt(0, car.imported ? size.y * 0.42 : 0.5, -0.05);
      r.render(scene, cam);
      out.push(canvas.toDataURL('image/jpeg', 0.86));
    });
    pmrem.dispose();
    return out;
  } catch (err) {
    console.warn('card renders failed', err);
    return looks.map(() => '');
  } finally {
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
    }
  }
}
