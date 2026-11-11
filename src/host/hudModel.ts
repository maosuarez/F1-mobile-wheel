import { formatDelta, formatLapTime } from './format';
import type { SimState } from '../sim/types';

export type SectorMark = 'none' | 'slower' | 'better';

export interface HudModel {
  speed: string; gear: string;
  ledsOn: number; blink: boolean;
  drs: 0 | 1 | 2; ersPct: number; ersText: string; overtake: boolean; auto: boolean;
  warn: string;
  lap: string; lapTime: string; lapTimeInvalid: boolean; last: string; lastInvalid: boolean; best: string;
  delta: string; deltaTone: 'neg' | 'pos' | 'none';
  sectors: [SectorMark, SectorMark, SectorMark];
}

export const LED_COUNT = 15;

export function gearLabel(g: number): string { return g < 0 ? 'R' : g === 0 ? 'N' : String(Math.min(8, g)); }

// Un sector completado es mejora si no supera el mejor sector propio (que ya puede incluirlo); sin mejor previo, cuenta como mejora
function mark(t: number | null | undefined, best: number | null | undefined): SectorMark {
  if (t === null || t === undefined) return 'none';
  if (best === null || best === undefined) return 'better';
  return t <= best + 1e-6 ? 'better' : 'slower';
}

// Función pura: textos y estados ya formateados para el HUD
export function hudModel(state: SimState, warn: string, bestSectors: readonly (number | null)[], autoShift = true): HudModel {
  const c = state.car, t = state.timing;
  const ledsRaw = Math.round(c.leds);
  const blink = ledsRaw >= LED_COUNT + 1;
  const ledsOn = blink ? LED_COUNT : Math.max(0, Math.min(LED_COUNT, ledsRaw));
  const ersPct = Math.round(Math.max(0, Math.min(1, c.ersCharge)) * 100);
  const delta = formatDelta(t.deltaS);
  // Justo tras cruzar la meta el sector 3 aún se muestra desde la vuelta anterior
  const justStarted = t.sector === 0 && t.lapTimeS < 3;
  const sec = (i: 0 | 1 | 2): SectorMark => {
    const cur = t.sectorTimesS[i];
    if (cur !== null && cur !== undefined) return mark(cur, bestSectors[i]);
    return i === 2 && justStarted ? mark(t.lastSectorTimesS[2], bestSectors[2]) : 'none';
  };
  return {
    speed: String(Math.round(Math.max(0, c.speed * 3.6))),
    gear: gearLabel(c.gear),
    ledsOn, blink,
    drs: c.drs, ersPct, ersText: `${ersPct}%`, overtake: c.overtake, auto: autoShift,
    warn,
    lap: String(t.lap),
    lapTime: formatLapTime(t.lapTimeS), lapTimeInvalid: !t.lapValid,
    last: formatLapTime(t.lastLapS), lastInvalid: t.lastLapS !== null && !t.lastLapValid,
    best: formatLapTime(t.bestLapS),
    delta, deltaTone: t.deltaS === null || delta === '' ? 'none' : t.deltaS < 0 ? 'neg' : 'pos',
    sectors: [sec(0), sec(1), sec(2)],
  };
}
