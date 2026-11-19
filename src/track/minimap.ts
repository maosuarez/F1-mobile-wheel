import type { config } from '../shared/config';
import { wrapS } from './query';
import type { Track } from './types';

// Recorte local de pista para el minimapa (b8, design D2). Puro: sin DOM ni three.

export type MinimapConfig = typeof config.minimap;

export interface MinimapPath {
  n: number;            // puntos válidos
  iCar: number;         // índice del punto en s del coche (separa "recorrido" de "por delante")
  xy: Float32Array;     // pares (x derecha, y adelante) en metros, sistema del coche
  strong: Uint8Array;   // 1 si |k| >= cornerK
}

function counts(cfg: MinimapConfig): { back: number; ahead: number } {
  return { back: Math.floor(cfg.behindM / cfg.stepM), ahead: Math.floor(cfg.aheadM / cfg.stepM) };
}

// Buffers de tamaño fijo para todo el recorte.
export function createMinimapPath(cfg: MinimapConfig): MinimapPath {
  const { back, ahead } = counts(cfg);
  const cap = back + ahead + 1;
  return { n: 0, iCar: 0, xy: new Float32Array(cap * 2), strong: new Uint8Array(cap) };
}

// Rellena out con los puntos s + j·stepM proyectados en el sistema del coche, sin asignar memoria.
// Interpola x, z y k como sampleAt (query.ts) pero sin crear objetos.
export function buildMinimapPath(
  t: Track,
  car: { x: number; z: number; yaw: number; s: number },
  cfg: MinimapConfig,
  out: MinimapPath,
): void {
  const back = Math.floor(cfg.behindM / cfg.stepM);
  const ahead = Math.floor(cfg.aheadM / cfg.stepM);
  const c = Math.cos(car.yaw), sn = Math.sin(car.yaw);
  const n = t.n, L = t.length;
  let m = 0;
  out.iCar = 0;
  for (let j = -back; j <= ahead; j++) {
    const sj = car.s + j * cfg.stepM;
    if (!t.closed && (sj < 0 || sj > L)) continue;
    if (j === 0) out.iCar = m;
    const w = wrapS(t, sj);
    // Segmento a→b con s[a] ≤ w < s[b]
    let a = Math.min(Math.max(Math.floor(w / t.step), 0), n - 1);
    while (a > 0 && t.s[a] > w) a--;
    while (a < n - 1 && t.s[a + 1] <= w) a++;
    let b: number;
    if (a + 1 < n) b = a + 1;
    else if (t.closed) b = 0;
    else { b = a; a = a - 1; }
    const sA = t.s[a], sB = b === 0 && a === n - 1 ? L : t.s[b];
    const u = sB > sA ? Math.min(Math.max((w - sA) / (sB - sA), 0), 1) : 0;
    const px = t.x[a] + (t.x[b] - t.x[a]) * u;
    const pz = t.z[a] + (t.z[b] - t.z[a]) * u;
    const k = t.k[a] + (t.k[b] - t.k[a]) * u;
    const dx = px - car.x, dz = pz - car.z;
    // Adelante = (cos yaw, −sin yaw); izquierda = (−sin yaw, −cos yaw); x = −izquierda
    out.xy[2 * m] = dx * sn + dz * c;
    out.xy[2 * m + 1] = dx * c - dz * sn;
    out.strong[m] = Math.abs(k) >= cfg.cornerK ? 1 : 0;
    m++;
  }
  out.n = m;
}
