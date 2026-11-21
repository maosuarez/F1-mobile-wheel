// Entorno real del circuito (b12, design D1/D7): carga y validación ligera de /track/<id>.world.json.
// Todas las coordenadas están ya en el marco de la pista (metros); terrain.h en decímetros enteros.

export type BuildingKind = 'pit' | 'grandstand' | 'tower' | 'generic';
export const BUILDING_KINDS: readonly BuildingKind[] = ['pit', 'grandstand', 'tower', 'generic'];

export interface WorldTerrainJson { x0: number; z0: number; cell: number; nx: number; nz: number; h: number[] }
export interface WorldBuildingJson { kind: BuildingKind; h: number; y: number; ring: number[] }

export interface WorldJson {
  id: string; version: 1;
  attribution: string;
  terrain: WorldTerrainJson;
  buildings: WorldBuildingJson[];
  water: { ring: number[]; y: number }[];
  forest: { ring: number[] }[];
  pitlane: { pts: number[]; w: number } | null;
}

// En memoria: alturas del terreno ya en metros
export interface World {
  id: string;
  attribution: string;
  terrain: { x0: number; z0: number; cell: number; nx: number; nz: number; h: Float32Array };
  buildings: WorldBuildingJson[];
  water: { ring: number[]; y: number }[];
  forest: { ring: number[] }[];
  pitlane: { pts: number[]; w: number } | null;
}

type Rec = Record<string, unknown>;

function fail(path: string, msg: string): never {
  throw new Error(`world.${path}: ${msg}`);
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
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'se esperaba un número finito');
  return v as number;
}
function nums(v: unknown, path: string): number[] {
  const a = arr(v, path);
  for (let i = 0; i < a.length; i++) if (typeof a[i] !== 'number' || !Number.isFinite(a[i])) fail(`${path}[${i}]`, 'se esperaba un número finito');
  return a as number[];
}
// Anillo [x0,z0,x1,z1,...]: longitud par y al menos 3 vértices
function ring(v: unknown, path: string): number[] {
  const r = nums(v, path);
  if (r.length % 2 !== 0) fail(path, 'el anillo debe tener longitud par');
  if (r.length < 6) fail(path, 'el anillo necesita al menos 3 vértices');
  return r;
}

export function parseWorldJson(raw: unknown): World {
  const r = obj(raw, '');
  if (typeof r.id !== 'string') fail('id', 'se esperaba una cadena');
  if (r.version !== 1) fail('version', 'versión no soportada');
  const attribution = typeof r.attribution === 'string' ? r.attribution : '';

  const t = obj(r.terrain, 'terrain');
  const nx = num(t.nx, 'terrain.nx'), nz = num(t.nz, 'terrain.nz'), cell = num(t.cell, 'terrain.cell');
  if (!Number.isInteger(nx) || !Number.isInteger(nz) || nx < 2 || nz < 2) fail('terrain', 'nx y nz deben ser enteros ≥ 2');
  if (cell <= 0) fail('terrain.cell', 'debe ser positivo');
  const hRaw = nums(t.h, 'terrain.h');
  if (hRaw.length !== nx * nz) fail('terrain.h', `longitud ${hRaw.length}, se esperaba nx·nz = ${nx * nz}`);
  const h = new Float32Array(hRaw.length);
  for (let i = 0; i < hRaw.length; i++) h[i] = hRaw[i] / 10;

  const buildings = arr(r.buildings, 'buildings').map((b, i) => {
    const o = obj(b, `buildings[${i}]`);
    const kind = o.kind as BuildingKind;
    if (!BUILDING_KINDS.includes(kind)) fail(`buildings[${i}].kind`, `tipo desconocido ${String(o.kind)}`);
    const hb = num(o.h, `buildings[${i}].h`);
    if (hb <= 0) fail(`buildings[${i}].h`, 'debe ser positiva');
    return { kind, h: hb, y: num(o.y, `buildings[${i}].y`), ring: ring(o.ring, `buildings[${i}].ring`) };
  });
  const water = arr(r.water, 'water').map((w, i) => {
    const o = obj(w, `water[${i}]`);
    return { ring: ring(o.ring, `water[${i}].ring`), y: num(o.y, `water[${i}].y`) };
  });
  const forest = arr(r.forest, 'forest').map((f, i) => ({ ring: ring(obj(f, `forest[${i}]`).ring, `forest[${i}].ring`) }));

  let pitlane: World['pitlane'] = null;
  if (r.pitlane != null) {
    const p = obj(r.pitlane, 'pitlane');
    const pts = nums(p.pts, 'pitlane.pts');
    if (pts.length % 3 !== 0 || pts.length < 6) fail('pitlane.pts', 'se esperaban ≥ 2 puntos [x,y,z]');
    const w = num(p.w, 'pitlane.w');
    if (w <= 0) fail('pitlane.w', 'debe ser positivo');
    pitlane = { pts, w };
  }

  return { id: r.id, attribution, terrain: { x0: num(t.x0, 'terrain.x0'), z0: num(t.z0, 'terrain.z0'), cell, nx, nz, h }, buildings, water, forest, pitlane };
}

// Altura del terreno (m) por interpolación bilineal; fuera de la rejilla se toma el borde
export function terrainHeight(world: World, x: number, z: number): number {
  const T = world.terrain;
  const fx = Math.min(Math.max((x - T.x0) / T.cell, 0), T.nx - 1);
  const fz = Math.min(Math.max((z - T.z0) / T.cell, 0), T.nz - 1);
  const i0 = Math.min(Math.floor(fx), T.nx - 2), j0 = Math.min(Math.floor(fz), T.nz - 2);
  const u = fx - i0, v = fz - j0;
  const h = T.h, r0 = j0 * T.nx, r1 = r0 + T.nx;
  const a = h[r0 + i0] + (h[r0 + i0 + 1] - h[r0 + i0]) * u;
  const b = h[r1 + i0] + (h[r1 + i0 + 1] - h[r1 + i0]) * u;
  return a + (b - a) * v;
}

// Carga /track/<id>.world.json: 404 → null (respaldo procedural); JSON inválido → error en consola y null
export async function loadWorld(id: string): Promise<World | null> {
  const url = `/track/${id}.world.json`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    console.warn(`No se pudo cargar ${url}: ${(e as Error).message}`);
    return null;
  }
  if (res.status === 404) return null;
  if (!res.ok) { console.error(`No se pudo cargar ${url}: HTTP ${res.status}`); return null; }
  // El servidor de desarrollo puede responder index.html con 200 si el archivo no existe
  if (!(res.headers.get('content-type') ?? '').includes('json')) return null;
  try {
    return parseWorldJson(await res.json());
  } catch (e) {
    console.error(`${url} inválido: ${(e as Error).message}`);
    return null;
  }
}
