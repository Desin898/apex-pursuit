// ─────────────────────────────────────────────────────────────────────────────
// 5D: snow on the cars.
//
// While it snows, snow settles on every car's upward-facing panels (bonnet, roof, wing, the tops of
// the wings and bumpers) and builds up over the race: the heavier the snowfall, the faster it
// grows. A race in the snow starts with the cars already dusted (they waited on the grid). At
// speed the wind takes a little of it back, so it never grows without limit. Low on the doors and
// sills, slush thrown up by the tyres streaks the paint. Out of the snow there is none.
//
// It is one shared amount (uCarSnow, 0..1) and a shader layer added to the car materials, so it
// costs nothing on the CPU and a handful of instructions per pixel on the cars only.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';

export const carSnowUniforms = {
  /** 0..1 how much snow lies on the cars */
  uCarSnow: { value: 0 },
};

const NOISE = /* glsl */ `
float snH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float snN(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(snH(i), snH(i + vec3(1, 0, 0)), f.x), mix(snH(i + vec3(0, 1, 0)), snH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(snH(i + vec3(0, 0, 1)), snH(i + vec3(1, 0, 1)), f.x), mix(snH(i + vec3(0, 1, 1)), snH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

export interface SnowLayerOpts {
  /** the steepest a panel can be and still hold snow at full cover (world normal y); glass: roof only */
  minUp?: number;
  /** slush streaks low on the sides */
  spray?: boolean;
  /** how much of the full amount this material takes (tyres and trim a little less) */
  amount?: number;
}

/** Add the snow layer to a car material (keeps any shader changes it already has). */
export function addSnowLayer(m: THREE.MeshStandardMaterial, opts: SnowLayerOpts = {}): void {
  if ((m.userData as { snow?: boolean }).snow) return;
  (m.userData as { snow?: boolean }).snow = true;
  const minUp = (opts.minUp ?? 0.64).toFixed(3);
  const amount = (opts.amount ?? 1).toFixed(3);
  const spray = opts.spray !== false;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uCarSnow = carSnowUniforms.uCarSnow;
    sh.vertexShader = 'varying vec3 vSnowP;\nvarying vec3 vSnowN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vSnowP = position;\n vSnowN = objectNormal;');
    sh.fragmentShader =
      'varying vec3 vSnowP;\nvarying vec3 vSnowN;\nuniform float uCarSnow;\n' +
      NOISE +
      sh.fragmentShader
        .replace('void main() {', 'void main() {\n  float snowAmt = 0.0;')
        .replace(
          '#include <clearcoat_normal_fragment_maps>',
          `#include <clearcoat_normal_fragment_maps>
          if (uCarSnow > 0.01) {
            vec3 sp = vSnowP;
            vec3 wN = normalize((vec4(nonPerturbedNormal, 0.0) * viewMatrix).xyz);
            float nz = snN(sp * 3.1) * 0.55 + snN(sp * 9.7) * 0.3 + snN(sp * 31.0) * 0.15;
            float c = uCarSnow;
            // the flatter the panel, the sooner it holds snow; the cover creeps down the slopes as it builds
            float thr = mix(0.97, ${minUp}, c);
            float top = smoothstep(thr - 0.04, thr + 0.03, wN.y + (nz - 0.5) * 0.3);
            // a thin cover is patchy, a deep one is whole
            top *= smoothstep(0.0, 0.3, c * 1.25 + (nz - 0.55) * 0.6);
            float low = 0.0;
            ${spray ? `// slush thrown up by the tyres: splashes along the sills, in the lowest few inches
            low = (1.0 - smoothstep(0.16, 0.4, sp.y + (nz - 0.5) * 0.12))
              * smoothstep(0.5, 0.85, snN(vec3(sp.x * 9.0, sp.y * 7.0, sp.z * 2.2)))
              * smoothstep(0.3, 0.8, c) * (1.0 - abs(wN.y)) * 0.6;
            // driving into the snowfall packs it onto the nose
            low = max(low, smoothstep(0.6, 0.92, normalize(vSnowN).z + (nz - 0.5) * 0.5) * smoothstep(0.45, 1.0, c) * smoothstep(0.3, 0.72, nz) * 0.75 * step(0.22, sp.y));` : ''}
            snowAmt = clamp(max(top, low), 0.0, 1.0) * ${amount};
            vec3 snowCol = vec3(0.9, 0.93, 0.97) * (0.86 + 0.16 * nz);
            diffuseColor.rgb = mix(diffuseColor.rgb, snowCol, snowAmt);
            diffuseColor.a = mix(diffuseColor.a, 1.0, snowAmt);
            roughnessFactor = mix(roughnessFactor, 0.62 + 0.3 * nz, snowAmt);
            metalnessFactor = mix(metalnessFactor, 0.0, snowAmt);
            // soft, lumpy surface
            normal = normalize(normal + (vec3(snN(sp * 23.0), snN(sp * 23.0 + 7.1), snN(sp * 23.0 + 3.3)) - 0.5) * 0.45 * snowAmt);
          }`,
        )
        .replace(
          '#include <lights_physical_fragment>',
          `#include <lights_physical_fragment>
          #ifdef USE_CLEARCOAT
            material.clearcoat *= 1.0 - snowAmt;
          #endif`,
        );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => key() + `|snow${minUp}${amount}${spray ? 's' : ''}`;
  m.needsUpdate = true;
}

/**
 * Per frame. `snowing`: 0..1 how hard it snows (0 = not snowing); `speed`: the player's speed (m/s).
 * Call reset() at the start of each race.
 */
let wasSnowing = false;
export function updateCarSnow(dt: number, snowing: number, speed: number): void {
  const u = carSnowUniforms.uCarSnow;
  // the weather has just turned to snow (a race in the snow is loading): the cars start dusted
  if (snowing > 0 && !wasSnowing) resetCarSnow(snowing);
  wasSnowing = snowing > 0;
  if (snowing <= 0) {
    u.value = Math.max(0, u.value - dt * 0.2);
    return;
  }
  let c = u.value;
  // settles: about +0.3 a minute in heavy snow, slower as it gets deep
  c += dt * 0.0075 * (0.35 + snowing) * (1 - c);
  // the wind of a fast car takes some back (but a cover stays)
  const wind = Math.max(0, (speed - 22) / 45);
  if (c > 0.3) c -= dt * 0.0035 * wind;
  u.value = Math.min(1, Math.max(0, c));
}

/** At a race start: in the snow the cars have stood on the grid and are already dusted. */
export function resetCarSnow(snowing: number): void {
  carSnowUniforms.uCarSnow.value = snowing > 0 ? 0.32 + 0.25 * snowing : 0;
}
