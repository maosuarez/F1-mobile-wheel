import type { GameConfig } from '../shared/config';

// Detector de sacudidas para DRS/ERS (b20 design D2). Lógica pura, sin DOM.

type ShakeCfg = GameConfig['wheel']['shake'];

const GRAVITY_ALPHA = 0.1;                                      // filtro paso bajo de la gravedad estimada

export class ShakeDetector {
  private firstPeakMs: number | null = null;                   // inicio de la secuencia de picos en curso
  private lastPeakMs: number | null = null;                    // último pico contado (para `active`)
  private lastSign = 0;
  private count = 0;
  private cooldownUntil = -Infinity;
  private grav: [number, number, number] | null = null;

  constructor(private readonly cfg: ShakeCfg) {}

  // ax/ay/az: aceleración lineal (m/s²). Con withGravity = true son `accelerationIncludingGravity`
  // y se resta una gravedad estimada con paso bajo (α = 0,1).
  update(ax: number, ay: number, az: number, tMs: number, withGravity = false): { shake: boolean; active: boolean } {
    if (withGravity) {
      if (this.grav === null) this.grav = [ax, ay, az];
      const g = this.grav;
      g[0] += GRAVITY_ALPHA * (ax - g[0]);
      g[1] += GRAVITY_ALPHA * (ay - g[1]);
      g[2] += GRAVITY_ALPHA * (az - g[2]);
      ax -= g[0]; ay -= g[1]; az -= g[2];
    }
    let shake = false;
    if (tMs >= this.cooldownUntil) {
      // Ventana vencida: la secuencia caduca (también el signo del último pico)
      if (this.firstPeakMs !== null && tMs - this.firstPeakMs > this.cfg.windowMs) {
        this.firstPeakMs = null; this.count = 0; this.lastSign = 0;
      }
      // Eje de mayor módulo de la muestra
      let a = ax;
      if (Math.abs(ay) > Math.abs(a)) a = ay;
      if (Math.abs(az) > Math.abs(a)) a = az;
      const sign = Math.sign(a);
      if (Math.abs(a) > this.cfg.peakMs2 && sign !== this.lastSign) {
        if (this.firstPeakMs === null) { this.firstPeakMs = tMs; this.count = 1; } // nueva secuencia
        else this.count++;
        this.lastSign = sign;
        this.lastPeakMs = tMs;
        if (this.count >= this.cfg.peaks) {
          shake = true;
          this.cooldownUntil = tMs + this.cfg.cooldownMs;
          this.firstPeakMs = null; this.count = 0; this.lastSign = 0;
        }
      }
    }
    const active = this.lastPeakMs !== null && tMs - this.lastPeakMs <= this.cfg.freezeMs;
    return { shake, active };
  }
}

// Acción de una sacudida: solo en recta; DRS si está disponible, si no alterna ERS.
export function shakeAction(drs: 0 | 1 | 2, steer: number, ersOn: boolean, cfg: ShakeCfg): 'drs' | 'ersOn' | 'ersOff' | null {
  if (Math.abs(steer) >= cfg.straightSteer) return null;
  if (drs === 1) return 'drs';
  return ersOn ? 'ersOff' : 'ersOn';
}
