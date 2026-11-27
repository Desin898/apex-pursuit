// ─────────────────────────────────────────────────────────────────────────────
// Reflections and distant shadows (Phase 3D).
//
//  • PlanarReflection — real wet-road reflections. The scene is rendered a second time from a
//    camera mirrored in the road plane (y = 0) into a smaller render target; the road, kerb and
//    paved materials sample it where they are wet, smeared vertically by roughness (wet asphalt
//    stretches reflections into streaks), rippled by rain, stronger at grazing angles (Fresnel)
//    and mirror-sharp in puddles.
//  • PaintProbe — a cube camera that follows the player's car and renders one face per frame,
//    so the paint reflects what is actually around it: rivals, police lights, lamps, buildings.
//  • FarShadow — the close-up sun shadow covers ±42 m round the car; beyond it, a one-off
//    4096² shadow map of the static world (buildings, trees, stands, poles) is baked for the
//    current sun direction and darkens the ground out to the horizon.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';

/** Uniforms shared by every patched ground material. */
export const groundUniforms = {
  tRefl: { value: null as THREE.Texture | null },
  uReflMatrix: { value: new THREE.Matrix4() },
  uWet: { value: 0 },
  uRain: { value: 0 },
  uReflStrength: { value: 1 },
  uTime: { value: 0 },
  tFarShadow: { value: null as THREE.Texture | null },
  uFarMatrix: { value: new THREE.Matrix4() },
  uFarOn: { value: 0 },
  uNearCenter: { value: new THREE.Vector2() },
  uNearRadius: { value: 42 },
  /** 5A: height of the mirror plane (the road under the player; 0 on the flat venue) */
  uReflY: { value: 0 },
};

const patched = new Set<THREE.MeshStandardMaterial>();

/** Teach a ground material (road, kerb, pavement, grass) about wet reflections and far shadows. */
export function patchGround(mat: THREE.MeshStandardMaterial, reflective: boolean, tag = ''): void {
  if (patched.has(mat)) return;
  patched.add(mat);
  // 5A: a material with its own shader (the mountain terrain) keeps it: this patch goes on top
  const prev = tag ? mat.onBeforeCompile : null;
  const prevKey = tag ? mat.customProgramCacheKey() : '';
  mat.defines = { ...(mat.defines ?? {}), GROUND_REFL: reflective ? 1 : 0 };
  mat.customProgramCacheKey = () => `ground-${tag}${prevKey}-${reflective ? 1 : 0}-${mat.defines?.USE_WET_REFL ? 1 : 0}-${mat.defines?.USE_FAR_SHADOW ? 1 : 0}`;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    Object.assign(sh.uniforms, groundUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vGroundWorld;
        uniform sampler2D tRefl;
        uniform mat4 uReflMatrix;
        uniform float uWet, uRain, uReflStrength, uTime, uFarOn, uNearRadius, uReflY;
        uniform sampler2D tFarShadow;
        uniform mat4 uFarMatrix;
        uniform vec2 uNearCenter;
        // 4C: large-scale variation in world space, so tiled textures never look repeated
        float gvn(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5);
          float b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5);
          float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5);
          float d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5);
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float mv = gvn(vGroundWorld.xz * 0.011) * 0.6 + gvn(vGroundWorld.xz * 0.043) * 0.4;
          diffuseColor.rgb *= 0.84 + 0.32 * mv;
        }`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        #ifdef USE_FAR_SHADOW
        {
          // beyond the close-up shadow: the baked shadow of the static world
          vec2 dn = abs(vGroundWorld.xz - uNearCenter);
          float beyond = smoothstep(uNearRadius * 0.7, uNearRadius * 0.95, max(dn.x, dn.y));
          if (beyond > 0.0 && uFarOn > 0.0) {
            vec4 sc = uFarMatrix * vec4(vGroundWorld, 1.0);
            sc.xyz = sc.xyz / sc.w * 0.5 + 0.5;
            if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0) {
              float lit = 0.0;
              float px = 1.0 / 4096.0;
              for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
                float d = texture2D(tFarShadow, sc.xy + vec2(float(i), float(j)) * px * 1.5).r;
                lit += step(sc.z - 0.0012, d);
              }
              lit /= 9.0;
              float k = mix(1.0, lit, beyond * uFarOn);
              reflectedLight.directDiffuse *= k;
              reflectedLight.directSpecular *= k;
            }
          }
        }
        #endif`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#ifdef USE_WET_REFL
        #if GROUND_REFL == 1
        {
          vec4 rp = uReflMatrix * vec4(vGroundWorld.x, uReflY, vGroundWorld.z, 1.0);
          vec2 ruv = rp.xy / rp.w;
          // rain rings on the water film
          vec2 q = vGroundWorld.xz * 2.3;
          float rip = sin(q.x * 3.7 + uTime * 6.1) * sin(q.y * 3.1 - uTime * 5.3) + sin((q.x + q.y) * 2.3 + uTime * 4.0) * 0.5;
          ruv += vec2(rip, rip * 0.6) * 0.0018 * uRain;
          float rough = clamp(roughnessFactor, 0.0, 1.0);
          // smear vertically with roughness: wet asphalt pulls reflections into streaks
          float stretch = 0.002 + 0.07 * rough * rough;
          vec3 acc = vec3(0.0);
          float wsum = 0.0;
          for (int i = -3; i <= 3; i++) {
            float w = 1.0 - abs(float(i)) * 0.22;
            acc += texture2D(tRefl, ruv + vec2(0.0, float(i) * stretch / 3.0)).rgb * w;
            wsum += w;
          }
          vec3 refl = acc / wsum;
          float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float fres = 0.06 + 0.94 * pow(1.0 - ndv, 5.0);
          float gloss = 1.0 - smoothstep(0.12, 0.62, rough);
          outgoingLight = outgoingLight * (1.0 - 0.35 * uWet * gloss * fres) + refl * uWet * uReflStrength * mix(0.32, 1.0, fres) * gloss;
        }
        #endif
        #endif
        #include <opaque_fragment>`,
      );
  };
  mat.needsUpdate = true;
}

/** Switch the features on or off for every patched material (recompiles only when it changes). */
export function setGroundFeatures(wet: boolean, far: boolean): void {
  for (const m of patched) {
    const d = m.defines as Record<string, unknown>;
    const had = [!!d.USE_WET_REFL, !!d.USE_FAR_SHADOW];
    if (wet) d.USE_WET_REFL = 1;
    else delete d.USE_WET_REFL;
    if (far) d.USE_FAR_SHADOW = 1;
    else delete d.USE_FAR_SHADOW;
    if (had[0] !== wet || had[1] !== far) m.needsUpdate = true;
  }
}

// ── Mirror camera in the road plane ──
export class PlanarReflection {
  readonly target: THREE.WebGLRenderTarget;
  private cam = new THREE.PerspectiveCamera();
  private scale = 0.5;
  /** objects not drawn in the mirror (rain streaks, the camera-facing light streaks…) */
  readonly hide: THREE.Object3D[] = [];
  /** 5A: the mirror plane's height (set each frame to the road under the player) */
  planeY = 0;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, depthBuffer: true });
    this.target.texture.generateMipmaps = false;
    this.blank.needsUpdate = true;
    groundUniforms.tRefl.value = this.target.texture;
  }

  /** scale: render-target size relative to the screen (0 = off) */
  setScale(scale: number, width: number, height: number): void {
    this.scale = scale;
    if (scale > 0) this.target.setSize(Math.max(16, Math.floor(width * scale)), Math.max(16, Math.floor(height * scale)));
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    if (this.scale <= 0) return;
    const cam = this.cam;
    const T = this.tmp;
    const camPos = T.camPos.setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y <= this.planeY + 0.02) return;
    groundUniforms.uReflY.value = this.planeY;
    const normal = T.normal.set(0, 1, 0);
    const planePoint = T.point.set(0, this.planeY, 0);
    // mirrored eye
    const view = T.view.copy(planePoint).sub(camPos).reflect(normal).negate().add(planePoint);
    const rot = T.rot.extractRotation(camera.matrixWorld);
    const look = T.look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    const target = T.target.copy(planePoint).sub(look).reflect(normal).negate().add(planePoint);
    cam.position.copy(view);
    cam.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    cam.lookAt(target);
    cam.far = camera.far;
    cam.near = camera.near;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);
    // texture matrix: world → mirror image uv
    const tm = groundUniforms.uReflMatrix.value;
    tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    tm.multiply(cam.projectionMatrix);
    tm.multiply(cam.matrixWorldInverse);
    // oblique near plane = the road, so nothing below it shows up in the mirror
    const plane = T.plane.setFromNormalAndCoplanarPoint(normal, planePoint);
    plane.applyMatrix4(cam.matrixWorldInverse);
    const clip = T.clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = cam.projectionMatrix;
    const q = T.q.set((Math.sign(clip.x) + pm.elements[8]) / pm.elements[0], (Math.sign(clip.y) + pm.elements[9]) / pm.elements[5], -1, (1 + pm.elements[10]) / pm.elements[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    pm.elements[2] = clip.x;
    pm.elements[6] = clip.y;
    pm.elements[10] = clip.z + 1 - 0.003;
    pm.elements[14] = clip.w;
    cam.projectionMatrixInverse.copy(pm).invert();

    const vis = this.vis;
    vis.length = this.hide.length;
    for (let i = 0; i < this.hide.length; i++) {
      vis[i] = this.hide[i].visible;
      this.hide[i].visible = false;
    }
    // the road can't read the mirror while the mirror is being drawn
    groundUniforms.tRefl.value = this.blank;
    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false; // reuse this frame's shadow maps
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadow;
    groundUniforms.tRefl.value = this.target.texture;
    for (let i = 0; i < this.hide.length; i++) this.hide[i].visible = vis[i];
  }
  private vis: boolean[] = [];
  private tmp = {
    camPos: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    point: new THREE.Vector3(),
    view: new THREE.Vector3(),
    rot: new THREE.Matrix4(),
    look: new THREE.Vector3(),
    target: new THREE.Vector3(),
    plane: new THREE.Plane(),
    clip: new THREE.Vector4(),
    q: new THREE.Vector4(),
  };
  private blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
}

// ── Paint reflection probe on the player's car ──
export class PaintProbe {
  private rt: THREE.WebGLCubeRenderTarget | null = null;
  private cube: THREE.CubeCamera | null = null;
  private face = 0;
  private size = 0;
  private applied: THREE.MeshStandardMaterial | null = null;

  /** size: cube face resolution (0 = off). */
  setSize(size: number, scene: THREE.Scene): void {
    if (size === this.size) return;
    if (this.cube) scene.remove(this.cube);
    this.rt?.dispose();
    this.rt = null;
    this.cube = null;
    this.size = size;
    if (this.applied) {
      this.applied.envMap = null;
      this.applied.needsUpdate = true;
      this.applied = null;
    }
    if (size <= 0) return;
    this.rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cube = new THREE.CubeCamera(0.6, 900, this.rt);
    scene.add(this.cube);
  }

  /** Render one cube face per call; the paint's environment is refreshed every six frames. */
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, carRoot: THREE.Object3D | null, paint: THREE.MeshStandardMaterial | null, hide: THREE.Object3D[]): void {
    if (!this.cube || !this.rt || !carRoot || !paint) return;
    if (this.applied !== paint) {
      if (this.applied) {
        this.applied.envMap = null;
        this.applied.needsUpdate = true;
      }
      paint.envMap = this.rt.texture;
      paint.needsUpdate = true;
      this.applied = paint;
    }
    this.cube.position.set(carRoot.position.x, carRoot.position.y + 0.9, carRoot.position.z);
    this.cube.updateMatrixWorld(true);
    const cams = this.cube.children as THREE.PerspectiveCamera[];
    const was = carRoot.visible;
    const vis = hide.map((o) => o.visible);
    carRoot.visible = false;
    for (const o of hide) o.visible = false;
    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt, this.face);
    renderer.clear();
    renderer.render(scene, cams[this.face]);
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadow;
    carRoot.visible = was;
    hide.forEach((o, i) => (o.visible = vis[i]));
    this.face = (this.face + 1) % 6;
    if (this.face === 0) this.rt.texture.needsPMREMUpdate = true;
  }
}

// ── Baked distant shadow ──
export class FarShadow {
  private rt: THREE.WebGLRenderTarget;
  private cam = new THREE.OrthographicCamera(-700, 700, 700, -700, 1, 3000);
  private depthMat = new THREE.MeshDepthMaterial();

  constructor() {
    this.rt = new THREE.WebGLRenderTarget(4096, 4096, { depthBuffer: true });
    this.rt.depthTexture = new THREE.DepthTexture(4096, 4096, THREE.UnsignedIntType);
    this.rt.texture.generateMipmaps = false;
    groundUniforms.tFarShadow.value = this.rt.depthTexture;
  }

  /**
   * Re-bake for a sun direction. Only static shadow casters are drawn: anything flagged
   * `userData.noBake` (cars, police, props that move) and anything not casting shadows is skipped.
   */
  bake(renderer: THREE.WebGLRenderer, scene: THREE.Scene, sunDir: THREE.Vector3, cx: number, cz: number, half: number): void {
    const cam = this.cam;
    cam.left = cam.bottom = -half;
    cam.right = cam.top = half;
    cam.position.set(cx + sunDir.x * 1400, sunDir.y * 1400, cz + sunDir.z * 1400);
    cam.up.set(0, 1, 0);
    cam.lookAt(cx, 0, cz);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const hidden: THREE.Object3D[] = [];
    const isBlocked = (o: THREE.Object3D): boolean => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.noBake) return true;
      return false;
    };
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!(m.isMesh || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite || (o as THREE.Line).isLine)) return;
      if (!o.visible) return;
      if (!m.castShadow || !m.isMesh || isBlocked(o)) {
        hidden.push(o);
        o.visible = false;
      }
    });
    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    scene.overrideMaterial = this.depthMat;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    scene.overrideMaterial = prevOverride;
    renderer.shadowMap.autoUpdate = prevShadow;
    for (const o of hidden) o.visible = true;
    groundUniforms.uFarMatrix.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  }
}
