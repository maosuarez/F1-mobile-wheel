import type { GameConfig } from '../../shared/config';
import type { FxKey } from '../../shared/protocol';
import type { CarState, SimEvent } from '../../sim/types';

// Planificador de háptica del PC (b5 design D4, spec haptic-feedback).
// Puntuales en cola (limits antes que shift) y continuos con temporizador (kerb, grass, limiter).
// Como máximo un fx por llamada y uno cada minGapMs.

type Continuous = 'kerb' | 'grass' | 'limiter';
const CONTINUOUS: readonly Continuous[] = ['kerb', 'grass', 'limiter'];

export class FxPlanner {
  private readonly f: GameConfig['fx'];
  private readonly queue: ('limits' | 'shift')[] = [];
  private readonly nextDue: Record<Continuous, number | null> = { kerb: null, grass: null, limiter: null };
  private lastSentMs = -Infinity;

  constructor(f: GameConfig['fx']) { this.f = f; }

  plan(events: readonly SimEvent[], car: CarState, nowMs: number): FxKey | null {
    // Un puntual de cada tipo por paso (p. ej. wallHit + limits en el mismo paso = un solo limits).
    let limits = false, shift = false;
    for (const e of events) {
      if (e.type === 'shift') shift = true;
      else if (e.type === 'shiftRejected' || e.type === 'limits' || e.type === 'wallHit') limits = true;
    }
    if (limits) this.queue.push('limits');
    if (shift) this.queue.push('shift');

    const moving = car.speed * 3.6 > this.f.minSpeedKmh;
    const active: Record<Continuous, boolean> = {
      kerb: moving && car.surface === 'kerb',
      grass: moving && car.surface === 'grass',
      limiter: moving && car.limiter,
    };
    for (const k of CONTINUOUS) {
      if (!active[k]) this.nextDue[k] = null;
      else if (this.nextDue[k] === null) this.nextDue[k] = nowMs;   // al entrar, en el primer hueco libre
    }

    if (nowMs - this.lastSentMs < this.f.minGapMs) return null;

    let out: FxKey | null = null;
    if (this.queue.length > 0) {
      out = this.queue.includes('limits') ? 'limits' : 'shift';
      this.queue.splice(this.queue.indexOf(out), 1);
    } else {
      let best: Continuous | null = null;
      for (const k of CONTINUOUS) {
        const due = this.nextDue[k];
        if (due !== null && due <= nowMs && (best === null || due < (this.nextDue[best] as number))) best = k;
      }
      if (best !== null) { out = best; this.nextDue[best] = nowMs + this.repeatMs(best); }
    }
    if (out !== null) this.lastSentMs = nowMs;
    return out;
  }

  private repeatMs(k: Continuous): number {
    return k === 'kerb' ? this.f.kerbRepeatMs : k === 'grass' ? this.f.grassRepeatMs : this.f.limiterRepeatMs;
  }
}
