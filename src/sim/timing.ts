import type { GameConfig } from '../shared/config';
import { deltaS, wrapS } from '../track/query';
import type { Track } from '../track/types';
import type { SimEvent, TimingState } from './types';

// Cronómetro de vueltas y sectores con delta en vivo (design D5, skill f1-car-feel §8).

function initialState(): TimingState {
  return {
    lap: 0, lapTimeS: 0, lastLapS: null, lastLapValid: true, bestLapS: null,
    sector: 0, sectorTimesS: [null, null, null], lastSectorTimesS: [null, null, null],
    lapValid: true, deltaS: null,
  };
}

export class LapTimer {
  readonly state: TimingState = initialState();
  private lapStartT = 0;
  private sectorStartT = 0;
  private trace: number[] = [];           // tiempo transcurrido cada traceStepM en la vuelta en curso
  private refTrace: number[] | null = null; // traza de la mejor vuelta válida de la sesión
  private sessionBestS: number | null = null;

  constructor(private readonly track: Track, private readonly cfg: GameConfig) {}

  // Fracción del paso en la que se cruza la frontera b hacia delante, o −1 si no se cruza.
  private crossFrac(sPrev: number, s: number, b: number): number {
    const t = this.track;
    const ds = deltaS(t, sPrev, s);
    if (ds <= 0 || ds >= t.length / 4) return -1;
    const a = t.closed ? wrapS(t, b - sPrev) : b - sPrev;
    if (a > 0 && a <= ds) return a / ds;
    return -1;
  }

  update(sPrev: number, s: number, tPrev: number, t: number, events: SimEvent[]): void {
    const st = this.state;
    const tr = this.track;
    const at = (f: number) => tPrev + f * (t - tPrev);

    // Fronteras cruzadas en este paso, ordenadas por instante
    const crossings: { f: number; kind: 'start' | 0 | 1 }[] = [];
    const fs = this.crossFrac(sPrev, s, tr.startS);
    if (fs >= 0) crossings.push({ f: fs, kind: 'start' });
    const f0 = this.crossFrac(sPrev, s, tr.sectorsS[0]);
    if (f0 >= 0) crossings.push({ f: f0, kind: 0 });
    const f1 = this.crossFrac(sPrev, s, tr.sectorsS[1]);
    if (f1 >= 0) crossings.push({ f: f1, kind: 1 });
    crossings.sort((a, b) => a.f - b.f);

    // Traza para el delta (antes de procesar el cruce de meta)
    if (st.lap >= 1) this.recordTrace(sPrev, s, tPrev, t);

    for (const c of crossings) {
      const tc = at(c.f);
      if (c.kind === 'start') {
        if (st.lap === 0) {
          this.startLap(tc, 1, events);
        } else if (st.sector === 2) {
          const s2 = tc - this.sectorStartT;
          st.sectorTimesS[2] = s2;
          events.push({ type: 'sector', index: 2, timeS: s2 });
          const timeS = tc - this.lapStartT;
          const valid = st.lapValid;
          const best = valid && (st.bestLapS === null || timeS < st.bestLapS);
          if (best) st.bestLapS = timeS;
          if (valid && (this.sessionBestS === null || timeS < this.sessionBestS)) {
            this.sessionBestS = timeS;
            this.refTrace = this.trace.slice();
          }
          st.lastLapS = timeS;
          st.lastLapValid = valid;
          st.lastSectorTimesS = st.sectorTimesS.slice();
          events.push({ type: 'lapEnd', lap: st.lap, timeS, valid, best });
          this.startLap(tc, st.lap + 1, events);
          // Traza de la nueva vuelta desde la meta hasta s
          this.recordTrace(tr.startS, s, tc, t);
        }
        // Cruce sin haber visitado los sectores en orden: no cuenta ni reinicia
      } else if (st.lap >= 1 && c.kind === st.sector) {
        const timeS = tc - this.sectorStartT;
        st.sectorTimesS[c.kind] = timeS;
        events.push({ type: 'sector', index: c.kind, timeS });
        st.sector = (c.kind + 1) as 1 | 2;
        this.sectorStartT = tc;
      }
    }

    st.lapTimeS = st.lap >= 1 ? t - this.lapStartT : 0;
    st.deltaS = this.computeDelta(s, st.lapTimeS);
  }

  private startLap(tc: number, lap: number, events: SimEvent[]): void {
    const st = this.state;
    st.lap = lap;
    st.sector = 0;
    st.sectorTimesS = [null, null, null];
    st.lapValid = true;
    this.lapStartT = tc;
    this.sectorStartT = tc;
    this.trace = [0];
    events.push({ type: 'lapStart', lap });
  }

  // Distancia recorrida desde la meta en la vuelta en curso.
  private lapDist(s: number): number {
    const t = this.track;
    return t.closed ? wrapS(t, s - t.startS) : s - t.startS;
  }

  private recordTrace(sPrev: number, s: number, tPrev: number, t: number): void {
    const step = this.cfg.timing.traceStepM;
    const d0 = this.lapDist(sPrev);
    const ds = deltaS(this.track, sPrev, s);
    if (ds <= 0 || ds >= this.track.length / 4) return;
    const d1 = d0 + ds;
    for (let k = this.trace.length; k * step <= d1; k++) {
      const dk = k * step;
      if (dk < d0) { this.trace.length = 0; break; }   // traza incoherente (salto hacia atrás)
      const tk = tPrev + ((dk - d0) / ds) * (t - tPrev);
      this.trace.push(tk - this.lapStartT);
    }
  }

  private computeDelta(s: number, elapsed: number): number | null {
    const ref = this.refTrace;
    if (ref === null || this.state.lap < 1 || ref.length < 2) return null;
    const step = this.cfg.timing.traceStepM;
    const pos = this.lapDist(s) / step;
    const k = Math.floor(pos);
    if (k + 1 >= ref.length) return elapsed - ref[ref.length - 1];
    const refT = ref[k] + (ref[k + 1] - ref[k]) * (pos - k);
    return elapsed - refT;
  }

  invalidateLap(): void {
    this.state.lapValid = false;
  }

  setBestLap(timeS: number | null): void {
    this.state.bestLapS = timeS;
  }

  // Vuelve al estado previo a la primera vuelta; conserva la mejor vuelta y su traza de la sesión.
  reset(): void {
    const best = this.state.bestLapS;
    Object.assign(this.state, initialState());
    this.state.bestLapS = best;
    this.lapStartT = 0;
    this.sectorStartT = 0;
    this.trace = [];
  }
}
