// ─────────────────────────────────────────────────────────────────────────────
// Cluster — the in-race instrument cluster (Phase 3B), bottom right, drawn on one canvas.
//   • a large analog rev dial, 0–10 ×1000 rpm, red zone from 8, a cyan needle with a soft glow,
//     the gear in large type in the middle and a shift light that flashes before the redline
//   • the speed as a boxed digital readout under the dial (km/h or mph)
//   • two small gauges: BOOST (vacuum off the throttle, up with throttle, slipstream and nitrous)
//     and N2O (the nitrous tank)
// The dial face (ticks, numerals, labels) is drawn once to an offscreen canvas; each frame only
// copies it and draws needles and numbers, well under a millisecond.
// ─────────────────────────────────────────────────────────────────────────────
import { VEHICLE as V, PLAYER_ENGINE } from '../config';
import type { VehicleState } from '../vehicle/VehiclePhysics';

const W = 560; // css px of the cluster box
const H = 330;
const START = (135 * Math.PI) / 180; // 0 rpm: bottom left
const SWEEP = (270 * Math.PI) / 180; // to 10 000 rpm: bottom right
const CYAN = '#4fd1d9';
const RED = '#ff4d55';
const INK = '#eef5f5';
const FONT = 'Outfit, system-ui, sans-serif';

export class Cluster {
  private ctx: CanvasRenderingContext2D;
  private face = document.createElement('canvas');
  private dpr = 1;
  private rpmShown = 0;
  private boostShown = 0;
  private nosShown = 0;
  private time = 0;
  // geometry (css px)
  private cx = 372;
  private cy = 158;
  private r = 140;
  private boost = { x: 112, y: 108, r: 62 };
  private nos = { x: 112, y: 250, r: 54 };
  private faceKey = '';

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** (Re)build the dial face for the current pixel density and unit. */
  private buildFace(mph: boolean): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const key = `${dpr}|${mph}`;
    if (key === this.faceKey) return;
    this.faceKey = key;
    this.dpr = dpr;
    for (const c of [this.canvas, this.face]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const g = this.face.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // soft dark backing so the dial reads on any background
    const bg = g.createRadialGradient(this.cx, this.cy, this.r * 0.2, this.cx, this.cy, this.r * 1.25);
    bg.addColorStop(0, 'rgba(6,12,14,0.62)');
    bg.addColorStop(0.75, 'rgba(6,12,14,0.42)');
    bg.addColorStop(1, 'rgba(6,12,14,0)');
    g.fillStyle = bg;
    g.beginPath();
    g.arc(this.cx, this.cy, this.r * 1.25, 0, Math.PI * 2);
    g.fill();
    for (const s of [this.boost, this.nos]) {
      const b2 = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 1.3);
      b2.addColorStop(0, 'rgba(6,12,14,0.55)');
      b2.addColorStop(1, 'rgba(6,12,14,0)');
      g.fillStyle = b2;
      g.beginPath();
      g.arc(s.x, s.y, s.r * 1.3, 0, Math.PI * 2);
      g.fill();
    }
    // rev dial ticks: every 500 rpm, numerals every 1000, red from 8000
    g.lineCap = 'round';
    for (let i = 0; i <= 20; i++) {
      const rpm = i * 500;
      const a = START + (rpm / 10000) * SWEEP;
      const major = i % 2 === 0;
      const red = rpm >= 8000;
      const r0 = this.r * (major ? 0.8 : 0.86);
      const r1 = this.r * 0.95;
      g.strokeStyle = red ? RED : 'rgba(238,245,245,0.92)';
      g.lineWidth = major ? 4 : 2;
      g.beginPath();
      g.moveTo(this.cx + Math.cos(a) * r0, this.cy + Math.sin(a) * r0);
      g.lineTo(this.cx + Math.cos(a) * r1, this.cy + Math.sin(a) * r1);
      g.stroke();
      if (major) {
        g.fillStyle = red ? RED : INK;
        g.font = `600 ${Math.round(this.r * 0.17)}px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const rr = this.r * 0.64;
        g.fillText(String(rpm / 1000), this.cx + Math.cos(a) * rr, this.cy + Math.sin(a) * rr);
      }
    }
    // red-zone arc
    g.strokeStyle = 'rgba(255,77,85,0.55)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(this.cx, this.cy, this.r * 0.99, START + 0.8 * SWEEP, START + SWEEP);
    g.stroke();
    g.fillStyle = 'rgba(238,245,245,0.75)';
    g.font = `600 11px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('RPM', this.cx, this.cy - this.r * 0.36);
    g.font = `500 9px ${FONT}`;
    g.fillText('×1000', this.cx, this.cy - this.r * 0.27);
    // small gauges
    this.smallFace(g, this.boost.x, this.boost.y, this.boost.r, 'BOOST', true);
    this.smallFace(g, this.nos.x, this.nos.y, this.nos.r, 'N₂O', false);
    // speed box frame and unit label
    const bx = this.cx - 74;
    const by = this.cy + this.r * 0.62;
    g.fillStyle = 'rgba(79,209,217,0.13)';
    g.strokeStyle = 'rgba(79,209,217,0.65)';
    g.lineWidth = 1.5;
    this.round(g, bx, by, 148, 52, 8);
    g.fill();
    g.stroke();
    g.fillStyle = 'rgba(238,245,245,0.8)';
    g.font = `600 12px ${FONT}`;
    g.fillText(mph ? 'mph' : 'km/h', this.cx, by + 66);
  }

  private smallFace(g: CanvasRenderingContext2D, x: number, y: number, r: number, label: string, centred: boolean): void {
    // 240° sweep; BOOST has 0 at the top (− left, + right), N2O fills from empty to full
    const a0 = (150 * Math.PI) / 180;
    const sweep = (240 * Math.PI) / 180;
    for (let i = 0; i <= 8; i++) {
      const a = a0 + (i / 8) * sweep;
      const major = i % 2 === 0;
      const red = centred ? i === 8 : i === 0;
      g.strokeStyle = red ? RED : 'rgba(238,245,245,0.85)';
      g.lineWidth = major ? 2.6 : 1.4;
      g.beginPath();
      g.moveTo(x + Math.cos(a) * r * (major ? 0.74 : 0.8), y + Math.sin(a) * r * (major ? 0.74 : 0.8));
      g.lineTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92);
      g.stroke();
    }
    g.fillStyle = INK;
    g.font = `600 11px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, x, y + r * 0.78);
    if (centred) {
      g.font = `600 13px ${FONT}`;
      g.fillText('0', x, y - r * 0.5);
      g.fillText('−', x - r * 0.56, y + r * 0.3);
      g.fillText('+', x + r * 0.56, y + r * 0.3);
    } else {
      g.font = `600 10px ${FONT}`;
      g.fillText('E', x - r * 0.5, y + r * 0.32);
      g.fillText('F', x + r * 0.5, y + r * 0.32);
    }
  }

  private round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  private needle(g: CanvasRenderingContext2D, x: number, y: number, a: number, len: number, tail: number, width: number, color: string, glow: number): void {
    g.save();
    g.shadowColor = color;
    g.shadowBlur = glow;
    g.strokeStyle = color;
    g.lineCap = 'round';
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(x - Math.cos(a) * tail, y - Math.sin(a) * tail);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
    g.restore();
  }

  draw(s: VehicleState, mph: boolean, dt: number, throttle: number): void {
    this.buildFace(mph);
    this.time += dt;
    const g = this.ctx;
    const k = Math.min(1, dt * 16);
    this.rpmShown += (Math.max(0, s.rpm) - this.rpmShown) * k;
    // boost: vacuum off the throttle, pressure on it, more with slipstream and nitrous
    const boostT = Math.max(-1, Math.min(1, -0.55 + throttle * 0.75 + s.draft * 0.35 + s.nitroLevel * 0.55));
    this.boostShown += (boostT - this.boostShown) * Math.min(1, dt * 7);
    this.nosShown += (s.nitro - this.nosShown) * Math.min(1, dt * 10);

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.face, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // shift light: the red zone and the gear flash just before the redline
    const shift = s.gear > 0 && s.rpm > PLAYER_ENGINE.upshiftRpm - 250;
    const blink = shift && Math.floor(this.time * 10) % 2 === 0;
    if (blink) {
      g.save();
      g.strokeStyle = RED;
      g.shadowColor = RED;
      g.shadowBlur = 18;
      g.lineWidth = 7;
      g.beginPath();
      g.arc(this.cx, this.cy, this.r * 0.99, START + 0.8 * SWEEP, START + SWEEP);
      g.stroke();
      g.restore();
    }
    // lit arc up to the needle
    const frac = Math.min(1.02, this.rpmShown / 10000);
    const a = START + frac * SWEEP;
    g.save();
    g.strokeStyle = 'rgba(79,209,217,0.22)';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(this.cx, this.cy, this.r * 0.9, START, a);
    g.stroke();
    g.restore();
    // gear
    g.fillStyle = blink ? RED : INK;
    g.font = `700 ${Math.round(this.r * 0.42)}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s.gear === -1 ? 'R' : s.gear === 0 ? 'N' : String(s.gear), this.cx, this.cy + this.r * 0.26);
    // rev needle
    this.needle(g, this.cx, this.cy, a, this.r * 0.92, this.r * 0.16, 4, CYAN, 14);
    g.fillStyle = '#0b1517';
    g.strokeStyle = CYAN;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(this.cx, this.cy, 10, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    // speed readout
    const v = Math.round(Math.abs(s.speed) * (mph ? 2.23694 : 3.6));
    g.save();
    g.fillStyle = '#cff8fb';
    g.shadowColor = CYAN;
    g.shadowBlur = 12;
    g.font = `600 40px ${FONT}`;
    g.fillText(String(v), this.cx, this.cy + this.r * 0.62 + 27);
    g.restore();
    // small gauges
    const a0 = (150 * Math.PI) / 180;
    const sw = (240 * Math.PI) / 180;
    const bA = a0 + ((this.boostShown + 1) / 2) * sw;
    this.needle(g, this.boost.x, this.boost.y, bA, this.boost.r * 0.8, 8, 3, s.nitroActive ? '#9ff4ff' : CYAN, 10);
    // N2O: a filled arc for the tank, and a needle
    const nA = a0 + this.nosShown * sw;
    const empty = s.nitro < V.nitroMinToFire && !s.nitroActive;
    g.save();
    g.strokeStyle = empty ? 'rgba(255,77,85,0.8)' : s.nitroActive ? '#9ff4ff' : 'rgba(79,209,217,0.75)';
    g.lineWidth = 5;
    if (s.nitroActive) {
      g.shadowColor = CYAN;
      g.shadowBlur = 14;
    }
    g.beginPath();
    g.arc(this.nos.x, this.nos.y, this.nos.r * 0.98, a0, Math.max(a0 + 0.01, nA));
    g.stroke();
    g.restore();
    this.needle(g, this.nos.x, this.nos.y, nA, this.nos.r * 0.76, 7, 3, empty ? RED : CYAN, 10);
    for (const ga of [this.boost, this.nos]) {
      g.fillStyle = '#0b1517';
      g.strokeStyle = 'rgba(238,245,245,0.7)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(ga.x, ga.y, 6, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }
}

export const CLUSTER_SIZE = { w: W, h: H };
