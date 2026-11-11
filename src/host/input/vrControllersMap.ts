import { config, type GameConfig } from '../../shared/config';
import type { DriverCommand, DriverInput } from '../../sim/types';

// Lectura plana de los mandos (sin WebXR) para que el mapeo sea testeable
export interface VrControllersState {
  rightTrigger: number;          // gamepad.buttons[0].value del mando derecho, 0..1
  leftTrigger: number;           // gamepad.buttons[0].value del mando izquierdo, 0..1
  rightRollRad: number | null;   // roll del grip derecho (positivo = girado a la derecha); null sin pose
  prevSteer: number;             // dirección aplicada en el paso anterior (estado de la rampa)
}

type VrCfg = GameConfig['vr'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Zona muerta con reescalado: el pedal parte de 0 justo al salir de la zona muerta
export const applyDeadzone = (v: number, dz: number): number => {
  const x = clamp(Number.isFinite(v) ? v : 0, 0, 1);
  return x <= dz ? 0 : clamp((x - dz) / (1 - dz), 0, 1);
};

// Roll alrededor del eje longitudinal (-Z) a partir del cuaternión de la pose:
// atan2(-X'.y, Y'.y), con X' e Y' los ejes locales rotados. Positivo = giro horario visto desde atrás
export const rollFromQuaternion = (x: number, y: number, z: number, w: number): number => {
  const xAxisY = 2 * (x * y + w * z);
  const yAxisY = 1 - 2 * (x * x + z * z);
  return Math.atan2(-xAxisY, yAxisY);
};

// Mapeo puro mandos → DriverInput; la dirección pasa por una rampa de config.vr.steerRampPerS
export function mapControllers(state: VrControllersState, dtS: number, cfg: VrCfg): DriverInput {
  const target = state.rightRollRad === null || !Number.isFinite(state.rightRollRad)
    ? 0 : clamp(state.rightRollRad / cfg.steerRangeRad, -1, 1);
  const step = cfg.steerRampPerS * Math.max(0, dtS);
  const prev = clamp(state.prevSteer, -1, 1);
  const steer = prev < target ? Math.min(prev + step, target) : Math.max(prev - step, target);
  return {
    steer,
    throttle: applyDeadzone(state.rightTrigger, cfg.triggerDeadzone),
    brake: applyDeadzone(state.leftTrigger, cfg.triggerDeadzone),
    ers: false,
  };
}

// Palanca analógica como cambio secuencial: un gesto = una orden, con histéresis
export interface StickShiftState { latched: boolean }

// y = gamepad.axes[3] (negativo = hacia delante → shiftUp; positivo = hacia atrás → shiftDown)
export function stickShiftEdges(prev: StickShiftState, y: number, cfg: Pick<VrCfg, 'stickShiftOn' | 'stickShiftOff'> = config.vr):
  { state: StickShiftState; cmd: DriverCommand | null } {
  const v = Number.isFinite(y) ? y : 0;
  if (prev.latched) return { state: { latched: Math.abs(v) >= cfg.stickShiftOff }, cmd: null };
  if (Math.abs(v) >= cfg.stickShiftOn) return { state: { latched: true }, cmd: v < 0 ? 'shiftUp' : 'shiftDown' };
  return { state: prev, cmd: null };
}
