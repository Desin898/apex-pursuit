// ─────────────────────────────────────────────────────────────────────────────
// Ground (5A) — the height of the land under any point, for everything that stands on it.
// The Proving Grounds is flat: 0 everywhere (ramps are physics-only, as before). A mountain venue
// (Hanagiri Pass) sets its road and terrain heights here when its WorldData is built, so props,
// police roadblocks, lights, skid marks and the dressing all sit on the slope without each of
// them needing to know which venue is loaded. No three.js: the headless tests use it too.
// ─────────────────────────────────────────────────────────────────────────────

let fn: (x: number, z: number) => number = () => 0;

/** Height of the ground (road or land) at x, z. */
export function groundHeight(x: number, z: number): number {
  return fn(x, z);
}

/** Set by WorldData for the loaded venue. */
export function setGroundHeight(f: (x: number, z: number) => number): void {
  fn = f;
}
