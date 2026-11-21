// ─────────────────────────────────────────────────────────────────────────────
// MaterialBaker (4C) — PBR surface textures painted on the GPU at start-up. Each set is an
// albedo map and a normal map, drawn by a fragment shader into a render target, so they cost a
// few milliseconds to make and nothing to download. Every pattern uses periodic noise, so the
// textures tile without seams.
// - Asphalt: fine aggregate with lighter stones, darker repair patches with sealed edges, a
//   web of hairline cracks, rubber laid down along the middle, and worn, chipped white edge
//   lines. u runs across the road (0..1 = one side to the other), v along it (1 = 14 m).
// - Kerb: red and white blocks with worn paint, chipped corners and a ribbed top.
// - Grass: clumps of light and dark blades, bare earth patches, small stones.
// - Rock: broken plates, strata and lichen, for the hills (sampled triplanar).
// - Concrete: cast slabs with joints, trowel marks, oil stains and tyre marks.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';

const NOISE = /* glsl */ `
  // periodic gradient noise: tiles every 'per' cells
  vec2 g2(vec2 p, vec2 per) {
    p = mod(p, per);
    float h = fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    float a = h * 6.2831853;
    return vec2(cos(a), sin(a));
  }
  float pn(vec2 p, vec2 per) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = dot(g2(i, per), f);
    float b = dot(g2(i + vec2(1, 0), per), f - vec2(1, 0));
    float c = dot(g2(i + vec2(0, 1), per), f - vec2(0, 1));
    float d = dot(g2(i + vec2(1, 1), per), f - vec2(1, 1));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 0.7 + 0.5;
  }
  float fbm(vec2 p, vec2 per, int oct) {
    float s = 0.0, a = 0.5, n = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= oct) break;
      s += a * pn(p, per);
      n += a;
      p *= 2.0;
      per *= 2.0;
      a *= 0.5;
    }
    return s / n;
  }
  // periodic cell noise: distance to the nearest feature point, and its id
  vec3 cells(vec2 p, vec2 per) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float best = 9.0, second = 9.0;
    vec2 id = vec2(0.0);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(x, y);
      vec2 c = mod(i + o, per);
      vec2 r = o + vec2(fract(sin(dot(c, vec2(12.9, 78.2))) * 43758.5), fract(sin(dot(c, vec2(39.3, 11.1))) * 24634.6)) - f;
      float d = dot(r, r);
      if (d < best) { second = best; best = d; id = c; }
      else if (d < second) second = d;
    }
    return vec3(sqrt(best), sqrt(second) - sqrt(best), fract(sin(dot(id, vec2(7.1, 3.7))) * 9313.1));
  }
`;

/** A surface: height (for the normal map) and colour, at uv in 0..1 (tiling). */
interface Surface {
  /** GLSL body: given vec2 uv, set float h (0..1) and vec3 col */
  body: string;
  /** size of the texture in metres along u and v (for the normal strength) */
  bump: number;
}

const SURFACES: Record<string, Surface> = {
  asphalt: {
    bump: 2.2,
    body: /* glsl */ `
      vec2 P = vec2(1.0, 1.0);
      // aggregate: fine grain and a few lighter stones
      float grain = fbm(uv * vec2(180.0, 200.0), vec2(180.0, 200.0), 3);
      vec3 st = cells(uv * vec2(170.0, 200.0), vec2(170.0, 200.0));
      float stone = smoothstep(0.3, 0.2, st.x) * step(0.6, st.z);
      // repair patches: rectangles of newer, darker tar with a sealed rim
      vec3 pc = cells(uv * vec2(3.0, 2.0), vec2(3.0, 2.0));
      vec2 q = abs(fract(uv * vec2(3.0, 2.0)) - 0.5);
      float patchOn = step(0.72, pc.z);
      float inPatch = patchOn * step(max(q.x / 0.38, q.y / 0.3), 1.0);
      float rim = patchOn * smoothstep(0.03, 0.0, abs(max(q.x / 0.38, q.y / 0.3) - 1.0));
      // hairline cracks: the edges of big cells, broken up by noise
      vec3 cr = cells(uv * vec2(6.0, 7.0) + fbm(uv * 9.0, vec2(9.0), 3) * 0.6, vec2(6.0, 7.0));
      float crack = smoothstep(0.012, 0.0, cr.y) * smoothstep(0.5, 0.72, fbm(uv * 13.0, vec2(13.0), 3)) * (1.0 - inPatch);
      // rubber laid down in the middle of the road, and oil drips
      float rubber = smoothstep(0.18, 0.4, uv.x) * smoothstep(0.82, 0.6, uv.x) * (0.55 + 0.45 * fbm(uv * vec2(8.0, 30.0), vec2(8.0, 30.0), 3));
      float oil = smoothstep(0.62, 0.8, fbm(uv * vec2(10.0, 14.0) + 3.1, vec2(10.0, 14.0), 4)) * smoothstep(0.25, 0.4, uv.x) * smoothstep(0.75, 0.6, uv.x);
      // worn white edge lines
      float line = smoothstep(0.018, 0.012, abs(uv.x - 0.035)) + smoothstep(0.018, 0.012, abs(uv.x - 0.965));
      float wear = smoothstep(0.38, 0.62, fbm(uv * vec2(60.0, 90.0), vec2(60.0, 90.0), 4));
      line *= wear;
      float base = 0.105 + 0.06 * grain + 0.025 * stone;
      base *= mix(1.0, 0.68, inPatch);
      base *= 1.0 - 0.28 * rubber;
      base *= 1.0 - 0.35 * oil;
      base *= 1.0 - 0.35 * crack;
      base += 0.05 * rim;
      col = vec3(base) * vec3(1.0, 1.0, 1.04);
      col = mix(col, vec3(0.78, 0.78, 0.74), line * 0.9);
      h = 0.5 + 0.25 * grain + 0.1 * stone - 0.18 * crack + 0.08 * line - 0.04 * inPatch + 0.05 * rim;
    `,
  },
  kerb: {
    bump: 1.0,
    body: /* glsl */ `
      // u across the kerb, v along it (1 = 3 m): blocks of 1 m alternate red / white
      float block = mod(floor(uv.y * 3.0), 2.0);
      float edge = abs(fract(uv.y * 3.0) - 0.5);
      float chip = smoothstep(0.6, 0.75, fbm(uv * vec2(20.0, 60.0), vec2(20.0, 60.0), 4));
      float dirt = fbm(uv * vec2(6.0, 18.0), vec2(6.0, 18.0), 4);
      vec3 red = vec3(0.62, 0.07, 0.06);
      vec3 white = vec3(0.86, 0.86, 0.83);
      col = mix(red, white, block);
      col = mix(col, vec3(0.2, 0.2, 0.21), chip * 0.85); // paint chipped to the concrete
      col *= 0.82 + 0.25 * dirt;
      col *= 1.0 - 0.3 * smoothstep(0.47, 0.5, edge); // dark joint between blocks
      // ribs across the top
      float rib = 0.5 + 0.5 * sin(uv.y * 3.14159 * 2.0 * 30.0);
      h = 0.5 + 0.18 * rib - 0.3 * chip - 0.3 * smoothstep(0.47, 0.5, edge) + 0.05 * dirt;
    `,
  },
  grass: {
    bump: 0.8,
    body: /* glsl */ `
      float blades = fbm(uv * 220.0, vec2(220.0), 3);
      float clumps = fbm(uv * 26.0, vec2(26.0), 4);
      float big = fbm(uv * 4.0, vec2(4.0), 4);
      float earth = smoothstep(0.62, 0.74, fbm(uv * 7.0 + 1.7, vec2(7.0), 5));
      vec3 st = cells(uv * 60.0, vec2(60.0));
      float pebble = smoothstep(0.18, 0.08, st.x) * step(0.82, st.z) * earth;
      vec3 dark = vec3(0.055, 0.095, 0.035);
      vec3 light = vec3(0.17, 0.24, 0.085);
      vec3 dry = vec3(0.36, 0.33, 0.17);
      col = mix(dark, light, clumps * 0.8 + blades * 0.4);
      col = mix(col, dry, smoothstep(0.5, 0.8, big) * 0.45);
      col = mix(col, vec3(0.2, 0.15, 0.1), earth * 0.8);
      col = mix(col, vec3(0.4, 0.38, 0.35), pebble);
      h = 0.4 + 0.4 * blades * (1.0 - earth) + 0.2 * clumps + 0.3 * pebble;
    `,
  },
  rock: {
    bump: 3.0,
    body: /* glsl */ `
      // weathered rock face: broken plates, strata, lichen and dark cracks (tiles every ~24 m)
      vec3 pl = cells(uv * vec2(7.0, 9.0) + fbm(uv * 6.0, vec2(6.0), 3) * 0.8, vec2(7.0, 9.0));
      float plate = pl.z;
      float seam = smoothstep(0.06, 0.0, pl.y);
      float strata = 0.5 + 0.5 * sin((uv.y + fbm(uv * vec2(3.0, 5.0), vec2(3.0, 5.0), 4) * 0.25) * 6.2831853 * 11.0);
      float rough = fbm(uv * 64.0, vec2(64.0), 4);
      float lichen = smoothstep(0.6, 0.75, fbm(uv * 14.0 + 4.2, vec2(14.0), 5));
      vec3 c1 = vec3(0.30, 0.28, 0.26);
      vec3 c2 = vec3(0.44, 0.41, 0.37);
      col = mix(c1, c2, plate * 0.6 + rough * 0.4);
      col *= 0.85 + 0.2 * strata;
      col = mix(col, vec3(0.30, 0.33, 0.17), lichen * 0.55);
      col *= 1.0 - 0.55 * seam;
      h = 0.45 + 0.25 * plate + 0.25 * rough + 0.08 * strata - 0.5 * seam;
    `,
  },
  concrete: {
    bump: 1.4,
    body: /* glsl */ `
      // slabs 1/2 of the texture, joints between them
      vec2 s = fract(uv * 2.0);
      float joint = max(smoothstep(0.012, 0.0, min(s.x, 1.0 - s.x)), smoothstep(0.012, 0.0, min(s.y, 1.0 - s.y)));
      float tone = fbm(floor(uv * 2.0) * 3.1 + uv * 3.0, vec2(6.0), 3);
      float grain = fbm(uv * 160.0, vec2(160.0), 3);
      float trowel = 0.5 + 0.5 * sin((uv.x + fbm(uv * 8.0, vec2(8.0), 2) * 0.05) * 3.14159 * 2.0 * 40.0);
      float stain = smoothstep(0.6, 0.78, fbm(uv * 5.0 + 7.0, vec2(5.0), 5));
      float tyre = smoothstep(0.7, 0.85, fbm(uv * vec2(3.0, 24.0), vec2(3.0, 24.0), 4));
      float base = 0.33 + 0.07 * tone + 0.05 * grain + 0.015 * trowel;
      base *= 1.0 - 0.45 * stain;
      base *= 1.0 - 0.25 * tyre;
      base *= 1.0 - 0.5 * joint;
      col = vec3(base) * vec3(1.0, 0.99, 0.96);
      h = 0.5 + 0.2 * grain + 0.04 * trowel - 0.5 * joint;
    `,
  },
};

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function shader(s: Surface, mode: 'albedo' | 'normal', size: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      ${NOISE}
      void surf(vec2 uv, out float h, out vec3 col) {
        ${s.body}
      }
      void main() {
        float h; vec3 col;
        surf(vUv, h, col);
        ${
          mode === 'albedo'
            ? 'gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0); // linear: the sRGB target encodes it'
            : `
        float e = 1.0 / ${size.toFixed(1)};
        float hx, hy; vec3 c;
        surf(fract(vUv + vec2(e, 0.0)), hx, c);
        surf(fract(vUv + vec2(0.0, e)), hy, c);
        vec3 n = normalize(vec3((h - hx) * ${s.bump.toFixed(2)} * ${(size / 256).toFixed(2)}, (h - hy) * ${s.bump.toFixed(2)} * ${(size / 256).toFixed(2)}, 1.0));
        gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);`
        }
      }`,
  });
}

export interface BakedSet {
  map: THREE.Texture;
  normal: THREE.Texture;
}

/** Bake every surface set once: asphalt at `big` (it fills the screen), the rest at 1024 (rock 512). */
export function bakeMaterials(renderer: THREE.WebGLRenderer, big: number, aniso: number): Record<string, BakedSet> {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  scene.add(quad);
  const prev = renderer.getRenderTarget();
  const prevTone = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  const out: Record<string, BakedSet> = {};
  for (const [name, s] of Object.entries(SURFACES)) {
    const size = name === 'asphalt' ? big : name === 'rock' ? 512 : 1024;
    const make = (mode: 'albedo' | 'normal'): THREE.Texture => {
      const colorSpace = mode === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      const rt = new THREE.WebGLRenderTarget(size, size, { generateMipmaps: false, colorSpace });
      quad.material = shader(s, mode, size);
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      (quad.material as THREE.Material).dispose();
      // Read back once into an ordinary texture: it can then be cloned per repeat, gets mipmaps,
      // and the bake target is freed. (One read per texture at load time, a few milliseconds.)
      const px = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
      rt.dispose();
      const t = new THREE.DataTexture(px, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.colorSpace = colorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = aniso;
      t.needsUpdate = true;
      return t;
    };
    out[name] = { map: make('albedo'), normal: make('normal') };
  }
  renderer.setRenderTarget(prev);
  renderer.toneMapping = prevTone;
  return out;
}
