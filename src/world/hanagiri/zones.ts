// ─────────────────────────────────────────────────────────────────────────────
// Hanagiri zones (5C) — the lap as a journey through different places.
//
//   village       km 0.0–1.2 and 9.4–10.1   quiet houses, the stream and its bridge, cherry trees
//   forest        km 1.2–3.3                 the only enclosed stretch: a dense spruce corridor
//   switchbacks   km 3.3–5.2                 open slopes, scattered trees, snow fences, the gallery
//   summit        km 5.2–6.6                 above the tree line: the pass, the hut, the shrine
//   cliff         km 6.6–8.2                 a road cut along a dark rock face, the tunnel
//   valley        km 8.2–9.4                 an open valley under one giant mountain face
//
// Pure logic (no three.js): the venue places trees and features with it, the dressing builds
// with it, and the benchmark reports frame times by it.
// ─────────────────────────────────────────────────────────────────────────────
import { WORLD } from '../../config';
import type { WorldData } from '../WorldData';

export type ZoneId = 'village' | 'forest' | 'switchbacks' | 'summit' | 'cliff' | 'valley';

export interface Zone {
  id: ZoneId;
  name: string;
  /** lap distance from the start line, km */
  from: number;
  to: number;
}

export const ZONES: Zone[] = [
  { id: 'village', name: 'Village', from: 0, to: 1.2 },
  { id: 'forest', name: 'Forest climb', from: 1.2, to: 3.3 },
  { id: 'switchbacks', name: 'Switchbacks', from: 3.3, to: 5.2 },
  { id: 'summit', name: 'High pass', from: 5.2, to: 6.6 },
  { id: 'cliff', name: 'Cliff descent', from: 6.6, to: 8.2 },
  { id: 'valley', name: 'Valley sweepers', from: 8.2, to: 9.4 },
  { id: 'village', name: 'Village', from: 9.4, to: 99 },
];

/** The zone at a lap distance (km from the start line). */
export function zoneAtKm(km: number): Zone {
  for (const z of ZONES) if (km >= z.from && km < z.to) return z;
  return ZONES[0];
}

/** Lap distance (km) of a sample index. */
export function kmOf(world: WorldData, index: number): number {
  const N = world.samples.length;
  return ((((index - world.startIndex) % N) + N) % N) * WORLD.sampleSpacing / 1000;
}

/** The zone of the nearest stretch of road to a point (and how far off the road it is). */
export function zoneOf(world: WorldData, x: number, z: number): { zone: Zone; km: number; off: number; index: number } {
  const hit = world.nearestTrack(x, z);
  const index = hit ? hit.index : world.startIndex;
  const km = kmOf(world, index);
  return { zone: zoneAtKm(km), km, off: hit ? Math.abs(hit.offset) : 1e9, index };
}

/** Sample index at a lap distance (km). */
export function indexAtKm(world: WorldData, km: number): number {
  const N = world.samples.length;
  return (world.startIndex + Math.round((km * 1000) / WORLD.sampleSpacing)) % N;
}

/**
 * How much a zone is "itself" at a lap distance: 1 inside, easing over `blend` km at each end,
 * so the forest thins into the slopes instead of stopping at a line.
 */
export function zoneWeight(km: number, id: ZoneId, blend = 0.15): number {
  let w = 0;
  for (const z of ZONES) {
    if (z.id !== id) continue;
    const a = Math.min(1, Math.max(0, (km - (z.from - blend)) / (2 * blend)));
    const b = Math.min(1, Math.max(0, (z.to + blend - km) / (2 * blend)));
    w = Math.max(w, Math.min(a, b));
  }
  return w;
}

/**
 * 5D: the sakura tunnels: stretches where big old cherry trees lean in over the road from both
 * sides and their petals carpet the tarmac (bare and snow-laden in the Snow weather).
 */
export const SAKURA_TUNNELS: { from: number; to: number }[] = [
  { from: 0.32, to: 0.82 }, // out of the village, past the houses
  { from: 8.48, to: 8.98 }, // the valley floor
  { from: 9.52, to: 9.98 }, // the run back into the village
];

/** 0..1 how deep into a sakura tunnel a lap distance is (fades over `fade` km at each end) */
export function sakuraAt(km: number, fade = 0.06): number {
  let k = 0;
  for (const t of SAKURA_TUNNELS) {
    const a = Math.min(km - t.from, t.to - km) / fade;
    if (a > -1) k = Math.max(k, Math.min(1, Math.max(0, a + 1) / 2) ** 1.5);
  }
  return k;
}
