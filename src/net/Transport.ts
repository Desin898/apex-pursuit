// ─────────────────────────────────────────────────────────────────────────────
// Transport — how players' states reach each other. Every transport does the same simple job:
// "here is my current state object" out, "here is everyone's latest state" in. Three ways:
//
//   room   the hosting page's live room (when the game runs as a shared claude.ai page)
//   relay  a WebSocket to the small Node relay in server/relay.mjs (self-hosted, LAN or internet).
//          4C.2: any copy of the game can join any relay by address (a link a friend sends,
//          e.g. https://xxxx.trycloudflare.com/?room=friends), with an optional room password.
//   tabs   BroadcastChannel between tabs of one browser (handy for trying it out alone)
//
// Everything received is untrusted data from another player; OnlineSession validates it.
// ─────────────────────────────────────────────────────────────────────────────

export interface NetPeer {
  id: string;
  isMe: boolean;
  data: Record<string, unknown> | null;
}

export interface Transport {
  readonly kind: 'room' | 'relay' | 'tabs';
  /** connected, and this client's own id is known */
  ready(): boolean;
  /** the connection can never work (not permitted, server gone) */
  failed(): boolean;
  myId(): string;
  publish(state: Record<string, unknown>): void;
  /** everyone else currently present (may include this client, flagged isMe) */
  peers(): NetPeer[];
  close(): void;
  /** 4C.2: round trip to the server in ms (−1 = unknown) */
  rtt?(): number;
  /** 4C.2: why failed() is true, in words for the player */
  failReason?(): string;
  /** 4C.2: where we're connected, for the lobby (e.g. "xxxx.trycloudflare.com · friends") */
  label?(): string;
}

/** 4C.2: a room password is never sent as typed (a friendly-game guard, not real security) */
export function passKey(room: string, pass: string): string {
  if (!pass) return '';
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const str = `apex|${room}|${pass}`;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 + c, 2654435761);
  }
  return ((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)).slice(0, 16);
}

export const cleanRoom = (r: string | null | undefined): string => (r || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'friends';

/**
 * 4C.2: turn whatever a friend pasted (a link, a host name, "192.168.1.20:8080") into the relay's
 * WebSocket address. Returns null if it can't be an address.
 */
export function relaySocketUrl(input: string, room: string, pass: string): { url: string; label: string } | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(s) ? 'http://' : 'https://') + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!/^(https?|wss?):$/.test(u.protocol) || !u.host) return null;
  const secure = u.protocol === 'https:' || u.protocol === 'wss:';
  const r = cleanRoom(u.searchParams.get('room') || room);
  const key = passKey(r, u.searchParams.get('pw') || pass);
  return { url: `${secure ? 'wss' : 'ws'}://${u.host}/ws?room=${r}&v=2${key ? `&k=${key}` : ''}`, label: `${u.host} · ${r}` };
}

export interface TransportOptions {
  /** relay address to join (anything relaySocketUrl understands) */
  server?: string;
  room?: string;
  pass?: string;
  /** 'tabs' = same-browser test mode */
  force?: 'tabs';
}

const STALE_MS = 3500;

/**
 * Everyone we've heard from recently. 4E: if this page itself stalled (a long frame: shaders
 * compiling, the tab in the background), the others only look stale because we haven't read
 * their messages yet, so they're kept a little longer; dropping them would make us think we're
 * alone and take over as host.
 */
function freshPeers(others: Map<string, { data: Record<string, unknown>; t: number }>, poll: { last: number; grace: number }): NetPeer[] {
  const now = performance.now();
  const gap = poll.last ? now - poll.last : 0;
  poll.last = now;
  poll.grace = gap > 700 ? Math.max(poll.grace, gap + 2500) : Math.max(0, poll.grace - gap);
  const out: NetPeer[] = [];
  for (const [id, v] of others) {
    if (now - v.t > STALE_MS + poll.grace) others.delete(id);
    else out.push({ id, isMe: false, data: v.data });
  }
  return out;
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// ── claude.ai page room ──────────────────────────────────────────────────────
interface RoomPeer {
  peer: string;
  isMe: boolean;
  sameTab: boolean;
  kind: string;
  presence: Record<string, unknown>;
}
interface RoomApi {
  presence(patch: Record<string, unknown>): Promise<void>;
  peers(): readonly RoomPeer[];
  connected(): boolean;
  onConnection(fn: (c: boolean) => void, onError?: (e: { code: string }) => void): () => void;
}

class RoomTransport implements Transport {
  readonly kind = 'room' as const;
  private dead = false;
  private off: () => void;
  constructor(private room: RoomApi) {
    this.off = room.onConnection(
      () => {},
      () => (this.dead = true),
    );
  }
  private me(): RoomPeer | undefined {
    return this.room.peers().find((p) => p.isMe && p.sameTab);
  }
  ready(): boolean {
    return !this.dead && this.room.connected() && !!this.me();
  }
  failed(): boolean {
    return this.dead;
  }
  myId(): string {
    return this.me()?.peer ?? '';
  }
  publish(state: Record<string, unknown>): void {
    // one top-level presence field holds the whole game state for this player
    this.room.presence({ apex: state }).catch((e: { code?: string }) => {
      if (e && (e.code === 'not_granted' || e.code === 'revoked' || e.code === 'capability_disabled' || e.code === 'capability_removed')) this.dead = true;
    });
  }
  peers(): NetPeer[] {
    const out: NetPeer[] = [];
    for (const p of this.room.peers()) {
      if (p.kind !== 'viewer') continue;
      const d = p.presence ? p.presence.apex : null;
      out.push({ id: p.peer, isMe: p.isMe && p.sameTab, data: isObj(d) ? d : null });
    }
    return out;
  }
  close(): void {
    this.room.presence({ apex: null }).catch(() => {});
    this.off();
  }
}

// ── WebSocket relay ──────────────────────────────────────────────────────────
class RelayTransport implements Transport {
  readonly kind = 'relay' as const;
  private ws: WebSocket | null = null;
  private id = '';
  private others = new Map<string, { data: Record<string, unknown>; t: number }>();
  private closed = false;
  private fails = 0;
  private reason = '';
  private rttMs = -1;
  private pingTimer = 0;
  constructor(
    private url: string,
    private where = '',
  ) {
    this.connect();
    this.pingTimer = window.setInterval(() => {
      if (this.ready()) this.ws!.send(JSON.stringify({ t: 'ping', ts: performance.now() }));
    }, 2000);
  }
  rtt(): number {
    return this.rttMs;
  }
  failReason(): string {
    return this.reason || "Couldn't reach the race server. Check the link, and that the host's window is still open.";
  }
  label(): string {
    return this.where;
  }
  private connect(): void {
    if (this.closed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onmessage = (ev) => {
      let m: unknown;
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (!isObj(m)) return;
      if (m.t === 'hi' && typeof m.id === 'string') {
        this.id = m.id;
        this.fails = 0;
      } else if (m.t === 'pong' && typeof m.ts === 'number') {
        const r = performance.now() - m.ts;
        this.rttMs = this.rttMs < 0 ? r : this.rttMs * 0.7 + r * 0.3;
      } else if (m.t === 's' && typeof m.id === 'string' && isObj(m.d)) this.others.set(m.id, { data: m.d, t: performance.now() });
      else if (m.t === 'bye' && typeof m.id === 'string') this.others.delete(m.id);
    };
    ws.onclose = (ev) => {
      this.id = '';
      this.others.clear();
      // the server's reasons are final: don't keep knocking
      if (ev.code === 4003) {
        this.reason = 'Wrong or missing room password.';
        this.fails = 8;
        return;
      }
      if (ev.code === 1013 || ev.code === 4004) {
        this.reason = 'That room is full.';
        this.fails = 8;
        return;
      }
      if (ev.code === 4005) {
        this.reason = 'The host is running a different version of the game. Download the latest ZIP.';
        this.fails = 8;
        return;
      }
      this.fails++;
      if (!this.closed && this.fails < 8) setTimeout(() => this.connect(), 800 + this.fails * 400); // quietly reconnect
    };
    ws.onerror = () => {};
  }
  ready(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN && this.id !== '';
  }
  failed(): boolean {
    return this.fails >= 8;
  }
  myId(): string {
    return this.id;
  }
  publish(state: Record<string, unknown>): void {
    if (this.ready()) this.ws!.send(JSON.stringify({ t: 's', d: state }));
  }
  private poll = { last: 0, grace: 0 };
  peers(): NetPeer[] {
    return freshPeers(this.others, this.poll);
  }
  close(): void {
    this.closed = true;
    clearInterval(this.pingTimer);
    this.ws?.close();
  }
}

// ── Same-browser tabs ────────────────────────────────────────────────────────
class TabsTransport implements Transport {
  readonly kind = 'tabs' as const;
  private id = 't' + Math.random().toString(36).slice(2, 10);
  private ch: BroadcastChannel;
  private others = new Map<string, { data: Record<string, unknown>; t: number }>();
  constructor() {
    this.ch = new BroadcastChannel('apex-pursuit-net');
    this.ch.onmessage = (ev) => {
      const m = ev.data as unknown;
      if (!isObj(m) || typeof m.id !== 'string') return;
      if (m.bye) this.others.delete(m.id);
      else if (isObj(m.d)) this.others.set(m.id, { data: m.d, t: performance.now() });
    };
    window.addEventListener('pagehide', () => this.ch.postMessage({ id: this.id, bye: true }));
  }
  ready(): boolean {
    return true;
  }
  failed(): boolean {
    return false;
  }
  myId(): string {
    return this.id;
  }
  publish(state: Record<string, unknown>): void {
    this.ch.postMessage({ id: this.id, d: state });
  }
  private poll = { last: 0, grace: 0 };
  peers(): NetPeer[] {
    return freshPeers(this.others, this.poll);
  }
  close(): void {
    this.ch.postMessage({ id: this.id, bye: true });
    this.ch.close();
  }
}

/** true when this page was opened from a relay's own address (the host's link) */
export function servedByRelay(): boolean {
  const w = window as unknown as { __APEX_RELAY__?: boolean };
  return !!w.__APEX_RELAY__ && location.protocol.startsWith('http');
}

/** Pick the best way to reach other players from wherever this page is running. */
export async function openTransport(opts: TransportOptions = {}): Promise<Transport | null> {
  const w = window as unknown as { claude?: { use?: (name: string) => Promise<unknown> } };
  try {
    if (opts.force === 'tabs' && typeof BroadcastChannel !== 'undefined') return new TabsTransport();
    if (opts.server) {
      const r = relaySocketUrl(opts.server, opts.room ?? '', opts.pass ?? '');
      return r ? new RelayTransport(r.url, r.label) : null;
    }
    if (servedByRelay()) {
      const room = cleanRoom(new URLSearchParams(location.search).get('room') || opts.room);
      const key = passKey(room, opts.pass ?? '');
      return new RelayTransport(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?room=${room}&v=2${key ? `&k=${key}` : ''}`, `${location.host} · ${room}`);
    }
    if (w.claude && typeof w.claude.use === 'function') {
      const room = (await Promise.race([w.claude.use('room'), new Promise((r) => setTimeout(() => r(null), 11000))])) as RoomApi | null;
      if (room && typeof room.presence === 'function') return new RoomTransport(room);
    }
    if (typeof BroadcastChannel !== 'undefined') return new TabsTransport();
  } catch {
    /* fall through */
  }
  return null;
}
