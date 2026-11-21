// Procedural canvas textures. Everything is generated at start-up, so the game ships with no
// image files at all.
import * as THREE from 'three';
import { rng } from '../core/math';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, repeat = true, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Speckle an area with small random dots: cheap asphalt / concrete / grass grain. */
function grain(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, seed: number, lo: number, hi: number, alpha: number, size = 1.6): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const v = Math.floor(lo + r() * (hi - lo));
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    const s = 0.6 + r() * size;
    ctx.fillRect(r() * w, r() * h, s, s);
  }
}

export function roadTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#2b2c2f';
  ctx.fillRect(0, 0, 512, 512);
  grain(ctx, 512, 512, 26000, 11, 20, 90, 0.5);
  // darker rubbered-in racing line down the middle
  const g = ctx.createLinearGradient(0, 0, 512, 0);
  g.addColorStop(0.15, 'rgba(0,0,0,0)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.3)');
  g.addColorStop(0.85, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  // white edge lines
  ctx.fillStyle = 'rgba(235,235,230,0.92)';
  ctx.fillRect(14, 0, 8, 512);
  ctx.fillRect(490, 0, 8, 512);
  grain(ctx, 512, 512, 2500, 5, 30, 60, 0.35);
  return finish(c);
}

export function concreteTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#3a3b3d';
  ctx.fillRect(0, 0, 512, 512);
  grain(ctx, 512, 512, 22000, 3, 30, 110, 0.4);
  ctx.strokeStyle = 'rgba(15,15,15,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 510, 510); // expansion joints
  return finish(c);
}

export function padTexture(): THREE.CanvasTexture {
  // The skid pad: one big non-repeating texture with painted rings and a centre cross.
  const S = 1024;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#333436';
  ctx.fillRect(0, 0, S, S);
  grain(ctx, S, S, 70000, 9, 25, 100, 0.4, 2.2);
  ctx.translate(S / 2, S / 2);
  ctx.strokeStyle = 'rgba(240,240,235,0.85)';
  ctx.lineWidth = 3;
  for (const r of [0.2, 0.415, 0.62, 0.86]) {
    ctx.beginPath();
    ctx.arc(0, 0, (r * S) / 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,196,0,0.85)';
  ctx.lineWidth = 3;
  ctx.setLineDash([18, 14]);
  ctx.beginPath();
  ctx.moveTo(-S / 2, 0);
  ctx.lineTo(S / 2, 0);
  ctx.moveTo(0, -S / 2);
  ctx.lineTo(0, S / 2);
  ctx.stroke();
  // tyre scrub marks: faint dark arcs
  ctx.setLineDash([]);
  const r = rng(77);
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = `rgba(0,0,0,${0.05 + r() * 0.12})`;
    ctx.lineWidth = 2 + r() * 4;
    ctx.beginPath();
    const rad = (0.15 + r() * 0.8) * (S / 2);
    const a = r() * Math.PI * 2;
    ctx.arc((r() - 0.5) * 60, (r() - 0.5) * 60, rad, a, a + 0.4 + r() * 1.6);
    ctx.stroke();
  }
  return finish(c, false);
}

export function grassTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#47492a';
  ctx.fillRect(0, 0, 512, 512);
  const r = rng(21);
  for (let i = 0; i < 60; i++) {
    // soft patches of drier and greener ground
    const x = r() * 512;
    const y = r() * 512;
    const rad = 30 + r() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const dry = r() > 0.5;
    g.addColorStop(0, dry ? 'rgba(120,104,58,0.35)' : 'rgba(48,66,30,0.4)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) ctx.fillRect(x - rad + ox, y - rad + oy, rad * 2, rad * 2);
  }
  for (let i = 0; i < 30000; i++) {
    const v = r();
    ctx.fillStyle = v > 0.5 ? `rgba(150,140,80,${0.12 + r() * 0.2})` : `rgba(20,30,10,${0.15 + r() * 0.25})`;
    ctx.fillRect(r() * 512, r() * 512, 1, 1.5 + r() * 2.5);
  }
  return finish(c);
}

export function kerbTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 128);
  ctx.fillStyle = '#c4171c';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#e8e6e0';
  ctx.fillRect(0, 64, 64, 64);
  grain(ctx, 64, 128, 500, 2, 0, 60, 0.25);
  return finish(c);
}

export function barrierTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 64);
  ctx.fillStyle = '#b9b7b0';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#b3161b';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, 52, 256, 12); // grime along the base
  ctx.fillRect(0, 0, 3, 64);
  ctx.fillRect(126, 0, 3, 64);
  grain(ctx, 256, 64, 1400, 8, 0, 70, 0.25);
  return finish(c);
}

export function hazardTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#f2b90a';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#111';
  for (let i = -128; i < 256; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 128);
    ctx.lineTo(i + 32, 128);
    ctx.lineTo(i + 160, 0);
    ctx.lineTo(i + 128, 0);
    ctx.fill();
  }
  return finish(c);
}

export function rampTopTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#26282c';
  ctx.fillRect(0, 0, 256, 256);
  grain(ctx, 256, 256, 5000, 4, 30, 100, 0.4);
  ctx.strokeStyle = '#f2b90a';
  ctx.lineWidth = 14;
  ctx.lineJoin = 'miter';
  for (const y of [70, 150, 230]) {
    ctx.beginPath();
    ctx.moveTo(48, y);
    ctx.lineTo(128, y - 54);
    ctx.lineTo(208, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#f2b90a';
  ctx.fillRect(0, 0, 10, 256);
  ctx.fillRect(246, 0, 10, 256);
  return finish(c, false);
}

/** Corrugated wall with a band of windows; returns colour + emissive (lit windows) maps. */
export function buildingTextures(seed: number, base: string, doors: boolean): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const W = 512;
  const H = 256;
  const [c, ctx] = canvas(W, H);
  const [e, ectx] = canvas(W, H);
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, W, H);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 8) {
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(x, 0, 3, H);
  }
  const r = rng(seed);
  // window band across the upper half
  for (let x = 16; x < W - 16; x += 62) {
    const lit = r() > 0.45;
    ctx.fillStyle = lit ? '#ffd9a0' : '#1b2a36';
    ctx.fillRect(x, 40, 46, 44);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x + 22, 40, 2, 44);
    if (lit) {
      ectx.fillStyle = '#ffb060';
      ectx.fillRect(x, 40, 46, 44);
    }
  }
  if (doors) {
    for (let x = 10; x < W - 10; x += 124) {
      ctx.fillStyle = '#17191c';
      ctx.fillRect(x, 130, 104, 126);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      for (let y = 136; y < 256; y += 12) ctx.fillRect(x, y, 104, 2);
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, H - 14, W, 14);
  ctx.fillStyle = '#d02a1c';
  ctx.fillRect(0, 100, W, 6); // accent stripe
  grain(ctx, W, H, 3000, seed, 0, 80, 0.18);
  return { map: finish(c), emissive: finish(e) };
}

export function billboardTexture(text: string, sub: string, hue: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 420);
  const g = ctx.createLinearGradient(0, 0, 1024, 420);
  g.addColorStop(0, `hsl(${hue * 360},75%,16%)`);
  g.addColorStop(1, `hsl(${(hue * 360 + 30) % 360},85%,38%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 420);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let i = -420; i < 1024; i += 90) {
    ctx.beginPath();
    ctx.moveTo(i, 420);
    ctx.lineTo(i + 40, 420);
    ctx.lineTo(i + 460, 0);
    ctx.lineTo(i + 420, 0);
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  let size = 170;
  ctx.font = `italic 900 ${size}px "Arial Black", Impact, system-ui, sans-serif`;
  while (ctx.measureText(text).width > 920 && size > 60) {
    size -= 8;
    ctx.font = `italic 900 ${size}px "Arial Black", Impact, system-ui, sans-serif`;
  }
  ctx.fillText(text, 512, 180);
  ctx.font = '600 52px system-ui, "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillText(sub.split('').join(' '), 512, 318);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, 996, 392);
  return finish(c, false);
}

export function checkerTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  ctx.fillStyle = '#eee';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillRect(32, 32, 32, 32);
  const t = finish(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function fenceTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(190,195,200,0.9)';
  ctx.lineWidth = 2;
  for (let i = -64; i < 128; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 64, 64);
    ctx.moveTo(i + 64, 0);
    ctx.lineTo(i, 64);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(200,205,210,1)';
  ctx.fillRect(0, 0, 64, 3);
  return finish(c);
}

/** Tileable soft cloud alpha (value-noise fBm). */
export function cloudTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const img = ctx.createImageData(S, S);
  const r = rng(404);
  const G = 4; // lattice cells per tile at the lowest octave (wraps, so the texture tiles)
  const lattice: number[][] = [];
  for (let o = 0; o < 4; o++) {
    const n = G << o;
    const arr: number[] = [];
    for (let i = 0; i < n * n; i++) arr.push(r());
    lattice.push(arr);
  }
  const noise = (o: number, x: number, y: number) => {
    const n = G << o;
    const fx = x * n;
    const fy = y * n;
    const x0 = Math.floor(fx) % n;
    const y0 = Math.floor(fy) % n;
    const x1 = (x0 + 1) % n;
    const y1 = (y0 + 1) % n;
    let tx = fx - Math.floor(fx);
    let ty = fy - Math.floor(fy);
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const a = lattice[o];
    return (a[y0 * n + x0] * (1 - tx) + a[y0 * n + x1] * tx) * (1 - ty) + (a[y1 * n + x0] * (1 - tx) + a[y1 * n + x1] * tx) * ty;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      let n = 0;
      let amp = 0.5;
      for (let o = 0; o < 4; o++) {
        n += noise(o, u, v) * amp;
        amp *= 0.5;
      }
      const a = Math.max(0, Math.min(1, (n - 0.5) * 3.4));
      const i = (y * S + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = a * a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, true, false);
}

// ── Phase 3C-2: weather and night ──────────────────────────────────────────

/** Wet-road roughness: mostly glossy with smooth puddle patches; used as a roughnessMap. */
export function puddleTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = 'rgb(150,150,150)'; // base roughness ≈ 0.6 × material roughness
  ctx.fillRect(0, 0, 256, 256);
  const r = rng(77);
  for (let i = 0; i < 26; i++) {
    const x = r() * 256;
    const y = r() * 256;
    const rad = 10 + r() * 34;
    for (const [dx, dy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      g.addColorStop(0, 'rgba(70,70,70,0.85)');
      g.addColorStop(0.6, 'rgba(90,90,90,0.5)');
      g.addColorStop(1, 'rgba(150,150,150,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x + dx, y + dy, rad, rad * (0.35 + r() * 0.4), r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  grain(ctx, 256, 256, 6000, 78, 110, 200, 0.35);
  return finish(c, true, false);
}

/** Soft round pool of light (white, alpha in the colour: for additive blending). */
export function poolTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return finish(c, false, true);
}

/** Headlight beam on the road: a widening fan, brightest just ahead of the car (car at v = 0). */
export function beamTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 256);
  const img = ctx.createImageData(128, 256);
  for (let y = 0; y < 256; y++) {
    const t = y / 255; // 0 at the bumper, 1 far ahead
    const half = 0.12 + t * 0.38; // fan width
    const along = Math.pow(1 - t, 1.3) * Math.min(1, t * 4 + 0.05);
    for (let x = 0; x < 128; x++) {
      const u = Math.abs(x / 127 - 0.5);
      const across = Math.max(0, 1 - Math.pow(u / half, 2.2));
      // two lamps: a slightly brighter band either side of the centre
      const twin = 0.82 + 0.18 * Math.cos((x / 127 - 0.5) * Math.PI * 4);
      const v = Math.min(1, along * across * twin * 1.25);
      const i = (y * 128 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(v * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, false, true);
}

/** A light's reflection on wet tarmac: a long soft vertical streak. */
export function streakTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 256);
  const img = ctx.createImageData(64, 256);
  for (let y = 0; y < 256; y++) {
    const t = y / 255;
    const along = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 1.5) * (1 - t * 0.55);
    for (let x = 0; x < 64; x++) {
      const u = (x / 63 - 0.5) * 2;
      const across = Math.exp(-u * u * 5);
      const v = Math.min(1, along * across);
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(v * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, false, true);
}

/** The moon: a pale disc with soft maria, plus its halo (drawn as a separate, bigger sprite). */
export function moonTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.beginPath();
  ctx.arc(128, 128, 120, 0, Math.PI * 2);
  ctx.fillStyle = '#e9edf4';
  ctx.fill();
  ctx.save();
  ctx.clip();
  const r = rng(5);
  for (let i = 0; i < 16; i++) {
    const x = 50 + r() * 160;
    const y = 50 + r() * 160;
    const rad = 10 + r() * 34;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(150,158,172,0.55)');
    g.addColorStop(1, 'rgba(150,158,172,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // limb darkening
  const lg = ctx.createRadialGradient(128, 128, 60, 128, 128, 122);
  lg.addColorStop(0, 'rgba(0,0,0,0)');
  lg.addColorStop(1, 'rgba(60,70,90,0.35)');
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, 256, 256);
  ctx.restore();
  return finish(c, false, true);
}
