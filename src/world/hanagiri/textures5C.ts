// ─────────────────────────────────────────────────────────────────────────────
// Hanagiri materials (5C) — original canvas textures for the landmarks, so nothing reads as
// flat-coloured blocks: fired roof tiles, weathered timber, lime plaster, dressed stone,
// verdigris copper, board-marked concrete, paper screens, a corrugated hut roof, ice.
// Every texture repeats in world metres (the bucket gives each part world-space UVs).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { rng } from '../../core/math';

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D, r: () => number) => void, seed = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** grain-like noise over a fill */
function speckle(g: CanvasRenderingContext2D, r: () => number, w: number, h: number, n: number, a: number, light = false): void {
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${(r() * a).toFixed(3)})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
  }
}

/** 1 tile repeat = 2 m: rows of rounded kawara tiles, each column a half cylinder, rows overlapping */
export function tileTex(base = [58, 63, 72]): THREE.CanvasTexture {
  return canvas(256, 256, (g, r) => {
    const cols = 8;
    const rows = 8;
    const cw = 256 / cols;
    const rh = 256 / rows;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const k = 0.85 + r() * 0.25;
        const grd = g.createLinearGradient(x * cw, 0, (x + 1) * cw, 0);
        const c = (f: number) => `rgb(${Math.round(base[0] * f * k)},${Math.round(base[1] * f * k)},${Math.round(base[2] * f * k)})`;
        grd.addColorStop(0, c(0.45));
        grd.addColorStop(0.35, c(1.15));
        grd.addColorStop(0.65, c(1.0));
        grd.addColorStop(1, c(0.4));
        g.fillStyle = grd;
        g.fillRect(x * cw, y * rh, cw, rh);
        // the lower lip of each tile overlaps the one below: a shadow line
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.fillRect(x * cw, (y + 1) * rh - 3, cw, 3);
        g.fillStyle = 'rgba(255,255,255,0.08)';
        g.fillRect(x * cw, (y + 1) * rh - 6, cw, 2);
      }
    // lichen and weathering
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(${90 + r() * 40},${100 + r() * 40},${70 + r() * 20},${(r() * 0.18).toFixed(3)})`;
      g.beginPath();
      g.arc(r() * 256, r() * 256, 2 + r() * 9, 0, 6.3);
      g.fill();
    }
  }, 11);
}

/** 1 repeat = 2.4 m: vertical boards, dark weathered cedar with grain */
export function timberTex(dark = true): THREE.CanvasTexture {
  return canvas(256, 256, (g, r) => {
    const n = 14;
    const w = 256 / n;
    for (let i = 0; i < n; i++) {
      const v = (dark ? 40 : 92) + r() * (dark ? 18 : 30);
      g.fillStyle = `rgb(${v + 8},${Math.round(v * 0.78)},${Math.round(v * 0.58)})`;
      g.fillRect(i * w, 0, w, 256);
      for (let k = 0; k < 18; k++) {
        g.strokeStyle = `rgba(0,0,0,${(0.08 + r() * 0.14).toFixed(3)})`;
        g.lineWidth = 0.6 + r();
        const x = i * w + r() * w;
        g.beginPath();
        g.moveTo(x, 0);
        g.bezierCurveTo(x + (r() - 0.5) * 4, 90, x + (r() - 0.5) * 4, 170, x + (r() - 0.5) * 3, 256);
        g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(i * w, 0, 1.5, 256);
    }
    speckle(g, r, 256, 256, 600, 0.12);
  }, dark ? 12 : 13);
}

/** horizontal logs for the mountain hut */
export function logTex(): THREE.CanvasTexture {
  return canvas(256, 256, (g, r) => {
    const n = 8;
    const h = 256 / n;
    for (let i = 0; i < n; i++) {
      const grd = g.createLinearGradient(0, i * h, 0, (i + 1) * h);
      const v = 70 + r() * 20;
      grd.addColorStop(0, `rgb(${v * 0.5},${v * 0.36},${v * 0.25})`);
      grd.addColorStop(0.3, `rgb(${v * 1.15},${v * 0.86},${v * 0.6})`);
      grd.addColorStop(0.8, `rgb(${v * 0.9},${v * 0.66},${v * 0.46})`);
      grd.addColorStop(1, `rgb(${v * 0.35},${v * 0.25},${v * 0.18})`);
      g.fillStyle = grd;
      g.fillRect(0, i * h, 256, h);
    }
    speckle(g, r, 256, 256, 900, 0.1);
  }, 14);
}

/** lime plaster: off-white, a little uneven, grimy towards the bottom of each repeat */
export function plasterTex(): THREE.CanvasTexture {
  return canvas(256, 256, (g, r) => {
    g.fillStyle = '#e6dfcf';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(${150 + r() * 60},${140 + r() * 50},${120 + r() * 40},${(r() * 0.12).toFixed(3)})`;
      g.beginPath();
      g.arc(r() * 256, r() * 256, 8 + r() * 30, 0, 6.3);
      g.fill();
    }
    // rain streaks
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(90,80,70,${(r() * 0.08).toFixed(3)})`;
      g.fillRect(r() * 256, 0, 1 + r() * 2, 120 + r() * 136);
    }
    speckle(g, r, 256, 256, 1400, 0.08);
  }, 15);
}

/** dressed stone blocks (footings, steps, lanterns, the bridge) */
export function stoneTex(): THREE.CanvasTexture {
  return canvas(256, 256, (g, r) => {
    g.fillStyle = '#6d6b66';
    g.fillRect(0, 0, 256, 256);
    let y = 0;
    while (y < 256) {
      const h = 34 + r() * 30;
      let x = -r() * 40;
      while (x < 256) {
        const w = 50 + r() * 60;
        const v = 95 + r() * 40;
        g.fillStyle = `rgb(${v},${v * 0.97},${v * 0.92})`;
        g.fillRect(x + 2, y + 2, w - 4, h - 4);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(x + 2, y + h - 5, w - 4, 3);
        x += w;
      }
      y += h;
    }
    speckle(g, r, 256, 256, 2400, 0.18);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(70,90,55,${(r() * 0.2).toFixed(3)})`;
      g.beginPath();
      g.arc(r() * 256, r() * 256, 3 + r() * 10, 0, 6.3);
      g.fill();
    }
  }, 16);
}

/** old copper roofing: verdigris with darker seams and streaks */
export function copperTex(): THREE.CanvasTexture {
  return canvas(256, 256, (g, r) => {
    g.fillStyle = '#4f8a78';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 16; i++) {
      g.fillStyle = 'rgba(30,50,44,0.5)';
      g.fillRect(i * 16, 0, 2, 256);
    }
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(${40 + r() * 80},${80 + r() * 80},${60 + r() * 50},${(r() * 0.3).toFixed(3)})`;
      g.fillRect(r() * 256, r() * 256, 2 + r() * 8, 10 + r() * 60);
    }
    speckle(g, r, 256, 256, 1200, 0.15);
  }, 17);
}

/** board-marked concrete with water stains (the gallery, the bridge abutments) */
export function concreteTex(): THREE.CanvasTexture {
  return canvas(256, 256, (g, r) => {
    g.fillStyle = '#8d8a84';
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 21) {
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(0, y, 256, 1.5);
    }
    for (let i = 0; i < 50; i++) {
      g.fillStyle = `rgba(50,48,44,${(r() * 0.12).toFixed(3)})`;
      const x = r() * 256;
      g.fillRect(x, r() * 100, 2 + r() * 10, 60 + r() * 200);
    }
    speckle(g, r, 256, 256, 3000, 0.12);
    speckle(g, r, 256, 256, 800, 0.1, true);
  }, 18);
}

/** paper screens with a wooden lattice (they glow at night) */
export function shojiTex(): THREE.CanvasTexture {
  return canvas(128, 128, (g) => {
    g.fillStyle = '#e9e0c8';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#4a3523';
    for (let i = 0; i <= 4; i++) g.fillRect(i * 31, 0, 4, 128);
    for (let i = 0; i <= 6; i++) g.fillRect(0, i * 21, 128, 3);
  }, 19);
}

/** a corrugated metal roof, painted dark red and weathered */
export function metalRoofTex(): THREE.CanvasTexture {
  return canvas(128, 128, (g, r) => {
    for (let x = 0; x < 128; x++) {
      const v = 0.75 + 0.25 * Math.sin((x / 128) * Math.PI * 2 * 8);
      g.fillStyle = `rgb(${Math.round(120 * v)},${Math.round(38 * v)},${Math.round(30 * v)})`;
      g.fillRect(x, 0, 1, 128);
    }
    for (let i = 0; i < 80; i++) {
      g.fillStyle = `rgba(90,60,40,${(r() * 0.3).toFixed(3)})`;
      g.fillRect(r() * 128, r() * 128, 1 + r() * 3, 4 + r() * 20);
    }
  }, 20);
}

/** the pass sign (our own design): mountain pictogram, the name and the height */
export function passSignTex(): THREE.CanvasTexture {
  return canvas(1024, 512, (g) => {
    g.fillStyle = '#123f2d';
    g.fillRect(0, 0, 1024, 512);
    g.strokeStyle = '#f2efe6';
    g.lineWidth = 14;
    g.strokeRect(20, 20, 984, 472);
    // pictogram: two peaks with a road winding up
    g.fillStyle = '#f2efe6';
    g.beginPath();
    g.moveTo(70, 330);
    g.lineTo(175, 120);
    g.lineTo(230, 210);
    g.lineTo(265, 160);
    g.lineTo(350, 330);
    g.closePath();
    g.fill();
    g.fillStyle = '#123f2d';
    g.beginPath();
    g.moveTo(150, 170);
    g.lineTo(175, 120);
    g.lineTo(200, 170);
    g.lineTo(185, 160);
    g.lineTo(175, 175);
    g.lineTo(163, 160);
    g.closePath();
    g.fill();
    g.fillStyle = '#f2efe6';
    g.textBaseline = 'alphabetic';
    g.font = 'bold 92px Arial, Helvetica, sans-serif';
    g.fillText('HANAGIRI PASS', 380, 215);
    g.font = '64px Arial, Helvetica, sans-serif';
    g.fillText('花霧峠', 384, 300);
    g.font = 'bold 120px Arial, Helvetica, sans-serif';
    g.fillText('1,163 m', 380, 440);
    g.fillRect(70, 360, 280, 10);
  }, 21);
}

/** ice: blue-white with streaks running down (the frozen waterfall, the frozen stream) */
export function iceTex(): THREE.CanvasTexture {
  return canvas(128, 256, (g, r) => {
    const grd = g.createLinearGradient(0, 0, 128, 0);
    grd.addColorStop(0, '#cfe3ee');
    grd.addColorStop(0.5, '#eef6fb');
    grd.addColorStop(1, '#bcd6e4');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(${120 + r() * 60},${170 + r() * 50},${200 + r() * 40},${(0.2 + r() * 0.4).toFixed(3)})`;
      g.fillRect(r() * 128, r() * 256, 1 + r() * 4, 30 + r() * 180);
    }
    speckle(g, r, 128, 256, 400, 0.4, true);
  }, 22);
}
