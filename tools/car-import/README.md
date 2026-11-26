# Car import (Phase 4.5)

Bring a real 3D car model into APEX PURSUIT as a new car in car select, with its own handling.

Imported cars live in a **car pack**. That is a `cars/` folder next to the game page, the same idea as a
music pack. Car packs are personal:

- `play/cars/`, `dist/cars/` and `cars-src/` are in `.gitignore`. Models of real cars are other people's work and
  brands, and they never go into this public repository.
- Online, a friend who has the same pack sees your car. A friend without it sees a Phantom X1 in your colours.
  Your handling stays your own, because each player drives their own physics.

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

This writes `lod0.glb` (full detail), `lod1.glb` (the far-away copy) and `meta.json` (wheel positions, wheel size and
the steering wheel's axis). Check the triangle counts it prints. Under about 250 000 for LOD0 is fine.

## 3. Describe the car: `car.json`

Put this file in the same folder:

```json
{
  "id": "mycar",
  "name": "My Car",
  "maker": "Maker",
  "year": 2024,
  "tune": { "torque": 0.85, "dragCoef": 1.25, "downforce": 1.6, "gripAsphalt": 1.04, "mass": 0.98 },
  "editions": [
    { "id": "base", "name": "Base", "tagline": "One line for the card.", "number": 7,
      "paint": 0, "color": 15198440, "finish": "gloss", "rim": 12172482, "caliper": 13111324 }
  ],
  "meta": { "exhaust": [[0.08, 0.36, -2.26], [-0.08, 0.36, -2.26]], "eye": [0.36, 1.07, -0.24] }
}
```

- `tune` values multiply the house car's handling (see `VEHICLE` in `src/config.ts`), and each edition can add its own
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
