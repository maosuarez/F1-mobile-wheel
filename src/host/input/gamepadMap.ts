import { config, type GameConfig } from '../../shared/config';
import type { DriverCommand, DriverInput } from '../../sim/types';
import { applyDeadzone } from './vrControllersMap';

// Lectura plana del mando (sin DOM) para que el mapeo sea testeable
export interface GamepadButtonState { pressed: boolean; value: number }
export interface GamepadState {
  axes: readonly number[];
  buttons: readonly GamepadButtonState[];
}
export type GamepadUiAction = 'pause' | 'camera' | 'recenter';

export interface GamepadMapResult {
  input: DriverInput;
  commands: DriverCommand[];
  ui: GamepadUiAction[];
  ers: boolean;
}

type PadCfg = GameConfig['gamepad'];

// Mapeo estándar (DualShock 4 / DualSense)
const BTN = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, options: 9 } as const;

export const EMPTY_GAMEPAD_STATE: GamepadState = { axes: [], buttons: [] };

const down = (s: GamepadState, i: number): boolean => s.buttons[i]?.pressed === true;
const rising = (s: GamepadState, p: GamepadState, i: number): boolean => down(s, i) && !down(p, i);
const analog = (s: GamepadState, i: number): number => {
  const b = s.buttons[i];
  return b ? (Number.isFinite(b.value) ? b.value : b.pressed ? 1 : 0) : 0;
};

// Mapeo puro mando → DriverInput + comandos y acciones de UI por flanco. Share (reinicio) lo gestiona la fuente
export function mapGamepad(state: GamepadState, prev: GamepadState, cfg: PadCfg = config.gamepad): GamepadMapResult {
  const x = state.axes[0];
  const xv = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
  const steer = Math.sign(xv) * Math.pow(applyDeadzone(Math.abs(xv), cfg.stickDeadzone), cfg.steerExpo);
  const ers = down(state, BTN.circle);

  const commands: DriverCommand[] = [];
  if (rising(state, prev, BTN.r1)) commands.push('shiftUp');
  if (rising(state, prev, BTN.l1)) commands.push('shiftDown');
  if (rising(state, prev, BTN.square)) commands.push('drs');

  const ui: GamepadUiAction[] = [];
  if (rising(state, prev, BTN.options)) ui.push('pause');
  if (rising(state, prev, BTN.triangle)) ui.push('camera');
  if (rising(state, prev, BTN.cross)) ui.push('recenter');

  return {
    input: {
      steer: steer === 0 ? 0 : steer,
      throttle: applyDeadzone(analog(state, BTN.r2), cfg.triggerDeadzone),
      brake: applyDeadzone(analog(state, BTN.l2), cfg.triggerDeadzone),
      ers,
    },
    commands, ui, ers,
  };
}
