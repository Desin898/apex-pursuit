// ─────────────────────────────────────────────────────────────────────────────
// Screens — the menu pages outside a race: loading, home, car select and garage.
// Pages slide and fade between each other; each page owns a Nav for mouse / keyboard /
// DualShock 4 focus. main.ts owns the game; it hands this class a small set of callbacks.
// ─────────────────────────────────────────────────────────────────────────────
import { VENUES } from '../world/venues';
import { PAINTS } from '../config';
import { Settings } from '../core/Settings';
import { formatLap } from '../game/LapTimer';
import { Actions, DeviceKind, glyph } from '../input/InputManager';
import { CALIPER_COLOURS, CAR_MODELS, EDITIONS, editionById, modelOf, FINISHES, Loadout, lookOf, RIM_COLOURS, statsOf, UNDERGLOW_COLOURS } from '../vehicle/Cars';
import { artUrl } from './art';
import { Nav } from './Nav';
import { MusicMenu } from './MusicMenu';

export type PageId = 'loading' | 'home' | 'cars' | 'garage' | 'event' | 'results' | 'music';

export interface BoardRow {
  place: number;
  name: string;
  color: number;
  me: boolean;
  gap?: string;
  best?: number;
}

export interface ScreenHooks {
  settings: Settings;
  save(): void;
  sound(kind: 'move' | 'accept' | 'back'): void;
  /** the garage or car select changed the loadout: re-apply it to the 3D car */
  lookChanged(): void;
  race(): void;
  freeRun(): void;
  online(): void;
  openSettings(): void;
  onlineInfo(): { status: string; players: number; host: boolean };
  /** 4D: the venue loaded now, and switching (reloads the world) */
  venueId(): string;
  switchVenue(id: string): void;
  /** rendered studio pictures, one per edition (may be empty strings until ready) */
  cardImages(): string[];
  /** the event card's Start race */
  startRace(): void;
  restart(): void;
  home(): void;
  /** the results screen's Next event: name of the next event, or null when it can't be offered */
  nextEventName(): string | null;
  nextEvent(): void;
  /** the name of the event as set up now */
  eventName(): string;
  gridRows(): BoardRow[];
  resultRows(): BoardRow[];
  resultInfo(): { place: number; field: number; time: number; best: number; earned: number; laps: number; over: boolean; bounty?: number; bountyLog?: [string, number][] };
  trackShape(): { pts: [number, number][]; start: number; length: number };
  /** weather or time changed on the event card: show it behind the menus */
  conditionsChanged(): void;
  /** 4D.1: the music page */
  music: MusicMenu;
}

const $ = (id: string) => document.getElementById(id)!;
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const ICONS: Record<string, string> = {
  race: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  free: '<circle cx="12" cy="12" r="8"/><path d="M12 12l4-3"/><path d="M12 4v2M20 12h-2M4 12h2"/>',
  pursuit: '<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/>',
  online: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.5a3 3 0 010 5.5M18 14.5c1.9.9 3 2.9 3 5.5"/>',
  garage: '<path d="M3 11l9-6 9 6v9H3z"/><path d="M7 20v-5h10v5"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>',
};
const CHEV = '<svg viewBox="0 0 24 24" width="18" height="18" style="stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round"><path d="M9 5l7 7-7 7"/></svg>';

const TIPS = [
  '<b>Drift to refill nitrous.</b> Holding a slide tops the tank up faster than driving straight.',
  '<b>Tuck in behind a rival</b> on the straights: the slipstream cuts your drag by up to a third.',
  '<b>Handbrake, then throttle.</b> A short tap of ✕ / Space swings the tail out; feed the power back in to hold it.',
  '<b>Air time pays.</b> The ramps on the link road and skid pad refill nitrous while you are flying.',
  '<b>Online, the host runs the AI.</b> Each new friend who joins sends everyone back to the grid.',
  '<b>Change editions in the Garage.</b> Sport grips harder, Nitro carries a bigger tank, Pursuit shrugs off contact.',
];

/** 4.5: a model's name for the cards, with its maker for imported cars ("Maker Model"). */
function fullName(editionId: string): string {
  const m = modelOf(editionId);
  return m.maker ? `${m.maker} ${m.name}` : m.name;
}

export class Screens {
  current: PageId | null = 'loading';
  private navs: Partial<Record<PageId, Nav>> = {};
  private device: DeviceKind = 'keyboard';
  private carIndex = 0;
  private heroTimer = 0;
  private heroStart = 0;
  private profileCache = '';

  constructor(private h: ScreenHooks) {
    // Loading art and a random tip straight away
    $('loading-art').style.backgroundImage = `url("${artUrl(Math.random() < 0.5 ? 'load-1' : 'load-2')}")`;
    $('loading-tip').innerHTML = TIPS[Math.floor(Math.random() * TIPS.length)];

    for (const id of ['home', 'cars', 'garage', 'event', 'results'] as PageId[]) {
      const nav = new Nav($(id));
      nav.onMove = () => this.h.sound('move');
      this.navs[id] = nav;
      $(id).querySelectorAll<HTMLElement>('[data-back]').forEach((b) => b.addEventListener('click', () => this.back()));
    }
    // 4D.1: the music page has its own Nav (it handles the extra buttons)
    const mm = this.h.music;
    this.navs.music = mm.nav;
    $('music').querySelectorAll<HTMLElement>('[data-back]').forEach((b) => b.addEventListener('click', () => this.back()));
    mm.wire();
    mm.openRequest = () => {
      if (this.current === 'home') {
        this.h.sound('accept');
        this.show('music');
      }
    };
    this.buildHome();
    this.buildCars();
    $('cars-garage').addEventListener('click', () => {
      this.chooseEdition(false);
      this.show('garage');
    });
    $('cars-choose').addEventListener('click', () => {
      this.chooseEdition(true);
      this.show('home', true);
    });
    $('garage-done').addEventListener('click', () => this.show('cars', true));
    $('garage-reset').addEventListener('click', () => {
      const l = this.h.settings.loadout;
      Object.assign(l, { paint: null, customColor: null, finish: null, rim: null, caliper: null, underglow: null });
      this.saveLook();
      this.buildGarage();
    });
    $('event-start').addEventListener('click', () => {
      this.h.sound('accept');
      this.h.startRace();
    });
    $('results-restart').addEventListener('click', () => {
      this.h.sound('accept');
      this.h.restart();
    });
    $('results-next').addEventListener('click', () => {
      this.h.sound('accept');
      this.h.nextEvent();
    });
    $('results-home').addEventListener('click', () => {
      this.h.sound('accept');
      this.h.home();
    });
    const cars = this.navs.cars!;
    cars.onPrev = () => this.slide(-1);
    cars.onNext = () => this.slide(1);
    this.setHero();
    window.addEventListener('resize', () => this.setHero());
  }

  // ── loading ────────────────────────────────────────────────────────────
  setLoading(fraction: number, status: string): void {
    ($('loading-bar') as HTMLElement).style.width = `${Math.round(fraction * 100)}%`;
    $('loading-pct').textContent = `${Math.round(fraction * 100)}%`;
    $('loading-status').textContent = status;
  }

  // ── page router ────────────────────────────────────────────────────────
  private stack: PageId[] = [];
  show(id: PageId | null, back = false): void {
    const prev = this.current;
    if (prev) {
      const el = $(prev);
      el.classList.remove('on');
      el.classList.toggle('back-out', !back);
    }
    this.current = id;
    if (id) {
      const el = $(id);
      el.classList.remove('back-out');
      if (back) el.style.transform = 'translateX(-28px)';
      void el.offsetWidth; // restart the transition from the side we're coming from
      el.style.transform = '';
      el.classList.add('on');
      if (id === 'home') {
        this.refreshHome(true);
        this.heroTimer = 0;
        this.heroStart = 0;
        $('home-hero').classList.remove('gone');
      }
      if (id === 'cars') this.openCars();
      if (id === 'garage') this.buildGarage();
      if (id === 'event') this.buildEvent();
      if (id === 'results') this.refreshResults();
      if (id === 'music') this.h.music.open();
      const nav = this.navs[id];
      if (nav) {
        const prefer =
          id === 'cars'
            ? (this.track().children[this.carIndex] as HTMLElement)
            : id === 'home'
              ? (back && nav.focused) || ($('home-menu').firstElementChild as HTMLElement)
              : id === 'event'
                ? $('event-start')
                : id === 'results'
                  ? $('results-next').hidden
                    ? $('results-restart')
                    : $('results-next')
                  : null;
        requestAnimationFrame(() => nav.reset(prefer));
      }
      this.renderPrompts();
    }
  }

  back(): void {
    this.h.sound('back');
    if (this.current === 'garage') this.show('cars', true);
    else if (this.current === 'cars' || this.current === 'event' || this.current === 'music') this.show('home', true);
    else if (this.current === 'results') this.h.home();
  }

  /** true while a menu page owns the input */
  get active(): boolean {
    return this.current !== null && this.current !== 'loading';
  }
  /** pages that show the 3D car in the showroom (rather than the home drift loop) */
  get showroom(): boolean {
    return this.current === 'garage' || this.current === 'cars';
  }

  handle(a: Actions): void {
    if (!this.current) return;
    if (this.current === 'music') {
      if (this.h.music.handle(a)) return;
    } else if (this.current === 'home' && (a.musicMenu || a.triangle)) {
      this.h.music.openRequest();
      return;
    }
    const nav = this.navs[this.current];
    nav?.handle(a);
  }

  setDevice(kind: DeviceKind): void {
    if (kind === this.device) return;
    this.device = kind;
    this.h.music.setDevice(kind);
    this.renderPrompts();
  }

  private renderPrompts(): void {
    const k = this.device;
    const move = k === 'keyboard' ? '↑ ↓ ← →' : 'D-pad';
    const sel = `<span><kbd>${glyph(k, 'accept')}</kbd>Select</span>`;
    const back = `<span><kbd>${glyph(k, 'back')}</kbd>Back</span>`;
    $('home-prompts').innerHTML = `<span><kbd>${move}</kbd>Move</span>${sel}`;
    $('cars-prompts').innerHTML = `<span><kbd>${glyph(k, 'shiftDown')}</kbd><kbd>${glyph(k, 'shiftUp')}</kbd>Change car</span>${sel}${back}`;
    $('garage-prompts').innerHTML = `<span><kbd>${move}</kbd>Move</span>${sel}${back}`;
    $('event-prompts').innerHTML = `<span><kbd>${move}</kbd>Move</span>${sel}${back}`;
    $('results-prompts').innerHTML = `<span><kbd>${move}</kbd>Move</span>${sel}`;
  }

  /** Per-frame: crossfade the home key art into the live 3D drift, keep the profile current. */
  update(dt: number): void {
    void dt;
    if (this.current === 'home') {
      // real time, so a slow first few frames don't hold the key art up
      const now = performance.now() / 1000;
      if (!this.heroStart) this.heroStart = now;
      this.heroTimer = now - this.heroStart;
      if (this.heroTimer > 5.5) $('home-hero').classList.add('gone');
      this.refreshHome(false);
    }
    this.h.music.ticker(this.current === 'home');
    if (this.current === 'music') this.h.music.render();
    if (this.current === 'results') {
      this.resultsT += dt;
      if (this.resultsT > 0.5) this.refreshResults();
    }
  }
  private resultsT = 0;

  // ── event card (pre-race) ──────────────────────────────────────────────
  buildEvent(): void {
    const s = this.h.settings;
    const opts = $('event-options');
    const focusedKey = this.navs.event?.focused?.dataset.key ?? null;
    opts.innerHTML = '';
    type Item = [key: string, label: string, on: boolean, enabled: boolean, act: () => void, soon?: string];
    const row = (title: string, items: Item[]) => {
      const o = document.createElement('div');
      o.className = 'opt';
      o.innerHTML = `<span class="label">${title}</span><div class="row"></div>`;
      const r = o.querySelector('.row') as HTMLElement;
      for (const [key, label, on, enabled, act, soon] of items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `chip${on ? ' on' : ''}`;
        b.dataset.nav = '';
        b.dataset.key = key;
        b.innerHTML = `${label}${soon ? `<span class="soon">${soon}</span>` : ''}`;
        if (!enabled) b.setAttribute('aria-disabled', 'true');
        b.addEventListener('click', () => {
          if (!enabled) return;
          act();
          this.h.save();
          this.h.sound('move');
          this.buildEvent();
        });
        r.appendChild(b);
      }
      opts.appendChild(o);
    };
    // 4D: venues (5A: the Proving Grounds and Hanagiri Pass)
    row('Venue', VENUES.map((v): Item => [`venue-${v.id}`, v.name, this.h.venueId() === v.id, v.available, () => this.h.switchVenue(v.id), v.available ? undefined : 'Phase 5']));
    row('Laps', [3, 5, 8].map((n): Item => [`laps-${n}`, String(n), s.laps === n, true, () => (s.laps = n)]));
    row('Rivals', (['easy', 'medium', 'hard'] as const).map((d): Item => [`diff-${d}`, d[0].toUpperCase() + d.slice(1), s.difficulty === d, true, () => (s.difficulty = d)]));
    row('Race', [
      ['type-clean', 'Clean race', s.raceType === 'clean', true, () => (s.raceType = 'clean')],
      ['type-pursuit', 'Pursuit race', s.raceType === 'pursuit', true, () => (s.raceType = 'pursuit')],
    ]);
    const wx = (w: Settings['weather']) => () => {
      s.weather = w;
      this.h.conditionsChanged();
    };
    const tod = (t: Settings['timeOfDay']) => () => {
      s.timeOfDay = t;
      this.h.conditionsChanged();
    };
    row('Weather', [
      ['wx-clear', 'Clear', s.weather === 'clear', true, wx('clear')],
      ['wx-cloudy', 'Cloudy', s.weather === 'cloudy', true, wx('cloudy')],
      ['wx-rain', 'Rain', s.weather === 'rain', true, wx('rain')],
      ['wx-snow', 'Snow', s.weather === 'snow', true, wx('snow')],
      ['wx-random', 'Random', s.weather === 'random', true, wx('random')],
    ]);
    row('Time', [
      ['tod-dusk', 'Dusk', s.timeOfDay === 'dusk', true, tod('dusk')],
      ['tod-night', 'Night', s.timeOfDay === 'night', true, tod('night')],
      ['tod-dynamic', 'Dusk to night', s.timeOfDay === 'dynamic', true, tod('dynamic')],
    ]);
    $('event-laps').textContent = String(s.laps);
    const t = this.h.trackShape();
    $('event-length').innerHTML = `${(t.length / 1000).toFixed(2)}<small>km</small>`;
    // a lap of the Proving Grounds (3.26 km) takes about 72 s; scale with the venue's lap
    const avgLap = (({ easy: 77, medium: 72, hard: 68 } as Record<string, number>)[s.difficulty] ?? 72) * (t.length / 3257);
    $('event-duration').innerHTML = `${Math.max(1, Math.round((avgLap * s.laps) / 60))}<small>min</small>`;
    const wxLabel = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', snow: 'Snow', random: 'Random weather' }[s.weather];
    $('event-title').textContent = this.h.eventName();
    $('event-mode').textContent = `${s.raceType === 'pursuit' ? 'Pursuit race' : 'Circuit race'} · ${s.laps} laps · ${wxLabel} · ${s.timeOfDay === 'night' ? 'Night' : s.timeOfDay === 'dynamic' ? 'Dusk to night' : 'Dusk'}`;
    const joinLap = Math.floor(0.4 * s.laps) + 1;
    $('event-sub').textContent = s.raceType === 'pursuit' ? `Lap 1 clean · cameras and work zones from lap 2 · police from lap ${joinLap}` : (VENUES.find((v) => v.id === this.h.venueId())?.blurb ?? 'Apex test circuit · clockwise');
    this.drawTrack();
    this.renderBoard($('event-grid'), this.h.gridRows(), false);
    const again = focusedKey ? (opts.querySelector(`[data-key="${focusedKey}"]`) as HTMLElement | null) : null;
    if (again) this.navs.event!.reset(again);
  }

  private drawTrack(): void {
    const cv = $('event-track') as HTMLCanvasElement;
    const g = cv.getContext('2d')!;
    const { pts, start } = this.h.trackShape();
    const W = cv.width;
    const H = cv.height;
    g.clearRect(0, 0, W, H);
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const [x, z] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const pad = 50;
    const k = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
    const ox = (W - (maxX - minX) * k) / 2 - minX * k;
    const oz = (H - (maxZ - minZ) * k) / 2 - minZ * k;
    const n = pts.length;
    const P = (i: number): [number, number] => {
      const p = pts[((i % n) + n) % n];
      return [p[0] * k + ox, p[1] * k + oz];
    };
    const sec = [start, start + Math.floor(n / 3), start + Math.floor((2 * n) / 3)];
    const path = (a: number, b: number) => {
      g.beginPath();
      for (let i = a; i <= b; i++) {
        const [x, y] = P(i);
        if (i === a) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    };
    g.lineJoin = g.lineCap = 'round';
    path(sec[0], sec[2]);
    g.strokeStyle = 'rgba(214, 228, 230, 0.78)';
    g.lineWidth = 5;
    g.stroke();
    path(sec[2], start + n);
    g.shadowColor = 'rgba(79, 209, 217, 0.9)';
    g.shadowBlur = 18;
    g.strokeStyle = '#4fd1d9';
    g.lineWidth = 6;
    g.stroke();
    g.shadowBlur = 0;
    // centre of the drawing, to push labels outwards
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i += 4) {
      const [x, y] = P(i);
      cx += x;
      cy += y;
    }
    cx /= Math.ceil(n / 4);
    cy /= Math.ceil(n / 4);
    sec.forEach((i, j) => {
      const [x, y] = P(i);
      if (j > 0) {
        g.beginPath();
        g.arc(x, y, 11, 0, Math.PI * 2);
        g.fillStyle = 'rgba(79, 209, 217, 0.25)';
        g.fill();
        g.beginPath();
        g.arc(x, y, 6, 0, Math.PI * 2);
        g.fillStyle = '#4fd1d9';
        g.fill();
      }
      const [x2, y2] = P(i + Math.floor(n / 6));
      const dx = x2 - cx, dy = y2 - cy;
      const l = Math.hypot(dx, dy) || 1;
      g.fillStyle = 'rgba(143, 165, 168, 0.95)';
      g.font = '500 22px Outfit, system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(`S${j + 1}`, x2 + (dx / l) * 30, y2 + (dy / l) * 30);
    });
    const [sx, sy] = P(start);
    const [ax, ay] = P(start + 2);
    const ang = Math.atan2(ay - sy, ax - sx) + Math.PI / 2;
    g.strokeStyle = '#eef5f5';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(sx - Math.cos(ang) * 16, sy - Math.sin(ang) * 16);
    g.lineTo(sx + Math.cos(ang) * 16, sy + Math.sin(ang) * 16);
    g.stroke();
  }

  private renderBoard(el: HTMLElement, rows: BoardRow[], results: boolean): void {
    const code = (r: BoardRow) => (r.me ? 'YOU' : r.name.replace(/^[A-Z]\.\s*/, '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase());
    el.innerHTML =
      `<div class="lb-head"><span>Pos</span><span>Driver</span><span style="text-align:right">${results ? 'Time' : ''}</span><span style="text-align:right">${results ? 'Best lap' : ''}</span></div>` +
      rows
        .map(
          (r) =>
            `<div class="lb-row${r.me ? ' me' : ''}"><span class="p num">${r.place}</span><span class="who"><i style="background:${hex(r.color)}"></i><b>${esc(code(r))}</b><span>${esc(r.name)}</span></span>` +
            `<span class="t num">${results ? esc(r.gap ?? '') : ''}</span><span class="bl num">${results && r.best ? formatLap(r.best) : ''}</span></div>`,
        )
        .join('');
  }

  refreshResults(): void {
    this.resultsT = 0;
    const info = this.h.resultInfo();
    const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
    $('results-title').textContent = `You finished ${ord(info.place)}`;
    $('results-sub').textContent = `${this.h.eventName()} · ${VENUES.find((v) => v.id === this.h.venueId())?.name ?? 'Proving Grounds'} · ${info.laps} laps · ${info.field} cars`;
    const next = this.h.nextEventName();
    const btn = $('results-next');
    if (btn.hidden !== !next) btn.hidden = !next;
    if (next) {
      const label = `Next event: ${next}`;
      if (btn.textContent !== label) btn.textContent = label;
    }
    $('results-status').textContent = info.over ? 'Final' : 'Others still finishing';
    const total = (t: number) => {
      if (!(t > 0)) return '—';
      const m = Math.floor(t / 60);
      const sec = t - m * 60;
      return `${m}:${sec < 10 ? '0' : ''}${sec.toFixed(2)}`;
    };
    $('results-earned').innerHTML =
      `<div class="stat-card"><span class="label">Position</span><b class="num">${info.place} / ${info.field}</b></div>` +
      `<div class="stat-card"><span class="label">Race time</span><b class="num">${total(info.time)}</b></div>` +
      `<div class="stat-card"><span class="label">Best lap</span><b class="num">${info.best > 0 ? formatLap(info.best) : '—'}</b></div>` +
      `<div class="stat-card"><span class="label">Speed points</span><b class="num" style="color:var(--accent)">+${Math.round(info.earned).toLocaleString('en-US')}</b></div>` +
      (info.bounty && info.bounty > 0
        ? `<div class="stat-card bounty"><span class="label">Pursuit bounty</span><b class="num">${Math.round(info.bounty).toLocaleString('en-US')}</b><small>${(info.bountyLog ?? []).slice(0, 4).map(([k, v]) => `${k} ${Math.round(v).toLocaleString('en-US')}`).join(' · ')}</small></div>`
        : '');
    this.renderBoard($('results-table'), this.h.resultRows(), true);
  }

  private setHero(): void {
    const tall = window.innerHeight > window.innerWidth * 1.1;
    $('home-hero').style.backgroundImage = `url("${artUrl(tall ? 'hero-9x16' : 'hero-16x9')}")`;
    $('home-hero').style.backgroundPosition = tall ? 'center top' : 'center right';
  }

  // ── home ───────────────────────────────────────────────────────────────
  private buildHome(): void {
    const items: [string, string, string, () => void, boolean][] = [
      ['race', 'Race', 'Circuit race against 7 rivals', () => {
        this.h.settings.raceType = 'clean';
        this.h.save();
        this.h.race();
      }, true],
      ['free', 'Free run', this.h.venueId() === 'hanagiri-pass' ? 'The whole mountain pass, all to yourself' : 'The proving grounds, all to yourself', () => this.h.freeRun(), true],
      ['pursuit', 'Pursuit', 'Police, roadblocks and spike strips', () => {
        this.h.settings.raceType = 'pursuit';
        this.h.save();
        this.show('event');
      }, true],
      ['online', 'Online with friends', 'Up to 4 players, AI fills the grid', () => this.h.online(), true],
      ['garage', 'Garage', 'Choose your edition and livery', () => this.show('cars'), true],
      ['music', 'Music', 'Your tracks, the rotation and the volume', () => this.show('music'), true],
      ['settings', 'Settings', 'Controller, rumble, graphics, sound', () => this.h.openSettings(), true],
    ];
    const menu = $('home-menu');
    menu.innerHTML = '';
    for (const [icon, title, sub, act, on] of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item';
      b.dataset.nav = '';
      if (!on) b.setAttribute('aria-disabled', 'true');
      b.innerHTML = `<span class="ico"><svg viewBox="0 0 24 24">${ICONS[icon]}</svg></span><span><b>${title}</b><small>${sub}</small></span>${on ? `<span class="go">${CHEV}</span>` : '<span class="soon">Phase 3C</span>'}`;
      b.addEventListener('click', () => {
        if (!on) return;
        this.h.sound('accept');
        act();
      });
      menu.appendChild(b);
    }
    // driver name: click to edit
    $('home-driver').addEventListener('click', () => {
      const b = $('home-name');
      if (b.querySelector('input')) return;
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 14;
      input.id = 'home-name-input';
      input.value = this.h.settings.name;
      input.style.cssText = 'font:inherit;color:inherit;background:transparent;border:0;border-bottom:1.5px solid var(--accent);width:150px;padding:0;outline:none;-webkit-user-select:text;user-select:text';
      b.textContent = '';
      b.appendChild(input);
      input.focus();
      input.select();
      const done = () => {
        this.h.settings.name = input.value.replace(/[^\w .\-]/g, '').trim().slice(0, 14) || 'Driver';
        this.h.save();
        b.textContent = this.h.settings.name;
        this.profileCache = '';
      };
      input.addEventListener('blur', done);
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') input.blur();
      });
    });
  }

  private refreshHome(force: boolean): void {
    const s = this.h.settings;
    const net = this.h.onlineInfo();
    const key = [s.name, s.speedPoints, s.bestLap, net.status, net.players, s.loadout.edition, s.loadout.paint, s.loadout.customColor].join('|');
    if (!force && key === this.profileCache) return;
    this.profileCache = key;
    if (!$('home-name').querySelector('input')) $('home-name').textContent = s.name;
    $('home-sp').textContent = Math.floor(s.speedPoints).toLocaleString('en-US');
    $('home-best').textContent = formatLap(s.bestLap);
    const live = net.status === 'online';
    $('home-net').innerHTML = `<i class="dot${live ? ' live' : ''}"></i>${live ? `${net.players} online${net.host ? ' · host' : ''}` : net.status === 'connecting' ? 'Connecting' : 'Offline'}`;
    const e = editionById(s.loadout.edition);
    const look = lookOf(s.loadout);
    const paintName = s.loadout.customColor !== null ? 'Custom' : s.loadout.paint === null && e.color !== undefined ? 'Factory colour' : PAINTS[look.paintIndex].name;
    $('home-car').innerHTML = `<i style="background:${hex(look.color)}"></i><span>${esc(modelOf(e.id).name)} · ${esc(e.name)} · ${esc(paintName)}</span>`;
  }

  // ── car select ─────────────────────────────────────────────────────────
  private track(): HTMLElement {
    return $('cars-track');
  }

  private buildCars(): void {
    const track = this.track();
    track.innerHTML = '';
    $('cars-count').textContent = CAR_MODELS.length > 1 ? `${CAR_MODELS.length} cars · ${EDITIONS.length} editions` : `${EDITIONS.length} editions`;
    EDITIONS.forEach((e, i) => {
      const st = statsOf(e.id);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      card.innerHTML =
        `<div class="shot"><span class="ed">${esc(e.name)} edition</span></div>` +
        `<div class="body"><div><h3>${esc(fullName(e.id))}<br>${esc(e.name)}</h3><div class="tag">${esc(e.tagline)}</div></div>` +
        `<div class="meta"><span class="label">Nr.</span><span class="label">Livery</span><span class="label">Finish</span>` +
        `<span class="n num">${e.number}</span><span class="v">${esc(e.color !== undefined ? e.name : PAINTS[e.paint].name)}</span><span class="v">${esc(FINISHES.find((f) => f.id === e.finish)!.name)}</span></div>` +
        `<div class="stats">${(
          [
            ['Power', st.power],
            ['Top speed', st.topSpeed],
            ['Grip', st.grip],
            ['Nitrous', st.nitro],
            ['Weight', st.weight],
          ] as [string, number][]
        )
          .map(([l, v]) => `<div class="stat"><span>${l}</span><span class="b"><i style="width:${Math.round(v * 100)}%"></i></span></div>`)
          .join('')}</div>` +
        `<div class="foot"><span class="badge" data-badge></span><span class="icon-btn accent" aria-hidden="true">${CHEV}</span></div></div>`;
      card.addEventListener('click', () => {
        if (i !== this.carIndex) {
          this.carIndex = i;
          this.h.sound('move');
          this.layoutCars();
        } else this.slide(1);
      });
      card.addEventListener('adjust', (ev) => this.slide((ev as CustomEvent<number>).detail));
      track.appendChild(card);
    });
    const dots = $('cars-dots');
    dots.innerHTML = EDITIONS.map(() => '<i></i>').join('');
  }

  private openCars(): void {
    this.carIndex = Math.max(0, EDITIONS.findIndex((e) => e.id === this.h.settings.loadout.edition));
    const imgs = this.h.cardImages();
    this.track().querySelectorAll<HTMLElement>('.card .shot').forEach((el, i) => {
      if (imgs[i]) el.style.backgroundImage = `url("${imgs[i]}")`;
    });
    this.layoutCars();
  }

  private slide(dir: number): void {
    const n = EDITIONS.length;
    const next = Math.max(0, Math.min(n - 1, this.carIndex + dir));
    if (next === this.carIndex) return;
    this.carIndex = next;
    this.h.sound('move');
    this.layoutCars();
  }

  private layoutCars(): void {
    const track = this.track();
    const cards = Array.from(track.children) as HTMLElement[];
    const chosen = this.h.settings.loadout.edition;
    cards.forEach((c, i) => {
      const on = i === this.carIndex;
      c.classList.toggle('current', on);
      if (on) {
        c.dataset.nav = '';
        c.dataset.adjust = '';
      } else {
        delete c.dataset.nav;
        delete c.dataset.adjust;
      }
      const e = EDITIONS[i];
      const badge = c.querySelector('[data-badge]') as HTMLElement;
      const locked = e.unlock > this.h.settings.speedPoints;
      badge.className = 'badge' + (e.id === chosen ? ' live' : locked ? ' locked' : '');
      badge.textContent = e.id === chosen ? 'In use' : locked ? `${e.unlock.toLocaleString('en-US')} SP to unlock` : 'Owned';
    });
    // centre the current card
    const card = cards[this.carIndex];
    if (card) {
      const wrap = track.parentElement!.getBoundingClientRect();
      const offset = card.offsetLeft + card.offsetWidth / 2 - wrap.width / 2;
      track.style.transform = `translateX(${-offset}px)`;
    }
    $('cars-dots').querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i === this.carIndex));
    const e = EDITIONS[this.carIndex];
    $('cars-sub').textContent = `${fullName(e.id)} · ${e.name} edition`;
    const nav = this.navs.cars;
    if (nav && nav.focused && nav.focused.classList.contains('card') && nav.focused !== card) nav.focus(card, false);
  }

  /** Make the carousel's current edition the player's car. */
  private chooseEdition(announce: boolean): void {
    const e = EDITIONS[this.carIndex];
    if (e.unlock > this.h.settings.speedPoints) return;
    const l = this.h.settings.loadout;
    if (l.edition !== e.id) {
      // a different edition comes in its own livery
      Object.assign(l, { edition: e.id, paint: null, customColor: null, finish: null, rim: null, caliper: null, underglow: null });
      this.saveLook();
    }
    if (announce) this.h.sound('accept');
  }

  // ── garage ─────────────────────────────────────────────────────────────
  private saveLook(): void {
    this.h.save();
    this.h.lookChanged();
    this.profileCache = '';
  }

  private buildGarage(): void {
    const l: Loadout = this.h.settings.loadout;
    const e = editionById(l.edition);
    const look = lookOf(l);
    $('garage-edition').textContent = `${fullName(e.id)} · ${e.name}`;
    const groups = $('garage-groups');
    const focusedKey = this.navs.garage?.focused?.dataset.key ?? null;
    groups.innerHTML = '';
    const group = (title: string, value: string): HTMLElement => {
      const g = document.createElement('div');
      g.className = 'group';
      g.innerHTML = `<div class="page-head"><span class="label">${title}</span><span class="label" style="color:var(--ink-2)">${esc(value)}</span></div><div class="row"></div>`;
      groups.appendChild(g);
      return g.querySelector('.row') as HTMLElement;
    };
    const swatch = (row: HTMLElement, key: string, color: number | null, on: boolean, label: string, pick: () => void, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `swatch ${cls}${on ? ' on' : ''}`;
      b.dataset.nav = '';
      b.dataset.key = key;
      b.title = label;
      b.setAttribute('aria-label', label);
      if (color !== null) b.style.background = hex(color);
      b.addEventListener('click', () => {
        pick();
        this.saveLook();
        this.h.sound('accept');
        this.buildGarage();
      });
      row.appendChild(b);
      return b;
    };

    // 4.5: an imported car's edition can come in its own factory colour
    const factory = l.customColor === null && l.paint === null && e.color !== undefined;
    const paintName = l.customColor !== null ? 'Custom' : factory ? 'Factory colour' : PAINTS[look.paintIndex].name;
    const paints = group('Paint', paintName);
    if (e.color !== undefined) swatch(paints, 'paint-factory', e.color, factory, 'Factory colour', () => ((l.paint = null), (l.customColor = null)));
    PAINTS.forEach((p, i) => swatch(paints, `paint-${i}`, p.color, l.customColor === null && !factory && look.paintIndex === i, p.name, () => ((l.paint = i), (l.customColor = null))));
    // custom colour picker
    const custom = document.createElement('label');
    custom.className = `swatch custom${l.customColor !== null ? ' on' : ''}`;
    custom.dataset.nav = '';
    custom.dataset.key = 'paint-custom';
    custom.title = 'Custom colour';
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.id = 'garage-custom-colour';
    picker.value = hex(look.color);
    picker.setAttribute('aria-label', 'Custom colour');
    picker.addEventListener('input', () => {
      l.customColor = parseInt(picker.value.slice(1), 16);
      this.saveLook();
    });
    picker.addEventListener('change', () => {
      this.h.sound('accept');
      this.buildGarage();
    });
    custom.appendChild(picker);
    paints.appendChild(custom);

    const finishRow = group('Finish', FINISHES.find((f) => f.id === look.finish)!.name);
    for (const f of FINISHES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `chip${look.finish === f.id ? ' on' : ''}`;
      b.dataset.nav = '';
      b.dataset.key = `finish-${f.id}`;
      b.textContent = f.name;
      b.addEventListener('click', () => {
        l.finish = f.id;
        this.saveLook();
        this.h.sound('accept');
        this.buildGarage();
      });
      finishRow.appendChild(b);
    }
    const rims = group('Rims', '');
    RIM_COLOURS.forEach((c, i) => swatch(rims, `rim-${i}`, c, look.rim === c, 'Rim colour', () => (l.rim = c)));
    const cal = group('Brake calipers', '');
    CALIPER_COLOURS.forEach((c, i) => swatch(cal, `cal-${i}`, c, look.caliper === c, 'Caliper colour', () => (l.caliper = c)));
    const glow = group('Underglow', look.underglow ? '' : 'Off');
    UNDERGLOW_COLOURS.forEach((c, i) => swatch(glow, `glow-${i}`, c === 0 ? null : c, look.underglow === c, c === 0 ? 'Underglow off' : 'Underglow colour', () => (l.underglow = c), c === 0 ? 'off' : ''));

    const nav = this.navs.garage!;
    const again = focusedKey ? (groups.querySelector(`[data-key="${focusedKey}"]`) as HTMLElement | null) : null;
    if (again) nav.reset(again);
    else if (this.current === 'garage') requestAnimationFrame(() => nav.reset(groups.querySelector('.swatch.on') as HTMLElement | null));
  }
}
