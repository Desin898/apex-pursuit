// ─────────────────────────────────────────────────────────────────────────────
// Photo mode (Phase 3D): the race is frozen, the HUD is hidden and the camera flies freely
// within reach of your car. Depth of field (focus distance, aperture), exposure, a rule-of-
// thirds grid and Save, which downloads the frame as a PNG.
//   Keyboard: WASD move · Q/E down/up · arrows or mouse drag look · Shift faster
//             [ ] focus · − = aperture · , . exposure · G grid · H hide panel · Enter save · Esc exit
//   Pad:      left stick move · right stick look · L1/R1 down/up · R2 faster
//             D-pad ↑↓ focus · D-pad ←→ aperture · Triangle hide panel · Cross save · Circle exit
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Actions, InputManager } from '../input/InputManager';

export class PhotoMode {
  focus = 8;
  aperture = 0.6;
  exposure = 0;
  private yaw = 0;
  private pitch = 0;
  private pos = new THREE.Vector3();
  private anchor = new THREE.Vector3();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private panel = document.getElementById('photo')!;
  private grid = document.getElementById('photo-grid')!;
  private keyEdge = new Set<string>();

  constructor(private cam: THREE.PerspectiveCamera, private input: InputManager, canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', (e) => {
      if (this.panel.hidden && !this.panel.classList.contains('min')) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw -= (e.clientX - this.lastX) * 0.004;
      this.pitch = clamp(this.pitch - (e.clientY - this.lastY) * 0.004, -1.45, 1.45);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      this.keyEdge.add(e.code);
    });
  }

  active = false;

  enter(carPos: THREE.Vector3): void {
    this.active = true;
    this.pos.copy(this.cam.position);
    this.anchor.copy(carPos);
    const dir = new THREE.Vector3();
    this.cam.getWorldDirection(dir);
    this.yaw = Math.atan2(dir.x, dir.z);
    this.pitch = Math.asin(clamp(dir.y, -1, 1));
    this.focus = Math.max(1.5, this.cam.position.distanceTo(carPos));
    this.exposure = 0;
    this.panel.hidden = false;
    this.panel.classList.remove('min');
    this.refresh();
  }

  exit(): void {
    this.active = false;
    this.panel.hidden = true;
    this.grid.hidden = true;
  }

  private refresh(): void {
    const set = (id: string, v: string) => (document.getElementById(id)!.textContent = v);
    set('photo-focus', `${this.focus.toFixed(1)} m`);
    set('photo-aperture', `f/${(1.4 / Math.max(0.05, this.aperture)).toFixed(1)}`);
    set('photo-exposure', `${this.exposure >= 0 ? '+' : ''}${this.exposure.toFixed(1)} EV`);
  }

  /** Per frame while active. Returns what the player asked for. */
  update(dt: number, a: Actions): 'save' | 'exit' | null {
    const k = (c: string) => this.input.keyHeld(c);
    const edge = (c: string) => this.keyEdge.has(c);
    const st = this.input.sticks;
    let out: 'save' | 'exit' | null = null;
    if (a.back || a.pause) out = 'exit';
    else if (a.accept) out = 'save';
    // look
    const lookX = (k('ArrowLeft') ? 1 : 0) - (k('ArrowRight') ? 1 : 0) - st.rx;
    const lookY = (k('ArrowUp') ? 1 : 0) - (k('ArrowDown') ? 1 : 0) - st.ry;
    this.yaw += lookX * dt * 1.6;
    this.pitch = clamp(this.pitch + lookY * dt * 1.2, -1.45, 1.45);
    // move in the view direction, flat
    const fast = k('ShiftLeft') || k('ShiftRight') || a.throttle > 0.5 ? 3 : 1;
    const fwd = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0) - st.ly;
    const side = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0) + st.lx;
    const up = (k('KeyE') || st.r1 ? 1 : 0) - (k('KeyQ') || st.l1 ? 1 : 0);
    const sp = 6 * fast * dt;
    const fx = Math.sin(this.yaw) * Math.cos(this.pitch);
    const fz = Math.cos(this.yaw) * Math.cos(this.pitch);
    const fy = Math.sin(this.pitch);
    this.pos.x += (fx * fwd - Math.cos(this.yaw) * side) * sp;
    this.pos.z += (fz * fwd + Math.sin(this.yaw) * side) * sp;
    this.pos.y += (fy * fwd + up) * sp;
    // stay above the road and within reach of the car
    this.pos.y = clamp(this.pos.y, 0.25, 60);
    const off = this.pos.clone().sub(this.anchor);
    if (off.length() > 90) this.pos.copy(this.anchor).add(off.setLength(90));
    // depth of field and exposure
    let changed = false;
    const focusD = (edge('BracketRight') || a.up ? 1 : 0) - (edge('BracketLeft') || a.down ? 1 : 0);
    if (focusD) {
      this.focus = clamp(this.focus * (focusD > 0 ? 1.12 : 1 / 1.12), 0.6, 400);
      changed = true;
    }
    const apD = (edge('Equal') || a.right ? 1 : 0) - (edge('Minus') || a.left ? 1 : 0);
    if (apD) {
      this.aperture = clamp(this.aperture + apD * 0.1, 0, 1.6);
      changed = true;
    }
    const exD = (edge('Period') ? 1 : 0) - (edge('Comma') ? 1 : 0);
    if (exD) {
      this.exposure = clamp(this.exposure + exD * 0.3, -2, 2);
      changed = true;
    }
    if (edge('KeyG')) this.grid.hidden = !this.grid.hidden;
    if (edge('KeyH') || (st.triangle && !this.triWas)) this.panel.classList.toggle('min');
    this.triWas = st.triangle;
    if (changed) this.refresh();
    this.keyEdge.clear();
    this.cam.position.copy(this.pos);
    this.cam.lookAt(this.pos.x + fx, this.pos.y + fy, this.pos.z + fz);
    this.cam.updateMatrixWorld();
    return out;
  }
  private triWas = false;
}
