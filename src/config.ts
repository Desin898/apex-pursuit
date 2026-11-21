// ─────────────────────────────────────────────────────────────────────────────
// APEX PURSUIT — tunable parameters
// Everything a designer is likely to tweak lives here. Units are SI (metres, seconds, kg,
// newtons, radians) unless stated otherwise.
// ─────────────────────────────────────────────────────────────────────────────

/** Fixed physics step. Rendering interpolates between steps. 120 Hz keeps the tyre model stable. */
export const PHYSICS_HZ = 120;
export const PHYSICS_DT = 1 / PHYSICS_HZ;

export const VEHICLE = {
  // Chassis
  mass: 1450,
  yawInertia: 2300,
  pitchInertia: 2450,
  rollInertia: 560,
  cgToFront: 1.4, // CG → front axle (also where the 3D model's front axle sits)
  cgToRear: 1.35, // CG → rear axle
  halfTrack: 0.84, // CG → wheel centre, sideways
  wheelRadius: 0.36,
  cgHeightPitch: 0.42, // effective CG height for pitch under accel/braking
  cgHeightRoll: 0.3, // effective CG height for body roll (lower = flatter cornering)

  // Suspension (per wheel values are derived from these in VehiclePhysics)
  staticCompression: 0.075, // spring compression at rest; sets the ride frequency (~1.8 Hz)
  bumpTravel: 0.075, // extra travel before the hard bump stop
  dampingRatio: 0.5,

  // Engine and gearbox
  torque: 980, // peak crank torque, N·m
  idleRpm: 950,
  redlineRpm: 8500,
  upshiftRpm: 7900,
  gearRatios: [3.4, 2.3, 1.75, 1.38, 1.12, 0.93, 0.78],
  reverseRatio: 3.1,
  finalDrive: 3.3,
  driveEfficiency: 0.9,
  shiftTime: 0.11, // torque cut during an upshift
  shiftTorqueCut: 0.12, // share of torque kept during a shift (higher = smoother)

  // Brakes
  brakeDecel: 15, // requested deceleration at full pedal, m/s² (tyres cap the real figure)
  brakeFrontBias: 0.62,
  handbrakeGrip: 0.5, // rear lateral grip multiplier while the handbrake is held
  handbrakeDrag: 0.7, // fraction of rear grip used as drag while locked

  // Tyres
  gripAsphalt: 1.55,
  gripKerb: 1.42,
  gripGrass: 1.08, // raised in 3C so a car on the grass can still turn and drive back on
  gripRunoff: 1.32, // the strip of hard run-off beside the circuit
  runoffWidth: 4.5,
  tyreB: 14, // Pacejka-style stiffness: peak grip at ~7.7° slip
  tyreC: 1.45, // shape: how much grip is kept once sliding (lower = grippier slides)
  tractionBoost: 1.12, // extra longitudinal bite so launches feel punchy
  spinSlideLoss: 0.5, // rear lateral grip lost at full wheelspin
  powerSlide: 0.82, // how strongly throttle eats rear lateral grip (0 = none, 1 = full friction circle)
  brakeSlide: 0.3, // same idea for braking: keep it low so braking into a corner stays stable
  driftSustain: 0.34, // rear grip given up while a drift is being held on throttle + steering
  driftAngleLimit: 0.72, // rad (~41°): slides beyond this are gently caught
  brakeAngleLimit: 0.17, // rad (~10°): the limit under full braking
  driftAngleLimitHandbrake: 1.15, // rad (~66°) while the handbrake is held
  driftCatch: 52000, // N·m per rad of excess angle
  driftDamping: 5200, // extra yaw damping while sliding, N·m per rad/s
  driftAssistFrom: 8, // m/s: below this the assist is off (donuts!)
  brakeUndersteer: 0.74, // front lateral grip given up under hard braking
  loadTransferGrip: 0.55, // 0 = tyres ignore weight transfer, 1 = fully physical
  minSlipSpeed: 3, // slip-angle denominator floor (m/s) for low-speed stability

  // Aero and rolling losses
  dragCoef: 0.6, // F = dragCoef · v²  (sets ~360 km/h top speed)
  downforce: 0.85, // N = downforce · v²
  rollResist: 0.014,
  grassDragBase: 0.55, // m/s² of extra deceleration on grass...
  grassDragSpeed: 0.02, // ...plus this × speed
  looseTraction: 1.35, // traction multiplier on grass at walking pace, fading out by 15 m/s

  // Steering
  steerMax: 34 * (Math.PI / 180),
  steerGripRef: 15.5, // lateral accel (m/s²) the speed-sensitive steering limit is sized for
  steerGain: 1.4,
  steerBase: 0.05,
  steerRateDigital: 3.6, // keyboard: lock units per second when turning in
  steerReturnDigital: 6.5, // keyboard: when letting go
  steerRateAnalog: 11, // stick: just enough smoothing to hide jitter
  steerRateSpeedDrop: 0, // 0..1 how much slower the keyboard steering rate gets at high speed
  counterSteerAssist: 0.55, // 0..1 automatic opposite lock while sliding
  yawDamping: 900, // N·m per rad/s

  // Nitrous
  nitroTorque: 0.25, // +25 % engine torque
  nitroAccel: 3.4, // extra direct thrust at low speed, m/s²...
  nitroFadeSpeed: 116, // ...fading to zero at this speed (m/s), which caps nitrous top speed
  nitroDragScale: 0.9,
  nitroBurn: 0.2, // tank fraction per second (≈5 s full burn)
  nitroRegen: 0.04, // passive refill per second
  nitroRegenDrift: 0.1, // extra refill per second at full drift
  nitroRegenAir: 0.18, // extra refill per second of air time
  nitroMinToFire: 0.08,
  nitroRamp: 0, // seconds for nitrous to build to full effect (0 = instant)

  // Driver aids (set from the player's settings; AI cars use the defaults)
  tractionControl: 0, // 0 off, 1 on: limits wheelspin and power oversteer
  brakeAssist: 0, // 0 off, 1 on: keeps the car straight and steerable under hard braking

  // Air control (keeps jumps landable)
  airPitchSpring: 30,
  airPitchDamp: 10,

  // Slipstream
  draftDrag: 0.32, // share of aero drag removed when tucked right behind another car
  draftRange: 38, // metres behind a car that its wake reaches

  // Collisions
  carRadius: 0.93, // body circle radius used for car-to-car contact
  carRestitution: 0.22,
  carFriction: 0.18,
  carYawKick: 0.45, // how much of a contact's spin is applied (lower = more forgiving)
  bodyRadius: 0.98,
  bodyCircleOffsets: [1.42, 0, -1.4],
  wallRestitution: 0.18,
  wallFriction: 0.28,
};

export const CAMERA = {
  fovBase: 58,
  fovSpeed: 20, // added at top speed
  fovNitro: 13,
  chaseDistance: 6.1, // Chase near
  chaseHeight: 1.75,
  chaseDistanceSpeed: 1.5, // pulls back this much at top speed
  chaseYawLag: 4.2, // higher = snappier
  farDistance: 8.8, // Chase far (Phase 4A)
  farHeight: 2.55,
  farDistanceSpeed: 2.2,
  farYawLag: 3.3,
  farFov: -3, // added to the field of view
  hoodFov: 4,
  bumperFov: 10,
  bumperRumble: 0.006, // metres of road-texture vibration at top speed
  cockpitFov: 64, // the cockpit has its own field of view (it widens less with speed)
  cockpitFovSpeed: 7,
  cockpitNear: 0.05, // near plane inside the car
  headLean: 0.012, // metres of head lean per m/s² sideways
  headPitch: 0.0035, // rad of head nod per m/s² braking / accelerating
  headLimit: 0.06,
  lookSideCar: 1.45, // rad the head turns for look left / right in the car views
  lookSideChase: 1.5708, // rad the chase camera swings round for look left / right
  lookStickCar: 1.45, // rad at full right-stick deflection in the car views
  lookStickChase: 2.4,
  mouseLook: 0.006, // rad per pixel of right-button drag
  probeMargin: 0.45, // metres the chase camera keeps in front of a wall it would go behind
  chaseVelocityBlend: 0.6, // how much the chase cam follows the travel direction in a drift
  shakeSpeed: 0.05,
  shakeNitro: 0.06,
  shakeGrass: 0.06,
};

export const HAPTICS = {
  tickMs: 45, // how often a fresh rumble frame is sent to the pad
  engineIdle: 0.03,
  engineGain: 0.14,
  slipGain: 0.75,
  nitroGain: 0.55,
  impactGain: 1.0,
  roughGrass: 0.42,
  roughKerb: 0.7,
  speedBuzzFrom: 70, // m/s (≈250 km/h)
};

/** Track + facility dimensions used by both WorldData (collision) and WorldBuilder (visuals). */
export const WORLD = {
  trackHalfWidth: 7,
  kerbWidth: 1.4,
  runoffWidth: 3.6, // hard run-off strip beyond the kerb line (both sides)
  sampleSpacing: 2,
  boundsCenterX: -20,
  boundsCenterZ: 90,
  boundsRadius: 660,
};

export const PAINTS: { name: string; color: number; metalness: number; roughness: number; clearcoat: number }[] = [
  { name: 'Pearl White', color: 0xe9ebee, metalness: 0.35, roughness: 0.32, clearcoat: 1 },
  { name: 'Gunmetal', color: 0x3c4148, metalness: 0.85, roughness: 0.34, clearcoat: 1 },
  { name: 'Racing Red', color: 0xc20f17, metalness: 0.45, roughness: 0.3, clearcoat: 1 },
  { name: 'Electric Blue', color: 0x0b4fd6, metalness: 0.7, roughness: 0.3, clearcoat: 1 },
  { name: 'Signal Yellow', color: 0xf2bf10, metalness: 0.3, roughness: 0.34, clearcoat: 1 },
  { name: 'Matte Black', color: 0x15161a, metalness: 0.5, roughness: 0.62, clearcoat: 0.05 },
  { name: 'Midnight Purple', color: 0x3a1470, metalness: 0.8, roughness: 0.3, clearcoat: 1 },
  { name: 'Lime Green', color: 0x74d40e, metalness: 0.35, roughness: 0.32, clearcoat: 1 },
];

/** AI rivals. A difficulty level sets how much of the car's grip and power a driver dares to use. */
export const AI = {
  gridSize: 8,
  // grip: share of the cornering budget used; power: throttle ceiling; nitro: allowed to use it
  levels: {
    easy: { grip: 0.62, power: 0.8, nitro: false },
    medium: { grip: 0.72, power: 0.92, nitro: true },
    hard: { grip: 0.81, power: 1, nitro: true },
  },
  maxGrip: 0.84, // hard ceiling on grip use, including the rubber band (beyond this cars run wide)
  cornerGrip: 12.9, // base lateral acceleration budget, m/s² (before skill and downforce)
  downforceGain: 0.0004, // extra corner speed allowance from downforce (1/m)
  brakeDecel: 10.5, // m/s² the speed profile assumes when planning braking points
  topSpeed: 104, // m/s cap on the planned speed
  lookAheadBase: 5.5, // metres
  lookAheadSpeed: 0.34, // + this × speed
  steerGain: 2.9,
  steerFullLockAccel: 27, // lateral m/s² that one full unit of steering input roughly corresponds to
  laneRate: 4.2, // m/s: how quickly a car moves sideways to pass or defend
  passGap: 2.7, // sideways room wanted when passing
  rubberBand: 0.035, // max ± speed adjustment based on the gap to the player (mild)
  rubberBandGap: 220, // metres of gap at which the full adjustment applies
  mistakeEvery: [22, 46], // seconds between small errors (min, max)
  stuckTime: 2.2, // seconds of no progress before reversing out
  respawnTime: 7, // seconds stuck / off-circuit before being placed back on track
};

export const RIVALS: { name: string; number: number; style: 'aggressive' | 'clean' | 'blocker' }[] = [
  { name: 'K. Voss', number: 7, style: 'aggressive' },
  { name: 'R. Okafor', number: 22, style: 'clean' },
  { name: 'M. Tanaka', number: 31, style: 'blocker' },
  { name: 'L. Moreau', number: 44, style: 'clean' },
  { name: 'D. Silva', number: 58, style: 'aggressive' },
  { name: 'A. Petrov', number: 63, style: 'blocker' },
  { name: 'J. Reyes', number: 90, style: 'clean' },
];

/**
 * Stability presets for the player's car. Expert is the Stage 2 car exactly; Balanced and Arcade
 * override these values (absolute numbers, not multipliers). Arcade is the default: forgiving,
 * catches its own slides, and is hard to spin with a keyboard.
 */
export const STABILITY = {
  expert: {},
  balanced: {
    powerSlide: 0.62, driftSustain: 0.24, driftAngleLimit: 0.6, driftAngleLimitHandbrake: 1.05, driftCatch: 46000, driftDamping: 7000,
    counterSteerAssist: 0.7, steerGripRef: 14, steerRateDigital: 3.1, steerReturnDigital: 5.8, steerRateSpeedDrop: 0.3, yawDamping: 1200,
    shiftTorqueCut: 0.35, nitroRamp: 0.3, spinSlideLoss: 0.38,
  },
  arcade: {
    powerSlide: 0.42, driftSustain: 0.12, driftAngleLimit: 0.44, driftAngleLimitHandbrake: 0.92, driftCatch: 36000, driftDamping: 9500,
    counterSteerAssist: 0.88, steerGripRef: 12.6, steerRateDigital: 2.7, steerReturnDigital: 5.2, steerRateSpeedDrop: 0.5, yawDamping: 1600,
    shiftTorqueCut: 0.55, nitroRamp: 0.4, spinSlideLoss: 0.22,
  },
} as const;
export type StabilityMode = keyof typeof STABILITY;

/** Steering assist (a gentle pull that keeps the player's car on the circuit), per setting. */
export const STEER_ASSIST = [0, 0.16, 0.32];

/** Off-track recovery for the player. */
/**
 * Weather (Phase 3C-2). Wet multipliers scale each surface's grip when the track is fully wet
 * (physics.wet = 1); AI slows its planned speeds by the square root of the tarmac factor times
 * a small extra margin, so it brakes earlier and carries less speed through corners.
 */
export const WEATHER = {
  wetGripAsphalt: 0.85,
  wetGripKerb: 0.66,
  wetGripGrass: 0.8,
  wetGripRunoff: 0.8,
  aiWetMargin: 0.975,
  /** rain streaks drawn around the camera at each graphics preset */
  rainDrops: { low: 2400, medium: 7000, high: 12000, ultra: 16000 }, // at full intensity
  rainSplashes: { low: 0, medium: 260, high: 520, ultra: 820 },
  /** street-lamp spotlights that follow the camera at night, per preset (the rest use light pools) */
  lampLights: { low: 0, medium: 2, high: 4, ultra: 6 },
};

export const RECOVERY = {
  promptAfter: 3, // seconds off the circuit / stopped / wrong way before "Rejoin" is offered
  autoAfter: 6, // seconds before the car is put back automatically
  ghostTime: 2.5, // seconds the rejoined car passes through others
  rejoinSpeed: 16, // m/s the car is placed back at (capped by the corner ahead)
  clearGap: 14, // metres of clear track wanted ahead of and behind the rejoin point
};

/** Race start and the event list (Phase 3B). */
export const RACE_FLOW = {
  holdMin: 0.35, // random wait on "Set" after the last light, seconds
  holdMax: 1.35,
  jumpPenalty: 1.0, // seconds held on the line for a jump start
  boardHz: 4, // how often the event panel's leaderboard refreshes
};

/** Lens drops in the outside cameras (4B.2): realistic, following the rain intensity. */
export const LENS = {
  gather: 0.25, // how fast drops gather (per second, × rain intensity)
  speedGather: 1.2, // extra gathering at speed (driving into the rain)
  dry: 0.1, // how fast they dry once the rain stops (≈ 10 s)
  centre: 0.32, // share of the full covering allowed in the middle of the screen
};

/** Smoothness (4B.2): dynamic resolution and the F4 benchmark. */
export const PERF = {
  minScale: 0.7, // dynamic resolution never drops below this share of the preset's resolution
  scaleStep: 0.08,
  benchSeconds: 30,
  benchSpeed: 48, // m/s the benchmark camera flies round the track
};

/** How the police cars look (4B). */
export const POLICE_LOOK = {
  lodDetail: 60, // m: small parts drop beyond this
  lodFar: 200, // m: beyond this only a glowing light-bar sprite is drawn
  barBreak: 0.85, // damage at which half the light bar is knocked out (and the unit smokes)
  smokeFrom: 0.6, // damage at which the bonnet starts to smoke
  emissive: 7, // light-bar brightness
  dynamicLights: { low: 0, medium: 2, high: 3, ultra: 4 }, // real flashing lights shared by all units
  hornRange: 16, // m: a unit closing in faster than hornClosing sounds its horn
  hornClosing: 5, // m/s
};

/** How rain looks (4B rework): short lit streaks, splashes, optional lens drops. */
export const RAIN = {
  fallSpeed: 9.5, // m/s, about what real rain falls at
  wind: 1.3, // m/s of sideways drift (it gusts)
  exposure: 0.03, // s: streak length = motion relative to the camera over this long
  maxStreak: 0.45, // m: streaks never get longer than this, however fast you go…
  maxStreakHeavy: 0.7, // …plus this much more in a downpour
  nearFade: 2.2, // m: no streaks closer to the lens than this
  opacityDay: 0.32,
  opacityNight: 0.6,
  splashRadius: 18, // m round the camera
  /** lens drops in the outside cameras when the setting is "Light": share of cells holding one */
  lensDensity: 0.12,
};

/** The cockpit (Phase 4A). Car-body space: +z forward, +x left, y up from the ground. */
export const COCKPIT = {
  eyeY: 0.96, // driver's eyes
  eyeZ: -0.38,
  eyeTilt: -0.07, // rad, looks down a little so the wheel and hands are in view
  wheelY: 0.665,
  wheelZ: 0.06,
  wheelTilt: 0.36, // rad the top of the wheel leans towards the dash
  wheelRadius: 0.155,
  steeringRatio: 6.5, // degrees of steering wheel per degree of front-wheel angle
  mirrorW: 960, // shared mirror render target, split in three
  mirrorH: 160,
  mirrorFar: 260,
  wiperAmp: 1.15, // rad either side of centre
  wiperPeriod: 1.15, // seconds per full back-and-forth (normal)
  wiperFast: 0.72, // in a downpour
  wiperPause: 2.6, // seconds between sweeps on intermittent (light rain)
};

/** How the HUD fits the window (Phase 4A): scale = min(w/1280, h/720) clamped, × the HUD-size setting. */
export const HUD_FIT = {
  min: 0.7,
  max: 1.15,
  laneLines: 2, // radio lines and toasts on screen at once
};

/** The event ladder the results screen's "Next event" walks through (invented names only). */
export const EVENTS: { name: string; type: 'circuit' | 'pursuit'; laps: number; weather: 'clear' | 'cloudy' | 'rain'; time: 'dusk' | 'night' | 'dynamic' }[] = [
  { name: 'Neon Mile', type: 'circuit', laps: 3, weather: 'clear', time: 'dusk' },
  { name: 'Wet Asphalt', type: 'circuit', laps: 3, weather: 'rain', time: 'night' },
  { name: 'Blackout Run', type: 'pursuit', laps: 3, weather: 'cloudy', time: 'night' },
  { name: 'Last Light', type: 'circuit', laps: 5, weather: 'clear', time: 'dynamic' },
  { name: 'Storm Warning', type: 'pursuit', laps: 5, weather: 'rain', time: 'dynamic' },
  { name: 'Midnight Ten', type: 'circuit', laps: 8, weather: 'cloudy', time: 'night' },
];

/**
 * Police and pursuit races (Phase 3C-3). Distances in metres, times in seconds, speeds in m/s.
 * Pacing is by share of the race: lap 1 is clean, traps and work zones go live from lap 2, and
 * police join at `joinAt` of the race (start of lap 2 of 3, lap 3 of 5, lap 4 of 8).
 */
export const POLICE = {
  joinAt: 0.4,
  /** tuning multipliers on the base car: heavier, more torque, less top speed (≈ 300 km/h) */
  cruiserTune: { mass: 1.42, yawInertia: 1.5, torque: 1.22, dragCoef: 1.62, gripAsphalt: 1.02, carRestitution: 0.55 },
  unmarkedTune: { mass: 1.38, yawInertia: 1.45, torque: 1.3, dragCoef: 1.55, gripAsphalt: 1.04, carRestitution: 0.55 },
  rammerTune: { mass: 1.85, yawInertia: 1.9, torque: 1.38, dragCoef: 1.85, gripAsphalt: 0.98, carRestitution: 0.4 },
  /** chase driving: share of the cornering budget, and how hard they push to close the gap */
  chaseGrip: 0.86,
  catchUpGrip: 0.95, // well behind the target they corner harder than any rival
  engageRange: 70, // inside this they steer at the target instead of following the racing line
  boxOffset: 2.5, // sideways offset when trying to box the target in
  /** units on the road at each Heat level 1..5: [patrol sedans, heavy pickups, unmarked] (4B) */
  units: [
    [2, 0, 0],
    [3, 0, 0],
    [3, 1, 0],
    [3, 1, 1],
    [3, 2, 1],
  ] as [number, number, number][],
  damagePerHit: 0.06, // how much a hard knock (per m/s of impact over 2) dents a unit (looks only)
  spawnBehind: [90, 150], // reinforcements arrive this far behind the target, on the circuit
  respawnDelay: 10, // a wrecked unit is replaced after this long
  wreckSpeed: 2.2, // a unit stuck under this speed for `wreckTime` is written off
  wreckTime: 8,
  // ── Heat ──
  heatTrap: 0.4, // a speed-trap flash
  heatHit: 0.22, // ramming a police car (per hit over 4 m/s)
  heatBarrier: 0.06, // smashing a work-zone barrier
  heatChase: 0.024, // per second while being chased in sight
  heatCool: 0.03, // per second out of sight
  // ── Busted / Evade ──
  bustSpeed: 4.2, // 15 km/h
  bustRange: 8,
  bustFill: 1 / 3.2, // per second while slow and boxed in
  bustDrain: 1 / 1.4,
  bustPenalty: 5, // seconds out of the race before the rolling restart
  bustFine: 400, // Speed Points × Heat level
  freeWindow: 5, // co-op: a teammate rams the arresting cruiser within this long to free you
  sightRange: 190, // police can see you up to this far if nothing is in the way
  evadeFill: 1 / 9,
  evadeDrain: 1 / 2.5,
  evadeBounty: 1200, // × Heat level
  evadeCooldown: 9, // after an evade, units patrol this long before searching again
  // ── Traps ──
  trapLimit: 55.6, // 200 km/h
  trapCooldown: 6,
  roadblockAhead: [240, 330], // placed this far ahead of the target
  roadblockLife: 45,
  roadblockEvery: 38,
  spikeAhead: [150, 210],
  spikeLife: 22,
  spikeEvery: 26,
  spikeLength: 7.5,
  punctureTime: 4,
  punctureGrip: 0.55, // grip multiplier while punctured
  punctureTorque: 0.6,
  breakerRadius: 30, // police this close behind a collapsing pursuit breaker are wrecked
  breakerBounty: 1500,
  breakerReset: 2, // laps before a breaker stands again
  heliSpeed: 58,
  heliHeight: 34,
  heliSight: 95, // the helicopter keeps you in its searchlight within this horizontal distance
  /** obstacle impact speed above which a breakable piece is smashed rather than nudged */
  breakSpeed: 3.5,
};
