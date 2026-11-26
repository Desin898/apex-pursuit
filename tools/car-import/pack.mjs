#!/usr/bin/env node
// APEX PURSUIT car import, step 2: compress a converted car and add it to a car pack.
//
//   node tools/car-import/pack.mjs <car folder> [--out play/cars] [--out dist/cars]
//
// <car folder> holds what convert.py wrote (lod0.glb, lod1.glb, meta.json) plus your car.json
// (name, handling, editions; see README.md) and, if you have one, shadow.jpg (a baked ground
// shadow seen from above, white = lit, car front at the top).
//
// The pack is a cars/ folder next to the game page. cars/cars.js holds every car in it as
// base64 (so the game can load it even from a double-clicked file); <id>.carpack.json keeps each
// car on its own so a pack can be rebuilt when you add or remove one. Car packs are personal:
// play/cars/ and dist/cars/ are in .gitignore.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
if (!dir) {
  console.error('usage: node tools/car-import/pack.mjs <car folder> [--out play/cars]');
  process.exit(1);
}
const outs = args.flatMap((a, i) => (a === '--out' ? [args[i + 1]] : []));
if (!outs.length) outs.push('play/cars');

const car = JSON.parse(readFileSync(join(dir, 'car.json'), 'utf8'));
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
if (!/^[a-z0-9-]{1,24}$/.test(car.id ?? '')) throw new Error('car.json: "id" must be 1-24 of a-z 0-9 -');

// meshopt geometry, WebP textures at most 1024 px: a ~25 MB export becomes ~1.5 MB
const tmp = mkdtempSync(join(tmpdir(), 'carpack-'));
const optimise = (name) => {
  const src = join(dir, name);
  if (!existsSync(src)) return null;
  const dst = join(tmp, name);
  execFileSync('npx', ['--yes', '@gltf-transform/cli@4', 'optimize', src, dst, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024',
    '--simplify', 'false', '--instance', 'false', '--flatten', 'false', '--join', 'false', '--palette', 'false'], { stdio: 'inherit' });
  return readFileSync(dst).toString('base64');
};
const entry = {
  id: car.id,
  name: car.name,
  maker: car.maker,
  year: car.year,
  tune: car.tune ?? {},
  set: car.set ?? {},
  sound: car.sound,
  editions: car.editions ?? [],
  meta: { wheels: meta.wheels, steer: meta.steer, ...(car.meta ?? {}) },
  lod0: optimise('lod0.glb'),
  lodm: optimise('lodm.glb'),
  lod1: optimise('lod1.glb'),
  shadow: existsSync(join(dir, 'shadow.jpg')) ? `data:image/jpeg;base64,${readFileSync(join(dir, 'shadow.jpg')).toString('base64')}` : undefined,
};
rmSync(tmp, { recursive: true, force: true });
if (!entry.lod0) throw new Error(`${dir}/lod0.glb is missing: run convert.py first`);

for (const out of outs) {
  mkdirSync(out, { recursive: true });
  // cars already in this pack's cars.js but without their .carpack.json (a fresh clone) are kept
  if (existsSync(join(out, 'cars.js'))) {
    for (const line of readFileSync(join(out, 'cars.js'), 'utf8').split('\n')) {
      if (!line.startsWith('A.push(')) continue;
      const old = JSON.parse(line.slice(7, -2));
      if (old.id !== car.id && !existsSync(join(out, `${old.id}.carpack.json`))) writeFileSync(join(out, `${old.id}.carpack.json`), JSON.stringify(old));
    }
  }
  writeFileSync(join(out, `${car.id}.carpack.json`), JSON.stringify(entry));
  const all = readdirSync(out).filter((f) => f.endsWith('.carpack.json')).sort();
  const body = all.map((f) => `A.push(${readFileSync(join(out, f), 'utf8')});`).join('\n');
  writeFileSync(join(out, 'cars.js'), `// APEX PURSUIT car pack, made by tools/car-import. Only share models you have the right to share.\n(function(){var A=window.__APEX_CARS__=window.__APEX_CARS__||[];\n${body}\n})();\n`);
  const kb = Math.round(readFileSync(join(out, 'cars.js')).length / 1024);
  console.log(`${resolve(out)}/cars.js: ${all.length} car${all.length === 1 ? '' : 's'}, ${kb} kB`);
}
