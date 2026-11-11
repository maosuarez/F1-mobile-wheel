import type { GameConfig } from '../../shared/config';
import type { CarState } from '../../sim/types';
import type { Track } from '../../track/types';
import { sampleAt, wrapS } from '../../track/query';

// Matemática pura de cámaras (design D3): sin three ni DOM.

type CameraCfg = GameConfig['camera'];
const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

// Resorte críticamente amortiguado x'' = ω²(g − x) − 2ω·x'. El objetivo se supone lineal entre
// la llamada anterior y la actual; la solución analítica es exacta ⇒ independiente de los fps.
export class CriticalSpring {
  x = 0;
  v = 0;
  private prevTarget = Number.NaN;

  constructor(readonly omega: number) {}

  step(target: number, dtS: number): number {
    if (!(dtS > 0)) return this.x;
    const w = this.omega;
    const g0 = Number.isNaN(this.prevTarget) ? target : this.prevTarget;
    const r = (target - g0) / dtS;                   // velocidad del objetivo en el paso
    // Solución particular para objetivo en rampa: x_p = g − 2r/ω, v_p = r.
    const y0 = this.x - (g0 - 2 * r / w), yv0 = this.v - r;
    const e = Math.exp(-w * dtS);
    const c = yv0 + w * y0;
    const y = (y0 + c * dtS) * e;
    const yv = (yv0 - w * c * dtS) * e;
    this.x = y + target - 2 * r / w;
    this.v = yv + r;
    this.prevTarget = target;
    return this.x;
  }

  snap(x: number): void {
    this.x = x;
    this.v = 0;
    this.prevTarget = x;
  }
}

// FOV vertical (grados) lineal entre fovMinDeg a 0 km/h y fovMaxDeg a fovRefKmh.
export function fovFor(speedKmh: number, c: CameraCfg): number {
  return c.fovMinDeg + (c.fovMaxDeg - c.fovMinDeg) * clamp(speedKmh / c.fovRefKmh, 0, 1);
}

// Amplitud del temblor (m): piano/hierba + vibración permanente por encima de highSpeedKmh.
export function shakeAmplitude(car: CarState, c: CameraCfg): number {
  const sh = c.shake;
  const kmh = car.speed * 3.6;
  const surf = car.surface === 'kerb' ? sh.kerbM : car.surface === 'grass' ? sh.grassM : 0;
  let a = surf * clamp(kmh / sh.surfaceRefKmh, 0, 1);
  if (kmh > sh.highSpeedKmh) {
    a += sh.highSpeedM * clamp((kmh - sh.highSpeedKmh) / (sh.highSpeedRefKmh - sh.highSpeedKmh), 0, 1);
  }
  return a;
}

// Desplazamiento [x, y] en el espacio de la cámara: suma normalizada de senos de `hz` (|x|, |y| ≤ amplitud).
const PHASE_X = [0, 1.3, 2.9], PHASE_Y = [0.7, 2.1, 4.4];
export function shakeOffset(amplitudeM: number, tS: number, c: CameraCfg): [number, number] {
  if (amplitudeM === 0) return [0, 0];
  const hz = c.shake.hz;
  let sx = 0, sy = 0;
  for (let i = 0; i < hz.length; i++) {
    const w = 2 * Math.PI * hz[i] * tS;
    sx += Math.sin(w + PHASE_X[i % 3]);
    sy += Math.sin(w * 1.07 + PHASE_Y[i % 3]);
  }
  const k = amplitudeM / hz.length;
  return [sx * k, sy * k];
}

export interface TvCamera { s: number; x: number; y: number; z: number }

// n = round(L / spacingM) cámaras; la i en s = (i + 1)·esp − leadM, wl + outsideM a la izquierda y heightM arriba.
export function buildTvCameras(track: Track, c: CameraCfg): TvCamera[] {
  const t = c.tv;
  const n = Math.max(1, Math.round(track.length / t.spacingM));
  const sp = track.length / n;
  const cams: TvCamera[] = [];
  for (let i = 0; i < n; i++) {
    const s = wrapS(track, (i + 1) * sp - t.leadM);
    const p = sampleAt(track, s);
    const off = p.wl + t.outsideM;
    cams.push({ s, x: p.x + off * p.nx, y: p.y + t.heightM, z: p.z + off * p.nz });
  }
  return cams;
}

// Cámara activa: floor((s + leadM) / espaciado real) mod n ⇒ cambia al superar el s de la activa.
// leadM se recupera de la primera cámara (s_0 = espaciado − leadM) para mantener la firma de D3.
export function activeTvCamera(cams: TvCamera[], track: Track, carS: number): number {
  const n = cams.length;
  const sp = track.length / n;
  const lead = sp - cams[0].s;
  const i = Math.floor((wrapS(track, carS) + lead) / sp);
  return ((i % n) + n) % n;
}

// FOV vertical que encuadra frameWidthM de ancho a distM con aspecto 16:9, recortado.
export function tvFovDeg(distM: number, c: CameraCfg): number {
  const t = c.tv;
  const d = Math.max(distM, 1e-3);
  const fov = 2 * Math.atan(t.frameWidthM / (2 * d * (16 / 9))) / DEG;
  return clamp(fov, t.minFovDeg, t.maxFovDeg);
}
