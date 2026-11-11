import type { SimEvent, SimState } from '../sim/types';

const LIMITS_S = 3;
const REJECT_S = 1;

// Aviso prioritario único: MOTOR (mientras dure el sobrecalentamiento) > LÍMITES (3 s) > REDUCCIÓN (1 s)
export class WarningCenter {
  private limitsUntil = -Infinity;
  private rejectUntil = -Infinity;

  push(e: SimEvent, tS: number): void {
    if (e.type === 'limits') this.limitsUntil = tS + LIMITS_S;
    else if (e.type === 'shiftRejected') this.rejectUntil = tS + REJECT_S;
  }

  current(state: SimState, tS: number): string {
    if (state.car.overheated) return 'MOTOR';
    if (tS < this.limitsUntil) return 'LÍMITES';
    if (tS < this.rejectUntil) return 'REDUCCIÓN';
    return '';
  }

  reset(): void { this.limitsUntil = this.rejectUntil = -Infinity; }
}
