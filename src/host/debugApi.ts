import type { DriverInput } from '../sim/types';

export interface DebugSnapshot {
  gameState: string; input: DriverInput; speedKmh: number; s: number; d: number; surface: string;
  lap: number; lapTimeS: number; lastLapS: number | null; lastLapValid: boolean; bestLapS: number | null; deltaS: number | null;
  fps: number; drawCalls: number; triangles: number; maxDrawCalls: number; maxTriangles: number; dpr: number;
  wallHits: number; simTimeS: number;
  room: string | null; wheelLink: string; rttMs: number | null;
  inputApplied: { steer: number; thr: number; brk: number; ers: boolean }; pauseReason: string | null;
}

// Expone window.__f1 (solo lectura) únicamente con ?debug=1
export function installDebugApi(snapshot: () => DebugSnapshot): void {
  const api = Object.freeze({ snapshot: () => JSON.parse(JSON.stringify(snapshot())) as DebugSnapshot });
  Object.defineProperty(window, '__f1', { value: api, writable: false, configurable: false, enumerable: true });
}
