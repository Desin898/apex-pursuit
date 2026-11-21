// ─────────────────────────────────────────────────────────────────────────────
// Transport — how players' states reach each other. Every transport does the same simple job:
// "here is my current state object" out, "here is everyone's latest state" in. Three ways:
//
//   room   the hosting page's live room (when the game runs as a shared claude.ai page)
//   relay  a WebSocket to the small Node relay in server/relay.mjs (self-hosted, LAN or internet)
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
}

const STALE_MS = 3500;
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
  constructor(private url: string) {
    this.connect();
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
      } else if (m.t === 's' && typeof m.id === 'string' && isObj(m.d)) this.others.set(m.id, { data: m.d, t: performance.now() });
      else if (m.t === 'bye' && typeof m.id === 'string') this.others.delete(m.id);
    };
    ws.onclose = () => {
      this.id = '';
      this.others.clear();
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
  peers(): NetPeer[] {
    const now = performance.now();
    const out: NetPeer[] = [];
    for (const [id, v] of this.others) {
      if (now - v.t > STALE_MS) this.others.delete(id);
      else out.push({ id, isMe: false, data: v.data });
    }
    return out;
  }
  close(): void {
    this.closed = true;
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
  peers(): NetPeer[] {
    const now = performance.now();
    const out: NetPeer[] = [];
    for (const [id, v] of this.others) {
      if (now - v.t > STALE_MS) this.others.delete(id);
      else out.push({ id, isMe: false, data: v.data });
    }
    return out;
  }
  close(): void {
    this.ch.postMessage({ id: this.id, bye: true });
    this.ch.close();
  }
}

/** Pick the best way to reach other players from wherever this page is running. */
export async function openTransport(): Promise<Transport | null> {
  const w = window as unknown as { __APEX_RELAY__?: boolean; claude?: { use?: (name: string) => Promise<unknown> } };
  try {
    if (w.__APEX_RELAY__ && location.protocol.startsWith('http')) {
      const room = (new URLSearchParams(location.search).get('room') || 'main').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'main';
      return new RelayTransport(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?room=${room}`);
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
