// ─────────────────────────────────────────────────────────────────────────────
// SkyDome (Phase 4G): one procedural sky for every weather and time of day.
//   • a gradient with a big low sun at dusk, its glow on the horizon
//   • moving clouds lit by the sun or the moon: bright rims, dark undersides
//   • a dense star field with the Milky Way band and its dust lanes (clear nights)
//   • a crescent moon with earthshine and a halo
//   • shooting stars now and then, sometimes a shower of several
//   • lightning in the rain: bolts in the distance, the clouds lighting up, thunder later
// Everything sky-side is one shader on a sphere round the camera (always on the far plane).
// The bolts are a separate ribbon mesh so the hills can hide them.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';

const MET = 5; // shooting stars at once

export interface SkyLook {
  top: number;
  horizon: number;
  glow: number;
  sunCol: number;
  /** how bright the sun's disc is (0: no disc) */
  sunDisc: number;
  /** 0..1 the moon */
  moon: number;
  /** 0..1 how much of the sky is cloud */
  cover: number;
  cloudLit: number;
  cloudDark: number;
  cloudRim: number;
  /** 0..1 stars and the Milky Way */
  stars: number;
}

export type LightningMode = 'on' | 'soft' | 'off';

interface Meteor {
  a: THREE.Vector3;
  b: THREE.Vector3;
  t: number;
  dur: number;
  bright: number;
}

interface Strike {
  t: number;
  strokes: number[];
  dir: THREE.Vector3;
  dist: number;
  bolt: boolean;
  amp: number;
}

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }`;

const FRAG = /* glsl */ `
  uniform vec3 uTop, uHorizon, uGlow, uSunDir, uSunCol;
  uniform float uSunDisc, uMoon, uTime, uCover, uStars, uFlash;
  uniform vec3 uCloudLit, uCloudDark, uCloudRim, uFlashDir;
  uniform vec2 uWind;
  uniform vec4 uMetA[${MET}];
  uniform vec4 uMetB[${MET}];
  varying vec3 vDir;

  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < OCT; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
    return s;
  }
  // a cheaper three-octave one for the broad shapes (the warp, the Milky Way's glow)
  float fbm3(vec2 p) {
    float s = 0.5 * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    s += 0.25 * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    return s + 0.125 * vnoise(p);
  }

  // one layer of stars: a star in some cells of a 3D grid, drawn at its own direction
  vec3 starLayer(vec3 d, float scale, float keep, float px, float gain) {
    vec3 p = d * scale;
    vec3 c = floor(p);
    float h = hash13(c);
    if (h < keep) return vec3(0.0);
    vec3 o = vec3(hash13(c + 1.7), hash13(c + 5.3), hash13(c + 9.1)) * 0.5 + 0.25;
    vec3 sd = normalize(c + o);
    float dist = length(sd - d);
    float r = px * 0.9;
    float b = exp(-dist * dist / (r * r));
    float k = (h - keep) / (1.0 - keep);              // 0..1 how bright, mostly faint
    float tw = 0.75 + 0.25 * sin(uTime * (1.5 + k * 4.0) + h * 80.0);
    vec3 col = mix(vec3(1.0, 0.82, 0.66), vec3(0.72, 0.84, 1.0), hash13(c + 3.3));
    return col * b * (0.25 + 1.6 * k * k) * tw * gain;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float px = max(length(fwidth(d)), 1e-5);
    // ── the gradient ──
    vec3 c = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.85, h), 0.55));
    c = mix(c, uHorizon * 0.5, smoothstep(0.0, -0.3, h));
    float g = max(0.0, dot(d, uSunDir));
    float low = 1.0 - smoothstep(0.0, 0.45, h);        // the glow hugs the horizon
    c += uGlow * (pow(g, 300.0) * 2.5 + pow(g, 24.0) * 0.9 + pow(g, 5.0) * 0.45 * (0.4 + 0.6 * low) + pow(g, 1.5) * 0.12 * low);

    // ── night: stars and the Milky Way ──
    float above = smoothstep(-0.02, 0.12, h);
    if (uStars > 0.01) {
      // the band runs across the sky on a tilted great circle
      vec3 n = normalize(vec3(0.42, 0.35, -0.84));
      vec3 e1 = normalize(cross(n, vec3(0.0, -1.0, 0.0)));
      vec3 e2 = cross(n, e1);
      float b = dot(d, n);
      float u = atan(dot(d, e1), dot(d, e2));
      float band = exp(-b * b * 20.0);
      vec2 bp = vec2(u * 5.0, b * 22.0);
      float glowB = fbm3(bp * 0.8 + 3.0);
      float dust = smoothstep(0.4, 0.8, fbm3(bp * vec2(0.7, 1.1) + vec2(9.0, 1.0))) * exp(-b * b * 90.0);
      float core = pow(max(0.0, dot(d, normalize(e2 * 0.2 + e1 * 0.98))), 6.0);
      vec3 mw = mix(vec3(0.5, 0.58, 0.78), vec3(0.9, 0.78, 0.66), core) * band * (0.35 + glowB) * (1.0 - dust * 0.6);
      vec3 st = starLayer(d, 520.0, 0.955 - band * 0.05, px, 0.55)
              + starLayer(d, 210.0, 0.975, px * 1.15, 1.0)
              + starLayer(d, 90.0, 0.986, px * 1.4, 1.7);
      // the air near the horizon dims the faint stars
      float ext = smoothstep(0.0, 0.3, h);
      c += (mw * 0.3 * (0.4 + 0.6 * ext) + st * (0.35 + 0.65 * ext)) * uStars * above;
      // shooting stars
      for (int i = 0; i < ${MET}; i++) {
        vec4 A = uMetA[i];
        vec4 B = uMetB[i];
        if (A.w < 0.0) continue;
        float p = A.w;
        vec3 head = normalize(mix(A.xyz, B.xyz, p));
        vec3 tail = normalize(mix(A.xyz, B.xyz, max(0.0, p - 0.45)));
        vec3 ab = head - tail;
        float t = clamp(dot(d - tail, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
        float dist = length(d - (tail + ab * t));
        float w = px * (0.5 + B.w * 0.32);
        float fade = smoothstep(0.0, 0.12, p) * smoothstep(1.0, 0.7, p);
        float core = exp(-dist * dist / (w * w)) * (0.15 + 0.85 * pow(t, 1.4));
        float halo = exp(-dist / (w * 3.5)) * pow(t, 1.6) * 0.07 * B.w;
        c += vec3(0.74, 1.0, 0.94) * (core * 2.4 + halo) * fade * B.w * uStars * above;
      }
    }

    // ── the moon: a crescent with earthshine and a halo ──
    if (uMoon > 0.01) {
      vec3 m = uSunDir;
      float R = 0.036;
      float ang = acos(clamp(dot(d, m), -1.0, 1.0));
      c += vec3(0.55, 0.66, 0.9) * (exp(-ang / 0.09) * 0.12 + exp(-ang / 0.025) * 0.22) * uMoon;
      if (ang < R * 1.2) {
        vec3 t1 = normalize(cross(m, vec3(0.0, 1.0, 0.0)));
        vec3 t2 = cross(t1, m);
        vec2 q = vec2(dot(d, t1), dot(d, t2)) / R;
        float r2 = dot(q, q);
        float edge = smoothstep(1.0, 1.0 - px / R * 1.5, sqrt(r2));
        vec3 nn = vec3(q, sqrt(max(0.0, 1.0 - r2)));
        vec3 L = normalize(vec3(-0.92, -0.3, -0.2));
        float lit = smoothstep(-0.03, 0.1, dot(nn, L));
        float maria = 0.82 + 0.18 * fbm3(q * 3.0 + 4.0);
        vec3 face = mix(vec3(0.05, 0.06, 0.08), vec3(1.25, 1.22, 1.12) * maria * 2.2, lit);
        c = mix(c, face, edge * uMoon);
      }
    }

    // ── the sun's disc ──
    float disc = 0.0;
    if (uSunDisc > 0.0) {
      float ang = acos(clamp(g, -1.0, 1.0));
      float R = 0.032;
      disc = smoothstep(R, R - px * 2.0 - 0.002, ang);
      float limb = 1.0 - 0.35 * (ang / R) * (ang / R);
      c = mix(c, uSunCol * uSunDisc * limb, disc * smoothstep(-0.03, 0.01, h));
    }

    // ── clouds on a layer overhead, drifting on the wind ──
    if (uCover > 0.01 && h > -0.05) {
      float y = max(h, 0.0) + 0.07;
      vec2 uv = d.xz / y * 0.75 + uWind * uTime;
      #ifdef WARP
        vec2 w = vec2(fbm3(uv * 0.45 + 3.1), fbm3(uv * 0.45 + 7.7));
        uv += (w - 0.5) * 1.8;
      #endif
      float n = fbm(uv * 1.05);
      float edgeN = 1.0 - uCover;
      float dens = smoothstep(edgeN - 0.07, edgeN + 0.25, n) * smoothstep(-0.03, 0.12, h);
      // a step towards the light: thicker there = this side in shade
      vec2 ls = normalize(uSunDir.xz + vec2(1e-4)) * 0.16;
      float n2 = fbm(uv * 1.05 + ls);
      float shade = clamp(0.55 + (n - n2) * 3.2, 0.0, 1.0);
      float thin = clamp(dens * (1.0 - dens) * 4.0, 0.0, 1.0);
      vec3 cc = mix(uCloudDark, uCloudLit, shade);
      cc += uCloudRim * (thin * 1.2 + shade * 0.2) * (pow(g, 8.0) * 1.1 + pow(g, 2.0) * 0.22);
      // far clouds fade into the haze on the horizon
      cc = mix(cc, uHorizon, smoothstep(0.28, 0.0, h) * 0.55);
      // lightning inside the clouds
      // lightning lights the clouds round the strike, the rest of the deck only a little
      float fl = uFlash * (0.1 + 0.9 * pow(max(0.0, dot(d, uFlashDir)), 10.0));
      cc += vec3(0.72, 0.8, 1.0) * fl * (0.3 + 1.3 * shade * shade) * 1.6;
      c = mix(c, cc, dens * 0.96);
    } else {
      c += vec3(0.72, 0.8, 1.0) * uFlash * 0.12 * above;
    }
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** A soft ribbon's cross-section for the bolts: bright core, wide faint glow. */
const BOLT_FRAG = /* glsl */ `
  uniform float uK;
  varying float vU;
  varying float vW;
  void main() {
    float x = abs(vU);
    float core = exp(-x * x * 60.0);
    float glow = exp(-x * 3.5) * 0.22;
    gl_FragColor = vec4(vec3(0.78, 0.85, 1.0) * (core * 6.0 * vW + glow) * uK, 1.0);
  }`;
const BOLT_VERT = /* glsl */ `
  attribute float aU;
  attribute float aW;
  varying float vU;
  varying float vW;
  void main() {
    vU = aU;
    vW = aW;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private bolt: THREE.Mesh;
  private boltMat: THREE.ShaderMaterial;
  private meteors: Meteor[] = [];
  private nextMeteor = 6;
  private radiant = new THREE.Vector3();
  private strike: Strike | null = null;
  private nextStrike = 8;
  private storm = 0;
  private starK = 0;
  private quality = 'high';
  /** dev: hold a strike at this moment (s) for a screenshot */
  hold: number | null = null;
  private aim: THREE.Vector3 | null = null;
  /** Settings → Shooting stars */
  meteorsOn = true;
  /** Settings → Lightning */
  lightning: LightningMode = 'on';
  /** 0..1 how bright the lightning is this frame (for the scene's light) */
  flash = 0;
  /** a strike's thunder: how far away (m) and how long until it's heard (s) */
  onThunder: ((dist: number, delay: number) => void) | null = null;
  private rand: () => number;

  constructor(scene: THREE.Scene) {
    const mk = () => Array.from({ length: MET }, () => new THREE.Vector4(0, 1, 0, -1));
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      defines: { OCT: 5, WARP: 1 },
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGlow: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: { value: new THREE.Color() },
        uSunDisc: { value: 0 },
        uMoon: { value: 0 },
        uTime: { value: 0 },
        uCover: { value: 0.4 },
        uStars: { value: 0 },
        uFlash: { value: 0 },
        uFlashDir: { value: new THREE.Vector3(0, 0.3, 1).normalize() },
        uCloudLit: { value: new THREE.Color() },
        uCloudDark: { value: new THREE.Color() },
        uCloudRim: { value: new THREE.Color() },
        uWind: { value: new THREE.Vector2(0.006, 0.0025) },
        uMetA: { value: mk() },
        uMetB: { value: mk() },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(8500, 64, 32), this.mat);
    // 4G.2: drawn after everything solid, so the (fairly heavy) sky shader only runs on pixels
    // where sky actually shows; the hills, stands and cars in front are skipped by the depth test
    this.mesh.renderOrder = 100000;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.boltMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uK: { value: 0 } },
      vertexShader: BOLT_VERT,
      fragmentShader: BOLT_FRAG,
    });
    this.bolt = new THREE.Mesh(new THREE.BufferGeometry(), this.boltMat);
    this.bolt.frustumCulled = false;
    this.bolt.visible = false;
    this.bolt.renderOrder = -4;
    scene.add(this.bolt);
    let s = (Date.now() % 100000) + 7;
    this.rand = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    this.pickRadiant();
  }

  /** The look for the current weather and time (cheap; call when they change). */
  setLook(l: SkyLook, sunDir: THREE.Vector3): void {
    const u = this.mat.uniforms;
    (u.uTop.value as THREE.Color).setHex(l.top);
    (u.uHorizon.value as THREE.Color).setHex(l.horizon);
    (u.uGlow.value as THREE.Color).setHex(l.glow);
    (u.uSunCol.value as THREE.Color).setHex(l.sunCol);
    (u.uCloudLit.value as THREE.Color).setHex(l.cloudLit);
    (u.uCloudDark.value as THREE.Color).setHex(l.cloudDark);
    (u.uCloudRim.value as THREE.Color).setHex(l.cloudRim);
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    u.uSunDisc.value = l.sunDisc;
    u.uMoon.value = l.moon;
    u.uCover.value = l.cover;
    u.uStars.value = l.stars;
    this.starK = l.stars;
  }

  /** 0..1 a thunderstorm (lightning); 0 = none */
  setStorm(k: number): void {
    this.storm = k;
  }

  setQuality(q: string): void {
    if (q === this.quality) return;
    this.quality = q;
    const low = q === 'low';
    this.mat.defines = low ? { OCT: 3 } : { OCT: q === 'medium' ? 4 : 5, WARP: 1 };
    this.mat.needsUpdate = true;
  }

  /** for the reflection map: no flashes or shooting stars baked in */
  quiet<T>(fn: () => T): T {
    const u = this.mat.uniforms;
    const f = u.uFlash.value;
    const a = (u.uMetA.value as THREE.Vector4[]).map((v) => v.w);
    u.uFlash.value = 0;
    for (const v of u.uMetA.value as THREE.Vector4[]) v.w = -1;
    try {
      return fn();
    } finally {
      u.uFlash.value = f;
      (u.uMetA.value as THREE.Vector4[]).forEach((v, i) => (v.w = a[i]));
    }
  }

  private pickRadiant(): void {
    const a = this.rand() * Math.PI * 2;
    this.radiant.set(Math.cos(a) * 0.55, 0.8, Math.sin(a) * 0.55).normalize();
  }

  /** a shooting star leaving the radiant; `shower`: one of a group, brighter and longer */
  private spawnMeteor(shower: boolean, near?: THREE.Vector3): void {
    if (this.meteors.length >= MET) return;
    const R = this.radiant;
    const a = new THREE.Vector3();
    for (let k = 0; k < 20; k++) {
      if (near) a.copy(near).add(new THREE.Vector3((this.rand() - 0.5) * 0.35, (this.rand() - 0.5) * 0.2, (this.rand() - 0.5) * 0.35));
      else a.copy(R).add(new THREE.Vector3((this.rand() - 0.5) * 1.6, (this.rand() - 0.5) * 0.8, (this.rand() - 0.5) * 1.6));
      a.normalize();
      if (a.y > 0.3 && a.angleTo(R) > 0.15) break;
    }
    const t = a.clone().sub(R.clone().multiplyScalar(a.dot(R))).normalize();
    const len = shower ? 0.22 + this.rand() * 0.2 : 0.08 + this.rand() * 0.18;
    const b = a.clone().addScaledVector(t, len).normalize();
    this.meteors.push({ a, b, t: 0, dur: shower ? 1.1 + this.rand() * 0.6 : 0.45 + this.rand() * 0.6, bright: shower ? 2.2 + this.rand() : 0.8 + this.rand() * 1.4 });
  }

  /** several from the same part of the sky, close together, one after another */
  private shower(at?: THREE.Vector3): void {
    const c = at ? at.clone().normalize() : this.radiant.clone().add(new THREE.Vector3((this.rand() - 0.5) * 0.9, -0.25, (this.rand() - 0.5) * 0.9)).normalize();
    const n = 3 + Math.floor(this.rand() * 3);
    const had = this.meteors.length;
    for (let i = 0; i < n; i++) this.spawnMeteor(true, c);
    for (let i = had; i < this.meteors.length; i++) this.meteors[i].t = -(i - had) * 0.12;
  }

  /** Per frame: clouds drift, shooting stars, lightning. Returns the flash (0..1). */
  update(dt: number, time: number, cam: THREE.Vector3): number {
    const u = this.mat.uniforms;
    u.uTime.value = time % 3000;
    this.mesh.position.copy(cam);
    // ── shooting stars (clear nights) ──
    if (this.starK > 0.5 && this.meteorsOn && this.quality !== 'low' && dt > 0) {
      this.nextMeteor -= dt;
      if (this.nextMeteor <= 0) {
        if (this.rand() < 0.12) {
          this.shower();
          this.nextMeteor = 14 + this.rand() * 14;
        } else {
          this.spawnMeteor(false);
          this.nextMeteor = 3.5 + this.rand() * 10;
        }
        if (this.rand() < 0.1) this.pickRadiant();
      }
    }
    if (this.hold === null) for (const m of this.meteors) m.t += dt / m.dur;
    this.meteors = this.meteors.filter((m) => m.t < 1);
    const A = u.uMetA.value as THREE.Vector4[];
    const B = u.uMetB.value as THREE.Vector4[];
    for (let i = 0; i < MET; i++) {
      const m = this.meteors[i];
      if (m && m.t >= 0) {
        A[i].set(m.a.x, m.a.y, m.a.z, m.t);
        B[i].set(m.b.x, m.b.y, m.b.z, m.bright);
      } else A[i].w = -1;
    }

    // ── lightning ──
    this.flash = 0;
    let boltK = 0;
    if (this.storm > 0.05 && this.lightning !== 'off' && dt > 0) {
      this.nextStrike -= dt * (0.4 + this.storm);
      if (!this.strike && this.nextStrike <= 0) {
        this.nextStrike = 6 + this.rand() * 14;
        const az = this.aim ? Math.atan2(this.aim.x, this.aim.z) : this.rand() * Math.PI * 2;
        const dist = this.aim ? 1300 : 500 + this.rand() * 1700;
        const bolt = this.aim ? true : dist < 2600 && this.rand() < 0.75;
        this.aim = null;
        const strokes = [0];
        const n = 1 + Math.floor(this.rand() * 3);
        for (let i = 0; i < n; i++) strokes.push(strokes[strokes.length - 1] + 0.06 + this.rand() * 0.14);
        const dir = new THREE.Vector3(Math.sin(az), 0, Math.cos(az));
        this.strike = { t: 0, strokes, dir, dist, bolt, amp: (bolt ? 1 : 0.55) * (0.7 + 0.3 * (1 - dist / 3100)) };
        if (bolt) this.buildBolt(cam, dir, dist);
        this.onThunder?.(dist, Math.min(9, dist / 343));
        (u.uFlashDir.value as THREE.Vector3).set(dir.x, bolt ? 0.12 : 0.3, dir.z).normalize();
      }
      const s = this.strike;
      if (s) {
        s.t = this.hold ?? s.t + dt;
        let f = 0;
        for (const st of s.strokes) {
          const k = s.t - st;
          if (k >= 0) f = Math.max(f, Math.exp(-k / 0.055) * (k < 0.012 ? k / 0.012 : 1));
        }
        const soft = this.lightning === 'soft' ? 0.35 : 1;
        this.flash = f * s.amp * soft;
        boltK = f * soft;
        if (s.t > s.strokes[s.strokes.length - 1] + 0.5) this.strike = null;
        this.bolt.visible = s.bolt && boltK > 0.03;
      } else this.bolt.visible = false;
    } else {
      this.strike = null;
      this.bolt.visible = false;
    }
    u.uFlash.value = this.flash;
    this.boltMat.uniforms.uK.value = boltK;
    return this.flash;
  }

  /** A forked bolt from the cloud base down to the ground, `dist` m away towards `dir`. */
  private buildBolt(cam: THREE.Vector3, dir: THREE.Vector3, dist: number): void {
    const r = this.rand;
    const ground = new THREE.Vector3(cam.x + dir.x * dist, 0, cam.z + dir.z * dist);
    const top = ground.clone().add(new THREE.Vector3((r() - 0.5) * 160, 480 + r() * 160, (r() - 0.5) * 160));
    // jagged path: split each segment and push its middle sideways, again and again
    const jag = (a: THREE.Vector3, b: THREE.Vector3, levels: number, rough: number): THREE.Vector3[] => {
      let pts = [a, b];
      for (let l = 0; l < levels; l++) {
        const next: THREE.Vector3[] = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i - 1];
          const q = pts[i];
          const len = p.distanceTo(q);
          const mid = p.clone().lerp(q, 0.4 + r() * 0.2);
          mid.x += (r() - 0.5) * len * rough;
          mid.z += (r() - 0.5) * len * rough;
          mid.y += (r() - 0.5) * len * rough * 0.3;
          next.push(mid, q);
        }
        pts = next;
      }
      return pts;
    };
    const main = jag(top, ground, 6, 0.55);
    const paths: { pts: THREE.Vector3[]; w: number }[] = [{ pts: main, w: 1 }];
    const nb = 2 + Math.floor(r() * 4);
    for (let i = 0; i < nb; i++) {
      const at = Math.floor(main.length * (0.1 + r() * 0.55));
      const s = main[at];
      const lenB = (s.y - 0) * (0.35 + r() * 0.45);
      const e = s.clone().add(new THREE.Vector3((r() - 0.5) * lenB * 1.2, -lenB * (0.6 + r() * 0.4), (r() - 0.5) * lenB * 1.2));
      paths.push({ pts: jag(s, e, 5, 0.6), w: 0.45 });
    }
    // ribbons facing the camera
    const pos: number[] = [];
    const us: number[] = [];
    const ws: number[] = [];
    const idx: number[] = [];
    const side = new THREE.Vector3();
    const view = new THREE.Vector3();
    for (const p of paths) {
      const width = (9 + dist * 0.004) * p.w;
      for (let i = 1; i < p.pts.length; i++) {
        const a = p.pts[i - 1];
        const b = p.pts[i];
        view.copy(a).add(b).multiplyScalar(0.5).sub(cam);
        side.copy(b).sub(a).cross(view).normalize().multiplyScalar(width);
        const base = pos.length / 3;
        pos.push(a.x - side.x, a.y - side.y, a.z - side.z, a.x + side.x, a.y + side.y, a.z + side.z, b.x - side.x, b.y - side.y, b.z - side.z, b.x + side.x, b.y + side.y, b.z + side.z);
        us.push(-1, 1, -1, 1);
        ws.push(p.w, p.w, p.w, p.w);
        idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aU', new THREE.Float32BufferAttribute(us, 1));
    g.setAttribute('aW', new THREE.Float32BufferAttribute(ws, 1));
    g.setIndex(idx);
    this.bolt.geometry.dispose();
    this.bolt.geometry = g;
  }

  /** dev / screenshots: a lightning strike now, a shower of shooting stars, or one */
  test(kind: 'strike' | 'shower' | 'meteor', aim?: THREE.Vector3): void {
    if (kind === 'strike') {
      this.nextStrike = 0;
      this.strike = null;
      this.aim = aim ? aim.clone().setY(0).normalize() : null;
    } else if (kind === 'shower') {
      this.meteors.length = 0;
      if (aim) this.radiant.copy(aim).add(new THREE.Vector3(0, 0.6, 0)).normalize();
      this.shower(aim);
      for (const m of this.meteors) m.t = Math.max(m.t, 0) + 0.45; // mid-flight
    } else this.spawnMeteor(false);
  }
}
