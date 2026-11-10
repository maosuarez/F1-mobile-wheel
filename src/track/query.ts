import { KERB_WIDTH_M } from './types';
import type { Surface, Track, TrackLocation, TrackSide } from './types';

// Consultas puras sobre la pista (sin three ni DOM).

const WINDOW = 20;            // ventana de búsqueda local en índices
const GLOBAL_FALLBACK_M = 60; // distancia mínima a partir de la cual se busca en toda la pista

// Normaliza s a [0, length) en pistas cerradas; en abiertas recorta a [0, length].
export function wrapS(t: Track, s: number): number {
  if (!t.closed) return Math.min(Math.max(s, 0), t.length);
  const L = t.length;
  const r = s % L;
  return r < 0 ? r + L : r;
}

// Diferencia con signo de from a to por el camino más corto.
export function deltaS(t: Track, from: number, to: number): number {
  if (!t.closed) return to - from;
  const L = t.length;
  let d = wrapS(t, to - from);
  if (d > L / 2) d -= L;
  return d;
}

// Pertenencia a [s0, s1); si s0 > s1 el tramo cruza s = 0.
export function inRangeS(t: Track, s: number, s0: number, s1: number): boolean {
  const w = wrapS(t, s);
  if (s0 <= s1) return w >= s0 && w < s1;
  return w >= s0 || w < s1;
}

function dist2(t: Track, i: number, x: number, z: number): number {
  const dx = x - t.x[i], dz = z - t.z[i];
  return dx * dx + dz * dz;
}

// Vecino siguiente/anterior con envoltura (−1 si no existe en pista abierta).
function nextIdx(t: Track, i: number): number {
  if (i + 1 < t.n) return i + 1;
  return t.closed ? 0 : -1;
}
function prevIdx(t: Track, i: number): number {
  if (i > 0) return i - 1;
  return t.closed ? t.n - 1 : -1;
}

// s del extremo b de un segmento a→b (b = 0 al cerrar la vuelta equivale a length).
function segEndS(t: Track, a: number, b: number): number {
  return b === 0 && a === t.n - 1 ? t.length : t.s[b];
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

function classify(t: Track, i: number, d: number, wl: number, wr: number): { surface: Surface; kerbSide: TrackSide | null } {
  if (d >= -wr && d <= wl) return { surface: 'asphalt', kerbSide: null };
  if (d > wl) {
    if (d <= wl + KERB_WIDTH_M && t.kerbL[i]) return { surface: 'kerb', kerbSide: 'left' };
    return { surface: 'grass', kerbSide: null };
  }
  if (d >= -(wr + KERB_WIDTH_M) && t.kerbR[i]) return { surface: 'kerb', kerbSide: 'right' };
  return { surface: 'grass', kerbSide: null };
}

// Proyecta (x, z) sobre el segmento contiguo a la muestra más cercana i e interpola.
function project(t: Track, i: number, x: number, z: number): TrackLocation {
  let a = i, b = nextIdx(t, i), u = 0;
  if (b >= 0) {
    const ex = t.x[b] - t.x[a], ez = t.z[b] - t.z[a];
    const e2 = ex * ex + ez * ez;
    u = e2 > 0 ? ((x - t.x[a]) * ex + (z - t.z[a]) * ez) / e2 : 0;
  }
  if (b < 0 || u < 0) {
    const p = prevIdx(t, i);
    if (p >= 0) {
      const ex = t.x[i] - t.x[p], ez = t.z[i] - t.z[p];
      const e2 = ex * ex + ez * ez;
      const up = e2 > 0 ? ((x - t.x[p]) * ex + (z - t.z[p]) * ez) / e2 : 1;
      a = p; b = i; u = up;
    } else {
      b = nextIdx(t, i); u = 0;
    }
  }
  u = Math.min(Math.max(u, 0), 1);

  const sA = t.s[a], sB = segEndS(t, a, b);
  const s = wrapS(t, lerp(sA, sB, u));
  const px = lerp(t.x[a], t.x[b], u), pz = lerp(t.z[a], t.z[b], u);
  let nx = lerp(t.nx[a], t.nx[b], u), nz = lerp(t.nz[a], t.nz[b], u);
  const nl = Math.hypot(nx, nz) || 1;
  nx /= nl; nz /= nl;
  const d = (x - px) * nx + (z - pz) * nz;
  const wl = lerp(t.wl[a], t.wl[b], u), wr = lerp(t.wr[a], t.wr[b], u);
  const tx = -nz, tz = nx;
  const { surface, kerbSide } = classify(t, i, d, wl, wr);
  return {
    i, s, d,
    y: lerp(t.y[a], t.y[b], u),
    pitch: lerp(t.pitch[a], t.pitch[b], u),
    bank: lerp(t.bank[a], t.bank[b], u),
    k: lerp(t.k[a], t.k[b], u),
    heading: Math.atan2(-tz, tx),
    wl, wr, surface, kerbSide,
    wallL: wl + t.runoff, wallR: wr + t.runoff,
  };
}

// Localización con búsqueda en ventana alrededor de hintIndex; recurre a la búsqueda global si está lejos.
export function locate(t: Track, x: number, z: number, hintIndex: number): TrackLocation {
  const n = t.n;
  let h = Math.round(hintIndex);
  if (!Number.isFinite(h)) h = 0;
  h = t.closed ? ((h % n) + n) % n : Math.min(Math.max(h, 0), n - 1);
  let best = -1, bestD2 = Infinity;
  for (let o = -WINDOW; o <= WINDOW; o++) {
    let j = h + o;
    if (t.closed) j = ((j % n) + n) % n;
    else if (j < 0 || j >= n) continue;
    const d2 = dist2(t, j, x, z);
    if (d2 < bestD2) { bestD2 = d2; best = j; }
  }
  if (bestD2 > GLOBAL_FALLBACK_M * GLOBAL_FALLBACK_M) return locateGlobal(t, x, z);
  return project(t, best, x, z);
}

// Localización por búsqueda exhaustiva de la muestra más cercana.
export function locateGlobal(t: Track, x: number, z: number): TrackLocation {
  let best = 0, bestD2 = Infinity;
  for (let j = 0; j < t.n; j++) {
    const d2 = dist2(t, j, x, z);
    if (d2 < bestD2) { bestD2 = d2; best = j; }
  }
  return project(t, best, x, z);
}

// Índice a de la muestra con s[a] ≤ s < s[b] y fracción u.
function segmentAt(t: Track, s: number): { a: number; b: number; u: number } {
  const w = wrapS(t, s);
  const n = t.n;
  let a = Math.min(Math.max(Math.floor(w / t.step), 0), n - 1);
  while (a > 0 && t.s[a] > w) a--;
  while (a < n - 1 && t.s[a + 1] <= w) a++;
  let b = nextIdx(t, a);
  if (b < 0) { b = a; a = a - 1; }   // final de pista abierta
  const sA = t.s[a], sB = segEndS(t, a, b);
  const u = sB > sA ? Math.min(Math.max((w - sA) / (sB - sA), 0), 1) : 0;
  return { a, b, u };
}

// Muestreo interpolado por s.
export function sampleAt(t: Track, s: number): { x: number; y: number; z: number; tx: number; tz: number; nx: number; nz: number; wl: number; wr: number; k: number; pitch: number; heading: number } {
  const { a, b, u } = segmentAt(t, s);
  let nx = lerp(t.nx[a], t.nx[b], u), nz = lerp(t.nz[a], t.nz[b], u);
  const nl = Math.hypot(nx, nz) || 1;
  nx /= nl; nz /= nl;
  const tx = -nz, tz = nx;
  return {
    x: lerp(t.x[a], t.x[b], u), y: lerp(t.y[a], t.y[b], u), z: lerp(t.z[a], t.z[b], u),
    tx, tz, nx, nz,
    wl: lerp(t.wl[a], t.wl[b], u), wr: lerp(t.wr[a], t.wr[b], u),
    k: lerp(t.k[a], t.k[b], u), pitch: lerp(t.pitch[a], t.pitch[b], u),
    heading: Math.atan2(-tz, tx),
  };
}

// Índice de la zona DRS que contiene s, o −1.
export function drsZoneAt(t: Track, s: number): number {
  for (let i = 0; i < t.drsZones.length; i++) {
    const z = t.drsZones[i];
    if (inRangeS(t, s, z.start_s, z.end_s)) return i;
  }
  return -1;
}

// Sector (0, 1, 2) de un s.
export function sectorAt(t: Track, s: number): 0 | 1 | 2 {
  const w = wrapS(t, s);
  if (w < t.sectorsS[0]) return 0;
  if (w < t.sectorsS[1]) return 1;
  return 2;
}

// Cruce de meta hacia delante: startS ∈ (sPrev, s] módulo length, con avance positivo y acotado.
export function crossedStart(t: Track, sPrev: number, s: number): boolean {
  const ds = deltaS(t, sPrev, s);
  if (ds <= 0 || Math.abs(ds) >= t.length / 4) return false;
  const a = t.closed ? wrapS(t, t.startS - sPrev) : t.startS - sPrev;
  return a > 0 && a <= ds;
}
