// ─────────────────────────────────────────────────────────────────────────────
// Environment — weather and time of day (Phase 3C-2).
//   Time:    dusk (the original look) or night (stars, moon, lamps, headlights)
//   Weather: clear, cloudy (overcast deck, flat grey light) or rain (wet road, streaks, spray)
// apply() re-tunes the sky, lights, fog, materials and environment map for a combination;
// update() runs every frame for the parts that follow the camera: rain, the lamp spotlights
// nearest the camera and the light reflections on a wet road.
// Rendering only: grip lives in VehiclePhysics.wet, set by Race.setWet().
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { WEATHER } from '../config';
import { Quality } from '../fx/PostFX';
import { Rain } from '../fx/Rain';
import { SkyDome } from './SkyDome';
import * as tex from './textures';
import { WorldVisuals } from './WorldBuilder';
import { WorldData } from './WorldData';

export type Weather = 'clear' | 'cloudy' | 'rain';
/** 'dynamic' = dusk to night over the race */
export type TimeOfDay = 'dusk' | 'night' | 'dynamic';
export interface Conditions {
  weather: Weather;
  time: TimeOfDay;
}
export const WEATHERS: Weather[] = ['clear', 'cloudy', 'rain'];
export const TIMES: TimeOfDay[] = ['dusk', 'night', 'dynamic'];

type RGB = [number, number, number];
interface Preset {
  sky: 'sky' | 'dome';
  top: number;
  horizon: number;
  glow: number; // halo around the sun / moon in the dome sky
  stars: number; // 0..1
  moon: boolean;
  sunColor: number;
  sunI: number;
  sunElev: number;
  sunAz: number;
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  fog: number;
  fogD: number;
  envI: number;
  envGround: number;
  envLamps: number; // bright spots in the reflection map (lamps around the horizon)
  cloud: number;
  cloudO: number;
  /** 4G sky: how bright the sun's disc is, how much cloud, and the clouds' colours */
  sunDisc: number;
  cover: number;
  cloudLit: number;
  cloudDark: number;
  cloudRim: number;
  ridge: number;
  windows: number;
  glass: number;
  signs: number;
  lamps: number;
  pools: number; // street-lamp pools of light on the ground, 0..1
  carLights: number; // headlight beams on the road, 0..1
  exposure: number;
  bloom: number;
  shadowTint: RGB;
  highTint: RGB;
  sat: number;
  wet: number;
  rain: number;
}

// 4G: a sunset: the sun low over the hills, orange sky, clouds lit gold underneath purple
const DUSK: Preset = {
  sky: 'dome', top: 0x1f2c5c, horizon: 0xff9a52, glow: 0xff6a24, stars: 0, moon: false,
  sunColor: 0xffb877, sunI: 3.4, sunElev: 8, sunAz: -42,
  hemiSky: 0xa4b4e8, hemiGround: 0x4d3a26, hemiI: 0.75,
  fog: 0xb07a62, fogD: 0.00105, envI: 0.95, envGround: 0x1c1a17, envLamps: 0,
  cloud: 0xffc9a8, cloudO: 0.8, ridge: 0x5c4c68,
  sunDisc: 26, cover: 0.52, cloudLit: 0xff8a48, cloudDark: 0x3c2240, cloudRim: 0xffd98a,
  windows: 1.6, glass: 0.55, signs: 0.55, lamps: 3.2, pools: 0, carLights: 0,
  exposure: 0.8, bloom: 0.42,
  shadowTint: [0.86, 1.0, 1.1], highTint: [1.1, 1.0, 0.88], sat: 1.12, wet: 0, rain: 0,
};

const lerpHex = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
/** Between two presets: numbers and colours blend; the sky is the gradient dome throughout. */
function lerpPreset(a: Preset, b: Preset, t: number): Preset {
  const out = { ...b } as Record<string, unknown>;
  const colourKeys = new Set(['top', 'horizon', 'glow', 'sunColor', 'hemiSky', 'hemiGround', 'fog', 'envGround', 'cloud', 'ridge', 'cloudLit', 'cloudDark', 'cloudRim']);
  for (const k of Object.keys(a) as (keyof Preset)[]) {
    const va = a[k];
    const vb = b[k];
    if (colourKeys.has(k)) out[k] = lerpHex(va as number, vb as number, t);
    else if (typeof va === 'number' && typeof vb === 'number') out[k] = va + (vb - va) * t;
    else if (Array.isArray(va) && Array.isArray(vb)) out[k] = va.map((x, i) => x + ((vb[i] as number) - x) * t);
  }
  out.sky = 'dome';
  out.moon = t > 0.6 && b.moon;
  // the sun drops towards the horizon, then the moon rises elsewhere
  out.sunElev = t < 0.5 ? a.sunElev * (1 - t * 1.6) : b.sunElev * ((t - 0.5) * 2);
  out.sunAz = t < 0.5 ? a.sunAz : b.sunAz;
  out.sunI = t < 0.5 ? a.sunI * (1 - t * 2) + 0.05 : b.sunI * (t - 0.5) * 2 + 0.05;
  // 4G: the sun's disc sets with it; the moon (which takes over sunDir) has no sun disc
  out.sunDisc = t < 0.5 ? a.sunDisc * Math.max(0, 1 - t * 2.2) : 0;
  // the sun's glow fades as it sets, before the moon's (same direction slot) comes up
  out.glow = t < 0.5 ? lerpHex(a.glow, 0x000000, t * 2) : lerpHex(0x000000, b.glow, (t - 0.5) * 2);
  return out as unknown as Preset;
}

/** The look for a weather + time combination (`t`: progress through a dusk-to-night race). */
export function presetFor(c: Conditions, t = 0): Preset {
  if (c.time === 'dynamic') {
    const dusk = presetFor({ weather: c.weather, time: 'dusk' });
    return lerpPreset(dusk, presetFor({ weather: c.weather, time: 'night' }), clamp01(t));
  }
  const night = c.time === 'night';
  if (!night) {
    if (c.weather === 'clear') return DUSK;
    const rain = c.weather === 'rain';
    return {
      ...DUSK,
      sky: 'dome',
      top: rain ? 0x2f363d : 0x56606b,
      horizon: rain ? 0x6c7174 : 0x9c9a94,
      glow: rain ? 0x1a1a18 : 0x2e2a24,
      sunColor: rain ? 0xbcc5cf : 0xe2ddd2,
      sunI: rain ? 0.55 : 1.15,
      sunElev: 34,
      sunAz: -30,
      hemiSky: rain ? 0x9aa6b2 : 0xbac4ce,
      hemiGround: rain ? 0x2e2e2c : 0x48443e,
      hemiI: rain ? 1.05 : 1.3,
      fog: rain ? 0x60666b : 0x8d9194,
      fogD: rain ? 0.0034 : 0.0017,
      envI: rain ? 0.75 : 0.85,
      envGround: rain ? 0x101112 : 0x1a1a1a,
      cloud: rain ? 0x4e545a : 0x7c8288,
      cloudO: 1,
      sunDisc: 0,
      cover: rain ? 1 : 0.86,
      cloudLit: rain ? 0x6a7078 : 0xb4aca0,
      cloudDark: rain ? 0x2a2f35 : 0x4c5058,
      cloudRim: rain ? 0x3a3a3a : 0xffbf7a,
      ridge: rain ? 0x585e64 : 0x8c9296,
      windows: rain ? 2.2 : 1.5,
      glass: rain ? 0.9 : 0.5,
      signs: rain ? 0.9 : 0.6,
      lamps: rain ? 5 : 3.2,
      pools: rain ? 0.35 : 0,
      carLights: rain ? 0.4 : 0,
      exposure: rain ? 0.95 : 0.9,
      bloom: rain ? 0.5 : 0.4,
      shadowTint: [0.9, 1.0, 1.08],
      highTint: [0.99, 1.0, 1.03],
      sat: rain ? 0.86 : 0.94,
      wet: rain ? 1 : 0,
      rain: rain ? 1 : 0,
    };
  }
  const cloudy = c.weather !== 'clear';
  const rain = c.weather === 'rain';
  return {
    ...DUSK,
    sky: 'dome',
    top: cloudy ? 0x07080a : 0x02040b,
    horizon: cloudy ? (rain ? 0x1d1a18 : 0x2a231d) : 0x101a2c,
    glow: cloudy ? 0x000000 : 0x1c2a44,
    // a cloudy night still has gaps with stars and the moon; rain is one heavy deck
    stars: rain ? 0 : cloudy ? 0.85 : 1,
    moon: !rain,
    sunColor: 0x8ea6ff,
    sunI: cloudy ? 0.12 : 0.42,
    sunElev: 38,
    sunAz: 120,
    hemiSky: cloudy ? 0x3c3a3e : 0x2c3d60,
    hemiGround: 0x0b0907,
    hemiI: cloudy ? 0.45 : 0.5,
    fog: rain ? 0x0f1215 : cloudy ? 0x16151a : 0x0a111c,
    fogD: rain ? 0.0026 : cloudy ? 0.0015 : 0.0011,
    envI: 0.55,
    envGround: 0x050505,
    envLamps: 1,
    cloud: cloudy ? 0x2c2622 : 0x1a2133,
    cloudO: cloudy ? 1 : 0.2,
    sunDisc: 0,
    cover: rain ? 1 : cloudy ? 0.7 : 0.24,
    cloudLit: rain ? 0x1c1e22 : cloudy ? 0x2c2e36 : 0x37415a,
    cloudDark: rain ? 0x070809 : cloudy ? 0x08090c : 0x0a0d15,
    cloudRim: rain ? 0x2a2e34 : cloudy ? 0x8f9ab4 : 0xbfcbe8,
    ridge: cloudy ? 0x111215 : 0x121a2a,
    windows: 3.2,
    glass: 1.4,
    signs: 1.3,
    lamps: 6,
    pools: 1,
    carLights: 1,
    exposure: 0.95,
    bloom: 0.62,
    shadowTint: [0.88, 0.98, 1.12],
    highTint: [1.06, 1.0, 0.92],
    sat: rain ? 0.95 : 1.05,
    wet: rain ? 1 : 0,
    rain: rain ? 1 : 0,
  };
}

const col = (hex: number) => new THREE.Color(hex);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export class Environment {
  conditions: Conditions = { weather: 'clear', time: 'dusk' };
  p: Preset = DUSK;
  /** 4G: the sky (clouds, stars, moon, shooting stars, lightning) */
  readonly sky: SkyDome;
  private pools: THREE.InstancedMesh;
  private floodPools: THREE.InstancedMesh;
  private floodMat: THREE.MeshBasicMaterial;
  private poolMat: THREE.MeshBasicMaterial;
  private streaks: THREE.InstancedMesh;
  private streakMat: THREE.MeshBasicMaterial;
  private puddles = tex.puddleTexture();
  private envCache = new Map<string, THREE.Texture>();
  private envSky: Sky;
  readonly rain: Rain;
  /** how strong the fake light streaks on a wet road are (lower once real reflections are on) */
  streakScale = 1;
  /** the player's headlight spot strength (lower from the hood and bumper cameras) */
  headScale = 1;
  private lampSpots: THREE.SpotLight[] = [];
  private floodSpots: THREE.SpotLight[] = [];
  /** brightness scale for the real floodlight spots (tests and tuning) */
  floodMul = 1;
  /** 4F: where each floodlight's pool lies (its aim point) */
  private floodAim: { x: number; z: number }[] = [];
  /** tail lights and police bars near the camera, set by the game each frame (they light the rain) */
  rainCarLights: { x: number; y: number; z: number; r: number; g: number; b: number; falloff: number }[] = [];
  private rainLights: { x: number; y: number; z: number; r: number; g: number; b: number; falloff: number }[] = [];
  private rainAmb = new THREE.Color();
  /** extra lights that streak on the wet road (police bars), set by the game each frame */
  streakExtras: { x: number; y: number; z: number; r: number; g: number; b: number }[] = [];
  private headSpot: THREE.SpotLight | null = null;
  private quality: Quality = 'high';
  private lastCam = new THREE.Vector3();
  private camVel = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
    private world: WorldData,
    private v: WorldVisuals,
  ) {
    // ── The sky (4G): one shader for every weather and time ──
    this.sky = new SkyDome(scene);

    // ── Pools of light under every street lamp ──
    {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      this.poolMat = new THREE.MeshBasicMaterial({ map: tex.poolTexture(), color: 0x000000, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
      const heads = world.lampHeads;
      this.pools = new THREE.InstancedMesh(g, this.poolMat, heads.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      world.poles.forEach((pole, i) => {
        const h = heads[i];
        // push the pool a little further out from the pole, towards what the lamp faces
        const dx = h.x - pole.x;
        const dz = h.z - pole.z;
        const l = Math.hypot(dx, dz) || 1;
        const out = pole.arm !== undefined ? 3.5 : h.pad ? 7 : 6.5;
        const r = pole.arm !== undefined ? 28 : h.pad ? 34 : 32;
        m.compose(new THREE.Vector3(h.x + (dx / l) * out, 0.04, h.z + (dz / l) * out), q, new THREE.Vector3(r, 1, r));
        this.pools.setMatrixAt(i, m);
      });
      this.pools.renderOrder = 6;
      this.pools.frustumCulled = false;
      this.pools.visible = false;
      scene.add(this.pools);
    }

    // ── 4E: floodlight pools: each tower lays a broad pool of cool white light on the track ──
    {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      // 4F: the pool brightens what's under it (dst × (1 + light)) instead of adding flat white,
      // so dark asphalt stays asphalt and grass stays green, just lit
      this.floodMat = new THREE.MeshBasicMaterial({
        map: tex.poolTexture(), color: 0x000000, transparent: true, premultipliedAlpha: true, depthWrite: false, fog: false,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.OneFactor,
        polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8,
      });
      const fl = world.floodlights;
      this.floodPools = new THREE.InstancedMesh(g, this.floodMat, Math.max(1, fl.length));
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      fl.forEach((f, i) => {
        // centred where the beam meets the track, stretched along the beam
        const hit = world.nearestTrack(f.x, f.z);
        const S = world.samples;
        const c = hit ? S[hit.index] : { x: f.x, z: f.z };
        const dx = c.x - f.x;
        const dz = c.z - f.z;
        const d = Math.hypot(dx, dz) || 1;
        const cx = f.x + (dx / d) * (d + 4);
        const cz = f.z + (dz / d) * (d + 4);
        this.floodAim[i] = { x: cx, z: cz };
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dx, dz));
        m.compose(new THREE.Vector3(cx, 0.045, cz), q, new THREE.Vector3(52, 1, 74));
        this.floodPools.setMatrixAt(i, m);
      });
      this.floodPools.count = fl.length;
      // per-tower brightness: a tower that has a real spot light on it drops its painted pool
      for (let i = 0; i < fl.length; i++) this.floodPools.setColorAt(i, new THREE.Color(1, 1, 1));
      // before the car light cards (6): the pool brightens the lit road, not the cards on top
      this.floodPools.renderOrder = 5;
      this.floodPools.frustumCulled = false;
      this.floodPools.visible = false;
      scene.add(this.floodPools);
    }

    // ── Reflections of lights on a wet road ──
    {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0, 0.5);
      this.streakMat = new THREE.MeshBasicMaterial({ map: tex.streakTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -9, polygonOffsetUnits: -9 });
      this.streaks = new THREE.InstancedMesh(g, this.streakMat, 96);
      this.streaks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(96 * 3), 3);
      this.streaks.count = 0;
      this.streaks.renderOrder = 7;
      this.streaks.frustumCulled = false;
      this.streaks.visible = false;
      scene.add(this.streaks);
    }

    // A second Sky for reflections at dusk (the scene's own Sky can't be in two scenes)
    this.envSky = new Sky();
    this.envSky.scale.setScalar(9000);
    this.rain = new Rain(scene);
  }

  get night(): boolean {
    return this.conditions.time === 'night';
  }

  /** Switch to a weather + time combination (instant: call it behind a loading screen). */
  /** progress through a dusk-to-night race, 0..1 */
  dynT = 0;

  /** Dusk-to-night races: move the look along (cheap; call every second or so). */
  setProgress(t: number): void {
    if (this.conditions.time !== 'dynamic' || Math.abs(t - this.dynT) < 0.004) return;
    this.dynT = t;
    this.applyLook();
  }

  apply(c: Conditions, quality: Quality): void {
    const changed = c.time !== this.conditions.time || c.weather !== this.conditions.weather;
    this.conditions = { ...c };
    this.quality = quality;
    if (changed) this.dynT = 0;
    this.applyLook();
    this.structural();
  }

  /** Sky, lights, fog, reflections and glowing things for the current preset. */
  /** decals lying on the road (lamp pools, wet light streaks): no use in a reflection */
  roadDecals(): THREE.Object3D[] {
    return [this.pools, this.floodPools, this.streaks].filter(Boolean) as THREE.Object3D[];
  }

  // ── Rain intensity (4B.2): 0..1 on top of the "rain" weather ──
  /** how hard it is raining now (0..1); only matters in the rain weather */
  rainK = 0.7;
  /** tone mapper compensation: AgX ('Natural') needs a little more exposure than ACES */
  exposureK = 1;
  private rainBase = { rain: 0, wet: 0, fogD: 0 };
  /** Set the rain intensity: streaks, splashes, wetness and fog all follow (cheap; can change every frame). */
  setRainIntensity(k: number): void {
    k = Math.max(0, Math.min(1, k));
    if (Math.abs(k - this.rainK) < 0.004 && this.rainApplied) return;
    this.rainK = k;
    this.rainApplied = true;
    if (!this.p) return;
    this.scaleRain();
    if (this.conditions.weather === 'rain') this.sky.setStorm(0.35 + 0.65 * k);
    (this.scene.fog as THREE.FogExp2).density = this.p.fogD;
    this.wetSurfaces();
    this.configureRain();
  }
  private rainApplied = false;
  /** scale the preset's rain, wetness and fog by the intensity */
  private scaleRain(): void {
    const p = this.p;
    const b = this.rainBase;
    if (b.rain <= 0) return;
    const k = this.rainK;
    p.rain = b.rain * k;
    p.wet = b.wet * (0.55 + 0.45 * Math.min(1, k * 1.4)); // a light shower already wets the road
    p.fogD = b.fogD * (0.7 + 0.55 * k);
  }
  private configureRain(): void {
    const q = this.quality;
    this.rain.configure(WEATHER.rainDrops[q], this.p.rain, this.conditions.time !== 'dusk', WEATHER.rainSplashes[q]);
  }

  private applyLook(): void {
    const c = this.conditions;
    const p = (this.p = presetFor(c, this.dynT));
    this.rainBase.rain = p.rain;
    this.rainBase.wet = p.wet;
    this.rainBase.fogD = p.fogD;
    this.scaleRain();
    const v = this.v;
    const scene = this.scene;
    v.sky.visible = false;
    v.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - Math.max(2, p.sunElev)), THREE.MathUtils.degToRad(p.sunAz));
    (v.sky.material.uniforms.sunPosition.value as THREE.Vector3).copy(v.sunDir);
    this.sky.setLook({ top: p.top, horizon: p.horizon, glow: p.glow, sunCol: 0xffe2a8, sunDisc: p.sunDisc, moon: p.moon ? 1 : 0, cover: p.cover, cloudLit: p.cloudLit, cloudDark: p.cloudDark, cloudRim: p.cloudRim, stars: p.stars }, v.sunDir);
    this.sky.setStorm(c.weather === 'rain' ? 0.35 + 0.65 * this.rainK : 0);
    this.sky.setQuality(this.quality);

    // lights and fog
    v.sun.color.setHex(p.sunColor);
    v.sun.intensity = p.sunI;
    v.hemi.color.setHex(p.hemiSky);
    v.hemi.groundColor.setHex(p.hemiGround);
    v.hemi.intensity = p.hemiI;
    const fog = scene.fog as THREE.FogExp2;
    fog.color.setHex(p.fog);
    fog.density = p.fogD;
    // a dusk-to-night race steps its reflection map in quarters (each one is cached)
    scene.environment = this.envMap(c.time === 'dynamic' ? presetFor(c, Math.round(this.dynT * 4) / 4) : p);
    scene.environmentIntensity = p.envI;
    // the old flat cloud deck gives way to the sky's own clouds (4G)
    v.clouds.visible = false;
    for (const m of v.mats.ridges) m.color.setHex(p.ridge);

    // emissive things
    for (const m of v.mats.buildings) m.emissiveIntensity = p.windows;
    v.mats.glass.emissiveIntensity = p.glass;
    for (const m of v.mats.signs) m.emissiveIntensity = p.signs;
    v.mats.lamps.emissiveIntensity = p.lamps;
    for (const m of v.mats.floods) m.emissiveIntensity = p.lamps * 1.15;
    this.pools.visible = p.pools > 0.01;
    this.poolMat.color.setRGB(1.0 * p.pools * 0.5, 0.8 * p.pools * 0.5, 0.55 * p.pools * 0.5);
    // floodlights: on at dusk, full at night (a little more in the rain, where they reflect)
    const fk = Math.max(0, Math.min(1, (p.lamps - 2) / 4));
    this.floodPools.visible = fk > 0.01 && this.floodPools.count > 0;
    this.floodMat.color.setRGB(3.6 * fk, 3.6 * fk, 3.4 * fk);
    this.renderer.toneMappingExposure = p.exposure * this.exposureK;
  }

  private structural(): void {
    const c = this.conditions;
    const p = this.p;
    const v = this.v;
    const scene = this.scene;
    const quality = this.quality;
    const sp = c.time === 'dynamic' ? presetFor({ weather: c.weather, time: 'night' }) : p;

    this.wetSurfaces();
    const w = p.wet;

    // spotlights: a few real lights follow the camera between the lamps; the player's headlights
    const q = quality;
    const lampCount = sp.pools >= 1 ? WEATHER.lampLights[q] : sp.pools > 0 ? Math.floor(WEATHER.lampLights[q] / 2) : 0;
    while (this.lampSpots.length > lampCount) {
      const l = this.lampSpots.pop()!;
      scene.remove(l, l.target);
      l.dispose();
    }
    while (this.lampSpots.length < lampCount) {
      const l = new THREE.SpotLight(0xffd29a, 0, 46, 1.0, 0.8, 2);
      scene.add(l, l.target);
      this.lampSpots.push(l);
    }
    // 4F: real lights for the floodlight towers nearest the camera (High: 1, Ultra: 2), so the
    // cars passing under them are lit too, not just the ground
    const floodCount = sp.lamps > 2 && this.world.floodlights.length ? ({ low: 0, medium: 1, high: 1, ultra: 2 } as Record<string, number>)[q] ?? 0 : 0;
    while (this.floodSpots.length > floodCount) {
      const l = this.floodSpots.pop()!;
      scene.remove(l, l.target);
      l.dispose();
    }
    if (!floodCount && this.floodPools.instanceColor) {
      // no real lights any more: every tower paints its own pool again
      this.floodPools.instanceColor.array.fill(1);
      this.floodPools.instanceColor.needsUpdate = true;
    }
    while (this.floodSpots.length < floodCount) {
      const l = new THREE.SpotLight(0xf2f4ff, 0, 190, 0.62, 0.65, 1.3);
      scene.add(l, l.target);
      this.floodSpots.push(l);
    }
    const wantHead = sp.carLights > 0.5 && q !== 'low';
    if (wantHead && !this.headSpot) {
      this.headSpot = new THREE.SpotLight(0xdfeaff, 0, 75, 0.42, 0.55, 2);
      scene.add(this.headSpot, this.headSpot.target);
    } else if (!wantHead && this.headSpot) {
      scene.remove(this.headSpot, this.headSpot.target);
      this.headSpot.dispose();
      this.headSpot = null;
    }

    this.configureRain();
    this.streaks.visible = w > 0 && (sp.pools > 0 || sp.carLights > 0 || sp.rain > 0);
  }

  /** Wet surfaces: darker, glossier, puddles in the roughness (follows the rain intensity). */
  private wetSurfaces(): void {
    const c = this.conditions;
    const v = this.v;
    const w = this.p.wet;
    const wetMat = (m: THREE.MeshStandardMaterial, dryRough: number, wetRough: number, dark: number, puddles: boolean) => {
      m.color.setScalar(1 - w * dark);
      m.roughness = dryRough + (wetRough - dryRough) * w;
      const want = puddles && w > 0 ? this.puddles : null;
      if (m.roughnessMap !== want) {
        m.roughnessMap = want;
        m.needsUpdate = true;
      }
      m.envMapIntensity = 1 + w * (c.time === 'night' ? 0.35 : c.time === 'dynamic' ? 0.55 : 0.8);
    };
    this.puddles.repeat.set(1.4, 0.35);
    wetMat(v.mats.road, 0.62, 0.5, 0.5, true);
    wetMat(v.mats.kerb, 0.7, 0.3, 0.25, false);
    for (const m of v.mats.paved) wetMat(m, 0.82, 0.4, 0.3, false);
    wetMat(v.mats.ground, 0.96, 0.8, 0.22, false);
    wetMat(v.mats.terrain, 0.95, 0.78, 0.2, false);
  }

  /** Reflection map for a preset: its sky, a dark ground and (at night) lamp glows round the horizon. */
  private envMap(p: Preset): THREE.Texture {
    const key = `${p.sky}|${p.top}|${p.horizon}|${p.envGround}|${p.envLamps}|${p.sunElev}|${p.cover}|${p.cloudLit}|${p.stars}`;
    const hit = this.envCache.get(key);
    if (hit) return hit;
    const envScene = new THREE.Scene();
    if (p.sky === 'sky') {
      const su = this.v.sky.material.uniforms;
      for (const k of ['sunPosition', 'turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'] as const) {
        const src = su[k].value;
        this.envSky.material.uniforms[k].value = src instanceof THREE.Vector3 ? src.clone() : src;
      }
      envScene.add(this.envSky);
    } else {
      envScene.add(new THREE.Mesh(this.sky.mesh.geometry, this.sky.mat));
    }
    const ground = new THREE.Mesh(new THREE.CircleGeometry(4000, 24), new THREE.MeshBasicMaterial({ color: p.envGround }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.2;
    envScene.add(ground);
    if (p.envLamps > 0) {
      // small bright cards round the horizon: the paint picks up highlights like real lamps
      const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffcf8a).multiplyScalar(7), side: THREE.DoubleSide });
      const lg = new THREE.PlaneGeometry(14, 5);
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + 0.2;
        const m = new THREE.Mesh(lg, lampMat);
        m.position.set(Math.cos(a) * 160, 26 + (i % 3) * 6, Math.sin(a) * 160);
        m.lookAt(0, 0, 0);
        envScene.add(m);
      }
    }
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const prevExposure = this.renderer.toneMappingExposure;
    this.renderer.toneMappingExposure = 0.5;
    const t = this.sky.quiet(() => pmrem.fromScene(envScene, 0.02, 1, 10000).texture);
    this.renderer.toneMappingExposure = prevExposure;
    pmrem.dispose();
    envScene.remove(this.envSky);
    this.envCache.set(key, t);
    return t;
  }

  private heads: { i: number; d: number }[] = [];
  private flashWas = false;
  private flashCol = new THREE.Color(0xc8d6ff);
  private tmpV = new THREE.Vector3();
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpS = new THREE.Vector3();
  private tmpC = new THREE.Color();

  /**
   * Per frame. `cars`: every visible car's root (yaw-only ground frame) and whether it is braking.
   * `player` is the root that carries the real headlight spot (null in menus is fine).
   */
  update(dt: number, time: number, camera: THREE.PerspectiveCamera, cars: { root: THREE.Object3D; braking: boolean }[], player: THREE.Object3D | null, pxScale: number): void {
    const cam = camera.position;
    if (dt > 0) {
      this.camVel.copy(cam).sub(this.lastCam).divideScalar(dt);
      if (this.camVel.lengthSq() > 150 * 150) this.camVel.set(0, 0, 0); // a camera cut, not motion
    }
    this.lastCam.copy(cam);
    // the sky: clouds drift, shooting stars, lightning (which lights the whole scene for a moment)
    const flash = this.sky.update(dt, time, cam);
    const v = this.v;
    if (flash > 0.002 || this.flashWas) {
      const night = this.conditions.time === 'dusk' ? 0.35 : 1;
      v.hemi.intensity = this.p.hemiI + flash * 1.1 * night;
      v.hemi.color.setHex(this.p.hemiSky).lerp(this.flashCol, Math.min(1, flash * 1.5));
      this.flashWas = flash > 0.002;
    }
    void pxScale;
    this.rain.update(time, cam, this.camVel, player ? player.position.y : cam.y - 1.5);

    // nearest lamp heads to the camera
    const heads = this.world.lampHeads;
    const near = this.heads;
    near.length = 0;
    for (let i = 0; i < heads.length; i++) {
      const d = (heads[i].x - cam.x) ** 2 + (heads[i].z - cam.z) ** 2;
      if (d < 180 * 180) near.push({ i, d });
    }
    near.sort((a, b) => a.d - b.d);
    const p = this.p;
    for (let k = 0; k < this.lampSpots.length; k++) {
      const l = this.lampSpots[k];
      const n = near[k];
      if (!n) {
        l.intensity = 0;
        continue;
      }
      const h = heads[n.i];
      l.position.set(h.x, h.y - 0.3, h.z);
      l.target.position.set(h.x, 0, h.z);
      l.target.updateMatrixWorld();
      // the farthest spot of the set fades as it hands over, so lamps don't pop on and off
      const fade = k === this.lampSpots.length - 1 && near[k + 1] ? Math.min(1, (near[k + 1].d - n.d) / 400) : 1;
      l.intensity = 380 * p.pools * fade;
    }
    // floodlights: the nearest towers to the camera get the real lights
    if (this.floodSpots.length && this.floodPools.instanceColor) {
      const fl = this.world.floodlights;
      const lit = new Array<number>(fl.length).fill(0);
      const order = fl.map((f, i) => ({ i, d: (f.x - cam.x) ** 2 + (f.z - cam.z) ** 2 })).sort((a, b) => a.d - b.d);
      const fk = Math.max(0, Math.min(1, (p.lamps - 2) / 4));
      this.floodSpots.forEach((l, k) => {
        const n = order[k];
        if (!n || n.d > 260 * 260 || !this.floodAim[n.i]) {
          l.intensity = 0;
          return;
        }
        const f = fl[n.i];
        const a = this.floodAim[n.i];
        l.position.set(f.x, f.h, f.z);
        l.target.position.set(a.x, 0, a.z);
        l.target.updateMatrixWorld();
        const fade = k === this.floodSpots.length - 1 && order[k + 1] ? Math.min(1, (order[k + 1].d - n.d) / 3000) : 1;
        l.intensity = 140 * fk * fade * this.floodMul;
        lit[n.i] = fade * Math.min(1, this.floodMul);
      });
      const c = this.floodPools.instanceColor;
      let changed = false;
      for (let i = 0; i < fl.length; i++) {
        const v = 1 - lit[i];
        if (Math.abs(c.getX(i) - v) > 0.01) {
          c.setXYZ(i, v, v, v);
          changed = true;
        }
      }
      if (changed) c.needsUpdate = true;
    }
    if (this.headSpot && player) {
      player.updateMatrixWorld();
      this.headSpot.position.copy(player.localToWorld(this.tmpV.set(0, 0.75, 2.2)));
      this.headSpot.target.position.copy(player.localToWorld(this.tmpV.set(0, 0, 24)));
      this.headSpot.target.updateMatrixWorld();
      this.headSpot.intensity = 3600 * p.carLights * this.headScale;
    }

    // the rain shows up where it crosses light: the nearest lamps, then the car lights (4B)
    if (this.rain.lines.visible) {
      const L = this.rainLights;
      L.length = 0;
      const lampI = 1.4 * p.pools + 0.15 * p.carLights;
      if (lampI > 0.01) {
        for (let k = 0; k < Math.min(5, near.length); k++) {
          const h = heads[near[k].i];
          L.push({ x: h.x, y: h.y - 1.2, z: h.z, r: lampI, g: lampI * 0.82, b: lampI * 0.6, falloff: 0.045 });
        }
      }
      if (player && p.carLights > 0.05) {
        // your headlight beams light the rain in front of the car
        const hk = 1.6 * p.carLights * this.headScale;
        const b = player.localToWorld(this.tmpV.set(0, 0.9, 7));
        L.push({ x: b.x, y: b.y, z: b.z, r: hk, g: hk * 1.02, b: hk * 1.08, falloff: 0.06 });
      }
      for (const g of this.rainCarLights) if (L.length < 12) L.push(g);
      // the rain shows in the ambient light too, more so in a downpour
      const a = (0.06 + 0.22 * (1 - p.carLights) + 0.16 * this.rainK) * p.rain;
      this.rainAmb.setRGB(a * 0.9, a * 0.95, a);
      this.rain.setLights(this.rainAmb, L);
    }

    // wet-road reflections: lamp heads and car lights, each a streak towards the camera
    if (!this.streaks.visible) return;
    let n = 0;
    const max = 96;
    const put = (lx: number, ly: number, lz: number, r: number, g: number, b: number, width: number) => {
      if (n >= max) return;
      // where the mirror image of the light meets the road, seen from the camera
      const t = cam.y / (cam.y + ly);
      const px = cam.x + (lx - cam.x) * t;
      const pz = cam.z + (lz - cam.z) * t;
      const dx = px - cam.x;
      const dz = pz - cam.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 2 || dist > 170) return;
      const fade = Math.min(1, (170 - dist) / 60);
      // wet tarmac smears a light into a long streak down the road (longer in the rain)
      const len = Math.min(48 + 14 * p.rain, 3 + ly * (2.3 + 0.6 * p.rain) + dist * (0.12 + 0.05 * p.rain));
      const ux = dx / dist;
      const uz = dz / dist;
      const sx = px - ux * len * 0.3;
      const sz = pz - uz * len * 0.3;
      this.tmpQ.setFromAxisAngle(this.tmpV.set(0, 1, 0), Math.atan2(ux, uz));
      this.tmpM.compose(this.tmpV.set(sx, 0.05, sz), this.tmpQ, this.tmpS.set(width * (1 + dist * 0.012), 1, len));
      this.streaks.setMatrixAt(n, this.tmpM);
      this.streaks.setColorAt(n, this.tmpC.setRGB(r * fade, g * fade, b * fade));
      n++;
    };
    const lampK = p.pools * p.wet * 0.55 * this.streakScale;
    if (lampK > 0) for (let k = 0; k < Math.min(near.length, 40); k++) {
      const h = heads[near[k].i];
      put(h.x, h.y, h.z, 1.0 * lampK, 0.78 * lampK, 0.5 * lampK, 1.4);
    }
    const carK = Math.max(p.carLights, 0.45 * p.rain) * p.wet * this.streakScale;
    if (carK > 0) {
      for (const c of cars) {
        const r = c.root;
        if (!r.visible) continue;
        const fx = Math.sin(r.rotation.y);
        const fz = Math.cos(r.rotation.y);
        const tx = cam.x - r.position.x;
        const tz = cam.z - r.position.z;
        const td = Math.hypot(tx, tz) || 1;
        const facing = (fx * tx + fz * tz) / td; // +1: the car faces the camera
        const head = Math.max(0, facing) * 0.9 * carK;
        const tail = Math.max(0, -facing) * (c.braking ? 0.9 : 0.45) * carK + 0.12 * carK;
        if (head > 0.02) put(r.position.x + fx * 2.3, 0.62, r.position.z + fz * 2.3, head, head, head * 1.05, 0.9);
        if (tail > 0.02) put(r.position.x - fx * 2.3, 0.7, r.position.z - fz * 2.3, tail, tail * 0.08, tail * 0.05, 1.1);
      }
    }
    // police light bars (set by the game): red and blue smears on the wet road
    for (const e of this.streakExtras) put(e.x, e.y, e.z, e.r * p.wet * this.streakScale, e.g * p.wet * this.streakScale, e.b * p.wet * this.streakScale, 1.3);
    this.streaks.count = n;
    this.streaks.instanceMatrix.needsUpdate = true;
    if (this.streaks.instanceColor) this.streaks.instanceColor.needsUpdate = true;
  }
}
