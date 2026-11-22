import type { GameConfig } from '../shared/config';

// Detector de sacudidas para DRS/ERS (b20 design D2, b21 D1). Lógica pura, sin DOM.

type ShakeCfg = GameConfig['wheel']['shake'];

const GRAVITY_ALPHA = 0.1;                                      // filtro paso bajo de la gravedad estimada en Z

export class ShakeDetector {
  private firstPeakMs: number | null = null;                   // inicio de la secuencia de picos en curso
  private lastSign = 0;
  private count = 0;
  private cooldownUntil = -Infinity;
  private gravZ: number | null = null;

  constructor(private readonly cfg: ShakeCfg) {}

  // Solo eje Z, perpendicular a la pantalla (b21 design D1). az: `acceleration.z` (m/s²).
  // Si se pasa gz (`accelerationIncludingGravity.z`), az se ignora y se resta la gravedad de Z
  // estimada con paso bajo (α = 0,1).
  update(az: number, tMs: number, gz?: number): { shake: boolean } {
    if (gz !== undefined) {
      if (this.gravZ === null) this.gravZ = gz;
      this.gravZ += GRAVITY_ALPHA * (gz - this.gravZ);
      az = gz - this.gravZ;
    }
    let shake = false;
    if (tMs >= this.cooldownUntil) {
      // Ventana vencida: la secuencia caduca (también el signo del último pico)
      if (this.firstPeakMs !== null && tMs - this.firstPeakMs > this.cfg.windowMs) {
        this.firstPeakMs = null; this.count = 0; this.lastSign = 0;
      }
      const sign = Math.sign(az);
      if (Math.abs(az) > this.cfg.peakMs2 && sign !== this.lastSign) {
        if (this.firstPeakMs === null) { this.firstPeakMs = tMs; this.count = 1; } // nueva secuencia
        else this.count++;
        this.lastSign = sign;
        if (this.count >= this.cfg.peaks) {
          shake = true;
          this.cooldownUntil = tMs + this.cfg.cooldownMs;
          this.firstPeakMs = null; this.count = 0; this.lastSign = 0;
        }
      }
    }
    return { shake };
  }
}

// Acción de una sacudida: solo en recta; DRS si está disponible, si no alterna ERS.
export function shakeAction(drs: 0 | 1 | 2, steer: number, ersOn: boolean, cfg: ShakeCfg): 'drs' | 'ersOn' | 'ersOff' | null {
  if (Math.abs(steer) >= cfg.straightSteer) return null;
  if (drs === 1) return 'drs';
  return ersOn ? 'ersOff' : 'ersOn';
}
