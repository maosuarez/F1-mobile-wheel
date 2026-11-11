import * as THREE from 'three';
import { config } from '../shared/config';

export interface TrackMaterials { road: THREE.Material; grass: THREE.Material; wall: THREE.Material }

// PRNG sembrado (mulberry32): misma semilla, mismo resultado
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ruido de valor periódico (teselable) en [0, 1], con `cells` celdas por lado
function tileableNoise(size: number, cells: number, rnd: () => number): Float32Array {
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const out = new Float32Array(size * size);
  const sm = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells, y0 = Math.floor(fy), ty = sm(fy - y0), y1 = (y0 + 1) % cells;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells, x0 = Math.floor(fx), tx = sm(fx - x0), x1 = (x0 + 1) % cells;
      const a = lat[y0 * cells + x0] + (lat[y0 * cells + x1] - lat[y0 * cells + x0]) * tx;
      const b = lat[y1 * cells + x0] + (lat[y1 * cells + x1] - lat[y1 * cells + x0]) * tx;
      out[y * size + x] = a + (b - a) * ty;
    }
  }
  return out;
}

function makeTexture(data: Uint8Array, size: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

const clampPx = (px: number) => Math.min(Math.max(8, Math.floor(px)), config.surfaces.maxTexPx);

// Grano de asfalto: albedo casi blanco (se multiplica por el color por vértice) y rugosidad en el canal G
export function createAsphaltTextures(seed = config.surfaces.seed, px = config.surfaces.texPx): { color: THREE.DataTexture; roughness: THREE.DataTexture } {
  const size = clampPx(px), rnd = mulberry32(seed);
  const fine = tileableNoise(size, size / 2, rnd), mid = tileableNoise(size, size / 8, rnd), low = tileableNoise(size, 6, rnd);
  const col = new Uint8Array(size * size * 4), rough = new Uint8Array(size * size * 4);
  const g = config.surfaces.asphaltGrain;
  for (let i = 0; i < size * size; i++) {
    const n = 0.5 * (fine[i] - 0.5) + 0.35 * (mid[i] - 0.5) + 0.5 * (low[i] - 0.5);
    const c = Math.min(1, Math.max(0, 0.86 + n * g * 2.2));
    const r = Math.min(1, Math.max(0, 0.9 + (fine[i] - 0.5) * 0.3 - (low[i] - 0.5) * 0.2));
    col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = Math.round(c * 255); col[i * 4 + 3] = 255;
    rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = Math.round(r * 255); rough[i * 4 + 3] = 255;
  }
  return { color: makeTexture(col, size, true), roughness: makeTexture(rough, size, false) };
}

// Hierba: ruido de dos escalas sobre verde base
export function createGrassTexture(seed = config.surfaces.seed + 1, px = config.surfaces.texPx): THREE.DataTexture {
  const size = clampPx(px), rnd = mulberry32(seed);
  const fine = tileableNoise(size, size / 4, rnd), broad = tileableNoise(size, 8, rnd);
  const data = new Uint8Array(size * size * 4);
  const v = config.surfaces.grassVariation;
  for (let i = 0; i < size * size; i++) {
    const n = 0.6 * (broad[i] - 0.5) + 0.4 * (fine[i] - 0.5);
    const k = 1 + n * v * 2;
    data[i * 4] = Math.min(255, Math.round(0x2f * k));
    data[i * 4 + 1] = Math.min(255, Math.round(0x6b * k));
    data[i * 4 + 2] = Math.min(255, Math.round(0x2f * k));
    data[i * 4 + 3] = 255;
  }
  return makeTexture(data, size, true);
}

// maps = false (perfil software): sin map ni roughnessMap, solo colores por vértice
export function createTrackMaterials(maps = true): TrackMaterials {
  const asphalt = maps ? createAsphaltTextures() : null;
  const road = new THREE.MeshStandardMaterial({ vertexColors: true, map: asphalt?.color ?? null, roughnessMap: asphalt?.roughness ?? null, roughness: 1, metalness: 0 });
  const grass = new THREE.MeshStandardMaterial({ vertexColors: true, map: maps ? createGrassTexture() : null, roughness: 1, metalness: 0 });
  const wall = new THREE.MeshStandardMaterial({ color: '#cfcfcf', roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  return { road, grass, wall };
}
