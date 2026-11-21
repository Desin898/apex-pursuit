// ─────────────────────────────────────────────────────────────────────────────
// MusicPlayer — the playlist in playlist.ts, shuffled, through Spotify's embedded player.
//
// How it works: Spotify's iFrame API (open.spotify.com/embed/iframe-api/v1) puts Spotify's own
// compact player in the #music card. We load one track at a time (so we can shuffle and skip),
// listen to its progress, and move on when a track ends.
//
// What Spotify decides, not us:
// - Full tracks play when the browser is signed in to Spotify (open.spotify.com) with a
//   Premium account; otherwise Spotify plays 30-second previews. We detect previews and say so.
// - The embedded player has no volume control. So "Music / game balance" turns the GAME down
//   while music plays (the music stays at your system volume); 0% pauses the music.
// - Some pages block other sites' frames (the claude.ai page may). Then music shows as
//   unavailable there; the downloaded game (play/ApexPursuit.html) is unaffected.
// ─────────────────────────────────────────────────────────────────────────────
import { PLAYLIST, PLAYLIST_URL, TrackInfo } from './playlist';

interface EmbedController {
  loadUri(uri: string): void;
  play(): void;
  pause(): void;
  resume(): void;
  togglePlay(): void;
  addListener(ev: string, cb: (e: { data: { isPaused: boolean; isBuffering?: boolean; position: number; duration: number } }) => void): void;
  destroy?(): void;
}
interface IFrameAPI {
  createController(el: HTMLElement, opts: { uri: string; width?: number | string; height?: number | string }, cb: (c: EmbedController) => void): void;
}

export type MusicState = 'off' | 'loading' | 'ready' | 'playing' | 'paused' | 'unavailable';

export class MusicPlayer {
  state: MusicState = 'off';
  /** Spotify is playing 30-second previews (browser not signed in to Spotify Premium) */
  preview = false;
  current: TrackInfo | null = null;
  position = 0; // ms
  duration = 0; // ms
  /** called when a new track starts (the HUD shows the card) */
  onTrack: (t: TrackInfo) => void = () => {};
  onState: () => void = () => {};

  private ctrl: EmbedController | null = null;
  private order: number[] = [];
  private at = -1;
  private wantPlay = false;
  private lastProgressAt = 0;
  private host: HTMLDivElement | null = null;
  private advancing = false;

  constructor() {
    this.shuffle();
  }

  get url(): string {
    return PLAYLIST_URL;
  }

  /** Load Spotify's player (once). Safe to call many times; does nothing when disabled. */
  init(): void {
    if (this.state !== 'off') return;
    this.state = 'loading';
    const w = window as unknown as { onSpotifyIframeApiReady?: (api: IFrameAPI) => void };
    w.onSpotifyIframeApiReady = (api) => this.create(api);
    const s = document.createElement('script');
    s.src = 'https://open.spotify.com/embed/iframe-api/v1';
    s.async = true;
    s.onerror = () => this.fail();
    document.head.appendChild(s);
    // a page that blocks the script or the frame never calls back: give up after 15 s
    setTimeout(() => {
      if (this.state === 'loading') this.fail();
    }, 15000);
  }

  private fail(): void {
    this.state = 'unavailable';
    this.onState();
  }

  private create(api: IFrameAPI): void {
    // Spotify's compact player sits in the #music card (index.html); it stays visible, small
    const holder = document.getElementById('music-frame');
    if (!holder) return this.fail();
    const el = document.createElement('div');
    holder.appendChild(el);
    this.host = el as HTMLDivElement;
    const first = this.trackAt(this.next1());
    api.createController(el, { uri: `spotify:track:${first[0]}`, width: 300, height: 80 }, (c) => {
      this.ctrl = c;
      this.current = first;
      this.state = 'ready';
      c.addListener('ready', () => {
        if (this.wantPlay) c.play();
      });
      c.addListener('playback_update', (e) => this.progress(e.data));
      this.onState();
      if (this.wantPlay) this.play();
    });
  }

  private progress(d: { isPaused: boolean; isBuffering?: boolean; position: number; duration: number }): void {
    this.position = d.position;
    this.duration = d.duration;
    this.lastProgressAt = performance.now();
    if (this.current && d.duration > 0) this.preview = d.duration < 31000 && this.current[3] > 45;
    const was = this.state;
    this.state = d.isPaused ? (this.wantPlay ? this.state : 'paused') : 'playing';
    if (!d.isPaused && was !== 'playing' && this.current) this.onTrack(this.current);
    // end of track → next (the embed would otherwise stop)
    if (d.duration > 0 && d.position >= d.duration - 600 && !this.advancing && this.wantPlay) {
      this.advancing = true;
      setTimeout(() => {
        this.advancing = false;
        this.next();
      }, 300);
    }
    if (was !== this.state) this.onState();
  }

  private shuffle(): void {
    this.order = PLAYLIST.map((_, i) => i);
    for (let i = this.order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    }
    this.at = -1;
  }

  private next1(): number {
    this.at++;
    if (this.at >= this.order.length) {
      this.shuffle();
      this.at = 0;
    }
    return this.order[this.at];
  }

  private trackAt(i: number): TrackInfo {
    return PLAYLIST[i];
  }

  /** Start or resume (needs a click/key first: browsers block sound before that). */
  play(): void {
    this.wantPlay = true;
    this.lastProgressAt = performance.now();
    if (this.state === 'off') return this.init();
    if (!this.ctrl) return;
    if (this.state === 'paused') this.ctrl.resume();
    else this.ctrl.play();
  }

  pause(): void {
    this.wantPlay = false;
    this.ctrl?.pause();
    if (this.ctrl) this.state = 'paused';
    this.onState();
  }

  /** Skip to the next track in the shuffle (L3 + R3, or M). */
  next(): void {
    if (!this.ctrl) return;
    const t = this.trackAt(this.next1());
    this.current = t;
    this.position = 0;
    this.wantPlay = true;
    this.lastProgressAt = performance.now();
    this.ctrl.loadUri(`spotify:track:${t[0]}`);
    this.ctrl.play();
    this.onTrack(t);
  }

  /** watchdog: a track that never starts (region-locked, removed) is skipped */
  tick(): void {
    if (!this.ctrl || !this.wantPlay || this.state === 'unavailable') return;
    if (this.state !== 'playing' && this.lastProgressAt && performance.now() - this.lastProgressAt > 12000) {
      this.lastProgressAt = performance.now();
      this.next();
    }
  }

  dispose(): void {
    this.ctrl?.destroy?.();
    this.host?.remove();
  }
}
