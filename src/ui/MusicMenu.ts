// ─────────────────────────────────────────────────────────────────────────────
// MusicMenu (4D.1) — the music page (laid out like a football game's soundtrack screen) and
// the small "Now playing" line on the home screen.
//
//  left   a grid of every track: cover, title, artist and a tick (in the rotation or not)
//  right  the selected track, big, with Play now / Play·Stop / All on·off / Add music and the
//         music volume
//  bottom what's playing now, with a progress bar
//
// Controls on this page: ✕ / Enter play the selected track now (the rotation carries on after
// it), R1 / X tick or untick it, □ / T all on or off, △ / Y play or stop, L3 + R3 / M skip,
// ○ / Esc back. On home, △ / Tab (or a click on the Now playing line) opens it.
// ─────────────────────────────────────────────────────────────────────────────
import { Actions, DeviceKind } from '../input/InputManager';
import { MusicLibrary, Track } from '../audio/MusicLibrary';
import { Settings } from '../core/Settings';
import { Nav } from './Nav';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const time = (s: number) => (Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––');

/** button names for the music controls on each device */
export function musicKeys(k: DeviceKind): { play: string; all: string; tick: string; skip: string; open: string; ok: string; back: string } {
  if (k === 'playstation') return { play: '△', all: '□', tick: 'R1', skip: 'L3 + R3', open: '△', ok: '✕', back: '○' };
  if (k === 'xbox' || k === 'generic') return { play: 'Y', all: 'X', tick: 'RB', skip: 'LS + RS', open: 'Y', ok: 'A', back: 'B' };
  return { play: 'Y', all: 'T', tick: 'X', skip: 'M', open: 'Tab', ok: 'Enter', back: 'Esc' };
}

/** a cover for tracks that have none: a colour from the title and its initials */
function placeholder(t: Track): string {
  let h = 0;
  for (const c of t.title + t.artist) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const ini = (t.title.replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('') || '♪').toUpperCase();
  return `style="background:linear-gradient(135deg,hsl(${hue} 45% 32%),hsl(${(hue + 50) % 360} 55% 18%))"><em>${esc(ini)}</em`;
}
function cover(t: Track | null, cls: string): string {
  if (!t) return `<span class="${cls} none"><em>♪</em></span>`;
  return t.cover ? `<span class="${cls}" style="background-image:url('${t.cover.replace(/'/g, '%27')}')"></span>` : `<span class="${cls}" ${placeholder(t)}></span>`;
}

export class MusicMenu {
  readonly nav: Nav;
  private selected: string | null = null;
  private device: DeviceKind = 'keyboard';
  private shownAt = 0;
  private builtFor = '';
  private sideFor = '';
  private busy = false;

  constructor(
    private lib: MusicLibrary,
    private s: Settings,
    private save: () => void,
    private sound: (k: 'move' | 'accept' | 'back') => void,
    private toast: (msg: string) => void,
  ) {
    this.nav = new Nav($('music'));
    this.nav.onMove = () => this.sound('move');
    // file pickers and dropping files on the window
    const pick = (input: HTMLInputElement) => {
      input.addEventListener('change', () => {
        const files = Array.from(input.files ?? []);
        input.value = '';
        void this.addFiles(files);
      });
    };
    pick($('m-files') as HTMLInputElement);
    pick($('m-folder') as HTMLInputElement);
    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      void this.addFiles(files);
    });
    $('np').addEventListener('click', () => this.openRequest());
    lib.onTrack = () => (this.shownAt = performance.now());
  }

  /** set by Screens: open the music page */
  openRequest: () => void = () => {};

  setDevice(k: DeviceKind): void {
    this.device = k;
    this.builtFor = '';
  }

  private async addFiles(files: File[]): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.toast('Adding music…');
    try {
      const n = await this.lib.add(files);
      this.toast(n ? `Added ${n} track${n === 1 ? '' : 's'} · kept in this browser` : 'No new music files there (MP3, M4A, OGG, WAV, FLAC)');
    } catch {
      this.toast("Couldn't keep that music in this browser (storage is blocked or full)");
    } finally {
      this.busy = false;
    }
  }

  // ── the page ─────────────────────────────────────────────────────────────
  open(): void {
    this.builtFor = '';
    this.sideFor = '';
    if (!this.selected || !this.lib.tracks.some((t) => t.id === this.selected)) this.selected = this.lib.current?.id ?? this.lib.tracks[0]?.id ?? null;
    this.render();
    const tile = this.selected ? ($('m-grid').querySelector(`[data-id="${CSS.escape(this.selected)}"]`) as HTMLElement | null) : null;
    requestAnimationFrame(() => this.nav.reset(tile ?? ($('m-addfiles') as HTMLElement)));
  }

  private key(): string {
    const l = this.lib;
    return `${l.tracks.map((t) => t.id + (l.off.has(t.id) ? '0' : '1')).join('|')}#${l.current?.id ?? ''}#${l.state}#${this.device}`;
  }

  /** rebuild what changed (called every frame while the page is open) */
  render(): void {
    const l = this.lib;
    const k = this.key();
    if (k !== this.builtFor) {
      this.builtFor = k;
      const grid = $('m-grid');
      const focusId = (this.nav.focused?.dataset.id as string | undefined) ?? null;
      if (!l.tracks.length) {
        grid.innerHTML = `<div class="m-empty"><b>No music yet</b><span>Add your own MP3s (files or a whole folder), or drop them on this window. They stay in this browser, so it's a one-time step.</span></div>`;
      } else {
        grid.innerHTML = l.tracks
          .map((t) => {
            const on = !l.off.has(t.id);
            const now = l.current?.id === t.id;
            return `<button type="button" class="mt${on ? '' : ' off'}${now ? ' now' : ''}" data-nav data-id="${esc(t.id)}" aria-pressed="${on}">${cover(t, 'cv')}<i class="tk" title="In the rotation">${on ? '✓' : ''}</i>${now && l.state === 'playing' ? '<span class="eq"><i></i><i></i><i></i></span>' : ''}<b>${esc(t.title)}</b><small>${esc(t.artist)}</small></button>`;
          })
          .join('');
        grid.querySelectorAll<HTMLElement>('.mt').forEach((b) => {
          b.addEventListener('click', (e) => {
            const id = b.dataset.id!;
            if ((e.target as HTMLElement).closest('.tk')) this.tick(id);
            else this.playNow(id);
          });
        });
        if (focusId) {
          const again = grid.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusId)}"]`);
          if (again) {
            this.nav.focused = null;
            this.nav.focus(again, false);
          }
        }
      }
      const on = l.enabled.length;
      $('m-count').textContent = l.tracks.length ? `${l.tracks.length} track${l.tracks.length === 1 ? '' : 's'} · ${on} in the rotation` : 'Your music';
      $('m-play').textContent = l.state === 'playing' ? 'Stop' : 'Play';
      $('m-all').textContent = l.off.size ? 'All on' : 'All off';
      const mk = musicKeys(this.device);
      $('m-prompts').innerHTML = [
        [mk.ok, 'Play now'],
        [mk.tick, 'Tick'],
        [mk.all, 'All on / off'],
        [mk.play, 'Play / stop'],
        [mk.skip, 'Skip'],
        [mk.back, 'Back'],
      ]
        .map(([g, t]) => `<span><kbd>${g}</kbd>${t}</span>`)
        .join('');
      this.sideFor = '';
    }
    // the selected track follows the focus
    const f = this.nav.focused?.dataset.id;
    if (f && f !== this.selected) this.selected = f;
    const sel = l.tracks.find((t) => t.id === this.selected) ?? null;
    const sk = `${sel?.id ?? ''}#${sel ? l.off.has(sel.id) : ''}#${l.current?.id ?? ''}#${l.state}`;
    if (sk !== this.sideFor) {
      this.sideFor = sk;
      const side = $('m-big');
      if (!sel) side.innerHTML = `${cover(null, 'big')}<div class="m-meta"><b>Pick a track</b><small>Add music to fill the list</small></div>`;
      else {
        const on = !l.off.has(sel.id);
        const now = l.current?.id === sel.id;
        side.innerHTML = `${cover(sel, 'big')}<div class="m-meta"><span class="label">${now ? (l.state === 'playing' ? 'Playing now' : 'Stopped') : on ? 'In the rotation' : 'Not in the rotation'}</span><b>${esc(sel.title)}</b><small>${esc(sel.artist)}${sel.album ? ` · ${esc(sel.album)}` : ''}</small><small class="dim">${sel.dur ? time(sel.dur) : ''}${sel.source === 'mine' ? ' · added by you' : ''}</small></div>`;
      }
      $('m-now-btn').textContent = sel && l.current?.id === sel.id && l.state === 'playing' ? 'Playing' : 'Play now';
      $('m-tick-btn').textContent = sel && l.off.has(sel.id) ? 'Add to rotation' : 'Leave out';
    }
    $('m-vol-v').textContent = `${Math.round(this.s.musicVolume * 100)}%`;
    ($('m-vol') as HTMLInputElement).value = String(Math.round(this.s.musicVolume * 100));
    $('m-races-v').textContent = this.s.musicRaces ? 'On' : 'Off';
    this.renderNow();
  }

  private renderNow(): void {
    const l = this.lib;
    const t = l.current;
    const box = $('m-now');
    const k = `${t?.id ?? ''}#${l.state}`;
    if (box.dataset.k !== k) {
      box.dataset.k = k;
      $('m-now-art').innerHTML = cover(t, 'cv');
      $('m-now-t').textContent = t ? `${t.title} — ${t.artist}` : l.tracks.length ? 'Nothing playing' : 'No music yet';
      $('m-now-l').textContent = l.state === 'playing' ? 'Currently playing' : t ? 'Stopped' : 'Music';
    }
    const d = l.duration;
    const p = l.position;
    ($('m-now-bar') as HTMLElement).style.width = d > 0 ? `${Math.min(100, (p / d) * 100)}%` : '0%';
    $('m-now-time').textContent = t ? `${time(Math.max(p, 0.001))} / ${time(d)}` : '';
  }

  private playNow(id: string): void {
    this.sound('accept');
    this.selected = id;
    this.lib.playTrack(id);
  }
  private tick(id: string): void {
    this.sound('move');
    this.lib.setOn(id, this.lib.off.has(id));
    this.persist();
  }
  persist(): void {
    this.s.musicOff = [...this.lib.off];
    this.save();
  }
  setVolume(v: number): void {
    this.s.musicVolume = Math.max(0, Math.min(1, Math.round(v * 20) / 20));
    this.lib.setVolume(this.s.musicVolume);
    this.save();
  }

  /** wire the side buttons once (called by Screens after the page exists) */
  wire(): void {
    $('m-now-btn').addEventListener('click', () => this.selected && this.playNow(this.selected));
    $('m-tick-btn').addEventListener('click', () => this.selected && this.tick(this.selected));
    $('m-play').addEventListener('click', () => (this.sound('accept'), this.lib.toggle()));
    $('m-skip').addEventListener('click', () => (this.sound('accept'), this.lib.next()));
    $('m-all').addEventListener('click', () => (this.sound('accept'), this.lib.toggleAll(), this.persist()));
    $('m-addfiles').addEventListener('click', () => ($('m-files') as HTMLInputElement).click());
    $('m-addfolder').addEventListener('click', () => ($('m-folder') as HTMLInputElement).click());
    $('m-clear').addEventListener('click', () => {
      if (!this.lib.tracks.some((t) => t.source === 'mine')) return this.toast('Nothing added in this browser');
      void this.lib.clearMine().then(() => this.toast('Removed the music you added in this browser'));
    });
    const vol = $('m-volrow');
    vol.addEventListener('adjust', (e) => this.setVolume(this.s.musicVolume + 0.05 * (e as CustomEvent<number>).detail));
    ($('m-vol') as HTMLInputElement).addEventListener('input', (e) => this.setVolume(Number((e.target as HTMLInputElement).value) / 100));
    const races = $('m-races');
    const flip = () => {
      this.s.musicRaces = !this.s.musicRaces;
      this.save();
    };
    races.addEventListener('click', flip);
    races.addEventListener('adjust', flip);
  }

  /** this page's own buttons; returns true when it used the input */
  handle(a: Actions): boolean {
    let used = false;
    if (a.square) {
      this.sound('accept');
      this.lib.toggleAll();
      this.persist();
      used = true;
    }
    if (a.triangle) {
      this.sound('accept');
      this.lib.toggle();
      used = true;
    }
    if (a.tick && this.selected) {
      this.tick(this.selected);
      used = true;
    }
    if (a.musicMenu) {
      this.nav.root.querySelector<HTMLElement>('[data-back]')?.click();
      used = true;
    }
    return used;
  }

  // ── the home screen's Now playing line ───────────────────────────────────
  ticker(home: boolean): void {
    const el = $('np');
    if (!home) return;
    const l = this.lib;
    const t = l.current;
    const mk = musicKeys(this.device);
    const k = `${t?.id ?? ''}#${l.state}#${l.tracks.length}#${this.device}#${l.followingHost}#${l.hostMissing}`;
    if (el.dataset.k !== k) {
      el.dataset.k = k;
      // 4G.2 online: the host's music (or what it is, if we don't have it)
      const label = l.followingHost ? "Host's music" : 'Now playing';
      const line = l.followingHost && l.hostMissing
        ? `<span class="label">Host's music</span><b>${esc(l.hostMissing)}</b><span class="by">not in your music</span>`
        : t && l.state === 'playing' ? `<span class="label">${label}</span><b>${esc(t.title)}</b><span class="by">${esc(t.artist)}</span>` : l.tracks.length ? `<span class="label">Music</span><b>${t ? 'Stopped' : 'Not playing'}</b>` : `<span class="label">Music</span><b>Add your music</b>`;
      el.innerHTML = `<i class="note">♪</i>${line}<kbd>${mk.open}</kbd>`;
      this.shownAt = performance.now();
    }
    el.classList.toggle('quiet', performance.now() - this.shownAt > 6000);
  }
}
