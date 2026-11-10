import { config as defaultConfig } from '../shared/config';
import type { GameConfig } from '../shared/config';
import { sampleAt, wrapS } from '../track/query';
import type { Track } from '../track/types';
import { gripAccel, maxSteerRad } from './car';
import type { DriverCommand, DriverInput, SimState } from './types';

// Piloto de referencia determinista (design D6): sigue la línea central con persecución pura
// y un perfil de velocidad limitado por agarre lateral y frenada.

// Velocidad objetivo (m/s) por muestra.
export function buildSpeedProfile(track: Track, cfg: GameConfig): Float64Array {
  const n = track.n;
  const a = cfg.autopilot;
  const mu = cfg.car.mu, g = cfg.sim.g;
  const kAero = mu * a.latGripUse * cfg.aero.clA * cfg.sim.rho / (2 * cfg.car.massKg);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // v²·|k| = u·μ·(g + ½ρ·ClA·v²/m)  ⇒  v² = μ·g·u / (|k| − μ·u·ClA·ρ/(2m))
    const den = Math.abs(track.k[i]) - kAero;
    v[i] = den <= 0 ? a.maxSpeedMs : Math.min(a.maxSpeedMs, Math.sqrt(mu * g * a.latGripUse / den));
  }
  // Dos pasadas hacia atrás limitando por frenada
  for (let pass = 0; pass < 2; pass++) {
    for (let j = n - 1; j >= 0; j--) {
      const next = j + 1 < n ? j + 1 : (track.closed ? 0 : -1);
      if (next < 0) continue;
      const ds = next === 0 && j === n - 1 ? track.length - track.s[j] : track.s[next] - track.s[j];
      const vn = v[next];
      const dec = a.brakeGripUse * cfg.car.brakeGripFactor * gripAccel(vn, 1, cfg);
      const vMax = Math.sqrt(vn * vn + 2 * dec * ds);
      if (v[j] > vMax) v[j] = vMax;
    }
  }
  return v;
}

export class Autopilot {
  private readonly track: Track;
  private readonly cfg: GameConfig;
  private readonly profile: Float64Array;

  constructor(track: Track, cfg: GameConfig = defaultConfig) {
    this.track = track;
    this.cfg = cfg;
    this.profile = buildSpeedProfile(track, cfg);
  }

  // Velocidad objetivo interpolada en s.
  private targetSpeed(s: number): number {
    const t = this.track;
    const w = wrapS(t, s);
    const pos = w / t.step;
    const i = Math.min(Math.floor(pos), t.n - 1);
    const j = i + 1 < t.n ? i + 1 : (t.closed ? 0 : i);
    const u = Math.min(Math.max(pos - i, 0), 1);
    return this.profile[i] + (this.profile[j] - this.profile[i]) * u;
  }

  update(state: SimState): { input: DriverInput; commands: DriverCommand[] } {
    const car = state.car;
    const a = this.cfg.autopilot;
    const v = car.speed;

    // Dirección: persecución pura hacia la línea central
    const ld = a.lookaheadBaseM + a.lookaheadPerMs * v;
    const p = sampleAt(this.track, car.s + ld);
    const dx = p.x - car.x, dz = p.z - car.z;
    const fx = Math.cos(car.yaw), fz = -Math.sin(car.yaw);
    const lx = -Math.sin(car.yaw), lz = -Math.cos(car.yaw);
    const ahead = dx * fx + dz * fz;
    const left = dx * lx + dz * lz;
    const dist2 = ahead * ahead + left * left;
    const delta = Math.atan(2 * this.cfg.car.wheelbaseM * left / Math.max(dist2, 1e-6));   // > 0 ⇒ izquierda
    const steer = Math.max(-1, Math.min(1, -delta / maxSteerRad(v, this.cfg)));

    // Pedales: control proporcional sobre la velocidad objetivo adelantada
    const err = this.targetSpeed(car.s + v * a.speedPreviewS) - v;
    const throttle = err >= 0 ? Math.min(1, err * a.throttleGain) : 0;
    const brake = err < 0 ? Math.min(1, -err * a.brakeGain) : 0;

    return { input: { steer, throttle, brake, ers: false }, commands: [] };
  }
}
