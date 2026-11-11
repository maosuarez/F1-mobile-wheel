import type { DriverCommand, DriverInput, SimState } from '../../sim/types';

export interface InputSource {
  readonly name: 'keyboard' | 'autopilot' | 'wheel' | 'controllers' | 'gamepad';
  read(dtS: number, state: SimState): DriverInput;
  takeCommands(): DriverCommand[];
}
