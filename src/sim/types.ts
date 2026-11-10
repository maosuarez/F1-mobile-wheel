import type { Surface, TrackSide } from '../track/types';

// Tipos de la simulación (design D5).

export interface DriverInput { steer: number; throttle: number; brake: number; ers: boolean }   // steer [-1,1], pedales [0,1]
export type DriverCommand = 'shiftUp' | 'shiftDown' | 'drs';                                       // ignorados en este bloque

export const NEUTRAL_INPUT: DriverInput = { steer: 0, throttle: 0, brake: 0, ers: false };

export interface CarState {
  x: number; y: number; z: number; yaw: number; pitch: number; roll: number;
  vx: number; vz: number; speed: number; vLong: number; vLat: number; yawRate: number;
  steerAngle: number; throttle: number; brake: number;         // valores filtrados aplicados
  aLong: number; aLat: number;                                  // m/s² en ejes del coche
  slip: number;                                                 // 0..1 deslizamiento (ángulo de deriva normalizado / patinaje)
  s: number; d: number; trackIndex: number; surface: Surface; kerbSide: TrackSide | null;
}

export interface TimingState {
  lap: number; lapTimeS: number; lastLapS: number | null; lastLapValid: boolean;
  bestLapS: number | null; sector: 0 | 1 | 2; sectorTimesS: (number | null)[]; lastSectorTimesS: (number | null)[];
  lapValid: boolean; deltaS: number | null;
}

export type SimEvent =
  | { type: 'lapStart'; lap: number }
  | { type: 'lapEnd'; lap: number; timeS: number; valid: boolean; best: boolean }
  | { type: 'sector'; index: 0 | 1 | 2; timeS: number }
  | { type: 'wallHit'; speedMs: number }
  | { type: 'surface'; surface: Surface };

export interface SimState { t: number; stepCount: number; car: CarState; timing: TimingState }
