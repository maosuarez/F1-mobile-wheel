import type { GameConfig } from '../shared/config';

// Dirección por inclinación (design D5). Lógica pura, sin DOM.

type WheelCfg = GameConfig['wheel'];

const RAD2DEG = 180 / Math.PI;

const wrap180 = (deg: number) => {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  if (d === -180) d = 180;
  return d;
};

// Ángulo de la gravedad en el plano de la pantalla, corregido por la orientación. Horario = positivo.
export function tiltDeg(ax: number, ay: number, screenAngle: number): number {
  return wrap180(screenAngle - Math.atan2(ax, ay) * RAD2DEG);
}

// Filtro One Euro (Casiez et al.): suavizado adaptativo según la velocidad de la señal.
export class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(private readonly minCutoff: number, private readonly beta: number, private readonly dCutoff: number) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, tS: number): number {
    if (this.xPrev === null) {
      this.xPrev = x; this.dxPrev = 0; this.tPrev = tS;
      return x;
    }
    const dt = tS - this.tPrev;
    if (!(dt > 0)) return this.xPrev;                           // marca de tiempo repetida o hacia atrás
    this.tPrev = tS;
    const dx = (x - this.xPrev) / dt;
    const dxHat = this.dxPrev + OneEuroFilter.alpha(this.dCutoff, dt) * (dx - this.dxPrev);
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const xHat = this.xPrev + OneEuroFilter.alpha(cutoff, dt) * (x - this.xPrev);
    this.xPrev = xHat; this.dxPrev = dxHat;
    return xHat;
  }

  reset(): void { this.xPrev = null; this.dxPrev = 0; }
}

// Ángulo relativo (grados) -> steer [-1, 1]: zona muerta, recorrido, curva cúbica, recorte y signo.
export function shapeSteer(phiDeg: number, w: WheelCfg): number {
  const a = Math.abs(phiDeg);
  if (!(a > w.deadzoneDeg)) return 0;
  const x = Math.min(1, (a - w.deadzoneDeg) / (w.rangeDeg - w.deadzoneDeg));
  const k = w.curveK;
  const out = Math.min(1, (1 - k) * x + k * x * x * x);
  return Math.sign(phiDeg) * w.steerSign * out;
}

export class SteeringEstimator {
  private readonly filt: OneEuroFilter;
  private center: number | null = null;                        // θ0; null = calibrar con la próxima muestra válida
  private lastTheta: number | null = null;
  private lastSteer = 0;
  private lastPhi = 0;

  constructor(private readonly w: WheelCfg) {
    this.filt = new OneEuroFilter(w.oneEuro.minCutoff, w.oneEuro.beta, w.oneEuro.dCutoff);
  }

  update(ax: number, ay: number, screenAngle: number, tMs: number): { steer: number; flat: boolean; phiDeg: number } {
    // Celular casi plano: el ángulo no es fiable, se conserva el último valor
    if (!(Math.hypot(ax, ay) >= this.w.flatThreshold)) return { steer: this.lastSteer, flat: true, phiDeg: this.lastPhi };
    const theta = tiltDeg(ax, ay, screenAngle);
    this.lastTheta = theta;
    if (this.center === null) this.center = theta;
    const phi = this.filt.filter(wrap180(theta - this.center), tMs / 1000);
    this.lastPhi = phi;
    this.lastSteer = shapeSteer(phi, this.w);
    return { steer: this.lastSteer, flat: false, phiDeg: phi };
  }

  // Fija el centro en la posición actual (o en la próxima muestra válida si aún no hay ninguna)
  recenter(): void {
    this.center = this.lastTheta;
    this.filt.reset();
    this.lastSteer = 0; this.lastPhi = 0;
  }
}
