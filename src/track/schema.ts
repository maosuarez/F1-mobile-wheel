import type { BarrierType, Board, KerbType, RunoffType, TrackJson, TrackSamplesJson, TrackSide } from './types';

export const SAMPLE_COLUMNS: readonly Exclude<keyof TrackSamplesJson, 'rl'>[] = [
  's', 'x', 'y', 'z', 'wl', 'wr', 'nx', 'nz', 'k', 'pitch', 'bank',
];

type Rec = Record<string, unknown>;

function fail(path: string, msg: string): never {
  throw new Error(`${path}: ${msg}`);
}

function obj(v: unknown, path: string): Rec {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'se esperaba un objeto');
  return v as Rec;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'se esperaba un arreglo');
  return v as unknown[];
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number') fail(path, 'se esperaba un número');
  if (!Number.isFinite(v)) fail(path, 'valor no finito');
  return v as number;
}

function side(v: unknown, path: string): TrackSide {
  if (v !== 'left' && v !== 'right') fail(path, "debe ser 'left' o 'right'");
  return v as TrackSide;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) fail(path, `debe ser uno de ${allowed.join(', ')}`);
  return v as T;
}

// s en [0, length) (tolerancia de redondeo de 1 mm en el extremo)
function sIn(v: unknown, length: number, path: string): number {
  const s = num(v, path);
  if (s < 0 || s > length + 1e-3) fail(path, `fuera de [0, ${length})`);
  return s;
}

const KERB_TYPES: readonly KerbType[] = ['flat', 'serrated', 'sausage'];
const RUNOFF_TYPES: readonly RunoffType[] = ['asphalt', 'gravel', 'grass'];
const BARRIER_TYPES: readonly BarrierType[] = ['tecpro', 'armco', 'concrete'];
const BOARD_M: readonly number[] = [150, 100, 50];

// Tramos opcionales de borde de pista (runoffs, barriers): ausentes → []
function spans<T extends string>(v: unknown, name: string, types: readonly T[], length: number): { s0: number; s1: number; side: TrackSide; type: T }[] {
  if (v === undefined) return [];
  return arr(v, name).map((x, i) => {
    const o = obj(x, `${name}[${i}]`);
    return {
      s0: sIn(o.s0, length, `${name}[${i}].s0`), s1: sIn(o.s1, length, `${name}[${i}].s1`),
      side: side(o.side, `${name}[${i}].side`), type: oneOf(o.type, types, `${name}[${i}].type`),
    };
  });
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string') fail(path, 'se esperaba una cadena');
  return v as string;
}

export function parseTrackJson(raw: unknown): TrackJson {
  const r = obj(raw, 'track');
  const id = str(r.id, 'id');
  const name = str(r.name, 'name');
  const length_m = num(r.length_m, 'length_m');
  const direction = r.direction;
  if (direction !== 'ccw' && direction !== 'cw') fail('direction', "debe ser 'ccw' o 'cw'");
  const step_m = num(r.step_m, 'step_m');

  const sm = obj(r.samples, 'samples');
  const samples = {} as Record<string, number[]>;
  let len = -1;
  for (const col of SAMPLE_COLUMNS) {
    const a = arr(sm[col], `samples.${col}`);
    a.forEach((v, i) => num(v, `samples.${col}[${i}]`));
    if (len < 0) len = a.length;
    else if (a.length !== len) fail(`samples.${col}`, `longitud ${a.length} distinta de ${len}`);
    samples[col] = a as number[];
  }

  const start_s = num(r.start_s, 'start_s');
  const sec = arr(r.sectors_s, 'sectors_s');
  if (sec.length !== 2) fail('sectors_s', 'debe tener 2 elementos');
  const sectors_s: [number, number] = [num(sec[0], 'sectors_s[0]'), num(sec[1], 'sectors_s[1]')];

  const drs_zones = arr(r.drs_zones, 'drs_zones').map((z, i) => {
    const o = obj(z, `drs_zones[${i}]`);
    return {
      detect_s: num(o.detect_s, `drs_zones[${i}].detect_s`),
      start_s: num(o.start_s, `drs_zones[${i}].start_s`),
      end_s: num(o.end_s, `drs_zones[${i}].end_s`),
    };
  });

  const corners = arr(r.corners, 'corners').map((c, i) => {
    const o = obj(c, `corners[${i}]`);
    return {
      n: num(o.n, `corners[${i}].n`),
      name: str(o.name, `corners[${i}].name`),
      s: num(o.s, `corners[${i}].s`),
    };
  });

  const kerbs = arr(r.kerbs, 'kerbs').map((k, i) => {
    const o = obj(k, `kerbs[${i}]`);
    const kb: TrackJson['kerbs'][number] = { s0: num(o.s0, `kerbs[${i}].s0`), s1: num(o.s1, `kerbs[${i}].s1`), side: side(o.side, `kerbs[${i}].side`) };
    if (o.type !== undefined) kb.type = oneOf(o.type, KERB_TYPES, `kerbs[${i}].type`);
    return kb;
  });

  const runoff_m = num(r.runoff_m, 'runoff_m');

  // Campos opcionales de borde de pista (b13, design D1)
  if (sm.rl !== undefined) {
    const a = arr(sm.rl, 'samples.rl');
    a.forEach((v, i) => num(v, `samples.rl[${i}]`));
    if (a.length !== len) fail('samples.rl', `longitud ${a.length} distinta de ${len}`);
    samples.rl = a as number[];
  }
  const runoffs = spans(r.runoffs, 'runoffs', RUNOFF_TYPES, length_m);
  const barriers = spans(r.barriers, 'barriers', BARRIER_TYPES, length_m);
  const boards: Board[] = r.boards === undefined ? [] : arr(r.boards, 'boards').map((b, i) => {
    const o = obj(b, `boards[${i}]`);
    const m = num(o.m, `boards[${i}].m`);
    if (!BOARD_M.includes(m)) fail(`boards[${i}].m`, 'debe ser 150, 100 o 50');
    return { s: sIn(o.s, length_m, `boards[${i}].s`), side: side(o.side, `boards[${i}].side`), m: m as Board['m'] };
  });

  return {
    id, name, length_m, direction, step_m,
    samples: samples as unknown as TrackSamplesJson,
    start_s, sectors_s, drs_zones, corners, kerbs, runoff_m,
    ...(r.runoffs !== undefined ? { runoffs } : {}),
    ...(r.barriers !== undefined ? { barriers } : {}),
    ...(r.boards !== undefined ? { boards } : {}),
  };
}
