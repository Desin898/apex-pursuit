// ─────────────────────────────────────────────────────────────────────────────
// InputManager — keyboard + Gamepad API, with the DualShock 4 as the first-class pad.
//
// Game code never reads keys or buttons directly: it reads the `Actions` snapshot produced by
// poll(). Bindings live in the tables below, so the remapping screen planned for the polish
// stage only has to edit data.
// ─────────────────────────────────────────────────────────────────────────────
import { clamp } from '../core/math';

export type DeviceKind = 'keyboard' | 'playstation' | 'xbox' | 'generic';

export interface Actions {
  throttle: number;
  brake: number;
  steer: number; // −1 left .. +1 right
  analogSteer: boolean;
  handbrake: boolean;
  nitro: boolean;
  lookBack: boolean;
  horn: boolean;
  lookX: number; // right stick, for free look
  lookY: number;
  /** Z / X: +1 look left, −1 look right, 0 none */
  lookSide: number;
  /** right-button mouse drag on the game view: yaw / pitch offsets (rad) while held, else null */
  mouseLook: { yaw: number; pitch: number } | null;
  // one-shot (true only on the frame the control goes down)
  shiftUp: boolean;
  shiftDown: boolean;
  camera: boolean;
  reset: boolean;
  pause: boolean;
  paintNext: boolean;
  paintPrev: boolean;
  fullscreen: boolean;
  // menu navigation (with key-repeat)
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  accept: boolean;
  back: boolean;
  /** anything at all was pressed this frame ("press any button") */
  any: boolean;
}

export interface InputSettings {
  deadzone: number; // 0..0.3
  steerCurve: number; // 1 = linear, 2 = much finer around centre
  triggerCurve: number;
}

// Standard-mapping button indices (what Chrome/Edge/Safari report for DualShock 4, DualSense and Xbox pads)
const B = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, share: 8, options: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, ps: 16, touchpad: 17 };
// Raw DualShock 4 layout some browsers (notably Firefox) expose when they don't remap the pad
const DS4_RAW = { square: 0, cross: 1, circle: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, share: 8, options: 9, l3: 10, r3: 11, ps: 12, touchpad: 13 };

const KEYS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  nitro: ['ShiftLeft', 'ShiftRight', 'KeyN'],
  lookBack: ['KeyB'],
  lookLeft: ['KeyZ'],
  lookRight: ['KeyX'],
  horn: ['KeyH'],
  shiftUp: ['KeyE'],
  shiftDown: ['KeyQ'],
  camera: ['KeyC'],
  reset: ['KeyR'],
  pause: ['Escape', 'KeyP'],
  paintNext: ['KeyV'],
  fullscreen: ['KeyF'],
  accept: ['Enter', 'Space'],
  back: ['Escape', 'Backspace'],
};

export function deviceLabel(kind: DeviceKind): string {
  return kind === 'playstation' ? 'PlayStation controller' : kind === 'xbox' ? 'Xbox controller' : kind === 'generic' ? 'Controller' : 'Keyboard';
}

function classify(id: string): DeviceKind {
  if (/054c|dualshock|dualsense|playstation|wireless controller|ps[345] controller/i.test(id)) return 'playstation';
  if (/xbox|xinput|045e|x-box/i.test(id)) return 'xbox';
  return 'generic';
}

export class InputManager {
  readonly actions: Actions = {
    throttle: 0, brake: 0, steer: 0, analogSteer: false, handbrake: false, nitro: false, lookBack: false, horn: false, lookX: 0, lookY: 0, lookSide: 0, mouseLook: null,
    shiftUp: false, shiftDown: false, camera: false, reset: false, pause: false, paintNext: false, paintPrev: false, fullscreen: false,
    up: false, down: false, left: false, right: false, accept: false, back: false, any: false,
  };
  settings: InputSettings = { deadzone: 0.08, steerCurve: 1.6, triggerCurve: 1.0 };
  /** which device produced the most recent input — drives the on-screen button prompts */
  device: DeviceKind = 'keyboard';
  padName = '';
  padConnected = false;
  /** true when the browser refuses Gamepad access (e.g. an embedded frame without permission) */
  padBlocked = false;
  /** the active Gamepad object, refreshed every poll (used by Haptics) */
  pad: Gamepad | null = null;
  /** raw stick positions and a few held buttons (photo mode flies with these) */
  readonly sticks = { lx: 0, ly: 0, rx: 0, ry: 0, l1: false, r1: false, triangle: false };
  /** a keyboard key is held (by KeyboardEvent.code) */
  keyHeld(code: string): boolean {
    return this.keys.has(code);
  }
  onDeviceChange: (kind: DeviceKind) => void = () => {};
  onPadConnection: (connected: boolean, name: string, kind: DeviceKind) => void = () => {};

  private keys = new Set<string>();
  private drag: { yaw: number; pitch: number } | null = null;
  /** rad per pixel of right-button drag */
  mouseLookRate = 0.006;
  private keyEdges = new Set<string>();
  private prevButtons: boolean[] = [];
  private repeat = { up: 0, down: 0, left: 0, right: 0 };
  private padIndex = -1;
  private kbThrottle = 0;
  private kbBrake = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return; // typing in a text field
      if (e.repeat) {
        if (this.isGameKey(e.code)) e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      this.keyEdges.add(e.code);
      if (this.isGameKey(e.code)) e.preventDefault();
      this.setDevice('keyboard');
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    // Right-button drag on the game view looks around; it springs back on release.
    target.addEventListener('pointerdown', (e) => {
      const el = e.target as HTMLElement | null;
      if (e.button !== 2 || !el || el.id !== 'game') return;
      this.drag = { yaw: 0, pitch: 0 };
      e.preventDefault();
    });
    target.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      this.drag.yaw = Math.max(-Math.PI, Math.min(Math.PI, this.drag.yaw - e.movementX * this.mouseLookRate));
      this.drag.pitch = Math.max(-0.6, Math.min(0.5, this.drag.pitch - e.movementY * this.mouseLookRate));
    });
    target.addEventListener('pointerup', (e) => {
      if (e.button === 2) this.drag = null;
    });
    target.addEventListener('contextmenu', (e) => {
      const el = e.target as HTMLElement | null;
      if (el && el.id === 'game') e.preventDefault();
    });
    target.addEventListener('blur', () => this.keys.clear());
    target.addEventListener('gamepadconnected', (e) => {
      const gp = (e as GamepadEvent).gamepad;
      this.onPadConnection(true, gp.id, classify(gp.id));
    });
    target.addEventListener('gamepaddisconnected', (e) => {
      const gp = (e as GamepadEvent).gamepad;
      if (gp.index === this.padIndex) {
        this.padIndex = -1;
        this.padConnected = false;
        this.pad = null;
      }
      this.onPadConnection(false, gp.id, classify(gp.id));
    });
  }

  private isGameKey(code: string): boolean {
    return code.startsWith('Arrow') || code === 'Space' || code === 'Tab';
  }
  private setDevice(kind: DeviceKind): void {
    if (kind !== this.device) {
      this.device = kind;
      this.onDeviceChange(kind);
    }
  }
  private held(list: string[]): boolean {
    for (const k of list) if (this.keys.has(k)) return true;
    return false;
  }
  private pressed(list: string[]): boolean {
    for (const k of list) if (this.keyEdges.has(k)) return true;
    return false;
  }

  private axis(v: number, curve: number): number {
    const dz = this.settings.deadzone;
    const a = Math.abs(v);
    if (a <= dz) return 0;
    const n = (a - dz) / (1 - dz);
    return Math.sign(v) * Math.pow(clamp(n, 0, 1), curve);
  }

  /** Call once per rendered frame. `dt` in seconds (for menu key-repeat). */
  poll(dt: number): Actions {
    const a = this.actions;
    // ── keyboard ──
    // Keys are on/off, so ramp them like a foot would: throttle in over ~0.25 s, brake ~0.15 s.
    const kt = this.held(KEYS.throttle) ? 1 : 0;
    const kb = this.held(KEYS.brake) ? 1 : 0;
    this.kbThrottle = kt > this.kbThrottle ? Math.min(kt, this.kbThrottle + dt * 4) : Math.max(kt, this.kbThrottle - dt * 10);
    this.kbBrake = kb > this.kbBrake ? Math.min(kb, this.kbBrake + dt * 6.5) : Math.max(kb, this.kbBrake - dt * 12);
    let throttle = this.kbThrottle;
    let brake = this.kbBrake;
    let steer = (this.held(KEYS.right) ? 1 : 0) - (this.held(KEYS.left) ? 1 : 0);
    let analog = false;
    let handbrake = this.held(KEYS.handbrake);
    let nitro = this.held(KEYS.nitro);
    let lookBack = this.held(KEYS.lookBack);
    let horn = this.held(KEYS.horn);
    let shiftUp = this.pressed(KEYS.shiftUp);
    let shiftDown = this.pressed(KEYS.shiftDown);
    let camera = this.pressed(KEYS.camera);
    let reset = this.pressed(KEYS.reset);
    let pause = this.pressed(KEYS.pause);
    let paintNext = this.pressed(KEYS.paintNext);
    let paintPrev = false;
    const fullscreen = this.pressed(KEYS.fullscreen);
    let accept = this.pressed(KEYS.accept);
    let back = this.pressed(KEYS.back);
    // menus also count a tap that began and ended between two frames
    let navUp = this.held(KEYS.throttle) || this.pressed(KEYS.throttle);
    let navDown = this.held(KEYS.brake) || this.pressed(KEYS.brake);
    let navLeft = this.held(KEYS.left) || this.pressed(KEYS.left);
    let navRight = this.held(KEYS.right) || this.pressed(KEYS.right);
    let any = this.keyEdges.size > 0;
    let lookX = 0;
    let lookY = 0;

    // ── gamepad ──
    let pads: (Gamepad | null)[] = [];
    try {
      pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
      this.padBlocked = false;
    } catch {
      this.padBlocked = true;
    }
    let gp: Gamepad | null = null;
    if (this.padIndex >= 0 && pads[this.padIndex] && pads[this.padIndex]!.connected) gp = pads[this.padIndex];
    else {
      for (const p of pads) {
        if (p && p.connected && p.buttons.length >= 10) {
          gp = p;
          this.padIndex = p.index;
          this.prevButtons = [];
          break;
        }
      }
    }
    this.pad = gp;
    this.padConnected = !!gp;
    if (gp) {
      const kind = classify(gp.id);
      this.padName = gp.id;
      const std = gp.mapping === 'standard';
      const raw = !std && kind === 'playstation';
      const M = raw ? { ...B, ...DS4_RAW, up: -1, down: -1, left: -1, right: -1 } : B;
      const btn = (i: number) => (i >= 0 && i < gp!.buttons.length ? gp!.buttons[i].pressed || gp!.buttons[i].value > 0.5 : false);
      const val = (i: number) => (i >= 0 && i < gp!.buttons.length ? gp!.buttons[i].value : 0);
      const edge = (i: number) => btn(i) && !this.prevButtons[i];

      // Triggers: analog button values on the standard mapping, axes 3/4 (−1..1) on raw DS4.
      let r2 = val(M.r2);
      let l2 = val(M.l2);
      if (raw && gp.axes.length >= 5) {
        l2 = Math.max(l2, (gp.axes[3] + 1) / 2);
        r2 = Math.max(r2, (gp.axes[4] + 1) / 2);
      }
      r2 = Math.pow(clamp(r2, 0, 1), this.settings.triggerCurve);
      l2 = Math.pow(clamp(l2, 0, 1), this.settings.triggerCurve);
      const sx = this.axis(gp.axes[0] ?? 0, this.settings.steerCurve);
      const sy = this.axis(gp.axes[1] ?? 0, 1);
      const rx = this.axis(gp.axes[2] ?? 0, 1.4);
      const ry = this.axis((raw ? gp.axes[5] : gp.axes[3]) ?? 0, 1.4);
      this.sticks.lx = sx;
      this.sticks.ly = sy;
      this.sticks.rx = rx;
      this.sticks.ry = ry;
      this.sticks.l1 = btn(M.l1);
      this.sticks.r1 = btn(M.r1);
      this.sticks.triangle = btn(M.triangle);
      // D-pad: buttons 12–15 on the standard mapping; a hat axis on raw layouts.
      let dUp = btn(M.up);
      let dDown = btn(M.down);
      let dLeft = btn(M.left);
      let dRight = btn(M.right);
      if (raw && gp.axes.length >= 8) {
        dLeft = gp.axes[6] < -0.5;
        dRight = gp.axes[6] > 0.5;
        dUp = gp.axes[7] < -0.5;
        dDown = gp.axes[7] > 0.5;
      }

      let active = Math.abs(sx) > 0.25 || r2 > 0.2 || l2 > 0.2 || Math.abs(rx) > 0.4 || Math.abs(ry) > 0.4;
      for (let i = 0; i < gp.buttons.length; i++) {
        if (btn(i) && !this.prevButtons[i]) {
          active = true;
          any = true;
        }
      }
      if (active) this.setDevice(kind);

      if (this.device !== 'keyboard' || active) {
        throttle = Math.max(throttle, r2);
        brake = Math.max(brake, l2);
        if (Math.abs(sx) > Math.abs(steer) || steer === 0) {
          if (sx !== 0) analog = true;
          steer = steer === 0 ? sx : steer;
        }
        handbrake = handbrake || btn(M.cross);
        nitro = nitro || btn(M.square);
        lookBack = lookBack || btn(M.circle) || btn(M.r3);
        horn = horn || btn(M.circle);
        lookX = rx;
        lookY = ry;
        shiftUp = shiftUp || edge(M.r1);
        shiftDown = shiftDown || edge(M.l1);
        camera = camera || edge(M.triangle);
        reset = reset || edge(M.share);
        pause = pause || edge(M.options);
        accept = accept || edge(M.cross);
        back = back || edge(M.circle);
        navUp = navUp || dUp || sy < -0.6;
        navDown = navDown || dDown || sy > 0.6;
        navLeft = navLeft || dLeft || sx < -0.6;
        navRight = navRight || dRight || sx > 0.6;
        // D-pad left/right cycles paint for now (it becomes quick-chat in the multiplayer stage)
        if (dRight && !this.prevDpad.right) paintNext = true;
        if (dLeft && !this.prevDpad.left) paintPrev = true;
      }
      this.prevDpad.left = dLeft;
      this.prevDpad.right = dRight;
      for (let i = 0; i < gp.buttons.length; i++) this.prevButtons[i] = btn(i);
    }

    a.throttle = throttle;
    a.brake = brake;
    a.steer = clamp(steer, -1, 1);
    a.analogSteer = analog;
    a.handbrake = handbrake;
    a.nitro = nitro;
    a.lookBack = lookBack;
    a.horn = horn;
    a.lookX = lookX;
    a.lookY = lookY;
    a.lookSide = (this.held(KEYS.lookLeft) ? 1 : 0) - (this.held(KEYS.lookRight) ? 1 : 0);
    a.mouseLook = this.drag;
    a.shiftUp = shiftUp;
    a.shiftDown = shiftDown;
    a.camera = camera;
    a.reset = reset;
    a.pause = pause;
    a.paintNext = paintNext;
    a.paintPrev = paintPrev;
    a.fullscreen = fullscreen;
    a.accept = accept;
    a.back = back;
    a.any = any;
    a.up = this.repeater('up', navUp, dt);
    a.down = this.repeater('down', navDown, dt);
    a.left = this.repeater('left', navLeft, dt);
    a.right = this.repeater('right', navRight, dt);
    this.keyEdges.clear();
    return a;
  }

  private prevDpad = { left: false, right: false };

  /** Menu key-repeat: fires on press, then after 0.38 s, then every 0.11 s. */
  private repeater(k: 'up' | 'down' | 'left' | 'right', held: boolean, dt: number): boolean {
    if (!held) {
      this.repeat[k] = 0;
      return false;
    }
    const before = this.repeat[k];
    this.repeat[k] += dt;
    if (before === 0) return true;
    const t = this.repeat[k] - 0.38;
    if (t < 0) return false;
    return Math.floor(t / 0.11) !== Math.floor((before - 0.38) / 0.11) || before < 0.38;
  }
}

// ── Button prompt glyphs, per device ─────────────────────────────────────────
export type ActionName = 'accelerate' | 'brake' | 'steer' | 'handbrake' | 'nitro' | 'camera' | 'lookBack' | 'reset' | 'pause' | 'shiftUp' | 'shiftDown' | 'accept' | 'back' | 'paint' | 'look' | 'lookSide';

const GLYPHS: Record<DeviceKind, Record<ActionName, string>> = {
  keyboard: { accelerate: 'W', brake: 'S', steer: 'A D', handbrake: 'Space', nitro: 'Shift', camera: 'C', lookBack: 'B', reset: 'R', pause: 'Esc', shiftUp: 'E', shiftDown: 'Q', accept: 'Enter', back: 'Esc', paint: 'V', look: 'Right-drag', lookSide: 'Z X' },
  playstation: { accelerate: 'R2', brake: 'L2', steer: 'L', handbrake: '✕', nitro: '□', camera: '△', lookBack: '○', reset: 'Share', pause: 'Options', shiftUp: 'R1', shiftDown: 'L1', accept: '✕', back: '○', paint: 'D-pad ◂ ▸', look: 'R', lookSide: 'R ◂ ▸' },
  xbox: { accelerate: 'RT', brake: 'LT', steer: 'L', handbrake: 'A', nitro: 'X', camera: 'Y', lookBack: 'B', reset: 'View', pause: 'Menu', shiftUp: 'RB', shiftDown: 'LB', accept: 'A', back: 'B', paint: 'D-pad ◂ ▸', look: 'R', lookSide: 'R ◂ ▸' },
  generic: { accelerate: 'RT', brake: 'LT', steer: 'L', handbrake: 'A', nitro: 'X', camera: 'Y', lookBack: 'B', reset: 'Select', pause: 'Start', shiftUp: 'RB', shiftDown: 'LB', accept: 'A', back: 'B', paint: 'D-pad ◂ ▸', look: 'R', lookSide: 'R ◂ ▸' },
};

export function glyph(kind: DeviceKind, action: ActionName): string {
  return GLYPHS[kind][action];
}
