import * as THREE from 'three';
import type { Track } from '../track/types';
import { config, type GameConfig } from '../shared/config';
import { sampleAt } from '../track/query';
import type { TrackInfo } from '../shared/tracks';
import { mulberry32 } from './trackMaterials';
import type { GameScene } from './scene';

// Iluminación nocturna (b18, design D4). Solo actúa con lighting 'night'; con 'day' no cambia nada.
// Coste: postes instanciados (2 draw calls); charcos de luz en el color de vértice y ventanas en los edificios sin mallas.

export type Lighting = TrackInfo['lighting'];

export const isNight = (info: Pick<TrackInfo, 'lighting'> | null | undefined): boolean => info?.lighting === 'night';

// Factor de los charcos de luz en s: 1 junto a cada poste (s = k·poleEveryM), 1 − poolDepth a mitad de camino
export function poolFactor(s: number, N: GameConfig['night'] = config.night): number {
  const c = Math.cos((Math.PI * s) / N.poleEveryM);
  return 1 - N.poolDepth * (1 - c * c);
}

// Abscisas de los postes: cada poleEveryM desde s = 0, alternando lados (par a la izquierda). El último k·poleEveryM
// solo se pone si queda a ≥ media separación del poste de s = 0 (coincide con los charcos de poolFactor)
export function polePositions(track: Track, N: GameConfig['night'] = config.night): { s: number; side: 1 | -1 }[] {
  const full = Math.floor(track.length / N.poleEveryM);
  const n = full + (track.length - full * N.poleEveryM >= N.poleEveryM / 2 ? 1 : 0);
  return Array.from({ length: n }, (_, k) => ({ s: k * N.poleEveryM, side: (k % 2 === 0 ? 1 : -1) as 1 | -1 }));
}

// Postes junto a la barrera (muro de la simulación + poleOffsetM) con brazo y cabezal emisivo sobre la pista
export function buildLightPoles(track: Track, N: GameConfig['night'] = config.night): THREE.Group {
  const poles = polePositions(track, N);
  const shaftGeo = new THREE.CylinderGeometry(N.poleR, N.poleR * 1.4, N.poleH + N.poleSinkM, 6);
  shaftGeo.translate(0, (N.poleH - N.poleSinkM) / 2, 0);
  // Brazo + cabezal: caja en x = a lo largo de la pista, z = hacia la pista desde el poste
  const headGeo = new THREE.BoxGeometry(N.headLenM, N.headH, N.armM);
  headGeo.translate(0, N.poleH, N.armM / 2);
  const shaftMat = new THREE.MeshStandardMaterial({ color: N.poleColor, roughness: 0.6, metalness: 0.4 });
  const headMat = new THREE.MeshStandardMaterial({ color: '#202226', roughness: 0.5, metalness: 0.2,
    emissive: N.headColor, emissiveIntensity: N.headEmissive });
  const shafts = new THREE.InstancedMesh(shaftGeo, shaftMat, poles.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, poles.length);
  shafts.name = 'night-poles'; heads.name = 'night-heads';
  const m = new THREE.Matrix4(), along = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), inward = new THREE.Vector3();
  poles.forEach((p, i) => {
    const f = sampleAt(track, p.s);
    const d = p.side > 0 ? f.wl + track.runoff + N.poleOffsetM : -(f.wr + track.runoff + N.poleOffsetM);
    // inward apunta de vuelta hacia la pista; along completa una base dextrógira (along × up = inward)
    inward.set(-p.side * f.nx, 0, -p.side * f.nz).normalize();
    along.crossVectors(up, inward).normalize();
    m.makeBasis(along, up, inward).setPosition(f.x + f.nx * d, f.y, f.z + f.nz * d);
    shafts.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
  });
  shafts.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
  shafts.computeBoundingSphere(); heads.computeBoundingSphere();
  const g = new THREE.Group();
  g.name = 'night';
  g.add(shafts, heads);
  return g;
}

// Ventanas: rejilla de CELLS × CELLS celdas de CELL_PX px; la fila 0 queda apagada (techos y caras sin ventanas).
// Textura de datos en lugar de CanvasTexture para no depender del DOM (mismo resultado, determinista por semilla)
export const WINDOW_CELLS = 32;
const CELL_PX = 8;
export function createWindowTexture(N: GameConfig['night'] = config.night): THREE.DataTexture {
  const px = WINDOW_CELLS * CELL_PX, rnd = mulberry32(N.windowSeed);
  const data = new Uint8Array(px * px * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const lit = new THREE.Color(N.windowColor);
  for (let cy = 1; cy < WINDOW_CELLS; cy++) {
    for (let cx = 0; cx < WINDOW_CELLS; cx++) {
      if (rnd() >= N.windowLit) continue;
      const k = 0.7 + 0.3 * rnd();
      // Hueco de ventana: 6 × 5 px dentro de la celda de 8 × 8 (marco oscuro)
      for (let y = 2; y < 7; y++) for (let x = 1; x < 7; x++) {
        const o = ((cy * CELL_PX + y) * px + cx * CELL_PX + x) * 4;
        data[o] = Math.round(lit.r * 255 * k); data[o + 1] = Math.round(lit.g * 255 * k); data[o + 2] = Math.round(lit.b * 255 * k);
      }
    }
  }
  const t = new THREE.DataTexture(data, px, px, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// UV de ventanas para una pared: u por metros a lo largo, v por metros de altura (desde la fila 1)
export function windowUv(alongM: number, heightM: number, N: GameConfig['night'] = config.night): [number, number] {
  return [alongM / (N.windowW * WINDOW_CELLS), (1 + heightM / N.windowH) / WINDOW_CELLS];
}
export const WINDOW_OFF_V = 0.5 / WINDOW_CELLS;   // centro de la fila apagada

// Configuración de posproceso: bloom nocturno solo de noche
export function postConfigFor(info: Pick<TrackInfo, 'lighting'> | null | undefined, cfg: GameConfig = config): GameConfig {
  if (!isNight(info)) return cfg;
  return { ...cfg, post: { ...cfg.post, bloomStrength: cfg.night.bloomStrength, bloomThreshold: cfg.night.bloomThreshold } };
}

// Luz, cielo y niebla de noche + postes. Devuelve true si se aplicó (solo con lighting 'night')
export function applyNight(gs: GameScene, info: Pick<TrackInfo, 'lighting'> | null | undefined, track: Track): boolean {
  if (!isNight(info)) return false;
  const N = config.night;
  gs.scene.environmentIntensity = N.envIntensity;
  if (gs.scene.fog) gs.scene.fog.color.set(N.fog);
  gs.sunDir.set(...N.sunDir).normalize();
  gs.sun.color.set(N.sunColor);
  gs.sun.intensity = N.sunIntensity;
  const hemi = gs.scene.getObjectByName('hemi') as THREE.HemisphereLight | undefined;
  if (hemi) { hemi.color.set(N.hemiSky); hemi.groundColor.set(N.hemiGround); hemi.intensity = N.hemiIntensity; }
  // Cúpula procedural (respaldo si el HDRI no carga): degradado oscuro sin halo de sol
  const u = (gs.sky.material as THREE.ShaderMaterial).uniforms;
  u.uZenith.value.set(N.skyZenith); u.uHorizon.value.set(N.skyHorizon); u.uGround.value.set(N.skyGround);
  u.uSunDir.value.copy(gs.sunDir); u.uHaloGain.value = 0; u.uGlowGain.value = 0;
  const poles = buildLightPoles(track, N);
  gs.scene.add(poles);
  gs.night = poles;
  return true;
}
