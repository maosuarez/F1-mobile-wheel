import type { Track, TrackJson } from './types';
import { SAMPLE_COLUMNS } from './schema';
import { inRangeS } from './query';

// Construye la pista en memoria (arrays tipados) a partir del JSON validado. Pista cerrada.
export function buildTrack(json: TrackJson): Track {
  const sm = json.samples;
  const n = sm.s.length;
  for (const col of SAMPLE_COLUMNS) {
    const a = sm[col];
    if (!Array.isArray(a)) throw new Error(`samples.${col}: columna ausente`);
    if (a.length !== n) throw new Error(`samples.${col}: longitud ${a.length} distinta de ${n}`);
  }
  if (n < 3) throw new Error(`samples.s: se necesitan al menos 3 muestras (hay ${n})`);

  const f = (col: keyof typeof sm) => Float64Array.from(sm[col]);
  const nx = f('nx'), nz = f('nz');
  const tx = new Float64Array(n), tz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Normal unitaria y tangente = (−nz, nx)
    const len = Math.hypot(nx[i], nz[i]) || 1;
    nx[i] /= len; nz[i] /= len;
    tx[i] = -nz[i]; tz[i] = nx[i];
  }

  const t: Track = {
    id: json.id, name: json.name, length: json.length_m, step: json.step_m, n, closed: true,
    direction: json.direction,
    s: f('s'), x: f('x'), y: f('y'), z: f('z'), wl: f('wl'), wr: f('wr'),
    nx, nz, tx, tz, k: f('k'), pitch: f('pitch'), bank: f('bank'),
    kerbL: new Uint8Array(n), kerbR: new Uint8Array(n),
    startS: json.start_s, sectorsS: [json.sectors_s[0], json.sectors_s[1]],
    drsZones: json.drs_zones.map((z) => ({ ...z })), corners: json.corners.map((c) => ({ ...c })),
    kerbs: json.kerbs.map((k) => ({ ...k })), runoff: json.runoff_m,
  };
  computeKerbFlags(t);
  return t;
}

// Marca por muestra si tiene piano a cada lado (tramos que cruzan s = 0 incluidos).
export function computeKerbFlags(t: Track): void {
  t.kerbL.fill(0); t.kerbR.fill(0);
  for (const kb of t.kerbs) {
    const flags = kb.side === 'left' ? t.kerbL : t.kerbR;
    for (let i = 0; i < t.n; i++) {
      if (inRangeS(t, t.s[i], kb.s0, kb.s1) || t.s[i] === kb.s1) flags[i] = 1;
    }
  }
}
