import { Autopilot } from '../../sim/autopilot';
import type { Track } from '../../track/types';
import { config, type GameConfig } from '../../shared/config';
import type { DriverCommand, DriverInput, SimState } from '../../sim/types';
import type { InputSource } from './types';

// Piloto de referencia como fuente de entrada
export class AutopilotSource implements InputSource {
  readonly name = 'autopilot' as const;
  private readonly ap: Autopilot;
  private pending: DriverCommand[] = [];

  constructor(track: Track, cfg: GameConfig = config) { this.ap = new Autopilot(track, cfg); }

  read(_dtS: number, state: SimState): DriverInput {
    const r = this.ap.update(state);
    this.pending.push(...r.commands);
    return r.input;
  }

  takeCommands(): DriverCommand[] {
    const c = this.pending;
    this.pending = [];
    return c;
  }
}
