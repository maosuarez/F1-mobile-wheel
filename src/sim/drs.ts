import type { GameConfig } from '../shared/config';
import { drsZoneAt } from '../track/query';
import type { Track } from '../track/types';
import type { CarState, DriverCommand, DriverInput, SimEvent } from './types';

// DRS: disponible en zona, apertura y cierre manual, cierre automático al frenar o salir (design D3, skill f1-car-feel §6).

export function stepDrs(car: CarState, input: DriverInput, commands: readonly DriverCommand[], track: Track,
                        cfg: GameConfig, events: SimEvent[]): void {
  if (drsZoneAt(track, car.s) < 0) {
    if (car.drs === 2) events.push({ type: 'drs', open: false });
    car.drs = 0;
    return;
  }
  if (car.drs === 0) car.drs = 1;
  for (const c of commands) {
    if (c !== 'drs') continue;
    if (car.drs === 1) { car.drs = 2; events.push({ type: 'drs', open: true }); }
    else { car.drs = 1; events.push({ type: 'drs', open: false }); }
  }
  if (car.drs === 2 && input.brake > cfg.drs.brakeClose) {
    car.drs = 1;
    events.push({ type: 'drs', open: false });
  }
}

// Factores de arrastre y carga según el estado del DRS.
export function aeroFactors(car: CarState, cfg: GameConfig): { cda: number; cla: number } {
  return car.drs === 2 ? { cda: cfg.drs.cdaFactor, cla: cfg.drs.claFactor } : { cda: 1, cla: 1 };
}
