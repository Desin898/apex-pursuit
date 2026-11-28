// Headless sanity checks for the vehicle model. Run with:  npm run test:physics
import { PHYSICS_DT as DT, VEHICLE as V } from '../src/config';
import { VehicleInput, VehiclePhysics, WHEEL_X, WHEEL_Z } from '../src/vehicle/VehiclePhysics';
import { WorldData } from '../src/world/WorldData';

const world = new WorldData();
const car = new VehiclePhysics(world);
const input = (o: Partial<VehicleInput> = {}): VehicleInput => ({
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  nitro: false,
  analog: false,
  shiftUp: false,
  shiftDown: false,
  ...o,
});
const kmh = (v: number) => (v * 3.6).toFixed(0);
const run = (seconds: number, inp: VehicleInput, each?: (t: number) => void) => {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    car.step(inp, DT);
    each?.(i * DT);
  }
};
const check = (name: string, ok: boolean, detail: string) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);

console.log(`track length ${world.trackLength.toFixed(0)} m, ${world.samples.length} samples, ${world.segments.length} wall segments`);
let minR = 1e9;
for (const s of world.samples) minR = Math.min(minR, 1 / Math.max(Math.abs(s.curv), 1e-6));
console.log(`tightest corner radius ${minR.toFixed(0)} m`);

// 1. Rest: car should sit still and level
const P = world.startPose();
car.reset(P.x, P.z, P.yaw);
run(2, input());
check('rest', Math.abs(car.s.y) < 0.01 && car.s.speed < 0.01 && Math.abs(car.s.pitch) < 0.005, `y=${car.s.y.toFixed(4)} pitch=${car.s.pitch.toFixed(4)} v=${car.s.speed.toFixed(3)}`);

// 2. Launch: 0-100, 0-200, top speed
car.reset(-300, 1500, Math.PI / 2); // open grass far away? no: use a virtual long straight on asphalt
// Use the main straight heading +X for the launch numbers
car.reset(-320, -220, Math.PI / 2);
let t100 = -1;
let t200 = -1;
run(9, input({ throttle: 1 }), (t) => {
  if (t100 < 0 && car.s.speed >= 27.78) t100 = t;
  if (t200 < 0 && car.s.speed >= 55.56) t200 = t;
});
check('0-100 km/h', t100 > 1.8 && t100 < 3.6, `${t100.toFixed(2)} s`);
check('0-200 km/h', t200 > 4.5 && t200 < 9, `${t200.toFixed(2)} s  (gear ${car.s.gear}, ${kmh(car.s.speed)} km/h after 9 s)`);

// Top speed: integrate without the world (stay on asphalt by teleporting back)
const topSpeed = (nitro: boolean) => {
  car.reset(-320, -220, Math.PI / 2);
  car.s.nitro = 1;
  let v = 0;
  for (let i = 0; i < 60 / DT; i++) {
    if (car.s.x > 200) {
      car.s.x -= 500;
      // keep prev ground consistent (flat)
    }
    if (nitro) car.s.nitro = 1;
    car.step(input({ throttle: 1, nitro }), DT);
    v = car.s.speed;
  }
  return v;
};
const vt = topSpeed(false);
check('top speed', vt * 3.6 > 330 && vt * 3.6 < 390, `${kmh(vt)} km/h in gear ${car.s.gear}`);
const vn = topSpeed(true);
check('top speed (nitro)', vn > vt * 1.06, `${kmh(vn)} km/h`);

// 3. Braking 200 → 0
car.reset(-320, -220, Math.PI / 2);
car.s.vx = 55.56;
let dist = 0;
let tb = 0;
while (car.s.speed > 0.5 && tb < 10) {
  car.step(input({ brake: 1 }), DT);
  dist += car.s.speed * DT;
  tb += DT;
  if (car.s.gear === -1) break;
}
check('brake 200-0', dist > 70 && dist < 160, `${dist.toFixed(0)} m in ${tb.toFixed(2)} s`);

// 4. Steady cornering at several speeds on the skid pad (asphalt circle r=82)
for (const v0 of [15, 30, 45]) {
  car.reset(world.pad.x, world.pad.z - 40, Math.PI / 2);
  car.s.vx = v0;
  let maxLat = 0;
  let maxSlip = 0;
  // hold speed roughly with throttle, full left lock for 3 s
  run(2.5, input({ steer: -1, throttle: 0.35 }), () => {
    const lat = Math.abs(car.s.yawRate * car.s.speed);
    maxLat = Math.max(maxLat, lat);
    maxSlip = Math.max(maxSlip, Math.abs(car.s.sideSlip));
  });
  check(`corner @${kmh(v0)}`, maxLat > 9 && maxSlip < 0.5 && Number.isFinite(car.s.x), `peak lateral ${(maxLat / 9.81).toFixed(2)} g, max sideslip ${((maxSlip * 180) / Math.PI).toFixed(1)}°, exit ${kmh(car.s.speed)} km/h`);
}

// 5. Handbrake turn → should rotate into a slide and remain recoverable
car.reset(world.pad.x - 40, world.pad.z + 22, Math.PI / 2);
car.s.vx = 28;
run(0.9, input({ steer: -1, handbrake: true }));
const slideAngle = Math.abs(car.s.sideSlip);
run(2.5, input({ steer: 0, throttle: 0.6 }));
check('handbrake slide', slideAngle > 0.3, `sideslip after 0.9 s ${((slideAngle * 180) / Math.PI).toFixed(0)}°, recovered to ${((Math.abs(car.s.sideSlip) * 180) / Math.PI).toFixed(1)}° at ${kmh(car.s.speed)} km/h`);

// 6. Power oversteer: full throttle + lock from low speed should step the rear out
car.reset(world.pad.x - 20, world.pad.z - 30, Math.PI / 2);
car.s.vx = 12;
let peakSlip = 0;
run(3, input({ steer: -1, throttle: 1 }), () => (peakSlip = Math.max(peakSlip, Math.abs(car.s.sideSlip))));
check('power slide', peakSlip > 0.2 && peakSlip < 1.45, `peak sideslip ${((peakSlip * 180) / Math.PI).toFixed(0)}°`);

// 7. Jump the big ramp at 140 km/h
const ramp = world.ramps[1];
car.reset(ramp.x - 60, ramp.z, ramp.yaw);
car.s.vx = 39;
let maxY = 0;
let air = 0;
let nan = false;
let maxPitch = 0;
run(6, input({ throttle: 0.5 }), () => {
  maxY = Math.max(maxY, car.s.y);
  if (car.s.airborne) air += DT;
  maxPitch = Math.max(maxPitch, Math.abs(car.s.pitch));
  if (!Number.isFinite(car.s.y + car.s.x + car.s.pitch)) nan = true;
});
check('ramp jump', !nan && maxY > 2.5 && air > 0.6 && Math.abs(car.s.y) < 0.05 && car.s.x > ramp.x + 60, `apex ${maxY.toFixed(2)} m, air ${air.toFixed(2)} s, max pitch ${((maxPitch * 180) / Math.PI).toFixed(0)}°, settled y=${car.s.y.toFixed(3)} at x=${car.s.x.toFixed(0)}`);

// 8. Flat-out into the pit wall: must bounce off, not tunnel or explode
car.reset(-100, -220, Math.PI / 2 + 0.5);
car.s.vx = 50 * Math.sin(car.s.yaw);
car.s.vz = 50 * Math.cos(car.s.yaw);
let hits = 0;
let minZ = 0;
run(3, input({ throttle: 1 }), () => {
  hits += car.s.impacts.length;
  car.s.impacts.length = 0;
  minZ = Math.min(minZ, car.s.z);
});
check('wall hit', hits > 0 && minZ > -229.5 && Number.isFinite(car.s.x), `${hits} impacts, deepest z=${minZ.toFixed(2)} (wall at -228.2), speed after ${kmh(car.s.speed)} km/h`);

// 9. Reverse
car.reset(-320, -220, Math.PI / 2);
run(2.5, input({ brake: 1 }));
check('reverse', car.s.gear === -1 && car.s.forwardSpeed < -3, `gear ${car.s.gear}, ${car.s.forwardSpeed.toFixed(1)} m/s`);
run(2.5, input({ throttle: 1 }));
check('reverse → forward', car.s.gear >= 1 && car.s.forwardSpeed > 3, `gear ${car.s.gear}, ${car.s.forwardSpeed.toFixed(1)} m/s`);

// 10. Grass slows the car
car.reset(-20, 500, 0); // open grass south of the lap
const surf = world.surfaceAt(-20, 500);
car.s.vz = 60;
run(4, input());
check('grass drag', surf === 2 && car.s.speed < 52, `surface ${surf}, 216 → ${kmh(car.s.speed)} km/h coasting 4 s`);

// 11. Determinism: two identical runs give bit-identical results
const sim = () => {
  const c = new VehiclePhysics(world);
  c.reset(P.x, P.z, P.yaw);
  for (let i = 0; i < 1200; i++) c.step(input({ throttle: 1, steer: Math.sin(i * 0.01), handbrake: i % 400 > 350 }), DT);
  return `${c.s.x},${c.s.z},${c.s.yaw}`;
};
check('determinism', sim() === sim(), 'identical state after 10 s scripted run');

void V;

// 12. A simple robot driver laps the circuit: checks the track is drivable and the lap timer fires
import { LapTimer } from '../src/game/LapTimer';
{
  const timer = new LapTimer(world, 0);
  const c = new VehiclePhysics(world);
  c.reset(P.x, P.z, P.yaw);
  let laps = 0;
  let wallHits = 0;
  let t = 0;
  const N = world.samples.length;
  while (t < 240 && laps < 1) {
    const hit = world.nearestTrack(c.s.x, c.s.z);
    const i = hit ? hit.index : 0;
    const look = world.samples[(i + Math.round(6 + c.s.speed * 0.45)) % N];
    const dx = look.x - c.s.x;
    const dz = look.z - c.s.z;
    let err = Math.atan2(dx, dz) - c.s.yaw;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    // corner speed from the tightest curvature in the next ~120 m
    let k = 0;
    for (let j = 0; j < 60; j++) k = Math.max(k, Math.abs(world.samples[(i + j) % N].curv));
    const vMax = Math.min(95, Math.sqrt(13 / Math.max(k, 1e-4)));
    c.step(input({ steer: Math.max(-1, Math.min(1, -err * 3)), throttle: c.s.speed < vMax ? 1 : 0, brake: c.s.speed > vMax + 3 ? 0.8 : 0, analog: true }), DT);
    wallHits += c.s.impacts.length;
    c.s.impacts.length = 0;
    timer.update(c.s, DT);
    if (timer.event) laps++;
    t += DT;
  }
  check('robot lap', laps === 1 && wallHits === 0 && Math.abs(timer.last - 78.6) / 78.6 < 0.02, `lap ${timer.last.toFixed(2)} s, wall hits ${wallHits}, sim time ${t.toFixed(0)} s`);
}

// 13. Eight AI cars race three laps: nobody deadlocks, nothing explodes, results are repeatable
import { Race } from '../src/game/Race';
import { defaultLoadout, EDITIONS, statsOf, tunedVehicle } from '../src/vehicle/Cars';
import { AI } from '../src/config';
import { RacingLine } from '../src/ai/RacingLine';
import { collideCars } from '../src/vehicle/CarCollisions';
{
  const line = new RacingLine(world);
  let vmin = 1e9;
  let omax = 0;
  for (let i = 0; i < line.v.length; i++) {
    vmin = Math.min(vmin, line.v[i]);
    omax = Math.max(omax, Math.abs(line.off[i]));
  }
  check('racing line', vmin > 15 && omax <= world.halfWidth - 2 && omax > 2.5, `slowest corner ${kmh(vmin)} km/h, widest offset ${omax.toFixed(1)} m`);

  const runRace = (seconds: number) => {
    const race = new Race(world, Race.soloSpecs(7, defaultLoadout()), 'medium', 0);
    // drive the "player" car with a spare AI brain so all 8 are racing
    const { AIDriver } = require_ai();
    const bot = new AIDriver(world, race.line, 'clean', AI.levels.medium, 4242);
    let contacts = 0;
    let bad = false;
    let t = 0;
    const laps = () => race.cars.map((c) => c.lap.laps);
    while (t < seconds && Math.min(...laps()) < 3) {
      const me = race.player;
      bot.update(me, race.cars, DT, race.held ? -race.countdown : race.time, 0);
      if (bot.wantRespawn) bot.wantRespawn = false;
      const inp = { ...me.input };
      race.step(inp, DT);
      for (const c of race.cars) {
        contacts += c.s.impacts.length;
        c.s.impacts.length = 0;
        if (!Number.isFinite(c.s.x + c.s.z + c.s.yaw + c.s.y)) bad = true;
      }
      t += DT;
    }
    return { race, contacts, bad, t };
  };
  const r = runRace(420);
  const order = r.race.cars.slice().sort((a, b) => a.place - b.place);
  const bests = r.race.cars.map((c) => c.lap.best).filter((b) => b > 0);
  check('8-car race, 3 laps', !r.bad && Math.min(...r.race.cars.map((c) => c.lap.laps)) >= 3, `finished in ${r.t.toFixed(0)} s, best laps ${Math.min(...bests).toFixed(1)}–${Math.max(...bests).toFixed(1)} s, ${r.contacts} contact events`);
  console.log('      order: ' + order.map((c) => `${c.place}.${c.name}(${c.lap.best.toFixed(1)})`).join('  '));
  const r2 = runRace(420);
  check('race determinism', r.t === r2.t && r.race.cars.every((c, i) => c.s.x === r2.race.cars[i].s.x), 'two runs match exactly');

  // Head-on and T-bone hits stay stable and conserve sanity
  const A = new VehiclePhysics(world);
  const B = new VehiclePhysics(world);
  A.reset(-200, -220, Math.PI / 2);
  B.reset(-170, -220, -Math.PI / 2);
  A.s.vx = 40;
  B.s.vx = -40;
  let peak = 0;
  for (let i = 0; i < 240; i++) {
    A.step(input(), DT);
    B.step(input(), DT);
    peak = Math.max(peak, collideCars(A.s, B.s));
  }
  const sep = Math.hypot(A.s.x - B.s.x, A.s.z - B.s.z);
  check('car-to-car head-on', peak > 10 && sep > 1.8 && Number.isFinite(sep) && Math.abs(A.s.vx) < 30, `peak Δv ${peak.toFixed(0)} m/s, cars end ${sep.toFixed(1)} m apart, A at ${kmh(A.s.speed)} km/h`);
}
function require_ai(): typeof import('../src/ai/AIDriver') {
  return AIDriverModule;
}
import * as AIDriverModule from '../src/ai/AIDriver';

// 14. Car-select editions: each tune drives, and the stats rank the way the cards claim
{
  const tops: Record<string, number> = {};
  for (const e of EDITIONS) {
    const c = new VehiclePhysics(world, tunedVehicle(e.id));
    c.reset(-320, -220, Math.PI / 2);
    let v = 0;
    for (let i = 0; i < 40 / DT; i++) {
      if (c.s.x > 200) c.s.x -= 500;
      c.step(input({ throttle: 1 }), DT);
      v = c.s.speed;
    }
    tops[e.id] = v * 3.6;
  }
  const st = Object.fromEntries(EDITIONS.map((e) => [e.id, statsOf(e.id)]));
  const ok = Object.values(tops).every((t) => t > 300 && t < 400) && tops['x1-sport'] < tops['x1-street'] && st['x1-sport'].grip > st['x1-street'].grip && st['x1-nitro'].nitro > st['x1-street'].nitro && st['x1-pursuit'].weight > st['x1-street'].weight;
  check('editions', ok, Object.entries(tops).map(([k, v]) => `${k.slice(3)} ${v.toFixed(0)} km/h`).join(', '));
}

// 14b. 4.5 car packs: an imported car's tune goes through the catalogue, the card stats follow it,
// and the car still laps the circuit cleanly (a made-up track car: less power, much more downforce)
import { CAR_MODELS, registerImportedCar } from '../src/vehicle/Cars';
{
  registerImportedCar({
    id: 'test-gt', name: 'Test GT', tune: { gripAsphalt: 1.04, yawInertia: 0.92, driftSustain: 0.75 },
    // 4.6: an engine of its own (absolute values): a 9,000 rpm engine, seven close ratios, more aero
    set: { torque: 404, redlineRpm: 9000, upshiftRpm: 8800, gearRatios: [3.75, 2.38, 1.72, 1.34, 1.11, 0.96, 0.84], finalDrive: 4.59, dragCoef: 0.502, downforce: 1.32,
      torqueCurve: [[0, 0.45], [2500, 0.72], [6300, 1], [8500, 0.93], [9000, 0.86]] },
    editions: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', tune: { downforce: 1.15 } }],
  });
  const id = 'test-gt-a';
  const c = new VehiclePhysics(world, tunedVehicle(id));
  c.reset(-320, -220, Math.PI / 2);
  let top = 0;
  let t100 = 0;
  for (let i = 0; i < 40 / DT; i++) {
    if (c.s.x > 200) c.s.x -= 500;
    c.step(input({ throttle: 1 }), DT);
    top = c.s.speed * 3.6;
    if (!t100 && top >= 100) t100 = i * DT;
  }
  const lapCar = new VehiclePhysics(world, tunedVehicle(id));
  const timer = new LapTimer(world, 0);
  lapCar.reset(P.x, P.z, P.yaw);
  let laps = 0;
  let walls = 0;
  let maxSlip = 0;
  const N = world.samples.length;
  for (let t = 0; t < 240 && laps < 1; t += DT) {
    const hit = world.nearestTrack(lapCar.s.x, lapCar.s.z);
    const i = hit ? hit.index : 0;
    const look = world.samples[(i + Math.round(6 + lapCar.s.speed * 0.45)) % N];
    let err = Math.atan2(look.x - lapCar.s.x, look.z - lapCar.s.z) - lapCar.s.yaw;
    err = Math.atan2(Math.sin(err), Math.cos(err));
    let k = 0;
    for (let j = 0; j < 60; j++) k = Math.max(k, Math.abs(world.samples[(i + j) % N].curv));
    const vMax = Math.min(95, Math.sqrt(13 / Math.max(k, 1e-4)));
    lapCar.step(input({ steer: Math.max(-1, Math.min(1, -err * 3)), throttle: lapCar.s.speed < vMax ? 1 : 0, brake: lapCar.s.speed > vMax + 3 ? 0.8 : 0, analog: true }), DT);
    walls += lapCar.s.impacts.length;
    lapCar.s.impacts.length = 0;
    if (lapCar.s.speed > 8) maxSlip = Math.max(maxSlip, Math.abs(lapCar.s.sideSlip));
    timer.update(lapCar.s, DT);
    if (timer.event) laps++;
  }
  const sa = statsOf(id);
  const sx = statsOf('x1-street');
  const ok = EDITIONS.some((e) => e.id === 'test-gt-b') && top > 285 && top < 305 && t100 > 2.7 && t100 < 3.6 && tunedVehicle(id).redlineRpm === 9000 && sa.topSpeed < sx.topSpeed && sa.grip > sx.grip && laps === 1 && walls === 0 && maxSlip < 0.35;
  check('imported car tune', ok, `0-100 ${t100.toFixed(2)} s, top ${top.toFixed(0)} km/h, lap ${timer.last.toFixed(2)} s, wall hits ${walls}, max sideslip ${((maxSlip * 180) / Math.PI).toFixed(1)}°, card grip ${sa.grip.toFixed(2)} vs ${sx.grip.toFixed(2)}`);
  // 4.6: rivals in the imported car: every other AI car drives it, the field still races cleanly
  {
    const specs = Race.soloSpecs(7, defaultLoadout());
    const race = new Race(world, specs, 'medium', 0);
    const { AIDriver } = require_ai();
    const bot = new AIDriver(world, race.line, 'clean', AI.levels.medium, 4242);
    let bad = false;
    let t = 0;
    while (t < 330 && Math.min(...race.cars.map((c) => c.lap.laps)) < 2) {
      bot.update(race.player, race.cars, DT, race.held ? -race.countdown : race.time, 0);
      race.step({ ...race.player.input }, DT);
      for (const c of race.cars) {
        c.s.impacts.length = 0;
        if (!Number.isFinite(c.s.x + c.s.z + c.s.yaw + c.s.y)) bad = true;
      }
      t += DT;
    }
    const gt = race.cars.filter((c) => c.edition.startsWith('test-gt'));
    const done = race.cars.every((c) => c.lap.laps >= 2);
    check('rivals in imported cars', !bad && done && gt.length === 3, `${gt.length} of 7 rivals in it, 2 laps in ${t.toFixed(0)} s, their best laps ${gt.map((c) => c.lap.best.toFixed(1)).join(', ')} s; Phantom X1s ${race.cars.filter((c) => !c.edition.startsWith('test-gt') && !c.isPlayer).map((c) => c.lap.best.toFixed(1)).join(', ')} s`);
  }
  // keep the other checks on the house cars only
  for (let i = EDITIONS.length - 1; i >= 0; i--) if (EDITIONS[i].model === 'test-gt') EDITIONS.splice(i, 1);
  CAR_MODELS.splice(CAR_MODELS.findIndex((m) => m.id === 'test-gt'), 1);
}

// 15. Phase 3C handling: grass recovery, Arcade stability, rejoin
import { RECOVERY, STABILITY } from '../src/config';
{
  // a) 15 m out on the grass, at rest: a simple driver aims back at the circuit and floors it
  const S = world.samples;
  // a straight-ish stretch with grass beside it (not the paved pit apron)
  let k = 0;
  for (let i = 0; i < S.length; i++) {
    const c0 = S[i];
    const d0 = world.halfWidth + 15;
    if (Math.abs(c0.curv) < 1 / 400 && world.surfaceAt(c0.x + c0.nx * d0, c0.z + c0.nz * d0) === 2 && world.surfaceAt(c0.x + c0.nx * (d0 - 6), c0.z + c0.nz * (d0 - 6)) === 2) {
      k = i;
      break;
    }
  }
  const smp = S[k];
  const recover = (aim: number, aids: 'expert' | 'arcade') => {
    const c = new VehiclePhysics(world, tunedVehicle('x1-street', { stability: aids, tractionControl: aids === 'arcade', brakeAssist: aids === 'arcade' }));
    const d = world.halfWidth + 15;
    const yaw = Math.atan2(smp.tx, smp.tz) + aim;
    c.reset(smp.x + smp.nx * d, smp.z + smp.nz * d, yaw);
    for (let i = 0; i < 12 / DT; i++) {
      const hit = world.nearestTrack(c.s.x, c.s.z)!;
      if (Math.abs(hit.offset) < world.halfWidth) return i * DT;
      const t = S[(hit.index + 6) % S.length];
      const err = Math.atan2(t.x - c.s.x, t.z - c.s.z) - c.s.yaw;
      const e = Math.atan2(Math.sin(err), Math.cos(err));
      c.step(input({ throttle: 0.8, steer: Math.max(-1, Math.min(1, -e * 2.5)) }), DT);
    }
    return 99;
  };
  const along = recover(0, 'arcade');
  const away = recover(Math.PI / 2, 'arcade');
  const awayExpert = recover(Math.PI / 2, 'expert');
  check('grass recovery', along < 6 && away < 6, `parallel ${along.toFixed(1)} s, facing away ${away.toFixed(1)} s (expert ${awayExpert.toFixed(1)} s)`);

  // b) keyboard full lock at 150 km/h on the open skid pad: Arcade must not spin
  const lock = (mode: 'arcade' | 'expert') => {
    const c = new VehiclePhysics(world, tunedVehicle('x1-street', { stability: mode, tractionControl: mode === 'arcade', brakeAssist: mode === 'arcade' }));
    c.reset(world.pad.x - 70, world.pad.z, Math.PI / 2);
    (world as unknown as { surfaceAt: unknown }).surfaceAt;
    c.s.vx = 150 / 3.6;
    let peak = 0;
    for (let i = 0; i < 2.5 / DT; i++) {
      c.step(input({ steer: -1, throttle: 0.6 }), DT);
      peak = Math.max(peak, Math.abs(c.s.sideSlip));
    }
    return (peak * 180) / Math.PI;
  };
  const la = lock('arcade');
  const le = lock('expert');
  check('arcade full lock 150', la < 30, `peak slip ${la.toFixed(0)}° (expert ${le.toFixed(0)}°)`);

  // c) Arcade still laps the circuit cleanly with the robot driver
  {
    const timer = new LapTimer(world, 0);
    const c = new VehiclePhysics(world, tunedVehicle('x1-street', { stability: 'arcade', tractionControl: true, brakeAssist: true }));
    c.reset(P.x, P.z, P.yaw);
    let t = 0;
    let laps = 0;
    const N = S.length;
    while (t < 240 && laps < 1) {
      const hit = world.nearestTrack(c.s.x, c.s.z);
      const i = hit ? hit.index : 0;
      const look = S[(i + Math.round(6 + c.s.speed * 0.45)) % N];
      let err = Math.atan2(look.x - c.s.x, look.z - c.s.z) - c.s.yaw;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      let kk = 0;
      for (let j = 0; j < 60; j++) kk = Math.max(kk, Math.abs(S[(i + j) % N].curv));
      const vMax = Math.min(95, Math.sqrt(13 / Math.max(kk, 1e-4)));
      c.step(input({ steer: Math.max(-1, Math.min(1, -err * 3)), throttle: c.s.speed < vMax ? 1 : 0, brake: c.s.speed > vMax + 3 ? 0.8 : 0, analog: true }), DT);
      timer.update(c.s, DT);
      if (timer.event) laps++;
      t += DT;
    }
    check('arcade robot lap', laps === 1, `lap ${timer.last.toFixed(2)} s`);
  }

  // d) stuck off the circuit in a race: rejoined automatically, ghosted, facing the right way
  {
    const race = new Race(world, Race.soloSpecs(3, defaultLoadout()), 'medium', 0, { stability: 'arcade', tractionControl: true, brakeAssist: true }, 1);
    for (let i = 0; i < 6 / DT; i++) race.step(input({ throttle: 1 }), DT);
    const p = race.player;
    p.physics.reset(p.s.x + 40, p.s.z + 60, p.s.yaw + 2); // dumped in the infield, facing the wrong way
    let at = -1;
    for (let i = 0; i < 9 / DT && at < 0; i++) {
      race.step(input(), DT);
      if (race.rejoined) at = i * DT;
    }
    const hit = world.nearestTrack(p.s.x, p.s.z)!;
    const smp2 = S[hit.index];
    const dir = Math.abs(Math.atan2(Math.sin(p.s.yaw - Math.atan2(smp2.tx, smp2.tz)), Math.cos(p.s.yaw - Math.atan2(smp2.tx, smp2.tz))));
    check('auto rejoin', at > RECOVERY.autoAfter - 0.5 && at < RECOVERY.autoAfter + 1 && Math.abs(hit.offset) < world.halfWidth && dir < 0.3 && p.s.ghost > 0, `rejoined after ${at.toFixed(1)} s, offset ${hit.offset.toFixed(1)} m, heading error ${((dir * 180) / Math.PI).toFixed(0)}°`);
  }

  // e) a 3-lap race ends, with results in finishing order
  {
    const race = new Race(world, Race.soloSpecs(7, defaultLoadout()), 'medium', 0);
    race.targetLaps = 2;
    const bot = new AIDriver(world, race.line, 'clean', AI.levels.medium, 7);
    let t = 0;
    while (!race.over && t < 400) {
      const me = race.player;
      if (!me.driver) bot.update(me, race.cars, DT, race.held ? -race.countdown : race.time, 0);
      race.step({ ...me.input }, DT);
      for (const c of race.cars) c.s.impacts.length = 0;
      t += DT;
    }
    const res = race.results();
    const ordered = res.every((r, i) => i === 0 || !r.finished || (res[i - 1].finished && res[i - 1].time <= r.time));
    check('race finish + results', race.over && ordered && res.filter((r) => r.finished).length >= 6, `${res.filter((r) => r.finished).length}/8 finished, winner ${res[0].car.name} ${res[0].gap}, last ${res[res.length - 1].gap}`);
  }
  // f) weather: a wet track brakes longer and corners slower, and the AI still laps cleanly
  {
    const brakeDist = (wet: number) => {
      const c = new VehiclePhysics(world);
      c.wet = wet;
      c.reset(-320, -220, Math.PI / 2);
      c.s.vx = 44.4; // 160 km/h
      let d = 0;
      for (let t = 0; (t === 0 || c.s.speed > 0.5) && t < 10; t += DT) {
        c.step(input({ brake: 1 }), DT);
        d += c.s.speed * DT;
        if (c.s.gear === -1) break;
      }
      return d;
    };
    const lateral = (wet: number) => {
      const c = new VehiclePhysics(world);
      c.wet = wet;
      c.reset(world.pad.x, world.pad.z, 0);
      c.s.vx = 0;
      let peak = 0;
      // circle on the skid pad at a fixed throttle: average lateral grip once settled
      for (let t = 0; t < 7; t += DT) {
        c.step(input({ throttle: t < 2 ? 1 : 0.42, steer: t < 1 ? 0 : -0.55, analog: true }), DT);
        if (t > 3.5) peak = Math.max(peak, Math.abs(c.s.yawRate * c.s.speed));
      }
      return peak;
    };
    const dDry = brakeDist(0);
    const dWet = brakeDist(1);
    const gDry = lateral(0);
    const gWet = lateral(1);
    check('wet grip', dWet > dDry * 1.08 && gWet < gDry * 0.97, `160–0 km/h ${dDry.toFixed(0)} m dry, ${dWet.toFixed(0)} m wet; skid-pad peak ${(gDry / 9.81).toFixed(2)} g dry, ${(gWet / 9.81).toFixed(2)} g wet`);

    // one AI car alone, dry then wet: wet is slower and still clean
    const aiLap = (wet: number) => {
      const race = new Race(world, Race.soloSpecs(1, defaultLoadout()), 'hard', 0);
      race.setWet(wet);
      const ai = race.cars.find((c) => c.driver)!;
      let walls = 0;
      let t = 0;
      while (ai.lap.laps < 2 && t < 260) {
        race.step(input(), DT);
        for (const c of race.cars) {
          if (c === ai) walls += c.s.impacts.filter((im) => im.strength > 2).length;
          c.s.impacts.length = 0;
        }
        t += DT;
      }
      return { lap: ai.lap.last, walls };
    };
    const lapDry = aiLap(0);
    const lapWet = aiLap(1);
    check('wet AI lap', lapWet.lap > lapDry.lap * 1.015 && lapWet.lap < lapDry.lap * 1.12 && lapWet.walls === 0, `dry ${lapDry.lap.toFixed(2)} s, wet ${lapWet.lap.toFixed(2)} s, wall hits ${lapWet.walls}`);
  }
  void STABILITY;
}
import { LapTimer as LapTimer2 } from '../src/game/LapTimer';
import { AIDriver } from '../src/ai/AIDriver';
void LapTimer2;

// 16. Phase 3C-3 pursuit: busts, evading, roadblocks, spikes and a full Pursuit Race
import { POLICE } from '../src/config';
{
  const S = world.samples;
  const N = S.length;
  const stepRace = (race: Race, seconds: number, drive?: () => void) => {
    for (let i = 0; i < seconds / DT; i++) {
      drive?.();
      race.step({ ...race.player.input }, DT);
      for (const c of race.cars) c.s.impacts.length = 0;
    }
  };
  const freshPursuit = (rivals = 0) => {
    const race = new Race(world, Race.soloSpecs(rivals, defaultLoadout()), 'medium', 0);
    race.targetLaps = 3;
    const p = race.enablePursuit(11);
    race.countdown = 0;
    p.joined = true;
    p.heat = 1.2;
    return { race, p };
  };

  // a) a stopped car gets boxed in and busted
  {
    const { race, p } = freshPursuit();
    stepRace(race, 0.1);
    race.player.physics.reset(S[600].x, S[600].z, Math.atan2(S[600].tx, S[600].tz));
    race.player.trackIndex = 600;
    let bustedAt = -1;
    for (let i = 0; i < 70 / DT && bustedAt < 0; i++) {
      race.player.input.throttle = 0;
      race.player.input.brake = 0;
      race.player.input.handbrake = true;
      race.step({ ...race.player.input }, DT);
      for (const c of race.cars) c.s.impacts.length = 0;
      if (p.events.some((e) => e.type === 'busted')) bustedAt = i * DT;
      p.events.length = 0;
    }
    const out = p.units.filter((u) => u.active).length;
    check('police bust a stopped car', bustedAt > 0 && bustedAt < 70, `busted after ${bustedAt.toFixed(1)} s with ${out} units out`);
  }

  // b) out of sight long enough: evaded, Heat drops a level
  {
    const { race, p } = freshPursuit();
    p.heat = 2.5;
    stepRace(race, 3);
    const bot = new AIDriver(world, race.line, 'clean', AI.levels.medium, 3);
    let evadedAt = -1;
    const heat0 = p.level;
    for (let i = 0; i < 40 / DT && evadedAt < 0; i++) {
      // the units are held 300 m back (stuck behind a pile-up, say)
      for (const u of p.units) {
        if (!u.active) continue;
        const k = (race.player.trackIndex - 150 - u.id * 4 + N) % N;
        u.car.physics.reset(S[k].x, S[k].z, Math.atan2(S[k].tx, S[k].tz));
      }
      bot.update(race.player, race.cars, DT, 50, 0);
      race.step({ ...race.player.input }, DT);
      for (const c of race.cars) c.s.impacts.length = 0;
      if (p.events.some((e) => e.type === 'evaded')) evadedAt = i * DT;
      p.events.length = 0;
    }
    check('evade out of sight', evadedAt > 0 && p.level === heat0 - 1, `evaded after ${evadedAt.toFixed(1)} s, Heat ${heat0} → ${p.level}`);
  }

  // c) a roadblock: driving through the gap gets you past, hitting the barriers doesn't
  {
    const tryRun = (aimGap: boolean) => {
      const { race, p } = freshPursuit();
      p.joined = false; // just the roadblock, no units on the road
      const me = race.player;
      const i0 = 120;
      me.physics.reset(S[i0].x, S[i0].z, Math.atan2(S[i0].tx, S[i0].tz));
      stepRace(race, 0.05);
      p.placeRoadblock(me, 120);
      const pieces = p.obstacles.filter((o) => o.group === 'roadblock');
      // the gap: the widest space between neighbouring pieces, measured across the track
      const offs = pieces
        .map((o) => {
          const h = world.nearestTrack(o.x, o.z)!;
          return [h.offset - o.hl, h.offset + o.hl];
        })
        .sort((a, b) => a[0] - b[0]);
      let gapC = 0;
      let gapW = 0;
      for (let k = 1; k < offs.length; k++) {
        const w = offs[k][0] - offs[k - 1][1];
        if (w > gapW) {
          gapW = w;
          gapC = (offs[k][0] + offs[k - 1][1]) / 2;
        }
      }
      const aim = aimGap ? gapC : gapC > 0 ? gapC - 6 : gapC + 6;
      const block = { ...world.nearestTrack(pieces[0].x, pieces[0].z)! }; // (nearestTrack reuses its result object)
      let passed = false;
      let minSpeed = 99;
      for (let k = 0; k < 20 / DT && !passed; k++) {
        const j = (me.trackIndex + 8) % N;
        const tx = S[j].x + S[j].nx * aim;
        const tz = S[j].z + S[j].nz * aim;
        const err = Math.atan2(tx - me.s.x, tz - me.s.z) - me.s.yaw;
        me.input.steer = Math.max(-1, Math.min(1, -Math.atan2(Math.sin(err), Math.cos(err)) * 2.5));
        me.input.throttle = me.s.speed < 22 ? 0.8 : 0.2;
        me.input.analog = true;
        race.step({ ...me.input }, DT);
        for (const c of race.cars) c.s.impacts.length = 0;
        if (k > 1 / DT) minSpeed = Math.min(minSpeed, me.s.speed);
        let g = me.trackS - block.s;
        if (g < -world.trackLength / 2) g += world.trackLength;
        if (g > 15) passed = true;
      }
      return { passed, minSpeed, gapW };
    };
    const through = tryRun(true);
    const into = tryRun(false);
    check('roadblock gap', through.passed && through.minSpeed > 8 && into.minSpeed < 2, `gap ${through.gapW.toFixed(1)} m: through it ${through.passed ? 'passed' : 'stopped'} (min ${(through.minSpeed * 3.6).toFixed(0)} km/h), into the barriers: stopped dead (min ${(into.minSpeed * 3.6).toFixed(0)} km/h)`);
  }

  // d) spike strips puncture the tyres: less grip and less pull
  {
    const { race, p } = freshPursuit();
    const me = race.player;
    me.physics.reset(S[300].x, S[300].z, Math.atan2(S[300].tx, S[300].tz));
    me.s.vx = Math.sin(me.s.yaw) * 30;
    me.s.vz = Math.cos(me.s.yaw) * 30;
    stepRace(race, 0.05);
    p.placeSpikes(me, 40);
    const strip = p.obstacles.find((o) => o.kind === 'spikes')!;
    const hit = { ...world.nearestTrack(strip.x, strip.z)! };
    let punctured = 0;
    for (let k = 0; k < 4 / DT && !punctured; k++) {
      const j = (me.trackIndex + 8) % N;
      const tx = S[j].x + S[j].nx * hit.offset;
      const tz = S[j].z + S[j].nz * hit.offset;
      const err = Math.atan2(tx - me.s.x, tz - me.s.z) - me.s.yaw;
      me.input.steer = Math.max(-1, Math.min(1, -Math.atan2(Math.sin(err), Math.cos(err)) * 2.5));
      me.input.throttle = 0.6;
      race.step({ ...me.input }, DT);
      for (const c of race.cars) c.s.impacts.length = 0;
      if (me.s.puncture > 0) punctured = me.s.puncture;
    }
    const lateral = (punct: boolean) => {
      const c = new VehiclePhysics(world);
      c.reset(world.pad.x, world.pad.z, 0);
      let peak = 0;
      for (let t = 0; t < 7; t += DT) {
        if (punct) c.s.puncture = 3;
        c.step(input({ throttle: t < 2 ? 1 : 0.42, steer: t < 1 ? 0 : -0.55, analog: true }), DT);
        if (t > 3.5) peak = Math.max(peak, Math.abs(c.s.yawRate * c.s.speed));
      }
      return peak;
    };
    const accel = (punct: boolean) => {
      const c = new VehiclePhysics(world);
      c.reset(-320, -220, Math.PI / 2);
      for (let t = 0; t < 4; t += DT) {
        if (punct) c.s.puncture = 3;
        c.step(input({ throttle: 1 }), DT);
      }
      return c.s.speed;
    };
    const gOk = lateral(false);
    const gP = lateral(true);
    const vOk = accel(false);
    const vP = accel(true);
    check('spike strip', punctured > 0 && gP < gOk * 0.85 && vP < vOk * 0.92, `punctured ${punctured.toFixed(1)} s; skid pad ${(gOk / 9.81).toFixed(2)} → ${(gP / 9.81).toFixed(2)} g; 4 s from rest ${(vOk * 3.6).toFixed(0)} → ${(vP * 3.6).toFixed(0)} km/h`);
  }

  // e) a full 3-lap Pursuit Race, 8 cars plus police, finishes
  {
    const race = new Race(world, Race.soloSpecs(7, defaultLoadout()), 'medium', 0);
    race.targetLaps = 3;
    const p = race.enablePursuit(5);
    const bot = new AIDriver(world, race.line, 'clean', AI.levels.hard, 9);
    let t = 0;
    const seen = new Map<string, number>();
    let maxHeat = 0;
    let maxUnits = 0;
    while (!race.over && t < 900) {
      const me = race.player;
      if (!me.driver && p.bustedT <= 0) bot.update(me, race.cars.concat(p.traffic()), DT, race.held ? -race.countdown : race.time, 0);
      race.step({ ...me.input }, DT);
      for (const c of race.cars) c.s.impacts.length = 0;
      for (const e of p.events) seen.set(e.type, (seen.get(e.type) ?? 0) + 1);
      p.events.length = 0;
      maxHeat = Math.max(maxHeat, p.level);
      maxUnits = Math.max(maxUnits, p.units.filter((u) => u.active).length);
      t += DT;
    }
    const fin = race.results().filter((r) => r.finished).length;
    const list = [...seen.entries()].filter(([k]) => k !== 'radio').map(([k, v]) => `${k}×${v}`).join(' ');
    check('pursuit race 3 laps', race.over && fin >= 6 && p.joined && maxUnits >= 2, `${fin}/8 finished in ${t.toFixed(0)} s; police out ${maxUnits}, Heat ${maxHeat}; ${list}`);
  }
  void POLICE;
}

// 17. Phase 3D ghost car: a recorded lap plays back where the car actually was
import { Ghost } from '../src/game/Ghost';
{
  const race = new Race(world, Race.soloSpecs(0, defaultLoadout()), 'medium', 0);
  race.countdown = 0;
  const bot = new AIDriver(world, race.line, 'clean', AI.levels.hard, 4);
  const ghost = new Ghost('x1-street');
  const me = race.player;
  let laps = 0;
  let wasRunning = false;
  let lastT = 0;
  const truth: [number, number, number][] = [];
  let t = 0;
  while (laps < 2 && t < 300) {
    bot.update(me, race.cars, DT, 50, 0);
    race.step({ ...me.input }, DT);
    const lap = me.lap;
    if (lap.running && (lap.time < lastT || !wasRunning)) {
      const completed = lap.laps > laps;
      ghost.lapDone(completed ? lap.last : 0, completed);
      laps = lap.laps;
      truth.length = 0;
    }
    wasRunning = lap.running;
    lastT = lap.time;
    if (lap.running) {
      ghost.record(lap.time, me.s.x, me.s.y, me.s.z, me.s.yaw);
      if (laps === 1) truth.push([lap.time, me.s.x, me.s.z]);
    }
    t += DT;
  }
  // compare the saved ghost (lap 2) against where the car was on lap 2
  let worst = 0;
  const pose = { x: 0, y: 0, z: 0, yaw: 0 };
  for (const [lt, x, z] of truth) {
    const p = ghost.pose(lt, pose);
    if (p) worst = Math.max(worst, Math.hypot(p.x - x, p.z - z));
  }
  check('ghost car', !!ghost.best && worst < 2.6, `ghost lap ${ghost.best ? ghost.best.time.toFixed(2) : '–'} s, ${ghost.best ? ghost.best.data.length / 4 : 0} samples; worst replay error ${worst.toFixed(2)} m`);
}

// ── Phase 3B: the start lights' random "Set" hold and the jump-start penalty ──
{
  const run = (stab: boolean) => {
    const race = new Race(world, Race.soloSpecs(3, defaultLoadout()), 'medium', 0);
    race.toGrid();
    const hold = race.hold;
    const inp: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, analog: false, shiftUp: false, shiftDown: false };
    let stage = race.stage();
    let sawSet = false;
    let goAt = -1;
    let movedAt = -1;
    const x0 = race.player.s.x;
    const z0 = race.player.s.z;
    for (let i = 0; i < 9 / DT; i++) {
      stage = race.stage();
      if (stage === 0.5) sawSet = true;
      // rev on the lights (held throttle is fine); the cheat stabs it again during "Set"
      inp.throttle = stage >= 1 ? 1 : stage === 0.5 ? (stab ? (i % 40 < 20 ? 0 : 1) : 1) : 1;
      race.step({ ...inp }, DT);
      for (const c of race.cars) c.s.impacts.length = 0;
      if (goAt < 0 && !race.held) goAt = i * DT;
      if (movedAt < 0 && Math.hypot(race.player.s.x - x0, race.player.s.z - z0) > 0.3) movedAt = i * DT;
    }
    return { hold, sawSet, jumped: race.jumped, lag: movedAt - goAt };
  };
  const clean = run(false);
  const cheat = run(true);
  check(
    'jump start',
    clean.sawSet && !clean.jumped && clean.lag < 0.3 && cheat.jumped && cheat.lag > 0.9 && clean.hold >= 0.35 && clean.hold <= 1.35,
    `hold ${clean.hold.toFixed(2)} s; held throttle: no penalty, moved ${clean.lag.toFixed(2)} s after go; stabbing on Set: penalty, moved ${cheat.lag.toFixed(2)} s after go`,
  );
}

// ── Phase 4A: the chase camera never ends up inside a wall, and the cockpit wheel follows the steering ──
import { CameraRig } from '../src/camera/CameraRig';
import { Cockpit } from '../src/vehicle/Cockpit';
import { COCKPIT } from '../src/config';
{
  const race = new Race(world, Race.soloSpecs(0, defaultLoadout()), 'medium', 0);
  race.countdown = 0;
  const bot = new AIDriver(world, race.line, 'clean', AI.levels.hard, 11);
  const me = race.player;
  const rig = new CameraRig(16 / 9);
  rig.world = world;
  let checks = 0;
  let inside = 0;
  let pulled = 0;
  let t = 0;
  let worstRatio = 0;
  let maxWheel = 0;
  for (const mode of ['Chase near', 'Chase far']) {
    rig.setMode(rig.modeIndex(mode));
    me.physics.reset(world.startPose().x, world.startPose().z, world.startPose().yaw);
    me.lap.reset();
    let laps = 0;
    t = 0;
    let i = 0;
    while (laps < 1 && t < 160) {
      bot.update(me, race.cars, DT, 50, 0);
      race.step({ ...me.input }, DT);
      laps = me.lap.laps;
      t += DT;
      if (++i % 3) continue;
      const s = me.s;
      // swing the camera round to the side now and then: the worst case for walls
      const side = Math.floor(t / 4) % 3 === 2 ? (Math.floor(t / 12) % 2 ? 1 : -1) : 0;
      rig.update({ x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, roll: s.roll }, s, DT * 3, { x: 0, y: 0, back: false, side, mouse: null });
      const c = rig.camera.position;
      checks++;
      if (world.insideWall(c.x, c.z, c.y, 0.15)) inside++;
      if (Math.hypot(c.x - s.x, c.z - s.z) < 5) pulled++;
      // wheel angle against the road-wheel angle
      if (Math.abs(s.steerAngle) > 0.01) worstRatio = Math.max(worstRatio, Math.abs(Cockpit.wheelAngle(s.steerAngle) / s.steerAngle - COCKPIT.steeringRatio));
      maxWheel = Math.max(maxWheel, Math.abs(Cockpit.wheelAngle(s.steerAngle)));
    }
  }
  check('camera wall probe', inside === 0 && checks > 1000, `${checks} camera positions over a chase-near lap and a chase-far lap (with side views): ${inside} inside a wall, pulled in ${pulled} times`);
  check('cockpit wheel', worstRatio < 1e-9 && maxWheel > 0.3 && maxWheel < Math.PI * 1.6, `wheel turns ${COCKPIT.steeringRatio}× the road-wheel angle; most lock on the lap ${((maxWheel * 180) / Math.PI).toFixed(0)}°`);
}
{
  // a tall wall right beside the car: swing the chase camera towards it and it must stay this side
  const tall = world.segments.find((sg) => Math.min(sg.top1, sg.top2) > 3 && Math.hypot(sg.x2 - sg.x1, sg.z2 - sg.z1) > 12);
  if (!tall) check('camera wall probe (tall wall)', false, 'no tall wall in the world to test against');
  else {
    const ex = tall.x2 - tall.x1;
    const ez = tall.z2 - tall.z1;
    const L = Math.hypot(ex, ez);
    const nx = -ez / L;
    const nz = ex / L;
    let worst = Infinity;
    let ok = true;
    for (const sideOfWall of [1, -1]) {
      const px = (tall.x1 + tall.x2) / 2 + nx * 2.5 * sideOfWall;
      const pz = (tall.z1 + tall.z2) / 2 + nz * 2.5 * sideOfWall;
      const yaw = Math.atan2(ex, ez);
      const car = new VehiclePhysics(world);
      car.reset(px, pz, yaw);
      const rig = new CameraRig(16 / 9);
      rig.world = world;
      for (const side of [1, -1]) {
        rig.setMode(rig.modeIndex('Chase far'));
        for (let i = 0; i < 90; i++) rig.update({ x: px, y: car.s.y, z: pz, yaw, pitch: 0, roll: 0 }, car.s, 1 / 60, { x: 0, y: 0, back: false, side, mouse: null });
        const c = rig.camera.position;
        // which side of the wall's line is the camera on, and how far from it?
        const d = (c.x - tall.x1) * nx + (c.z - tall.z1) * nz;
        if (Math.sign(d) !== sideOfWall) ok = false;
        worst = Math.min(worst, Math.abs(d));
      }
    }
    check('camera wall probe (tall wall)', ok && worst > 0.2, `car 2.5 m from a ${Math.min(tall.top1, tall.top2).toFixed(0)} m wall, chase-far camera swung both ways: stays on the car's side, ${worst.toFixed(2)} m from the wall at closest`);
  }
}

// ── Phase 4B: every police vehicle (patrol sedan, unmarked, heavy pickup) can lap the circuit,
//    and the Heat table brings each in when it should ──
import { policeVehicle } from '../src/game/Pursuit';
{
  const res: string[] = [];
  let ok = true;
  for (const kind of ['cruiser', 'unmarked', 'rammer'] as const) {
    const race = new Race(world, Race.soloSpecs(0, defaultLoadout()), 'medium', 0);
    race.countdown = 0;
    race.player.physics.setParams(policeVehicle(kind));
    const bot = new AIDriver(world, race.line, 'aggressive', { grip: POLICE.chaseGrip, power: 1, nitro: false }, 21);
    const me = race.player;
    let t = 0;
    while (me.lap.laps < 1 && t < 200) {
      bot.update(me, race.cars, DT, 50, 0);
      race.step({ ...me.input }, DT);
      t += DT;
    }
    const lapT = me.lap.laps >= 1 ? t : Infinity;
    if (!(lapT < 150)) ok = false;
    res.push(`${kind === 'cruiser' ? 'patrol sedan' : kind === 'rammer' ? 'heavy pickup' : 'unmarked'} ${Number.isFinite(lapT) ? lapT.toFixed(1) + ' s' : 'did not finish'}`);
  }
  const firstOf = (col: number) => POLICE.units.findIndex((u) => u[col] > 0) + 1;
  const order = firstOf(1) === 3 && firstOf(2) === 4;
  check('police vehicles', ok && order, `${res.join(', ')} (from a standing start); pickup from Heat ${firstOf(1)}, unmarked from Heat ${firstOf(2)}`);
}

// 17. Phase 4E: Air One (flight, sight, drops) and the gravel traps
{
  const S = world.samples;
  const N = S.length;
  const freshAir = () => {
    const race = new Race(world, Race.soloSpecs(0, defaultLoadout()), 'medium', 0);
    race.targetLaps = 3;
    const p = race.enablePursuit(23);
    race.countdown = 0;
    p.joined = true;
    p.heat = 3.4;
    return { race, p };
  };
  const bot = (race: Race) => new AIDriver(world, race.line, 'clean', AI.levels.hard, 5);
  // a) the helicopter launches, flies in and keeps up with a car lapping hard (Heat 2, so no
  //    roadblocks or spikes stop the car: this is about the flying)
  {
    const { race, p } = freshAir();
    p.heat = 2.2;
    p.air.from = 2;
    const b = bot(race);
    let t = 0;
    let onScene = -1;
    let near = 0;
    let samples = 0;
    let maxTerrainClear = 1e9;
    while (t < 70) {
      const me = race.player;
      b.update(me, race.cars.concat(p.traffic()), DT, 50, 0);
      race.step({ ...me.input }, DT);
      for (const c of race.cars) c.s.impacts.length = 0;
      if (p.bustedT > 0) p.bustedT = 0.01; // keep driving
      p.events.length = 0;
      t += DT;
      const h = p.heli;
      if (onScene < 0 && h.mode === 'chase') onScene = t;
      if (onScene > 0 && t > onScene + 5 && h.mode === 'chase' && Math.round(t / DT) % 12 === 0) {
        samples++;
        if (Math.hypot(h.x - me.s.x, h.z - me.s.z) < 110) near++;
        maxTerrainClear = Math.min(maxTerrainClear, h.y - p.air.ceilingAt(h.x, h.z));
      }
    }
    const keep = samples ? near / samples : 0;
    check('Air One chase', onScene > 0 && onScene < 25 && keep > 0.8 && maxTerrainClear > -1.5, `on scene after ${onScene.toFixed(1)} s; within 110 m ${(keep * 100).toFixed(0)}% of the time; lowest clearance over the height map ${maxTerrainClear.toFixed(1)} m`);
  }
  // b) line of sight: a grandstand between the helicopter and the car hides it
  {
    const { p } = freshAir();
    const st = world.stands[0];
    // the car right behind the stand (away from the track side), the helicopter low over the track side
    const fx = Math.sin(st.yaw);
    const fz = Math.cos(st.yaw);
    const carX = st.x - fx * (st.d / 2 + 2);
    const carZ = st.z - fz * (st.d / 2 + 2);
    const hx = st.x + fx * 40;
    const hz = st.z + fz * 40;
    const hidden = p.air.blocked(hx, 14, hz, carX, carZ);
    const open = p.air.blocked(hx, 14, hz, st.x + fx * 25, st.z + fz * 25);
    check('Air One line of sight', hidden && !open, `behind the grandstand: ${hidden ? 'hidden' : 'seen'}; in front of it: ${open ? 'hidden' : 'seen'}`);
  }
  // c) a helicopter spike strip: a flat until the end of the lap, a lower top speed
  {
    const { race, p } = freshAir();
    const me = race.player;
    const i0 = (world.startIndex + N - 700) % N;
    me.physics.reset(S[i0].x, S[i0].z, Math.atan2(S[i0].tx, S[i0].tz));
    me.trackIndex = i0;
    p.heli.active = true;
    p.heli.mode = 'chase';
    p.heli.x = me.s.x;
    p.heli.z = me.s.z;
    p.heli.y = 30;
    p.air.dropsOn = false;
    const b = bot(race);
    let dropped = false;
    let flatAt = -1;
    let clearedAt = -1;
    let lapAt = -1;
    let topFlat = 0;
    let t = 0;
    const laps0 = me.lap.laps;
    while (t < 60 && clearedAt < 0) {
      b.update(me, race.cars, DT, 50, 0);
      race.step({ ...me.input }, DT);
      for (const c of race.cars) c.s.impacts.length = 0;
      if (p.bustedT > 0) p.bustedT = 0.01;
      p.events.length = 0;
      if (!dropped && me.s.speed > 25) {
        p.air.dropAhead(me, 'spikes', 1, 45 + me.s.speed * 1.5);
        dropped = true;
      }
      t += DT;
      if (flatAt < 0 && me.s.puncture > 100) flatAt = t;
      if (flatAt > 0 && me.s.puncture > 0) topFlat = Math.max(topFlat, me.s.speed);
      // the lap line (the car started mid-lap, so the lap counter is moved on by hand)
      if (lapAt < 0 && flatAt > 0 && t > flatAt + 2.5) {
        me.lap.laps = laps0 + 1;
        lapAt = t;
      }
      if (flatAt > 0 && me.s.puncture <= 0) clearedAt = t;
    }
    check('Air One spike strip', flatAt > 0 && clearedAt > 0 && lapAt > 0 && Math.abs(clearedAt - Math.max(lapAt, flatAt + POLICE.heliSpikeMin)) < 0.1, `flat at ${flatAt.toFixed(1)} s, lap line at ${lapAt.toFixed(1)} s, tyres fixed at ${clearedAt.toFixed(1)} s; fastest on the flat ${(topFlat * 3.6).toFixed(0)} km/h`);
  }
  // d) a shock charge: a car in the ring is shoved, spun and slowed; police are not
  {
    const { race, p } = freshAir();
    const me = race.player;
    const i0 = 900;
    me.physics.reset(S[i0].x, S[i0].z, Math.atan2(S[i0].tx, S[i0].tz));
    me.s.vx = S[i0].tx * 40;
    me.s.vz = S[i0].tz * 40;
    race.step({ ...me.input, throttle: 0 }, DT);
    p.air.drops.push({ id: 7, kind: 'charge', x: me.s.x + S[i0].nx * 1.5, z: me.s.z + S[i0].nz * 1.5, sx: me.s.x, sy: 30, sz: me.s.z, age: 1 + POLICE.chargeArm - DT / 2, fall: 1, ax: 0, az: 1, red: false, landed: true, boomed: false, done: false });
    const v0 = Math.hypot(me.s.vx, me.s.vz);
    const h0 = Math.atan2(me.s.vx, me.s.vz);
    race.step({ ...me.input, throttle: 0 }, DT);
    const v1 = Math.hypot(me.s.vx, me.s.vz);
    const h1 = Math.atan2(me.s.vx, me.s.vz);
    const boom = p.events.find((e) => e.type === 'boom');
    const turned = Math.abs(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)));
    check('Air One shock charge', !!boom && (boom as { mine: boolean }).mine && turned > 0.12 && Math.abs(me.s.yawRate) > 0.8 && v1 < v0, `kicked ${((turned * 180) / Math.PI).toFixed(0)}° off line, yaw rate ${me.s.yawRate.toFixed(1)} rad/s, ${(v0 * 3.6).toFixed(0)} → ${(v1 * 3.6).toFixed(0)} km/h`);
  }
  // e) gravel: grips less than grass, drags much more
  {
    const g = world.gravel[0];
    const mid = (g.i0 + Math.floor(((g.i1 - g.i0 + N) % N) / 2)) % N;
    const p = S[mid];
    const off = (g.inner + g.outer) / 2 * g.side;
    const gx = p.x + p.nx * off;
    const gz = p.z + p.nz * off;
    const surf = world.surfaceAt(gx, gz);
    const coast = (x: number, z: number) => {
      const c = new VehiclePhysics(world);
      const yaw = Math.atan2(p.tx, p.tz);
      c.reset(x, z, yaw);
      c.s.vx = p.tx * 25;
      c.s.vz = p.tz * 25;
      for (let i = 0; i < 1.2 / DT; i++) c.step({ throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, analog: true, shiftUp: false, shiftDown: false }, DT);
      return c.s.speed;
    };
    const vG = coast(gx, gz);
    const vGrass = coast(-20, 500);
    check('gravel trap', surf === 4 && vG < vGrass - 2, `surface ${surf}; 90 km/h coasting 1.2 s: gravel ${(vG * 3.6).toFixed(0)} km/h, grass ${(vGrass * 3.6).toFixed(0)} km/h`);
  }
}

// 18. Phase 4F: squad tactics, roadblock gap bounty, search and hiding
{
  const S = world.samples;
  const N = S.length;
  const fresh = (heat: number) => {
    const race = new Race(world, Race.soloSpecs(0, defaultLoadout()), 'medium', 0);
    race.targetLaps = 3;
    const p = race.enablePursuit(31);
    race.countdown = 0;
    p.joined = true;
    p.heat = heat;
    p.air.from = 0;
    return { race, p };
  };
  // a) at Heat 2+ the units take squad roles round you: one out front, others beside or behind
  {
    const { race, p } = fresh(2.6);
    (p as unknown as { roadblockT: number }).roadblockT = 1e9;
    const b = new AIDriver(world, race.line, 'clean', AI.levels.medium, 3);
    let t = 0;
    let lead = 0;
    let flank = 0;
    let boxed = 0;
    let calls = 0;
    while (t < 60) {
      const me = race.player;
      b.update(me, race.cars.concat(p.traffic()), DT, 50, 0);
      me.input.throttle *= 0.8; // a car that can be caught
      race.step({ ...me.input }, DT);
      for (const c of race.cars) c.s.impacts.length = 0;
      if (p.bustedT > 0) p.bustedT = 0.01;
      for (const e of p.events) if (e.type === 'radio' && /box them in|get out in front/.test(e.text)) calls++;
      p.events.length = 0;
      t += DT;
      if (Math.round(t / DT) % 60 === 0) {
        if (p.units.some((u) => u.active && u.role === 'lead')) lead++;
        if (p.units.some((u) => u.active && (u.role === 'left' || u.role === 'right'))) flank++;
        if (p.boxedIn(me)) boxed++;
      }
    }
    check('police squad', lead > 3 && flank > 3 && calls > 0, `checks with a lead car ${lead}, with a car beside you ${flank}, boxed in ${boxed}; dispatch formation calls ${calls}`);
  }
  // b) straight through a roadblock's gap: bounty; and the HUD knows which side the gap is
  {
    const { race, p } = fresh(3.2);
    const me = race.player;
    const i0 = 1200;
    me.physics.reset(S[i0].x, S[i0].z, Math.atan2(S[i0].tx, S[i0].tz));
    race.step({ ...me.input }, DT);
    p.placeRoadblock(me, 90);
    const gap = p.roadblockGap();
    let award = '';
    if (gap) {
      const hit = world.nearestTrack(gap.x, gap.z)!;
      const j = (hit.index - 20 + N) % N;
      const q = S[j];
      me.physics.reset(q.x + q.nx * hit.offset, q.z + q.nz * hit.offset, Math.atan2(q.tx, q.tz));
      me.s.vx = q.tx * 30;
      me.s.vz = q.tz * 30;
      for (let i = 0; i < 3 / DT && !award; i++) {
        // hold the line through the gap
        const k = world.nearestTrack(me.s.x, me.s.z)!;
        const steer = Math.max(-1, Math.min(1, (k.offset - hit.offset) * 0.4));
        race.step({ throttle: 0.6, brake: 0, steer, handbrake: false, nitro: false, analog: true, shiftUp: false, shiftDown: false }, DT);
        for (const c of race.cars) c.s.impacts.length = 0;
        for (const e of p.events) if (e.type === 'bounty' && e.why === 'Through a roadblock') award = `+${e.amount}`;
        p.events.length = 0;
      }
    }
    check('roadblock gap', !!gap && !!award && p.bounty > 0, `gap ${gap ? `on the ${gap.side} (${gap.offset.toFixed(1)} m)` : 'missing'}; through it: ${award || 'no bounty'}; bounty ${p.bounty}`);
  }
  // c) lost them: a search circle grows round the last sighting; Evade fills faster in a hiding spot
  {
    const run = (hide: boolean) => {
      const { race, p } = fresh(2.2);
      const me = race.player;
      const spot = p.hideSpots.find((h) => h.name === 'car park') ?? p.hideSpots[0];
      // a unit far away (so someone is out looking), the player either in the car park or out on the grass
      const u = p.units[0];
      (p as unknown as { deploy: (u: unknown, r: unknown, b: number) => void }).deploy(u, null, 0);
      const x = hide ? spot.x : spot.x + 120;
      me.physics.reset(x, spot.z, 0);
      p.hot = true;
      let maxR = 0;
      for (let i = 0; i < 3 / DT; i++) {
        race.step({ throttle: 0, brake: 1, steer: 0, handbrake: true, nitro: false, analog: true, shiftUp: false, shiftDown: false }, DT);
        for (const c of race.cars) c.s.impacts.length = 0;
        p.events.length = 0;
        maxR = Math.max(maxR, p.searchR);
      }
      return { evade: p.evade, searching: p.searching, hiding: p.hiding, maxR };
    };
    const hid = run(true);
    const open = run(false);
    check('search and hiding', hid.searching && hid.hiding && !open.hiding && hid.evade > open.evade * 1.3 && hid.maxR > POLICE.searchStart, `in the car park: hiding ${hid.hiding}, Evade ${(hid.evade * 100).toFixed(0)}% in 3 s; out in the open ${(open.evade * 100).toFixed(0)}%; search circle grew to ${hid.maxR.toFixed(0)} m`);
  }
}

// ── 5A: Hanagiri Pass — the mountain venue (built last: it takes over the shared ground height) ──
import { HANAGIRI_PASS } from '../src/world/venues';
{
  const t0 = Date.now();
  const hw = new WorldData(HANAGIRI_PASS);
  const ms = Date.now() - t0;
  const S = hw.samples;
  const N = S.length;
  let ymin = 1e9;
  let ymax = -1e9;
  let minApproach = 1e9;
  for (const s of S) {
    ymin = Math.min(ymin, s.y);
    ymax = Math.max(ymax, s.y);
  }
  for (let i = 0; i < N; i += 4)
    for (let j = 0; j < N; j += 4) {
      const d = Math.abs(i - j);
      if (Math.min(d, N - d) < 60) continue;
      minApproach = Math.min(minApproach, Math.hypot(S[i].x - S[j].x, S[i].z - S[j].z));
    }
  check('hanagiri: lap', hw.trackLength > 10000 && ymax - ymin > 120 && minApproach > 40, `${(hw.trackLength / 1000).toFixed(2)} km, climbs ${(ymax - ymin).toFixed(0)} m, legs never closer than ${minApproach.toFixed(0)} m, built in ${ms} ms`);
  // the road surface is exact and meets the land without a step
  let err = 0;
  let seam = 0;
  for (let i = 0; i < N; i += 7) {
    const s = S[i];
    for (const o of [-12, -6, 0, 6, 12]) err = Math.max(err, Math.abs(hw.heightAt(s.x + s.nx * o, s.z + s.nz * o) - s.y));
    for (const sd of [1, -1]) {
      const o = hw.roadBand;
      const a = hw.heightAt(s.x + s.nx * (o - 0.01) * sd, s.z + s.nz * (o - 0.01) * sd);
      const b = hw.heightAt(s.x + s.nx * (o + 0.01) * sd, s.z + s.nz * (o + 0.01) * sd);
      seam = Math.max(seam, Math.abs(a - b));
    }
  }
  check('hanagiri: road and land', err < 0.01 && seam < 0.1, `road height error ${err.toFixed(3)} m, step at the road band ${seam.toFixed(3)} m`);
  // a simple robot driver laps it: up the hairpins, over the summit and down
  {
    const P = hw.startPose();
    const c = new VehiclePhysics(hw);
    c.reset(P.x, P.z, P.yaw);
    const timer = new LapTimer(hw, 0);
    let laps = 0;
    let bad = false;
    let t = 0;
    for (t = 0; t < 900 && laps < 1; t += DT) {
      const hit = hw.nearestTrack(c.s.x, c.s.z);
      const i = hit ? hit.index : 0;
      const look = S[(i + Math.round(6 + c.s.speed * 0.45)) % N];
      let e = Math.atan2(look.x - c.s.x, look.z - c.s.z) - c.s.yaw;
      e = Math.atan2(Math.sin(e), Math.cos(e));
      let k = 0;
      for (let j = 0; j < 70; j++) k = Math.max(k, Math.abs(S[(i + j) % N].curv));
      const vMax = Math.min(85, Math.sqrt(11 / Math.max(k, 1e-4)));
      c.step(input({ steer: Math.max(-1, Math.min(1, -e * 3)), throttle: c.s.speed < vMax ? 1 : 0, brake: c.s.speed > vMax + 3 ? 0.9 : 0, analog: true }), DT);
      c.s.impacts.length = 0;
      if (!Number.isFinite(c.s.x + c.s.y + c.s.z)) bad = true;
      timer.update(c.s, DT);
      if (timer.event) laps++;
    }
    check('hanagiri: robot lap', laps === 1 && !bad, `${laps} lap in ${timer.last.toFixed(1)} s, finished at height ${c.s.y.toFixed(1)} m`);
  }
  // eight AI cars race a lap, none lost
  {
    const race = new Race(hw, Race.soloSpecs(7, defaultLoadout()), 'medium', 0);
    const b = new AIDriver(hw, race.line, 'clean', AI.levels.medium, 4242);
    let t = 0;
    let bad = false;
    while (t < 700 && Math.min(...race.cars.map((c) => c.lap.laps)) < 1) {
      b.update(race.player, race.cars, DT, race.held ? -race.countdown : race.time, 0);
      race.step({ ...race.player.input }, DT);
      for (const c of race.cars) {
        c.s.impacts.length = 0;
        if (!Number.isFinite(c.s.x + c.s.y)) bad = true;
      }
      t += DT;
    }
    const done = race.cars.filter((c) => c.lap.laps >= 1).length;
    const best = Math.min(...race.cars.map((c) => c.lap.best));
    check('hanagiri: AI race', done === 8 && !bad, `${done}/8 finished a lap in ${t.toFixed(0)} s, fastest ${best.toFixed(1)} s`);
  }
  // pursuit: the hill between two legs of the road hides you; Air One stays clear of the land
  {
    const race = new Race(hw, Race.soloSpecs(0, defaultLoadout()), 'medium', 0);
    race.targetLaps = 3;
    const p = race.enablePursuit(23);
    race.countdown = 0;
    p.joined = true;
    p.heat = 2.2;
    p.air.from = 2;
    const blocked = (p as unknown as { blocked: (ax: number, az: number, bx: number, bz: number) => boolean }).blocked.bind(p);
    // find two points on the lap with a ridge between them
    let ridge = false;
    for (let i = 0; i < N && !ridge; i += 50)
      for (let j = i + 200; j < N && !ridge; j += 50) {
        const a = S[i];
        const c = S[j];
        if (Math.hypot(a.x - c.x, a.z - c.z) < 180 && blocked(a.x, a.z, c.x, c.z)) ridge = true;
      }
    const b = new AIDriver(hw, race.line, 'clean', AI.levels.hard, 5);
    let t = 0;
    let lowest = 1e9;
    let bad = false;
    let chased = false;
    while (t < 70) {
      const me = race.player;
      b.update(me, race.cars.concat(p.traffic()), DT, 50, 0);
      race.step({ ...me.input }, DT);
      for (const c of race.cars) c.s.impacts.length = 0;
      if (p.bustedT > 0) p.bustedT = 0.01;
      p.events.length = 0;
      t += DT;
      const h = p.heli;
      if (h.mode === 'chase') {
        chased = true;
        lowest = Math.min(lowest, h.y - hw.field!.at(h.x, h.z));
      }
      if (!Number.isFinite(me.s.x + me.s.y + h.y)) bad = true;
    }
    check('hanagiri: pursuit', ridge && chased && lowest > 8 && !bad && p.hideSpots.some((h) => h.name === 'village car park'), `ridge blocks sight: ${ridge}; Air One on the chase, never lower than ${lowest.toFixed(0)} m above the land; ${p.hideSpots.length} hiding spots`);
  }
}

// ── 5B: ride, snow grip, sprints and touge on Hanagiri ──
// @ts-expect-error node's fs (the tests run in node; the game's tsconfig has no node types)
import { readFileSync } from 'fs';
{
  const hw = new WorldData(HANAGIRI_PASS);
  const S = hw.samples;
  const N = S.length;
  // the road surface is continuous: no slope step over 10 cm anywhere on the road
  let worst = 0;
  for (let i = 0; i < N; i += 3)
    for (const o of [-6, -3, 0, 3, 6]) {
      let prev = NaN;
      let prevd = NaN;
      for (let k = -20; k <= 20; k++) {
        const s = S[i];
        const h = hw.heightAt(s.x + s.tx * k * 0.1 + s.nx * o, s.z + s.tz * k * 0.1 + s.nz * o);
        if (!isNaN(prev)) {
          const d = h - prev;
          if (!isNaN(prevd)) worst = Math.max(worst, Math.abs(d - prevd));
          prevd = d;
        }
        prev = h;
      }
    }
  check('5B: road surface continuous', worst < 0.003, `largest slope change over 10 cm: ${(worst * 100).toFixed(2)} cm`);
  // the GT3 RS laps it dry, wet and in snow with no suspension kicks (the bump-stop fix on descents)
  const pack = JSON.parse(readFileSync('play/cars/gt3rs.carpack.json', 'utf8'));
  const P: Record<string, unknown> = { ...V, ...pack.set };
  for (const [k, m] of Object.entries(pack.tune)) P[k] = (P[k] as number) * (m as number);
  const laps: string[] = [];
  let spikes = 0;
  let maxAy = 0;
  let ok = true;
  for (const [wet, snow] of [[0, 0], [1, 0], [0.3, 1]]) {
    const c = new VehiclePhysics(hw, P as never);
    c.wet = wet;
    c.snow = snow;
    const st = hw.startPose();
    c.reset(st.x, st.z, st.yaw);
    const timer = new LapTimer(hw, 0);
    let n = 0;
    let prevVy = 0;
    const prevL = [0, 0, 0, 0];
    const gk = snow ? 0.55 : wet ? 0.8 : 1;
    for (let t = 0; t < 800 && n < 1; t += DT) {
      const hit = hw.nearestTrack(c.s.x, c.s.z);
      const i = hit ? hit.index : 0;
      const look = S[(i + Math.round(6 + c.s.speed * 0.45)) % N];
      let e = Math.atan2(look.x - c.s.x, look.z - c.s.z) - c.s.yaw;
      e = Math.atan2(Math.sin(e), Math.cos(e));
      let k = 0;
      for (let j = 0; j < 70; j++) k = Math.max(k, Math.abs(S[(i + j) % N].curv));
      const vMax = Math.min(85, Math.sqrt((11 * gk) / Math.max(k, 1e-4)));
      c.step(input({ steer: Math.max(-1, Math.min(1, -e * 3)), throttle: Math.max(0, Math.min(1, (vMax - c.s.speed) * 0.4)), brake: Math.max(0, Math.min(0.9, (c.s.speed - vMax - 1) * 0.25)), analog: true }), DT);
      c.s.impacts.length = 0;
      if (t > 2) maxAy = Math.max(maxAy, Math.abs((c.s.vy - prevVy) / DT));
      prevVy = c.s.vy;
      for (let q = 0; q < 4; q++) {
        if (t > 2 && Math.abs(c.s.wheelLoad[q] - prevL[q]) > 2500) spikes++;
        prevL[q] = c.s.wheelLoad[q];
      }
      timer.update(c.s, DT);
      if (timer.event) n++;
    }
    if (n < 1) ok = false;
    laps.push(n ? timer.last.toFixed(0) : 'DNF');
  }
  check('5B: GT3 RS ride (dry / wet / snow)', ok && spikes === 0 && maxAy < 40, `laps ${laps.join(' / ')} s, wheel-load spikes ${spikes}, peak vertical accel ${maxAy.toFixed(1)} m/s²`);
  check('5B: snow is slower than wet, wet than dry', +laps[0] < +laps[1] && +laps[1] < +laps[2], laps.join(' < '));
  // road cover: snow lies on the road with clearer wheel tracks; puddles exist
  {
    const rc = { water: 0, snow: 0, ice: 0, bank: 0 };
    let tracks = 0;
    let mid = 0;
    let wet = 0;
    for (let i = 0; i < N; i += 5) {
      const s = S[i];
      const lane = hw.halfWidth / 2;
      tracks += hw.roadCover(s.x + s.nx * (lane - 0.8), s.z + s.nz * (lane - 0.8), rc).snow;
      mid += hw.roadCover(s.x + s.nx * lane, s.z + s.nz * lane, rc).snow;
      if (hw.roadCover(s.x, s.z, rc).water > 0.2) wet++;
    }
    check('5B: road snow and puddles', tracks < mid * 0.6 && wet > 10, `snow in the wheel tracks ${(tracks / (N / 5)).toFixed(2)} vs between them ${(mid / (N / 5)).toFixed(2)}; ${wet} samples with standing water`);
  }
  // sprints: both routes, the whole field finishes, positions decided
  const routeRes: string[] = [];
  let allDone = hw.routes.length === 2;
  for (const r of hw.routes) {
    const race = new Race(hw, Race.soloSpecs(7, defaultLoadout()), 'medium', 0);
    race.setRoute(r);
    const b = new AIDriver(hw, race.line, 'clean', AI.levels.hard, 4242);
    let t = 0;
    while (t < 600 && !race.cars.every((c) => c.finished)) {
      b.update(race.player, race.cars, DT, race.held ? -race.countdown : race.time, 0);
      race.step({ ...race.player.input }, DT);
      for (const c of race.cars) c.s.impacts.length = 0;
      t += DT;
    }
    const done = race.cars.filter((c) => c.finished).length;
    if (done !== 8 || !race.over) allDone = false;
    routeRes.push(`${r.id} ${(r.len / 1000).toFixed(2)} km: ${done}/8 in ${race.results()[0].gap}`);
  }
  check('5B: sprints', allDone, routeRes.join('; '));
  // touge: a match runs its rounds, swaps roles and ends with a result
  {
    const race = new Race(hw, Race.soloSpecs(1, defaultLoadout()), 'medium', 0);
    race.setRoute(hw.routes[1]);
    const m = race.enableTouge(false);
    const b = new AIDriver(hw, race.line, 'clean', AI.levels.medium, 77);
    let t = 0;
    while (t < 1500 && m.state !== 'over') {
      b.update(race.player, race.cars, DT, race.held ? -race.countdown : race.time, 0);
      race.step({ ...race.player.input }, DT);
      for (const c of race.cars) c.s.impacts.length = 0;
      t += DT;
    }
    const swapped = m.rounds.length >= 2 && m.rounds[0].youLed !== m.rounds[1].youLed;
    check('5B: touge', m.state === 'over' && race.over && swapped && m.winner !== null, `${m.rounds.length} rounds (${m.rounds.map((x) => `${x.youLed ? 'lead' : 'chase'} → ${x.winner}`).join(', ')}), ${m.score.join('–')}, winner ${m.winner}`);
  }
}

// ── 5B.1: race length and police timing on the 10 km lap ──
import { fitLaps, lapChoices, pursuitPacing } from '../src/game/pacing';
{
  const hw = new WorldData(HANAGIRI_PASS);
  const L = hw.trackLength;
  const rules =
    lapChoices(L).join(',') === '1,2,3' &&
    fitLaps(L, 5) === 2 &&
    pursuitPacing(L, 1).join === 0.5 &&
    pursuitPacing(L, 2).join === 0.5 &&
    pursuitPacing(L, 3).join === 1 &&
    lapChoices(3257).join(',') === '3,5,8' &&
    pursuitPacing(3257, 3).join === 1 &&
    pursuitPacing(3257, 5).join === 2 &&
    pursuitPacing(3257, 3).traps === 1;
  // a live 2-lap pursuit: cameras a quarter of the way round lap 1, police halfway round lap 1
  const race = new Race(hw, Race.soloSpecs(3, defaultLoadout()), 'medium', 0);
  race.targetLaps = 2;
  const p = race.enablePursuit(31);
  const b = new AIDriver(hw, race.line, 'clean', AI.levels.hard, 9);
  let t = 0;
  let trapsAt = -1;
  let joinAt = -1;
  while (t < 400 && joinAt < 0) {
    b.update(race.player, race.cars, DT, race.held ? -race.countdown : race.time, 0);
    race.step({ ...race.player.input }, DT);
    for (const c of race.cars) c.s.impacts.length = 0;
    p.events.length = 0;
    const lead = Math.max(...race.cars.map((c) => race.distanceOf(c)));
    if (trapsAt < 0 && p.trapsLive) trapsAt = lead;
    if (joinAt < 0 && p.joined) joinAt = lead;
    t += DT;
  }
  check('5B.1: Hanagiri laps and police', rules && Math.abs(trapsAt - 0.25) < 0.02 && Math.abs(joinAt - 0.5) < 0.02, `laps ${lapChoices(L).join('/')} (circuit ${lapChoices(3257).join('/')}); 2 laps: cameras live at lap ${trapsAt.toFixed(2)}, police join at lap ${joinAt.toFixed(2)} (${t.toFixed(0)} s in)`);
}

// ── 5C: a still grid, wheels that stay on the car, banks that can't be climbed ──
import { layoutCar, newFrame, newLayout, updateFrame } from '../src/vehicle/wheelPose';
{
  // 1. the start: every car sits still on its springs from the first frame, on both maps
  const moves: string[] = [];
  let still = true;
  for (const venue of [undefined, HANAGIRI_PASS]) {
    const w = venue ? new WorldData(venue) : new WorldData();
    const race = new Race(w, Race.soloSpecs(7, defaultLoadout()), 'medium', 0);
    const ref = race.cars.map((c) => [c.s.y, c.s.pitch, c.s.roll]);
    let worst = 0;
    while (race.held) {
      race.step(input(), DT);
      race.cars.forEach((c, i) => {
        // how far the body moves at its corners: heave plus pitch and roll at the wheels
        const m = Math.abs(c.s.y - ref[i][0]) + V.cgToFront * Math.abs(c.s.pitch - ref[i][1]) + V.halfTrack * Math.abs(c.s.roll - ref[i][2]);
        worst = Math.max(worst, m);
      });
    }
    if (worst >= 0.01) still = false;
    moves.push(`${venue ? 'Hanagiri' : 'Proving Grounds'} ${(worst * 100).toFixed(2)} cm`);
  }
  check('5C: still on the grid', still, `8 cars, the most any body moved through the countdown: ${moves.join(', ')}`);

  const hw = new WorldData(HANAGIRI_PASS);
  const S = hw.samples;
  const slopeAt = (x: number, z: number) => {
    const e = 0.5;
    return Math.hypot((hw.heightAt(x + e, z) - hw.heightAt(x - e, z)) / (2 * e), (hw.heightAt(x, z + e) - hw.heightAt(x, z - e)) / (2 * e));
  };
  // banks beside the road, by how steep they get a few metres up
  const banks: { i: number; sd: number; o: number; sl: number }[] = [];
  for (let i = 0; i < S.length; i += 9) {
    const s = S[i];
    for (const sd of [1, -1]) {
      // the steepest 4 m stretch within 10 m of the road's edge (how steep it is from its foot)
      let best = { i, sd, o: 0, sl: 0 };
      for (let o = hw.roadBand + 1; o < hw.roadBand + 10; o++) {
        const x = s.x + s.nx * o * sd;
        const z = s.z + s.nz * o * sd;
        const rise = hw.heightAt(s.x + s.nx * (o + 4) * sd, s.z + s.nz * (o + 4) * sd) - hw.heightAt(x, z);
        if (rise / 4 > best.sl) best = { i, sd, o, sl: rise / 4 };
      }
      if (best.sl > 0.25) banks.push(best);
    }
  }
  // where along a bank's line it first gets as steep as 45° (over 1 m): distance from the road
  // centre, or −1 if it never does within 30 m of the edge
  const foot45 = (b: { i: number; sd: number }) => {
    const s = S[b.i];
    for (let o = hw.roadBand; o < hw.roadBand + 30; o += 0.5) {
      const h0 = hw.heightAt(s.x + s.nx * o * b.sd, s.z + s.nz * o * b.sd);
      const h1 = hw.heightAt(s.x + s.nx * (o + 1) * b.sd, s.z + s.nz * (o + 1) * b.sd);
      if (h1 - h0 >= 1) return o;
    }
    return -1;
  };
  /** Drive straight at a bank from `from` m off the road centre at `v0`, full throttle. */
  const tryBank = (b: { i: number; sd: number }, v0: number, secs: number, from = hw.roadBand - 2) => {
    const s = S[b.i];
    const c = new VehiclePhysics(hw);
    const yaw = Math.atan2(s.nx * b.sd, s.nz * b.sd);
    c.reset(s.x + s.nx * from * b.sd, s.z + s.nz * from * b.sd, yaw);
    c.s.vx = Math.sin(yaw) * v0;
    c.s.vz = Math.cos(yaw) * v0;
    const start = c.s.y;
    let up = 0;
    let wheelsOk = true;
    const f = newFrame();
    const L = newLayout();
    for (let t = 0; t < secs; t += DT) {
      c.step(input({ throttle: 1 }), DT);
      c.s.impacts.length = 0;
      up = Math.max(up, c.s.y - start);
      // the drawn wheels: each within its suspension travel below its corner of the body
      updateFrame(c.s, c.s, f, DT);
      layoutCar(c.s, c.s, f, WHEEL_X, WHEEL_Z, L);
      for (let i = 0; i < 4; i++) {
        const corner = L.bodyY + WHEEL_Z[i] * (c.s.pitch - f.pitch) + WHEEL_X[i] * (c.s.roll - f.roll);
        const travel = corner - L.wheelY[i];
        if (travel < -V.bumpTravel - 1e-6 || travel > V.staticCompression + 0.04 + 1e-6 || !Number.isFinite(travel)) wheelsOk = false;
      }
    }
    // how far up the 45° part of the bank (its foot along this line) the car got
    const f45 = foot45(b);
    const h45 = f45 > 0 ? hw.heightAt(s.x + s.nx * f45 * b.sd, s.z + s.nz * f45 * b.sd) - start : Infinity;
    return { up, wheelsOk, over45: up - h45 };
  };
  // nothing in the way along a bank's line: no wall (rock face, rail) and no tree within reach
  const clear = (b: { i: number; sd: number }) => {
    const s = S[b.i];
    if (hw.rockBack[b.i * 2 + (b.sd > 0 ? 1 : 0)] > 0) return false;
    for (let o = hw.roadBand - 2; o < hw.roadBand + 26; o += 2) {
      const x = s.x + s.nx * o * b.sd;
      const z = s.z + s.nz * o * b.sd;
      if (hw.trees.some((t) => Math.abs(t.x - x) < 3 && Math.abs(t.z - z) < 3)) return false;
    }
    return !hw.barrierRuns.some((r) => r.pts.some((p) => Math.hypot(p.x - (s.x + s.nx * (hw.roadBand - 0.2) * b.sd), p.z - (s.z + s.nz * (hw.roadBand - 0.2) * b.sd)) < 3));
  };
  // 3. a 45° bank (or steeper): from walking pace on full throttle the car gets nowhere up it
  const steep = banks.filter((b) => b.sl > 1.0 && foot45(b) > 0);
  let worstSlow = 0;
  let worstFast = 0;
  let wheels = true;
  for (const b of steep.filter(clear).slice(0, 16)) {
    // at walking pace from the foot of the 45° face (the car's nose 1 m short of it)
    const a = tryBank(b, 3, 8, foot45(b) - V.cgToFront - 1.9);
    // and straight off the road at 90 km/h
    const f = tryBank(b, 25, 6);
    worstSlow = Math.max(worstSlow, a.up);
    worstFast = Math.max(worstFast, f.over45);
    wheels = wheels && a.wheelsOk && f.wheelsOk;
  }
  check('5C: no climbing a 45° bank', steep.length >= 8 && worstSlow < 1.2 && worstFast < 10, `${steep.length} banks with a 45° face beside the road; from walking pace at its foot on full throttle no car gets more than ${worstSlow.toFixed(1)} m up; hitting one at 90 km/h a car gets ${Math.max(0, worstFast).toFixed(1)} m up the 45° part at most (5B.1: 33 m and 110 m up the bank)`);
  check('5C: wheels stay on the car', wheels, 'every drawn wheel stays within its suspension travel under its corner of the body, through every bank hit');
  // 4. gentle grass slopes still drive: a car on a 15–25° bank pulls up it
  const gentle = banks.filter((b) => b.sl > 0.27 && b.sl < 0.47 && clear(b));
  let climbed = 0;
  for (const b of gentle.slice(0, 10)) if (tryBank(b, 3, 6).up > 1.5) climbed++;
  check('5C: gentle banks still drive', gentle.length === 0 || climbed >= Math.ceil(Math.min(10, gentle.length) * 0.7), `${climbed}/${Math.min(10, gentle.length)} grass banks of 15–25° driven up from walking pace`);
}

// ── 5D: snow banks that hold a car, black ice that really slides ──
import { blackIce } from '../src/world/surfaceMaps';
{
  const hw = new WorldData(HANAGIRI_PASS);
  const S = hw.samples;
  const N = S.length;
  const half = hw.halfWidth;
  // straight, flat stretches of road with no wall or barrier beside them
  const straights: number[] = [];
  for (let i = 0; i < N; i += 37) {
    let ok = true;
    for (let k = 0; k < 30 && ok; k++) if (Math.abs(S[(i + k) % N].curv) > 0.004) ok = false;
    if (ok && Math.abs(S[i].y - S[(i + 30) % N].y) < 2) straights.push(i);
  }
  // 1. drifting wide at 70 km/h, 12° off line towards the edge: the bank catches the car
  const run = (i: number, snow: number) => {
    const c = new VehiclePhysics(hw);
    const s = S[i];
    const sd = 1;
    const off = half - 1;
    // heading 12° off the road's direction, towards the edge
    const hx = s.tx * Math.cos(0.21) + s.nx * Math.sin(0.21);
    const hz = s.tz * Math.cos(0.21) + s.nz * Math.sin(0.21);
    c.reset(s.x + s.nx * off * sd, s.z + s.nz * off * sd, Math.atan2(hx, hz));
    c.snow = snow;
    const v = 19.5;
    c.s.vx = Math.sin(c.s.yaw) * v;
    c.s.vz = Math.cos(c.s.yaw) * v;
    let maxOff = 0;
    for (let t = 0; t < 1.6; t += DT) {
      c.step(input({ throttle: 0.25 }), DT);
      const h = hw.nearestTrack(c.s.x, c.s.z);
      if (h) maxOff = Math.max(maxOff, Math.abs(h.offset));
    }
    return { maxOff, speed: c.s.speed };
  };
  let n = 0;
  let lostSnow = 0;
  let lostDry = 0;
  let offSnow = 0;
  let offDry = 0;
  for (const i of straights.slice(0, 12)) {
    const a = run(i, 1);
    const b = run(i, 0);
    // (only the runs that reached the edge of the paving)
    if (b.maxOff < hw.roadBand - 1) continue;
    n++;
    lostSnow += 19.5 - a.speed;
    lostDry += 19.5 - b.speed;
    offSnow += a.maxOff;
    offDry += b.maxOff;
  }
  const k = Math.max(1, n);
  check('5D: snow banks hold a car', n >= 4 && lostSnow / n > lostDry / n + 4 && offSnow < offDry - 0.5, `${n} runs off a straight at 70 km/h on a light throttle, 12° wide: 1.6 s later the car is doing ${((19.5 - lostSnow / k) * 3.6).toFixed(0)} km/h in the snow, ${((19.5 - lostDry / k) * 3.6).toFixed(0)} km/h on a dry road, and got ${(offSnow / k).toFixed(1)} m out from the centre line (dry: ${(offDry / k).toFixed(1)} m; the paving ends at ${(hw.roadBand - 0.6).toFixed(1)} m)`);

  // 2. black ice: where the road shader draws it, the tyres find almost no grip
  const rc = { water: 0, snow: 0, ice: 0, bank: 0 };
  let iceSpots = 0;
  let iceGrip = 0;
  let snowGrip = 0;
  let snowSpots = 0;
  let matched = 0;
  let total = 0;
  const probe = new VehiclePhysics(hw);
  probe.snow = 1;
  for (let i = 0; i < N; i += 3) {
    const s = S[i];
    for (const o of [-half * 0.5, 0, half * 0.5]) {
      const x = s.x + s.nx * o;
      const z = s.z + s.nz * o;
      hw.roadCover(x, z, rc);
      total++;
      if (Math.abs(rc.ice - blackIce(x, z, rc.snow)) < 1e-6) matched++;
      if (rc.ice > 0.8 || (rc.ice < 0.01 && rc.snow < 0.3 && snowSpots < 400)) {
        probe.reset(x, z, Math.atan2(s.tx, s.tz));
        probe.step(input(), DT);
        const g = (probe as unknown as { cover: number[] }).cover.reduce((p, q) => p + q, 0) / 4;
        if (rc.ice > 0.8) {
          iceSpots++;
          iceGrip += g;
        } else {
          snowSpots++;
          snowGrip += g;
        }
      }
    }
  }
  check('5D: black ice is slippery', iceSpots > 20 && iceGrip / iceSpots < 0.62 * (snowGrip / Math.max(1, snowSpots)) && matched === total, `${iceSpots} points on black ice: grip ${(iceGrip / Math.max(1, iceSpots)).toFixed(2)} of dry, against ${(snowGrip / Math.max(1, snowSpots)).toFixed(2)} on thin snow nearby; the ice the tyres feel is the ice drawn on the road at ${matched}/${total} points`);
}
