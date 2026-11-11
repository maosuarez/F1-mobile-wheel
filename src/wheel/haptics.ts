import type { GameConfig } from '../shared/config';
import type { FxKey } from '../shared/protocol';

// Vibración háptica (design D5). vibrate y reloj inyectados para poder probarla sin DOM.
export class Haptics {
  enabled = true;
  private lastMs = -Infinity;

  constructor(
    private readonly h: GameConfig['wheel']['haptics'],
    private readonly vibrate: (p: number | number[]) => void,
    private readonly now: () => number,
    readonly supported: boolean = true,
  ) {}

  trigger(k: FxKey): void {
    if (!this.supported || !this.enabled) return;
    const pattern = this.h.patterns[k];
    if (!pattern) return;
    const t = this.now();
    if (t - this.lastMs < this.h.minGapMs) return;               // como máximo una llamada cada minGapMs
    this.lastMs = t;
    this.vibrate(pattern);
  }
}
