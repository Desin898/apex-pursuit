// ─────────────────────────────────────────────────────────────────────────────
// APEX PURSUIT — the Phantom X1 on the proving grounds, racing a grid of AI rivals.
// Boots the renderer, builds the world, and runs the game loop:
//   poll input → fixed-step physics → effects / audio / rumble → camera → HUD → render
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { AudioEngine } from './audio/AudioEngine';
import { CAMERA_MODES, CameraRig, CarPose } from './camera/CameraRig';
import { AI, PAINTS, PHYSICS_DT, RECOVERY, STEER_ASSIST, StabilityMode, VEHICLE as V, PLAYER_ENGINE } from './config';
import { clamp, clamp01, damp, lerp, smoothstep, wrapAngle } from './core/math';
import { loadSettings, saveSettings, Settings, STEER_CURVES, STEER_LABELS } from './core/Settings';
import { Particles } from './fx/Particles';
import { PostFX, Quality, QUALITY } from './fx/PostFX';
import { SkidMarks } from './fx/SkidMarks';
import { formatLap, LapTimer } from './game/LapTimer';
import { CarSpec, Difficulty, Race, validNetCar } from './game/Race';
import type { BoardRow } from './ui/Screens';
import { Haptics } from './input/Haptics';
import { OnlineSession } from './net/OnlineSession';
import { ActionName, DeviceKind, deviceLabel, glyph, InputManager } from './input/InputManager';
import { HUD } from './ui/HUD';
import { Menu, MenuPage } from './ui/Menu';
import { renderCards } from './ui/CardRenders';
import { artUrl } from './ui/art';
import { Screens } from './ui/Screens';
import { defaultLoadout, DriverAids, EDITIONS, lookFromPaint, lookOf, modelOf, tunedVehicle } from './vehicle/Cars';
import { PhantomX1 } from './vehicle/PhantomX1';
import { loadImportedCars, makeCarVisual, registerImportedCars } from './vehicle/ImportedCars';
import { Cockpit } from './vehicle/Cockpit';
import { VehicleInput, VehiclePhysics, VehicleState, WHEEL_X, WHEEL_Z } from './vehicle/VehiclePhysics';
import { PropSystem } from './world/Props';
import { buildWorld, WorldVisuals } from './world/WorldBuilder';
import { Surface, WorldData } from './world/WorldData';
import { Conditions, Environment, WEATHERS } from './world/Environment';
import { PursuitView } from './world/PursuitView';
import { staticBatch } from './world/StaticBatch';
import { PhotoMode } from './ui/PhotoMode';
import { GpuTimer } from './fx/GpuTimer';
import { prof } from './core/Profiler';
import { DETAIL_LAYER, mainOnly } from './core/layers';
import { Ghost } from './game/Ghost';
import { vegUniforms } from './world/Vegetation';
import { MusicLibrary } from './audio/MusicLibrary';
import { MusicMenu } from './ui/MusicMenu';
import { venueById } from './world/venues';
import { cleanRoom, relaySocketUrl, servedByRelay, TransportOptions } from './net/Transport';
import { FarShadow, PaintProbe, PlanarReflection, groundUniforms, patchGround, setGroundFeatures } from './fx/Reflections';
import type { MapIcon } from './ui/HUD';
import type { PursuitEvent } from './game/Pursuit';
import { EVENTS, LENS, PERF, POLICE, POLICE_LOOK, RACE_FLOW, WORLD } from './config';

type State = 'menu' | 'playing' | 'paused' | 'results' | 'photo';
/** Speed Points for each finishing place */
const PLACE_BONUS = [1500, 1000, 700, 500, 350, 250, 150, 100];
const QUALITY_ORDER: Quality[] = ['low', 'medium', 'high', 'ultra'];
const pct = (v: number) => `${Math.round(v * 100)}%`;

class Game {
  private settings: Settings = loadSettings();
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  // 4D: the venue comes from ?venue= or the saved setting; switching venue reloads the page
  private world = new WorldData(venueById(new URLSearchParams(location.search).get('venue') ?? loadSettings().venue));
  private visuals: WorldVisuals;
  private env!: Environment;
  private photo!: PhotoMode;
  private dynTick = 0;
  private gpu!: GpuTimer;
  private ghost!: Ghost;
  private ghostCar: PhantomX1 | null = null;
  private ghostLastT = 0;
  private mirrorCam = new THREE.PerspectiveCamera(32, 3.6, 0.3, 1500);
  private refl = new PlanarReflection();
  private probe = new PaintProbe();
  private farShadow: FarShadow | null = null;
  private bakedFor = '';
  /** a circuit race to a lap count, or an endless free run */
  private mode: 'race' | 'free' = 'race';
  /** Everyone on track. race.cars[0] is the player; carVisuals runs parallel to it. */
  private race = this.makeRace();
  private online = new OnlineSession(() => this.race, this.settings);
  private carVisuals: PhantomX1[] = [];
  /** the player's interior for the cockpit camera (4A) */
  private cockpit = new Cockpit();
  private cabin = 0;
  private tags: (THREE.Sprite | null)[] = [];
  private renderPoses: CarPose[] = [];
  private props: PropSystem;
  private particles: Particles;
  private pview!: PursuitView;
  private skids: SkidMarks;
  private rig: CameraRig;
  private post: PostFX;
  private input = new InputManager();
  private haptics = new Haptics();
  private audio = new AudioEngine();
  /** 4G.2: music paused by "music in races: off" (shared online as stopped) */
  private musicHeld = false;
  private hud = new HUD(this.world);
  private menu = new Menu();
  private screens: Screens;
  /** where the list menu was opened from: the pause menu in a race, or settings from home */
  private menuFrom: 'pause' | 'home' = 'pause';
  private cardShots: string[] = [];
  private attractT = 0;
  // race flow
  private finishHandled = false;
  private finishT = 0;
  private raceEarned = 0;
  private timeScale = 1;
  private fading = false;
  private alertKey = '';

  private state: State = 'menu';
  private last = performance.now();
  private acc = 0;
  private time = 0;
  private pendingShiftUp = false;
  private pendingShiftDown = false;
  private wasNitro = false;
  private boost = 0;
  private impactFlash = 0;
  private driftScore = 0;
  private driftHold = 0;
  private smokeAcc: number[] = [];
  // perf tracking
  private fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private slowTime = 0;
  private stepsLast = 0;

  // The player's car, for the code that only cares about the player (camera, HUD, rumble, audio).
  private get physics(): VehiclePhysics {
    return this.race.player.physics;
  }
  private get car(): PhantomX1 {
    return this.carVisuals[0];
  }
  private get lap(): LapTimer {
    return this.race.player.lap;
  }
  private get pose(): CarPose {
    return this.race.player.s;
  }
  private get prev(): CarPose {
    return this.race.player.prev;
  }

  constructor(private canvas: HTMLCanvasElement) {
    // 4.5: a car from a car pack that is not here any more: back to the house car
    if (!EDITIONS.some((e) => e.id === this.settings.loadout.edition)) this.settings.loadout = defaultLoadout();
    this.musicMenu = new MusicMenu(this.music, this.settings, () => saveSettings(this.settings), (k) => this.audio.ui(k), (m) => this.hud.toast(m));
    this.screens = new Screens({
      music: this.musicMenu,
      settings: this.settings,
      save: () => saveSettings(this.settings),
      sound: (k) => this.audio.ui(k),
      lookChanged: () => this.applyLoadout(),
      race: () => this.screens.show('event'),
      freeRun: () => {
        this.mode = 'free';
        this.beginRace(false);
      },
      online: () => this.openOnlinePanel(),
      startRace: () => {
        this.mode = 'race';
        this.beginRace(true);
      },
      restart: () => this.restartFromResults(),
      nextEventName: () => this.nextEventName(),
      nextEvent: () => this.nextEvent(),
      eventName: () => this.eventName(),
      conditionsChanged: () => {
        if (this.online.status === 'online' && !this.online.isHost) return;
        const c = this.resolveConditions();
        if (this.settings.weather === 'random') c.weather = this.env.conditions.weather; // decided at the start
        this.applyConditions(c);
      },
      home: () => this.quitToHome(),
      gridRows: () => this.gridRows(),
      resultRows: () => this.resultRows(),
      resultInfo: () => {
        const p = this.race.player;
        const rows = this.race.results();
        const pz = this.race.pursuit;
        return { place: p.place, field: rows.length, time: p.finishTime, best: p.lap.best, earned: this.raceEarned, laps: this.race.targetLaps, over: this.race.over, bounty: pz ? pz.bounty : 0, bountyLog: pz ? [...pz.bountyLog.entries()].sort((a, b) => b[1] - a[1]) : [] };
      },
      trackShape: () => {
        const S = this.world.samples;
        const pts: [number, number][] = [];
        for (let i = 0; i < S.length; i += 2) pts.push([S[i].x, S[i].z]);
        return { pts, start: Math.floor(this.world.startIndex / 2), length: this.world.trackLength };
      },
      openSettings: () => {
        this.menuFrom = 'home';
        this.screens.show(null);
        this.menu.setDevice(this.input.device);
        this.menu.open(this.settingsPage());
      },
      onlineInfo: () => ({ status: this.online.status, players: this.online.players.length, host: this.online.isHost }),
      venueId: () => this.world.venue.id,
      switchVenue: (id) => {
        if (id === this.world.venue.id) return;
        this.settings.venue = id;
        saveSettings(this.settings);
        const u = new URL(location.href);
        u.searchParams.set('venue', id);
        location.href = u.toString(); // a new venue is a new world: load it fresh
      },
      cardImages: () => this.cardShots,
    });
    { const hv = document.getElementById('home-venue'); if (hv) hv.textContent = `${this.world.venue.name} · Phase 5`; }
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;

    this.visuals = buildWorld(this.scene, this.renderer, this.world);
    this.env = new Environment(this.scene, this.renderer, this.world, this.visuals);
    // 4G.3: thunder with the lightning: a crack on every flash, the boom and the rumble, and the
    // controller shaking in time with them. Races only (the menus stay quiet).
    this.env.sky.onStrike = (dist, strokes, amp) => {
      if (this.state !== 'playing') return;
      const near = 1 / (1 + (dist / 1300) ** 2);
      const sh = this.audio.thunder(dist, strokes, amp);
      strokes.forEach((st, i) => this.haptics.pulseAt(st, Math.min(1, (0.55 + 0.45 * near) * (i ? 0.75 : 1)), Math.min(1, 0.45 + 0.55 * near), 0.18));
      if (sh) this.haptics.follow(sh.env, 0.02 / sh.rate, sh.start, Math.min(1, 0.5 + 0.6 * near), 0.25 + 0.2 * near);
      else this.haptics.pulseAt(0.06, 0.5 + 0.5 * near, 0.3, 1.6);
    };
    // Phase 3D: wet-road mirror and distant shadows on the ground materials
    patchGround(this.visuals.mats.road, true);
    patchGround(this.visuals.mats.kerb, true);
    for (const m of this.visuals.mats.paved) patchGround(m, true);
    patchGround(this.visuals.mats.ground, false);
    if (this.world.field) patchGround(this.visuals.mats.terrain, false, 'mtn'); // 5A: far shadows on the mountain
    this.refl.hide.push(this.env.rain.lines);
    this.props = new PropSystem(this.scene, this.world);
    this.particles = new Particles(this.scene);
    this.pview = new PursuitView(this.scene, this.world, this.particles);
    this.pview.carRoots = () => this.carVisuals.map((v) => v.root);
    this.pview.carsForShadow = () => this.race.cars.filter((c) => !c.gone).map((c) => ({ x: c.s.x, z: c.s.z, yaw: c.s.yaw }));
    this.pview.attach(this.race.pursuit, this.settings.quality);
    // 4B.2: rain, particles and decals on the road are main-camera only (not in reflections / mirrors)
    for (const o of [this.env.rain.lines, this.env.rain.splashes, ...this.particles.objects(), ...this.env.roadDecals()]) mainOnly(o);
    // performance pass: merge static scenery into a few draw calls per map cell
    const sb = staticBatch(this.scene);
    console.info(`static batching: ${sb.before} meshes → ${sb.after}`);
    this.skids = new SkidMarks(this.scene);
    this.buildCarVisuals();

    this.rig = new CameraRig(1);
    this.applyCarSetup();
    this.rig.world = this.world;
    this.rig.cockpitEye = this.cockpit.eye;
    this.rig.camera.layers.enable(DETAIL_LAYER); // the main camera sees the details
    mainOnly(this.cockpit.root);
    this.photo = new PhotoMode(this.rig.camera, this.input, this.canvas);
    this.gpu = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext);
    this.detectGpu();
    this.ghost = new Ghost(this.settings.loadout.edition);
    this.post = new PostFX(this.renderer, this.scene, this.rig.camera);
    this.applyQuality(this.settings.quality);
    this.applySettings();
    this.applyConditions(this.resolveConditions());


    this.bindEvents();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ── Setup helpers ────────────────────────────────────────────────────────
  private bindEvents(): void {
    // 4D.1: say what's playing when a track starts during a race (the home screen has its own line)
    const showTrack = this.music.onTrack;
    this.music.onTrack = (t) => {
      showTrack(t);
      if (this.state === 'playing') this.hud.toast(`♪ ${t.title} — ${t.artist}`);
    };
    void this.music.load();
    // 4C.2: a friend opened the host's race link: offer to join as soon as the home screen is up
    if (servedByRelay()) {
      let tries = 0;
      const t = window.setInterval(() => {
        if (++tries > 120) clearInterval(t);
        if (this.state === 'menu' && document.getElementById('home')?.classList.contains('on') !== false) {
          clearInterval(t);
          this.openOnlinePanel();
        }
      }, 500);
    }
    // Browsers only allow audio and fullscreen from inside a real key/click handler.
    const gesture = () => {
      this.audio.start();
      this.audio.setVolume(this.settings.volume);
      this.music.setVolume(this.settings.musicVolume);
      this.music.unlock(this.settings.music);
    };
    window.addEventListener('keydown', (e) => {
      gesture();
      const typing = (e.target as HTMLElement | null)?.tagName === 'INPUT';
      if (typing) return;
      if (e.code === 'KeyF' && !e.repeat) this.toggleFullscreen();
      if (e.code === 'Backquote' || e.code === 'F3') {
        e.preventDefault();
        this.settings.debug = !this.settings.debug;
        saveSettings(this.settings);
      }
      if (e.code === 'F4' && !e.repeat) {
        e.preventDefault();
        if (this.state === 'playing') this.startBenchmark();
        else this.hud.toast('Start a race, then press F4 for the benchmark');
      }
    });
    window.addEventListener('pointerdown', gesture);
    window.addEventListener('blur', () => this.state === 'playing' && this.pause());
    document.addEventListener('visibilitychange', () => document.hidden && this.state === 'playing' && this.pause());

    this.input.onDeviceChange = (kind) => {
      this.menu.setDevice(kind);
      this.screens.setDevice(kind);
      if (this.state === 'playing') this.hud.setHints(kind, this.settings.manual, 9);
    };
    this.input.onPadConnection = (connected, _name, kind) => {
      if (connected) {
        this.hud.toast(`${deviceLabel(kind)} connected`);
        this.haptics.pulse(0.7, 0.5, 0.35);
      } else {
        this.hud.toast('Controller disconnected');
        if (this.state === 'playing') this.pause();
      }
    };
    this.online.onToast = (t) => this.hud.toast(t);
    this.online.getConditions = () => this.env.conditions;
    // 4G.2: the host shares what its music is playing; friends with the same track play it in time
    this.online.getMusic = () => {
      const m = this.music;
      if (this.settings.onlineMusic !== 'host' || !m.current || m.followingHost) return null;
      return { id: m.current.id, title: m.current.title, artist: m.current.artist, pos: m.position, on: m.state === 'playing' && !this.musicHeld };
    };
    this.music.onBlocked = () => this.hud.toast("The host picks the music online · Settings → Online music to play your own");
    this.online.onHostMusic = (m, late) => this.music.follow(this.settings.onlineMusic === 'host' ? m : null, late);
    this.online.onPursuit = (d) => {
      let p = this.race.pursuit;
      if (!p) {
        p = this.race.enablePursuit(1);
        p.setMirror(true);
        this.pview.attach(p, this.settings.quality);
        this.pview.setNight(this.env.p.carLights, this.env.p.wet);
      }
      if (p.mirror) p.unpack(d, this.race.netClock, validNetCar);
    };
    this.online.onConditions = (c) => {
      this.applyConditions(c);
      this.hud.toast(`Host set ${c.weather === 'clear' ? 'clear skies' : c.weather}, ${c.time}`);
    };
    this.online.onStatus = () => this.refreshOnlineUi();
    this.online.venueId = this.world.venue.id;
    // 4C.2: a friend dropped out mid-race — the AI drives their car
    this.online.onTakeOver = (netId, slot, name, host) => {
      const c = this.race.cars.find((x) => x.netId === netId);
      if (!c) return;
      if (host) this.race.takeOver(c, this.settings.difficulty, 4000 + slot * 31);
      else c.netId = `ai:${slot}`;
      c.name = name;
      c.gone = false;
      this.buildCarVisuals();
    };
    this.online.onRoster = (specs, host) => {
      this.rebuildRace(specs);
      this.race.clockExternal = !host;
      if (this.state === 'results') this.enterRace();
      this.hud.toast(host ? (specs.some((c) => c.kind === 'remote') ? 'New grid: you are hosting' : 'Online: waiting for friends to join') : 'Joined the race');
      this.refreshOnlineUi();
    };
    this.menu.onSound = (k) => this.audio.ui(k);
    this.menu.onClose = () => {
      if (this.menuFrom === 'home') {
        this.menu.close();
        this.screens.show('home', true);
      } else this.resume();
    };
  }

  private applySettings(): void {
    const s = this.settings;
    // 4C: tone mapping — Filmic (ACES, punchy) or Natural (AgX, softer highlights, truer colour)
    const tm = s.toneMap === 'natural' ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
    const ek = s.toneMap === 'natural' ? 1.3 : 1;
    if (this.renderer.toneMapping !== tm || this.env.exposureK !== ek) {
      this.renderer.toneMapping = tm;
      this.env.exposureK = ek;
      this.renderer.toneMappingExposure = this.env.p.exposure * ek;
    }
    this.post.lensCA = s.lensFx ? 1 : 0;
    this.env.sky.lightning = s.lightning;
    this.env.sky.meteorsOn = s.meteors;
    this.haptics.enabled = s.vibration;
    this.haptics.intensity = s.vibrationStrength;
    this.input.settings.deadzone = s.deadzone;
    this.input.settings.steerCurve = STEER_CURVES[s.steerSensitivity] ?? 1.6;
    this.physics.s.manual = s.manual;
    this.physics.setParams(tunedVehicle(this.race.player.edition, this.aids()));
    this.race.steerAssist = STEER_ASSIST[s.steerAssist] ?? 0;
    this.rig.shakeScale = s.cameraShake;
    this.audio.setVolume(s.volume);
    this.audio.setMix(s.mixEngine, s.mixFx, s.mixSiren);
    this.music.setVolume(s.musicVolume);
    this.hud.setUserScale(s.hudScale);
    document.documentElement.classList.toggle('colour-safe', s.colourSafe);
    this.hud.colourSafe = s.colourSafe;
    saveSettings(s);
  }

  /** Start-up work after the constructor, spread over frames so the loading screen can move. */
  async boot(progress: (f: number, label: string) => Promise<void>): Promise<void> {
    await progress(0.55, 'Preparing the cars');
    this.cardShots = renderCards(
      EDITIONS.map((e) => lookOf({ ...this.settings.loadout, edition: e.id, ...(e.id === this.settings.loadout.edition ? {} : { paint: null, customColor: null, finish: null, rim: null, caliper: null, underglow: null }) })),
      EDITIONS.map((e) => e.id),
    );
    await progress(0.75, 'Compiling shaders');
    try {
      this.renderer.compile(this.scene, this.rig.camera);
    } catch {
      /* optional */
    }
    await progress(0.95, 'Starting the engine');
    this.screens.show('home');
  }

  private applyQuality(q: Quality): void {
    const cfg = QUALITY[q];
    this.settings.quality = q;
    this.renderer.setPixelRatio(this.basePixelRatio() * this.renderScale);
    this.renderer.shadowMap.enabled = cfg.shadows > 0;
    this.visuals.setShadowQuality(cfg.shadows);
    this.visuals.veg.setQuality(q);
    this.visuals.dressing?.setQuality(q);
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (m) for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
    });
    this.post.aoOn = this.settings.ao; // 4C.1: GTAO is opt-in (it re-renders the whole scene)
    this.post.taa = this.settings.antiAlias === 'taa';
    this.post.configure(q, window.innerWidth, window.innerHeight);
    this.post.beforeScene = () => this.beforeScene();
    this.resize();
    this.probe.setSize(cfg.probe, this.scene);
    // sharper textures at grazing angles on the higher presets
    const aniso = Math.min(cfg.aniso, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m || Array.isArray(m)) return;
      for (const t of [m.map, m.normalMap, m.roughnessMap]) if (t && t.anisotropy !== aniso) (t.anisotropy = aniso), (t.needsUpdate = true);
    });
    if (this.env) this.applyConditions(this.env.conditions); // rain density and lamp lights follow the preset
  }

  // ── Weather and time of day ──────────────────────────────────────────────
  /** The event card's choice; Random picks one of the three weathers now. */
  private resolveConditions(): Conditions {
    const s = this.settings;
    const weather = s.weather === 'random' ? WEATHERS[Math.floor(Math.random() * WEATHERS.length)] : s.weather;
    return { weather, time: s.timeOfDay };
  }

  private applyConditions(c: Conditions): void {
    this.env.apply(c, this.settings.quality);
    this.visuals.dressing?.setSun?.(this.visuals.sunDir);
    const p = this.env.p;
    this.race.setWet(p.wet);
    this.audio.setRain(p.rain);
    this.audio.wet = p.wet;
    this.lookExtras();
    // wet-road mirror, baked distant shadow
    const cfg = QUALITY[this.settings.quality];
    this.particles.smokeScale = cfg.smoke;
    this.particles.sprayScale = { low: 0.4, medium: 0.7, high: 1, ultra: 1.25 }[this.settings.quality];
    groundUniforms.uWet.value = p.wet;
    groundUniforms.uRain.value = p.rain;
    setGroundFeatures(p.wet > 0 && cfg.reflect > 0, cfg.farShadow);
    this.env.streakScale = p.wet > 0 && cfg.reflect > 0 ? 0.35 : 1;
    const key = `${this.visuals.sunDir.x.toFixed(3)},${this.visuals.sunDir.y.toFixed(3)},${this.visuals.sunDir.z.toFixed(3)}`;
    if (cfg.farShadow && key !== this.bakedFor) {
      this.farShadow ??= new FarShadow();
      this.farShadow.bake(this.renderer, this.scene, this.visuals.sunDir, this.world.bounds.x, this.world.bounds.z, this.world.bounds.r + 60);
      this.bakedFor = key;
    }
  }

  /** The parts of the look that live outside Environment (grade, car lights, smoke, ground). */
  private lookExtras(): void {
    const p = this.env.p;
    const c = this.env.conditions;
    this.post.setLook(p.shadowTint, p.highTint, p.sat, p.bloom);
    for (const v of this.carVisuals) v.setNight(p.carLights);
    this.pview?.setNight(p.carLights, p.wet);
    const nightK = c.time === 'night' ? 1 : c.time === 'dynamic' ? this.env.dynT : 0;
    groundUniforms.uReflStrength.value = 1 + 0.25 * nightK;
    const farDay = c.weather === 'rain' ? 0.35 : c.weather === 'cloudy' || c.weather === 'snow' ? 0.55 : 0.9;
    groundUniforms.uFarOn.value = farDay + (0.25 - farDay) * nightK;
    // smoke and spray take the scene's light: sky, sun, and street lamps at night
    const hemi = new THREE.Color(p.hemiSky).multiplyScalar(p.hemiI * 0.75);
    const sun = new THREE.Color(p.sunColor).multiplyScalar(p.sunI * 0.08);
    this.smokeAmb.copy(hemi).add(sun).add(new THREE.Color(0xffc890).multiplyScalar(0.12 * p.pools));
    this.smokeAmb.r = Math.min(1.1, this.smokeAmb.r);
    this.smokeAmb.g = Math.min(1.1, this.smokeAmb.g);
    this.smokeAmb.b = Math.min(1.1, this.smokeAmb.b);
  }
  private smokeAmb = new THREE.Color(1, 1, 1);
  private glows: { x: number; y: number; z: number; r: number; g: number; b: number }[] = [];
  private tmpV3 = new THREE.Vector3();

  /** Tail lights and police light bars glow through nearby smoke. */
  private updateSmokeLight(): void {
    const cam = this.rig.camera.position;
    const p = this.env.p;
    const tailK = 0.35 + 0.65 * p.carLights;
    const list: { d: number; x: number; y: number; z: number; r: number; g: number; b: number }[] = [];
    this.race.cars.forEach((c, i) => {
      const v = this.carVisuals[i];
      if (!v || !v.root.visible) return;
      const d = v.root.position.distanceTo(cam);
      if (d > 70) return;
      const w = v.root.localToWorld(this.tmpV3.set(0, 0.75, -2.4));
      const brake = c.s.brake > 0.05 && c.s.gear !== -1;
      const k = (brake ? 1.6 : 0.55) * tailK;
      list.push({ d, x: w.x, y: w.y, z: w.z, r: k, g: k * 0.05, b: k * 0.04 });
    });
    // police light bars, from the actual flash pattern of each unit
    if (this.race.pursuit) for (const g of this.pview.glowList) if (g.d < 70) list.push({ ...g, d: g.d + 2 });
    // 4F: your headlights and Air One's searchlight light the smoke at night
    const me = this.race.player.s;
    const head = p.carLights * this.env.headScale;
    if (head > 0.1) {
      const hx = me.x + Math.sin(me.yaw) * 7;
      const hz = me.z + Math.cos(me.yaw) * 7;
      list.push({ d: -1, x: hx, y: 1.1, z: hz, r: 5 * head, g: 5.2 * head, b: 5.6 * head });
    }
    const heli = this.race.pursuit?.heli;
    if (heli?.active) {
      const k = Math.max(p.carLights, p.wet * 0.5);
      if (k > 0.1) list.push({ d: -1, x: heli.lx, y: 2.2, z: heli.lz, r: 14 * k, g: 13.3 * k, b: 11.8 * k });
    }
    this.env.streakExtras = this.race.pursuit ? this.pview.glowList : [];
    list.sort((a, b) => a.d - b.d);
    this.glows.length = 0;
    for (let i = 0; i < Math.min(8, list.length); i++) this.glows.push(list[i]);
    this.particles.setLighting(this.smokeAmb, this.glows);
    // the same lights catch the rain (police bars reach further than tail lights)
    const rl = this.env.rainCarLights;
    rl.length = 0;
    for (let i = 0; i < Math.min(6, list.length); i++) {
      const g = list[i];
      const police = g.b > g.r * 0.5 || g.r > 1.7;
      rl.push({ x: g.x, y: g.y + 0.3, z: g.z, r: g.r * 0.8, g: g.g * 0.8, b: g.b * 0.8, falloff: police ? 0.12 : 0.6 });
    }
  }

  // ── Cockpit (4A): interior, dash, wheel, mirrors, wipers, cabin sound and rumble ──
  private updateCockpit(dt: number, s: VehicleState, live: boolean): void {
    const on = this.rig.kind === 'cockpit' && (this.state === 'playing' || this.state === 'paused' || this.state === 'results');
    if (this.cockpit.root.visible !== on) this.cockpit.setVisible(on);
    this.carVisuals[0]?.setCabinCut(on);
    this.post.sharpNear = on ? 2.4 : 0;
    this.cabin = lerp(this.cabin, on ? 1 : 0, damp(6, dt));
    this.audio.cabin = this.cabin;
    this.hud.setDialHidden(on && !this.settings.cockpitDial);
    if (!on) return;
    const p = this.env.p;
    const night = p.carLights;
    this.cockpit.update(s, dt, this.time, night, live ? p.rain : 0, 1 - 0.55 * night, this.settings.mph);
    if (this.state === 'playing') {
      // a buzz at the rev limiter, a light tick each time the wiper turns round
      if (s.rpm > PLAYER_ENGINE.redlineRpm - 60 && s.throttle > 0.5) this.haptics.pulse(0.12, 0.35, 0.05);
      if (this.cockpit.wiperKick) this.haptics.pulse(0.05, 0.18, 0.06);
    }
  }

  // ── Rear-view mirror (hood and bumper cameras) ──
  private renderMirror(): void {
    const el = document.getElementById('mirror')!;
    // (no room for it in very short windows: the race panel would be pushed into the call-outs)
    const on = this.settings.mirror && this.state === 'playing' && (this.rig.kind === 'hood' || this.rig.kind === 'bumper') && window.innerHeight >= 480;
    if (el.hidden === on) el.hidden = !on;
    if (!on) {
      this.hud.setMirrorSpace(0);
      return;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const w = Math.round(Math.min(420 * this.hud.scale, W * 0.3));
    const h = Math.round(w / 3.8);
    const x = Math.round((W - w) / 2);
    const top = Math.round(Math.min(40, Math.max(16, W * 0.026))); // the HUD gutter
    this.hud.setMirrorSpace(h + 8); // the race panel moves down under the mirror
    el.style.cssText = `left:${x}px;top:${top}px;width:${w}px;height:${h}px`;
    const root = this.carVisuals[0].root;
    root.updateMatrixWorld();
    const cam = this.mirrorCam;
    cam.position.copy(root.localToWorld(new THREE.Vector3(0, 1.12, -0.3)));
    cam.lookAt(root.localToWorld(new THREE.Vector3(0, 0.95, -40)));
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    const r = this.renderer;
    const prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(null);
    r.autoClear = false;
    r.setScissorTest(true);
    r.setViewport(x, H - top - h, w, h);
    r.setScissor(x, H - top - h, w, h);
    r.clear(true, true, false);
    r.render(this.scene, cam);
    r.setScissorTest(false);
    r.setViewport(0, 0, W, H);
    r.autoClear = true;
    r.shadowMap.autoUpdate = prevShadow;
  }

  // ── Ghost car (Free run) ──
  private ghostLaps = 0;
  private ghostWasRunning = false;
  private ghostPose = { x: 0, y: 0, z: 0, yaw: 0 };
  private updateGhost(): void {
    const on = this.mode === 'free' && this.settings.ghost && (this.state === 'playing' || this.state === 'paused' || this.state === 'photo') && this.online.status !== 'online';
    const me = this.race.player;
    const lap = me.lap;
    if (on && this.state === 'playing') {
      if (lap.running && (lap.time < this.ghostLastT || !this.ghostWasRunning)) {
        const completed = lap.laps > this.ghostLaps;
        if (this.ghost.lapDone(completed ? lap.last : 0, completed)) this.hud.toast(`New ghost: ${formatLap(lap.last)}`);
        this.ghostLaps = lap.laps;
      }
      this.ghostWasRunning = lap.running;
      this.ghostLastT = lap.time;
      if (lap.running) this.ghost.record(lap.time, me.s.x, me.s.y, me.s.z, me.s.yaw);
    }
    const pose = on && lap.running ? this.ghost.pose(lap.time, this.ghostPose) : null;
    if (!pose) {
      if (this.ghostCar) this.ghostCar.root.visible = false;
      return;
    }
    if (!this.ghostCar) {
      this.ghostCar = makeCarVisual(this.race.player.edition);
      this.ghostCar.makeGhost(new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x2aa8c0, emissiveIntensity: 0.7, transparent: true, opacity: 0.3, depthWrite: false, roughness: 0.3 }));
      this.scene.add(this.ghostCar.root);
    }
    const g = this.ghostCar.root;
    g.visible = true;
    g.position.set(pose.x, pose.y, pose.z);
    g.rotation.set(0, pose.yaw, 0);
  }

  /** Extra renders that must happen before the main scene each frame. */
  private beforeCalls = 0;
  private probeTick = 0;
  private reflTick = 0;
  /** set while the frame is CPU-bound: the extra passes run at half rate */
  private cpuSaver = false;
  private beforeMs = 0;
  private beforeScene(): void {
    const cfg = QUALITY[this.settings.quality];
    const info = this.renderer.info.render;
    const c0 = info.calls;
    const t0 = prof.now();
    // when the processor is the bottleneck the wet-road mirror refreshes every other frame
    // (it keeps last frame's picture and matrix, so it still lines up: just one frame old)
    this.reflTick = (this.reflTick + 1) % 2;
    if (this.env.p.wet > 0 && cfg.reflect > 0 && (!this.cpuSaver || this.reflTick === 0)) {
      this.refl.planeY = this.world.field ? this.world.heightAt(this.race.player.s.x, this.race.player.s.z) : 0;
      this.refl.render(this.renderer, this.scene, this.rig.camera);
    }
    const c1 = info.calls;
    const t1 = prof.add('reflect', t0);
    prof.drawCalls('reflect', c1 - c0);
    // the paint probe draws one cube face every other frame (a full refresh every 12 frames)
    if (cfg.probe > 0 && this.state !== 'menu' && (this.probeTick = (this.probeTick + 1) % 2) === 0) {
      const v = this.carVisuals[0];
      this.probe.update(this.renderer, this.scene, v?.root ?? null, v?.paint ?? null, [this.env.rain.lines]);
    }
    prof.drawCalls('probe', info.calls - c1);
    const t2 = prof.add('probe', t1);
    this.beforeCalls += info.calls - c0;
    this.beforeMs += t2 - t0;
  }

  /** the preset's pixel ratio before dynamic resolution */
  private basePixelRatio(): number {
    const cfg = QUALITY[this.settings.quality];
    const dpr = window.devicePixelRatio || 1;
    return cfg.pixelRatio < 1 ? cfg.pixelRatio : Math.min(dpr, cfg.pixelRatio);
  }

  // ── Smoothness (4B.2): dynamic resolution, frame cap, which GPU ──
  /** share of the preset's resolution being rendered (dynamic resolution) */
  private renderScale = 1;
  private dynT = 0;
  private overBudget = 0;
  private underBudget = 0;
  private frameMsAvg = 16;
  /** Hold the frame rate: step the render scale down when frames run long, back up when there is room. */
  private dynamicResolution(rawDt: number): void {
    const ms = rawDt * 1000;
    this.frameMsAvg += (Math.min(ms, 60) - this.frameMsAvg) * 0.1;
    if (!this.settings.target60 || this.state !== 'playing' || this.bench) {
      if (!this.settings.target60 && this.renderScale !== 1) this.setRenderScale(1);
      if (!this.settings.target60) this.cpuSaver = false;
      return;
    }
    const budget = 1000 / Math.min(60, this.fpsCap());
    // count frames over / comfortably under budget; act about twice a second at most
    if (this.frameMsAvg > budget * 1.06) this.overBudget++;
    else if (this.frameMsAvg < budget * 0.8) this.underBudget++;
    this.dynT += rawDt;
    if (this.dynT < 0.5) return;
    this.dynT = 0;
    // if the GPU isn't the bottleneck (it is idle much of the frame), resolution won't help
    const gpuBound = !this.gpu.supported || this.gpu.ms < 0 || this.gpu.ms > budget * 0.8;
    if (this.overBudget > 12) {
      // too slow: lower the resolution if the graphics card is the limit, otherwise lighten the
      // processor's load (extra passes at half rate)
      if (gpuBound && this.renderScale > PERF.minScale) this.setRenderScale(Math.max(PERF.minScale, this.renderScale - PERF.scaleStep));
      else if (!gpuBound) this.cpuSaver = true;
    } else if (this.underBudget > 25) {
      if (this.renderScale < 1) this.setRenderScale(Math.min(1, this.renderScale + PERF.scaleStep / 2));
      else if (this.cpuSaver && prof.cpuAvg < budget * 0.55) this.cpuSaver = false;
    }
    this.overBudget = 0;
    this.underBudget = 0;
  }
  private setRenderScale(k: number): void {
    this.renderScale = Math.round(k * 100) / 100;
    this.renderer.setPixelRatio(this.basePixelRatio() * this.renderScale);
    this.resize();
  }
  private fpsCap(): number {
    return this.settings.fpsCap === 'unlimited' ? 1000 : this.settings.fpsCap === '120' ? 120 : 60;
  }
  /** the graphics chip the browser is drawing with */
  private gpuName = '';
  private gpuIntegrated = false;
  private detectGpu(): void {
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const raw = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      const clean = raw.replace(/\((TM|R)\)/gi, '');
      // "ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU (0x…) Direct3D11 …)" → the card's name
      const m = raw.match(/ANGLE \([^,]*,\s*([^,(]+?)(?:\s*\(0x[0-9a-f]+\))?\s*(?:Direct3D|OpenGL|Vulkan|Metal|,|\))/i);
      const m2 = clean.match(/ANGLE \([^,]*,\s*([^,(]+?)(?:\s*\(0x[0-9a-f]+\))?\s*(?:Direct3D|OpenGL|Vulkan|Metal|,|\))/i) ?? m;
      this.gpuName = ((m2 ? m2[1] : raw).trim() || raw).slice(0, 60);
      const discrete = /nvidia|geforce|rtx|gtx|quadro|radeon rx|rx \d{3,4}|arc a\d/i.test(raw);
      this.gpuIntegrated = !discrete && /intel|uhd|iris|radeon\(tm\) graphics|amd radeon graphics|vega|microsoft basic|swiftshader|llvmpipe/i.test(raw);
    } catch {
      this.gpuName = 'unknown GPU';
    }
  }

  // ── F4 benchmark (4B.2): a fixed 30 s fly-round in night, heavy rain and (in a pursuit) Heat 5 ──
  // ── 4C.2: playlist music ──
  private carDots: { x: number; z: number; speed: number }[] = [];
  readonly music = new MusicLibrary(this.settings.musicOff);
  readonly musicMenu: MusicMenu;
  private openMusicFromSettings(): void {
    if (this.menuFrom !== 'home' || this.state !== 'menu') return this.hud.toast('The music menu is on the home screen (Music) · skip and volume work here');
    this.menu.close();
    this.screens.show('music');
  }
  private updateMusic(a: { musicNext: boolean }): void {
    const m = this.music;
    if (a.musicNext) {
      if (!m.count) this.hud.toast('No music yet: add some in Music on the home screen');
      else m.next();
    }
    // "music in races: off" pauses it while driving, then it carries on in the menus
    this.musicHeld = !this.settings.musicRaces && (this.state === 'playing' || this.state === 'paused' || this.state === 'photo');
    m.hold(this.musicHeld);
  }

  // ── 4C.2: Online panel (join / host) ──
  private olWired = false;
  private openOnlinePanel(): void {
    const dlg = document.getElementById('online-dlg');
    if (!dlg) return;
    const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
    if (!this.olWired) {
      this.olWired = true;
      $('ol-link').value = this.settings.onlineServer;
      $('ol-room').value = this.settings.onlineRoom;
      const join = () => {
        const link = $('ol-link').value.trim();
        if (!link) {
          this.olStatus('Paste the link your friend sent first.', 'err');
          return;
        }
        if (!relaySocketUrl(link, $('ol-room').value, '')) {
          this.olStatus("That doesn't look like a race link. Paste the whole link your friend sent.", 'err');
          return;
        }
        this.settings.onlineServer = link;
        this.settings.onlineRoom = cleanRoom($('ol-room').value);
        saveSettings(this.settings);
        this.joinOnline({ server: link, room: this.settings.onlineRoom, pass: $('ol-pass').value });
      };
      $('ol-join').addEventListener('click', join);
      for (const id of ['ol-link', 'ol-room', 'ol-pass']) $(id).addEventListener('keydown', (e) => e.key === 'Enter' && join());
      $('ol-joinhere').addEventListener('click', () => this.joinOnline({ pass: $('ol-pass2').value }));
      $('ol-tabs').addEventListener('click', () => this.joinOnline({ force: 'tabs' }));
      $('ol-leave').addEventListener('click', () => {
        this.setOnline(false);
        this.refreshOnlinePanel();
      });
      $('ol-close').addEventListener('click', () => this.closeOnlinePanel());
      dlg.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') this.closeOnlinePanel();
      });
    }
    document.getElementById('ol-served')!.hidden = !servedByRelay();
    dlg.hidden = false;
    this.refreshOnlinePanel();
    (servedByRelay() ? $('ol-joinhere') : $('ol-link')).focus();
  }

  private closeOnlinePanel(): void {
    const dlg = document.getElementById('online-dlg');
    if (dlg) dlg.hidden = true;
    (document.getElementById('game') as HTMLCanvasElement | null)?.focus();
  }

  private olStatus(text: string, kind: '' | 'err' | 'ok' = ''): void {
    const el = document.getElementById('ol-status');
    if (!el) return;
    el.textContent = text;
    el.className = `sub${kind ? ' ' + kind : ''}`;
  }

  private refreshOnlinePanel(): void {
    const dlg = document.getElementById('online-dlg');
    if (!dlg || dlg.hidden) return;
    const o = this.online;
    if (o.status === 'online') this.olStatus(`Connected: ${o.where} · ${o.players.length} player${o.players.length === 1 ? '' : 's'}`, 'ok');
    else if (o.status === 'connecting') this.olStatus('Connecting…');
    else if (o.status === 'unavailable') this.olStatus(o.failReason || 'Could not connect.', 'err');
    else this.olStatus('Not connected. Join a friend with their link, or host a race.');
    document.getElementById('ol-leave')!.hidden = o.status === 'off';
  }

  private joinOnline(opts: TransportOptions): void {
    if (this.online.status !== 'off') this.online.disable();
    this.closeOnlinePanel();
    this.mode = 'race';
    this.setOnline(true, opts);
    if (this.state === 'menu' || this.state === 'results') this.beginRace(this.settings.rivals);
    else if (this.state === 'paused') this.resume();
  }

  /** 4C.2: the online host changes the event from the pause menu (guests see it read-only) */
  private hostRows(): { label: string; value?: () => string; adjust?: (d: number) => void }[] {
    if (this.online.status !== 'online') return [];
    const s = this.settings;
    const host = this.online.isHost;
    const restart = () => {
      saveSettings(s);
      this.online.requestRestart();
      this.menu.render();
    };
    const W: Settings['weather'][] = ['clear', 'cloudy', 'rain', 'snow', 'random'];
    const T: Settings['timeOfDay'][] = ['dusk', 'night', 'dynamic'];
    const cyc = <X,>(list: X[], cur: X, d: number): X => list[(list.indexOf(cur) + d + list.length) % list.length];
    const cap = (x: string) => x[0].toUpperCase() + x.slice(1);
    const ro = () => this.hud.toast('Only the host changes the race');
    return [
      { label: 'Online: race', value: () => (s.raceType === 'pursuit' ? 'Pursuit' : 'Clean race'), adjust: () => (host ? ((s.raceType = s.raceType === 'pursuit' ? 'clean' : 'pursuit'), restart()) : ro()) },
      {
        label: 'Online: weather',
        value: () => cap(this.env.conditions.weather),
        adjust: (d) => {
          if (!host) return ro();
          s.weather = cyc(W, s.weather, d);
          saveSettings(s);
          this.applyConditions(this.resolveConditions());
          this.menu.render();
        },
      },
      {
        label: 'Online: time of day',
        value: () => cap(this.env.conditions.time),
        adjust: (d) => {
          if (!host) return ro();
          s.timeOfDay = cyc(T, s.timeOfDay, d);
          saveSettings(s);
          this.applyConditions(this.resolveConditions());
          this.menu.render();
        },
      },
      { label: 'Online: laps', value: () => String(this.race.targetLaps || s.laps), adjust: (d) => (host ? ((s.laps = cyc([3, 5, 8], s.laps, d)), restart()) : ro()) },
    ];
  }

  // ── 4C.2: lobby panel, Ready / Start, waiting for the next race ──
  private lobbyHtml = '';
  private updateLobby(a: { accept: boolean }): void {
    const el = document.getElementById('lobby');
    if (!el) return;
    const o = this.online;
    const show = o.status === 'online' && this.state === 'playing' && (o.phase === 'lobby' || o.waiting);
    if (!show) {
      if (!el.hidden) el.hidden = true;
      return;
    }
    if (a.accept) o.pressStart();
    if (o.waiting) this.race.lobbyHold(); // our own copy stays on the grid until we're in
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const rows = o.lobby
      .map((r) => {
        const tag = r.waiting ? '<span class="tag">next race</span>' : r.host ? '<span class="tag ok">host</span>' : r.ready ? '<span class="tag ok">ready ✓</span>' : '<span class="tag">not ready</span>';
        const ping = r.ping >= 0 ? `<span class="ping${r.ping > 220 ? ' bad' : ''}">${r.ping} ms</span>` : '<span class="ping">–</span>';
        return `<div class="row${r.me ? ' me' : ''}"><span>${esc(r.name)}${r.me ? ' (you)' : ''}</span>${tag}${ping}</div>`;
      })
      .join('');
    const s = this.settings;
    const c = this.env.conditions;
    const ai = this.race.cars.filter((x) => x.driver || x.netId.startsWith('ai:')).length;
    const cond = `${this.race.pursuit ? 'Pursuit race' : 'Clean race'} · ${c.weather} · ${c.time} · ${this.race.targetLaps || s.laps} laps · ${ai} AI`;
    const pad = this.input.device === 'playstation' ? '✕' : this.input.device === 'keyboard' ? 'Enter' : 'A';
    let say: string;
    if (o.venueMismatch) say = `The host is racing at <b>${esc(venueById(o.venueMismatch).id === o.venueMismatch ? venueById(o.venueMismatch).name : o.venueMismatch)}</b>. Choose it under Venue on the event card to join.`;
    else if (o.waiting) say = 'A race is running. You join at the next start.';
    else if (o.autoStart >= 0) say = `Everyone's ready: starting in <b>${Math.max(0, Math.ceil(o.autoStart))}</b>`;
    else if (o.isHost) say = o.lobby.length > 1 ? `Press <b>${pad}</b> to start · Esc: race, weather, laps` : `Waiting for friends · <b>${pad}</b> to start anyway`;
    else say = o.ready ? `Ready ✓ · waiting for the host (<b>${pad}</b> to undo)` : `Press <b>${pad}</b> when you're ready`;
    const html = `<div class="head"><b>Online lobby</b><span>${esc(o.where)}</span></div><div class="rows">${rows}</div><div class="cond">${esc(cond)}</div><div class="say">${say}</div>`;
    if (html !== this.lobbyHtml) {
      this.lobbyHtml = html;
      el.innerHTML = html;
    }
    el.hidden = false;
  }

  /** fixed camera for screenshots: [x, y, z, lookX, lookY, lookZ, fov?] */
  shotCam: number[] | null = null;
  private bench: { t: number; ms: number[]; cpu: number[]; gpu: number[]; prev: Conditions; prevRain: number; dist: number; start: number } | null = null;
  private lastBench = '';
  private startBenchmark(): void {
    if (this.bench) return;
    const prev = { ...this.env.conditions };
    const prevRain = this.rainForced;
    this.applyConditions({ weather: 'rain', time: 'night' });
    this.setRainIntensity(1, true);
    const p = this.race.pursuit;
    if (p) {
      p.joined = true;
      p.heat = 5.4;
    }
    this.bench = { t: 0, ms: [], cpu: [], gpu: [], prev, prevRain, dist: 0, start: this.race.player.trackIndex };
    this.hud.toast('Benchmark: 30 s fly-round, night, heavy rain');
  }
  /** the benchmark camera: flies the racing line 6 m up, looking ahead */
  private benchCamera(dt: number): void {
    const b = this.bench;
    if (!b) return;
    b.dist += PERF.benchSpeed * dt;
    const S = this.world.samples;
    const N = S.length;
    const step = this.world.trackLength / N;
    const i = (b.start + Math.floor(b.dist / step)) % N;
    const j = (i + Math.round(40 / step)) % N;
    const cam = this.rig.camera;
    cam.position.set(S[i].x, 6, S[i].z);
    cam.up.set(0, 1, 0);
    cam.lookAt(S[j].x, 1.5, S[j].z);
    cam.fov = 62;
    cam.updateProjectionMatrix();
  }
  private benchFrame(dt: number): void {
    const b = this.bench;
    if (!b) return;
    b.t += dt;
    // 4C.1: the first 1.5 s compile shaders for the forced night rain: not part of the result
    if (b.t < 1.5) return;
    b.ms.push(dt * 1000);
    b.cpu.push(prof.cpu);
    if (this.gpu.supported && this.gpu.ms >= 0) b.gpu.push(this.gpu.ms);
    if (b.t < PERF.benchSeconds && this.state === 'playing') return;
    this.bench = null;
    const n = b.ms.length;
    const sorted = b.ms.slice().sort((x, y) => x - y);
    const p99 = sorted[Math.min(n - 1, Math.floor(n * 0.99))];
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : -1);
    const fps = n / Math.max(0.1, b.t - 1.5);
    const text =
      `Apex Pursuit benchmark · ${this.settings.quality.toUpperCase()} · ${this.renderer.domElement.width}×${this.renderer.domElement.height} · ${this.gpuName}\n` +
      `average ${fps.toFixed(1)} fps · 1% low ${(1000 / p99).toFixed(1)} fps · CPU ${avg(b.cpu).toFixed(1)} ms · GPU ${b.gpu.length ? avg(b.gpu).toFixed(1) + ' ms' : 'n/a'} · ${n} frames`;
    this.lastBench = text;
    this.applyConditions(b.prev);
    this.setRainIntensity(b.prevRain, true);
    this.hud.pop(`${fps.toFixed(0)} FPS`, `1% low ${(1000 / p99).toFixed(0)} · CPU ${avg(b.cpu).toFixed(1)} ms`, true, 6);
    console.log(text);
    try {
      void navigator.clipboard?.writeText(text).then(
        () => this.hud.toast('Benchmark result copied to the clipboard'),
        () => this.hud.toast('Benchmark done: the result is in the F3 overlay'),
      );
    } catch {
      this.hud.toast('Benchmark done: the result is in the F3 overlay');
    }
  }

  private resize(): void {
    const w = Math.max(2, window.innerWidth);
    const h = Math.max(2, window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    this.post.resize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.refl.setScale(QUALITY[this.settings.quality].reflect, w * pr, h * pr);
  }

  private toggleFullscreen(): void {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen().catch(() => this.hud.toast('Fullscreen was blocked: press F or click the button'));
    } catch {
      this.hud.toast('Fullscreen is not available here');
    }
  }

  // ── Online play ──────────────────────────────────────────────────────────
  private setOnline(on: boolean, opts: TransportOptions = {}): void {
    if (on) {
      if (this.online.status === 'off' || this.online.status === 'unavailable') {
        this.hud.toast('Connecting…');
        void this.online.enable(opts);
      }
    } else if (this.online.status !== 'off') {
      this.online.disable();
      this.rebuildRace();
      this.hud.toast('Online play off');
    }
    this.refreshOnlineUi();
  }

  private onlineLabel(): string {
    const o = this.online;
    if (o.status === 'connecting') return 'Connecting…';
    if (o.status === 'unavailable') return 'Not available here';
    if (o.status !== 'online') return 'Off';
    const n = o.players.length;
    return `${n} player${n === 1 ? '' : 's'}${o.isHost ? ' · host' : ''}`;
  }

  private lastOnlineLabel = '';
  private refreshOnlineUi(): void {
    const label = this.onlineLabel();
    if (label === this.lastOnlineLabel) return;
    this.lastOnlineLabel = label;
    this.hud.setVenue(this.online.status === 'off' ? this.world.venue.name : `Online · ${label}`);
    if (this.online.status === 'unavailable') {
      this.hud.toast(this.online.failReason || 'Online play could not connect');
      // back to the Online panel with the reason, so they can fix the link or password
      if (this.state === 'playing' || this.state === 'menu') this.openOnlinePanel();
    }
    this.refreshOnlinePanel();
    if (this.menu.isOpen) this.menu.render();
  }

  // ── State changes ────────────────────────────────────────────────────────
  /** From home: build the field with the chosen car and go to the grid behind a short loading screen. */
  private beginRace(rivals: boolean): void {
    if (this.settings.rivals !== rivals && this.online.status !== 'online') {
      this.settings.rivals = rivals;
      saveSettings(this.settings);
    }
    this.screens.show('loading');
    this.screens.setLoading(0.15, 'Lining up the grid');
    if (this.online.status !== 'online' || this.online.isHost) this.applyConditions(this.resolveConditions());
    let t = 0;
    const tick = () => {
      t += 0.12;
      this.screens.setLoading(Math.min(1, 0.15 + t), t < 0.5 ? 'Lining up the grid' : 'Warming the tyres');
      if (t < 0.85) setTimeout(tick, 90);
      else this.enterRace();
    };
    if (this.online.status !== 'online') this.rebuildRace();
    else this.online.requestRestart();
    setTimeout(tick, 120);
  }

  private enterRace(): void {
    this.screens.show(null);
    this.state = 'playing';
    this.resetRaceFlow();
    for (const v of this.carVisuals) v.root.visible = true;
    if (this.online.status !== 'online') this.race.toGrid();
    this.props.reset();
    this.skids.clear();
    this.hud.setVisible(true);
    this.hud.setHints(this.input.device, this.settings.manual);
    this.setEventPanel();
    this.rig.setMode(this.settings.camera);
    this.rig.snap(this.pose);
    this.audio.setMuted(false);
    this.last = performance.now();
    this.acc = 0;
    this.canvas.focus();
  }

  private resetRaceFlow(): void {
    this.ghost?.abort();
    this.ghost?.setEdition(this.settings.loadout.edition);
    this.ghostLaps = 0;
    this.ghostWasRunning = false;
    this.ghostLastT = 0;
    this.finishHandled = false;
    this.finishT = 0;
    this.raceEarned = 0;
    this.timeScale = 1;
    this.alertKey = '';
    this.setAlert('', false);
  }

  /** Results page → Restart: a fresh start of the same event. */
  private restartFromResults(): void {
    if (this.online.status === 'online') {
      if (!this.online.isHost) {
        this.hud.toast('Only the host can restart the race');
        return;
      }
      this.online.requestRestart();
      this.enterRace();
      return;
    }
    this.beginRace(this.mode === 'race');
  }

  // ── Events (Phase 3B): a named ladder the results screen walks through ──
  private eventIndex(): number {
    const s = this.settings;
    const type = s.raceType === 'pursuit' ? 'pursuit' : 'circuit';
    return EVENTS.findIndex((e) => e.type === type && e.laps === s.laps && e.weather === s.weather && e.time === s.timeOfDay);
  }
  private eventName(): string {
    if (this.mode === 'free') return 'Free run';
    const i = this.eventIndex();
    if (i >= 0) return EVENTS[i].name;
    return this.settings.raceType === 'pursuit' ? 'Pursuit race' : 'Quick race';
  }
  private nextEventName(): string | null {
    if (this.mode === 'free') return null;
    if (this.online.status === 'online' && !this.online.isHost) return null;
    return EVENTS[(this.eventIndex() + 1) % EVENTS.length].name;
  }
  private nextEvent(): void {
    const e = EVENTS[(this.eventIndex() + 1) % EVENTS.length];
    const s = this.settings;
    s.raceType = e.type === 'pursuit' ? 'pursuit' : 'clean';
    s.laps = e.laps;
    s.weather = e.weather;
    s.timeOfDay = e.time;
    saveSettings(s);
    if (this.online.status === 'online') {
      // the host sets it up and everyone goes straight to the grid
      this.applyConditions(this.resolveConditions());
      this.online.requestRestart();
      this.enterRace();
      return;
    }
    this.applyConditions(this.resolveConditions());
    this.screens.show('event');
  }

  /** The event panel's header for the race being run. */
  private setEventPanel(): void {
    const c = this.env.conditions;
    const free = this.mode === 'free';
    const kind = free ? 'free' : this.race.pursuit ? 'pursuit' : 'circuit';
    const wx = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', snow: 'Snow' }[c.weather] ?? c.weather;
    const tod = c.time === 'night' ? 'Night' : c.time === 'dynamic' ? 'Dusk to night' : 'Dusk';
    const laps = this.race.targetLaps;
    const sub = free ? `${this.world.venue.name} · ${wx} · ${tod}` : `${kind === 'pursuit' ? 'Pursuit' : 'Circuit'} · ${laps} laps · ${wx} · ${tod}`;
    this.hud.setEvent(kind, this.eventName(), sub);
    this.hud.setRacingLine(this.race.line);
    this.boardT = 1;
  }

  /** The event panel's leaderboard and the gaps to the cars either side, a few times a second. */
  private boardT = 0;
  private updateBoard(dt: number): void {
    this.boardT += dt;
    if (this.boardT < 1 / RACE_FLOW.boardHz) return;
    this.boardT = 0;
    const r = this.race;
    if (this.mode === 'free' || r.cars.length < 2) {
      this.hud.setBoard([], '', '');
      return;
    }
    const me = r.player;
    const sorted = r.cars.slice().sort((a, b) => a.place - b.place);
    const L = this.world.trackLength; // race distance is counted in laps
    const myD = r.distanceOf(me) * L;
    const v = Math.max(18, Math.abs(me.s.speed));
    const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
    const nameOf = (c: typeof me) => (c.isPlayer ? this.settings.name : c.name);
    const gapOf = (c: typeof me) => {
      if (c === me) return me.finished ? 'Fin' : '';
      if (c.finished && me.finished) return `${c.finishTime < me.finishTime ? '-' : '+'}${Math.abs(c.finishTime - me.finishTime).toFixed(1)}`;
      if (c.finished) return 'Fin';
      const dt2 = (myD - r.distanceOf(c) * L) / v;
      return Math.abs(dt2) < 0.05 ? '0.0' : `${dt2 > 0 ? '+' : '-'}${Math.abs(dt2).toFixed(1)}`;
    };
    const lo = Math.max(1, Math.min(me.place - 2, sorted.length - 4));
    const rows = sorted
      .filter((c) => c.place === 1 || (c.place >= lo && c.place <= lo + 4))
      .slice(0, 6)
      .map((c) => ({ place: c.place, name: nameOf(c), color: hex(c.look.color), gap: gapOf(c), me: c === me }));
    const ahead = sorted[me.place - 2];
    const behind = sorted[me.place];
    const secs = (c: typeof me) => `${(Math.abs(myD - r.distanceOf(c) * L) / v).toFixed(1)} s`;
    this.hud.setBoard(rows, ahead && !me.finished ? `${nameOf(ahead)}  ${secs(ahead)}` : '', behind && !me.finished && !behind.finished ? `${nameOf(behind)}  ${secs(behind)}` : '');
  }

  private quitToHome(): void {
    this.menu.close();
    this.audio.setSirens([], 0);
    document.getElementById('busted')!.hidden = true;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this.timeScale = 1;
    this.mode = 'race';
    if (this.online.status !== 'off') {
      this.online.disable();
      this.hud.toast('Left the online race');
    }
    this.haptics.stop(this.input.pad);
    this.hud.setVisible(false);
    this.state = 'menu';
    saveSettings(this.settings);
    this.attractT = 0;
    this.rebuildRace();
    this.audio.setMuted(true);
    this.screens.show('home', true);
  }

  /** The garage / car select changed the loadout: new edition means new physics, otherwise just repaint. */
  private applyLoadout(): void {
    const l = this.settings.loadout;
    if (this.race.player.edition !== l.edition) {
      this.rebuildRace();
      return;
    }
    const look = lookOf(l);
    this.race.player.look = look;
    this.race.player.paint = look.paintIndex;
    this.car.setLook(look);
  }

  private earn(points: number): void {
    if (points <= 0) return;
    this.settings.speedPoints = Math.round(this.settings.speedPoints + points);
    this.raceEarned += points;
  }

  private aids(): DriverAids {
    const s = this.settings;
    return { stability: s.stability, tractionControl: s.tractionControl, brakeAssist: s.brakeAssist };
  }

  private makeRace(specs?: CarSpec[]): Race {
    const s = this.settings;
    const r = new Race(this.world, specs ?? Race.soloSpecs(s.rivals ? AI.gridSize - 1 : 0, s.loadout), s.difficulty, s.bestLap, this.aids(), s.steerAssist);
    r.targetLaps = this.mode === 'free' ? 0 : s.laps;
    r.randomHold = true;
    // Pursuit Race: the host (or a solo player) runs the police; guests get them from the host
    const guest = this.online?.status === 'online' && !this.online.isHost;
    if (this.mode === 'race' && s.raceType === 'pursuit' && !guest) {
      const p = r.enablePursuit(Math.floor(Math.random() * 1e6));
      // 4E: Air support settings (the host's apply online)
      p.air.from = s.airSupport === 'off' ? 0 : s.airSupport === 'heat5' ? 5 : 3;
      p.air.dropsOn = s.airDrops;
    }
    r.setWet(this.env?.p.wet ?? 0);
    return r;
  }

  /** The event card's starting grid: the field you will race, in grid order. */
  private gridRows(): BoardRow[] {
    const specs = Race.soloSpecs(AI.gridSize - 1, this.settings.loadout).slice().sort((a, b) => a.grid - b.grid);
    return specs.map((sp) => ({
      place: sp.grid + 1,
      name: sp.kind === 'player' ? this.settings.name : sp.name,
      color: (sp.look ?? lookFromPaint(sp.paint, 'x1-street')).color,
      me: sp.kind === 'player',
    }));
  }

  private resultRows(): BoardRow[] {
    return this.race.results().map((r) => ({
      place: r.place,
      name: r.car.isPlayer ? this.settings.name : r.car.name,
      color: r.car.look.color,
      me: r.car.isPlayer,
      gap: r.gap,
      best: r.best,
    }));
  }

  // ── Recovery: R / Share puts you back on the circuit behind a quick fade ──
  private manualRejoin(): void {
    const race = this.race;
    if (this.fading || race.held || race.player.finished) return;
    const fade = document.getElementById('fade')!;
    this.fading = true;
    fade.classList.add('on');
    setTimeout(() => {
      race.rejoin(race.player);
      this.afterRejoin();
      fade.classList.remove('on');
      this.fading = false;
    }, 230);
  }

  /** The car was moved: snap the camera, clear the drift. */
  private afterRejoin(): void {
    this.ghost?.abort();
    this.rig.snap(this.pose);
    this.driftScore = 0;
    this.haptics.pulse(0.35, 0.3, 0.14);
  }

  /** A quick black flash for the automatic rejoin. */
  private flashFade(): void {
    const fade = document.getElementById('fade')!;
    fade.style.transition = 'none';
    fade.classList.add('on');
    void fade.offsetWidth;
    fade.style.transition = 'opacity .4s';
    fade.classList.remove('on');
    setTimeout(() => (fade.style.transition = ''), 450);
  }

  private setAlert(html: string, warn: boolean): void {
    const el = document.getElementById('hud-alert')!;
    el.innerHTML = html ? `<div class="msg${warn ? ' warn' : ''}">${html}</div>` : '';
  }

  /** Off track, stopped, or going the wrong way: tell the player how to get back. */
  private updateAlert(): void {
    const r = this.race.recovery;
    const p = this.race.player;
    let key = '';
    let html = '';
    let warn = false;
    if (this.state === 'playing' && !p.finished && !this.race.held) {
      const k = `<kbd>${glyph(this.input.device, 'reset')}</kbd>`;
      const left = Math.max(1, Math.ceil(RECOVERY.autoAfter - r.stuckFor));
      if (r.wrongWay && r.stuckFor > 1) {
        warn = true;
        key = `ww${left}`;
        html = `Wrong way <small>${k} rejoin · auto in ${left} s</small>`;
      } else if (r.stuckFor > RECOVERY.promptAfter) {
        key = `off${left}`;
        html = `${r.offTrack ? 'Off track' : 'Stopped'} <small>${k} rejoin · auto in ${left} s</small>`;
      }
    }
    if (key === this.alertKey) return;
    this.alertKey = key;
    this.setAlert(html, warn);
  }

  /** The player crossed the line on the last lap. */
  private onPlayerFinish(): void {
    const p = this.race.player;
    this.finishHandled = true;
    this.finishT = 0;
    const bonus = PLACE_BONUS[p.place - 1] ?? 50;
    this.earn(bonus);
    const ord = p.place === 1 ? '1st' : p.place === 2 ? '2nd' : p.place === 3 ? '3rd' : `${p.place}th`;
    this.hud.pop(`FINISHED ${ord}`, p.place === 1 ? 'Race won' : `+${bonus} Speed Points`, p.place <= 3, 3);
    this.audio.ui('lap');
    this.haptics.pulse(0.9, 1, p.place === 1 ? 0.7 : 0.35);
    if (this.online.status !== 'online') this.timeScale = 0.35; // a moment of slow motion (not online: the world is shared)
    this.driftScore = 0;
    saveSettings(this.settings);
  }

  private showResults(): void {
    this.state = 'results';
    this.audio.setSirens([], 0);
    document.getElementById('busted')!.hidden = true;
    this.timeScale = 1;
    this.hud.setVisible(false);
    this.setAlert('', false);
    this.alertKey = '';
    this.haptics.stop(this.input.pad);
    this.screens.show('results');
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.setMuted(true);
    this.haptics.stop(this.input.pad);
    this.menu.setDevice(this.input.device);
    this.hud.setVisible(false);
    // fix (4D.2): Settings opened from home set this to 'home'; a race pause must always go back to the race
    this.menuFrom = 'pause';
    this.menu.open(this.mainPage());
  }

  // ── Photo mode ──
  private enterPhoto(): void {
    this.menu.close();
    this.state = 'photo';
    this.hud.setVisible(false);
    document.getElementById('busted')!.hidden = true;
    for (const t of this.tags) if (t) t.visible = false;
    this.photo.enter(this.carVisuals[0].root.position);
    this.post.photoDof = { focus: this.photo.focus, aperture: this.photo.aperture };
  }

  private exitPhoto(): void {
    this.photo.exit();
    this.post.photoDof = null;
    this.renderer.toneMappingExposure = this.env.p.exposure * this.env.exposureK;
    this.state = 'paused';
    this.menuFrom = 'pause';
    this.menu.open(this.mainPage());
  }

  /** Download the current frame as a PNG. */
  private savePhoto(): void {
    this.pview.renderSpotShadow(this.renderer, this.rig.camera);
    this.post.render(this.time, 0, 0, 0);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    this.canvas.toBlob((blob) => {
      if (!blob) return;
      void this.offerPhoto(blob, `apex-pursuit-${stamp}.png`);
    }, 'image/png');
    this.photoFlash();
  }

  /** Inside Claude the viewer confirms the save; elsewhere it is a plain download. */
  private async offerPhoto(blob: Blob, filename: string): Promise<void> {
    const w = window as unknown as { claude?: { use: (n: string) => Promise<unknown> } };
    if (w.claude && typeof w.claude.use === 'function') {
      const dl = (await Promise.race([w.claude.use('downloads'), new Promise((r) => setTimeout(() => r(null), 3000))])) as { save: (r: { filename: string; data: Blob }) => Promise<unknown> } | null;
      if (dl) {
        try {
          await dl.save({ filename, data: blob });
          this.hud.toast('Photo saved');
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (code !== 'declined') this.hud.toast(code === 'rate_limited' ? 'One moment: a save is already open' : 'Saving photos isn\'t available here');
        }
        return;
      }
    }
    {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
  }

  private photoFlash(): void {
    this.audio.ui('accept');
    const flash = document.getElementById('fade')!;
    flash.style.background = '#fff';
    flash.style.transition = 'none';
    flash.classList.add('on');
    void flash.offsetWidth;
    flash.style.transition = 'opacity .45s';
    flash.classList.remove('on');
    setTimeout(() => (flash.style.background = ''), 500);
  }

  private resume(): void {
    this.menu.close();
    this.hud.setVisible(true);
    this.state = 'playing';
    this.audio.setMuted(false);
    this.last = performance.now();
    this.hud.setHints(this.input.device, this.settings.manual, 6);
    this.canvas.focus();
  }

  private resetCar(toStart: boolean): void {
    const s = this.physics.s;
    let pose = this.world.startPose();
    if (!toStart) {
      const hit = this.world.nearestTrack(s.x, s.z);
      if (hit) {
        const smp = this.world.samples[hit.index];
        pose = { x: smp.x, z: smp.z, yaw: Math.atan2(smp.tx, smp.tz) };
      } else {
        pose = { x: s.x, z: s.z, yaw: s.yaw }; // away from the circuit: just stop it and set it level
      }
    }
    const nitro = s.nitro;
    this.physics.reset(pose.x, pose.z, pose.yaw);
    s.nitro = toStart ? 1 : nitro;
    this.capturePose(this.pose);
    this.capturePose(this.prev);
    this.rig.snap(this.pose);
    this.driftScore = 0;
    if (toStart && this.online.status === 'online') {
      // online, only the host can send everyone back to the grid
      if (!this.online.requestRestart()) this.hud.toast('Only the host can restart the race');
      return;
    }
    if (toStart) {
      this.race.toGrid();
      this.resetRaceFlow();
      this.rig.snap(this.pose);
      this.props.reset();
      this.skids.clear();
    }
  }

  // ── Menus ────────────────────────────────────────────────────────────────
  private mainPage(): MenuPage {
    return {
      title: 'Paused',
      eyebrow: 'Apex Pursuit · Phase 3',
      items: [
        { label: 'Resume', accept: () => this.resume() },
        { label: 'Photo mode', accept: () => this.enterPhoto() },
        { label: 'Restart from the grid', accept: () => (this.resetCar(true), this.resume()) },
        {
          label: 'Online race',
          value: () => this.onlineLabel(),
          adjust: () => (this.online.status === 'off' || this.online.status === 'unavailable' ? (this.menu.close(), this.openOnlinePanel()) : this.setOnline(false)),
        },
        ...this.hostRows(),
        {
          label: 'Rivals',
          value: () => (this.settings.rivals ? (this.online.status === 'online' ? 'AI fills the grid' : `${AI.gridSize - 1} cars`) : this.online.status === 'online' ? 'Humans only' : 'Off (free run)'),
          adjust: () => {
            if (!this.hostOnly()) return;
            this.settings.rivals = !this.settings.rivals;
            saveSettings(this.settings);
            if (this.online.status === 'online') this.online.requestRestart();
            else this.rebuildRace();
          },
        },
        {
          label: 'Rival difficulty',
          value: () => this.settings.difficulty[0].toUpperCase() + this.settings.difficulty.slice(1),
          adjust: (d) => {
            if (!this.hostOnly()) return;
            const order: Difficulty[] = ['easy', 'medium', 'hard'];
            this.settings.difficulty = order[clamp(order.indexOf(this.settings.difficulty) + d, 0, 2)];
            saveSettings(this.settings);
            if (this.online.status === 'online') this.online.requestRestart();
            else this.rebuildRace();
          },
        },
        { label: 'Settings', accept: () => this.menu.push(this.settingsPage()) },
        { label: 'Controls', accept: () => this.menu.push(this.controlsPage()) },
        { label: 'Fullscreen', value: () => (document.fullscreenElement ? 'On' : 'Off'), accept: () => this.toggleFullscreen() },
        { label: 'Quit to home', accept: () => this.quitToHome() },
      ],
      extra: () => {
        const o = this.online;
        const who = o.status === 'online' ? `<div class="who">${o.players.map((p) => `<span>${p.host ? '★ ' : ''}${escapeHtml(p.name)}</span>`).join('')}</div>` : '';
        const how =
          o.status === 'online'
            ? o.transportKind === 'tabs'
              ? 'Connected between tabs of this browser only. To play with friends, share this page with them or run the relay server from the project.'
              : 'Friends who open this same page and switch Online race on join your grid. Each new player restarts the race from the grid.'
            : 'Switch Online race on to share a grid with friends. Up to 4 players; AI fills the other slots.';
        return `<div class="netbox"><label for="driver-name">Driver name</label><input id="driver-name" type="text" maxlength="14" autocomplete="off" spellcheck="false" value="${escapeHtml(this.settings.name)}">${who}<p>${how}</p></div>`;
      },
      bind: (root) => {
        const input = root.querySelector('#driver-name') as HTMLInputElement | null;
        if (!input) return;
        input.addEventListener('change', () => {
          this.settings.name = input.value.replace(/[^\w .\-]/g, '').trim().slice(0, 14) || 'Driver';
          input.value = this.settings.name;
          saveSettings(this.settings);
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === 'Escape') input.blur();
        });
      },
    };
  }

  /** Online, only the host changes the race setup. */
  private hostOnly(): boolean {
    if (this.online.status === 'online' && !this.online.isHost) {
      this.hud.toast('The host sets this');
      return false;
    }
    return true;
  }

  private settingsPage(): MenuPage {
    const s = this.settings;
    const step = (v: number, d: number, lo: number, hi: number, by: number) => Math.round(clamp(v + d * by, lo, hi) * 100) / 100;
    const done = () => this.applySettings();
    return {
      title: 'Settings',
      eyebrow: 'Controller · driving · display',
      items: [
        { label: 'Vibration', value: () => (s.vibration ? 'On' : 'Off'), adjust: () => ((s.vibration = !s.vibration), done(), s.vibration && this.haptics.pulse(0.8, 0.6, 0.3)) },
        { label: 'Vibration strength', value: () => pct(s.vibrationStrength), adjust: (d) => ((s.vibrationStrength = step(s.vibrationStrength, d, 0.1, 1, 0.1)), done(), this.haptics.pulse(1, 1, 0.25)) },
        { label: 'Test vibration', accept: () => this.testRumble() },
        { label: 'Stick dead zone', value: () => pct(s.deadzone), adjust: (d) => ((s.deadzone = step(s.deadzone, d, 0, 0.25, 0.01)), done()) },
        { label: 'Steering sensitivity', value: () => STEER_LABELS[s.steerSensitivity], adjust: (d) => ((s.steerSensitivity = clamp(s.steerSensitivity + d, 0, 2)), done()) },
        {
          label: 'Handling',
          value: () => ({ arcade: 'Arcade (most forgiving)', balanced: 'Balanced', expert: 'Expert (no help)' })[s.stability],
          adjust: (d) => {
            const order: StabilityMode[] = ['arcade', 'balanced', 'expert'];
            s.stability = order[clamp(order.indexOf(s.stability) + d, 0, 2)];
            done();
          },
        },
        { label: 'Steering assist', value: () => ['Off', 'Low', 'High'][s.steerAssist], adjust: (d) => ((s.steerAssist = clamp(s.steerAssist + d, 0, 2)), done()) },
        { label: 'Traction control', value: () => (s.tractionControl ? 'On' : 'Off'), adjust: () => ((s.tractionControl = !s.tractionControl), done()) },
        { label: 'Braking assist', value: () => (s.brakeAssist ? 'On' : 'Off'), adjust: () => ((s.brakeAssist = !s.brakeAssist), done()) },
        { label: 'Gearbox', value: () => (s.manual ? 'Manual' : 'Automatic'), adjust: () => ((s.manual = !s.manual), done()) },
        { label: 'Camera shake', value: () => pct(s.cameraShake), adjust: (d) => ((s.cameraShake = step(s.cameraShake, d, 0, 1, 0.25)), done()) },
        {
          label: 'Graphics',
          value: () => s.quality[0].toUpperCase() + s.quality.slice(1),
          adjust: (d) => {
            const i = clamp(QUALITY_ORDER.indexOf(s.quality) + d, 0, QUALITY_ORDER.length - 1);
            s.qualityChosen = true;
            this.applyQuality(QUALITY_ORDER[i]);
            done();
          },
        },
        { label: 'Target 60 fps (dynamic resolution)', value: () => (s.target60 ? 'On' : 'Off'), adjust: () => ((s.target60 = !s.target60), done()) },
        {
          label: 'Frame-rate cap',
          value: () => (s.fpsCap === 'unlimited' ? 'Unlimited' : `${s.fpsCap} fps`),
          adjust: (d) => {
            const o: Settings['fpsCap'][] = ['60', '120', 'unlimited'];
            s.fpsCap = o[(o.indexOf(s.fpsCap) + (d < 0 ? o.length - 1 : 1)) % o.length];
            done();
          },
        },
        {
          label: 'Graphics chip',
          // A web page can't pick the GPU: the game asks for the fast one (powerPreference
          // 'high-performance'); Windows, the browser or the Claude app decide (4C.1).
          value: () =>
            this.gpuIntegrated
              ? `${this.gpuName} — built-in chip, not your graphics card. Fix: quit Claude from the tray and reopen · ASUS Armoury Crate → GPU Mode Standard or Ultimate (not Eco) · or play in Chrome with chrome://flags "Force high performance GPU" on`
              : `${this.gpuName || 'unknown'}${/nvidia|geforce|rtx|gtx|radeon rx|arc a/i.test(this.gpuName) ? ' — graphics card ✓' : ''}`,
          adjust: () =>
            this.hud.toast(
              this.gpuIntegrated
                ? 'Quit Claude / Chrome fully (system tray), check Armoury Crate GPU Mode isn\'t Eco, then reopen. In Chrome: chrome://flags → Force high performance GPU'
                : 'Drawing on the graphics card',
            ),
        },
        { label: 'Volume', value: () => pct(s.volume), adjust: (d) => ((s.volume = step(s.volume, d, 0, 1, 0.1)), done()) },
        {
          label: 'Music',
          value: () => (!this.music.count ? 'No music yet · ✕ / Enter opens Music' : this.music.state === 'playing' && this.music.current ? `Playing · ${this.music.current.title}` : 'Stopped'),
          adjust: () => {
            s.music = this.music.state !== 'playing';
            this.music.toggle();
            done();
          },
          accept: () => this.openMusicFromSettings(),
        },
        { label: 'Music menu (tracks, rotation)', value: () => (this.music.count ? `${this.music.enabled.length} of ${this.music.count} on` : 'Add music'), adjust: () => this.openMusicFromSettings(), accept: () => this.openMusicFromSettings() },
        { label: 'Skip track (M · L3 + R3)', value: () => (this.music.current ? this.music.current.artist : '—'), adjust: () => this.music.next() },
        { label: 'Music volume', value: () => pct(s.musicVolume), adjust: (d) => ((s.musicVolume = step(s.musicVolume, d, 0, 1, 0.05)), done()) },
        { label: 'Music in races', value: () => (s.musicRaces ? 'On' : 'Off (menus only)'), adjust: () => ((s.musicRaces = !s.musicRaces), done()) },
        {
          label: 'Online music',
          value: () => (s.onlineMusic === 'host' ? "Everyone hears the host's" : 'Everyone plays their own'),
          adjust: () => ((s.onlineMusic = s.onlineMusic === 'host' ? 'mine' : 'host'), done()),
        },
        { label: 'Engine volume', value: () => pct(s.mixEngine), adjust: (d) => ((s.mixEngine = step(s.mixEngine, d, 0, 1, 0.1)), done()) },
        { label: 'Effects volume (tyres, rain, crashes)', value: () => pct(s.mixFx), adjust: (d) => ((s.mixFx = step(s.mixFx, d, 0, 1, 0.1)), done()) },
        { label: 'Sirens volume', value: () => pct(s.mixSiren), adjust: (d) => ((s.mixSiren = step(s.mixSiren, d, 0, 1, 0.1)), done()) },
        {
          label: 'Camera',
          value: () => CAMERA_MODES[s.camera] ?? CAMERA_MODES[0],
          adjust: (d) => {
            s.camera = (s.camera + (d < 0 ? CAMERA_MODES.length - 1 : 1)) % CAMERA_MODES.length;
            if (this.state !== 'menu') this.rig.setMode(s.camera);
            done();
          },
        },
        { label: 'Rear-view mirror', value: () => (s.mirror ? 'On (hood and bumper cams)' : 'Off'), adjust: () => ((s.mirror = !s.mirror), done()) },
        {
          label: 'Ambient occlusion (Ultra only, heavy)',
          value: () => (s.quality !== 'ultra' ? 'Ultra only' : s.ao ? 'On' : 'Off'),
          adjust: () => {
            s.ao = !s.ao;
            this.applyQuality(s.quality);
            done();
          },
        },
        {
          label: 'Edge smoothing',
          value: () => (s.quality === 'low' ? 'Medium and up' : s.antiAlias === 'taa' ? 'TAA (smoothest, least shimmer)' : s.quality === 'medium' ? 'SMAA (sharp)' : 'MSAA (sharp)'),
          adjust: () => {
            s.antiAlias = s.antiAlias === 'taa' ? 'msaa' : 'taa';
            this.applyQuality(s.quality);
            done();
          },
        },
        { label: 'Tone mapping', value: () => (s.toneMap === 'natural' ? 'Natural (AgX)' : 'Filmic (ACES)'), adjust: () => ((s.toneMap = s.toneMap === 'natural' ? 'filmic' : 'natural'), done()) },
        { label: 'Lens fringe and dirt', value: () => (s.lensFx ? 'On' : 'Off'), adjust: () => ((s.lensFx = !s.lensFx), done()) },
        {
          label: 'Lightning (rain)',
          value: () => ({ on: 'On', soft: 'Soft (gentler flashes)', off: 'Off' })[s.lightning],
          adjust: (d) => {
            const o: Settings['lightning'][] = ['on', 'soft', 'off'];
            s.lightning = o[(o.indexOf(s.lightning) + (d < 0 ? o.length - 1 : 1)) % o.length];
            done();
          },
        },
        { label: 'Shooting stars (clear nights)', value: () => (s.meteors ? 'On' : 'Off'), adjust: () => ((s.meteors = !s.meteors), done()) },
        { label: 'Lens drops (outside views)', value: () => (s.lensDrops === 'auto' ? 'Auto (follow the rain)' : 'Off'), adjust: () => ((s.lensDrops = s.lensDrops === 'auto' ? 'off' : 'auto'), done()) },
        {
          label: 'Rain strength',
          value: () => ({ changing: 'Changing', light: 'Light', heavy: 'Heavy', downpour: 'Downpour' })[s.rainStrength],
          adjust: (d) => {
            const o: Settings['rainStrength'][] = ['changing', 'light', 'heavy', 'downpour'];
            s.rainStrength = o[(o.indexOf(s.rainStrength) + (d < 0 ? o.length - 1 : 1)) % o.length];
            done();
          },
        },
        { label: 'Rev dial in the cockpit', value: () => (s.cockpitDial ? 'Show' : 'Hide (the dash shows it)'), adjust: () => ((s.cockpitDial = !s.cockpitDial), done()) },
        { label: 'Ghost car (Free run)', value: () => (s.ghost ? 'On' : 'Off'), adjust: () => ((s.ghost = !s.ghost), done()) },
        { label: 'Performance overlay', value: () => (s.debug ? 'On' : 'Off (F3)'), adjust: () => ((s.debug = !s.debug), done()) },
        { label: 'Police radio voice', value: () => (s.radioVoice ? 'On' : 'Subtitles only'), adjust: () => ((s.radioVoice = !s.radioVoice), done()) },
        {
          label: 'Air support (helicopter)',
          value: () => ({ heat3: 'From Heat 3', heat5: 'From Heat 5', off: 'Off' })[s.airSupport],
          adjust: (d) => {
            const o: Settings['airSupport'][] = ['heat3', 'heat5', 'off'];
            s.airSupport = o[(o.indexOf(s.airSupport) + (d < 0 ? o.length - 1 : 1)) % o.length];
            const p = this.race.pursuit;
            if (p && !p.mirror) p.air.from = s.airSupport === 'off' ? 0 : s.airSupport === 'heat5' ? 5 : 3;
            done();
          },
        },
        {
          label: 'Air One drops',
          value: () => (s.airDrops ? 'Smoke, spikes, shock charges' : 'Off (searchlight only)'),
          adjust: () => {
            s.airDrops = !s.airDrops;
            const p = this.race.pursuit;
            if (p && !p.mirror) p.air.dropsOn = s.airDrops;
            done();
          },
        },
        { label: 'Air One arrival shot', value: () => (s.airCutIn ? 'On (2 s from the helicopter)' : 'Off'), adjust: () => ((s.airCutIn = !s.airCutIn), done()) },
        { label: 'Speed units', value: () => (s.mph ? 'mph' : 'km/h'), adjust: () => ((s.mph = !s.mph), done()) },
        { label: 'HUD size', value: () => pct(s.hudScale), adjust: (d) => ((s.hudScale = step(s.hudScale, d, 0.8, 1.25, 0.05)), done()) },
        { label: 'Colour-blind-safe colours', value: () => (s.colourSafe ? 'On' : 'Off'), adjust: () => ((s.colourSafe = !s.colourSafe), done()) },
      ],
    };
  }

  private controlsPage(): MenuPage {
    const pad: DeviceKind = this.input.device === 'keyboard' ? (this.input.padConnected ? classifyName(this.input.padName) : 'playstation') : this.input.device;
    const rows: [string, ActionName][] = [
      ['Accelerate', 'accelerate'],
      ['Brake / reverse', 'brake'],
      ['Steer', 'steer'],
      ['Handbrake', 'handbrake'],
      ['Nitrous', 'nitro'],
      ['Shift up (manual)', 'shiftUp'],
      ['Shift down (manual)', 'shiftDown'],
      ['Change camera', 'camera'],
      ['Look back / horn', 'lookBack'],
      ['Look left / right', 'lookSide'],
      ['Look around', 'look'],
      ['Reset car', 'reset'],
      ['Pause', 'pause'],
    ];
    return {
      title: 'Controls',
      eyebrow: `Keyboard · ${deviceLabel(pad)}`,
      items: [{ label: 'Back', accept: () => this.menu.goBack() }],
      extra: () =>
        `<div class="bind"><span class="h">Action</span><span class="h">Keys</span><span class="h">Pad</span>` +
        rows.map(([l, a]) => `<span>${l}</span><kbd>${a === 'lookBack' ? 'B · H' : glyph('keyboard', a)}</kbd><kbd>${glyph(pad, a)}</kbd>`).join('') +
        `<span>Fullscreen</span><kbd>F</kbd><kbd>Menu</kbd></div>`,
    };
  }

  private testRumble(): void {
    // heavy motor, then light motor, then both: lets you feel the two channels separately
    this.haptics.pulse(1, 0, 0.35);
    setTimeout(() => this.haptics.pulse(0, 1, 0.35), 450);
    setTimeout(() => this.haptics.pulse(1, 1, 0.5), 900);
    if (!this.input.padConnected) this.hud.toast('No controller detected');
    else if (!this.haptics.supported) this.hud.toast('This browser does not expose rumble for the pad');
  }

  // ── Cars on track ────────────────────────────────────────────────────────
  private buildCarVisuals(): void {
    for (const v of this.carVisuals) this.scene.remove(v.root);
    for (const t of this.tags) if (t) this.scene.remove(t);
    this.carVisuals = [];
    this.tags = [];
    this.renderPoses = [];
    for (const c of this.race.cars) {
      // 4.5: an imported car when its model is here, else the Phantom X1
      const v = makeCarVisual(c.edition);
      v.setLook(c.look);
      if (this.env) v.setNight(this.env.p.carLights);
      this.scene.add(v.root);
      this.carVisuals.push(v);
      this.renderPoses.push({ x: c.s.x, y: c.s.y, z: c.s.z, yaw: c.s.yaw, pitch: 0, roll: 0 });
      const tag = c.isPlayer ? null : makeNameTag(c.number, c.name, c.look.color);
      if (tag) {
        mainOnly(tag);
        this.scene.add(tag);
      }
      this.tags.push(tag);
    }
    // the cockpit rides on the player's sprung body (an imported car brings its own interior)
    this.carVisuals[0]?.body.add(this.cockpit.root);
    this.cockpit.useOwnInterior(this.carVisuals[0]?.eye ?? null);
    this.applyCarSetup();
  }

  /** 4.6: the player's car sets the hood / bumper camera spots, the rev dial and the engine voice. */
  private applyCarSetup(): void {
    if (!this.rig || !this.carVisuals.length) return; // (the first build runs before the camera exists)
    const pe = this.race.player.edition;
    const model = modelOf(pe);
    const nose = this.carVisuals[0]?.noseZ ?? 2.42;
    const imported = this.carVisuals[0]?.imported ?? false;
    this.rig.carCams = {
      hood: model.cams?.hood && imported ? model.cams.hood : [0.62, 1.0],
      bumper: model.cams?.bumper && imported ? model.cams.bumper : [imported ? nose + 0.12 : 2.62, 0.4],
    };
    const tv = tunedVehicle(imported ? pe : 'x1-street');
    Object.assign(PLAYER_ENGINE, { idleRpm: tv.idleRpm, redlineRpm: tv.redlineRpm, upshiftRpm: tv.upshiftRpm });
    this.audio.setVoice(imported ? model.voice ?? 'x1' : 'x1');
    // a new car means a new ghost model too
    if (this.ghostCar) {
      this.scene.remove(this.ghostCar.root);
      this.ghostCar = null;
    }
    this.physics.s.manual = this.settings.manual;
  }

  /** Throw the current field away and build a new one (rivals on/off, difficulty change). */
  private rebuildRace(specs?: CarSpec[]): void {
    this.race = this.makeRace(specs);
    this.resetRaceFlow();
    this.pview?.attach(this.race.pursuit, this.settings.quality);
    this.pview?.setNight(this.env?.p.carLights ?? 0, this.env?.p.wet ?? 0);
    // 4E: compile Air One's shaders now, not mid-chase when it first comes into view
    if (this.race.pursuit && this.pview && this.renderer) {
      this.pview.warm(true);
      try {
        this.renderer.compile(this.scene, this.rig.camera);
      } catch {
        /* optional */
      }
      this.pview.warm(false);
    }
    this.buildCarVisuals();
    this.props.reset();
    this.skids.clear();
    this.driftScore = 0;
    this.rig.snap(this.pose);
  }

  private blips: { x: number; z: number; color: string }[] = [];
  private rivalBlips(): { x: number; z: number; color: string }[] {
    const cars = this.race.cars;
    this.blips.length = cars.length - 1;
    for (let i = 1; i < cars.length; i++) {
      const p = this.renderPoses[i];
      const b = this.blips[i - 1] || (this.blips[i - 1] = { x: 0, z: 0, color: '' });
      b.x = p.x;
      b.z = p.z;
      b.color = '#' + cars[i].look.color.toString(16).padStart(6, '0');
    }
    return this.blips;
  }

  /** Name tags float above rivals and fade out with distance. */
  private updateTags(): void {
    const cam = this.rig.camera.position;
    for (let i = 1; i < this.tags.length; i++) {
      const t = this.tags[i];
      if (!t) continue;
      const p = this.renderPoses[i];
      const d = Math.hypot(p.x - cam.x, p.z - cam.z);
      const a = clamp01((150 - d) / 60) * clamp01((d - 5) / 6);
      t.visible = a > 0.02 && this.state !== 'menu' && !this.race.cars[i].gone;
      if (!t.visible) continue;
      t.position.set(p.x, p.y + 1.72, p.z);
      (t.material as THREE.SpriteMaterial).opacity = a;
      const k = 1 + Math.max(0, d - 25) * 0.012; // grow a little with distance so they stay readable
      t.scale.set(2.3 * k, 0.575 * k, 1);
    }
  }

  /** Starting lights, and what rivals' cars need each step (sparks, clearing their one-shot events). */
  private handleRaceEvents(): void {
    const race = this.race;
    if (race.lightEvent > 0.5) {
      this.hud.pop(String(race.lightEvent), 'Get ready', false, 0.95);
      this.audio.beep(false);
      this.haptics.pulse(0.45, 0.2, 0.14);
    } else if (race.lightEvent === 0.5) {
      this.hud.pop('SET', 'Hold it…', false, 3);
      this.audio.beep(false);
      this.haptics.pulse(0.6, 0.3, 0.12);
    } else if (race.lightEvent === 0) {
      if (race.jumped) this.hud.pop('JUMP START', `Held for ${RACE_FLOW.jumpPenalty.toFixed(1)} s`, false, 1.6);
      else this.hud.pop('GO', 'Lights out', true, 1.1);
      this.audio.beep(true);
      this.haptics.pulse(1, 0.8, 0.3);
    }
    const me = this.physics.s;
    for (let i = 1; i < race.cars.length; i++) {
      const s = race.cars[i].s;
      if (s.impacts.length) {
        let worst = 0;
        for (const im of s.impacts) {
          worst = Math.max(worst, im.strength);
          if (im.strength > 1.5) this.particles.sparks(im.x, im.y, im.z, im.nx, im.nz, s.vx, s.vz, Math.min(14, Math.round(3 + im.strength * 1.5)));
        }
        s.impacts.length = 0;
        // a crash you can hear if it is close and you weren't part of it (yours is handled with the player's events)
        const d = Math.hypot(s.x - me.x, s.z - me.z);
        if (d < 70 && d > 4.5 && worst > 2) this.audio.impact(worst * (1 - d / 70) * 0.7);
      }
      s.landing = 0;
      s.lastAirTime = 0;
      s.shiftEvent = 0;
    }
  }

  // ── Main loop ────────────────────────────────────────────────────────────
  private capturePose(out: CarPose): void {
    const s = this.physics.s;
    out.x = s.x;
    out.y = s.y;
    out.z = s.z;
    out.yaw = s.yaw;
    out.pitch = s.pitch;
    out.roll = s.roll;
  }

  /**
   * Behind the menus. Home: the player's car drifts endless circles on the skid pad in a cloud of
   * smoke (scripted, not simulated, so it never spins out or wanders off). Car select and garage:
   * the car stands still in the middle of the pad while the camera circles it.
   */
  private attract(dt: number): void {
    const cars = this.race.cars;
    for (let i = 1; i < cars.length; i++) {
      this.carVisuals[i].root.visible = false;
      const t = this.tags[i];
      if (t) t.visible = false;
    }
    this.carVisuals[0].root.visible = true;
    const s = this.physics.s;
    const P = this.world.pad;
    const showroom = this.screens.showroom;
    this.attractT += dt;
    if (showroom) {
      s.x = P.x;
      s.z = P.z;
      s.vx = s.vz = s.speed = s.forwardSpeed = s.sideSlip = s.yawRate = 0;
      s.yaw = 0.6;
      s.pitch = s.roll = 0;
      s.y = this.world.heightAt(s.x, s.z);
      s.rpm = 950;
      s.throttle = s.brake = 0;
      s.nitroActive = false;
      s.steerAngle = 0.22;
      for (let i = 0; i < 4; i++) {
        s.wheelSlip[i] = 0;
        s.wheelContact[i] = true;
        s.wheelGround[i] = 0;
        s.wheelDrop[i] = 0;
      }
    } else {
      const R = 15;
      const v = 15.5; // m/s around the circle
      const th = this.attractT * (v / R);
      const cx = P.x - 10;
      const cz = P.z + 4;
      const nx = cx + Math.cos(th) * R;
      const nz = cz + Math.sin(th) * R;
      const vx = -Math.sin(th) * v;
      const vz = Math.cos(th) * v;
      const travel = Math.atan2(vx, vz);
      const inward = Math.atan2(cx - nx, cz - nz);
      const slip = 0.62 + 0.08 * Math.sin(this.attractT * 0.9);
      const toward = wrapAngle(inward - travel) > 0 ? 1 : -1;
      s.x = nx;
      s.z = nz;
      s.vx = vx;
      s.vz = vz;
      s.yaw = travel + toward * slip;
      s.yawRate = (v / R) * toward;
      s.speed = v;
      s.forwardSpeed = v * Math.cos(slip);
      s.sideSlip = -toward * slip;
      s.y = this.world.heightAt(nx, nz);
      s.pitch = 0.012;
      s.roll = -toward * 0.035;
      s.steerAngle = -toward * 0.42; // opposite lock
      s.rpm = 6300 + 500 * Math.sin(this.attractT * 3.1);
      s.throttle = 0.85;
      s.gear = 2;
      s.nitroActive = false;
      for (let i = 0; i < 4; i++) {
        s.wheelSlip[i] = i < 2 ? 0.25 : 1;
        s.wheelContact[i] = true;
        s.wheelGround[i] = 0;
        s.wheelDrop[i] = 0;
        s.wheelSurface[i] = 0;
        s.wheelRot[i] += ((i < 2 ? v : v * 1.8) / 0.36) * dt;
      }
    }
    const pr = this.race.player.prev;
    pr.x = s.x;
    pr.y = s.y;
    pr.z = s.z;
    pr.yaw = s.yaw;
    pr.pitch = s.pitch;
    pr.roll = s.roll;
  }

  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    // frame cap: on a fast screen (120/144 Hz) skip frames to hold 60 or 120 if asked
    const cap = this.fpsCap();
    if (cap < 1000 && now - this.last < 1000 / cap - 2) return;
    const cpu0 = prof.now();
    const rawDt = Math.max(0.0001, (now - this.last) / 1000);
    const dt = Math.min(0.1, rawDt);
    this.last = now;
    this.time += dt;
    vegUniforms.uTime.value = this.time;
    vegUniforms.uWind.value = 0.45 + 0.9 * (this.env.p.rain > 0 ? this.env.rainK : 0);
    // 4D: crowd, flags, traffic and birds
    if (this.visuals.dressing) {
      const cars = this.carDots;
      cars.length = 0;
      for (const c of this.race.cars) if (!c.gone) cars.push({ x: c.s.x, z: c.s.z, speed: c.s.speed });
      this.visuals.dressing.update(dt, this.time, cars, this.env.p.carLights, this.env.p.rain > 0 ? this.env.rainK : 0);
    }
    const a = this.input.poll(dt);
    const s = this.physics.s;
    this.updateMusic(a);
    this.updateLobby(a);

    if (this.state === 'menu') {
      if (this.menu.isOpen) this.menu.handle(a);
      else this.screens.handle(a);
      this.screens.update(dt);
      this.attract(dt);
    } else if (this.state === 'paused') {
      this.menu.handle(a);
    } else if (this.state === 'photo') {
      const r = this.photo.update(dt, a);
      this.post.photoDof = { focus: this.photo.focus, aperture: this.photo.aperture };
      this.renderer.toneMappingExposure = this.env.p.exposure * this.env.exposureK * Math.pow(2, this.photo.exposure);
      if (r === 'exit') this.exitPhoto();
      else if (r === 'save') this.savePhoto();
      else if (r === 'air') {
        const h = this.race.pursuit?.heli;
        if (h?.active) this.photo.jumpTo(this.pview.heli.lampPos.clone().add(new THREE.Vector3(0, -0.6, 0)), this.carVisuals[0].root.position.clone().add(new THREE.Vector3(0, 0.8, 0)));
        else this.hud.toast("Air One isn't up right now");
      }
    } else if (this.state === 'results') {
      this.screens.handle(a);
      this.screens.update(dt);
    } else {
      if (a.pause) this.pause();
      if (a.camera) {
        this.hud.toast(`${this.rig.nextMode()} camera`);
        this.settings.camera = this.rig.mode;
        saveSettings(this.settings);
      }
      if (a.reset) this.manualRejoin();
      if (a.shiftUp) this.pendingShiftUp = true;
      if (a.shiftDown) this.pendingShiftDown = true;
    }

    // ── Online: read everyone's latest state, publish ours ──
    if (this.env.conditions.weather === 'rain') this.audio.prepareThunder();
    this.online.update(rawDt);
    // 4G.2: hosting, offline or not sharing: our own music again
    if (this.music.followingHost && (this.online.status !== 'online' || this.online.isHost || this.settings.onlineMusic !== 'host')) this.music.unfollow();
    if (this.online.status === 'online') this.refreshOnlineUi();
    const netLive = this.online.status === 'online' && this.state !== 'menu';

    // ── Fixed-step simulation ──
    // (an online race cannot pause for one player: with the menu open the world keeps running)
    let steps = 0;
    const running = this.state === 'playing' || this.state === 'results';
    if (running || (netLive && (this.state === 'paused' || this.state === 'photo'))) {
      this.acc += dt * this.timeScale;
      const drive = this.state === 'playing' && !this.race.player.finished;
      const inp: VehicleInput = { throttle: drive ? a.throttle : 0, brake: drive ? a.brake : 0, steer: drive ? a.steer : 0, handbrake: drive ? a.handbrake : false, nitro: drive && a.nitro, analog: a.analogSteer, shiftUp: false, shiftDown: false };
      const tPhys = prof.now();
      const aiBefore = prof.frame.ai + prof.frame.police;
      while (this.acc >= PHYSICS_DT && steps < 12) {
        inp.shiftUp = this.pendingShiftUp;
        inp.shiftDown = this.pendingShiftDown;
        this.pendingShiftUp = this.pendingShiftDown = false;
        this.race.step(inp, PHYSICS_DT);
        for (let i = this.race.cars.length - 1; i >= 0; i--) this.props.step(this.race.cars[i].s, PHYSICS_DT); // player last
        this.handleRaceEvents();
        if (this.race.pursuit) this.handlePursuitEvents(this.race.pursuit.events);
        this.handleStepEvents();
        if (this.race.rejoined) {
          this.afterRejoin();
          this.flashFade();
        }
        this.acc -= PHYSICS_DT;
        steps++;
      }
      if (steps === 12) this.acc = 0; // fell badly behind (tab was throttled): drop the backlog
      prof.add('physics', tPhys);
      prof.sub('physics', prof.frame.ai + prof.frame.police - aiBefore); // counted on their own
    }
    this.stepsLast = steps;

    // ── Race flow: finish → slow motion → results ──
    if (running) {
      if (this.finishHandled) {
        this.finishT += dt;
        if (this.timeScale < 1) this.timeScale = this.finishT < 2.2 ? 0.35 : Math.min(1, this.timeScale + dt * 1.5);
        if (this.state === 'playing' && this.finishT > 3.2) this.showResults();
      }
      this.updateAlert();
    }

    // Interpolated render poses for every car (index 0 = player)
    const live = running || (netLive && (this.state === 'paused' || this.state === 'photo'));
    const al = live ? clamp01(this.acc / PHYSICS_DT) : 1;
    let tSec = prof.now();
    const cars = this.race.cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const p = this.renderPoses[i];
      p.x = lerp(c.prev.x, c.s.x, al);
      p.y = lerp(c.prev.y, c.s.y, al);
      p.z = lerp(c.prev.z, c.s.z, al);
      p.yaw = c.prev.yaw + wrapAngle(c.s.yaw - c.prev.yaw) * al;
      p.pitch = lerp(c.prev.pitch, c.s.pitch, al);
      p.roll = lerp(c.prev.roll, c.s.roll, al);
      this.carVisuals[i].update(c.s, p, this.time, dt);
      // level of detail by distance from the camera (your own car is always full detail)
      const cd = i === 0 || this.photo.active ? 0 : this.rig.camera.position.distanceTo(this.carVisuals[i].root.position);
      // (4.6: an imported model is heavy: other cars drop to its lighter copy unless right beside you)
      this.carVisuals[i].setDetail(cd < (this.carVisuals[i].imported ? 14 : 45) ? 0 : cd < 130 ? 1 : 2);
      // a rejoined car is a ghost for a moment: it blinks and nothing can hit it
      if (live) this.carVisuals[i].root.visible = !c.gone && (c.s.ghost <= 0 || Math.floor(this.time * 12) % 2 === 0);
    }
    const rp = this.renderPoses[0];
    this.props.render();
    tSec = prof.add('scene', tSec);
    if (live) {
      for (let i = 0; i < cars.length; i++) this.emitCarEffects(i, dt);
      this.updateDriftCounter(dt);
    } else if (this.state === 'menu' && !this.screens.showroom) this.emitCarEffects(0, dt); // home drift smoke
    this.particles.update(live || this.state === 'menu' ? dt * this.timeScale : 0);
    tSec = prof.add('particles', tSec);

    // Audio + rumble
    if (live) {
      this.audio.update(s, this.state === 'playing' && a.horn);
      this.hud.showSoundHint(!this.audio.running);
    }
    this.haptics.update(this.input.pad, live && this.state !== 'results' ? s : null, dt);

    // Camera + sun shadow frustum
    const pl = this.state === 'playing';
    if (this.shotCam) {
      // dev / tools/compare.py: hold the camera at a fixed spot
      const c = this.rig.camera;
      const v = this.shotCam;
      c.position.set(v[0], v[1], v[2]);
      c.up.set(0, 1, 0);
      c.lookAt(v[3], v[4], v[5]);
      c.fov = v[6] ?? 60;
      c.updateProjectionMatrix();
    } else if (this.bench) this.benchCamera(dt);
    else if (this.state !== 'photo') this.rig.update(rp, s, dt, { x: pl ? a.lookX : 0, y: pl ? a.lookY : 0, back: pl && a.lookBack, side: pl ? a.lookSide : 0, mouse: pl ? a.mouseLook : null }, this.state === 'menu' ? (this.screens.showroom ? 'showroom' : 'home') : false);
    // 4E: the Air One arrival shot: looking down from the helicopter at your car
    if (this.airCam > 0) {
      this.airCam -= dt;
      const h = this.race.pursuit?.heli;
      if (!h?.active || this.state !== 'playing' || this.shotCam) this.airCam = 0;
      else {
        const c = this.rig.camera;
        const lp = this.pview.heli.lampPos;
        c.position.set(lp.x, lp.y - 0.4, lp.z);
        c.up.set(0, 1, 0);
        c.lookAt(rp.x + s.vx * 0.15, rp.y + 0.6, rp.z + s.vz * 0.15);
        c.fov = 38;
        c.updateProjectionMatrix();
      }
    }
    this.visuals.follow(rp.x, rp.y, rp.z);
    tSec = prof.add('scene', tSec);
    this.pview.update(this.time, live ? dt * this.timeScale : 0, al, this.rig.camera);
    tSec = prof.add('police', tSec);
    // from the hood and bumper the beam on the road would be right in your eyes: soften it
    const inCar = this.state === 'playing' && this.rig.inCar;
    this.updateCockpit(dt, s, live);
    this.env.headScale = inCar ? 0.6 : 1;
    if (this.carVisuals[0]) this.carVisuals[0].setNight(this.env.p.carLights * (inCar ? 0.35 : 1));
    this.updateEnvironment(dt, live);
    this.updateGhost();
    this.updateSmokeLight();
    // dusk to night: move the light along with the race
    if (this.env.conditions.time === 'dynamic' && live) {
      this.dynTick -= dt;
      if (this.dynTick <= 0) {
        this.dynTick = 1;
        const r = this.race;
        const t = r.targetLaps > 0 ? r.distanceOf(r.player) / r.targetLaps : r.time / 360;
        this.env.setProgress(clamp01(t));
        this.lookExtras();
      }
    }
    this.visuals.clouds.position.x = rp.x;
    this.visuals.clouds.position.z = rp.z;
    const cm = (this.visuals.clouds.material as THREE.MeshBasicMaterial).map!;
    cm.offset.x = this.time * 0.0012 + rp.x / 5200;
    cm.offset.y = -rp.z / 5200;
    this.particles.setViewport(this.renderer.domElement.height, this.rig.camera.fov);
    this.env.rain.setViewport(this.renderer.domElement.height, this.rig.camera.fov);
    tSec = prof.add('env', tSec);

    // HUD
    if (this.state === 'playing' || this.state === 'paused') {
      this.hud.update(s, this.lap, this.settings.mph, dt, this.race.player.place, cars.length, this.lap.laps + (this.lap.running ? 1 : 0), this.race.targetLaps);
      this.hud.throttle = this.race.player.input.throttle;
      this.hud.drawMap(rp.x, rp.z, rp.yaw, Math.abs(s.speed), this.rivalBlips(), this.pview.mapIcons(this.icons), this.time, dt);
      this.updateBoard(dt);
      this.updatePursuitHud(dt);
      this.updateTags();
    }
    tSec = prof.add('hud', tSec);

    // Render
    this.boost = lerp(this.boost, live ? s.nitroLevel : 0, damp(8, dt));
    this.impactFlash = Math.max(0, this.impactFlash - dt * 2.5);
    this.renderer.info.reset();
    groundUniforms.uTime.value = this.time % 1000;
    groundUniforms.uNearCenter.value.set(this.visuals.sun.target.position.x, this.visuals.sun.target.position.z);
    this.updateCarMotion();
    this.gpu.begin();
    const info = this.renderer.info.render;
    let calls = info.calls;
    tSec = prof.now();
    if (this.cockpit.root.visible && this.carVisuals[0]) this.cockpit.renderMirrors(this.renderer, this.scene, this.carVisuals[0].body, this.settings.quality);
    prof.drawCalls('mirrors', info.calls - calls);
    tSec = prof.add('mirrors', tSec);
    // (the wet-road mirror and the paint probe time and count themselves inside the post pass)
    calls = info.calls;
    this.pview.renderSpotShadow(this.renderer, this.rig.camera);
    this.post.render(this.time, live ? clamp01(s.speed / 105) : 0, this.boost, this.impactFlash);
    prof.drawCalls('main', info.calls - calls - this.beforeCalls);
    tSec = prof.add('main', tSec);
    prof.sub('main', this.beforeMs);
    this.beforeCalls = 0;
    this.beforeMs = 0;
    calls = info.calls;
    this.renderMirror();
    prof.drawCalls('hudMirror', info.calls - calls);
    prof.add('mirrors', tSec);
    this.gpu.end();

    prof.endFrame(prof.now() - cpu0);
    this.trackPerformance(rawDt);
  }

  // ── Pursuit: events → HUD, radio, sound, rumble and Speed Points ──
  private icons: MapIcon[] = [];
  private lastRadio = '';
  private handlePursuitEvents(events: PursuitEvent[]): void {
    const p = this.race.pursuit!;
    for (const e of events) {
      switch (e.type) {
        case 'radio':
          this.radio(e.text);
          break;
        case 'join':
          this.hud.pop('POLICE', 'Pursuit on', false, 2.2);
          this.haptics.pulse(0.6, 0.9, 0.5);
          break;
        case 'heat':
          this.hud.pop(`HEAT ${e.level}`, 'Pursuit rising', false, 2);
          this.haptics.pulse(0.5, 0.7, 0.35);
          break;
        case 'zones':
          this.hud.toast('Speed cameras live · work zones on the circuit');
          break;
        case 'trap':
          this.hud.pop(`${Math.round(e.speed * (this.settings.mph ? 2.23694 : 3.6))} ${this.settings.mph ? 'mph' : 'km/h'}`, 'Speed camera', false, 1.8);
          this.pview.flashTrap();
          this.audio.camera();
          this.impactFlash = Math.max(this.impactFlash, 0.8);
          this.haptics.pulse(0.3, 0.8, 0.2);
          break;
        case 'roadblock':
          this.hud.toast(e.gap ? `Roadblock ahead · the gap is ${e.gap === 'centre' ? 'in the middle' : `on the ${e.gap}`}` : 'Roadblock ahead · find the gap');
          break;
        case 'bounty':
          this.earn(e.amount);
          if (e.why) this.hud.pop(`+${e.amount.toLocaleString('en-US')}`, e.why, true, 1.4);
          break;
        case 'spikes':
          this.hud.toast('Spike strip ahead');
          break;
        case 'heli':
          this.hud.pop('AIR ONE', 'Police helicopter on scene', false, 2);
          this.haptics.pulse(0.4, 0.5, 0.4);
          // a short shot from the helicopter as it arrives (only while driving)
          if (this.settings.airCutIn && this.state === 'playing') this.airCam = 2.2;
          break;
        case 'heliLeave':
          this.hud.toast('Air One is leaving');
          break;
        case 'drop':
          this.hud.toast(e.kind === 'smoke' ? 'Smoke canister incoming' : e.kind === 'spikes' ? 'Spike strip dropping ahead · watch the red bar' : 'Shock charges · stay out of the red rings');
          this.audio.squelch();
          break;
        case 'landed':
          if (e.kind === 'smoke') this.audio.canister(Math.hypot(e.x - this.race.player.s.x, e.z - this.race.player.s.z));
          break;
        case 'smoked':
          this.smokeTrail = 2.6;
          this.smokeRed = e.red;
          this.rig.addShake(0.25);
          this.haptics.pulse(0.3, 0.2, 0.3);
          break;
        case 'boom': {
          const d = Math.hypot(e.x - this.race.player.s.x, e.z - this.race.player.s.z);
          this.audio.boom(d);
          this.rig.addShake(Math.max(0, 1.1 * (1 - d / 70)));
          if (d < 40) this.haptics.pulse(0.9 * (1 - d / 40), 0.9 * (1 - d / 40), 0.35);
          if (e.mine) {
            this.hud.pop('HIT', 'Shock charge', false, 1.6);
            this.haptics.pulse(1, 1, 0.7);
            this.impactFlash = Math.max(this.impactFlash, 1);
          }
          break;
        }
        case 'spiked':
          if (e.mine) {
            this.hud.pop('SPIKED', this.race.player.s.puncture > 100 ? 'Flat until the end of the lap' : 'Tyres punctured', false, 2);
            this.audio.spikes();
            this.haptics.pulse(1, 1, 0.9);
            this.rig.addShake(0.7);
          }
          break;
        case 'smash':
          if (e.mine) {
            this.audio.propHit(e.kind === 'cone' ? 0 : 1);
            this.haptics.pulse(e.kind === 'cone' ? 0.25 : 0.6, 0.4, 0.15);
          }
          break;
        case 'policeHit':
          this.haptics.pulse(0.8, 0.6, 0.25);
          break;
        case 'busted': {
          const fine = Math.min(this.settings.speedPoints, e.fine + (e.lost ?? 0));
          this.settings.speedPoints -= fine;
          this.raceEarned -= fine;
          this.bustedFine = fine;
          this.haptics.pulse(1, 1, 1.1);
          this.audio.impact(4);
          if (this.online.status !== 'online') this.timeScale = 0.3;
          this.slowT = 1.3;
          break;
        }
        case 'freed':
          this.hud.pop('FREED', 'Your crew broke the arrest', true, 2);
          this.haptics.pulse(0.7, 0.9, 0.4);
          break;
        case 'restart':
          this.afterRejoin();
          this.flashFade();
          this.hud.toast('Back in, behind the field');
          break;
        case 'evaded':
          this.hud.pop('EVADED', `+${e.bounty.toLocaleString('en-US')} bounty`, true, 2.6);
          this.earn(e.bounty);
          this.haptics.pulse(0.6, 1, 0.6);
          break;
        case 'breaker':
          this.hud.pop(e.wrecked ? `${e.wrecked} DOWN` : 'BREAKER', `Pursuit breaker · +${e.bounty.toLocaleString('en-US')}`, true, 2.4);
          this.earn(e.bounty);
          this.haptics.pulse(1, 0.8, 0.7);
          this.rig.addShake(0.5);
          break;
        case 'wrecked':
          break;
      }
    }
    events.length = 0;
    void p;
  }

  private radio(text: string): void {
    if (text === this.lastRadio) return;
    this.lastRadio = text;
    this.hud.radio(text);
    this.audio.squelch();
    if (this.settings.radioVoice && typeof speechSynthesis !== 'undefined' && this.state === 'playing') {
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text.replace(/^Dispatch: /, ''));
        u.rate = 1.12;
        u.pitch = 0.75;
        u.volume = Math.min(1, this.settings.volume * 0.9);
        speechSynthesis.speak(u);
      } catch {
        /* no voice available */
      }
    }
  }

  private bustedFine = 0;
  private slowT = 0;
  /** 4E: seconds left of the Air One arrival shot */
  private airCam = 0;
  /** 4E: seconds of smoke trailing off your car after driving through a smoke screen */
  private smokeTrail = 0;
  private smokeRed = false;
  private airTag: HTMLElement | null = null;
  private tagPanels: DOMRect[] = [];
  private tagPanelT = 0;
  private tagV = new THREE.Vector3();
  private sirenVoices: { dist: number; closing: number; phase: number; mode?: 'wail' | 'yelp' | 'phaser' }[] = [];
  /** Heat panel, meters, Busted card and sirens. */
  private updatePursuitHud(dt: number): void {
    const p = this.race.pursuit;
    const bustedEl = document.getElementById('busted')!;
    if (!p) {
      this.hud.setPursuit({ on: false, joined: false, heat: 0, status: '', cool: false, bust: 0, evade: 0, air: '' });
      bustedEl.hidden = true;
      this.audio.setSirens([], dt);
      this.audio.setHeli(0, 0, 0, false);
      if (this.airTag) this.airTag.hidden = true;
      this.env.rain.setWash(0, 0, 0, 0);
      return;
    }
    const laps = Math.max(1, this.race.targetLaps);
    const joinLap = Math.floor(POLICE.joinAt * laps) + 1;
    const units = p.units.filter((u) => u.active).length;
    const status = !p.joined
      ? `${p.trapsLive ? 'Cameras live · ' : ''}Police join on lap ${joinLap}`
      : p.cooldown > 0
        ? 'Lost you · units searching'
        : `${units} unit${units === 1 ? '' : 's'}${p.obstacles.some((o) => o.group === 'roadblock') ? ' · roadblock' : ''}`;
    const h = p.heli;
    const air = h.active && h.mode === 'chase' ? (h.sees ? 'spotted' : 'hidden') : h.active && h.mode === 'inbound' ? 'inbound' : '';
    const status2 = p.searching ? (p.hiding ? 'Hiding · they\'re searching' : 'They lost sight of you · searching') : status;
    this.hud.setPursuit({ on: true, joined: p.joined, heat: p.heat, status: status2, cool: p.cooldown > 0, bust: p.bust, evade: p.evade, air, bounty: p.bounty });
    this.updateAirOne(p, dt);
    // Busted card
    const busted = p.bustedT > 0;
    if (bustedEl.hidden === busted) bustedEl.hidden = !busted;
    if (busted) {
      (document.getElementById('busted-fill') as HTMLElement).style.transform = `scaleX(${(1 - p.bustedT / POLICE.bustPenalty).toFixed(3)})`;
      document.getElementById('busted-sub')!.textContent = `Fine −${this.bustedFine.toLocaleString('en-US')} Speed Points`;
      const crew = this.online.status === 'online' && this.online.players.length > 1 && p.bustedT > POLICE.bustPenalty - POLICE.freeWindow;
      document.getElementById('busted-note')!.textContent = crew ? `Crew: ram the arresting cruiser to free you · ${Math.ceil(p.bustedT - (POLICE.bustPenalty - POLICE.freeWindow))} s` : `Back in the race in ${Math.ceil(p.bustedT)} s, behind the field`;
    }
    // slow motion at the moment of the bust
    if (this.slowT > 0) {
      this.slowT -= dt;
      if (this.slowT <= 0 && !this.finishHandled) this.timeScale = 1;
    }
    // sirens: the two units nearest you, Doppler from their closing speed
    const me = this.race.player.s;
    const v = this.sirenVoices;
    v.length = 0;
    const hot = p.joined && p.cooldown <= 0;
    const list = p.units
      .filter((u) => u.active)
      .map((u) => {
        const dx = me.x - u.car.s.x;
        const dz = me.z - u.car.s.z;
        const d = Math.hypot(dx, dz) || 1;
        const closing = ((u.car.s.vx - me.vx) * dx + (u.car.s.vz - me.vz) * dz) / d;
        // a horn blast as a unit closes in for a ram (at most every few seconds per unit)
        u.hornT += dt;
        if (hot && this.state === 'playing' && d < POLICE_LOOK.hornRange && closing > POLICE_LOOK.hornClosing && u.hornT > 4) {
          u.hornT = 0;
          this.audio.horn2(d);
        }
        const mode: 'wail' | 'yelp' | 'phaser' = !hot ? 'wail' : d < 18 ? 'phaser' : d < 60 || p.level >= 3 ? 'yelp' : 'wail';
        return { dist: d, closing, phase: u.id * 0.31, mode };
      })
      .sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < Math.min(2, list.length); i++) v.push(list[i]);
    this.audio.setSirens(this.state === 'playing' ? v : [], dt);
  }

  /** 4E: Air One's sound, the tag over it, the rotor wash in the rain, the smoke trail */
  private updateAirOne(p: import('./game/Pursuit').Pursuit, dt: number): void {
    const h = p.heli;
    const cam = this.rig.camera;
    const on = h.active && (this.state === 'playing' || this.state === 'results');
    if (on) {
      const cp = cam.position;
      const dx = h.x - cp.x;
      const dy = h.y - cp.y;
      const dz = h.z - cp.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const me = this.race.player.s;
      const closing = -((h.vx - me.vx) * dx + (h.vz - me.vz) * dz) / d;
      // left / right of the view
      const right = this.tagV.set(1, 0, 0).applyQuaternion(cam.quaternion);
      const pan = (dx * right.x + dz * right.z) / d;
      this.audio.setHeli(d, closing, pan, true);
    } else this.audio.setHeli(0, 0, 0, false);
    // rotor wash in the rain
    this.env.rain.setWash(h.x, h.y, h.z, h.active ? Math.max(0, Math.min(1, (42 - h.y) / 26)) : 0);
    // "AIR ONE" over the helicopter while it's chasing
    if (!this.airTag) {
      this.airTag = document.createElement('div');
      this.airTag.id = 'air-tag';
      this.airTag.innerHTML = '<i></i><b>AIR ONE</b>';
      document.getElementById('hud')!.appendChild(this.airTag);
    }
    const tag = this.airTag;
    let show = false;
    if (on && h.mode !== 'leaving' && this.airCam <= 0) {
      const v = this.tagV.set(h.x, h.y + 3.2, h.z).project(cam);
      const dist = Math.hypot(h.x - cam.position.x, h.z - cam.position.z);
      const tx = ((v.x + 1) / 2) * innerWidth;
      const ty = ((1 - v.y) / 2) * innerHeight;
      // 4F.1: never on top of a HUD panel (the helicopter can be "behind" the race board)
      this.tagPanelT -= dt;
      if (this.tagPanelT <= 0) {
        this.tagPanelT = 0.5;
        this.tagPanels = ['hud-top', 'hud-event', 'hud-heat', 'hud-map', 'hud-cluster']
          .map((id) => document.getElementById(id))
          .filter((e): e is HTMLElement => !!e && e.offsetParent !== null)
          .map((e) => e.getBoundingClientRect());
      }
      const underPanel = this.tagPanels.some((r) => tx > r.left - 50 && tx < r.right + 50 && ty > r.top - 4 && ty < r.bottom + 30);
      if (v.z < 1 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 && dist < 420 && !underPanel) {
        show = true;
        tag.style.transform = `translate(${tx}px, ${ty}px) translate(-50%, -100%)`;
        tag.classList.toggle('lit', h.sees);
        tag.style.opacity = String(Math.max(0.35, 1 - dist / 420));
      }
    }
    if (tag.hidden === show) tag.hidden = !show;
    // a smoke trail behind you after a smoke screen
    if (this.smokeTrail > 0 && dt > 0) {
      this.smokeTrail -= dt;
      const s = this.race.player.s;
      const n = Math.min(6, Math.round(dt * 40 * Math.min(1, this.smokeTrail)));
      for (let i = 0; i < n; i++) this.particles.smoke(s.x - Math.sin(s.yaw) * 2.2, s.y + 0.6, s.z - Math.cos(s.yaw) * 2.2, s.vx * 0.3, s.vz * 0.3, 0.9);
    }
  }

  /** where each car was drawn last frame, for motion blur that keeps cars sharp */
  private lastDrawn = new Map<THREE.Object3D, THREE.Vector3>();
  private updateCarMotion(): void {
    const out = this.post.carMotion;
    out.length = 0;
    const cam = this.rig.camera.position;
    const roots: THREE.Object3D[] = [...this.carVisuals.map((v) => v.root as THREE.Object3D), ...this.pview.unitRoots()];
    for (const r of roots) {
      if (!r.visible) continue;
      const p = r.position;
      const last = this.lastDrawn.get(r);
      const d = last ? { dx: p.x - last.x, dy: p.y - last.y, dz: p.z - last.z } : { dx: 0, dy: 0, dz: 0 };
      if (Math.hypot(d.dx, d.dz) > 20) d.dx = d.dy = d.dz = 0; // teleported
      if (out.length < 12 && p.distanceToSquared(cam) < 160 * 160) out.push({ x: p.x, y: p.y + 0.6, z: p.z, r: 3, ...d });
      if (last) last.copy(p);
      else this.lastDrawn.set(r, p.clone());
    }
    if (this.lastDrawn.size > 40) this.lastDrawn.clear();
  }

  private envCars: { root: THREE.Object3D; braking: boolean }[] = [];
  private drops = 0;
  /** Weather and lights that follow the camera; raindrops on the lens in the chase view. */
  private updateEnvironment(dt: number, live: boolean): void {
    const cars = this.race.cars;
    const list = this.envCars;
    list.length = cars.length;
    for (let i = 0; i < cars.length; i++) {
      const e = list[i] || (list[i] = { root: this.carVisuals[i].root, braking: false });
      e.root = this.carVisuals[i].root;
      const s = cars[i].s;
      e.braking = (s.brake > 0.05 && s.gear !== -1) || s.handbrake;
    }
    this.env.update(this.state === 'paused' ? 0 : dt, this.time, this.rig.camera, list, this.carVisuals[0]?.root ?? null, this.renderer.getPixelRatio());
    this.updateRain(dt, live);
    // Lens drops on the outside cameras (the cockpit has its own windscreen rain). Auto: the
    // amount follows the rain. They gather over a few seconds (faster at speed: you drive into
    // the rain) and take about ten seconds to dry once it stops. Speed never pushes them about.
    const outside = this.rig.kind === 'chase-near' || this.rig.kind === 'chase-far' || this.rig.kind === 'bumper';
    const raining = this.env.conditions.weather === 'rain' && this.settings.quality !== 'low';
    const want = this.settings.lensDrops === 'auto' && raining && live && this.state === 'playing' && outside ? this.rainNow : 0;
    const speedN = smoothstep(5, 60, Math.abs(this.physics.s.speed));
    const rate = want > this.drops ? LENS.gather * (0.6 + this.rainNow) * (1 + LENS.speedGather * speedN) : outside ? LENS.dry : 3;
    this.drops += (want - this.drops) * Math.min(1, dt * rate);
    this.post.setDrops(this.drops, speedN);
    // a burst of nitrous blows a few drops off the lens
    const nos = this.physics.s.nitroActive;
    if (nos && !this.nosWas) this.post.flick = 1;
    this.nosWas = nos;
    this.post.flick = Math.max(0, this.post.flick - dt * 0.8);
  }

  // ── Rain intensity (4B.2): showers build and ease off; the host decides online ──
  private rainNow = 0.7;
  private nosWas = false;
  private rainForced = -1;
  private rainPhase = Math.random() * 6.28;
  private rainTick = 0;
  /** the strength the settings ask for at race time t */
  private rainCurve(t: number): number {
    switch (this.settings.rainStrength) {
      case 'light':
        return 0.3;
      case 'heavy':
        return 0.75;
      case 'downpour':
        return 1;
      default: {
        // showers over minutes: a slow swell with a faster ripple on top
        const k = 0.58 + 0.3 * Math.sin(t / 95 + this.rainPhase) + 0.16 * Math.sin(t / 31 + this.rainPhase * 2.3);
        return clamp(k, 0.25, 1);
      }
    }
  }
  /** Force an intensity (k ≥ 0), or hand it back to the settings / host (k < 0). */
  private setRainIntensity(k: number, instant: boolean): void {
    this.rainForced = k;
    if (instant && k >= 0) {
      this.rainNow = k;
      this.rainTick = 0;
      this.env.setRainIntensity(k);
    }
  }
  private updateRain(dt: number, live: boolean): void {
    const r = this.race;
    const guest = this.online.status === 'online' && !this.online.isHost;
    const want = this.rainForced >= 0 ? this.rainForced : guest ? r.rainK : this.rainCurve(r.time);
    if (!guest) r.rainK = want;
    this.rainNow += (want - this.rainNow) * Math.min(1, dt * (live ? 0.2 : 2));
    this.rainTick -= dt;
    if (this.rainTick > 0 || this.env.conditions.weather !== 'rain') return;
    this.rainTick = 0.2;
    this.env.setRainIntensity(this.rainNow);
    const p = this.env.p;
    groundUniforms.uWet.value = p.wet;
    groundUniforms.uRain.value = p.rain;
    this.audio.setRain(p.rain);
    this.audio.wet = p.wet;
    this.race.setWet?.(p.wet);
    this.pview.setNight(p.carLights, p.wet);
  }

  /** React to one-shot physics events from the step that just ran. */
  private handleStepEvents(): void {
    const s = this.physics.s;
    if (s.impacts.length) {
      let worst = 0;
      for (const im of s.impacts) {
        worst = Math.max(worst, im.strength);
        if (im.strength > 1.2) this.particles.sparks(im.x, im.y, im.z, im.nx, im.nz, s.vx, s.vz, Math.min(26, Math.round(4 + im.strength * 2.2)));
      }
      s.impacts.length = 0;
      if (this.props.hitsThisStep > 0 && worst < 1.6) this.audio.propHit(this.props.lastHitKind);
      else this.audio.impact(worst);
      const k = clamp01(worst / 9);
      this.haptics.pulse(0.35 + 0.65 * k, 0.25 + 0.6 * k, 0.16 + 0.34 * k);
      this.rig.addShake(0.12 + k * 0.8);
      this.impactFlash = Math.max(this.impactFlash, k);
      if (worst > 3 && this.driftScore > 0) {
        this.hud.pop('0', 'Drift lost', false, 1.1);
        this.driftScore = 0;
      }
    }
    if (s.landing > 1.2) {
      const k = clamp01(s.landing / 8);
      this.audio.landing(s.landing);
      this.haptics.pulse(0.5 + 0.5 * k, 0.3 * k, 0.22 + 0.25 * k);
      this.rig.addShake(0.15 + k * 0.5);
    }
    s.landing = 0;
    if (s.lastAirTime > 0.55) {
      this.hud.pop(`${s.lastAirTime.toFixed(1)} s`, 'Air time', true, 1.7);
      this.earn(s.lastAirTime * 60);
    }
    s.lastAirTime = 0;
    if (s.shiftEvent !== 0) {
      this.audio.shift(s.shiftEvent > 0);
      this.haptics.pulse(0.3, 0.12, 0.09);
      s.shiftEvent = 0;
    }
    if (s.nitroActive && !this.wasNitro) {
      this.audio.nitroOn();
      this.haptics.pulse(1, 1, 0.38);
      this.rig.addShake(0.3);
    }
    this.wasNitro = s.nitroActive;
    if (this.race.player.finished && !this.finishHandled) this.onPlayerFinish();
    else if (this.lap.event) {
      const best = this.lap.event === 2;
      this.audio.ui('lap');
      const total = this.race.targetLaps;
      this.hud.pop(formatLap(this.lap.last), best ? 'New best lap' : total > 0 && this.lap.laps === total - 1 ? 'Final lap' : `Lap ${this.lap.laps}`, best, 2.6);
      this.haptics.pulse(0.5, 0.8, best ? 0.5 : 0.2);
      this.earn(best ? 500 : 200);
    }
    if (this.lap.event) {
      if (this.lap.event === 2) this.settings.bestLap = this.lap.best;
      saveSettings(this.settings);
    }
  }

  /** Smoke, dust, skid marks and nitrous haze for one car. Runs once per rendered frame. */
  private emitCarEffects(index: number, dt: number): void {
    const s = this.race.cars[index].s;
    const rp = this.renderPoses[index];
    // rivals far from the camera don't need tyre effects
    if (index > 0) {
      const cam = this.rig.camera.position;
      if ((rp.x - cam.x) ** 2 + (rp.z - cam.z) ** 2 > 170 * 170) {
        for (let i = 0; i < 4; i++) this.skids.add(index * 4 + i, 0, 0, 0, 0, 0, 0, 0);
        return;
      }
    }
    const sn = Math.sin(rp.yaw);
    const cs = Math.cos(rp.yaw);
    for (let i = 0; i < 4; i++) {
      const wx = rp.x + sn * WHEEL_Z[i] + cs * WHEEL_X[i];
      const wz = rp.z + cs * WHEEL_Z[i] - sn * WHEEL_X[i];
      const wy = s.wheelGround[i];
      const slip = s.wheelSlip[i];
      const onGround = s.wheelContact[i];
      const grass = s.wheelSurface[i] === Surface.Grass;
      const gravel = s.wheelSurface[i] === Surface.Gravel;
      const k = index * 4 + i;
      const wet = this.env.p.wet;
      // skid marks only on hard surfaces (fainter on a wet road)
      this.skids.add(k, wx, wy, wz, cs, -sn, i < 2 ? 0.12 : 0.15, onGround && !grass && !gravel ? smoothstep(0.25, 0.8, slip) * (1 - wet * 0.6) : 0);
      // 4E: gravel: stones flung up and a dust trail
      if (gravel && onGround && s.speed > 2) {
        const gk = index * 4 + i + 128;
        this.smokeAcc[gk] = (this.smokeAcc[gk] || 0) + (smoothstep(2, 30, s.speed) * 26 + slip * 20) * (index > 0 ? 0.5 : 1) * dt;
        while (this.smokeAcc[gk] >= 1) {
          this.smokeAcc[gk] -= 1;
          this.particles.stones(wx, wy, wz, s.vx, s.vz, clamp01(s.speed / 35));
          if (Math.random() < 0.5 * (1 - wet)) this.particles.dust(wx, wy, wz, s.vx, s.vz, clamp01(s.speed / 30));
        }
      }
      // 4E: a flat tyre: sparks off the rim
      if (s.puncture > 0 && onGround && s.speed > 8 && i >= 2 && Math.random() < dt * 22 * smoothstep(8, 50, s.speed)) {
        this.particles.sparks(wx, wy + 0.1, wz, -sn * 0.3, -cs * 0.3, s.vx, s.vz, 2);
      }
      // spray in the wet: rooster tails off the rear tyres, a thinner mist off the fronts
      if (wet > 0 && onGround && s.speed > 5) {
        const sk = index * 4 + i + 64;
        const front = i < 2;
        this.smokeAcc[sk] = (this.smokeAcc[sk] || 0) + wet * smoothstep(5, 45, s.speed) * (index > 0 ? 26 : 34) * (front ? 0.35 : 1) * this.particles.sprayScale * dt;
        while (this.smokeAcc[sk] >= 1) {
          this.smokeAcc[sk] -= 1;
          this.particles.spray(wx, wy, wz, s.vx, s.vz, smoothstep(8, 65, s.speed), this.env.night, front);
        }
      }
      // smoke / dust
      let rate = 0;
      if (onGround && !gravel) rate = grass ? smoothstep(6, 30, s.speed) * 22 * (1 - wet * 0.7) + slip * 30 : smoothstep(0.3, 0.9, slip) * (i < 2 ? 18 : 46) * (1 - wet * 0.65);
      if (index > 0) rate *= 0.6;
      if (s.speed < 3) rate *= 0.35; // a standing burnout shouldn't bury the car in white
      this.smokeAcc[k] = (this.smokeAcc[k] || 0) + rate * dt;
      while (this.smokeAcc[k] >= 1) {
        this.smokeAcc[k] -= 1;
        if (grass) this.particles.dust(wx, wy, wz, s.vx, s.vz, clamp01(s.speed / 40));
        else this.particles.smoke(wx, wy, wz, s.vx, s.vz, slip);
      }
    }
    if (s.nitroActive) {
      const e = this.carVisuals[index].exhaustWorld(new THREE.Vector3());
      for (let k = 0; k < 2; k++) this.particles.haze(e.x, e.y, e.z, s.vx * 0.6, s.vz * 0.6);
    }
  }

  private updateDriftCounter(dt: number): void {
    const s = this.physics.s;
    // Drift counter
    const drifting = !s.airborne && s.speed > 12 && s.forwardSpeed > 0 && Math.abs(s.sideSlip) > 0.2 && s.onGrass < 0.6;
    if (drifting) {
      this.driftScore += Math.abs(s.sideSlip) * s.speed * dt * 14;
      this.driftHold = 0.8;
      if (this.driftScore > 40) this.hud.pop(Math.round(this.driftScore).toLocaleString('en-US'), 'Drift', false, 0.5);
    } else if (this.driftScore > 0) {
      this.driftHold -= dt;
      if (this.driftHold <= 0) {
        if (this.driftScore > 150) {
          this.hud.pop(`+${Math.round(this.driftScore).toLocaleString('en-US')}`, 'Drift banked', true, 1.5);
          this.earn(this.driftScore / 8);
        }
        this.driftScore = 0;
      }
    }
  }

  private trackPerformance(dt: number): void {
    this.dynamicResolution(dt);
    this.benchFrame(dt);
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
      // Auto-adjust: if the frame rate stays low and the player hasn't chosen a preset, step down.
      if (this.state === 'playing' && !this.settings.qualityChosen) {
        this.slowTime = this.fps < 38 ? this.slowTime + 0.5 : Math.max(0, this.slowTime - 0.25);
        const i = QUALITY_ORDER.indexOf(this.settings.quality);
        if (this.slowTime >= 3 && i > 0) {
          this.slowTime = 0;
          this.applyQuality(QUALITY_ORDER[i - 1]);
          saveSettings(this.settings);
          this.hud.toast(`Graphics set to ${QUALITY_ORDER[i - 1]} for a smoother frame rate`);
        }
      }
      if (this.settings.debug && this.state !== 'menu') {
        const info = this.renderer.info.render;
        const s = this.physics.s;
        const bar = (v: number) => '█'.repeat(Math.round(v * 10)).padEnd(10, '·');
        const pad = this.input.pad;
        const A = prof.avg;
        const C = prof.callsAvg;
        const f = (v: number) => v.toFixed(1);
        this.hud.setDebug(
          `${this.fps.toFixed(0)} fps   ${(1000 / Math.max(1, this.fps)).toFixed(1)} ms   ${this.settings.quality.toUpperCase()}   scale ${Math.round(this.renderScale * 100)}%${this.cpuSaver ? '   CPU saver' : ''}\n` +
            `CPU ${f(prof.cpuAvg)} ms   GPU ${this.gpu.supported ? (this.gpu.ms >= 0 ? this.gpu.ms.toFixed(1) + ' ms' : '…') : 'n/a'}   ${this.renderer.domElement.width}×${this.renderer.domElement.height}\n` +
            `${this.gpuName}\n` +
            `physics ${f(A.physics)}  ai ${f(A.ai)}  police ${f(A.police)}  fx ${f(A.particles)}\n` +
            `env ${f(A.env)}  hud ${f(A.hud)}  scene ${f(A.scene)}  other ${f(A.other)}\n` +
            `draw: main ${f(A.main)} ms/${C.main.toFixed(0)}  road ${f(A.reflect)}/${C.reflect.toFixed(0)}  probe ${f(A.probe)}/${C.probe.toFixed(0)}  mirrors ${f(A.mirrors)}/${(C.mirrors + C.hudMirror).toFixed(0)}\n` +
            `draw calls ${info.calls}   tris ${(info.triangles / 1000).toFixed(0)}k\n` +
            (this.lastBench ? `F4 ${this.lastBench.split('\n')[1]}\n` : 'F4: 30 s benchmark\n') +
            `reflections ${this.env.p.wet > 0 && QUALITY[this.settings.quality].reflect > 0 ? 'mirror ' + Math.round(QUALITY[this.settings.quality].reflect * 100) + '%' : 'off'}  AO ${QUALITY[this.settings.quality].ao ? 'on' : 'off'}  blur ${QUALITY[this.settings.quality].motionBlur ? 'on' : 'off'}\n` +
            `physics ${this.stepsLast} step/frame @ ${Math.round(1 / PHYSICS_DT)} Hz\n` +
            `rpm ${s.rpm.toFixed(0)}  slip ${((s.sideSlip * 180) / Math.PI).toFixed(0)}°  ${s.airborne ? 'AIR' : s.onGrass > 0.5 ? 'grass' : 'tarmac'}\n` +
            `pad ${pad ? (pad.mapping || 'raw') + (this.haptics.supported ? ' + rumble' : '') : 'none'}\n` +
            `rumble L ${bar(this.haptics.lastStrong)}\n` +
            `rumble H ${bar(this.haptics.lastWeak)}`,
        );
      } else this.hud.setDebug(null);
    }
  }
}

/** Floating label for a rival: number plate in the car's colour, then the driver's name. */
function makeNameTag(num: number, name: string, color: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(10,11,14,0.78)';
  g.fillRect(0, 14, 512, 100);
  const col = new THREE.Color(color);
  g.fillStyle = `#${col.getHexString()}`;
  g.fillRect(0, 14, 136, 100);
  const lum = 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;
  g.fillStyle = lum > 0.35 ? '#0a0b0e' : '#f4f1ea';
  g.font = 'italic 800 76px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(num), 68, 68);
  g.fillStyle = '#f4f1ea';
  g.textAlign = 'left';
  g.font = 'italic 700 62px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  g.fillText(name.toUpperCase(), 158, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  sprite.renderOrder = 20;
  sprite.visible = false;
  return sprite;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function classifyName(id: string): DeviceKind {
  if (/054c|dualshock|dualsense|playstation|wireless controller/i.test(id)) return 'playstation';
  if (/xbox|xinput|045e/i.test(id)) return 'xbox';
  return 'generic';
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function boot(): Promise<void> {
  // 4.5: the car pack's cars go into the catalogue before anything reads the player's loadout
  registerImportedCars();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  // show the loading art and a first progress tick before the heavy world build starts
  document.getElementById('loading-art')!.style.backgroundImage = `url("${artUrl(Math.random() < 0.5 ? 'load-1' : 'load-2')}")`;
  const bar = document.getElementById('loading-bar') as HTMLElement;
  const pctEl = document.getElementById('loading-pct')!;
  const status = document.getElementById('loading-status')!;
  const progress = async (f: number, label: string) => {
    bar.style.width = `${Math.round(f * 100)}%`;
    pctEl.textContent = `${Math.round(f * 100)}%`;
    status.textContent = label;
    await nextFrame();
  };
  if ((window as unknown as { __APEX_CARS__?: unknown[] }).__APEX_CARS__?.length) {
    await progress(0.04, 'Loading your cars');
    await loadImportedCars((name) => (status.textContent = `Loading ${name}`));
  }
  await progress(0.08, 'Building the proving grounds');
  await nextFrame();
  let game: Game;
  try {
    game = new Game(canvas);
    (window as unknown as { __apex: Game }).__apex = game; // handy for debugging from the console
    (window as unknown as { __apexMakeCar: typeof makeCarVisual }).__apexMakeCar = makeCarVisual;
  } catch (err) {
    document.getElementById('boot-error')!.hidden = false;
    document.getElementById('boot-msg')!.textContent =
      'This browser could not create a WebGL 2 view. Try a current version of Chrome, Edge, Firefox or Safari with hardware acceleration switched on.';
    console.error(err);
    return;
  }
  await game.boot(progress);
}
void V;
void boot();
