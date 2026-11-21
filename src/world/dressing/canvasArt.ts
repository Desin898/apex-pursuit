// ─────────────────────────────────────────────────────────────────────────────
// 4D canvas art for the circuit dressing: crowd, garage interiors, catch-fence mesh, banners,
// flags, floodlight panels, the city's glow. All drawn in code; every brand is invented.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { rng } from '../../core/math';

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
};

function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Crowd atlas: 4 frames side by side (sitting, leaning, one arm up, both arms up).
 * Channels are masks, not colours: R = shirt (tinted per person), G = skin, B = hair / dark.
 * The crowd shader turns them into colours, so one texture gives thousands of different people.
 */
export function crowdAtlas(): THREE.CanvasTexture {
  const fw = 64;
  const fh = 112;
  const [c, g] = canvas(fw * 4, fh);
  g.clearRect(0, 0, c.width, c.height);
  for (let f = 0; f < 4; f++) {
    const ox = f * fw;
    const cx = ox + fw / 2;
    const lean = f === 1 ? 4 : 0;
    // body (shirt)
    g.fillStyle = 'rgb(255,0,0)';
    g.beginPath();
    g.moveTo(cx - 17 + lean, fh);
    g.lineTo(cx - 15 + lean, 58);
    g.quadraticCurveTo(cx + lean, 48, cx + 15 + lean, 58);
    g.lineTo(cx + 17 + lean, fh);
    g.closePath();
    g.fill();
    // arms
    g.lineCap = 'round';
    g.lineWidth = 8;
    g.strokeStyle = 'rgb(255,0,0)';
    const arm = (side: number, up: boolean) => {
      g.beginPath();
      g.moveTo(cx + side * 13 + lean, 62);
      if (up) {
        g.lineTo(cx + side * 20 + lean, 36);
        g.stroke();
        g.strokeStyle = 'rgb(0,255,0)';
        g.lineWidth = 7;
        g.beginPath();
        g.moveTo(cx + side * 20 + lean, 36);
        g.lineTo(cx + side * 22 + lean, 18);
        g.stroke();
        g.strokeStyle = 'rgb(255,0,0)';
        g.lineWidth = 8;
      } else {
        g.lineTo(cx + side * 16 + lean, 92);
        g.stroke();
      }
    };
    arm(-1, f === 3);
    arm(1, f >= 2);
    // neck + head (skin)
    g.fillStyle = 'rgb(0,255,0)';
    g.fillRect(cx - 4 + lean, 42, 8, 10);
    g.beginPath();
    g.ellipse(cx + lean, 32, 10, 12, 0, 0, Math.PI * 2);
    g.fill();
    // hair
    g.fillStyle = 'rgb(0,0,255)';
    g.beginPath();
    g.ellipse(cx + lean, 25, 10.5, 7, 0, Math.PI, Math.PI * 2);
    g.fill();
  }
  const t = tex(c, false); // masks: linear
  t.generateMipmaps = true;
  return t;
}

/** Six garage interiors stacked in one atlas (512 × 256 each): row k = team k. */
export const TEAM_COLOURS = ['#4fd1d9', '#f2bf10', '#c20f17', '#0b4fd6', '#74d40e', '#e8eaee'];
export function garageAtlas(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 256 * 6);
  TEAM_COLOURS.forEach((team, k) => g.drawImage(garageInterior(k, team), 0, k * 256));
  return tex(c);
}

/** A garage bay seen through its open door, lit from inside (tool chests, tyre racks, a light strip). */
function garageInterior(seed: number, team: string): HTMLCanvasElement {
  const r = rng(seed + 11);
  const [c, g] = canvas(512, 256);
  // back wall and floor, in perspective
  const wall = g.createLinearGradient(0, 0, 0, 256);
  wall.addColorStop(0, '#d9dde2');
  wall.addColorStop(0.62, '#b9bec6');
  wall.addColorStop(0.62, '#7d8088');
  wall.addColorStop(1, '#55585e');
  g.fillStyle = wall;
  g.fillRect(0, 0, 512, 256);
  // side walls
  g.fillStyle = 'rgba(70,74,82,0.55)';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(70, 34);
  g.lineTo(70, 160);
  g.lineTo(0, 256);
  g.fill();
  g.beginPath();
  g.moveTo(512, 0);
  g.lineTo(442, 34);
  g.lineTo(442, 160);
  g.lineTo(512, 256);
  g.fill();
  // ceiling light strips
  g.fillStyle = '#fffaf0';
  for (let i = 0; i < 3; i++) g.fillRect(110 + i * 110, 12, 70, 6);
  // team colour band and invented team name
  g.fillStyle = team;
  g.fillRect(70, 52, 372, 16);
  g.fillStyle = '#ffffff';
  g.font = 'bold 13px Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText(['APEX WORKS', 'NITROVOLT RACING', 'KORSA MOTORSPORT', 'HALCYON TEAM', 'VELOCE SQUADRA', 'ORBITA RACING'][seed % 6], 256, 65);
  // tool chests and tyre racks along the back wall
  for (let x = 82; x < 430; ) {
    const w = 34 + r() * 40;
    if (r() < 0.55) {
      g.fillStyle = r() < 0.5 ? team : '#2f3238';
      g.fillRect(x, 108, w, 52);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      for (let k = 0; k < 4; k++) g.fillRect(x + 3, 112 + k * 12, w - 6, 2);
    } else {
      g.fillStyle = '#1b1c1f';
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.ellipse(x + w / 2, 152 - k * 18, w / 2.2, 8, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    x += w + 6 + r() * 10;
  }
  // floor markings and a jack
  g.strokeStyle = 'rgba(255,230,80,0.7)';
  g.lineWidth = 3;
  g.strokeRect(150, 190, 212, 60);
  g.fillStyle = '#c42b2b';
  g.fillRect(238, 212, 36, 10);
  return c;
}

/** Diamond wire mesh for catch fences (alpha-tested), tiling every 2 m. */
export function wireMesh(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(205,212,220,1)';
  g.lineWidth = 2.2;
  for (let i = -128; i <= 256; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 128, 128);
    g.stroke();
    g.beginPath();
    g.moveTo(i, 128);
    g.lineTo(i + 128, 0);
    g.stroke();
  }
  // top and bottom tension wires
  g.fillStyle = 'rgba(160,166,172,1)';
  g.fillRect(0, 0, 128, 3);
  g.fillRect(0, 125, 128, 3);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Eight banners, one per row (1024 × 64 each). Every brand is invented. */
export const BANNERS: [string, string, string, string][] = [
  // text, sub, background, ink
  ['APEX PURSUIT', 'PROVING GROUNDS', '#0e1a1d', '#4fd1d9'],
  ['NITROVOLT', 'ENERGY SYSTEMS', '#f2bf10', '#121212'],
  ['KORSA TYRES', 'GRIP IS EVERYTHING', '#151515', '#ffffff'],
  ['HALCYON OIL', 'FULL SYNTHETIC', '#0b4fd6', '#ffffff'],
  ['VELOCE RADIO', '108.8 FM', '#c20f17', '#ffffff'],
  ['ORBITA TELECOM', 'ALWAYS CONNECTED', '#ffffff', '#3a1470'],
  ['TRAXA LOGISTICS', 'ON TIME, EVERY TIME', '#74d40e', '#0a1a04'],
  ['MERIDIAN TIME', 'SWISS-ISH PRECISION', '#1d2a33', '#e9c46a'],
];
export function bannerAtlas(): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 512);
  BANNERS.forEach(([text, sub, bg, ink], i) => {
    const y = i * 64;
    g.fillStyle = bg;
    g.fillRect(0, y, 1024, 64);
    g.fillStyle = ink;
    g.globalAlpha = 0.18;
    for (let x = -40; x < 1024; x += 60) {
      g.beginPath();
      g.moveTo(x, y + 64);
      g.lineTo(x + 30, y);
      g.lineTo(x + 44, y);
      g.lineTo(x + 14, y + 64);
      g.fill();
    }
    g.globalAlpha = 1;
    g.font = 'italic 900 38px Arial Black, Arial, sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText(text, 40, y + 33);
    const tw = g.measureText(text).width;
    g.font = '600 18px Arial, sans-serif';
    g.fillText(sub, 40 + tw + 26, y + 35);
    g.textAlign = 'right';
    g.font = 'italic 900 38px Arial Black, Arial, sans-serif';
    g.fillText(text, 1000, y + 33);
  });
  return tex(c);
}

/** Five flags side by side (128 × 80 each): chequered, Apex cyan, red/white, blue "PG", marshal yellow. */
export function flagAtlas(): THREE.CanvasTexture {
  const [c, g] = canvas(640, 80);
  // 0 chequered
  for (let y = 0; y < 8; y++) for (let x = 0; x < 13; x++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
    g.fillRect(x * 10, y * 10, 10, 10);
  }
  // 1 Apex: dark with a cyan chevron
  g.fillStyle = '#0e1a1d';
  g.fillRect(128, 0, 128, 80);
  g.fillStyle = '#4fd1d9';
  g.beginPath();
  g.moveTo(150, 14);
  g.lineTo(200, 40);
  g.lineTo(150, 66);
  g.lineTo(166, 40);
  g.fill();
  g.font = 'bold 15px Arial, sans-serif';
  g.fillText('APEX', 200, 46);
  // 2 red / white halves
  g.fillStyle = '#c20f17';
  g.fillRect(256, 0, 128, 40);
  g.fillStyle = '#f4f4f4';
  g.fillRect(256, 40, 128, 40);
  // 3 blue with "PG"
  g.fillStyle = '#0b4fd6';
  g.fillRect(384, 0, 128, 80);
  g.fillStyle = '#ffffff';
  g.font = 'bold 34px Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('PG', 448, 52);
  // 4 marshal yellow
  g.fillStyle = '#f2d10e';
  g.fillRect(512, 0, 128, 80);
  return tex(c);
}

/** Floodlight head: a grid of round lamps on a dark frame (emissive). */
export function lampPanel(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 128);
  g.fillStyle = '#16181b';
  g.fillRect(0, 0, 256, 128);
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 6; x++) {
      const cx = 22 + x * 42;
      const cy = 22 + y * 42;
      const gr = g.createRadialGradient(cx, cy, 2, cx, cy, 17);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.55, '#fff3d6');
      gr.addColorStop(1, '#3a3428');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(cx, cy, 17, 0, Math.PI * 2);
      g.fill();
    }
  return tex(c);
}

/** Soft glow over the distant town at night. */
export function glowSprite(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 128);
  const gr = g.createRadialGradient(128, 128, 4, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,190,120,0.9)');
  gr.addColorStop(0.5, 'rgba(255,150,90,0.25)');
  gr.addColorStop(1, 'rgba(255,150,90,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 128);
  return tex(c);
}
