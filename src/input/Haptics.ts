// ─────────────────────────────────────────────────────────────────────────────
// Haptics — controller rumble mixer.
//
// The DualShock 4 has two motors: a heavy low-frequency one ("strong") and a light
// high-frequency one ("weak"). Every ~45 ms we send one short dual-rumble frame whose two
// magnitudes are the sum of everything the car is feeling right now:
//
//   strong  ← engine load, collisions, landings, bottoming out, the gear-change thump
//   weak    ← tyre slip and drifting, grass / kerb roughness, nitrous, high-speed buzz
//
// Uses gamepad.vibrationActuator.playEffect('dual-rumble') (Chrome, Edge, Safari, recent
// Firefox), with trigger rumble on pads that have it (Xbox) and a hapticActuators.pulse()
// fallback. If nothing is available it silently does nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { HAPTICS as H, VEHICLE as V } from '../config';
import { clamp01, smoothstep } from '../core/math';
import { VehicleState } from '../vehicle/VehiclePhysics';

interface Pulse {
  strong: number;
  weak: number;
  life: number; // seconds remaining
  total: number;
}

type AnyActuator = {
  playEffect?: (type: string, params: Record<string, number>) => Promise<unknown>;
  reset?: () => Promise<unknown>;
  effects?: string[];
  pulse?: (value: number, duration: number) => Promise<unknown>;
};

export class Haptics {
  enabled = true;
  intensity = 1; // 0..1 user setting
  /** what the last frame sent, for the on-screen rumble meter */
  lastStrong = 0;
  lastWeak = 0;
  supported = false;
  private pulses: Pulse[] = [];
  private acc = 0;
  private wasIdle = true;

  /** Queue a one-shot kick that decays over `duration` seconds. */
  pulse(strong: number, weak: number, duration: number): void {
    if (this.pulses.length > 12) this.pulses.shift();
    this.pulses.push({ strong, weak, life: duration, total: duration });
  }

  private actuator(pad: Gamepad | null): AnyActuator | null {
    if (!pad) return null;
    const p = pad as unknown as { vibrationActuator?: AnyActuator; hapticActuators?: AnyActuator[] };
    if (p.vibrationActuator && p.vibrationActuator.playEffect) return p.vibrationActuator;
    if (p.hapticActuators && p.hapticActuators.length && p.hapticActuators[0].pulse) return p.hapticActuators[0];
    return null;
  }

  stop(pad: Gamepad | null): void {
    const a = this.actuator(pad);
    this.pulses.length = 0;
    this.lastStrong = this.lastWeak = 0;
    try {
      a?.reset?.()?.catch(() => {});
    } catch {
      /* not supported */
    }
  }

  /**
   * Mix and send a rumble frame. `car` may be null (menus): only queued pulses play.
   * `dt` is the real frame time.
   */
  update(pad: Gamepad | null, car: VehicleState | null, dt: number): void {
    // decay one-shots
    let pStrong = 0;
    let pWeak = 0;
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      const k = p.life / p.total;
      pStrong = Math.max(pStrong, p.strong * k);
      pWeak = Math.max(pWeak, p.weak * k);
      p.life -= dt;
      if (p.life <= 0) this.pulses.splice(i, 1);
    }

    let strong = pStrong;
    let weak = pWeak;
    let trigL = 0;
    let trigR = 0;
    if (car) {
      const rpmN = clamp01((car.rpm - V.idleRpm) / (V.redlineRpm - V.idleRpm));
      // Engine: a faint idle throb that grows with revs and load
      strong += H.engineIdle + H.engineGain * rpmN * (0.35 + 0.65 * car.throttle);
      // Rev limiter flutter
      if (car.rpm > V.redlineRpm - 250 && car.throttle > 0.5) weak += 0.25 * (Math.sin(performance.now() * 0.09) > 0 ? 1 : 0);
      // Tyres: rear slip is the drift feel, front slip is understeer scrub
      const rear = Math.max(car.wheelSlip[2], car.wheelSlip[3]);
      const front = Math.max(car.wheelSlip[0], car.wheelSlip[1]);
      weak += H.slipGain * (rear * 0.75 + front * 0.45) * smoothstep(2, 12, car.speed);
      strong += 0.18 * rear * smoothstep(8, 30, car.speed);
      // Surface roughness
      const moving = smoothstep(1, 14, car.speed);
      weak += H.roughGrass * car.onGrass * moving;
      strong += H.roughGrass * 0.5 * car.onGrass * moving;
      if (car.onKerb > 0) {
        // kerbs are serrated: pulse at a rate set by road speed
        const saw = Math.sin(performance.now() * 0.001 * Math.min(60, 8 + car.speed) * Math.PI * 2) > 0 ? 1 : 0.2;
        weak += H.roughKerb * car.onKerb * saw * moving;
        strong += 0.3 * car.onKerb * saw * moving;
      }
      // Nitrous: a hard kick (queued by the game on ignition) then a sustained fizz
      if (car.nitroActive) {
        weak += H.nitroGain * 0.75;
        strong += H.nitroGain * 0.35;
      }
      // High-speed buzz
      weak += 0.22 * smoothstep(H.speedBuzzFrom, H.speedBuzzFrom + 35, car.speed);
      // Airborne: everything goes quiet, which makes the landing thump land harder
      if (car.airborne) {
        strong *= 0.15;
        weak *= 0.15;
      }
      // Trigger rumble (Xbox impulse triggers): ABS chatter on the brake, wheelspin on the throttle
      trigL = car.brake > 0.6 && car.speed > 8 ? 0.35 : 0;
      trigR = car.wheelSpinSlip * 0.6;
    }

    strong = clamp01(strong * this.intensity);
    weak = clamp01(weak * this.intensity);
    this.lastStrong = this.enabled ? strong : 0;
    this.lastWeak = this.enabled ? weak : 0;

    this.acc += dt * 1000;
    if (this.acc < H.tickMs) return;
    this.acc = 0;
    const a = this.actuator(pad);
    this.supported = !!a;
    if (!a) return;
    const idle = !this.enabled || (strong < 0.012 && weak < 0.012);
    if (idle) {
      if (!this.wasIdle) {
        try {
          a.reset?.()?.catch(() => {});
        } catch {
          /* ignore */
        }
      }
      this.wasIdle = true;
      return;
    }
    this.wasIdle = false;
    try {
      if (a.playEffect) {
        const dur = H.tickMs * 2.2; // overlap frames so there are no gaps
        const hasTriggers = a.effects?.includes('trigger-rumble');
        if (hasTriggers && (trigL > 0 || trigR > 0)) {
          a.playEffect('trigger-rumble', { startDelay: 0, duration: dur, weakMagnitude: weak, strongMagnitude: strong, leftTrigger: trigL * this.intensity, rightTrigger: trigR * this.intensity })?.catch(() => {});
        } else {
          a.playEffect('dual-rumble', { startDelay: 0, duration: dur, weakMagnitude: weak, strongMagnitude: strong })?.catch(() => {});
        }
      } else if (a.pulse) {
        a.pulse(Math.max(strong, weak), H.tickMs * 2)?.catch(() => {});
      }
    } catch {
      /* some browsers throw if the pad vanished mid-frame */
    }
  }
}
