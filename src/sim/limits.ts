import type { GameConfig } from '../shared/config';
import type { TrackLocation } from '../track/types';
import type { LapTimer } from './timing';
import type { CarState, SimEvent } from './types';

// Límites de pista: invalida la vuelta al superar el borde en más de marginM (design D3, skill f1-car-feel §7).
// Un evento por excursión; se rearma al volver dentro de los bordes.
export function stepLimits(car: CarState, loc: TrackLocation, timer: LapTimer, cfg: GameConfig, events: SimEvent[]): void {
  const m = cfg.limits.marginM;
  if (!car.offTrack) {
    if (loc.d > loc.wl + m || loc.d < -(loc.wr + m)) {
      car.offTrack = true;
      if (timer.state.lap >= 1) timer.invalidateLap();
      events.push({ type: 'limits' });
    }
  } else if (loc.d >= -loc.wr && loc.d <= loc.wl) {
    car.offTrack = false;
  }
}
