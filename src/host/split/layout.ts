import { config, type GameConfig } from '../../shared/config';
import type { QualityLevel } from '../../render/quality';

// Pantalla dividida (b15, design D3). Lógica pura: rectángulos de cada vista, tope de calidad y plan de sombra.

export interface Viewport { x: number; y: number; w: number; h: number }

// Rectángulos en píxeles CSS con el origen abajo a la izquierda (convenio de renderer.setViewport / setScissor).
// n = 1: pantalla completa. n = 2: arriba J1, abajo J2 (J1 se queda la mitad entera inferior si el alto es impar).
export function viewports(n: number, w: number, h: number): Viewport[] {
  if (n <= 1) return [{ x: 0, y: 0, w, h }];
  const top = Math.floor(h / 2), bottom = h - top;
  return [{ x: 0, y: bottom, w, h: top }, { x: 0, y: 0, w, h: bottom }];
}

const ORDER: QualityLevel[] = ['high', 'medium', 'low', 'software'];

// Nivel de calidad acotado a `max` (con 2 jugadores, como mucho config.split.maxQuality)
export function capQuality(level: QualityLevel, max: QualityLevel): QualityLevel {
  return ORDER.indexOf(level) < ORDER.indexOf(max) ? max : level;
}

export interface Pose2 { x: number; y: number; z: number; yaw: number }
// shared = true: una sombra centrada entre los dos coches con encuadre extentM; false: sigue a J1 (extentM de siempre)
// y J2 lleva sombra de contacto falsa
export interface ShadowPlan { shared: boolean; x: number; y: number; z: number; yaw: number; extentM: number; aheadM: number }

export function shadowPlan(a: Pose2, b: Pose2, cfg: GameConfig = config): ShadowPlan {
  const L = cfg.light, S = cfg.split;
  const dist = Math.hypot(a.x - b.x, a.z - b.z);
  if (dist >= S.shareShadowM) return { shared: false, x: a.x, y: a.y, z: a.z, yaw: a.yaw, extentM: L.shadowExtentM, aheadM: L.shadowAheadM };
  return { shared: true, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, yaw: a.yaw,
    extentM: Math.max(L.shadowExtentM, dist + S.shadowMarginM), aheadM: 0 };
}
