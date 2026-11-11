import type { FxKey } from '../shared/protocol';
import type { DriverInput } from '../sim/types';

export interface DebugSnapshot {
  gameState: string; input: DriverInput; speedKmh: number; s: number; d: number; surface: string;
  lap: number; lapTimeS: number; lastLapS: number | null; lastLapValid: boolean; bestLapS: number | null; deltaS: number | null;
  fps: number; drawCalls: number; triangles: number; maxDrawCalls: number; maxTriangles: number; dpr: number;
  wallHits: number; simTimeS: number;
  room: string | null; wheelLink: string; rttMs: number | null;
  gear: number; rpm: number; leds: number; drs: number; ers: number; ot: boolean; autoShift: boolean; lapValid: boolean; warn: string; overheated: boolean;
  inputApplied: { steer: number; thr: number; brk: number; ers: boolean }; pauseReason: string | null;
  audio: { state: string; f0Hz: number; rms: number; peak: number } | null;
  camera: { mode: string; fovDeg: number; shakeM: number; pos: [number, number, number]; tvIndex: number };
  fxSent: Record<FxKey, number>;
  // Render y calidad (b6, design D8)
  quality: string; rendererName: string; shadowLights: number; shadowMapSize: number; post: boolean;
  particlesActive: number; fpsAvg: number; fpsP5: number; carDrawCalls: number; carTriangles: number; envDrawCalls: number;
}

// Expone window.__f1 (solo lectura) únicamente con ?debug=1
// Región en píxeles del canvas (origen arriba a la izquierda); lum en 0..1, white/black = fracción de píxeles puros
export interface PixelRegion { x: number; y: number; w: number; h: number }
export interface PixelStats { lum: number; white: number; black: number }

function readPixels(canvas: HTMLCanvasElement, r: PixelRegion): PixelStats {
  const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
  const w = Math.min(canvas.width - x, Math.floor(r.w)), h = Math.min(canvas.height - y, Math.floor(r.h));
  if (w <= 0 || h <= 0) return { lum: 0, white: 0, black: 0 };
  const c2 = document.createElement('canvas');
  c2.width = w; c2.height = h;
  const ctx = c2.getContext('2d')!;
  ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  let lum = 0, white = 0, black = 0;
  const n = w * h;
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    lum += l;
    if (d[i] >= 250 && d[i + 1] >= 250 && d[i + 2] >= 250) white++;
    else if (d[i] <= 5 && d[i + 1] <= 5 && d[i + 2] <= 5) black++;
  }
  return { lum: lum / n, white: white / n, black: black / n };
}

export function installDebugApi(snapshot: () => DebugSnapshot, canvas?: HTMLCanvasElement): void {
  const api = Object.freeze({
    snapshot: () => JSON.parse(JSON.stringify(snapshot())) as DebugSnapshot,
    pixels: (region: PixelRegion): PixelStats | null => (canvas ? readPixels(canvas, region) : null),
  });
  Object.defineProperty(window, '__f1', { value: api, writable: false, configurable: false, enumerable: true });
}
