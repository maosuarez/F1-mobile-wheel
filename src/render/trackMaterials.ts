import * as THREE from 'three';
import { config } from '../shared/config';

// road: asfalto de pista; runoff: escapatoria de asfalto y calle de boxes; concrete: muros de hormigón (b13, design D5/D7)
export interface TrackMaterials {
  road: THREE.MeshStandardMaterial; grass: THREE.MeshStandardMaterial; gravel: THREE.MeshStandardMaterial;
  runoff: THREE.MeshStandardMaterial; concrete: THREE.MeshStandardMaterial;
}

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

// Grava: base beige con piedras claras y oscuras (respaldo procedural de gravel_floor)
export function createGravelTexture(seed = config.surfaces.seed + 2, px = config.surfaces.texPx): THREE.DataTexture {
  const size = clampPx(px), rnd = mulberry32(seed);
  const fine = tileableNoise(size, size / 2, rnd), mid = tileableNoise(size, size / 6, rnd);
  const data = new Uint8Array(size * size * 4);
  const base = new THREE.Color(PROC_GRAVEL);
  for (let i = 0; i < size * size; i++) {
    const k = 0.75 + 0.35 * fine[i] + 0.25 * (mid[i] - 0.5);
    data[i * 4] = Math.min(255, Math.round(base.r * 255 * k));
    data[i * 4 + 1] = Math.min(255, Math.round(base.g * 255 * k));
    data[i * 4 + 2] = Math.min(255, Math.round(base.b * 255 * k));
    data[i * 4 + 3] = 255;
  }
  return makeTexture(data, size, true);
}

// Hormigón: gris claro con manchas suaves (respaldo procedural de brushed_concrete)
export function createConcreteTexture(seed = config.surfaces.seed + 3, px = config.surfaces.texPx): THREE.DataTexture {
  const size = clampPx(px), rnd = mulberry32(seed);
  const fine = tileableNoise(size, size / 4, rnd), broad = tileableNoise(size, 6, rnd);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const c = Math.round(255 * Math.min(1, 0.72 + 0.12 * (fine[i] - 0.5) + 0.18 * (broad[i] - 0.5)));
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = c; data[i * 4 + 3] = 255;
  }
  return makeTexture(data, size, true);
}

// Tintes del respaldo procedural (sRGB); con la textura fotoescaneada el material pasa a blanco
const PROC_GRAVEL = '#9a8c74';
const TINT = { gravel: '#ffffff', runoff: '#3a3a3e', concrete: '#c9c6c0' } as const;
const NOMAP_TINT = { gravel: PROC_GRAVEL, runoff: '#3a3a3e', concrete: '#b5b2ac' } as const;

// maps = false (perfil software): sin map ni roughnessMap, solo colores por vértice
export function createTrackMaterials(maps = true): TrackMaterials {
  const asphalt = maps ? createAsphaltTextures() : null;
  const road = new THREE.MeshStandardMaterial({ vertexColors: true, map: asphalt?.color ?? null, roughnessMap: asphalt?.roughness ?? null, roughness: 1, metalness: 0 });
  const grass = new THREE.MeshStandardMaterial({ vertexColors: true, map: maps ? createGrassTexture() : null, roughness: 1, metalness: 0 });
  const tint = maps ? TINT : NOMAP_TINT;
  const gravel = new THREE.MeshStandardMaterial({ vertexColors: true, color: tint.gravel, map: maps ? createGravelTexture() : null, roughness: 1, metalness: 0 });
  const runoff = new THREE.MeshStandardMaterial({ vertexColors: true, color: tint.runoff, map: asphalt?.color ?? null, roughnessMap: asphalt?.roughness ?? null, roughness: 1, metalness: 0 });
  const concrete = new THREE.MeshStandardMaterial({ color: tint.concrete, map: maps ? createConcreteTexture() : null, roughness: 0.9, metalness: 0 });
  for (const m of [road, grass, gravel, runoff, concrete]) m.userData.textureSource = 'procedural';
  return { road, grass, gravel, runoff, concrete };
}

// --- Texturas CC0 fotoescaneadas (b13, design D7) ---

export interface AssetFile { map: string; path: string }
export interface AssetManifest { assets: { id: string; files: AssetFile[] }[] }
export interface TextureLoaderLike { loadAsync(url: string): Promise<THREE.Texture> }

// Material de pista → asset de Poly Haven
export const TRACK_TEXTURE_IDS: Record<keyof TrackMaterials, string> = {
  road: 'asphalt_track', runoff: 'asphalt_pit_lane', grass: 'leafy_grass', gravel: 'gravel_floor', concrete: 'brushed_concrete',
};

// Manifiesto de assets; null (con aviso) si no se puede leer
export async function fetchAssetManifest(fetchFn: typeof fetch = fetch): Promise<AssetManifest | null> {
  try {
    const r = await fetchFn(`${config.assets.base}manifest.json`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as AssetManifest;
  } catch (e) {
    console.warn('[assets] manifiesto no disponible, se usan materiales procedurales', e);
    return null;
  }
}

export function assetUrl(manifest: AssetManifest | null, id: string, map: string): string | null {
  const f = manifest?.assets.find((a) => a.id === id)?.files.find((x) => x.map === map);
  return f ? config.assets.base + f.path : null;
}

// Conversión sRGB → lineal de un canal en [0, 1]
const srgbToLinear = (c: number) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));

// Luminancia lineal media de una imagen (miniatura de 16 px); null sin canvas (tests en Node)
function meanLinear(image: unknown): number | null {
  try {
    if (typeof document === 'undefined' || !image) return null;
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image as CanvasImageSource, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lin = (v: number) => srgbToLinear(v / 255);
      sum += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    }
    return sum / (d.length / 4);
  } catch { return null; }
}

// Reduce la imagen a maxPx de lado con un canvas (perfil software); sin canvas la deja igual
function downscale(tex: THREE.Texture, maxPx: number): THREE.Texture {
  const img = tex.image as { width?: number; height?: number } | null;
  if (typeof document === 'undefined' || !img?.width || !img.height || Math.max(img.width, img.height) <= maxPx) return tex;
  const k = maxPx / Math.max(img.width, img.height);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d')?.drawImage(img as CanvasImageSource, 0, 0, c.width, c.height);
  const out = new THREE.CanvasTexture(c);
  tex.dispose();
  return out;
}

// Hierba fotoescaneada desaturada y teñida: color del mapa = luminancia Rec.601 (0..1,5) · 2 · grassTint.
// El color por vértice (variación, pendiente) se sigue multiplicando. Solo con la textura CC0 cargada
export function tintGrass(m: THREE.MeshStandardMaterial): void {
  const tint = new THREE.Color(config.surfaces.grassTint);
  m.userData.grassTint = tint;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGrassTint = { value: tint };
    shader.fragmentShader = 'uniform vec3 uGrassTint;\n' + shader.fragmentShader.replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  float grassLum = clamp( dot( sampledDiffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) ), 0.0, 1.5 );
  diffuseColor.rgb *= grassLum * 2.0 * uGrassTint;
#endif`);
  };
  m.customProgramCacheKey = () => 'grass-tint';
  m.needsUpdate = true;
}

export interface TrackTextureOptions { normals: boolean; anisotropy: number; maxPx?: number }

// Sustituye los mapas procedurales por los fotoescaneados. Un material cuya textura falla conserva el
// respaldo procedural y solo se emite un aviso; nunca lanza. Devuelve los materiales cargados y fallidos.
export async function loadTrackTextures(mats: TrackMaterials, opts: TrackTextureOptions, manifest: AssetManifest | null,
  loader: TextureLoaderLike = new THREE.TextureLoader()): Promise<{ loaded: (keyof TrackMaterials)[]; failed: (keyof TrackMaterials)[] }> {
  const loaded: (keyof TrackMaterials)[] = [], failed: (keyof TrackMaterials)[] = [];
  // Albedo medio del respaldo procedural del asfalto (0,86 sRGB): los colores por vértice de la pista son absolutos
  const roadTarget = srgbToLinear(0.86);
  await Promise.all((Object.keys(TRACK_TEXTURE_IDS) as (keyof TrackMaterials)[]).map(async (key) => {
    const id = TRACK_TEXTURE_IDS[key];
    try {
      const maps = ['Diffuse', 'Rough', ...(opts.normals ? ['nor_gl'] : [])];
      const urls = maps.map((m) => assetUrl(manifest, id, m));
      if (urls.some((u) => u === null)) throw new Error(`sin ${id} en el manifiesto`);
      const tex = await Promise.all(urls.map((u) => loader.loadAsync(u as string)));
      const [diff, rough, nor] = tex.map((t, i) => {
        const out = opts.maxPx ? downscale(t, opts.maxPx) : t;
        out.wrapS = out.wrapT = THREE.RepeatWrapping;
        out.anisotropy = opts.anisotropy;
        out.colorSpace = i === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        out.needsUpdate = true;
        return out;
      });
      const m = mats[key];
      m.map = diff; m.roughnessMap = rough; m.roughness = 1;
      if (key === 'grass') tintGrass(m);
      if (nor) m.normalMap = nor;
      // El color por vértice se conserva multiplicando; en la pista se compensa el brillo medio de la foto
      const mean = key === 'road' ? meanLinear(diff.image) : null;
      if (key === 'road') m.color.setScalar(mean && mean > 1e-3 ? Math.min(roadTarget / mean, 12) : 1);
      else m.color.set('#ffffff');
      m.userData.textureSource = id;
      m.needsUpdate = true;
      loaded.push(key);
    } catch (e) {
      console.warn(`[assets] ${id}: textura no disponible, se mantiene la procedural`, e);
      failed.push(key);
    }
  }));
  return { loaded, failed };
}
