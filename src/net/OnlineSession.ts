// ─────────────────────────────────────────────────────────────────────────────
// OnlineSession — racing with friends.
//
// Model: every player simulates their own car with the full physics and publishes its state
// 20 times a second. One player is the HOST (whoever has been in longest); the host also runs
// the AI rivals, decides the grid, and owns the starting-lights clock. Everyone else shows the
// other humans and the AI as "remote" cars moved by those published states.
//
// Up to four humans share a grid of eight; AI fills the remaining slots. A new player joining
// sends everyone back to the grid for a fresh start. If the host leaves, the next player in line
// takes over and restarts the race.
//
// Friendly-game trust model: each machine is the authority for its own car. That is simple and
// lag-tolerant, but it is not cheat-proof; a server-authoritative mode is a later step.
// ─────────────────────────────────────────────────────────────────────────────
import { Conditions, TIMES, WEATHERS } from '../world/Environment';
import { AI, PAINTS, RIVALS } from '../config';
import { Settings } from '../core/Settings';
import { CarSpec, NetCar, packCar, Race, validNetCar } from '../game/Race';
import { EDITIONS, lookFromPaint, lookOf } from '../vehicle/Cars';
import { openTransport, Transport } from './Transport';

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
}
interface HostBlock {
  id: number; // race id: changes on every restart
  cd: number; // countdown seconds remaining (0 = racing)
  hd?: number; // the random "Set" hold inside that countdown
  ri?: number; // rain intensity 0..100 (4B.2): the host's shower, so everyone gets wet together
  r: [string, number, number, string, number][]; // humans: peer id, grid slot, paint, name, edition index
  a: [number, number, number][]; // AI: grid slot, paint, index into RIVALS
  ai: number[][]; // AI states, same order as `a`: NetCar + race distance
  l: number; // laps to race (0 = endless)
  w: number; // weather index (WEATHERS)
  t: number; // time of day index (TIMES)
  /** police state in a Pursuit Race (untrusted: Pursuit.unpack checks it) */
  pz: unknown;
}

const cleanName = (v: unknown): string => {
  const s = String(typeof v === 'string' ? v : '').replace(/[^\w .\-]/g, '').trim().slice(0, 14);
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
    if (!Array.isArray(e) || !isInt(e[0], 0, AI.gridSize - 1) || !isInt(e[1], 0, PAINTS.length - 1) || !isInt(e[2], 0, RIVALS.length - 1)) return null;
    a.push([e[0], e[1], e[2]]);
  }
  return { id: o.id, cd: Math.max(0, Math.min(10, o.cd)), r, a, ai: o.ai as number[][], pz: o.pz, l: isInt(o.l, 0, 20) ? (o.l as number) : 3, w: isInt(o.w, 0, WEATHERS.length - 1) ? (o.w as number) : 0, t: isInt(o.t, 0, TIMES.length - 1) ? (o.t as number) : 0 };
}

export class OnlineSession {
  status: OnlineStatus = 'off';
  isHost = false;
  /** humans currently in the session (including you), for the UI */
  players: { id: string; name: string; me: boolean; host: boolean }[] = [];
  /** called when the grid changes and the game must rebuild its cars */
  onRoster: (specs: CarSpec[], host: boolean) => void = () => {};
  onToast: (text: string) => void = () => {};
  onStatus: () => void = () => {};

  private transport: Transport | null = null;
  private joined = 0;
  private raceKey = '';
  private raceId = 0;
  private roster: HostBlock['r'] = [];
  private aiRoster: HostBlock['a'] = [];
  private restartWanted = false;
  private sendAcc = 0;
  private known = new Map<string, string>(); // peer id → name, for join/leave messages
  private missing = new Map<string, number>(); // netId → seconds unseen
  private attempt = 0;

  /** the host's weather and time of day (the host reads these; guests are told when they change) */
  getConditions: () => Conditions = () => ({ weather: 'clear', time: 'dusk' });
  onConditions: (c: Conditions) => void = () => {};
  /** guests: the host's police state arrived */
  onPursuit: (d: unknown) => void = () => {};
  private heatSeen = new Map<string, number>();
  private myHeat = 0;

  constructor(private getRace: () => Race, private settings: Settings) {}

  get transportKind(): string {
    return this.transport ? this.transport.kind : '';
  }

  async enable(): Promise<void> {
    if (this.status === 'connecting' || this.status === 'online') return;
    const attempt = ++this.attempt;
    this.setStatus('connecting');
    const t = await openTransport();
    if (attempt !== this.attempt) {
      t?.close();
      return;
    }
    if (!t) {
      this.setStatus('unavailable');
      return;
    }
    this.transport = t;
    this.joined = Date.now();
    this.raceKey = '';
    this.isHost = false;
    this.known.clear();
  }

  disable(): void {
    this.attempt++;
    this.transport?.close();
    this.transport = null;
    this.isHost = false;
    this.players = [];
    this.raceKey = '';
    this.setStatus('off');
  }

  /** Host only: send everyone back to the grid (also used after changing rivals / difficulty). */
  requestRestart(): boolean {
    if (!this.isHost) return false;
    this.restartWanted = true;
    return true;
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
      this.transport = null;
      t.close();
      this.isHost = false;
      this.players = [];
      this.setStatus('unavailable');
      return;
    }
    if (!t.ready()) return;
    if (this.status !== 'online') this.setStatus('online');
    const myId = t.myId();
    const race = this.getRace();

    // ── read everyone ──
    const peers = new Map<string, PeerView>();
    for (const p of t.peers()) {
      if (p.isMe || p.id === myId || !p.data || p.data.v !== 1) continue;
      const d = p.data;
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
      });
    }
    const myLook = lookOf(this.settings.loadout);
    const myEdition = Math.max(0, EDITIONS.findIndex((e) => e.id === this.settings.loadout.edition));
    const me: PeerView = { id: myId, name: cleanName(this.settings.name), paint: myLook.paintIndex, joined: this.joined, car: null, dist: 0, host: null, edition: myEdition, heat: 0 };
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
    if (amHost) {
      const humans = all.slice(0, MAX_HUMANS);
      const newcomer = humans.some((h) => !this.roster.some((r) => r[0] === h.id));
      if (!this.isHost || this.restartWanted || newcomer) {
        if (!this.isHost && this.raceKey !== '') this.onToast('You are now the host');
        this.isHost = true;
        this.restartWanted = false;
        this.newRace(humans, myId);
      }
    } else {
      this.isHost = false;
      const hb = peers.get(hostId)?.host;
      if (hb) {
        const key = `${hostId}|${hb.id}|${JSON.stringify(hb.r)}|${JSON.stringify(hb.a)}`;
        if (key !== this.raceKey && hb.r.some((e) => e[0] === myId)) {
          this.raceKey = key;
          this.roster = hb.r;
          this.aiRoster = hb.a;
          const specs: CarSpec[] = [];
          for (const [slot, paint, idx] of hb.a) specs.push({ kind: 'remote', name: RIVALS[idx].name, number: RIVALS[idx].number, paint, grid: slot, netId: `ai:${slot}` });
          hb.r.forEach(([id, slot, paint, name, ed], k) => specs.push(this.humanSpec(id, myId, slot, paint, name, ed, k)));
          this.onRoster(specs, false);
        }
        if (key === this.raceKey) {
          const r = this.getRace();
          r.clockExternal = true;
          r.countdown = hb.cd;
          r.hold = hb.hd ?? 0;
          if (typeof hb.ri === 'number') r.rainK = Math.max(0, Math.min(1, hb.ri / 100));
          r.targetLaps = hb.l;
          if (hb.pz) this.onPursuit(hb.pz);
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
      }
    }

    // ── other humans' cars ──
    const r = this.getRace();
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
      if (pursuit && pursuit.mirror) {
        // guest: report the Heat this client raised (the host adds the increase)
        this.myHeat = pursuit.heatReport;
      }
      const state: Record<string, unknown> = { hr: Math.round(this.myHeat * 100) / 100, v: 1, n: me.name, p: me.paint, e: me.edition, j: this.joined, c: packCar(r.player.s), d: Math.round(r.player.lap.distance * 10000) / 10000 };
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
        state.h = { pz: pursuit && !pursuit.mirror ? pursuit.pack(packCar) : undefined, id: this.raceId, cd: Math.round(Math.max(0, r.countdown) * 100) / 100, hd: Math.round(r.hold * 100) / 100, ri: Math.round(r.rainK * 100), r: this.roster, a: this.aiRoster, ai, l: r.targetLaps, w: WEATHERS.indexOf(this.getConditions().weather), t: TIMES.indexOf(this.getConditions().time) };
      }
      t.publish(state);
    }
    void race;
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

  /** Host: lay out a new grid (AI at the front, humans behind in joining order) and restart. */
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
    this.raceId = (Date.now() % 1000000000) + Math.floor(Math.random() * 1000);
    this.raceKey = `${myId}|${this.raceId}`;
    const specs: CarSpec[] = [];
    for (const [slot, paint, idx] of this.aiRoster) specs.push({ kind: 'ai', name: RIVALS[idx].name, number: RIVALS[idx].number, paint, grid: slot, style: RIVALS[idx].style });
    this.roster.forEach(([id, slot, paint, name, ed], k) => specs.push(this.humanSpec(id, myId, slot, paint, name, ed, k)));
    this.onRoster(specs, true);
  }
}
