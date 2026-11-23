// ─────────────────────────────────────────────────────────────────────────────
// AudioEngine — everything you hear is synthesised live with the Web Audio API (no samples):
// layered engine tone that follows RPM and load, intake roar, turbo blow-off, tyre squeal,
// grass rumble, wind, nitrous, impacts, gear changes, horn and UI blips.
// Browsers only allow audio after a user gesture, so start() must be called from a click/key.
// ─────────────────────────────────────────────────────────────────────────────
import { VEHICLE as V } from '../config';
import { clamp01, smoothstep } from '../core/math';
import { VehicleState } from '../vehicle/VehiclePhysics';

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private duck!: GainNode;
  private engineBus!: GainNode;
  private fxBus!: GainNode;
  private sirenBus!: GainNode;
  private duckLevel = 1;
  private mixLevels = { engine: 1, fx: 1, siren: 1 };
  /** 0 = outside the car, 1 = in the cockpit (eased by the caller) */
  cabin = 0;
  private noise!: AudioBuffer;
  private volume = 0.8;
  // engine
  private oscA!: OscillatorNode;
  private oscB!: OscillatorNode;
  private oscSub!: OscillatorNode;
  private lump!: OscillatorNode;
  private lumpDepth!: GainNode;
  private engFilter!: BiquadFilterNode;
  private engGain!: GainNode;
  private roarFilter!: BiquadFilterNode;
  private roarGain!: GainNode;
  // continuous layers
  private squealGain!: GainNode;
  private squealFilter!: BiquadFilterNode;
  private rumbleGain!: GainNode;
  private gravelGain!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private nitroGain!: GainNode;
  private hornGain!: GainNode;
  private prevThrottle = 0;
  // weather
  private rainGain: GainNode | null = null;
  private hissGain: GainNode | null = null;
  private rainLevel = 0;
  /** 0..1: how wet the road is (tyre hiss) */
  wet = 0;
  private muted = false;

  /** Create (or resume) the audio graph. Returns false if the browser still has it suspended. */
  start(): boolean {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.build();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      return this.ctx.state === 'running';
    } catch {
      return false;
    }
  }

  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** 4C.2: per-category levels (Settings → Sound) */
  setMix(engine: number, fx: number, siren: number): void {
    this.mixLevels = { engine, fx, siren };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engineBus.gain.setTargetAtTime(engine, t, 0.05);
    this.fxBus.gain.setTargetAtTime(fx, t, 0.05);
    this.sirenBus.gain.setTargetAtTime(siren, t, 0.05);
  }

  /** 4C.2: how loud the game is while music plays (1 = no ducking) */
  setDuck(k: number): void {
    this.duckLevel = k;
    if (this.ctx) this.duck.gain.setTargetAtTime(k, this.ctx.currentTime, 0.4);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05);
  }
  /** Fade everything out (pause menu) or back in. */
  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.08);
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start();
    return src;
  }

  private build(): void {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    // 4C.2: mixer — engine, effects and sirens buses into master, then the music duck
    this.duck = ctx.createGain();
    this.duck.gain.value = this.duckLevel;
    this.master.connect(this.duck).connect(comp).connect(ctx.destination);
    this.engineBus = ctx.createGain();
    this.fxBus = ctx.createGain();
    this.sirenBus = ctx.createGain();
    for (const [bus, v] of [[this.engineBus, this.mixLevels.engine], [this.fxBus, this.mixLevels.fx], [this.sirenBus, this.mixLevels.siren]] as const) {
      bus.gain.value = v;
      bus.connect(this.master);
    }

    // shared white-noise buffer
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 16807) % 2147483647;
      d[i] = (seed / 2147483647) * 2 - 1;
    }

    // ── Engine: two detuned saws + a square sub through a soft clipper and a moving low-pass ──
    this.oscA = ctx.createOscillator();
    this.oscA.type = 'sawtooth';
    this.oscB = ctx.createOscillator();
    this.oscB.type = 'sawtooth';
    this.oscSub = ctx.createOscillator();
    this.oscSub.type = 'square';
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    const gA = ctx.createGain();
    gA.gain.value = 0.5;
    const gB = ctx.createGain();
    gB.gain.value = 0.28;
    const gS = ctx.createGain();
    gS.gain.value = 0.42;
    this.oscA.connect(gA).connect(mix);
    this.oscB.connect(gB).connect(mix);
    this.oscSub.connect(gS).connect(mix);
    // "lump": amplitude wobble at half the firing rate gives the idle its uneven burble
    this.lump = ctx.createOscillator();
    this.lump.type = 'sine';
    this.lumpDepth = ctx.createGain();
    this.lumpDepth.gain.value = 0.2;
    this.lump.connect(this.lumpDepth).connect(mix.gain);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(257);
    for (let i = 0; i < 257; i++) {
      const x = (i / 128 - 1) * 2.4;
      curve[i] = Math.tanh(x);
    }
    shaper.curve = curve;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.Q.value = 1.2;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    mix.connect(shaper).connect(this.engFilter).connect(this.engGain).connect(this.engineBus);
    for (const o of [this.oscA, this.oscB, this.oscSub, this.lump]) o.start();
    // intake / exhaust roar: band-passed noise that opens up with throttle
    this.roarFilter = ctx.createBiquadFilter();
    this.roarFilter.type = 'bandpass';
    this.roarFilter.Q.value = 0.9;
    this.roarGain = ctx.createGain();
    this.roarGain.gain.value = 0;
    this.noiseSource().connect(this.roarFilter).connect(this.roarGain).connect(this.engineBus);

    // ── Tyres ──
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.frequency.value = 1050;
    this.squealFilter.Q.value = 6;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    this.noiseSource().connect(this.squealFilter).connect(this.squealGain).connect(this.fxBus);
    const rumbleF = ctx.createBiquadFilter();
    rumbleF.type = 'lowpass';
    rumbleF.frequency.value = 220;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.noiseSource().connect(rumbleF).connect(this.rumbleGain).connect(this.fxBus);
    // ── 4E: gravel rattle: stones hitting the floor pan ──
    const gBp = ctx.createBiquadFilter();
    gBp.type = 'bandpass';
    gBp.frequency.value = 1900;
    gBp.Q.value = 0.6;
    this.gravelGain = ctx.createGain();
    this.gravelGain.gain.value = 0;
    // crackle: the noise is chopped by a fast, irregular gate
    const gate = ctx.createGain();
    gate.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 23;
    const lfo2 = ctx.createOscillator();
    lfo2.type = 'square';
    lfo2.frequency.value = 37;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.25;
    lfo.connect(lfoG).connect(gate.gain);
    lfo2.connect(lfoG);
    lfo.start();
    lfo2.start();
    this.noiseSource().connect(gBp).connect(gate).connect(this.gravelGain).connect(this.fxBus);

    // ── Wind ──
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.noiseSource().connect(this.windFilter).connect(this.windGain).connect(this.fxBus);

    // ── Nitrous hiss ──
    const nf = ctx.createBiquadFilter();
    nf.type = 'highpass';
    nf.frequency.value = 2600;
    this.nitroGain = ctx.createGain();
    this.nitroGain.gain.value = 0;
    this.noiseSource().connect(nf).connect(this.nitroGain).connect(this.engineBus);

    // ── Horn (two-tone) ──
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    for (const f of [415, 523]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(this.hornGain);
      o.start();
    }
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 2400;
    this.hornGain.connect(hf).connect(this.fxBus);

    // ── Rain: a soft wash of filtered noise, plus a patter layer; tyre hiss on a wet road ──
    const rainHp = ctx.createBiquadFilter();
    rainHp.type = 'highpass';
    rainHp.frequency.value = 700;
    const rainLp = ctx.createBiquadFilter();
    rainLp.type = 'lowpass';
    rainLp.frequency.value = 5200;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.noiseSource().connect(rainHp).connect(rainLp).connect(this.rainGain).connect(this.fxBus);
    const hissBp = ctx.createBiquadFilter();
    hissBp.type = 'bandpass';
    hissBp.frequency.value = 2600;
    hissBp.Q.value = 0.7;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    this.noiseSource().connect(hissBp).connect(this.hissGain).connect(this.fxBus);
    this.setRain(this.rainLevel);
  }

  // ── Police sirens: two voices for the two nearest units, with Doppler ──
  private sirens: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode }[] = [];
  private sirenT = 0;
  /**
   * voices: for each of the nearest police cars, its distance (m) and closing speed (m/s,
   * + = coming towards you). Wail rises and falls; the pitch shifts with the closing speed.
   */
  /**
   * Sirens on the nearest units (4B). Mode by situation: wail far off, yelp when closing in,
   * phaser right on you. Doppler from the closing speed.
   */
  setSirens(voices: { dist: number; closing: number; phase: number; mode?: 'wail' | 'yelp' | 'phaser' }[], dt: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (!this.sirens.length) {
      for (let i = 0; i < 2; i++) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const osc2 = ctx.createOscillator();
        osc2.type = 'square';
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1400;
        filter.Q.value = 0.8;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const g2 = ctx.createGain();
        g2.gain.value = 0.35;
        osc.connect(filter);
        osc2.connect(g2).connect(filter);
        filter.connect(gain).connect(this.sirenBus);
        osc.start();
        osc2.start();
        this.sirens.push({ osc, osc2, gain, filter });
      }
    }
    this.sirenT += dt;
    const t = ctx.currentTime;
    this.sirens.forEach((v, i) => {
      const s = voices[i];
      if (!s) {
        v.gain.gain.setTargetAtTime(0, t, 0.2);
        return;
      }
      // wail: a slow rise and fall between 650 and 1350 Hz; yelp: the same sweep, fast;
      // phaser: a very fast, higher warble
      const mode = s.mode ?? 'wail';
      const period = mode === 'wail' ? 3.2 : mode === 'yelp' ? 0.32 : 0.085;
      const ph = (this.sirenT / period + s.phase) % 1;
      const tri = ph < 0.5 ? ph * 2 : (1 - ph) * 2;
      const shape = tri * tri * (3 - 2 * tri);
      const base = mode === 'phaser' ? 900 + 900 * shape : 650 + 700 * shape;
      const doppler = 343 / (343 - Math.max(-80, Math.min(80, s.closing)));
      const tc = mode === 'wail' ? 0.02 : 0.004;
      v.osc.frequency.setTargetAtTime(base * doppler, t, tc);
      v.osc2.frequency.setTargetAtTime(base * 1.005 * doppler, t, tc);
      const g = 0.11 / (1 + (s.dist / 22) ** 2);
      v.gain.gain.setTargetAtTime(g, t, 0.08);
    });
  }

  /** A police horn blast (two flat tones), quieter with distance. */
  horn2(dist: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    const vol = 0.16 / (1 + (dist / 14) ** 2);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.setValueAtTime(vol, t + 0.42);
    g.gain.linearRampToValueAtTime(0, t + 0.5);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    g.connect(f).connect(this.sirenBus);
    for (const hz of [330, 415]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = hz;
      o.connect(g);
      o.start(t);
      o.stop(t + 0.52);
    }
  }

  // ── 4E: Air One — rotor thump (felt before it's seen), turbine whine, Doppler, panning ──
  private heliNodes: { lfo: OscillatorNode; body: OscillatorNode; thump: GainNode; whine: OscillatorNode; whine2: OscillatorNode; whineGain: GainNode; pan: StereoPannerNode } | null = null;
  /**
   * dist (m), closing speed (m/s, + = coming towards you), pan −1..1 (left..right of the view),
   * 0 when it isn't up.
   */
  setHeli(dist: number, closing: number, pan: number, on: boolean): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (!this.heliNodes) {
      if (!on) return;
      // blade slap: a pulse train (sharp peaks) gating low noise and a low sine
      const lfo = ctx.createOscillator();
      lfo.type = 'sawtooth';
      lfo.frequency.value = 17;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) curve[i] = Math.pow(i / 255, 7);
      shaper.curve = curve;
      const slap = ctx.createGain();
      slap.gain.value = 0;
      lfo.connect(shaper).connect(slap.gain);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 260;
      this.noiseSource().connect(lp).connect(slap);
      const body = ctx.createOscillator();
      body.type = 'sine';
      body.frequency.value = 34;
      const bodyG = ctx.createGain();
      bodyG.gain.value = 0.9;
      body.connect(bodyG).connect(slap);
      const thump = ctx.createGain();
      thump.gain.value = 0;
      const pan = ctx.createStereoPanner();
      slap.connect(thump).connect(pan);
      // turbine whine
      const whine = ctx.createOscillator();
      whine.type = 'sine';
      whine.frequency.value = 3100;
      const whine2 = ctx.createOscillator();
      whine2.type = 'triangle';
      whine2.frequency.value = 5240;
      const wbp = ctx.createBiquadFilter();
      wbp.type = 'bandpass';
      wbp.frequency.value = 3800;
      wbp.Q.value = 0.5;
      const whineGain = ctx.createGain();
      whineGain.gain.value = 0;
      whine.connect(wbp);
      whine2.connect(wbp);
      wbp.connect(whineGain).connect(pan);
      pan.connect(this.sirenBus);
      lfo.start();
      body.start();
      whine.start();
      whine2.start();
      this.heliNodes = { lfo, body, thump, whine, whine2, whineGain, pan };
    }
    const n = this.heliNodes;
    const t = ctx.currentTime;
    const doppler = 343 / (343 - Math.max(-90, Math.min(90, closing)));
    n.lfo.frequency.setTargetAtTime(17 * doppler, t, 0.08);
    n.body.frequency.setTargetAtTime(34 * doppler, t, 0.08);
    n.whine.frequency.setTargetAtTime(3100 * doppler, t, 0.08);
    n.whine2.frequency.setTargetAtTime(5240 * doppler, t, 0.08);
    // the thump carries a long way; the whine only up close
    n.thump.gain.setTargetAtTime(on ? 0.55 / (1 + (dist / 75) ** 2) : 0, t, 0.25);
    n.whineGain.gain.setTargetAtTime(on ? 0.03 / (1 + (dist / 28) ** 2) : 0, t, 0.25);
    n.pan.pan.setTargetAtTime(Math.max(-0.85, Math.min(0.85, pan)), t, 0.1);
  }

  /** A shock charge going off, `dist` m away. */
  boom(dist: number): void {
    const a = 1 / (1 + (dist / 40) ** 2);
    this.burst(2600, 90, 0.6, 0.6 * a + 0.05, 0.9, 'lowpass');
    this.tone(60, 24, 0.7 * a + 0.04, 0.7);
    this.burst(6000, 3000, 1, 0.16 * a, 0.12, 'highpass'); // the crack
  }
  // ── 4G.3 thunder: made once as real sound samples, then played per strike ──────────────
  private thunderBufs: { rumble: AudioBuffer; env: Float32Array }[] = [];
  private crackBufs: AudioBuffer[] = [];

  /**
   * Builds three rumbles and three cracks (about 30 ms of work, once, at the first strike).
   * A rumble: a deep boom (a falling 65→36 Hz thump with brown noise) that settles into one
   * long rolling rumble, swelling and grumbling as it fades over 5-7 s. Brown noise carries most
   * of its weight in the bass, with enough 100-400 Hz in it to come through small speakers.
   * `env` is its loudness every 20 ms: the controller's rumble follows the same curve.
   */
  private makeThunder(): void {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    let seed = 4242;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let v = 0; v < 3; v++) {
      const len = 5.2 + v * 0.8;
      const n = Math.floor(len * sr);
      const buf = ctx.createBuffer(1, n, sr);
      const out = buf.getChannelData(0);
      const env = new Float32Array(Math.ceil(len / 0.02));
      // the rolls: a few slow swells as the sound comes back off cloud and hills
      const rolls = Array.from({ length: 3 + v }, (_, i) => ({ at: 0.9 + i * (0.8 + rnd() * 0.9), w: 0.35 + rnd() * 0.5, h: 0.35 + rnd() * 0.4 }));
      let brown = 0;
      let low = 0;
      let mid = 0;
      let grumble = 0;
      let gTarget = 1;
      let peak = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const white = rnd() * 2 - 1;
        brown = (brown + 0.025 * white) / 1.025;
        low += (brown - low) * 0.06;
        mid += (white - mid) * 0.035;
        if (i % 512 === 0) gTarget = 0.55 + rnd() * 0.7; // grumbling: the level wanders
        grumble += (gTarget - grumble) * 0.0009;
        // loudness: the boom, then the rumble with its rolls, all fading away
        const boom = t < 0.03 ? t / 0.03 : Math.exp(-(t - 0.03) / 0.55);
        let roll = 0;
        for (const r of rolls) roll += r.h * Math.exp(-(((t - r.at) / r.w) ** 2));
        const tail = Math.exp(-t / (len * 0.42)) * Math.min(1, t / 0.15);
        const e = Math.max(boom, (0.45 + roll) * tail) * Math.min(1, (len - t) / 0.6);
        // the thump in the chest
        const f = 36 + 29 * Math.exp(-t / 0.35);
        const thump = Math.sin(2 * Math.PI * f * t + Math.sin(t * 7) * 0.4) * Math.exp(-t / 0.7) * 0.75;
        const x = (low * 9.5 + brown * 2.2 + mid * 0.55) * e * (0.7 + 0.3 * grumble) + thump * Math.min(1, t / 0.02);
        out[i] = x;
        peak = Math.max(peak, Math.abs(x));
        if (i % Math.floor(sr * 0.02) === 0) env[Math.floor(t / 0.02)] = e * (0.7 + 0.3 * grumble);
      }
      const g = 0.92 / (peak || 1);
      for (let i = 0; i < n; i++) out[i] *= g;
      this.thunderBufs.push({ rumble: buf, env });
    }
    // cracks: a tearing run of sharp bursts over a tenth of a second, with a low knock
    for (let v = 0; v < 3; v++) {
      const n = Math.floor(0.5 * sr);
      const buf = ctx.createBuffer(1, n, sr);
      const out = buf.getChannelData(0);
      const bursts = Array.from({ length: 5 + v * 2 }, (_, i) => ({ at: i * (0.012 + rnd() * 0.022), k: 1 - i * 0.08 }));
      let prev = 0;
      let lp = 0;
      let peak = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const white = rnd() * 2 - 1;
        const hi = white - prev; // brighter: the edge of the noise
        prev = white;
        lp += (white - lp) * 0.08;
        let e = 0;
        for (const b of bursts) if (t >= b.at) e = Math.max(e, b.k * Math.exp(-(t - b.at) / 0.018));
        const body = Math.exp(-t / 0.12);
        const knock = Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t / 0.09);
        const x = hi * e * 0.9 + lp * body * 1.4 + knock * 0.6;
        out[i] = x;
        peak = Math.max(peak, Math.abs(x));
      }
      const g = 0.95 / (peak || 1);
      for (let i = 0; i < n; i++) out[i] *= g;
      this.crackBufs.push(buf);
    }
  }

  /** build the thunder ahead of time (call while it rains, so the first strike doesn't stutter) */
  prepareThunder(): void {
    if (this.ctx && this.ctx.state === 'running' && !this.thunderBufs.length) this.makeThunder();
  }

  /**
   * 4G.3: thunder for a strike `dist` m away, starting with the flash: a crack on every flash of
   * the bolt (`strokes`, s from now), the boom right behind the first, then the rumble. Far
   * strikes are quieter and duller. Returns the rumble's loudness curve (every 20 ms, 0..1, and
   * when it starts) for the controller, or null if the sound is off.
   */
  thunder(dist: number, strokes: number[], amp = 1): { env: Float32Array; rate: number; start: number; level: number } | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    if (!this.thunderBufs.length) this.makeThunder();
    const near = 1 / (1 + (dist / 1300) ** 2);
    const level = (0.55 + 0.45 * near) * (0.7 + 0.3 * amp);
    const t0 = ctx.currentTime + 0.02;
    // one chain for this strike: dull with distance, a bass lift, then the effects bus
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = Math.max(700, 9000 - dist * 3.2);
    air.Q.value = 0.4;
    const bass = ctx.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 110;
    bass.gain.value = 6;
    const vol = ctx.createGain();
    vol.gain.value = 1.9 * level;
    air.connect(bass).connect(vol).connect(this.fxBus);
    const pick = this.thunderBufs[Math.floor(Math.random() * this.thunderBufs.length)];
    // a lower, slower playback for the big ones: deeper and longer
    const rate = 0.82 + Math.random() * 0.2 + (1 - near) * 0.06;
    const r = ctx.createBufferSource();
    r.buffer = pick.rumble;
    r.playbackRate.value = rate;
    const rg = ctx.createGain();
    rg.gain.value = 1;
    r.connect(rg).connect(air);
    const boomAt = t0 + 0.05 + dist / 9000; // a breath after the first crack, a touch later when far
    r.start(boomAt);
    // the cracks, on each flash (close strikes crack hard; far ones barely)
    const crackK = Math.max(0.08, near * 1.1);
    strokes.forEach((st, i) => {
      const c = ctx.createBufferSource();
      c.buffer = this.crackBufs[(i + Math.floor(Math.random() * 3)) % this.crackBufs.length];
      c.playbackRate.value = 0.9 + Math.random() * 0.25;
      const cg = ctx.createGain();
      cg.gain.value = crackK * (i === 0 ? 1 : 0.6);
      c.connect(cg).connect(air);
      c.start(t0 + st);
    });
    return { env: pick.env, rate, start: boomAt - ctx.currentTime, level };
  }

  /** A smoke canister landing and starting to hiss. */
  canister(dist: number): void {
    const a = 1 / (1 + (dist / 30) ** 2);
    this.tone(420, 180, 0.12 * a, 0.12, 'triangle');
    this.burst(4200, 1800, 0.8, 0.12 * a, 1.6, 'highpass');
  }

  /** Radio squelch before / after a dispatcher line. */
  squelch(): void {
    this.burst(2400, 1200, 1.2, 0.06, 0.14);
  }

  /** Speed-camera flash and spike-strip pop. */
  camera(): void {
    this.burst(5200, 3000, 2, 0.12, 0.08, 'highpass');
  }
  spikes(): void {
    this.burst(900, 120, 0.8, 0.5, 0.5, 'lowpass');
    this.burst(3200, 600, 1, 0.18, 0.35);
  }

  /** 0..1 how hard it is raining (heard in races and behind the menus). */
  setRain(level: number): void {
    this.rainLevel = level;
    if (this.ctx && this.rainGain) this.rainGain.gain.setTargetAtTime(0.075 * level, this.ctx.currentTime, 0.4);
  }

  /** Per-frame update of every continuous layer. */
  update(s: VehicleState, horn: boolean): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const k = 0.035; // smoothing time constant
    const rpmN = clamp01((s.rpm - V.idleRpm) / (V.redlineRpm - V.idleRpm));
    const f = (s.rpm / 60) * 3;
    this.oscA.frequency.setTargetAtTime(f, t, k);
    this.oscB.frequency.setTargetAtTime(f * 2.012, t, k);
    this.oscSub.frequency.setTargetAtTime(f * 0.5, t, k);
    this.lump.frequency.setTargetAtTime(f * 0.25, t, k);
    this.lumpDepth.gain.setTargetAtTime(0.26 * (1 - rpmN), t, 0.1);
    const load = s.throttle * (s.shiftTimer > 0 ? 0.25 : 1);
    // Cabin mix (4A): inside the cockpit the exhaust is muffled (lower cut-off) but the cabin
    // booms (a little more engine body) and the intake behind your head is louder.
    const cab = this.cabin;
    this.engFilter.frequency.setTargetAtTime((260 + rpmN * 2600 + load * 2200) * (1 - 0.42 * cab), t, k);
    this.engGain.gain.setTargetAtTime((0.11 + 0.17 * load + 0.07 * rpmN) * (1 + 0.25 * cab), t, k);
    this.roarFilter.frequency.setTargetAtTime((350 + rpmN * 1900) * (1 - 0.2 * cab), t, k);
    this.roarGain.gain.setTargetAtTime((load * (0.03 + 0.11 * rpmN) + (s.nitroActive ? 0.05 : 0)) * (1 + 0.6 * cab), t, k);

    // tyres: squeal on tarmac, rumble on grass
    const slip = Math.max(s.wheelSlip[0], s.wheelSlip[1]) * 0.6 + Math.max(s.wheelSlip[2], s.wheelSlip[3]);
    const tarmac = 1 - s.onGrass;
    this.squealGain.gain.setTargetAtTime(Math.min(0.2, slip * 0.16) * tarmac * (s.airborne ? 0 : 1), t, 0.05);
    this.squealFilter.frequency.setTargetAtTime(850 + smoothstep(5, 50, s.speed) * 500 + s.wheelSpinSlip * 250, t, 0.08);
    this.rumbleGain.gain.setTargetAtTime((s.onGrass * 0.5 + s.onKerb * 0.35 + s.onGravel * 0.6) * smoothstep(1, 25, s.speed) * (s.airborne ? 0 : 1), t, 0.06);
    this.gravelGain.gain.setTargetAtTime(s.onGravel * 0.16 * smoothstep(1, 20, s.speed) * (s.airborne ? 0 : 1), t, 0.04);

    // wind
    const v = Math.min(1.2, s.speed / 100);
    this.windGain.gain.setTargetAtTime(0.16 * v * v * (1 - 0.55 * cab), t, 0.1);
    this.windFilter.frequency.setTargetAtTime(350 + v * 1900, t, 0.1);

    this.nitroGain.gain.setTargetAtTime(s.nitroActive ? 0.085 : 0, t, 0.04);
    if (this.hissGain) this.hissGain.gain.setTargetAtTime(this.wet * 0.09 * smoothstep(3, 60, s.speed) * (s.airborne ? 0 : 1), t, 0.08);
    this.hornGain.gain.setTargetAtTime(horn ? 0.07 : 0, t, 0.012);

    // turbo blow-off when you snap off the throttle at high revs
    if (this.prevThrottle > 0.75 && s.throttle < 0.2 && s.rpm > 4800) this.blowOff();
    this.prevThrottle = s.throttle;
  }

  private burst(freq0: number, freq1: number, q: number, gain: number, dur: number, type: BiquadFilterType = 'bandpass'): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, freq1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(this.fxBus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }
  private tone(freq0: number, freq1: number, gain: number, dur: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.fxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  blowOff(): void {
    this.burst(3200, 900, 2.5, 0.11, 0.32);
  }
  shift(up: boolean): void {
    this.burst(up ? 1800 : 1200, 500, 1.5, 0.05, 0.07);
    this.tone(up ? 140 : 110, 60, 0.12, 0.09);
  }
  nitroOn(): void {
    this.burst(900, 5200, 1.2, 0.2, 0.45, 'highpass');
    this.tone(120, 260, 0.14, 0.4, 'sawtooth');
  }
  /** strength ≈ velocity change in m/s */
  impact(strength: number): void {
    const a = clamp01(strength / 9);
    this.burst(1400 + a * 900, 180, 0.7, 0.14 + a * 0.4, 0.16 + a * 0.3, 'lowpass');
    this.tone(95, 36, 0.25 + a * 0.5, 0.2 + a * 0.2);
    if (a > 0.35) this.burst(4200, 2400, 3, 0.06 + a * 0.1, 0.5); // glass / debris tinkle
  }
  landing(strength: number): void {
    const a = clamp01(strength / 8);
    this.tone(70, 30, 0.3 + a * 0.5, 0.28);
    this.burst(600, 120, 0.7, 0.1 + a * 0.2, 0.2, 'lowpass');
  }
  propHit(kind: number): void {
    if (kind === 0) this.tone(360, 150, 0.16, 0.09, 'triangle');
    else {
      this.tone(150, 60, 0.3, 0.18, 'triangle');
      this.burst(900, 300, 1.2, 0.12, 0.14);
    }
  }
  /** Starting-light beep: three low, one high. */
  beep(go: boolean): void {
    this.tone(go ? 880 : 440, go ? 880 : 440, 0.16, go ? 0.55 : 0.18, 'square');
  }
  ui(kind: 'move' | 'accept' | 'back' | 'lap'): void {
    if (kind === 'move') this.tone(660, 640, 0.05, 0.05, 'triangle');
    else if (kind === 'accept') {
      this.tone(520, 1040, 0.08, 0.1, 'triangle');
    } else if (kind === 'back') this.tone(480, 240, 0.07, 0.1, 'triangle');
    else {
      this.tone(784, 784, 0.1, 0.12, 'triangle');
      setTimeout(() => this.tone(1175, 1175, 0.1, 0.22, 'triangle'), 110);
    }
  }
}
