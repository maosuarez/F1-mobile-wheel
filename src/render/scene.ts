import * as THREE from 'three';
import type { Track } from '../track/types';
import { config } from '../shared/config';
import { buildTrackMeshes, type TrackMeshes } from '../track/mesh';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { assetUrl, createTrackMaterials, type AssetManifest } from './trackMaterials';
import { buildTrackside, createTracksideMaterials } from './trackside';
import { QUALITY, type QualitySettings } from './quality';
import { buildEnvironment as buildScenery, disposeEnvironment } from './environment';
import { createSkyDome, createSkyMaterial } from './sky';
import { buildWorld } from './world';
import type { World } from '../track/world';
import type { TrackInfo } from '../shared/tracks';
import { applyNight, isNight } from './night';

export interface GameScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  meshes: TrackMeshes;
  sun: THREE.DirectionalLight;
  sky: THREE.Mesh;
  track: Track;
  env: THREE.Group;
  world: World | null;   // entorno real (b12); null → entorno procedural
  trackside: THREE.Group;    // kit de borde de pista (b13)
  hdri: THREE.DataTexture | null;   // cielo HDRI cargado (b13); null → cúpula procedural
  info: TrackInfo | null;           // iluminación, HDRI y suelo del circuito (b18 D2); null → día con hierba
  sunDir: THREE.Vector3;            // dirección hacia la luz direccional (config.light o config.night)
  night: THREE.Group | null;        // postes de luz (b18 D4); null de día
}

// DPR limitado a config.render.maxDpr; ACES + sRGB y mapa de sombras PCF (design D2)
// preserveDrawingBuffer solo con ?debug=1, para leer píxeles en los E2E (design D8)
export function createRenderer(canvas: HTMLCanvasElement, preserveDrawingBuffer = false): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, config.render.maxDpr));
  renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = config.light.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap está obsoleto en r182+; PCFShadowMap ya filtra suave
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}

// Cielo con degradado, niebla del color del horizonte, sol con sombra, relleno hemisférico, mallas de pista y cámara
// Entorno real si hay world.json (sin gradas ni silueta procedurales); si no, el procedural de b6
// Árboles efectivos: ninguno en el desierto (b18 D5)
export function treesFor(settings: Pick<QualitySettings, 'trees'>, info: TrackInfo | null): number {
  return info?.ground === 'sand' ? 0 : settings.trees;
}

function buildEnv(track: Track, world: World | null, meshes: TrackMeshes, settings: Pick<QualitySettings, 'trees'>, info: TrackInfo | null): THREE.Group {
  const eff = { trees: treesFor(settings, info) };
  // Calle de boxes con el material de escapatoria de asfalto (asphalt_pit_lane, b13 design D7)
  return world
    ? buildWorld(world, track, { grass: meshes.materials.grass, road: meshes.materials.runoff }, eff,
      { ground: info?.ground ?? 'grass', lighting: info?.lighting ?? 'day' })
    : buildScenery(track, eff);
}

export function createScene(track: Track, settings: Pick<QualitySettings, 'trees' | 'trackMaps'> = QUALITY.high, world: World | null = null,
  info: TrackInfo | null = null): GameScene {
  const L = config.light, S = config.sky;
  const scene = new THREE.Scene();
  const sunDir = new THREE.Vector3(...L.sunDir).normalize();
  const sky = createSkyDome(createSkyMaterial(S, sunDir), S.radiusM);
  scene.add(sky);
  scene.background = null;
  scene.fog = new THREE.Fog(new THREE.Color(S.horizon), config.render.far * S.fogNearFrac, config.render.far * S.fogFarFrac);
  scene.environmentIntensity = L.envIntensity;
  const hemi = new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemiIntensity);
  hemi.name = 'hemi';
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(L.sunColor, L.sunIntensity);
  sun.name = 'sun';
  const sc = sun.shadow.camera;
  sc.left = -L.shadowExtentM / 2; sc.right = L.shadowExtentM / 2;
  sc.top = L.shadowExtentM / 2; sc.bottom = -L.shadowExtentM / 2;
  sc.near = L.shadowNear; sc.far = L.shadowFar;
  sc.updateProjectionMatrix();
  sun.shadow.bias = L.shadowBias;
  sun.shadow.normalBias = L.shadowNormalBias;
  sun.castShadow = false; // lo activa applyQuality según QualitySettings.shadows
  scene.add(sun, sun.target);

  const meshes = buildTrackMeshes(track, createTrackMaterials(settings.trackMaps, info?.ground ?? 'grass'), undefined, info?.lighting ?? 'day');
  // La pista recibe sombra; solo el coche la proyecta
  meshes.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.receiveShadow = true; });
  scene.add(meshes.group);

  // Con terreno real, el suelo plano bajo la pista asomaría en los valles
  const ground = meshes.group.getObjectByName('ground');
  if (ground && world) ground.visible = false;

  // Borde de pista: pianos con perfil, barreras en el muro de la simulación, valla, carteles, comisarios (b13)
  const trackside = buildTrackside(track, createTracksideMaterials(meshes.materials), settings, world);
  scene.add(trackside);

  const env = buildEnv(track, world, meshes, settings, info);
  scene.add(env);

  const camera = new THREE.PerspectiveCamera(config.render.fovDeg, 1, config.render.near, config.render.far);
  const gs: GameScene = { scene, camera, meshes, sun, sky, track, env, world, trackside, hdri: null, info, sunDir, night: null };
  // Noche (b18 D4): luces, cielo, niebla y postes; de día no hace nada
  applyNight(gs, info, track);
  return gs;
}

// --- Cielo HDRI (b13, design D7) ---

// Color lineal medio de la banda del horizonte (±2 % de alto alrededor de v = 0,5) de un equirectangular HDR
export function hdriHorizonColor(tex: THREE.DataTexture): THREE.Color {
  const { data, width, height } = tex.image as { data: ArrayLike<number>; width: number; height: number };
  const half = tex.type === THREE.HalfFloatType;
  const val = (i: number) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  const ch = data.length / (width * height);
  const band = Math.max(1, Math.round(height * 0.02)), y0 = Math.floor(height / 2) - band;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y0 + 2 * band; y++) {
    for (let x = 0; x < width; x += 4) {
      const i = (y * width + x) * ch;
      r += val(i); g += val(i + 1); b += val(i + 2); n++;
    }
  }
  return new THREE.Color().setRGB(r / n, g / n, b / n, THREE.LinearSRGBColorSpace);
}

// Copia reducida (factor 4) del HDRI con la radiancia recortada a sky.hdriEnvClamp: el sol ya lo aporta la luz
// direccional, así el entorno PMREM no duplica su brillo ni su reflejo
function clampedHdri(tex: THREE.DataTexture): THREE.DataTexture {
  const { data, width, height } = tex.image as { data: ArrayLike<number>; width: number; height: number };
  const half = tex.type === THREE.HalfFloatType;
  const val = (i: number) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  const ch = data.length / (width * height), F = 4, w = Math.floor(width / F), h = Math.floor(height / F);
  const out = new Uint16Array(w * h * 4), max = config.sky.hdriEnvClamp;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let dy = 0; dy < F; dy++) for (let dx = 0; dx < F; dx++) sum += Math.min(val(((y * F + dy) * width + x * F + dx) * ch + c), max);
      out[(y * w + x) * 4 + c] = THREE.DataUtils.toHalfFloat(sum / (F * F));
    }
    out[(y * w + x) * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.flipY = tex.flipY;
  t.needsUpdate = true;
  return t;
}

export interface HdriLoaderLike { loadAsync(url: string): Promise<THREE.DataTexture> }

// Carga el HDRI del manifiesto como fondo y fuente del entorno; la niebla toma el color del horizonte.
// Si falla, se mantiene la cúpula procedural y solo se avisa. Devuelve true si se aplicó.
export async function loadHdriSky(gs: GameScene, manifest: AssetManifest | null, loader: HdriLoaderLike = new HDRLoader()): Promise<boolean> {
  const night = isNight(gs.info);
  const url = assetUrl(manifest, gs.info?.hdri ?? config.assets.hdriId, 'hdri');
  try {
    if (!url) throw new Error('sin HDRI en el manifiesto');
    const tex = await loader.loadAsync(url);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    gs.hdri = tex;
    gs.scene.background = tex;
    gs.scene.backgroundIntensity = night ? config.night.backgroundIntensity : config.sky.hdriBackgroundIntensity;
    gs.sky.visible = false;
    // De noche la niebla mantiene config.night.fog (b18 D4)
    if (gs.scene.fog && !night) gs.scene.fog.color.copy(hdriHorizonColor(tex)).multiplyScalar(config.sky.hdriBackgroundIntensity);
    // El entorno se reconstruye desde el HDRI en el siguiente applyQuality
    (gs.scene.environment?.userData.rt as THREE.WebGLRenderTarget | undefined)?.dispose();
    gs.scene.environment = null;
    return true;
  } catch (e) {
    console.warn('[assets] HDRI no disponible, se mantiene el cielo procedural', e);
    return false;
  }
}

// Ejes x/y de la cámara de sombra (lookAt con up = +Y) para la dirección de luz dada (día por defecto)
const sunDirN = new THREE.Vector3(...config.light.sunDir).normalize();
const _up = new THREE.Vector3(0, 1, 0), lightX = new THREE.Vector3(), lightY = new THREE.Vector3();
const _center = new THREE.Vector3();

// Centro del encuadre de sombra: aheadM por delante del coche, ajustado a múltiplos de un téxel en el plano de la luz
export function shadowCenter(x: number, y: number, z: number, yaw: number, extentM: number, mapSize: number,
  aheadM = config.light.shadowAheadM, out = new THREE.Vector3(), dir: THREE.Vector3 = sunDirN): THREE.Vector3 {
  lightX.crossVectors(_up, dir).normalize();
  lightY.crossVectors(dir, lightX);
  out.set(x + Math.cos(yaw) * aheadM, y, z - Math.sin(yaw) * aheadM);
  const texel = extentM / Math.max(1, mapSize);
  const cx = out.dot(lightX), cy = out.dot(lightY);
  out.addScaledVector(lightX, Math.round(cx / texel) * texel - cx);
  out.addScaledVector(lightY, Math.round(cy / texel) * texel - cy);
  return out;
}

// Cada fotograma: sol y su sombra siguen al coche; la cúpula se centra en la cámara
export function updateScene(gs: GameScene, x: number, y: number, z: number, yaw: number): void {
  const L = config.light;
  const c = shadowCenter(x, y, z, yaw, L.shadowExtentM, gs.sun.shadow.mapSize.x, L.shadowAheadM, _center, gs.sunDir);
  gs.sun.target.position.copy(c);
  gs.sun.position.copy(c).addScaledVector(gs.sunDir, L.shadowDistM);
  gs.sun.target.updateMatrixWorld();
  gs.sky.position.copy(gs.camera.position);
}

// Entorno de reflexión: PMREM del HDRI recortado si está cargado; si no, de una escena auxiliar con solo la cúpula
function buildEnvironment(renderer: THREE.WebGLRenderer, gs: GameScene, size: number): THREE.WebGLRenderTarget {
  if (gs.hdri) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const src = clampedHdri(gs.hdri);
    const rt = pmrem.fromEquirectangular(src);
    pmrem.dispose();
    src.dispose();
    return rt;
  }
  const aux = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), gs.sky.material);
  aux.add(dome);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(aux, 0, 0.1, 100, { size });
  pmrem.dispose();
  dome.geometry.dispose();
  return rt;
}

// Ajusta renderer y cámara al tamaño del canvas; maxDpr = QualitySettings.dpr del nivel activo
export function resize(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, maxDpr = config.render.maxDpr): void {
  const canvas = renderer.domElement;
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr, config.render.maxDpr));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// Aplica en caliente los ajustes de calidad: DPR, sombra del sol y tamaño del entorno (design D1/D2)
export function applyQuality(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, settings: QualitySettings, gs?: GameScene): void {
  resize(renderer, camera, settings.dpr);
  if (!gs) return;
  const size = Math.min(settings.shadowMapSize, 2048);
  const on = settings.shadows && size > 0;
  const shadow = gs.sun.shadow;
  if (on && shadow.mapSize.x !== size) {
    shadow.mapSize.set(size, size);
    shadow.map?.dispose();
    shadow.map = null;
  }
  gs.sun.castShadow = on;
  // Árboles según el nivel: se regenera el entorno si cambia el número
  if (gs.env.userData.trees !== treesFor(settings, gs.info)) {
    gs.scene.remove(gs.env);
    disposeEnvironment(gs.env);
    gs.env = buildEnv(gs.track, gs.world, gs.meshes, settings, gs.info);
    gs.scene.add(gs.env);
  }
  const env = gs.scene.environment;
  // envMapSize 0 (perfil software): sin scene.environment
  if (settings.envMapSize <= 0) {
    (env?.userData.rt as THREE.WebGLRenderTarget | undefined)?.dispose();
    gs.scene.environment = null;
  } else if (!env || env.userData.size !== settings.envMapSize) {
    (env?.userData.rt as THREE.WebGLRenderTarget | undefined)?.dispose();
    const rt = buildEnvironment(renderer, gs, settings.envMapSize);
    rt.texture.userData = { size: settings.envMapSize, rt };
    gs.scene.environment = rt.texture;
  }
}

// Nombre del renderizador de la GPU (WEBGL_debug_renderer_info si está disponible)
export function rendererName(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

// Luces con sombra activas y mayor tamaño de mapa de sombras de la escena
export function shadowStats(scene: THREE.Scene, renderer: THREE.WebGLRenderer): { shadowLights: number; shadowMapSize: number } {
  let shadowLights = 0, shadowMapSize = 0;
  if (!renderer.shadowMap.enabled) return { shadowLights, shadowMapSize };
  scene.traverseVisible((o) => {
    const l = o as THREE.Light & { shadow?: THREE.LightShadow };
    if (l.isLight && l.castShadow && l.shadow) {
      shadowLights++;
      shadowMapSize = Math.max(shadowMapSize, l.shadow.mapSize.x, l.shadow.mapSize.y);
    }
  });
  return { shadowLights, shadowMapSize };
}

// Coste estático de un objeto: mallas visibles (draw calls por grupo de material) y triángulos
export function objectCost(root: THREE.Object3D): { drawCalls: number; triangles: number } {
  let drawCalls = 0, triangles = 0;
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    const count = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
    const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
    drawCalls += Array.isArray(m.material) ? Math.max(1, g.groups.length) : 1;
    triangles += Math.floor(count / 3) * inst;
  });
  return { drawCalls, triangles };
}
