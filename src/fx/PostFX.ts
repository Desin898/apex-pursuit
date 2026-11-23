// ─────────────────────────────────────────────────────────────────────────────
// PostFX — the "cinematic" pass chain:
//   scene (HDR, MSAA) → bloom → speed pass (radial blur, chromatic aberration, speed lines,
//   teal/orange grade, vignette, grain) → ACES tone mapping + sRGB.
// Quality presets switch pieces of it off for slower machines.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { LENS } from '../config';

const SpeedShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uSpeed: { value: 0 }, // 0..1 how fast
    uBoost: { value: 0 }, // 0..1 nitrous
    uImpact: { value: 0 }, // 0..1 flash on big hits
    uAspect: { value: 1 },
    uBlur: { value: 1 }, // 0 disables the radial blur taps (cheaper)
    uShadowTint: { value: new THREE.Vector3(0.86, 1.0, 1.1) },
    uHighTint: { value: new THREE.Vector3(1.1, 1.0, 0.88) },
    uSat: { value: 1.12 },
    uLensCA: { value: 0 },
    uDrops: { value: 0 }, // 0..1 raindrops on the lens
    uDropRun: { value: 0 }, // 0..1 how fast they run off (speed)
    uDropLayers: { value: 1 },
    uDropDensity: { value: 0.12 }, // (unused since 4B.2)
    uFlick: { value: 0 }, // 0..1 a gust or nitrous flicking drops off
    // 4G: lens dirt: smudges and specks that light up where the bloom is (sun, floodlights, lightning)
    tBloom: { value: null as THREE.Texture | null },
    tDirt: { value: null as THREE.Texture | null },
    uDirt: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tBloom, tDirt;
    uniform float uLensCA, uDirt;
    uniform float uTime, uSpeed, uBoost, uImpact, uAspect, uBlur, uSat, uDrops, uDropRun, uDropLayers, uDropDensity, uFlick;
    uniform vec3 uShadowTint, uHighTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    // Raindrops on the lens (4B.2). Each drop is a small lens: inside it the scene is seen
    // shrunk and flipped (sampled from the far side of the drop), a little softer, with a soft
    // bright rim on the side facing the light. Never a dark outline.
    // - Beads: many small ones, scattered (High and Ultra).
    // - Drops: medium and large ones in tall columns. They gather, and once big enough they
    //   slide slowly DOWN, wobbling, leaving a thin wet trail that fades.
    // - Speed never pushes them sideways: it only makes them arrive faster and makes the big
    //   ones near the edges tremble.
    // - The middle of the screen only ever gets a light covering; the edges and corners take most.
    // Returns the sample offset (xy, uv units), drop coverage (z) and highlight (w).
    vec4 dropDisc(vec2 d, float rad, float tear) {
      d.y *= mix(1.0, 0.82, tear); // a sliding drop is a little taller (a tear)
      float q = length(d) / rad;
      if (q >= 1.0) return vec4(0.0);
      float k = smoothstep(1.0, 0.78, q);
      vec2 n = d / rad;
      vec2 off = -n * rad * 1.6 * k; // seen through it: shrunk and flipped
      // soft rim on the upper (lit) side, a small glint low down
      float rim = smoothstep(0.6, 0.97, q) * max(0.0, dot(normalize(n + 1e-4), vec2(-0.35, 0.94)));
      float glint = smoothstep(0.3, 0.0, length(n - vec2(0.2, -0.45)));
      return vec4(off, k, (rim * 0.3 + glint * 0.22) * k);
    }
    vec4 drops(vec2 uv) {
      vec2 p = uv * vec2(uAspect, 1.0); // square units: 1 = screen height
      vec2 c = (uv - 0.5) * vec2(uAspect, 1.0);
      float edge = smoothstep(0.16, 0.62, length(c));
      float wet = uDrops * mix(${LENS.centre.toFixed(2)}, 1.0, edge); // light in the middle, heavy at the edges
      float size = smoothstep(0.0, 0.35, uDrops); // they shrink away as they dry
      vec2 off = vec2(0.0);
      float m = 0.0;
      float hl = 0.0;
      if (wet < 0.01) return vec4(0.0);
      float rate = 1.0 + uDropRun * 1.6; // you drive into the rain: drops come faster
      // ── medium and large drops in columns 0.16 wide, 0.5 tall ──
      for (int layer = 0; layer < 2; layer++) {
        vec2 cell = layer == 0 ? vec2(0.11, 0.4) : vec2(0.075, 0.27);
        vec2 g = (p + vec2(layer == 0 ? 0.0 : 0.05, 0.0)) / cell;
        vec2 id = floor(g) + float(layer) * 31.0;
        vec2 f = fract(g) * cell; // position in the cell, square units
        float h = hash(id);
        if (h > wet * 0.95) continue;
        if (hash(id + 71.3) < uFlick * 0.6) continue; // a gust or nitrous flicks some off
        float big = hash(id + 9.1);
        float life = fract(uTime * (0.03 + 0.03 * hash(id + 2.2)) * rate + h * 13.0);
        float grow = smoothstep(0.0, 0.18, life) * (1.0 - smoothstep(0.92, 1.0, life));
        float rad = (0.007 + 0.016 * big * big) * (layer == 0 ? 1.0 : 0.65) * grow * size;
        if (rad < 0.002) continue;
        // the bigger ones slide down once they are heavy enough
        float slide = big > 0.55 ? smoothstep(0.4, 1.0, life) : 0.0;
        vec2 ctr = vec2((0.22 + 0.56 * hash(id + 1.3)) * cell.x, (0.78 - 0.1 * hash(id + 5.5)) * cell.y);
        ctr.y -= slide * slide * cell.y * 0.72;
        ctr.x += sin(life * 21.0 + h * 40.0) * 0.004 * slide; // wobbles as it runs
        ctr.x += sin(uTime * 37.0 + h * 20.0) * 0.0012 * uDropRun * edge * big; // trembles at speed, near the edges
        vec4 dd = dropDisc(f - ctr, rad, slide);
        off += dd.xy;
        m = max(m, dd.z);
        hl += dd.w;
        // the wet trail it leaves above it
        if (slide > 0.0) {
          vec2 t = f - ctr;
          float trailTop = slide * slide * cell.y * 0.72;
          if (t.y > 0.0 && t.y < trailTop) {
            float w = smoothstep(rad * 0.45, rad * 0.1, abs(t.x)) * (1.0 - t.y / trailTop) * 0.6;
            off.x += -sign(t.x) * w * 0.0025;
            m = max(m, w * 0.35);
          }
        }
      }
      // ── beads: lots of tiny ones (High and Ultra) ──
      if (uDropLayers > 1.5) {
        vec2 cell = vec2(0.024);
        vec2 g = p / cell;
        vec2 id = floor(g) + 97.0;
        vec2 f = fract(g) * cell;
        float h = hash(id);
        if (h < wet * 0.8 && hash(id + 71.3) >= uFlick * 0.6) {
          float life = fract(uTime * 0.05 * rate + h * 7.0);
          float rad = (0.0025 + 0.004 * hash(id + 4.4)) * smoothstep(0.0, 0.2, life) * (1.0 - smoothstep(0.85, 1.0, life)) * size;
          vec2 ctr = (0.25 + 0.5 * vec2(hash(id + 3.1), hash(id + 7.7))) * cell;
          vec4 dd = dropDisc(f - ctr, rad, 0.0);
          off += dd.xy;
          m = max(m, dd.z);
          hl += dd.w;
        }
      }
      return vec4(off.x / uAspect, off.y, m, hl);
    }
    void main() {
      vec4 dr = uDrops > 0.001 ? drops(vUv) : vec4(0.0);
      vec2 uv = vUv - dr.xy;
      vec2 c = uv - 0.5;
      float r = length(c * vec2(uAspect, 1.0));
      vec2 dir = c;
      // Radial blur: stronger towards the edges, driven by speed and nitrous
      float amt = (0.012 * uSpeed * uSpeed + 0.035 * uBoost) * smoothstep(0.12, 0.8, r);
      vec3 col;
      if (uBlur > 0.5 && amt > 0.0004) {
        col = vec3(0.0);
        float j = hash(uv * 913.0 + uTime) - 0.5;
        for (int i = 0; i < 8; i++) {
          float t = (float(i) + j) / 8.0;
          col += texture2D(tDiffuse, uv - dir * amt * t * 2.0).rgb;
        }
        col /= 8.0;
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }
      // Chromatic aberration at boost speed
      float ca = (0.0008 * uSpeed + 0.0032 * uBoost + 0.004 * uImpact) * smoothstep(0.1, 0.75, r) + uLensCA * smoothstep(0.3, 0.95, r); // 4C: a real lens fringes a little at the edges
      if (ca > 0.0002) {
        col.r = mix(col.r, texture2D(tDiffuse, uv + dir * ca).r, 0.85);
        col.b = mix(col.b, texture2D(tDiffuse, uv - dir * ca).b, 0.85);
      }
      // Lens dirt: only shows where bright light reaches the lens
      if (uDirt > 0.001) {
        vec3 bl = texture2D(tBloom, vUv).rgb;
        col += bl * texture2D(tDirt, vUv).rgb * uDirt;
      }
      // Speed lines: thin radial streaks flickering at the screen edges
      float ang = atan(c.y, c.x);
      float seg = floor(ang * 46.0);
      float flick = hash(vec2(seg, floor(uTime * 24.0)));
      float streak = step(0.86, flick) * smoothstep(0.38, 0.95, r + hash(vec2(seg, 3.0)) * 0.25);
      float lines = streak * (0.55 * smoothstep(0.55, 1.0, uSpeed) + 0.9 * uBoost);
      col += vec3(0.9, 0.95, 1.0) * lines * 0.22;
      // Grade: lift shadows towards teal, push highlights warm (dusk look)
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col *= mix(uShadowTint, uHighTint, smoothstep(0.02, 0.9, l));
      col = mix(vec3(l), col, uSat);
      // inside a drop: a little softer, a touch brighter, and its rim highlight
      if (dr.z > 0.01) {
        vec3 soft = (texture2D(tDiffuse, uv + vec2(0.0025, 0.0)).rgb + texture2D(tDiffuse, uv - vec2(0.0025, 0.0)).rgb
                   + texture2D(tDiffuse, uv + vec2(0.0, 0.0035)).rgb + texture2D(tDiffuse, uv - vec2(0.0, 0.0035)).rgb) * 0.25;
        soft *= mix(uShadowTint, uHighTint, smoothstep(0.02, 0.9, dot(soft, vec3(0.2126, 0.7152, 0.0722))));
        col = mix(col, soft, dr.z * 0.55) * (1.0 + dr.z * 0.05);
        // a drop in front of a bright light glows (a soft bokeh bloom)
        float sl = dot(soft, vec3(0.2126, 0.7152, 0.0722));
        col += soft * smoothstep(0.55, 1.6, sl) * dr.z * 0.9;
        col += vec3(0.85, 0.92, 1.0) * dr.w * (0.25 + l * 0.6);
      }
      // Cool tint while the nitrous is burning
      col = mix(col, col * vec3(0.86, 0.96, 1.2), uBoost * 0.35);
      // Vignette (tightens with speed) and impact flash
      float vig = smoothstep(1.05, 0.25, r * (1.0 + 0.25 * uSpeed + 0.2 * uBoost));
      col *= mix(0.42, 1.0, vig);
      col += vec3(1.0, 0.85, 0.7) * uImpact * 0.12;
      // Film grain (in linear, scaled by luminance so blacks stay clean)
      col += (hash(vUv * vec2(1920.0, 1080.0) + uTime * 60.0) - 0.5) * 0.035 * (0.3 + l);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

// Safety net in front of the bloom: any NaN / infinite / absurdly bright pixel a material might
// produce is replaced before the blur can spread it across the screen.
/**
 * Camera motion blur from the depth buffer: each pixel is put back into world space and
 * projected with last frame's camera. Pixels on a car use that car's own motion instead, so the
 * car you follow stays sharp while the scenery streaks past.
 */
const MotionBlurShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uInvViewProj: { value: new THREE.Matrix4() },
    uPrevViewProj: { value: new THREE.Matrix4() },
    uCars: { value: Array.from({ length: 12 }, () => new THREE.Vector4(0, -999, 0, 0)) },
    uCarDelta: { value: Array.from({ length: 12 }, () => new THREE.Vector3()) },
    uAmount: { value: 0.5 },
    uCamPos: { value: new THREE.Vector3() },
    uSharpNear: { value: 0 }, // metres round the camera kept sharp (the cockpit moves with you)
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tDepth;
    uniform mat4 uInvViewProj, uPrevViewProj;
    uniform vec4 uCars[12];
    uniform vec3 uCarDelta[12];
    uniform float uAmount, uSharpNear;
    uniform vec3 uCamPos;
    varying vec2 vUv;
    void main() {
      float d = texture2D(tDepth, vUv).r;
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      if (d >= 0.99999 || uAmount <= 0.0) { gl_FragColor = vec4(base, 1.0); return; }
      vec4 w = uInvViewProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
      vec3 world = w.xyz / w.w;
      if (distance(world, uCamPos) < uSharpNear) { gl_FragColor = vec4(base, 1.0); return; }
      // on a car? then it moved with that car
      for (int i = 0; i < 12; i++) {
        vec4 c = uCars[i];
        if (c.w > 0.0 && distance(world, c.xyz) < c.w) { world -= uCarDelta[i]; break; }
      }
      vec4 p = uPrevViewProj * vec4(world, 1.0);
      vec2 prev = p.xy / p.w * 0.5 + 0.5;
      vec2 vel = (vUv - prev) * uAmount;
      float l = length(vel);
      if (l > 0.035) vel *= 0.035 / l;
      if (l < 0.0008) { gl_FragColor = vec4(base, 1.0); return; }
      vec3 acc = base;
      for (int i = 1; i < 8; i++) {
        float t = float(i) / 7.0 - 0.5;
        acc += texture2D(tDiffuse, vUv - vel * t).rgb;
      }
      gl_FragColor = vec4(acc / 8.0, 1.0);
    }`,
};

/** Photo mode depth of field: a gather blur sized by distance from the focus plane. */
const DofShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uNear: { value: 0.1 },
    uFar: { value: 2000 },
    uFocus: { value: 8 },
    uAperture: { value: 0.5 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tDepth;
    uniform float uNear, uFar, uFocus, uAperture, uAspect;
    varying vec2 vUv;
    float viewZ(vec2 uv) {
      float d = texture2D(tDepth, uv).r * 2.0 - 1.0;
      return 2.0 * uNear * uFar / (uFar + uNear - d * (uFar - uNear));
    }
    void main() {
      float z = viewZ(vUv);
      float coc = clamp(abs(z - uFocus) / max(z, 0.1) * uAperture * 0.06, 0.0, 0.025);
      vec3 acc = texture2D(tDiffuse, vUv).rgb;
      float wsum = 1.0;
      for (int i = 0; i < 24; i++) {
        float a = float(i) * 2.39996;
        float r = sqrt(float(i) / 24.0);
        vec2 o = vec2(cos(a), sin(a)) * r * coc * vec2(1.0 / uAspect, 1.0);
        float zz = viewZ(vUv + o);
        float cc = clamp(abs(zz - uFocus) / max(zz, 0.1) * uAperture * 0.06, 0.0, 0.025);
        float w = zz < z ? smoothstep(0.0, coc + 0.0001, cc) + 0.2 : 1.0; // sharp things in front don't bleed
        acc += texture2D(tDiffuse, vUv + o).rgb * w;
        wsum += w;
      }
      gl_FragColor = vec4(acc / wsum, 1.0);
    }`,
};

/** Draws the scene into its own target (colour + depth) and hands the colour on. */
class ScenePass extends Pass {
  readonly rt: THREE.WebGLRenderTarget;
  private copy = new FullScreenQuad(new THREE.ShaderMaterial({ ...CopyShader, uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms), depthTest: false, depthWrite: false }));
  /** called just before the scene is drawn (planar reflections render here) */
  before: (() => void) | null = null;
  constructor(private scene: THREE.Scene, private camera: THREE.Camera, w: number, h: number, samples: number) {
    super();
    this.needsSwap = false;
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples });
    this.rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
  }
  setSize(w: number, h: number): void {
    this.rt.setSize(w, h);
  }
  render(renderer: THREE.WebGLRenderer, _w: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.before?.();
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    (this.copy.material as THREE.ShaderMaterial).uniforms.tDiffuse.value = this.rt.texture;
    renderer.setRenderTarget(readBuffer);
    this.copy.render(renderer);
  }
  dispose(): void {
    this.rt.dispose();
    this.copy.dispose();
  }
}

const SanitizeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // comparisons with NaN are always false, so this catches NaN as well as negatives
      if (!(c.r >= 0.0)) c.r = 0.0;
      if (!(c.g >= 0.0)) c.g = 0.0;
      if (!(c.b >= 0.0)) c.b = 0.0;
      gl_FragColor = vec4(min(c, vec3(48.0)), 1.0);
    }`,
};

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
/**
 * Graphics presets. reflect: wet-road mirror resolution (share of the screen, 0 = light streaks
 * only); probe: paint reflection cube size; farShadow: baked distant shadows; ao: ambient
 * occlusion; motionBlur: camera motion blur from the depth buffer; aniso: texture filtering.
 */
export const QUALITY: Record<Quality, { pixelRatio: number; shadows: number; bloom: boolean; blur: boolean; msaa: number; composer: boolean; reflect: number; probe: number; farShadow: boolean; ao: boolean; motionBlur: boolean; aniso: number; smoke: number }> = {
  low: { pixelRatio: 0.75, shadows: 0, bloom: false, blur: false, msaa: 0, composer: false, reflect: 0, probe: 0, farShadow: false, ao: false, motionBlur: false, aniso: 2, smoke: 0.7 },
  medium: { pixelRatio: 1, shadows: 1024, bloom: true, blur: false, msaa: 0, composer: true, reflect: 0.3, probe: 0, farShadow: true, ao: false, motionBlur: false, aniso: 4, smoke: 1 },
  high: { pixelRatio: 1.25, shadows: 2048, bloom: true, blur: true, msaa: 4, composer: true, reflect: 0.45, probe: 128, farShadow: true, ao: false, motionBlur: true, aniso: 8, smoke: 1.3 },
  ultra: { pixelRatio: 1.5, shadows: 4096, bloom: true, blur: true, msaa: 4, composer: true, reflect: 0.6, probe: 256, farShadow: true, ao: true, motionBlur: true, aniso: 16, smoke: 1.5 },
};

/** 4G: a lens with a few smudges, specks and soft bokeh rings on it (made once, on a canvas). */
function lensDirtTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 288;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  let seed = 1234;
  const r = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  g.globalCompositeOperation = 'lighter';
  // big soft smudges (fingerprints, dried rain), heavier towards the edges
  for (let i = 0; i < 26; i++) {
    const x = r() * W;
    const y = r() * H;
    const edge = Math.min(1, Math.hypot(x / W - 0.5, y / H - 0.5) * 2.2);
    const rad = 20 + r() * 70;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const a = (0.05 + r() * 0.1) * (0.35 + edge);
    gr.addColorStop(0, `rgba(255,248,235,${a})`);
    gr.addColorStop(1, 'rgba(255,248,235,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(x, y, rad, rad * (0.5 + r() * 0.6), r() * 3.14, 0, Math.PI * 2);
    g.fill();
  }
  // bokeh rings: brighter edge, faint middle
  for (let i = 0; i < 40; i++) {
    const x = r() * W;
    const y = r() * H;
    const rad = 3 + r() * 12;
    const a = 0.08 + r() * 0.18;
    const gr = g.createRadialGradient(x, y, rad * 0.55, x, y, rad);
    gr.addColorStop(0, `rgba(230,240,255,${a * 0.35})`);
    gr.addColorStop(0.85, `rgba(230,240,255,${a})`);
    gr.addColorStop(1, 'rgba(230,240,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  // specks of dust
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(255,255,255,${0.1 + r() * 0.35})`;
    g.fillRect(r() * W, r() * H, 1 + r() * 1.5, 1 + r() * 1.5);
  }
  // a couple of wiped streaks
  g.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    g.strokeStyle = `rgba(255,250,240,${0.04 + r() * 0.05})`;
    g.lineWidth = 6 + r() * 14;
    g.beginPath();
    const x = r() * W;
    const y = r() * H;
    g.moveTo(x, y);
    g.quadraticCurveTo(x + (r() - 0.5) * 200, y + (r() - 0.5) * 80, x + (r() - 0.5) * 300, y + (r() - 0.5) * 120);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class PostFX {
  private composer: EffectComposer | null = null;
  private scenePass: ScenePass | null = null;
  private motion: ShaderPass | null = null;
  private dof: ShaderPass | null = null;
  private gtao: GTAOPass | null = null;
  private prevViewProj = new THREE.Matrix4();
  private hasPrev = false;
  /** photo mode depth of field (null = off) */
  photoDof: { focus: number; aperture: number } | null = null;
  /** cars for the motion blur: centre + radius, and how far each moved since last frame */
  carMotion: { x: number; y: number; z: number; r: number; dx: number; dy: number; dz: number }[] = [];
  /** called before the scene is drawn each frame (planar reflections) */
  beforeScene: (() => void) | null = null;
  private quality: Quality = 'high';
  private bloom: UnrealBloomPass | null = null;
  private speed: ShaderPass | null = null;
  private useComposer = true;
  private w = 1;
  private h = 1;
  private bloomBase = 0.42;
  /** 0/1: the slight edge fringe (Settings → Lens fringe) */
  lensCA = 1;
  /** 4G: how much the lens dirt shows (0 = clean lens); the scene sets it by time of day */
  lensDirt = 0.6;
  private dirtTex: THREE.CanvasTexture | null = null;
  /** Settings → Ambient occlusion (only used on Ultra) */
  aoOn = false;
  private grade = { shadow: new THREE.Vector3(0.86, 1.0, 1.1), high: new THREE.Vector3(1.1, 1.0, 0.88), sat: 1.12 };
  private dropAmount = 0;

  /** Colour grade and bloom strength for the current weather / time of day. */
  setLook(shadow: [number, number, number], high: [number, number, number], sat: number, bloom: number): void {
    this.grade.shadow.set(...shadow);
    this.grade.high.set(...high);
    this.grade.sat = sat;
    this.bloomBase = bloom;
  }
  /** 0..1 raindrops on the lens (needs the composer: Medium quality and up). */
  setDrops(amount: number, run = 0): void {
    this.dropAmount = amount;
    this.dropRun = run;
  }
  private dropRun = 0;
  private vpTmp = new THREE.Matrix4();
  /** 0..1: drops flicked off the lens (set on a nitrous burst or a big gust; decays) */
  flick = 0;
  /** metres round the camera that motion blur leaves alone (set in the cockpit) */
  sharpNear = 0;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera) {}

  configure(q: Quality, width: number, height: number): void {
    const cfg = QUALITY[q];
    this.useComposer = cfg.composer;
    this.composer?.dispose();
    this.composer = null;
    this.w = width;
    this.h = height;
    if (!cfg.composer) return;
    this.quality = q;
    const pr = this.renderer.getPixelRatio();
    const W = Math.max(2, Math.floor(width * pr));
    const H = Math.max(2, Math.floor(height * pr));
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
    const composer = new EffectComposer(this.renderer, rt);
    composer.setPixelRatio(pr);
    composer.setSize(width, height);
    this.scenePass?.dispose();
    this.scenePass = new ScenePass(this.scene, this.camera, W, H, cfg.msaa);
    this.scenePass.before = () => this.beforeScene?.();
    composer.addPass(this.scenePass);
    if (cfg.ao && this.aoOn) {
      this.gtao = new GTAOPass(this.scene, this.camera as THREE.PerspectiveCamera, W, H);
      this.gtao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.5, thickness: 2, scale: 1.2, samples: 8 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
      this.gtao.blendIntensity = 0.85;
      composer.addPass(this.gtao);
    } else this.gtao = null;
    composer.addPass(new ShaderPass(SanitizeShader));
    if (cfg.motionBlur) {
      this.motion = new ShaderPass(MotionBlurShader);
      this.motion.uniforms.tDepth.value = this.scenePass.rt.depthTexture;
      composer.addPass(this.motion);
    } else this.motion = null;
    this.dof = new ShaderPass(DofShader);
    this.dof.uniforms.tDepth.value = this.scenePass.rt.depthTexture;
    this.dof.enabled = false;
    composer.addPass(this.dof);
    this.hasPrev = false;
    if (cfg.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(width / 2, height / 2), 0.42, 0.55, 0.92);
      composer.addPass(this.bloom);
    } else this.bloom = null;
    this.speed = new ShaderPass(SpeedShader);
    this.speed.uniforms.uBlur.value = cfg.blur ? 1 : 0;
    this.dirtTex ??= lensDirtTexture();
    this.speed.uniforms.tDirt.value = this.dirtTex;
    this.speed.uniforms.tBloom.value = this.bloom ? (this.bloom as unknown as { renderTargetsHorizontal: THREE.WebGLRenderTarget[] }).renderTargetsHorizontal[0].texture : null;
    this.speed.uniforms.uAspect.value = width / height;
    composer.addPass(this.speed);
    composer.addPass(new OutputPass());
    // 4C: Medium has no MSAA, so smooth the edges after tone mapping with SMAA
    if (cfg.msaa === 0) composer.addPass(new SMAAPass(W, H));
    this.composer = composer;
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    if (this.composer) {
      const pr = this.renderer.getPixelRatio();
      this.composer.setPixelRatio(pr);
      this.composer.setSize(width, height);
      this.scenePass?.setSize(Math.max(2, Math.floor(width * pr)), Math.max(2, Math.floor(height * pr)));
      this.gtao?.setSize(Math.max(2, Math.floor(width * pr)), Math.max(2, Math.floor(height * pr)));
    }
    if (this.speed) this.speed.uniforms.uAspect.value = width / height;
  }

  render(time: number, speed: number, boost: number, impact: number): void {
    if (this.useComposer && this.composer && this.speed) {
      const u = this.speed.uniforms;
      u.uTime.value = time % 1000;
      u.uSpeed.value = speed;
      u.uBoost.value = boost;
      u.uImpact.value = impact;
      (u.uShadowTint.value as THREE.Vector3).copy(this.grade.shadow);
      (u.uHighTint.value as THREE.Vector3).copy(this.grade.high);
      u.uSat.value = this.grade.sat;
      u.uLensCA.value = this.lensCA * (this.quality === 'medium' ? 0.0006 : 0.0009);
      u.uDirt.value = this.bloom && this.lensCA > 0 ? this.lensDirt : 0;
      u.uDrops.value = this.dropAmount;
      u.uDropRun.value = this.dropRun;
      u.uDropLayers.value = this.quality === 'medium' ? 1 : 2;
      u.uFlick.value = this.flick;
      if (this.bloom) this.bloom.strength = this.bloomBase + boost * 0.25;
      // real motion blur takes over from most of the stylised radial blur
      u.uBlur.value = QUALITY[this.quality].blur ? 1 : 0;
      const cam = this.camera as THREE.PerspectiveCamera;
      cam.updateMatrixWorld();
      const vp = this.vpTmp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      if (this.motion) {
        const mu = this.motion.uniforms;
        (mu.uInvViewProj.value as THREE.Matrix4).copy(vp).invert();
        (mu.uPrevViewProj.value as THREE.Matrix4).copy(this.hasPrev ? this.prevViewProj : vp);
        const cars = mu.uCars.value as THREE.Vector4[];
        const del = mu.uCarDelta.value as THREE.Vector3[];
        for (let i = 0; i < 12; i++) {
          const c = this.carMotion[i];
          if (c) {
            cars[i].set(c.x, c.y, c.z, c.r);
            del[i].set(c.dx, c.dy, c.dz);
          } else cars[i].w = 0;
        }
        mu.uAmount.value = this.photoDof ? 0 : 0.55;
        (mu.uCamPos.value as THREE.Vector3).setFromMatrixPosition(cam.matrixWorld);
        mu.uSharpNear.value = this.sharpNear;
        this.motion.enabled = !this.photoDof;
        u.uSpeed.value = speed * 0.55;
      }
      this.prevViewProj.copy(vp);
      this.hasPrev = true;
      if (this.dof) {
        this.dof.enabled = !!this.photoDof;
        if (this.photoDof) {
          const du = this.dof.uniforms;
          du.uNear.value = cam.near;
          du.uFar.value = cam.far;
          du.uFocus.value = this.photoDof.focus;
          du.uAperture.value = this.photoDof.aperture;
          du.uAspect.value = this.w / this.h;
          u.uSpeed.value = 0;
          u.uBoost.value = 0;
        }
      }
      this.composer.render();
    } else {
      this.beforeScene?.();
      this.renderer.render(this.scene, this.camera);
    }
  }
}
