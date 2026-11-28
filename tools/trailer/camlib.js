(() => {
  const g = __apex;
  const css = document.createElement('style');
  css.textContent = '#hud,#hud *,.toast,#toast,#minimap,.minimap{display:none!important}';
  document.head.appendChild(css);
  const race = g.race;
  const pl = race.player;
  // the player's car drives itself: a fast clean AI driver
  const any = race.cars.find((c) => c.driver);
  const D = any.driver.constructor;
  pl.driver = new D(any.driver.world, any.driver.line, 'clean', { grip: 0.8, power: 1, nitro: false }, 7);
  pl.driver.wetK = race.weatherK ?? 1;
  const cv = g.renderer.domElement;
  const rig = g.rig;
  const orig = rig.update.bind(rig);
  const cam = rig.camera;
  const V3 = cam.position.constructor;
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const T = {
    c: null, f: 0, n: 1, sy: 0, base: null, seed: 1,
    begin(c) {
      this.c = c.type ? c : null;
      this.f = 0;
      this.n = c.frames || 60;
      this.sy = pl.s.yaw;
      this.base = null;
      if (c.type === 'game') rig.setMode(c.mode ?? 0);
      if (c.type === 'road') {
        // a fixed camera beside the road, `ahead` metres in front of the car
        const W = g.world, S = W.samples, N = S.length;
        const i = (pl.trackIndex + Math.round((c.ahead ?? 60) / 2)) % N;
        const a = S[i];
        this.base = { x: a.x + a.nx * (c.side ?? 6), y: a.y + (c.up ?? 1.2), z: a.z + a.nz * (c.side ?? 6) };
      }
    },
    update(rp, s, dt, look, menu) {
      const c = this.c;
      if (!c || c.type === 'game') return orig(rp, s, dt, look, menu);
      if (c.type === 'fixed') return;
      const t = this.n > 1 ? Math.min(1, this.f / (this.n - 1)) : 0;
      const k = c.ease === false ? t : ease(t);
      this.f++;
      this.sy += wrap(rp.yaw - this.sy) * Math.min(1, dt * (c.yawK ?? 4));
      const y = this.sy;
      const fx = Math.sin(y), fz = Math.cos(y), lx = Math.cos(y), lz = -Math.sin(y);
      const P = (v0, v1) => (Array.isArray(v0) ? lerp(v0[0], v0[1], k) : v0 ?? v1);
      let px, py, pz;
      const fov = P(c.fov, 55);
      let tx, ty, tz;
      if (c.type === 'road') {
        ({ x: px, y: py, z: pz } = this.base);
        tx = rp.x; ty = rp.y + (c.lookUp ?? 0.7); tz = rp.z;
      } else {
        // a camera tied to the car: `back` behind, `side` to the side, `up` above; `orbit` rotates it round the car
        const back = P(c.back, 6), side = P(c.side, 0), up = P(c.up, 1.6), orb = P(c.orbit, 0);
        const co = Math.cos(orb), so = Math.sin(orb);
        const bx = -fx * back + lx * side, bz = -fz * back + lz * side;
        px = rp.x + bx * co - bz * so; pz = rp.z + bx * so + bz * co; py = rp.y + up;
        const ah = P(c.ahead, 4);
        tx = rp.x + fx * ah; ty = rp.y + P(c.lookUp, 0.8); tz = rp.z + fz * ah;
      }
      const sh = c.shake ? c.shake * (0.6 + 0.4 * Math.sin(this.f * 0.7)) : 0;
      if (sh) {
        const q = this.f * 1.7;
        px += Math.sin(q * 2.3) * sh * 0.05; py += Math.sin(q * 3.1) * sh * 0.04; pz += Math.cos(q * 1.9) * sh * 0.05;
      }
      cam.position.set(px, py, pz);
      cam.up.set(0, 1, 0);
      cam.lookAt(tx, ty, tz);
      if (c.roll) cam.rotateZ(c.roll);
      if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
    },
    grab() { return cv.toDataURL('image/jpeg', 0.93); },
    size() { return [cv.width, cv.height]; },
    info() {
      const s = pl.s;
      const pol = race.cars.filter((c) => !c.isPlayer).map((c) => Math.round(Math.hypot(c.s.x - s.x, c.s.z - s.z)));
      const cops = race.pursuit ? race.pursuit.traffic().map((c) => Math.round(Math.hypot(c.s.x - s.x, c.s.z - s.z))) : [];
      return { kmh: Math.round(s.speed * 3.6), lapKm: +(pl.lap.distance / 1000).toFixed(2), idx: pl.trackIndex, rivals: pol, cops };
    },
    // run the game ahead quickly without drawing (seconds): every system updates, nothing renders
    skip(sec) {
      const keep = [g.post.render, g.pview.renderSpotShadow, g.renderMirror];
      g.post.render = () => {}; g.pview.renderSpotShadow = () => {}; g.renderMirror = () => {};
      const c = this.c; this.c = { type: 'game' };
      window.__step(Math.max(1, Math.round(sec * 10)), 100);
      this.c = c;
      [g.post.render, g.pview.renderSpotShadow, g.renderMirror] = keep;
      return this.info();
    },
    // skip ahead until cond() is true (checked every 0.3 s), at most maxSec
    until(cond, maxSec) {
      let t = 0;
      while (t < maxSec && !cond()) { this.skip(0.3); t += 0.3; }
      return Object.assign(this.info(), { waited: +t.toFixed(1), ok: cond() });
    },
    sunAlign() { const d = g.visuals.sunDir; return Math.cos(pl.s.yaw - Math.atan2(d.x, d.z)); },
    copBehind() {
      if (!race.pursuit) return 1e9;
      let best = 1e9; const s = pl.s, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      for (const u of race.pursuit.units) { if (!u.active) continue; const c = u.car; const dx = c.s.x - s.x, dz = c.s.z - s.z; if (dx * fx + dz * fz < 0) best = Math.min(best, Math.hypot(dx, dz)); }
      return best;
    },
    nearest() {
      let best = 1e9; const s = pl.s;
      for (const c of race.cars) { if (c.isPlayer) continue; best = Math.min(best, Math.hypot(c.s.x - s.x, c.s.z - s.z)); }
      return best;
    },
    rivalAhead() {
      let best = 1e9; const s = pl.s, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      for (const c of race.cars) { if (c.isPlayer) continue; const dx = c.s.x - s.x, dz = c.s.z - s.z; if (dx * fx + dz * fz > 0) best = Math.min(best, Math.hypot(dx, dz)); }
      return best;
    },
    // put police units on the road just behind the player, at the player's speed
    callCops(n, back) {
      const P = race.pursuit;
      if (!P) return 'no pursuit';
      const us = P.units.filter((u) => u.kind !== 'rammer').slice(0, n);
      us.forEach((u, k) => {
        P.deploy(u, pl, back + k * 14, k % 2 ? 3 : -3);
        const v = pl.s.speed * 1.03, y = u.car.s.yaw;
        u.car.s.vx = Math.sin(y) * v; u.car.s.vz = Math.cos(y) * v; u.target = pl;
      });
      return us.length + ' cops ' + this.copBehind();
    },
    kmNow() {
      const S = g.world.samples, N = S.length, L = g.world.trackLength;
      const d = S[pl.trackIndex].s - S[g.world.startIndex].s;
      return (((d % L) + L) % L) / 1000;
    },
    look(px, py, pz, tx, ty, tz, fov) {
      cam.position.set(px, py, pz); cam.up.set(0, 1, 0); cam.lookAt(tx, ty, tz); cam.fov = fov || 50; cam.updateProjectionMatrix(); return 'ok';
    },
    turn() { return Math.abs(pl.s.yawRate ?? 0); },
    strike() {
      const d = new V3();
      cam.getWorldDirection(d);
      g.env.sky.test('strike', d);
      return 'strike';
    },
  };
  rig.update = (...a) => T.update(...a);
  // no speed lines from a camera that isn't riding with the car, and never the nitro streaks
  const pr = g.post.render.bind(g.post);
  g.post.render = function (time, speed, boost, flash) {
    const c = T.c;
    const riding = !c || c.type === 'game' || (c.type === 'rel' && (Array.isArray(c.back) ? c.back[0] : c.back ?? 6) > 0);
    return pr(time, riding ? speed : 0, 0, flash);
  };
  g.updateTags = function () { for (const t of this.tags) if (t) t.visible = false; };
  window.__T = T;
  return { canvas: [cv.width, cv.height], kmh: Math.round(pl.s.speed * 3.6), cars: race.cars.length, pursuit: !!race.pursuit };
})()
