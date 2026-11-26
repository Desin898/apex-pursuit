# Car import (Phase 4.5)

Bring a real 3D car model into APEX PURSUIT as a new car in car select, with its own handling.

Imported cars live in a **car pack**. That is a `cars/` folder next to the game page, the same idea as a
music pack. The game's own pack ships in `play/cars/` (4.6); each car's rules and description are in
`cars-src/<id>/`, and the converted `.glb` files are rebuilt from the source model, so they stay out of git.

- Only add models you have the right to share. The pack goes wherever the game goes.
- Online, a friend who has the same pack sees your car. A friend without it sees a Phantom X1 in your colours.
  Your handling stays your own, because each player drives their own physics. The relay also hands the
  pack to friends on the link (`npm run host -- --no-share-cars` turns that off).

## What you need

- Blender 3.6 or later (it runs headless, so no window opens). `apt install blender` or blender.org.
- Node 18 or later. The pack step fetches `@gltf-transform/cli` with `npx` the first time.
- A car model as `.blend`, `.fbx` or `.obj`, at real size in metres. It needs four separate tyre objects, and the
  rims and brake discs should be separate objects too.

## 1. Write a rules file

Car models name their parts and materials in any way they like, so a small JSON file tells the converter
what is what. Each pattern is a regular expression, and case is ignored.

```json
{
  "front": "-y",
  "drop": "(engine|suspension|subframe|pedal)",
  "wheels": { "tyre": "^tyre_", "rim": "^rim_", "brake": "^brake_disc" },
  "steer": "steering_wheel",
  "cabin": "(dash|seat|door_panel|steering|shifter)",
  "under": "(underbody|exhaust$)",
  "object_slots": [["headlight_glass", "glass", "lens"]],
  "slots": [
    ["body_paint", "paint"], ["tyre", "tyre"], ["rim", "rim"], ["caliper", "caliper"], ["disc", "disc"],
    ["window", "glass"], ["tail|brake_light", "tail"], ["head", "head"], ["carbon", "carbon"],
    ["cabin:red", "int_red"], ["cabin:", "int"], [".*", "black"]
  ],
  "decimate": [["^tyre_", 0.35], ["dashboard", 0.5]],
  "lod1": { "body": 0.14, "cabin": 0.06, "wheel": 0.12 },
  "textures": { "carbon": "carbon.png", "grille": "grille_mask.png" }
}
```

- `slots` work from top to bottom, and the first match wins. A pattern that starts with `cabin:` only applies to
  interior objects. `object_slots` are `[object pattern, material pattern, slot]` and are checked first.
- The game's slots are `paint`, `glass`, `lens`, `head`, `tail`, `lamp`, `rim`, `rim_dark`, `tyre`, `disc`, `caliper`,
  `carbon`, `black`, `trim`, `chrome`, `dark_chrome`, `metal`, `grille`, `mirror`, `int`, `int_red`, `int_trim`, `dash`
  and `emblem`.
- The garage colours `paint`, `rim` and `caliper`. The brake pedal lights up `tail`.
- `carbon`, `grille` (an opacity mask), `dash` and `emblem` keep a texture, which you list under `textures`.
- `decimate` thins out over-detailed meshes. A ratio of 0.35 keeps 35 % of the triangles.

## 2. Convert

```
blender -b "My Car.blend" --python tools/car-import/convert.py -- cars-src/mycar --rules cars-src/mycar/rules.json --textures "path/to/textures"
```

This writes `lod0.glb` (full detail), `lodm.glb` (middle distance, about 30 %), `lod1.glb` (far away, about 10 %)
and `meta.json` (wheel positions, wheel size and the steering wheel's axis). Check the triangle counts it prints.
Under about 250 000 for LOD0 is fine: only your own car, and cars right beside you, use it.

## 3. Describe the car: `car.json`

Put this file in the same folder:

```json
{
  "id": "mycar",
  "name": "My Car",
  "maker": "Maker",
  "year": 2024,
  "sound": "flat6-na",
  "set": { "torque": 404, "redlineRpm": 9000, "upshiftRpm": 8800, "mass": 1450, "dragCoef": 0.502, "downforce": 1.32,
           "gearRatios": [3.75, 2.38, 1.72, 1.34, 1.11, 0.96, 0.84], "finalDrive": 4.59,
           "torqueCurve": [[0, 0.45], [2500, 0.72], [4000, 0.85], [6300, 1], [8500, 0.93], [9000, 0.86]] },
  "tune": { "gripAsphalt": 1.04, "yawInertia": 0.92 },
  "editions": [
    { "id": "base", "name": "Base", "tagline": "One line for the card.", "number": 7,
      "paint": 0, "color": 15198440, "finish": "gloss", "rim": 12172482, "caliper": 13111324 }
  ],
  "meta": { "exhaust": [[0.08, 0.36, -2.26], [-0.08, 0.36, -2.26]], "eye": [0.36, 1.07, -0.24], "cams": { "hood": [0.92, 1.04] } }
}
```

- `set` replaces the house car's values outright: the engine (`torque` in the game's units, `torqueCurve` as
  rpm → share of peak, `idleRpm`, `redlineRpm`, `upshiftRpm`), the gearbox (`gearRatios`, `finalDrive`,
  `shiftTime`), `mass` and the aero (`dragCoef`, `downforce` in N per (m/s)²). Calibrate against the real car's
  published 0-100, 0-200 and top speed: `tools/car-import` has no calibrator of its own, but the physics test's
  straight-line runs show how (`npm run test:physics`).
- `sound` picks the engine voice: `x1` (the house car) or `flat6-na` (a high-revving naturally aspirated flat six).
- `meta.cams.hood` / `meta.cams.bumper` place those cameras: `[metres forward of the centre of gravity, height]`.
- `tune` values multiply the house car's handling (after `set`) (see `VEHICLE` in `src/config.ts`), and each edition can add its own
  `tune` on top. Top speed goes roughly with √(torque ÷ dragCoef).
- Colours are plain numbers (0xe7e8e8 = 15198440). `paint` is the nearest of the game's eight paints, used for the
  minimap and for online colour clashes.
- `meta.exhaust` places the nitrous flames and `meta.eye` places the driver's eyes for the cockpit camera. Both are in
  metres in glTF space: +x left, +y up, +z forward, and z = 0 halfway between the axles.
- An optional `shadow.jpg` is a baked ground shadow seen from above: white where it is lit, with the car's front at the
  top.

## 4. Pack

```
node tools/car-import/pack.mjs cars-src/mycar --out play/cars --out dist/cars
```

Meshopt geometry and WebP textures make a typical 25 MB export about 1.5 MB. The game picks the pack up on its own
next time it starts. Copy `play/cars/` next to `ApexPursuit.html` for friends who should see the car.
