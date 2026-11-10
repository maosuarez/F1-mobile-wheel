import type { Kerb, Track, TrackJson, TrackSamplesJson } from './types';
import { buildTrack } from './track';

// Pistas sintéticas para tests, con el mismo formato en memoria que una pista real.

const STEP_M = 2;

function emptySamples(): TrackSamplesJson {
  return { s: [], x: [], y: [], z: [], wl: [], wr: [], nx: [], nz: [], k: [], pitch: [], bank: [] };
}

// Añade una muestra a partir de posición, rumbo (yaw) y curvatura.
function push(sm: TrackSamplesJson, s: number, x: number, y: number, z: number, yaw: number, k: number, pitch: number, hw: number): void {
  sm.s.push(s); sm.x.push(x); sm.y.push(y); sm.z.push(z);
  sm.wl.push(hw); sm.wr.push(hw);
  // Normal izquierda = (−sin yaw, −cos yaw)
  sm.nx.push(-Math.sin(yaw)); sm.nz.push(-Math.cos(yaw));
  sm.k.push(k); sm.pitch.push(pitch); sm.bank.push(0);
}

// Recta abierta hacia +X con pendiente constante (pitch en radianes, positivo = subida).
export function makeStraightTrack(o: { lengthM?: number; halfWidthM?: number; pitch?: number; runoffM?: number } = {}): Track {
  const length = o.lengthM ?? 5000;
  const hw = o.halfWidthM ?? 6;
  const pitch = o.pitch ?? 0;
  const runoff = o.runoffM ?? 18;
  const n = Math.max(2, Math.round(length / STEP_M)) + 1;
  const step = length / (n - 1);
  const grade = Math.tan(pitch);
  const sm = emptySamples();
  for (let i = 0; i < n; i++) {
    const s = i * step;
    push(sm, s, s, s * grade, 0, 0, 0, pitch, hw);
  }
  const json: TrackJson = {
    id: 'straight', name: 'Synthetic straight', length_m: length, direction: 'ccw', step_m: step,
    samples: sm, start_s: 0, sectors_s: [length / 3, (2 * length) / 3],
    drs_zones: [], corners: [], kerbs: [], runoff_m: runoff,
  };
  const t = buildTrack(json);
  t.closed = false;
  return t;
}

// Óvalo cerrado antihorario; s = 0 (meta) en la mitad de la recta inicial, que avanza hacia +X.
// Con kerbs, pianos en el interior (izquierda) de ambas curvas.
export function makeOvalTrack(o: { straightM?: number; radiusM?: number; halfWidthM?: number; kerbs?: boolean; runoffM?: number } = {}): Track {
  const S = o.straightM ?? 1000;
  const R = o.radiusM ?? 150;
  const hw = o.halfWidthM ?? 6;
  const runoff = o.runoffM ?? 18;
  const arc = Math.PI * R;
  const L = 2 * S + 2 * arc;
  const n = Math.round(L / STEP_M);
  const step = L / n;
  const half = S / 2;
  // Inicio de cada tramo en s
  const c1 = half, st2 = half + arc, c2 = half + arc + S, st1b = half + 2 * arc + S;

  const sm = emptySamples();
  for (let i = 0; i < n; i++) {
    const s = i * step;
    let x: number, z: number, yaw: number, k: number;
    if (s < c1) {                        // recta inferior (primera mitad), hacia +X
      x = s; z = 0; yaw = 0; k = 0;
    } else if (s < st2) {                // curva 1, centro (half, −R)
      const th = (s - c1) / R;
      x = half + R * Math.sin(th); z = -R + R * Math.cos(th); yaw = th; k = 1 / R;
    } else if (s < c2) {                 // recta superior, hacia −X
      const u = s - st2;
      x = half - u; z = -2 * R; yaw = Math.PI; k = 0;
    } else if (s < st1b) {               // curva 2, centro (−half, −R)
      const th = (s - c2) / R;
      x = -half - R * Math.sin(th); z = -R - R * Math.cos(th); yaw = Math.PI + th; k = 1 / R;
    } else {                             // recta inferior (segunda mitad)
      const u = s - st1b;
      x = -half + u; z = 0; yaw = 0; k = 0;
    }
    push(sm, s, x, 0, z, yaw, k, 0, hw);
  }
  const kerbs: Kerb[] = o.kerbs ? [
    { s0: c1, s1: st2, side: 'left' },
    { s0: c2, s1: st1b, side: 'left' },
  ] : [];
  const json: TrackJson = {
    id: 'oval', name: 'Synthetic oval', length_m: L, direction: 'ccw', step_m: step,
    samples: sm, start_s: 0, sectors_s: [L / 3, (2 * L) / 3],
    drs_zones: [],
    corners: [{ n: 1, name: 'T1', s: c1 + arc / 2 }, { n: 2, name: 'T2', s: c2 + arc / 2 }],
    kerbs, runoff_m: runoff,
  };
  return buildTrack(json);
}
