// ─────────────────────────────────────────────────────────────────────────────
// OnlineSession — racing with friends.
//
// Model: every player simulates their own car with the full physics and publishes its state
// 20 times a second. One player is the HOST (whoever has been in longest); the host also runs
// the AI rivals, decides the grid, and owns the starting-lights clock. Everyone else shows the
// other humans and the AI as "remote" cars moved by those published states.
//
// Up to four humans share a grid of eight; AI fills the remaining slots.
// 4C.2 (friends at their own homes):
// - LOBBY: every new grid waits before the lights. Players press Ready; the host starts (or it
//   starts 3 s after everyone is ready). The host can change mode, weather and laps meanwhile.
// - LATE JOINERS wait for the next race instead of resetting the one in progress.
// - DROP-OUTS: a friend who disconnects mid-race is replaced by an AI driver in the same car.
// - If the host leaves, the next player in line takes over and the grid goes back to the lobby.
//
// Friendly-game trust model: each machine is the authority for its own car. That is simple and
// lag-tolerant, but it is not cheat-proof; a server-authoritative mode is a later step.
// ─────────────────────────────────────────────────────────────────────────────
import { Conditions, TIMES, WEATHERS } from '../world/Environment';
import { AI, PAINTS, RIVALS } from '../config';
import { Settings } from '../core/Settings';
import { CarSpec, NetCar, packCar, Race, validNetCar } from '../game/Race';
import { EDITIONS, lookFromPaint, lookOf } from '../vehicle/Cars';
import { openTransport, Transport, TransportOptions } from './Transport';
import type { SharedTrack } from '../audio/MusicLibrary';

export type OnlineStatus = 'off' | 'connecting' | 'online' | 'unavailable';
export const MAX_HUMANS = 4;

interface PeerView {
  id: string;
  name: string;
  paint: number;
  joined: number;
  car: NetCar | null;
  dist: number;
  host: HostBlock | null;
  edition: number;
  /** guest's running total of Heat it raised (trap flashes, ramming police, smashing barriers) */
  heat: number;
  /** 4C.2: pressed Ready in the lobby */
  ready: boolean;
  /** 4C.2: their round trip to the server, ms (−1 unknown) */
  ping: number;
  /** 4D: the venue they have loaded */
  vn: string;
}

/** 4C.2: one row of the lobby panel */
export interface LobbyRow {
  name: string;
  me: boolean;
  host: boolean;
  ready: boolean;
  ping: number;
  waiting: boolean;
}

const VERSION = 2;
interface HostBlock {
  id: number; // race id: changes on every restart
  cd: number; // countdown seconds remaining (0 = racing)
  hd?: number; // the random "Set" hold inside that countdown
  ri?: number; // rain intensity 0..100 (4B.2): the host's shower, so everyone gets wet together
  r: [string, number, number, string, number][]; // humans: peer id, grid slot, paint, name, edition index
  a: [number, number, number, string?][]; // AI: grid slot, paint, index into RIVALS (−1 = took over a friend's car, named)
  ph: number; // 4C.2: 0 = lobby (waiting before the lights), 1 = racing
  q: string[]; // 4C.2: players waiting for the next race
  st?: number; // 4C.2: lobby auto-start seconds left (−1 = not counting)
  vn?: string; // 4D: the venue the host is racing at
  ai: number[][]; // AI states, same order as `a`: NetCar + race distance
  l: number; // laps to race (0 = endless)
  w: number; // weather index (WEATHERS)
  t: number; // time of day index (TIMES)
  /** police state in a Pursuit Race (untrusted: Pursuit.unpack checks it) */
  pz: unknown;
  /** 4G.2: the host's music: [track id, title, artist, seconds in, playing 0/1] (absent: not shared) */
  mu?: SharedTrack | null;
}

function parseMusic(v: unknown): SharedTrack | null {
  if (!Array.isArray(v) || v.length < 5) return null;
  const str = (x: unknown, n: number) => (typeof x === 'string' ? x.slice(0, n) : '');
  const pos = typeof v[3] === 'number' && Number.isFinite(v[3]) ? Math.max(0, Math.min(36000, v[3])) : 0;
  return { id: str(v[0], 80), title: str(v[1], 80), artist: str(v[2], 60), pos, on: v[4] === 1 };
}

const cleanName = (v: unknown): string => {
  const s = String(typeof v === 'string' ? v : '').replace(/[^\w .()\-]/g, '').trim().slice(0, 14);
  return s || 'Driver';
};
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

function parseHost(h: unknown): HostBlock | null {
  if (typeof h !== 'object' || h === null) return null;
  const o = h as Record<string, unknown>;
  if (typeof o.id !== 'number' || typeof o.cd !== 'number' || !Number.isFinite(o.cd)) return null;
  if (!Array.isArray(o.r) || !Array.isArray(o.a) || !Array.isArray(o.ai)) return null;
  if (o.r.length < 1 || o.r.length > MAX_HUMANS || o.a.length > RIVALS.length || o.r.length + o.a.length > AI.gridSize) return null;
  const r: HostBlock['r'] = [];
  for (const e of o.r) {
    if (!Array.isArray(e) || typeof e[0] !== 'string' || !isInt(e[1], 0, AI.gridSize - 1) || !isInt(e[2], 0, PAINTS.length - 1)) return null;
    r.push([e[0], e[1], e[2], cleanName(e[3]), isInt(e[4], 0, EDITIONS.length - 1) ? e[4] : 0]);
  }
  const a: HostBlock['a'] = [];
  for (const e of o.a) {
    if (!Array.isArray(e) || !isInt(e[0], 0, AI.gridSize - 1) || !isInt(e[1], 0, PAINTS.length - 1) || !isInt(e[2], -1, RIVALS.length - 1)) return null;
    a.push(e[2] === -1 ? [e[0], e[1], -1, `${cleanName(e[3])}`] : [e[0], e[1], e[2]]);
  }
  const q = Array.isArray(o.q) ? (o.q.filter((x) => typeof x === 'string').slice(0, 8) as string[]) : [];
  return { vn: typeof o.vn === 'string' ? o.vn.slice(0, 32) : undefined, ph: o.ph === 0 ? 0 : 1, q, st: typeof o.st === 'number' && Number.isFinite(o.st) ? o.st : -1, id: o.id, cd: Math.max(0, Math.min(10, o.cd)), r, a, ai: o.ai as number[][], pz: o.pz, mu: parseMusic(o.mu), l: isInt(o.l, 0, 20) ? (o.l as number) : 3, w: isInt(o.w, 0, WEATHERS.length - 1) ? (o.w as number) : 0, t: isInt(o.t, 0, TIMES.length - 1) ? (o.t as number) : 0 };
}

export class OnlineSession {
  status: OnlineStatus = 'off';
  isHost = false;
  /** humans currently in the session (including you), for the UI */
  players: { id: string; name: string; me: boolean; host: boolean }[] = [];
  /** 4C.2: the lobby panel's rows, refreshed every update */
  lobby: LobbyRow[] = [];
  /** 4C.2: 'lobby' = waiting before the lights; 'race' = racing */
  phase: 'lobby' | 'race' = 'race';
  /** 4C.2: this client is waiting for the next race (it joined while one was running) */
  waiting = false;
  /** 4C.2: my Ready in the lobby */
  ready = false;
  /** 4C.2: lobby auto-start countdown (−1 = not counting) */
  autoStart = -1;
  /** 4D: the venue this copy has loaded (main sets it) */
  venueId = 'proving-grounds';
  /** 4D: set when the host races at a venue this copy hasn't loaded */
  venueMismatch = '';
  /** 4C.2: the last reason the connection failed, for the Online panel */
  failReason = '';
  /** called when the grid changes and the game must rebuild its cars */
  onRoster: (specs: CarSpec[], host: boolean) => void = () => {};
  onToast: (text: string) => void = () => {};
  onStatus: () => void = () => {};
  /** 4C.2: a friend's car is now driven by the AI (host: convert it; guests: relabel) */
  onTakeOver: (netId: string, slot: number, name: string, host: boolean) => void = () => {};

  private transport: Transport | null = null;
  private joined = 0;
  private raceKey = '';
  private raceId = 0;
  private roster: HostBlock['r'] = [];
  private aiRoster: HostBlock['a'] = [];
  private queue: string[] = [];
  private restartWanted = false;
  private startWanted = false;
  private overT = 0;
  private sendAcc = 0;
  private known = new Map<string, string>(); // peer id → name, for join/leave messages
  private missing = new Map<string, number>(); // netId → seconds unseen
  private attempt = 0;
  private oldVersionWarned = new Set<string>();

  /** the host's weather and time of day (the host reads these; guests are told when they change) */
  getConditions: () => Conditions = () => ({ weather: 'clear', time: 'dusk' });
  onConditions: (c: Conditions) => void = () => {};
  /** guests: the host's police state arrived */
  onPursuit: (d: unknown) => void = () => {};
  /** 4G.2 host: what our music is playing (null = not sharing) */
  getMusic: () => SharedTrack | null = () => null;
  /** 4G.2 guests: the host's music every update (null = the host isn't sharing); `late` in s */
  onHostMusic: (m: SharedTrack | null, late: number) => void = () => {};
  private heatSeen = new Map<string, number>();
  private myHeat = 0;

  constructor(private getRace: () => Race, private settings: Settings) {}

  get transportKind(): string {
    return this.transport ? this.transport.kind : '';
  }

  /** 4C.2: where we're connected (host · room), for the lobby */
  get where(): string {
    return this.transport?.label?.() ?? (this.transport?.kind === 'tabs' ? 'this browser (test)' : this.transport?.kind === 'room' ? 'this shared page' : '');
  }

  /** 4C.2: my round trip to the server in ms (−1 unknown) */
  get ping(): number {
    return this.transport?.rtt?.() ?? -1;
  }

  async enable(opts: TransportOptions = {}): Promise<void> {
    if (this.status === 'connecting' || this.status === 'online') return;
    const attempt = ++this.attempt;
    this.failReason = '';
    this.setStatus('connecting');
    const t = await openTransport(opts);
    if (attempt !== this.attempt) {
      t?.close();
      return;
    }
    if (!t) {
      this.failReason = opts.server ? "That doesn't look like a race link. Paste the whole link your friend sent." : 'Online play is not available on this page.';
      this.setStatus('unavailable');
      return;
    }
    this.transport = t;
    this.joined = Date.now();
    this.raceKey = '';
    this.isHost = false;
    this.waiting = false;
    this.ready = false;
    this.phase = 'race';
    this.queue = [];
    this.known.clear();
  }

  disable(): void {
    this.attempt++;
    this.transport?.close();
    this.transport = null;
    this.isHost = false;
    this.players = [];
    this.lobby = [];
    this.raceKey = '';
    this.waiting = false;
    this.phase = 'race';
    this.setStatus('off');
  }

  /** Host only: send everyone back to the grid (also used after changing rivals / difficulty). */
  requestRestart(): boolean {
    if (!this.isHost) return false;
    this.restartWanted = true;
    return true;
  }

  /** 4C.2 lobby: the host starts the race now; a guest toggles Ready. */
  pressStart(): void {
    if (this.phase !== 'lobby') return;
    if (this.isHost) this.startWanted = true;
    else if (!this.waiting) this.ready = !this.ready;
  }

  private setStatus(s: OnlineStatus): void {
    if (s !== this.status) {
      this.status = s;
      this.onStatus();
    }
  }

  /** Call once per frame with the real elapsed time. */
  update(dt: number): void {
    const t = this.transport;
    if (!t) return;
    if (t.failed()) {
      this.failReason = t.failReason?.() ?? 'Lost the connection.';
      this.transport = null;
      t.close();
      this.isHost = false;
      this.players = [];
      this.lobby = [];
      this.waiting = false;
      this.phase = 'race';
      this.setStatus('unavailable');
      return;
    }
    if (!t.ready()) return;
    if (this.status !== 'online') this.setStatus('online');
    const myId = t.myId();

    // ── read everyone ──
    const peers = new Map<string, PeerView>();
    for (const p of t.peers()) {
      if (p.isMe || p.id === myId || !p.data) continue;
      const d = p.data;
      if (d.v !== VERSION) {
        if (!this.oldVersionWarned.has(p.id)) {
          this.oldVersionWarned.add(p.id);
          this.onToast(`${cleanName(d.n)} has a different version of the game: everyone needs the latest ZIP`);
        }
        continue;
      }
      peers.set(p.id, {
        id: p.id,
        name: cleanName(d.n),
        paint: isInt(d.p, 0, PAINTS.length - 1) ? d.p : 0,
        joined: typeof d.j === 'number' && Number.isFinite(d.j) ? d.j : Number.MAX_SAFE_INTEGER,
        car: validNetCar(d.c) ? d.c : null,
        dist: typeof d.d === 'number' && Number.isFinite(d.d) ? Math.max(-2, Math.min(9999, d.d)) : 0,
        host: parseHost(d.h),
        edition: isInt(d.e, 0, EDITIONS.length - 1) ? d.e : 0,
        heat: typeof d.hr === 'number' && Number.isFinite(d.hr) ? Math.max(0, Math.min(1e4, d.hr)) : 0,
        ready: d.rd === 1,
        ping: typeof d.pg === 'number' && Number.isFinite(d.pg) ? Math.max(-1, Math.min(9999, Math.round(d.pg))) : -1,
        vn: typeof d.vn === 'string' ? d.vn.slice(0, 32) : 'proving-grounds',
      });
    }
    const myLook = lookOf(this.settings.loadout);
    const myEdition = Math.max(0, EDITIONS.findIndex((e) => e.id === this.settings.loadout.edition));
    const me: PeerView = { id: myId, name: cleanName(this.settings.name), paint: myLook.paintIndex, joined: this.joined, car: null, dist: 0, host: null, edition: myEdition, heat: 0, ready: this.ready, ping: Math.round(this.ping), vn: this.venueId };
    const all = [me, ...peers.values()].sort((a, b) => a.joined - b.joined || (a.id < b.id ? -1 : 1));
    const hostId = all[0].id;
    const amHost = hostId === myId;

    // join / leave messages
    for (const p of peers.values()) if (!this.known.has(p.id)) this.onToast(`${p.name} joined`);
    for (const [id, name] of this.known) if (!peers.has(id)) this.onToast(`${name} left`);
    this.known.clear();
    for (const p of peers.values()) this.known.set(p.id, p.name);
    this.players = all.map((p) => ({ id: p.id, name: p.id === myId ? `${p.name} (you)` : p.name, me: p.id === myId, host: p.id === hostId }));

    // ── host duties, or follow the host ──
    const r = this.getRace();
    if (amHost) this.hostUpdate(dt, all, peers, myId, r);
    else this.guestUpdate(hostId, peers, myId);

    // lobby rows (everyone builds the same list from what they see)
    const queued = new Set(amHost ? this.queue : (peers.get(hostId)?.host?.q ?? []));
    this.lobby = all.map((p) => ({
      name: p.name,
      me: p.id === myId,
      host: p.id === hostId,
      ready: p.id === hostId ? true : p.ready,
      ping: p.ping,
      waiting: queued.has(p.id),
    }));

    // ── other humans' cars ──
    for (const c of r.cars) {
      if (!c.remote || c.netId.startsWith('ai:')) continue;
      const p = peers.get(c.netId);
      if (p && p.car) {
        r.receive(c, p.car, p.dist);
        this.missing.delete(c.netId);
      } else {
        const gone = (this.missing.get(c.netId) ?? 0) + dt;
        this.missing.set(c.netId, gone);
        if (gone > 3) c.gone = true;
      }
    }

    // ── publish my state ──
    this.sendAcc += dt;
    if (this.sendAcc >= 0.05) {
      this.sendAcc = 0;
      const pursuit = r.pursuit;
      if (pursuit && pursuit.mirror) this.myHeat = pursuit.heatReport; // guest: report the Heat this client raised
      const state: Record<string, unknown> = {
        v: VERSION,
        hr: Math.round(this.myHeat * 100) / 100,
        n: me.name,
        p: me.paint,
        e: me.edition,
        j: this.joined,
        rd: this.ready ? 1 : 0,
        vn: this.venueId,
        pg: Math.round(this.ping),
        c: this.waiting ? undefined : packCar(r.player.s),
        d: Math.round(r.player.lap.distance * 10000) / 10000,
      };
      if (this.isHost) {
        const ai: number[][] = [];
        for (const [slot] of this.aiRoster) {
          const car = r.cars.find((c) => c.driver && c.grid === slot);
          ai.push(car ? [...packCar(car.s), Math.round(car.lap.distance * 10000) / 10000] : []);
        }
        if (pursuit && !pursuit.mirror) {
          // add what guests raised since we last heard from them
          for (const [id, p] of peers) {
            const last = this.heatSeen.get(id) ?? p.heat;
            if (p.heat > last) pursuit.addHeat(Math.min(1, p.heat - last));
            this.heatSeen.set(id, p.heat);
          }
        }
        state.h = {
          pz: pursuit && !pursuit.mirror ? pursuit.pack(packCar) : undefined,
          id: this.raceId,
          ph: this.phase === 'lobby' ? 0 : 1,
          vn: this.venueId,
          q: this.queue,
          st: Math.round(this.autoStart * 10) / 10,
          cd: Math.round(Math.max(0, r.countdown) * 100) / 100,
          hd: Math.round(r.hold * 100) / 100,
          ri: Math.round(r.rainK * 100),
          r: this.roster,
          a: this.aiRoster,
          ai,
          l: r.targetLaps,
          w: WEATHERS.indexOf(this.getConditions().weather),
          t: TIMES.indexOf(this.getConditions().time),
        };
        const mu = this.getMusic();
        if (mu) (state.h as Record<string, unknown>).mu = [mu.id, mu.title, mu.artist, Math.round(mu.pos * 10) / 10, mu.on ? 1 : 0];
      }
      t.publish(state);
    }
  }

  private hostUpdate(dt: number, all: PeerView[], peers: Map<string, PeerView>, myId: string, r: Race): void {
    const present = new Set(all.map((p) => p.id));
    const newcomers = all.filter((h) => h.vn === this.venueId && !this.roster.some((e) => e[0] === h.id));
    const racingFriends = this.roster.filter((e) => e[0] !== myId && present.has(e[0])).length;
    const becameHost = !this.isHost;
    if (becameHost && this.raceKey !== '') this.onToast('You are now the host');
    this.isHost = true;
    this.waiting = false;

    // 4D: only players who have this venue loaded go on the grid; the others wait (and are told)
    const loaded = all.filter((p) => p.vn === this.venueId);
    for (const p of all) if (p.vn !== this.venueId && !this.queue.includes(p.id)) {
      this.queue.push(p.id);
      this.onToast(`${p.name} is on another venue: they join when they switch to this one`);
    }
    if (becameHost || this.restartWanted) {
      this.restartWanted = false;
      this.newRace(loaded.slice(0, MAX_HUMANS), myId);
      return;
    }
    if (newcomers.length) {
      // in the lobby, or nobody else racing: put them on the grid now; otherwise they wait
      if (this.phase === 'lobby' || racingFriends === 0) {
        this.newRace(all.filter((p) => p.vn === this.venueId).slice(0, MAX_HUMANS), myId);
        return;
      }
      for (const h of newcomers) if (!this.queue.includes(h.id)) {
        this.queue.push(h.id);
        this.onToast(`${h.name} will join at the next start`);
      }
    }
    this.queue = this.queue.filter((id) => present.has(id));

    // friends who dropped out: in the lobby they're simply removed; mid-race the AI takes the car
    for (const e of [...this.roster]) {
      const [id, slot, paint, name] = e;
      if (id === myId || present.has(id)) {
        this.missing.delete(`drop:${id}`);
        continue;
      }
      const gone = (this.missing.get(`drop:${id}`) ?? 0) + dt;
      this.missing.set(`drop:${id}`, gone);
      if (gone < 4) continue;
      this.missing.delete(`drop:${id}`);
      if (this.phase === 'lobby') {
        this.newRace(all.filter((p) => p.vn === this.venueId).slice(0, MAX_HUMANS), myId);
        return;
      }
      this.roster = this.roster.filter((x) => x[0] !== id);
      this.aiRoster.push([slot, paint, -1, `${name} (AI)`.slice(0, 14)]);
      this.onTakeOver(id, slot, `${name} (AI)`, true);
      this.onToast(`${name} dropped out: the AI drives their car`);
    }

    // lobby: hold the grid; start when the host says, or 3 s after every friend is Ready
    if (this.phase === 'lobby') {
      r.lobbyHold();
      const friends = all.filter((p) => p.id !== myId && this.roster.some((e) => e[0] === p.id));
      const allReady = friends.length > 0 && friends.every((p) => p.ready);
      if (allReady) this.autoStart = this.autoStart < 0 ? 3 : this.autoStart - dt;
      else this.autoStart = -1;
      if (this.startWanted || (allReady && this.autoStart <= 0)) {
        this.startWanted = false;
        this.autoStart = -1;
        this.phase = 'race';
        this.onToast('Race starting');
      }
      return;
    }
    this.startWanted = false;

    // race over (every human finished or gone) and friends waiting → back to the lobby with them
    const humansDone = r.cars.filter((c) => c.isPlayer || (c.remote && !c.netId.startsWith('ai:'))).every((c) => c.finished || c.gone);
    if (r.targetLaps > 0 && humansDone) this.overT += dt;
    else this.overT = 0;
    if (this.overT > (this.queue.length ? 6 : 20)) {
      this.overT = 0;
      this.newRace(all.filter((p) => p.vn === this.venueId).slice(0, MAX_HUMANS), myId);
    }
  }

  private guestUpdate(hostId: string, peers: Map<string, PeerView>, myId: string): void {
    this.isHost = false;
    const hb = peers.get(hostId)?.host;
    if (!hb) return;
    const onGrid = hb.r.some((e) => e[0] === myId);
    this.waiting = !onGrid;
    this.venueMismatch = hb.vn && hb.vn !== this.venueId ? hb.vn : '';
    this.phase = hb.ph === 0 ? 'lobby' : 'race';
    this.autoStart = hb.st ?? -1;
    if (!onGrid) return;
    const key = `${hostId}|${hb.id}`;
    if (key !== this.raceKey) {
      this.raceKey = key;
      this.ready = false;
      this.roster = hb.r;
      this.aiRoster = hb.a;
      const specs: CarSpec[] = [];
      for (const [slot, paint, idx, nm] of hb.a) specs.push({ kind: 'remote', name: idx === -1 ? (nm ?? 'AI') : RIVALS[idx].name, number: idx === -1 ? slot + 1 : RIVALS[idx].number, paint, grid: slot, netId: `ai:${slot}` });
      hb.r.forEach(([id, slot, paint, name, ed], k) => specs.push(this.humanSpec(id, myId, slot, paint, name, ed, k)));
      this.onRoster(specs, false);
    } else if (hb.a.length !== this.aiRoster.length) {
      // a friend dropped out mid-race: their car is now one of the host's AI cars
      for (const e of hb.a) {
        if (this.aiRoster.some((x) => x[0] === e[0])) continue;
        const was = this.roster.find((x) => x[1] === e[0]);
        if (was) this.onTakeOver(was[0], e[0], e[3] ?? `${was[3]} (AI)`, false);
      }
      this.roster = hb.r;
      this.aiRoster = hb.a;
    }
    const r = this.getRace();
    r.clockExternal = true;
    r.countdown = hb.cd;
    r.hold = hb.hd ?? 0;
    if (typeof hb.ri === 'number') r.rainK = Math.max(0, Math.min(1, hb.ri / 100));
    r.targetLaps = hb.l;
    if (hb.pz) this.onPursuit(hb.pz);
    this.onHostMusic(hb.mu ?? null, Math.max(0, this.ping) / 2000);
    const cw = WEATHERS[hb.w];
    const ct = TIMES[hb.t];
    const now = this.getConditions();
    if (now.weather !== cw || now.time !== ct) this.onConditions({ weather: cw, time: ct });
    // AI cars come from the host
    hb.a.forEach(([slot], k) => {
      const st = hb.ai[k];
      const car = r.cars.find((c) => c.netId === `ai:${slot}`);
      if (car && Array.isArray(st) && validNetCar(st)) r.receive(car, st, typeof st[12] === 'number' && Number.isFinite(st[12]) ? st[12] : 0);
    });
  }

  /** A human on the grid: you drive your own edition and garage look unless the host had to change your colour. */
  private humanSpec(id: string, myId: string, slot: number, paint: number, name: string, ed: number, k: number): CarSpec {
    const edition = EDITIONS[ed]?.id ?? EDITIONS[0].id;
    if (id === myId) {
      const mine = lookOf(this.settings.loadout);
      const look = mine.paintIndex === paint ? mine : { ...mine, color: lookFromPaint(paint, edition).color, paintIndex: paint };
      return { kind: 'player', name: 'You', number: 1, paint, grid: slot, edition: this.settings.loadout.edition, look };
    }
    return { kind: 'remote', name, number: k + 1, paint, grid: slot, netId: id, edition, look: lookFromPaint(paint, edition) };
  }

  /** Host: lay out a new grid (AI at the front, humans behind in joining order) and go to the lobby. */
  private newRace(humans: PeerView[], myId: string): void {
    const nAI = this.settings.rivals ? Math.max(0, Math.min(RIVALS.length, AI.gridSize - humans.length)) : 0;
    const used = new Set<number>();
    const pick = (want: number): number => {
      let p = want;
      for (let k = 0; k < PAINTS.length && used.has(p); k++) p = (p + 1) % PAINTS.length;
      used.add(p);
      return p;
    };
    this.roster = humans.map((h, k) => [h.id, nAI + k, pick(h.paint), h.name, h.edition]);
    this.aiRoster = [];
    for (let k = 0; k < nAI; k++) this.aiRoster.push([k, pick(0), k]);
    this.queue = this.queue.filter((id) => !humans.some((h) => h.id === id));
    this.raceId = (Date.now() % 1000000000) + Math.floor(Math.random() * 1000);
    this.raceKey = `${myId}|${this.raceId}`;
    this.phase = 'lobby';
    this.autoStart = -1;
    this.startWanted = false;
    this.overT = 0;
    const specs: CarSpec[] = [];
    for (const [slot, paint, idx] of this.aiRoster) specs.push({ kind: 'ai', name: RIVALS[idx].name, number: RIVALS[idx].number, paint, grid: slot, style: RIVALS[idx].style });
    this.roster.forEach(([id, slot, paint, name, ed], k) => specs.push(this.humanSpec(id, myId, slot, paint, name, ed, k)));
    this.onRoster(specs, true);
  }
}
