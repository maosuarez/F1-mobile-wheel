import { config, type GameConfig } from '../../shared/config';
import { NEUTRAL_INPUT, type DriverCommand, type DriverInput, type SimState } from '../../sim/types';
import { holdDetector, type HoldDetector } from '../../shared/hold';
import type { FxKey } from '../../shared/protocol';
import type { WheelLink } from '../net/wheelSource';
import type { InputSource } from './types';
import { EMPTY_GAMEPAD_STATE, mapGamepad, type GamepadState, type GamepadUiAction } from './gamepadMap';

// Lo mínimo de un Gamepad del DOM; permite simular el mando en Node
export interface GamepadLike {
  readonly mapping: string;
  readonly connected: boolean;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
  readonly vibrationActuator?: object | null;
}
export type GamepadProvider = () => ArrayLike<GamepadLike | null>;
export type GamepadEvent = GamepadUiAction | 'restart';

const SHARE = 8;

// Pulsos de vibración por evento de fx (design D5): duración en ms y magnitudes 0..1
const RUMBLE: Record<FxKey, { duration: number; weakMagnitude: number; strongMagnitude: number }> = {
  kerb: { duration: 60, weakMagnitude: 0.6, strongMagnitude: 0.2 },
  grass: { duration: 80, weakMagnitude: 0.3, strongMagnitude: 0.4 },
  limits: { duration: 120, weakMagnitude: 0.4, strongMagnitude: 0.9 },
  shift: { duration: 40, weakMagnitude: 0.2, strongMagnitude: 0.5 },
  limiter: { duration: 50, weakMagnitude: 0.7, strongMagnitude: 0.1 },
};

// Primer mando conectado con mapeo estándar
export function findStandardPad(list: ArrayLike<GamepadLike | null>): GamepadLike | null {
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p && p.connected && p.mapping === 'standard') return p;
  }
  return null;
}

const snapshot = (p: GamepadLike): GamepadState => ({
  axes: Array.from(p.axes),
  buttons: Array.from(p.buttons, (b) => ({ pressed: b.pressed, value: b.value })),
});

// Mando USB como fuente (design D2). pollUi() lee el mando una vez por fotograma (también en pausa);
// read() devuelve la última lectura y takeCommands() las órdenes acumuladas por flanco
export class GamepadSource implements InputSource {
  readonly name = 'gamepad' as const;
  private prev: GamepadState = EMPTY_GAMEPAD_STATE;
  private input: DriverInput = NEUTRAL_INPUT;
  private pending: DriverCommand[] = [];
  private present = false;
  private readonly hold: HoldDetector = holdDetector(config.race.restartHoldMs);

  constructor(private readonly provider: GamepadProvider, private readonly cfg: GameConfig['gamepad'] = config.gamepad) {}

  // true si en la última lectura había un mando estándar conectado
  connected(): boolean { return this.present; }

  pollUi(dtMs = 0): GamepadEvent[] {
    let pad: GamepadLike | null = null;
    try { pad = findStandardPad(this.provider() ?? []); } catch { pad = null; }
    this.present = pad !== null;
    if (!pad) {
      this.prev = EMPTY_GAMEPAD_STATE;
      this.input = NEUTRAL_INPUT;
      this.hold.reset();
      return [];
    }
    const state = snapshot(pad);
    const r = mapGamepad(state, this.prev, this.cfg);
    this.prev = state;
    this.input = r.input;
    this.pending.push(...r.commands);
    const ev: GamepadEvent[] = [...r.ui];
    if (this.hold.update(state.buttons[SHARE]?.pressed === true, dtMs)) ev.push('restart');
    return ev;
  }

  // Vibración del mando; sin actuador o ante cualquier fallo no hace nada
  rumble(kind: FxKey): void {
    try {
      const pad = findStandardPad(this.provider() ?? []);
      const fx = RUMBLE[kind];
      const act = pad?.vibrationActuator as { playEffect?: (t: string, p: object) => unknown } | null | undefined;
      const r = act?.playEffect?.('dual-rumble', { startDelay: 0, ...fx });
      if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {});
    } catch { /* sin vibración */ }
  }

  read(_dtS: number, _state?: SimState): DriverInput { return this.input; }

  takeCommands(): DriverCommand[] { const c = this.pending; this.pending = []; return c; }

  reset(): void { this.pending = []; this.input = NEUTRAL_INPUT; this.hold.reset(); }
}

// Prioridad (design D4): volante > mandos VR > gamepad > teclado. El gamepad solo sustituye al teclado
// (nunca al volante, a los mandos VR ni al piloto automático) y lo devuelve al dejar de poder conducir
export const gamepadCanDrive = (hasPad: boolean, wheelLink: WheelLink, inVr: boolean): boolean =>
  hasPad && !inVr && wheelLink !== 'ok' && wheelLink !== 'stale';

export function nextGamepadSource(current: InputSource, keyboard: InputSource, gamepad: InputSource,
  hasPad: boolean, wheelLink: WheelLink, inVr: boolean): InputSource | null {
  const can = gamepadCanDrive(hasPad, wheelLink, inVr);
  if (can && current === keyboard) return gamepad;
  if (!can && current === gamepad) return keyboard;
  return null;
}
