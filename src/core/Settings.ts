// Player settings, remembered per browser (localStorage; silently in-memory if storage is blocked).
import type { Quality } from '../fx/PostFX';
import { defaultLoadout, Loadout } from '../vehicle/Cars';

export interface Settings {
  vibration: boolean;
  vibrationStrength: number; // 0..1
  deadzone: number; // 0..0.25
  steerSensitivity: number; // 0 low, 1 medium, 2 high
  manual: boolean;
  cameraShake: number; // 0..1
  quality: Quality;
  qualityChosen: boolean; // true once the player picks a preset (stops auto-adjust)
  volume: number; // 0..1
  mph: boolean;
  debug: boolean;
  paint: number;
  bestLap: number; // seconds, 0 = none
  rivals: boolean; // race against the AI field, or free run alone
  difficulty: 'easy' | 'medium' | 'hard';
  name: string; // driver name shown to friends online
  loadout: Loadout; // chosen car edition and garage look
  speedPoints: number; // earned by driving: drifts, air, laps, wins
  hudScale: number; // 0.8..1.25
  colourSafe: boolean; // colour-blind-safe police and rival colours
  // driver aids (3C)
  stability: 'arcade' | 'balanced' | 'expert';
  steerAssist: number; // 0 off, 1 low, 2 high
  tractionControl: boolean;
  brakeAssist: boolean;
  // next race (3C)
  laps: number;
  raceType: 'clean' | 'pursuit';
  weather: 'clear' | 'cloudy' | 'rain' | 'random';
  /** 'dynamic': dusk to night over the race */
  timeOfDay: 'dusk' | 'night' | 'dynamic';
  /** rear-view mirror in the hood and bumper cameras */
  mirror: boolean;
  /** replay your best Free run lap as a ghost */
  ghost: boolean;
  /** the police dispatcher reads radio lines aloud (speech synthesis) */
  radioVoice: boolean;
  /** camera to start races in (index into CAMERA_MODES) (4A) */
  camera: number;
  /** show the big rev dial in the cockpit view too (the dash has its own) */
  cockpitDial: boolean;
  /** raindrops on the camera in the outside views: Auto follows the rain (4B.2) */
  lensDrops: 'auto' | 'off';
  /** 4C: tone mapper — Filmic (ACES) or Natural (AgX) */
  toneMap: 'filmic' | 'natural';
  /** 4C: slight colour fringing at the screen edges, like a real lens */
  lensFx: boolean;
  /** 4C.1: screen-space ambient occlusion on Ultra (off by default: it draws the scene twice) */
  ao: boolean;
  /** 4C.2: playlist music (Spotify) on the menus and in races */
  music: boolean;
  /** 4C.2: 0 = game only (music paused) … 1 = music up front (game turned well down) */
  musicBalance: number;
  /** 4C.2: sound mixer, 0..1 each */
  mixEngine: number;
  mixFx: number;
  mixSiren: number;
  /** 4C.2: the last race link joined, and room */
  onlineServer: string;
  onlineRoom: string;
  /** 4D: which venue to race at (switching reloads the world) */
  venue: string;
  /** how hard it rains when it rains: changing over the race, or fixed */
  rainStrength: 'changing' | 'light' | 'heavy' | 'downpour';
  /** dynamic resolution to hold the frame rate */
  target60: boolean;
  /** frame-rate cap */
  fpsCap: '60' | '120' | 'unlimited';
  /** settings migrated to 4B.2 */
  v42?: boolean;
}

const KEY = 'apex-pursuit-settings-v1';
const reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const defaults: Settings = {
  vibration: true,
  vibrationStrength: 1,
  deadzone: 0.08,
  steerSensitivity: 1,
  manual: false,
  cameraShake: reducedMotion ? 0.25 : 1,
  quality: 'high',
  qualityChosen: false,
  volume: 0.8,
  mph: false,
  debug: false,
  paint: 0,
  bestLap: 0,
  rivals: true,
  difficulty: 'medium',
  name: 'Driver ' + Math.floor(10 + Math.random() * 90),
  loadout: defaultLoadout(),
  speedPoints: 0,
  hudScale: 1,
  colourSafe: false,
  stability: 'arcade',
  steerAssist: 1,
  tractionControl: true,
  brakeAssist: true,
  laps: 3,
  raceType: 'clean',
  weather: 'clear',
  timeOfDay: 'dusk',
  mirror: true,
  ghost: true,
  camera: 0,
  cockpitDial: true,
  lensDrops: 'auto',
  toneMap: 'filmic',
  lensFx: true,
  ao: false,
  music: true,
  musicBalance: 0.5,
  mixEngine: 1,
  mixFx: 1,
  mixSiren: 1,
  onlineServer: '',
  onlineRoom: 'friends',
  venue: 'proving-grounds',
  rainStrength: 'changing',
  target60: true,
  fpsCap: '60',
  v42: true,
  radioVoice: true,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...defaults, ...JSON.parse(raw) } as Settings;
      s.loadout = { ...defaultLoadout(), ...(s.loadout || {}) };
      // carry over the Stage 1-2 paint choice into the new garage
      if (s.loadout.paint === null && typeof s.paint === 'number' && s.paint !== 0) s.loadout.paint = s.paint;
      // 4B.2: lens drops come back on (in 4B "off" was only the default, or "light" was chosen)
      if (!s.v42) {
        s.v42 = true;
        s.lensDrops = 'auto';
      }
      return s;
    }
  } catch {
    /* storage unavailable: fall through to defaults */
  }
  return { ...defaults };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** Stick response exponent for each sensitivity step: higher = finer control around centre. */
export const STEER_CURVES = [2.2, 1.6, 1.15];
export const STEER_LABELS = ['Low', 'Medium', 'High'];
