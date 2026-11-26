// ─────────────────────────────────────────────────────────────────────────────
// Cars — the car-select catalogue and the player's garage customisation.
//
// Every entry is a CarModel (the 3D model + base physics) offered as one or more Editions
// (livery + a small tuning difference). Today there is one model, the Phantom X1, in four
// editions. A new model is one more entry in CAR_MODELS plus its editions.
//
// 4.5: imported cars. A car pack next to the game (cars/cars.js, made by tools/car-import) adds
// models with visual 'imported' and their editions at start-up (registerImportedCar). Packs are
// personal like music packs: cars/ is git-ignored, and a friend without the pack sees a Phantom X1
// in your place online.
// ─────────────────────────────────────────────────────────────────────────────
import { PAINTS, STABILITY, StabilityMode, VEHICLE } from '../config';

export type VehicleParams = typeof VEHICLE;
export type Finish = 'gloss' | 'matte' | 'metallic' | 'pearl';

export interface CarModel {
  id: string;
  name: string;
  /** builds the visual; kept as a string id so this file has no rendering imports */
  visual: 'phantom-x1' | 'imported';
  /** imported cars: maker and year for the card ('' for the house car) */
  maker?: string;
  year?: number;
}

export interface Edition {
  id: string;
  model: string;
  name: string; // shown on the card
  tagline: string;
  number: number; // race number shown on the card
  /** default livery */
  paint: number;
  finish: Finish;
  rim: number;
  caliper: number;
  underglow: number; // 0 = off
  /** multipliers / overrides applied on top of the base VEHICLE values */
  tune: Partial<Record<keyof VehicleParams, number>>;
  /** Speed Points needed to unlock (0 = available from the start) */
  unlock: number;
  /** imported cars: the factory colour (overrides the paint swatch's colour) */
  color?: number;
}

export const CAR_MODELS: CarModel[] = [{ id: 'phantom-x1', name: 'Phantom X1', visual: 'phantom-x1' }];

export const EDITIONS: Edition[] = [
  {
    id: 'x1-street', model: 'phantom-x1', name: 'Street', tagline: 'Balanced. The car as drawn.', number: 1,
    paint: 0, finish: 'pearl', rim: 0x1b1c20, caliper: 0xc8141c, underglow: 0, tune: {}, unlock: 0,
  },
  {
    id: 'x1-sport', model: 'phantom-x1', name: 'Sport', tagline: 'More grip and downforce, less top speed.', number: 7,
    paint: 2, finish: 'metallic', rim: 0x101012, caliper: 0xd4a72c, underglow: 0,
    tune: { gripAsphalt: 1.06, downforce: 1.25, dragCoef: 1.07, driftSustain: 0.85 }, unlock: 0,
  },
  {
    id: 'x1-nitro', model: 'phantom-x1', name: 'Nitro', tagline: 'Bigger nitrous tank, lighter rear end.', number: 22,
    paint: 3, finish: 'metallic', rim: 0x15171c, caliper: 0x34d6e0, underglow: 0x2ad8ff,
    tune: { nitroBurn: 0.72, nitroRegen: 1.3, nitroTorque: 1.25, gripAsphalt: 0.96, driftSustain: 1.15 }, unlock: 0,
  },
  {
    id: 'x1-pursuit', model: 'phantom-x1', name: 'Pursuit', tagline: 'Heavier and harder to push around.', number: 44,
    paint: 1, finish: 'matte', rim: 0x0c0c0d, caliper: 0xf07818, underglow: 0,
    tune: { mass: 1.16, yawInertia: 1.14, torque: 1.05, carRestitution: 0.7, dragCoef: 1.06 }, unlock: 0,
  },
];

export const FINISHES: { id: Finish; name: string; metalness: number; roughness: number; clearcoat: number }[] = [
  { id: 'gloss', name: 'Gloss', metalness: 0.15, roughness: 0.28, clearcoat: 1 },
  { id: 'metallic', name: 'Metallic', metalness: 0.75, roughness: 0.32, clearcoat: 1 },
  { id: 'pearl', name: 'Pearl', metalness: 0.4, roughness: 0.3, clearcoat: 1 },
  { id: 'matte', name: 'Matte', metalness: 0.45, roughness: 0.68, clearcoat: 0.04 },
];

export const RIM_COLOURS = [0x1b1c20, 0xb9bcc2, 0x8a6a2e, 0xe9ebee, 0x2a2f3a, 0x101012];
export const CALIPER_COLOURS = [0xc8141c, 0xd4a72c, 0x34d6e0, 0xf07818, 0x6fd630, 0xe9ebee, 0x1b1c20];
export const UNDERGLOW_COLOURS = [0, 0x2ad8ff, 0xff2a4a, 0x8b5cff, 0x5cff8b, 0xffffff];

/** The player's chosen car and how it looks. */
export interface Loadout {
  edition: string;
  /** null = the edition's default */
  paint: number | null;
  customColor: number | null; // custom picker colour; overrides `paint` when set
  finish: Finish | null;
  rim: number | null;
  caliper: number | null;
  underglow: number | null;
}

export const defaultLoadout = (): Loadout => ({ edition: EDITIONS[0].id, paint: null, customColor: null, finish: null, rim: null, caliper: null, underglow: null });

/** An imported car as described by its pack (window.__APEX_CARS__ entries, minus the model data). */
export interface ImportedCarInfo {
  id: string;
  name: string;
  maker?: string;
  year?: number;
  /** handling: multipliers on the base car, shared by all its editions */
  tune?: Partial<Record<keyof VehicleParams, number>>;
  editions: Partial<Edition>[];
}

/** Add an imported model and its editions to the catalogue (once, at start-up). */
export function registerImportedCar(info: ImportedCarInfo): void {
  const id = String(info.id).replace(/[^a-z0-9-]/gi, '').slice(0, 24);
  if (!id || CAR_MODELS.some((m) => m.id === id)) return;
  CAR_MODELS.push({ id, name: String(info.name).slice(0, 40), visual: 'imported', maker: info.maker?.slice(0, 30), year: info.year });
  const safeTune = (t?: Partial<Record<string, number>>): Partial<Record<keyof VehicleParams, number>> => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(t ?? {})) if (k in VEHICLE && typeof v === 'number' && Number.isFinite(v) && v > 0.2 && v < 5) out[k] = v;
    return out as Partial<Record<keyof VehicleParams, number>>;
  };
  const base = safeTune(info.tune);
  (info.editions.length ? info.editions : [{}]).forEach((e, k) => {
    const eid = `${id}-${String(e.id ?? k).replace(/[^a-z0-9-]/gi, '').slice(0, 16)}`;
    if (EDITIONS.some((x) => x.id === eid)) return;
    const tune = { ...base };
    for (const [key, m] of Object.entries(safeTune(e.tune))) tune[key as keyof VehicleParams] = (tune[key as keyof VehicleParams] ?? 1) * m;
    EDITIONS.push({
      id: eid, model: id, name: String(e.name ?? info.name).slice(0, 24), tagline: String(e.tagline ?? '').slice(0, 80), number: e.number ?? 9,
      paint: Math.max(0, Math.min(PAINTS.length - 1, e.paint ?? 0)), finish: e.finish ?? 'gloss', rim: e.rim ?? 0x1b1c20, caliper: e.caliper ?? 0xc8141c,
      underglow: e.underglow ?? 0, tune, unlock: 0, color: e.color,
    });
  });
}

export function modelOf(editionId: string): CarModel {
  const e = EDITIONS.find((x) => x.id === editionId);
  return CAR_MODELS.find((m) => m.id === e?.model) ?? CAR_MODELS[0];
}

export function editionById(id: string): Edition {
  return EDITIONS.find((e) => e.id === id) ?? EDITIONS[0];
}

/** Resolved look of a car: everything the renderer needs. */
export interface CarLook {
  color: number;
  finish: Finish;
  rim: number;
  caliper: number;
  underglow: number;
  paintIndex: number; // nearest factory paint (for online colour clashes and minimap)
}

export function lookOf(l: Loadout): CarLook {
  const e = editionById(l.edition);
  const paintIndex = l.paint ?? e.paint;
  return {
    color: l.customColor ?? (l.paint === null && e.color !== undefined ? e.color : PAINTS[paintIndex].color),
    finish: l.finish ?? e.finish,
    rim: l.rim ?? e.rim,
    caliper: l.caliper ?? e.caliper,
    underglow: l.underglow ?? e.underglow,
    paintIndex,
  };
}

/** The look of a car known only by its factory paint and edition (AI rivals, remote players). */
export function lookFromPaint(paint: number, editionId = EDITIONS[0].id): CarLook {
  const e = editionById(editionId);
  return { color: PAINTS[paint].color, finish: PAINTS[paint].metalness > 0.6 ? 'metallic' : PAINTS[paint].roughness > 0.5 ? 'matte' : 'gloss', rim: e.rim, caliper: e.caliper, underglow: 0, paintIndex: paint };
}

export interface DriverAids {
  stability: StabilityMode;
  tractionControl: boolean;
  brakeAssist: boolean;
}
export const EXPERT_AIDS: DriverAids = { stability: 'expert', tractionControl: false, brakeAssist: false };

/**
 * Vehicle values for a car: base car → stability preset (absolute values) → edition tuning
 * (multipliers) → driver aids. With the default (Expert, aids off) this is the Stage 2 car.
 */
export function tunedVehicle(editionId: string, aids: DriverAids = EXPERT_AIDS): VehicleParams {
  const e = editionById(editionId);
  const v = { ...VEHICLE, ...STABILITY[aids.stability] } as Record<string, unknown>;
  v.tractionControl = aids.tractionControl ? 1 : 0;
  v.brakeAssist = aids.brakeAssist ? 1 : 0;
  for (const [k, m] of Object.entries(e.tune)) {
    if (typeof v[k] === 'number' && typeof m === 'number') v[k] = (v[k] as number) * m;
  }
  return v as VehicleParams;
}

/** 0..1 stat bars for the car-select card, computed from the tuned values. */
export function statsOf(editionId: string): { power: number; topSpeed: number; grip: number; nitro: number; weight: number } {
  const t = tunedVehicle(editionId);
  const b = VEHICLE;
  const topRel = Math.sqrt((t.torque / t.mass / (b.torque / b.mass)) * (b.dragCoef / t.dragCoef));
  return {
    power: Math.min(1, 0.72 * ((t.torque / t.mass) / (b.torque / b.mass))),
    topSpeed: Math.min(1, 0.74 * topRel),
    grip: Math.min(1, 0.7 * (t.gripAsphalt / b.gripAsphalt) * (1 + 0.15 * (t.downforce / b.downforce - 1))),
    nitro: Math.min(1, 0.6 * (b.nitroBurn / t.nitroBurn) ** 0.8 * (t.nitroTorque / b.nitroTorque) ** 0.3),
    weight: Math.min(1, 0.62 * (t.mass / b.mass)),
  };
}
