// ─────────────────────────────────────────────────────────────────────────────
// Race pacing (5B.1) — lap choices and the Pursuit schedule, set by how long a lap is.
//
// A Proving Grounds lap is 3.3 km: races are 3, 5 or 8 laps, cameras go live on lap 2 and the
// police join at 40 % of the race (lap 2 of 3, lap 3 of 5, lap 4 of 8), as before.
// A Hanagiri lap is 10 km: races are 1, 2 or 3 laps, cameras go live a quarter of the way round
// lap 1, and the police join halfway round lap 1 (1 or 2 laps) or at the start of lap 2 (3 laps).
// Distances are race distance in laps (1.5 = halfway round lap 2). Pure functions: the online
// host, its guests and the HUD all work the schedule out the same way.
// ─────────────────────────────────────────────────────────────────────────────
import { POLICE } from '../config';

/** a lap this long or longer counts as a long (mountain) lap */
const LONG_LAP = 6000;

export function lapChoices(lapLength: number): number[] {
  return lapLength >= LONG_LAP ? [1, 2, 3] : [3, 5, 8];
}

export function defaultLaps(lapLength: number): number {
  return lapLength >= LONG_LAP ? 2 : 3;
}

/** a lap count that suits this lap (the nearest choice if it doesn't fit) */
export function fitLaps(lapLength: number, laps: number): number {
  const c = lapChoices(lapLength);
  if (c.includes(laps)) return laps;
  return lapLength >= LONG_LAP ? defaultLaps(lapLength) : c.reduce((a, b) => (Math.abs(b - laps) < Math.abs(a - laps) ? b : a));
}

export interface PursuitPacing {
  /** race distance (laps) when the speed cameras and work zones go live */
  traps: number;
  /** race distance (laps) when the police leave the pits */
  join: number;
}

export function pursuitPacing(lapLength: number, laps: number): PursuitPacing {
  const n = Math.max(1, laps);
  if (lapLength >= LONG_LAP) return { traps: 0.25, join: n >= 3 ? 1 : 0.5 };
  return { traps: 1, join: Math.max(1, Math.floor(POLICE.joinAt * n)) };
}

/** how the HUD and the event card say when the police join */
export function joinText(p: PursuitPacing): string {
  const lap = Math.floor(p.join) + 1;
  const frac = p.join - Math.floor(p.join);
  if (frac > 0.01) return `halfway round lap ${lap}`;
  return `on lap ${lap}`;
}
