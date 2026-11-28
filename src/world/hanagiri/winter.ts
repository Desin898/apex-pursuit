// ─────────────────────────────────────────────────────────────────────────────
// Hanagiri in winter light (5C) — the Snow weather's sky photo and the low sun in the forest.
//
//   · the "Sky Pano – Winter Forest" photo (MozillaHubs, CC-BY-NC-SA-4.0: see Credits) is not the
//     sky (wrapped all round it would surround the map with trees). It is the reflection map in
//     the Snow weather (Environment.envMap) and a distant tree-line band seen from the forest climb.
//   · light shafts: a low golden sun slanting through the spruce trunks at dusk, fading as the
//     snowfall thickens (shaftUniforms, driven by the snow intensity).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import panoUrl from '../../../assets/sky-pano-winter-forest/pano.webp';
import { rng } from '../../core/math';
import { mainOnly } from '../../core/layers';
import { shaftUniforms, winterPano } from '../Environment';
import type { WorldData } from '../WorldData';
import { mountainUniforms } from './MountainTerrain';
import { indexAtKm, kmOf, zoneAtKm } from './zones';

export function buildWinterLight(scene: THREE.Scene, world: WorldData): { update(time: number): void } {
  // ── the pano: load it once ─────────────────────────────────────────────────
  if (!winterPano.tex) {
    winterPano.tex = new THREE.TextureLoader().load(panoUrl, () => {
      winterPano.ready = true;
      winterPano.onReady?.();
    });
    winterPano.tex.colorSpace = THREE.SRGBColorSpace;
    winterPano.tex.mapping = THREE.EquirectangularReflectionMapping;
  }
  const F = world.field!;
  const S = world.samples;
  const N = S.length;

  // ── the distant tree line behind the forest climb (Snow weather only) ──────
  const mid = S[indexAtKm(world, 2.25)];
  const bandTex = winterPano.tex.clone();
  bandTex.mapping = THREE.UVMapping;
  bandTex.wrapS = THREE.RepeatWrapping;
  bandTex.needsUpdate = true;
  const R = 640;
  const H = 120;
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, H, 96, 1, true),
    new THREE.ShaderMaterial({
      uniforms: { map: { value: bandTex }, uFog: { value: new THREE.Color() }, uK: { value: 1 } },
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform vec3 uFog;
        uniform float uK;
        varying vec2 vUv;
        void main() {
          // the photo's tree band (a slice of its middle rows), faded into the haze at the top
          vec3 c = texture2D(map, vec2(vUv.x * 2.0, 0.40 + vUv.y * 0.2)).rgb;
          float a = (1.0 - smoothstep(0.55, 0.95, vUv.y)) * uK;
          gl_FragColor = vec4(mix(c, uFog, 0.45), a);
        }`,
    }),
  );
  band.position.set(mid.x, Math.max(mid.y, 30) + H / 2 - 10, mid.z);
  band.renderOrder = -1;
  band.frustumCulled = false;
  band.name = 'tree-line-band';
  mainOnly(band);
  scene.add(band);

  // ── light shafts through the forest ────────────────────────────────────────
  const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 11), THREE.MathUtils.degToRad(-30));
  const r = rng(77);
  const spots: { x: number; y: number; z: number }[] = [];
  for (let k = 0; k < 400 && spots.length < 110; k++) {
    const i = (indexAtKm(world, 1.25) + Math.floor(r() * ((2.05 * 1000) / 2))) % N;
    if (zoneAtKm(kmOf(world, i)).id !== 'forest') continue;
    const s = S[i];
    const sd = r() < 0.5 ? 1 : -1;
    const off = world.roadBand + 2 + r() * 26;
    const x = s.x + s.nx * off * sd;
    const z = s.z + s.nz * off * sd;
    spots.push({ x, y: F.at(x, z), z });
  }
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0, 0.5, 0);
  const su = { uAmt: shaftUniforms.uAmount, uSun: { value: sun }, uTime: { value: 0 } };
  const shafts = new THREE.InstancedMesh(
    quad,
    new THREE.ShaderMaterial({
      uniforms: su,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: /* glsl */ `
        uniform vec3 uSun;
        varying vec2 vUv;
        varying float vFade;
        varying float vSeed;
        void main() {
          vUv = uv;
          vec3 base = instanceMatrix[3].xyz;
          float len = length(instanceMatrix[1].xyz);
          float wid = length(instanceMatrix[0].xyz);
          // the shaft runs from the ground up towards the sun; it turns about that line to face us
          vec3 axis = normalize(uSun);
          vec3 toC = normalize(cameraPosition - base);
          vec3 side = normalize(cross(axis, toC) + 1e-4);
          vec3 p = base + axis * position.y * len + side * position.x * wid;
          vSeed = fract(base.x * 0.13 + base.z * 0.07);
          float d = length(cameraPosition - base);
          vFade = smoothstep(8.0, 22.0, d) * (1.0 - smoothstep(110.0, 190.0, d));
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAmt, uTime;
        varying vec2 vUv;
        varying float vFade;
        varying float vSeed;
        void main() {
          float across = 1.0 - smoothstep(0.15, 0.5, abs(vUv.x - 0.5));
          float along = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
          float flick = 0.75 + 0.25 * sin(uTime * 0.6 + vSeed * 30.0);
          float a = across * along * flick * vFade * uAmt * 0.16;
          gl_FragColor = vec4(vec3(1.0, 0.8, 0.55) * a, 1.0);
        }`,
    }),
    spots.length,
  );
  const m4 = new THREE.Matrix4();
  spots.forEach((p, i) => shafts.setMatrixAt(i, m4.makeScale(1.6 + r() * 2.4, 28 + r() * 16, 1).setPosition(p.x, p.y, p.z)));
  shafts.frustumCulled = false;
  shafts.renderOrder = 7;
  shafts.name = 'light-shafts';
  mainOnly(shafts);
  scene.add(shafts);

  return {
    update(time) {
      const snow = mountainUniforms.uSnowCover.value > 0.5;
      band.visible = snow;
      shafts.visible = snow && shaftUniforms.uAmount.value > 0.02;
      su.uTime.value = time;
      const fog = scene.fog as THREE.FogExp2 | null;
      if (fog) (band.material as THREE.ShaderMaterial).uniforms.uFog.value.copy(fog.color);
    },
  };
}
