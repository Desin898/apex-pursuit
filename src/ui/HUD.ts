// HUD — the in-race overlay (Phase 3B layout): top centre event marker, position, lap and
// gaps; top right event panel with a live leaderboard; bottom left a tilted minimap; bottom right
// the instrument cluster; plus button hints, toasts and call-outs. Text nodes are only touched
// when their value changes and both canvases are cheap to draw, so the HUD costs well under 1 ms.
import type { RacingLine } from '../ai/RacingLine';
import { Cluster } from './Cluster';
import { MiniMap } from './MiniMap';
import { HUD_FIT } from '../config';
import { formatLap, LapTimer } from '../game/LapTimer';
import { ActionName, DeviceKind, deviceLabel, glyph } from '../input/InputManager';
import { VehicleState } from '../vehicle/VehiclePhysics';
import { WorldData } from '../world/WorldData';

const $ = (id: string) => document.getElementById(id)!;

/** Things marked on the minimap in a Pursuit Race. */
export interface MapIcon {
  x: number;
  z: number;
  kind: 'police' | 'roadblock' | 'spikes' | 'heli' | 'zone' | 'trap' | 'breaker' | 'charge' | 'smoke' | 'gap' | 'search' | 'hide';
  /** for line-shaped marks: direction across the track */
  ax?: number;
  az?: number;
  /** 4E: the helicopter's searchlight spot (heli), the ring size (charge, smoke) */
  lx?: number;
  lz?: number;
  r?: number;
}

export class HUD {
  private root = $('hud');
  private cluster = new Cluster($('cluster') as HTMLCanvasElement);
  private top = $('hud-top');
  private eventBox = $('hud-event');
  private gapAhead = $('gap-ahead');
  private gapBehind = $('gap-behind');
  private board = $('ev-board');
  private posRow = $('race-pos-row');
  private posEl = $('race-pos');
  private posOf = $('race-of');
  private lapNo = $('race-lap');
  private lapNow = $('lap-now');
  private lapLast = $('lap-last');
  private lapBest = $('lap-best');
  private hints = $('hud-hints');
  /** the call-out lane: toasts and radio lines share it, two at most */
  private lane = $('hud-lane');
  private popEl = $('pop');
  private debugEl = $('hud-debug');
  private soundEl = $('hud-sound');
  private minimap: MiniMap;
  private cache: Record<string, string> = {};
  private hintTimer = 0;
  private popTimer = 0;

  constructor(private world: WorldData) {
    this.minimap = new MiniMap($('map') as HTMLCanvasElement, world);
    const ro = new ResizeObserver(() => this.fit());
    ro.observe(document.documentElement);
    window.addEventListener('resize', () => this.fit());
    this.fit();
  }

  // ── Fit: the whole HUD scales as one with the window, times the HUD-size setting ──
  private userScale = 1;
  setUserScale(k: number): void {
    this.userScale = k;
    this.fit();
  }
  /** the scale in use now (HUD-size setting × window fit) */
  scale = 1;
  fit(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const fitK = Math.min(HUD_FIT.max, Math.max(HUD_FIT.min, Math.min(w / 1280, h / 720)));
    const k = Math.round(fitK * this.userScale * 1000) / 1000;
    if (k === this.scale && this.cache.fitDone) return;
    this.cache.fitDone = '1';
    this.scale = k;
    document.documentElement.style.setProperty('--hud-scale', String(k));
  }
  /** Hide the big rev dial (the cockpit's own dash shows the same). */
  setDialHidden(hidden: boolean): void {
    const el = $('hud-cluster');
    if (el.hidden !== hidden) el.hidden = hidden;
  }
  /** Room for the rear-view mirror at the top centre (0 when it is off). */
  setMirrorSpace(px: number): void {
    const v = `${Math.round(px)}px`;
    if (this.cache.mirrorH === v) return;
    this.cache.mirrorH = v;
    this.root.style.setProperty('--mirror-h', v);
  }
  private pushLane(el: HTMLElement): void {
    this.lane.appendChild(el);
    while (this.lane.children.length > HUD_FIT.laneLines) this.lane.firstElementChild!.remove();
  }

  setRacingLine(line: RacingLine): void {
    this.minimap.setLine(line);
  }
  set colourSafe(on: boolean) {
    this.minimap.colourSafe = on;
  }

  /** The event panel's header: name, type and the line under it. */
  setEvent(kind: 'circuit' | 'pursuit' | 'free', name: string, sub: string): void {
    const key = `${kind}|${name}|${sub}`;
    if (this.cache.event === key) return;
    this.cache.event = key;
    $('ev-name').textContent = name;
    $('ev-sub').textContent = sub;
    $('top-event').textContent = name;
    this.kind = kind;
    this.set($('ev-kicker'), 'kicker', this.kicker());
    this.top.classList.toggle('pursuit', kind === 'pursuit');
    this.eventBox.classList.toggle('pursuit', kind === 'pursuit');
    const icons = {
      circuit: '<svg viewBox="0 0 24 24"><path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/></svg>',
      pursuit: '<svg viewBox="0 0 24 24"><path d="M6 15a6 6 0 0 1 12 0v3H6z"/><path d="M4 21h16"/><path d="M12 3v3M4.5 6.5l2 2M19.5 6.5l-2 2"/></svg>',
      free: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="7.5"/><path d="M12 13V9M10 2h4M12 2v3"/></svg>',
    };
    $('ev-icon').innerHTML = icons[kind];
  }

  /** The event panel's leaderboard (a few rows round you) and the gaps above the HUD's centre. */
  setBoard(rows: { place: number; name: string; color: string; gap: string; me: boolean }[], ahead: string, behind: string): void {
    const key = rows.map((r) => `${r.place}${r.name}${r.gap}${r.me ? '*' : ''}`).join('|');
    if (this.cache.board !== key) {
      this.cache.board = key;
      let html = '';
      let last = 0;
      for (const r of rows) {
        if (last && r.place > last + 1) html += '<div class="ev-row"><span class="dot">···</span></div>';
        last = r.place;
        html += `<div class="ev-row${r.me ? ' me' : ''}"><span>${r.place}</span><i style="background:${r.color}"></i><span>${esc(r.name)}</span><span class="gap">${r.gap}</span></div>`;
      }
      this.board.innerHTML = html;
    }
    this.set(this.gapAhead, 'ga', ahead);
    this.set(this.gapBehind, 'gb', behind);
    this.gapAhead.className = 'ahead';
    this.gapBehind.className = 'behind';
  }

  setVisible(on: boolean): void {
    this.root.classList.toggle('off', !on);
  }

  private set(el: HTMLElement, key: string, value: string): void {
    if (this.cache[key] !== value) {
      this.cache[key] = value;
      el.textContent = value;
    }
  }

  /** the player's throttle, for the boost gauge */
  throttle = 0;

  update(s: VehicleState, lap: LapTimer, mph: boolean, dt: number, place = 1, field = 1, lapNumber = 1, lapTotal = 0): void {
    if (this.cache.field !== String(field)) {
      this.cache.field = String(field);
      this.posRow.hidden = field < 2;
    }
    if (field > 1) {
      this.set(this.posEl, 'pos', String(place));
      this.set(this.posOf, 'posof', `/${field}`);
    }
    this.set(this.lapNo, 'lapno', lapTotal > 0 ? `${Math.min(lapTotal, Math.max(1, lapNumber))}/${lapTotal}` : String(Math.max(1, lapNumber)));
    this.cluster.draw(s, mph, dt, this.throttle);
    this.set(this.lapNow, 'now', lap.running ? formatLap(Math.max(0.001, lap.time)) : '0:00.00');
    this.set(this.lapLast, 'last', formatLap(lap.last));
    this.set(this.lapBest, 'best', formatLap(lap.best));

    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hints.classList.add('faded');
    }
    if (this.popTimer > 0) {
      this.popTimer -= dt;
      if (this.popTimer <= 0) this.popEl.classList.remove('on');
    }
  }

  /** Rebuild the button-hint list for the device in use; it fades after a while. */
  setHints(kind: DeviceKind, manual: boolean, seconds = 14): void {
    const rows: [ActionName, string][] = [
      ['accelerate', 'Accelerate'],
      ['brake', 'Brake / reverse'],
      ['steer', 'Steer'],
      ['handbrake', 'Handbrake'],
      ['nitro', 'Nitrous'],
      ['camera', 'Change camera'],
      ['lookBack', 'Look back'],
      ['lookSide', 'Look left / right'],
      ['reset', 'Reset car'],
      ['pause', 'Pause / settings'],
    ];
    if (manual) rows.splice(5, 0, ['shiftUp', 'Shift up'], ['shiftDown', 'Shift down']);
    let html = `<div class="label dev">${deviceLabel(kind)}</div>`;
    for (const [a, label] of rows) html += `<div class="hint"><kbd>${glyph(kind, a)}</kbd><span>${label}</span></div>`;
    this.hints.innerHTML = html;
    this.hints.classList.remove('faded');
    this.hintTimer = seconds;
  }

  toast(text: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.pushLane(el);
    setTimeout(() => el.remove(), 2700);
  }

  /** Big centre call-out (drift score, air time, lap). */
  pop(text: string, sub: string, banked = false, hold = 1.2): void {
    const key = text + '|' + sub + '|' + banked;
    if (this.cache.pop !== key) {
      this.cache.pop = key;
      this.popEl.innerHTML = `<small>${sub}</small>${text}`;
      this.popEl.classList.toggle('banked', banked);
    }
    this.popEl.classList.add('on');
    this.popTimer = hold;
  }

  /** "Proving grounds" offline, "Online · room" online: shown as the event panel's kicker */
  setVenue(text: string): void {
    this.venue = text;
    this.set($('ev-kicker'), 'kicker', this.kicker());
  }
  private venue = '';
  private kind: 'circuit' | 'pursuit' | 'free' = 'circuit';
  private kicker(): string {
    if (this.venue.startsWith('Online')) return this.venue;
    return this.kind === 'free' ? 'Time trial' : this.kind === 'pursuit' ? 'Pursuit event' : 'Circuit event';
  }
  setDebug(text: string | null): void {
    this.debugEl.hidden = text === null;
    if (text !== null) this.debugEl.textContent = text;
  }
  showSoundHint(on: boolean): void {
    this.soundEl.hidden = !on;
  }

  // ── Minimap ────────────────────────────────────────────────────────────
  drawMap(x: number, z: number, yaw: number, speed: number, others: { x: number; z: number; color: string }[], icons: MapIcon[], time: number, dt: number): void {
    // the minimap redraws at 30 Hz at most (4B.2): nobody can tell, and it saves a canvas redraw
    this.mapAcc += dt;
    if (this.mapAcc < 1 / 30) return;
    this.minimap.draw(x, z, yaw, speed, others, icons, time, this.mapAcc);
    this.mapAcc = 0;
  }
  private mapAcc = 1;

  // ── Pursuit panel ──
  private heatBox = $('hud-heat');
  private meters = $('hud-meters');
  setPursuit(p: { on: boolean; joined: boolean; heat: number; status: string; cool: boolean; bust: number; evade: number; air?: '' | 'spotted' | 'hidden' | 'inbound'; bounty?: number }): void {
    if (this.cache.pon !== String(p.on)) {
      this.cache.pon = String(p.on);
      this.heatBox.hidden = !p.on;
      if (!p.on) this.meters.hidden = true;
    }
    if (!p.on) return;
    const lvl = p.joined ? Math.max(1, Math.floor(p.heat)) : 0;
    this.set($('heat-label'), 'heatl', p.joined ? `Heat ${lvl}` : 'Clean');
    this.set($('heat-status'), 'heats', p.status);
    const pips = $('heat-pips').children;
    const key = p.joined ? `${lvl}|${Math.round((p.heat - lvl) * 10)}` : '0';
    if (this.cache.pips !== key) {
      this.cache.pips = key;
      for (let i = 0; i < 5; i++) {
        const el = pips[i] as HTMLElement;
        el.classList.toggle('on', p.joined && i < lvl);
        const part = p.joined && i === lvl && lvl < 5;
        el.classList.toggle('part', part);
        if (part) el.style.setProperty('--p', `${Math.round((p.heat - lvl) * 100)}%`);
      }
    }
    this.heatBox.classList.toggle('cool', p.cool);
    // 4F: the bounty built up in this chase
    const b = Math.round((p.bounty ?? 0) / 10) * 10;
    if (this.cache.bounty !== String(b)) {
      this.cache.bounty = String(b);
      const el = $('heat-bounty');
      el.hidden = b <= 0;
      el.querySelector('b')!.textContent = b.toLocaleString('en-US');
    }
    // 4E: is Air One watching you?
    const air = p.air ?? '';
    if (this.cache.air !== air) {
      this.cache.air = air;
      const el = $('heat-air');
      el.hidden = !air;
      el.className = `air ${air}`;
      el.querySelector('em')!.textContent = air === 'spotted' ? 'Spotted' : air === 'hidden' ? 'Hidden from it' : 'Inbound';
    }
    if (this.cache.mj !== String(p.joined)) {
      this.cache.mj = String(p.joined);
      this.meters.hidden = !p.joined;
    }
    ($('bust-fill') as HTMLElement).style.transform = `scaleX(${p.bust.toFixed(3)})`;
    ($('evade-fill') as HTMLElement).style.transform = `scaleX(${p.evade.toFixed(3)})`;
    (this.meters.children[0] as HTMLElement).classList.toggle('idle', p.bust < 0.01);
    (this.meters.children[1] as HTMLElement).classList.toggle('idle', p.evade < 0.01);
  }

  /** A dispatcher line, as a subtitle. */
  radio(text: string): void {
    const el = document.createElement('div');
    el.className = 'line';
    el.innerHTML = '<i></i>';
    el.appendChild(document.createTextNode(text));
    for (const old of Array.from(this.lane.querySelectorAll('.line'))) old.remove(); // one dispatcher at a time
    this.pushLane(el);
    setTimeout(() => el.remove(), 5000);
  }
}

function esc(t: string): string {
  return t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
