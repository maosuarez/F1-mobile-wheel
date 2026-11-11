import { config, type GameConfig } from '../shared/config';

// Parámetros puros del audio del motor (design D2). Sin Web Audio: testeable en Node.

export interface EngineAudioInput { rpm: number; throttle: number; speedMs: number; limiter: boolean }
export interface EngineAudioParams {
  f0Hz: number; sawGain: number; squareGain: number; cutoffHz: number; engineGain: number;
  turboGain: number; turboHz: number; windGain: number; windCutoffHz: number;
}

type AudioCfg = GameConfig['audio'];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Ataque de la caída de cambio (evita el chasquido de un salto instantáneo). */
export const SHIFT_ATTACK_S = 0.004;

/** RPM normalizadas 0..1 entre ralentí y limitador (rango de config.gears). */
export function rpmNorm(rpm: number): number {
  const { idleRpm, limiterRpm } = config.gears;
  return clamp01((rpm - idleRpm) / (limiterRpm - idleRpm));
}

export function engineParams(i: EngineAudioInput, a: AudioCfg): EngineAudioParams {
  const thr = clamp01(i.throttle);
  const rn = rpmNorm(i.rpm);
  const f0Hz = (Math.max(0, i.rpm) / 60) * a.cylindersFactor;
  // Más acelerador ⇒ más brillo; las RPM abren algo más el filtro.
  const cutoffHz = lerp(a.cutoffMinHz, a.cutoffMaxHz, thr) * (1 + a.rpmCutoffBoost * rn);
  // En vacío algo más de cuadrada (más áspero).
  const squareGain = a.squareMix * (1 + 0.5 * (1 - thr));
  const sawGain = 1 - a.squareMix;
  const engineGain = Math.min(1, lerp(a.idleGain, a.fullGain, thr));
  const turboGain = a.turboGain * thr * (0.3 + 0.7 * rn);
  const turboHz = 1800 + 4200 * rn;
  const w = clamp01(Math.max(0, i.speedMs) / a.windRefMs);
  const windGain = a.windGain * w * w;
  const windCutoffHz = 300 + 2200 * w;
  return { f0Hz, sawGain, squareGain, cutoffHz, engineGain, turboGain, turboHz, windGain, windCutoffHz };
}

/** Modulación de volumen del limitador (1 − depth .. 1) a `limiterHz`. */
export function limiterGainAt(tS: number, a: AudioCfg): number {
  return 1 - a.limiterDepth * (0.5 + 0.5 * Math.sin(2 * Math.PI * a.limiterHz * tS));
}

/** Multiplicador de ganancia tras un cambio: ataque corto, meseta en `shiftDipGain`, rampa de vuelta en `paramTauS`. */
export function shiftEnvelope(tSinceShiftS: number, a: AudioCfg): number {
  const t = tSinceShiftS;
  if (t < 0) return 1;
  if (t < SHIFT_ATTACK_S) return lerp(1, a.shiftDipGain, t / SHIFT_ATTACK_S);
  if (t < a.shiftDipS) return a.shiftDipGain;
  if (t < a.shiftDipS + a.paramTauS) return lerp(a.shiftDipGain, 1, (t - a.shiftDipS) / a.paramTauS);
  return 1;
}
