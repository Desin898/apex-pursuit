// ─────────────────────────────────────────────────────────────────────────────
// MusicLibrary (4D.1) — the game's own music player. No streaming service, no extra scripts.
//
// Where tracks come from:
//  • a music pack next to the game: music/tracks.js (window.__APEX_TRACKS__) + the audio files
//    and covers it lists. tools/music-pack.py builds one from a folder of MP3s. The public game
//    ships without one.
//  • music the player adds in Music → Add music (files or a folder, or dropped on the window).
//    Kept in this browser (IndexedDB), so it's a one-time step per browser.
//
// Playback: one <audio> element at a time with a short fade between tracks; it carries on across
// menus, races and results. A shuffled rotation through the ticked tracks loops forever; playing
// a chosen track drops back into the rotation when it ends.
// ─────────────────────────────────────────────────────────────────────────────

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** seconds (0 until known) */
  dur: number;
  /** cover image URL ('' = none) */
  cover: string;
  /** audio URL */
  src: string;
  source: 'pack' | 'mine';
}

interface PackEntry {
  id: string;
  file: string;
  title: string;
  artist: string;
  album?: string;
  dur?: number;
  cover?: string;
}

export type MusicState = 'empty' | 'stopped' | 'playing' | 'paused';

/** "Artist - Title (SPOTISAVER).mp3" → names, and tidy leftovers like "#U00ae" */
export function cleanName(s: string): string {
  return s
    .replace(/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i, '')
    .replace(/\s*\((SPOTISAVER|spotisaver)\)\s*/g, ' ')
    .replace(/#U([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

export function namesFromFile(file: string): { title: string; artist: string } {
  const base = cleanName(file.split(/[\\/]/).pop() ?? file);
  const i = base.indexOf(' - ');
  return i > 0 ? { artist: base.slice(0, i).trim(), title: base.slice(i + 3).trim() } : { artist: '', title: base };
}

// ── ID3v2 tags (title, artist, album, cover) ─────────────────────────────────
function synchsafe(b: Uint8Array, o: number): number {
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
}
function decodeText(b: Uint8Array): string {
  if (!b.length) return '';
  const enc = b[0];
  const body = b.subarray(1);
  let s: string;
  try {
    if (enc === 1 || enc === 2) s = new TextDecoder(enc === 1 ? 'utf-16' : 'utf-16be').decode(body);
    else if (enc === 3) s = new TextDecoder('utf-8').decode(body);
    else s = new TextDecoder('latin1').decode(body);
  } catch {
    s = '';
  }
  return s.replace(/\u0000+$/g, '').replace(/\u0000/g, ' / ').trim();
}

export async function readTags(file: Blob): Promise<{ title?: string; artist?: string; album?: string; cover?: Blob }> {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return {};
  const ver = head[3];
  const size = synchsafe(head, 6);
  const b = new Uint8Array(await file.slice(10, 10 + Math.min(size, 8 * 1024 * 1024)).arrayBuffer());
  const out: { title?: string; artist?: string; album?: string; cover?: Blob } = {};
  let o = 0;
  if (head[5] & 0x40) o += ver === 4 ? synchsafe(b, 0) : ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) + 4; // extended header
  while (o + 10 <= b.length) {
    const id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const len = ver === 4 ? synchsafe(b, o + 4) : (b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7];
    const data = b.subarray(o + 10, o + 10 + len);
    if (id === 'TIT2') out.title = decodeText(data);
    else if (id === 'TPE1') out.artist = decodeText(data).replace(/\s*\/\s*/g, ', ');
    else if (id === 'TALB') out.album = decodeText(data);
    else if (id === 'APIC' && !out.cover) {
      const enc = data[0];
      let p = 1;
      while (p < data.length && data[p] !== 0) p++; // MIME
      const mime = new TextDecoder('latin1').decode(data.subarray(1, p)) || 'image/jpeg';
      p += 2; // NUL + picture type
      if (enc === 1 || enc === 2) {
        while (p + 1 < data.length && !(data[p] === 0 && data[p + 1] === 0)) p += 2;
        p += 2;
      } else {
        while (p < data.length && data[p] !== 0) p++;
        p++;
      }
      out.cover = new Blob([data.slice(p)], { type: mime.includes('/') ? mime : 'image/jpeg' });
    }
    o += 10 + len;
  }
  return out;
}

// ── storage for music the player adds ────────────────────────────────────────
const DB = 'apex-music';
const STORE = 'tracks';
function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
interface Stored {
  id: string;
  title: string;
  artist: string;
  album: string;
  audio: Blob;
  cover: Blob | null;
  added: number;
}

export class MusicLibrary {
  tracks: Track[] = [];
  state: MusicState = 'empty';
  current: Track | null = null;
  /** ids the player switched off (not in the rotation) */
  off = new Set<string>();
  onTrack: (t: Track) => void = () => {};
  onChange: () => void = () => {};

  private audio: HTMLAudioElement | null = null;
  private fading: HTMLAudioElement | null = null;
  private order: string[] = [];
  private at = 0;
  private volume = 0.7;
  private unlocked = false;
  private wantPlay = false;
  private paused = false; // paused by the game (e.g. music off in races)
  private urls: string[] = [];

  constructor(off: string[] = []) {
    this.off = new Set(off);
  }

  get count(): number {
    return this.tracks.length;
  }
  get enabled(): Track[] {
    return this.tracks.filter((t) => !this.off.has(t.id));
  }
  get position(): number {
    return this.audio ? this.audio.currentTime : 0;
  }
  get duration(): number {
    const d = this.audio?.duration;
    return d && Number.isFinite(d) ? d : this.current?.dur ?? 0;
  }

  /** Load the pack next to the game (if any) and the player's own music. */
  async load(): Promise<void> {
    const pack = (window as unknown as { __APEX_TRACKS__?: PackEntry[] }).__APEX_TRACKS__;
    const list: Track[] = [];
    if (Array.isArray(pack))
      for (const e of pack)
        if (e && typeof e.file === 'string')
          list.push({ id: `pack:${e.id}`, title: e.title || namesFromFile(e.file).title, artist: e.artist || namesFromFile(e.file).artist, album: e.album ?? '', dur: e.dur ?? 0, cover: e.cover ? `music/${e.cover}` : '', src: `music/${e.file}`, source: 'pack' });
    try {
      const db = await openDb();
      const rows = await new Promise<Stored[]>((res, rej) => {
        const r = db.transaction(STORE).objectStore(STORE).getAll();
        r.onsuccess = () => res(r.result as Stored[]);
        r.onerror = () => rej(r.error);
      });
      rows.sort((a, b) => a.added - b.added);
      for (const s of rows) list.push(this.fromStored(s));
    } catch {
      /* storage blocked: pack only */
    }
    this.tracks = list;
    this.state = list.length ? (this.state === 'empty' ? 'stopped' : this.state) : 'empty';
    this.reshuffle();
    this.onChange();
    // the first click or key came before the list was ready
    if (this.unlocked && this.wantPlay && !this.current && list.length) this.next();
  }

  private fromStored(s: Stored): Track {
    const a = URL.createObjectURL(s.audio);
    const c = s.cover ? URL.createObjectURL(s.cover) : '';
    this.urls.push(a);
    if (c) this.urls.push(c);
    return { id: s.id, title: s.title, artist: s.artist, album: s.album, dur: 0, cover: c, src: a, source: 'mine' };
  }

  /** Music → Add music: keep these files in this browser. Returns how many were added. */
  async add(files: File[]): Promise<number> {
    const audio = files.filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i.test(f.name));
    if (!audio.length) return 0;
    const db = await openDb();
    let n = 0;
    for (const f of audio) {
      const id = `mine:${f.name}:${f.size}`;
      if (this.tracks.some((t) => t.id === id)) continue;
      const tags = await readTags(f).catch(() => ({}) as Awaited<ReturnType<typeof readTags>>);
      const fromName = namesFromFile(f.name);
      const s: Stored = { id, title: cleanName(tags.title || fromName.title), artist: tags.artist || fromName.artist, album: tags.album ?? '', audio: f, cover: tags.cover ?? null, added: Date.now() + n };
      await new Promise<void>((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(s);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      this.tracks.push(this.fromStored(s));
      n++;
    }
    if (this.state === 'empty' && this.tracks.length) this.state = 'stopped';
    this.reshuffle();
    this.onChange();
    if (this.unlocked && this.wantPlay && !this.current) this.next();
    return n;
  }

  /** remove the music this browser keeps (the pack stays) */
  async clearMine(): Promise<void> {
    try {
      const db = await openDb();
      await new Promise<void>((res) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => res();
        tx.onerror = () => res();
      });
    } catch {
      /* nothing kept */
    }
    if (this.current?.source === 'mine') this.stop();
    this.tracks = this.tracks.filter((t) => t.source === 'pack');
    if (!this.tracks.length) this.state = 'empty';
    this.reshuffle();
    this.onChange();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.audio && !this.fading) this.audio.volume = this.volume;
  }

  /** Browsers allow sound only after a click or key: call from the first one. */
  unlock(autoplay: boolean): void {
    if (this.unlocked) return;
    this.unlocked = true;
    this.wantPlay = autoplay;
    if (autoplay && this.tracks.length) this.next();
  }

  setOn(id: string, on: boolean): void {
    if (on) this.off.delete(id);
    else this.off.add(id);
    this.reshuffle(true);
    this.onChange();
  }
  /** □: everything on, or (when all are on already) everything off */
  toggleAll(): void {
    if (this.off.size) this.off.clear();
    else for (const t of this.tracks) this.off.add(t.id);
    this.reshuffle(true);
    this.onChange();
  }

  private reshuffle(keepCurrent = false): void {
    const ids = this.enabled.map((t) => t.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    if (keepCurrent && this.current) {
      const k = ids.indexOf(this.current.id);
      if (k > 0) [ids[0], ids[k]] = [ids[k], ids[0]];
      this.at = k >= 0 ? 0 : -1;
    } else this.at = -1;
    this.order = ids;
  }

  /** ✕: play this track now; afterwards the rotation carries on */
  playTrack(id: string): void {
    const t = this.tracks.find((x) => x.id === id);
    if (!t) return;
    this.wantPlay = true;
    this.start(t);
  }

  /** L3 + R3 / M: next in the rotation */
  next(): void {
    if (!this.tracks.length) return;
    let ids = this.order;
    if (!ids.length) {
      // everything switched off: nothing to rotate, but a chosen track can still play
      if (this.current) this.stop();
      return;
    }
    this.at++;
    if (this.at >= ids.length) {
      this.reshuffle();
      ids = this.order;
      // don't repeat the track that just finished
      if (ids.length > 1 && ids[0] === this.current?.id) [ids[0], ids[1]] = [ids[1], ids[0]];
      this.at = 0;
    }
    const t = this.tracks.find((x) => x.id === ids[this.at]);
    if (t) {
      this.wantPlay = true;
      this.start(t);
    }
  }

  /** △: play / stop */
  toggle(): void {
    if (this.state === 'playing') this.stop();
    else if (this.current && this.audio) {
      this.wantPlay = true;
      this.paused = false;
      void this.audio.play().catch(() => {});
      this.state = 'playing';
      this.onChange();
    } else this.next();
  }

  stop(): void {
    this.wantPlay = false;
    this.audio?.pause();
    this.state = this.tracks.length ? (this.current ? 'paused' : 'stopped') : 'empty';
    this.onChange();
  }

  /** the game pauses music (e.g. "music in races: off") without changing what the player chose */
  hold(held: boolean): void {
    if (held === this.paused) return;
    this.paused = held;
    if (!this.audio) return;
    if (held) this.audio.pause();
    else if (this.wantPlay) void this.audio.play().catch(() => {});
  }

  private start(t: Track): void {
    // fade the old one out
    const old = this.audio;
    if (old) {
      this.fading?.pause();
      this.fading = old;
      const v0 = old.volume;
      const t0 = performance.now();
      const step = () => {
        const k = 1 - (performance.now() - t0) / 700;
        if (k <= 0 || this.fading !== old) {
          old.pause();
          old.removeAttribute('src');
          old.load();
          if (this.fading === old) this.fading = null;
          return;
        }
        old.volume = v0 * k;
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    const a = new Audio();
    a.preload = 'auto';
    a.src = t.src;
    a.volume = this.volume;
    a.addEventListener('ended', () => {
      if (this.audio === a) this.next();
    });
    a.addEventListener('error', () => {
      // a missing or unreadable file: skip it (once), don't stall the music
      if (this.audio === a) setTimeout(() => this.audio === a && this.next(), 400);
    });
    a.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(a.duration)) t.dur = a.duration;
    });
    this.audio = a;
    this.current = t;
    this.state = 'playing';
    if (!this.paused) void a.play().catch(() => (this.state = 'paused'));
    this.onTrack(t);
    this.onChange();
  }
}
