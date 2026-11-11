import * as THREE from 'three';
import type { Track } from '../track/types';
import { config } from '../shared/config';
import { buildTrackMeshes, type TrackMeshes } from '../track/mesh';
import { createTrackMaterials } from './trackMaterials';
import { QUALITY, type QualitySettings } from './quality';
import { buildEnvironment as buildScenery, disposeEnvironment } from './environment';
import { createSkyDome, createSkyMaterial } from './sky';

export interface GameScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  meshes: TrackMeshes;
  sun: THREE.DirectionalLight;
  sky: THREE.Mesh;
  track: Track;
  env: THREE.Group;
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
export function createScene(track: Track, settings: Pick<QualitySettings, 'trees' | 'trackMaps'> = QUALITY.high): GameScene {
  const L = config.light, S = config.sky;
  const scene = new THREE.Scene();
  const sunDir = new THREE.Vector3(...L.sunDir).normalize();
  const sky = createSkyDome(createSkyMaterial(S, sunDir), S.radiusM);
  scene.add(sky);
  scene.background = null;
  scene.fog = new THREE.Fog(new THREE.Color(S.horizon), config.render.far * S.fogNearFrac, config.render.far * S.fogFarFrac);
  scene.environmentIntensity = L.envIntensity;
  scene.add(new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemiIntensity));

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

  const meshes = buildTrackMeshes(track, createTrackMaterials(settings.trackMaps));
  // La pista recibe sombra; solo el coche la proyecta
  meshes.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.receiveShadow = true; });
  scene.add(meshes.group);

  const env = buildScenery(track, settings);
  scene.add(env);

  const camera = new THREE.PerspectiveCamera(config.render.fovDeg, 1, config.render.near, config.render.far);
  return { scene, camera, meshes, sun, sky, track, env };
}

// Ejes x/y de la cámara de sombra (lookAt con up = +Y), constantes porque el sol no se mueve
const sunDirN = new THREE.Vector3(...config.light.sunDir).normalize();
const lightX = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), sunDirN).normalize();
const lightY = new THREE.Vector3().crossVectors(sunDirN, lightX);
const _center = new THREE.Vector3();

// Centro del encuadre de sombra: aheadM por delante del coche, ajustado a múltiplos de un téxel en el plano de la luz
export function shadowCenter(x: number, y: number, z: number, yaw: number, extentM: number, mapSize: number,
  aheadM = config.light.shadowAheadM, out = new THREE.Vector3()): THREE.Vector3 {
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
  const c = shadowCenter(x, y, z, yaw, L.shadowExtentM, gs.sun.shadow.mapSize.x, L.shadowAheadM, _center);
  gs.sun.target.position.copy(c);
  gs.sun.position.copy(c).addScaledVector(sunDirN, L.shadowDistM);
  gs.sun.target.updateMatrixWorld();
  gs.sky.position.copy(gs.camera.position);
}

// Entorno de reflexión: PMREM de una escena auxiliar con solo la cúpula
function buildEnvironment(renderer: THREE.WebGLRenderer, gs: GameScene, size: number): THREE.WebGLRenderTarget {
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
  if (gs.env.userData.trees !== settings.trees) {
    gs.scene.remove(gs.env);
    disposeEnvironment(gs.env);
    gs.env = buildScenery(gs.track, settings);
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
