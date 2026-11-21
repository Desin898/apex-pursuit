// Headless sanity checks for the vehicle model. Run with:  npm run test:physics
import { PHYSICS_DT as DT, VEHICLE as V } from '../src/config';
import { VehicleInput, VehiclePhysics } from '../src/vehicle/VehiclePhysics';
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
