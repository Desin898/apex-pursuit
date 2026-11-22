// ─────────────────────────────────────────────────────────────────────────────
// MiniMap — the in-race map (Phase 3B), bottom left: a rounded square seen at a slight
// perspective tilt (CSS), turning with the car so ahead is always up. Roads as light lines,
// the racing line in cyan, the finish line, your arrow in the middle, rivals in their colours,
// police flashing red and blue (amber and blue when colour-blind-safe is on), and the pursuit
// marks: roadblocks, spike strips, speed cameras, work zones, breakers and the helicopter.
// The track is a Path2D in world units built once; a frame is a few strokes and dots.
// ─────────────────────────────────────────────────────────────────────────────
import type { RacingLine } from '../ai/RacingLine';
import type { WorldData } from '../world/WorldData';
import type { MapIcon } from './HUD';

const SIZE = 420; // canvas px (css size is set by the stylesheet)

export class MiniMap {
  private g: CanvasRenderingContext2D;
  private road = new Path2D();
  private lineP = new Path2D();
  private extras = new Path2D();
  private zoom = 1.3; // px per metre
  private line: RacingLine | null = null;
  colourSafe = false;

  constructor(private canvas: HTMLCanvasElement, private world: WorldData) {
    canvas.width = canvas.height = SIZE;
    this.g = canvas.getContext('2d')!;
    const S = world.samples;
    S.forEach((s, i) => (i ? this.road.lineTo(s.x, s.z) : this.road.moveTo(s.x, s.z)));
    this.road.closePath();
    for (const a of world.aprons) this.extras.rect(a.x0, a.z0, a.x1 - a.x0, a.z1 - a.z0);
    this.extras.moveTo(world.pad.x + world.pad.r, world.pad.z);
    this.extras.arc(world.pad.x, world.pad.z, world.pad.r, 0, Math.PI * 2);
  }

  /** The racing line to draw in cyan (changes with the race). */
  setLine(line: RacingLine): void {
    if (line === this.line) return;
    this.line = line;
    this.lineP = new Path2D();
    const S = this.world.samples;
    for (let i = 0; i < S.length; i += 2) {
      const s = S[i];
      const x = s.x + s.nx * line.off[i];
      const z = s.z + s.nz * line.off[i];
      if (i) this.lineP.lineTo(x, z);
      else this.lineP.moveTo(x, z);
    }
    this.lineP.closePath();
  }

  draw(x: number, z: number, yaw: number, speed: number, others: { x: number; z: number; color: string }[], icons: MapIcon[], time: number, dt: number): void {
    const g = this.g;
    const c = SIZE / 2;
    // zoom out with speed: about 160 m ahead when slow, 260 m flat out
    const want = 1.55 - Math.min(1, speed / 80) * 0.6;
    this.zoom += (want - this.zoom) * Math.min(1, dt * 1.5);
    const k = this.zoom;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, SIZE, SIZE);
    // rounded-square plate
    g.save();
    roundRect(g, 6, 6, SIZE - 12, SIZE - 12, 46);
    g.fillStyle = 'rgba(8,16,18,0.62)';
    g.fill();
    g.strokeStyle = 'rgba(79,209,217,0.35)';
    g.lineWidth = 3;
    g.stroke();
    g.clip();
    // world → map: you in the lower middle, heading up
    const oy = c + SIZE * 0.14;
    const rot = Math.PI + yaw; // car forward (+z rotated by yaw) points up the screen
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const P = (wx: number, wz: number): [number, number] => {
      const dx = (wx - x) * k;
      const dz = (wz - z) * k;
      return [c + dx * cs - dz * sn, oy + dx * sn + dz * cs];
    };
    g.setTransform(k * cs, k * sn, -k * sn, k * cs, c - (x * cs - z * sn) * k, oy - (x * sn + z * cs) * k);
    g.lineJoin = 'round';
    g.fillStyle = 'rgba(244,241,234,0.12)';
    g.fill(this.extras);
    g.strokeStyle = 'rgba(4,8,10,0.9)';
    g.lineWidth = 22 / k;
    g.stroke(this.road);
    g.strokeStyle = 'rgba(232,240,240,0.88)';
    g.lineWidth = 13 / k;
    g.stroke(this.road);
    g.strokeStyle = 'rgba(79,209,217,0.95)';
    g.lineWidth = 3.2 / k;
    g.stroke(this.lineP);
    g.setTransform(1, 0, 0, 1, 0, 0);
    // finish line: a chequered bar across the track
    const st = this.world.samples[this.world.startIndex];
    {
      const [ax, ay] = P(st.x + st.nx * 14, st.z + st.nz * 14);
      const [bx, by] = P(st.x - st.nx * 14, st.z - st.nz * 14);
      g.lineCap = 'butt';
      g.lineWidth = 11;
      g.strokeStyle = '#0a0b0e';
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.stroke();
      g.setLineDash([5, 5]);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 7;
      g.stroke();
      g.setLineDash([]);
    }
    // pursuit marks
    const flash = Math.floor(time * 4) % 2 === 0;
    const red = this.colourSafe ? '#ffb000' : '#ff3b47';
    for (const ic of icons) {
      const [px, py] = P(ic.x, ic.z);
      if (px < -30 || px > SIZE + 30 || py < -30 || py > SIZE + 30) continue;
      g.lineWidth = 3;
      g.strokeStyle = '#0a0b0e';
      if (ic.kind === 'police') {
        g.beginPath();
        g.arc(px, py, 10, 0, Math.PI * 2);
        g.fillStyle = flash ? red : '#3d7bff';
        g.fill();
        g.stroke();
      } else if (ic.kind === 'heli') {
        // 4E: its searchlight: a cone from the helicopter to the spot on the ground
        if (ic.lx !== undefined && ic.lz !== undefined) {
          const [lx, ly] = P(ic.lx, ic.lz);
          const ang = Math.atan2(ly - py, lx - px);
          const len = Math.hypot(lx - px, ly - py);
          const w = Math.max(10, len * 0.25);
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(lx + Math.cos(ang + Math.PI / 2) * w, ly + Math.sin(ang + Math.PI / 2) * w);
          g.lineTo(lx + Math.cos(ang - Math.PI / 2) * w, ly + Math.sin(ang - Math.PI / 2) * w);
          g.closePath();
          g.fillStyle = 'rgba(255,240,190,0.22)';
          g.fill();
          g.beginPath();
          g.arc(lx, ly, w, 0, Math.PI * 2);
          g.fillStyle = 'rgba(255,244,210,0.3)';
          g.fill();
        }
        g.beginPath();
        g.arc(px, py, 20, 0, Math.PI * 2);
        g.fillStyle = 'rgba(10,11,14,0.55)';
        g.fill();
        g.strokeStyle = flash ? '#ffffff' : red;
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(px - 13, py);
        g.lineTo(px + 13, py);
        g.moveTo(px, py - 13);
        g.lineTo(px, py + 13);
        g.stroke();
      } else if (ic.kind === 'search') {
        // 4F: where they're looking for you: a pulsing circle round the last sighting
        const [ex, ey] = P(ic.x + (ic.r ?? 70), ic.z);
        const rr = Math.hypot(ex - px, ey - py);
        g.beginPath();
        g.arc(px, py, rr, 0, Math.PI * 2);
        g.fillStyle = 'rgba(255,77,85,0.10)';
        g.fill();
        g.setLineDash([10, 8]);
        g.lineWidth = 4;
        g.strokeStyle = flash ? 'rgba(255,77,85,0.9)' : 'rgba(255,77,85,0.5)';
        g.stroke();
        g.setLineDash([]);
      } else if (ic.kind === 'hide') {
        // 4F: a hiding spot
        const [ex, ey] = P(ic.x + (ic.r ?? 12), ic.z);
        const rr = Math.max(10, Math.hypot(ex - px, ey - py));
        g.beginPath();
        g.arc(px, py, rr, 0, Math.PI * 2);
        g.fillStyle = 'rgba(95,227,154,0.22)';
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = '#5fe39a';
        g.stroke();
      } else if (ic.kind === 'gap') {
        // 4F: the way through the roadblock
        g.beginPath();
        g.arc(px, py, 9, 0, Math.PI * 2);
        g.fillStyle = '#5fe39a';
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = '#0a0b0e';
        g.stroke();
      } else if (ic.kind === 'charge' || ic.kind === 'smoke') {
        // 4E: Air One's drops: a blinking red ring (shock charge), a grey blot (smoke)
        const [ex, ey] = P(ic.x + (ic.r ?? 5), ic.z);
        const rr = Math.max(9, Math.hypot(ex - px, ey - py));
        g.beginPath();
        g.arc(px, py, rr, 0, Math.PI * 2);
        if (ic.kind === 'smoke') {
          g.fillStyle = 'rgba(190,196,204,0.55)';
          g.fill();
        } else {
          g.lineWidth = 6;
          g.strokeStyle = flash ? red : '#ffffff';
          g.stroke();
        }
      } else if (ic.kind === 'roadblock' || ic.kind === 'spikes') {
        const [qx, qy] = P(ic.x + (ic.ax ?? 1) * 14, ic.z + (ic.az ?? 0) * 14);
        const [rx, ry] = P(ic.x - (ic.ax ?? 1) * 14, ic.z - (ic.az ?? 0) * 14);
        g.lineCap = 'round';
        g.lineWidth = 12;
        g.strokeStyle = '#0a0b0e';
        g.beginPath();
        g.moveTo(qx, qy);
        g.lineTo(rx, ry);
        g.stroke();
        g.lineWidth = 7;
        g.strokeStyle = ic.kind === 'roadblock' ? (flash ? red : '#ffffff') : '#ffb020';
        g.stroke();
        g.lineCap = 'butt';
      } else if (ic.kind === 'zone') {
        g.beginPath();
        g.moveTo(px, py - 11);
        g.lineTo(px + 10, py + 7);
        g.lineTo(px - 10, py + 7);
        g.closePath();
        g.fillStyle = '#ffb020';
        g.fill();
        g.stroke();
      } else if (ic.kind === 'trap') {
        // a small camera
        g.fillStyle = '#e9edf2';
        roundRect(g, px - 10, py - 7, 20, 14, 3);
        g.fill();
        g.stroke();
        g.fillStyle = '#0a0b0e';
        g.beginPath();
        g.arc(px, py, 3.5, 0, Math.PI * 2);
        g.fill();
      } else if (ic.kind === 'breaker') {
        g.beginPath();
        g.moveTo(px, py - 10);
        g.lineTo(px + 10, py);
        g.lineTo(px, py + 10);
        g.lineTo(px - 10, py);
        g.closePath();
        g.fillStyle = '#ff8a2a';
        g.fill();
        g.stroke();
      }
    }
    // rivals (pinned to the rim when they are off the map, so you know where they are)
    for (const o of others) {
      let [px, py] = P(o.x, o.z);
      const ex = px - c;
      const ey = py - c;
      const lim = c - 22;
      const m = Math.max(Math.abs(ex), Math.abs(ey));
      const off = m > lim;
      if (off) {
        px = c + (ex / m) * lim;
        py = c + (ey / m) * lim;
      }
      g.beginPath();
      g.arc(px, py, off ? 6 : 8.5, 0, Math.PI * 2);
      g.fillStyle = o.color;
      g.globalAlpha = off ? 0.7 : 1;
      g.fill();
      g.lineWidth = 2.5;
      g.strokeStyle = '#0a0b0e';
      g.stroke();
      g.globalAlpha = 1;
    }
    // you
    g.translate(c, oy);
    g.beginPath();
    g.moveTo(0, -17);
    g.lineTo(12, 13);
    g.lineTo(0, 6);
    g.lineTo(-12, 13);
    g.closePath();
    g.shadowColor = '#4fd1d9';
    g.shadowBlur = 12;
    g.fillStyle = '#4fd1d9';
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = '#0a0b0e';
    g.lineWidth = 3;
    g.stroke();
    g.restore();
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
