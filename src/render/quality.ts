import { config, type GameConfig } from '../shared/config';

// Niveles de calidad y adaptación automática (design D1). Lógica pura, sin Three.js.
// 'software' solo se elige con GL por software (SwiftShader, llvmpipe) o con ?quality=software
export type QualityLevel = 'high' | 'medium' | 'low' | 'software';

export interface QualitySettings {
  dpr: number; shadows: boolean; shadowMapSize: number; post: boolean; msaaSamples: number;
  trees: number; particles: number; envMapSize: number;
  trackMaps: boolean; // map y roughnessMap en los materiales de la pista
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  high:   { dpr: 1.5,  shadows: true,  shadowMapSize: 2048, post: true,  msaaSamples: 4, trees: 600, particles: 400, envMapSize: 256, trackMaps: true },
  medium: { dpr: 1.25, shadows: true,  shadowMapSize: 1024, post: false, msaaSamples: 0, trees: 400, particles: 250, envMapSize: 128, trackMaps: true },
  low:    { dpr: 1.0,  shadows: false, shadowMapSize: 0,    post: false, msaaSamples: 0, trees: 300, particles: 120, envMapSize: 64,  trackMaps: true },
  software: { dpr: 1.0, shadows: false, shadowMapSize: 0,  post: false, msaaSamples: 0, trees: 300, particles: 120, envMapSize: 0,   trackMaps: false },
};

const ORDER: QualityLevel[] = ['high', 'medium', 'low'];

export function isQualityLevel(v: unknown): v is QualityLevel {
  return v === 'high' || v === 'medium' || v === 'low' || v === 'software';
}

// GL por software según el nombre del renderizador (sin distinguir mayúsculas)
export function isSoftwareGl(rendererName: string, q: GameConfig['quality'] = config.quality): boolean {
  const n = rendererName.toLowerCase();
  return q.softwareGl.some((k) => n.includes(k.toLowerCase()));
}

// Nivel inicial: ?quality= manda y bloquea; con GL por software, 'software' bloqueado; si no, high adaptativo
export function initialQuality(param: string | null, rendererName: string, q: GameConfig['quality'] = config.quality): { level: QualityLevel; locked: boolean } {
  if (isQualityLevel(param)) return { level: param, locked: true };
  if (isSoftwareGl(rendererName, q)) return { level: 'software', locked: true };
  return { level: 'high', locked: false };
}

// Baja un nivel cuando la media de fps de una ventana de windowS segundos activos queda por debajo de downFps.
// Nunca sube. Los fotogramas inactivos (pausa, pestaña oculta) no cuentan ni rompen la ventana.
export class AdaptiveQuality {
  level: QualityLevel;
  private accT = 0;
  private accFrames = 0;

  constructor(private readonly q: GameConfig['quality'], initial: QualityLevel, private readonly locked: boolean) {
    this.level = initial;
  }

  // Devuelve el nuevo nivel si cambia; null en otro caso
  sample(frameDtS: number, active: boolean): QualityLevel | null {
    if (this.locked || !active || !(frameDtS > 0) || !ORDER.includes(this.level) || this.level === 'low') return null;
    this.accT += frameDtS;
    this.accFrames++;
    if (this.accT < this.q.windowS) return null;
    const avg = this.accFrames / this.accT;
    this.accT = 0;
    this.accFrames = 0;
    if (avg >= this.q.downFps) return null;
    this.level = ORDER[ORDER.indexOf(this.level) + 1];
    return this.level;
  }
}

// Medidor de fps sobre los últimos `capacity` fotogramas: media (fotogramas / tiempo) y percentil 5 de fps instantáneos
export class FpsMeter {
  private readonly dts: Float64Array;
  private n = 0;
  private head = 0;

  constructor(capacity = config.quality.meterFrames) { this.dts = new Float64Array(Math.max(1, capacity)); }

  push(frameDtS: number): void {
    if (!(frameDtS > 0)) return;
    this.dts[this.head] = frameDtS;
    this.head = (this.head + 1) % this.dts.length;
    if (this.n < this.dts.length) this.n++;
  }

  avg(): number {
    if (this.n === 0) return 0;
    let t = 0;
    for (let i = 0; i < this.n; i++) t += this.dts[i];
    return this.n / t;
  }

  // Rango más cercano: el 5 % de los fotogramas va igual o más lento que este valor
  p5(): number {
    if (this.n === 0) return 0;
    const fps = Array.from(this.dts.subarray(0, this.n), (dt) => 1 / dt).sort((a, b) => a - b);
    return fps[Math.max(0, Math.ceil(0.05 * this.n) - 1)];
  }

  reset(): void { this.n = 0; this.head = 0; }
}
