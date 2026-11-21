// ─────────────────────────────────────────────────────────────────────────────
// Helicopter — "Air One", the patrol helicopter that joins at Heat 5. An original design
// (reworked in 4B):
// - a smooth lathe-turned fuselage in black with a white band, a wrap-round glass nose and an
//   engine fairing
// - a tapered tail boom with a fenced tail rotor, a fin and a stabiliser with end plates
// - skids that curl up at the front
// - a four-blade main rotor that blurs into a translucent disc at speed
// - a searchlight under the nose, with a visible beam cone that shows up in rain and fog, and
//   red, green and white navigation lights plus a strobe
// The livery uses invented words only.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';

function discTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  gr.addColorStop(0, 'rgba(20,22,26,0.0)');
  gr.addColorStop(0.15, 'rgba(20,22,26,0.35)');
  gr.addColorStop(0.85, 'rgba(20,22,26,0.22)');
  gr.addColorStop(0.97, 'rgba(60,64,70,0.4)');
  gr.addColorStop(1, 'rgba(20,22,26,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  // faint blade sweeps
  g.strokeStyle = 'rgba(10,10,12,0.25)';
  g.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.arc(64, 64, 60, i * 1.57, i * 1.57 + 0.5);
    g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

function bandTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d8dde3';
  g.fillRect(0, 0, 512, 64);
  g.fillStyle = '#121418';
  g.font = '800 40px Outfit, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('PG AIR ONE', 256, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Helicopter {
  readonly root = Object.assign(new THREE.Group(), { userData: { noBake: true } });
  private rotor = new THREE.Group();
  private blades: THREE.Mesh[] = [];
  private disc: THREE.Mesh;
  private discMat: THREE.MeshBasicMaterial;
  private tailRotor = new THREE.Group();
  private tailDisc: THREE.Mesh;
  private beacon: THREE.MeshStandardMaterial;
  private strobe: THREE.MeshStandardMaterial;
  /** the visible light cone (night, rain or fog) */
  readonly cone: THREE.Mesh;
  private coneMat: THREE.MeshBasicMaterial;
  /** a real light for the searchlight (Medium quality and up, at night) */
  readonly spot: THREE.SpotLight;
  /** 0..1 how much the air shows a beam (rain, fog); set by the view */
  haze = 0;

  constructor(scene: THREE.Scene) {
    const black = new THREE.MeshPhysicalMaterial({ color: 0x0e1013, roughness: 0.35, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.08 });
    const band = new THREE.MeshPhysicalMaterial({ map: bandTexture(), roughness: 0.35, metalness: 0.1, clearcoat: 1 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0b1420, roughness: 0.04, metalness: 0.9, envMapIntensity: 1.6 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.4, metalness: 0.8 });
    // fuselage: a lathe profile (radius by length) turned round the long axis
    const prof: [number, number][] = [
      [0, -2.2], [0.55, -2.05], [0.95, -1.5], [1.12, -0.6], [1.15, 0.2], [1.05, 1.0], [0.82, 1.6], [0.45, 2.05], [0, 2.25],
    ];
    const lathe = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), 20);
    lathe.rotateX(Math.PI / 2); // lathe axis (y) → the long axis (z)
    lathe.scale(1, 0.92, 1);
    const pod = new THREE.Mesh(lathe, black);
    pod.position.y = 0.2;
    // white band with the name, round the middle
    const bandG = new THREE.CylinderGeometry(1.155, 1.155, 0.5, 24, 1, true);
    bandG.rotateX(Math.PI / 2);
    const bandM = new THREE.Mesh(bandG, band);
    bandM.scale.set(1, 0.92, 1);
    bandM.position.set(0, 0.2, -0.25);
    // wrap-round glass nose
    const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), glass);
    nose.rotation.x = Math.PI / 2 - 0.35;
    nose.scale.set(0.98, 0.98, 0.95);
    nose.position.set(0, 0.42, 1.25);
    // engine fairing on top
    const fair = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.4, 4, 10), black);
    fair.rotation.x = Math.PI / 2;
    fair.position.set(0, 1.15, -0.5);
    // tail boom, fin, stabiliser with end plates, rotor fence
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.36, 5.2, 12), black);
    boom.rotation.x = Math.PI / 2;
    boom.position.set(0, 0.6, -4.5);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.4, 0.9), black);
    fin.position.set(0, 1.2, -7.0);
    fin.rotation.x = -0.32;
    const stab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.48), black);
    stab.position.set(0, 0.62, -6.4);
    this.root.add(pod, bandM, nose, fair, boom, fin, stab);
    for (const sx of [1, -1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.42), black);
      plate.position.set(sx * 0.95, 0.66, -6.4);
      this.root.add(plate);
    }
    const fence = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 6, 20), black);
    fence.rotation.y = Math.PI / 2;
    fence.position.set(0.12, 1.25, -7.15);
    this.root.add(fence);
    // skids that curl up at the front
    for (const sx of [1, -1]) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(sx * 1.05, -1.25, -1.5), new THREE.Vector3(sx * 1.05, -1.27, 0.6), new THREE.Vector3(sx * 1.05, -1.2, 1.5), new THREE.Vector3(sx * 1.05, -0.95, 1.95)]);
      this.root.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.06, 6), steel));
      for (const z of [0.9, -0.7]) {
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6), steel);
        strut.position.set(sx * 0.88, -0.88, z);
        strut.rotation.z = sx * 0.4;
        this.root.add(strut);
      }
    }
    // main rotor: blades plus a blurred disc that takes over as it spins up
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.55, 8), steel);
    mast.position.y = 1.6;
    this.root.add(mast);
    const bladeGeo = new THREE.BoxGeometry(0.3, 0.035, 5.6);
    bladeGeo.translate(0, 0, 2.8);
    for (let i = 0; i < 4; i++) {
      const bl = new THREE.Mesh(bladeGeo, black);
      bl.rotation.y = (i * Math.PI) / 2;
      this.rotor.add(bl);
      this.blades.push(bl);
    }
    this.rotor.position.y = 1.88;
    this.discMat = new THREE.MeshBasicMaterial({ map: discTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const discG = new THREE.CircleGeometry(5.7, 40);
    discG.rotateX(-Math.PI / 2);
    this.disc = new THREE.Mesh(discG, this.discMat);
    this.disc.position.y = 1.9;
    this.root.add(this.rotor, this.disc);
    const tbGeo = new THREE.BoxGeometry(0.03, 1.1, 0.12);
    for (let i = 0; i < 2; i++) {
      const bl = new THREE.Mesh(tbGeo, black);
      bl.rotation.x = (i * Math.PI) / 2;
      this.tailRotor.add(bl);
    }
    this.tailRotor.position.set(0.14, 1.25, -7.15);
    const tdG = new THREE.CircleGeometry(0.56, 20);
    tdG.rotateY(Math.PI / 2);
    this.tailDisc = new THREE.Mesh(tdG, this.discMat);
    this.tailDisc.position.copy(this.tailRotor.position);
    this.root.add(this.tailRotor, this.tailDisc);
    // lights: red beacon, white strobe on the tail, nav lights on the stabiliser ends
    this.beacon = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2020, emissiveIntensity: 0 });
    const bc = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), this.beacon);
    bc.position.set(0, 1.42, -1.3);
    this.strobe = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 0 });
    const sb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), this.strobe);
    sb.position.set(0, 1.85, -7.35);
    const navR = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1010, emissiveIntensity: 5 }));
    navR.position.set(0.98, 0.72, -6.4); // left side (+x)
    const navG = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshStandardMaterial({ color: 0x002200, emissive: 0x20ff40, emissiveIntensity: 5 }));
    navG.position.set(-0.98, 0.72, -6.4);
    this.root.add(bc, sb, navR, navG);
    const lampHead = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.3, 10), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff4dc, emissiveIntensity: 5 }));
    lampHead.position.set(0, -0.85, 1.6);
    this.root.add(lampHead);
    this.root.visible = false;
    scene.add(this.root);

    // searchlight: a soft additive cone from the lamp to the ground, plus a real spotlight
    const cg = new THREE.ConeGeometry(1, 1, 28, 1, true);
    cg.translate(0, -0.5, 0); // apex at the origin, opening down −Y
    this.coneMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true });
    this.cone = new THREE.Mesh(cg, this.coneMat);
    this.cone.visible = false;
    this.cone.renderOrder = 9;
    scene.add(this.cone);
    this.spot = new THREE.SpotLight(0xfff1d6, 0, 140, 0.12, 0.5, 1.8);
    // (PursuitView adds the spot to the scene only when it can afford a light)
  }

  private lamp = new THREE.Vector3();

  /** Position, rotor spin and searchlight. `night` 0..1 sets how much the light shows. */
  update(x: number, y: number, z: number, yaw: number, lx: number, lz: number, time: number, dt: number, night: number, active: boolean, spotOn: boolean): void {
    this.root.visible = active;
    const show = Math.max(night, this.haze * 0.7);
    this.cone.visible = active && show > 0.05;
    if (!active) {
      this.spot.intensity = 0;
      return;
    }
    this.root.position.set(x, y, z);
    // nose down a little in the direction of travel
    this.root.rotation.set(0.12, yaw, Math.sin(time * 0.7) * 0.04, 'YXZ');
    this.rotor.rotation.y += dt * 38;
    this.tailRotor.rotation.x += dt * 70;
    // at full speed the blades are a blur: show the disc, fade the blades
    for (const b of this.blades) b.visible = false;
    this.discMat.opacity = 1;
    this.disc.rotation.y += dt * 3;
    this.beacon.emissiveIntensity = (time * 1.4) % 1 < 0.12 ? 12 : 0;
    this.strobe.emissiveIntensity = (time * 0.9) % 1 < 0.05 ? 30 : 0;
    // searchlight from under the nose to the target
    const lamp = this.root.localToWorld(this.lamp.set(0, -0.95, 1.6));
    const dx = lx - lamp.x;
    const dy = 0 - lamp.y;
    const dz = lz - lamp.z;
    const len = Math.hypot(dx, dy, dz);
    this.cone.position.copy(lamp);
    this.cone.scale.set(len * 0.12, len, len * 0.12);
    this.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
    // the beam shows in the dark, and more so in rain and fog
    const k = show * (1 + 1.4 * this.haze);
    this.coneMat.color.setRGB(0.04 * k, 0.037 * k, 0.032 * k);
    this.spot.position.copy(lamp);
    this.spot.target.position.set(lx, 0, lz);
    this.spot.target.updateMatrixWorld();
    this.spot.intensity = spotOn ? 3500 * Math.max(night, this.haze * 0.4) : 0;
  }
}
