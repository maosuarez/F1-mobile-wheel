import type { TrackJson, TrackSamplesJson, TrackSide } from './types';

export const SAMPLE_COLUMNS: readonly (keyof TrackSamplesJson)[] = [
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
    const side = o.side;
    if (side !== 'left' && side !== 'right') fail(`kerbs[${i}].side`, "debe ser 'left' o 'right'");
    return { s0: num(o.s0, `kerbs[${i}].s0`), s1: num(o.s1, `kerbs[${i}].s1`), side: side as TrackSide };
  });

  const runoff_m = num(r.runoff_m, 'runoff_m');

  return {
    id, name, length_m, direction, step_m,
    samples: samples as unknown as TrackSamplesJson,
    start_s, sectors_s, drs_zones, corners, kerbs, runoff_m,
  };
}
