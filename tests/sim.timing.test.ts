import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { Simulation } from '../src/sim/simulation';
import { NEUTRAL_INPUT } from '../src/sim/types';
import type { SimEvent } from '../src/sim/types';
import { deltaS } from '../src/track/query';
import { makeOvalTrack } from '../src/track/synthetic';
import { full, place, runUntil } from './helpers/drive';

type LapEnd = Extract<SimEvent, { type: 'lapEnd' }>;
type SectorEv = Extract<SimEvent, { type: 'sector' }>;

// Sin arrastre ni rodadura: la velocidad que impone el test se mantiene exacta durante el paso.
const newSim = () => {
  const c = structuredClone(config);
  c.aero.cdA = 0;
  c.car.rollingCoef = 0;
  return new Simulation(makeOvalTrack(), c);
};

// Recorre `dist` metros desde sFrom moviendo el coche por la línea central a la velocidad v(s),
// recolocándolo antes de cada paso en su propio s (velocidad controlada por el test, posición continua).
function cruise(sim: Simulation, sFrom: number, dist: number, v: (s: number) => number, onStep?: () => void, backwards = false): { events: SimEvent[]; s: number } {
  const t = sim.track;
  const events: SimEvent[] = [];
  let done = 0;
  let s = sFrom;
  while (done < dist) {
    const vs = v(s);
    place(sim, s, 0, vs, backwards ? Math.PI : 0);
    events.push(...sim.step(NEUTRAL_INPUT));
    onStep?.();
    const sNew = sim.state.car.s;
    done += Math.abs(deltaS(t, s, sNew));
    s = sNew;
  }
  return { events, s };
}

const lapEnds = (ev: SimEvent[]) => ev.filter((e): e is LapEnd => e.type === 'lapEnd');

describe('Inicio y fin de vuelta', () => {
  it('antes del primer cruce: vuelta 0 y tiempo 0', () => {
    const sim = newSim();
    expect(sim.state.timing.lap).toBe(0);
    const ok = runUntil(sim, (st) => {
      if (st.timing.lap === 0) expect(st.timing.lapTimeS).toBe(0);
      return st.timing.lap === 1;
    }, full({ throttle: 1 }), 20);
    expect(ok).not.toBeNull();
  });

  it('precisión del tiempo de vuelta a velocidad constante', () => {
    const sim = newSim();
    const L = sim.track.length;
    const v = 47.3;
    const { events } = cruise(sim, L - 10, 2 * L + 20, () => v);
    const ends = lapEnds(events);
    expect(ends.length).toBe(2);
    for (const e of ends) expect(Math.abs(e.timeS - L / v)).toBeLessThan(0.005);
  });

  it('evento de fin de vuelta con número, tiempo, validez y mejor', () => {
    const sim = newSim();
    const L = sim.track.length;
    const { events } = cruise(sim, L - 10, L + 20, () => 50);
    const [e] = lapEnds(events);
    expect(e).toMatchObject({ type: 'lapEnd', lap: 1, valid: true, best: true });
    expect(e.timeS).toBeGreaterThan(0);
  });
});

describe('Vueltas completas únicamente', () => {
  it('marcha atrás sobre la meta', () => {
    const sim = newSim();
    const L = sim.track.length;
    let ev = cruise(sim, L - 10, 30, () => 20).events;            // cruza hacia delante: empieza vuelta 1
    expect(sim.state.timing.lap).toBe(1);
    const tStart = sim.state.t - sim.state.timing.lapTimeS;
    ev = ev.concat(cruise(sim, 20, 30, () => 20, undefined, true).events);   // retrocede cruzando la meta
    ev = ev.concat(cruise(sim, L - 10, 30, () => 20).events);     // vuelve a cruzar hacia delante
    expect(lapEnds(ev)).toEqual([]);
    expect(sim.state.timing.lap).toBe(1);
    expect(sim.state.t - sim.state.timing.lapTimeS).toBeCloseTo(tStart, 9);
  });

  it('atajo del sector 0 al sector 2', () => {
    const sim = newSim();
    const L = sim.track.length;
    let ev = cruise(sim, L - 10, 100, () => 40).events;             // vuelta 1, sector 0
    ev = ev.concat(cruise(sim, L - 50, 100, () => 40).events);      // teletransporte al sector 2 y cruce
    expect(lapEnds(ev)).toEqual([]);
  });
});

describe('Sectores', () => {
  it('la suma de sectores coincide con el tiempo de vuelta', () => {
    const sim = newSim();
    const L = sim.track.length;
    const { events } = cruise(sim, L - 10, L + 20, (s) => 30 + 20 * Math.sin(s / 200));
    const [e] = lapEnds(events);
    const sectors = events.filter((x): x is SectorEv => x.type === 'sector');
    expect(sectors.map((x) => x.index)).toEqual([0, 1, 2]);
    const sum = sectors.reduce((a, x) => a + x.timeS, 0);
    expect(Math.abs(sum - e.timeS)).toBeLessThan(0.001);
    expect(sim.state.timing.lastSectorTimesS.reduce((a, x) => a! + x!, 0)!).toBeCloseTo(e.timeS, 3);
  });

  it('evento de sector al cruzar sectors_s[0]', () => {
    const sim = newSim();
    const L = sim.track.length;
    cruise(sim, L - 10, 20, () => 40);
    const s0 = sim.track.sectorsS[0];
    const { events } = cruise(sim, sim.state.car.s, s0 - sim.state.car.s + 1, () => 40);
    const sec = events.filter((x): x is SectorEv => x.type === 'sector');
    expect(sec.length).toBe(1);
    expect(sec[0].index).toBe(0);
    expect(sim.state.timing.sector).toBe(1);
  });
});

describe('Mejor vuelta y validez', () => {
  // Completa vueltas consecutivas con los tiempos dados; `invalid` marca la vuelta i como inválida.
  function laps(times: number[], invalid: number[] = []) {
    const sim = newSim();
    const L = sim.track.length;
    let s = L - 10;
    const r1 = cruise(sim, s, 20, () => 40);
    s = r1.s;
    const ends: LapEnd[] = [];
    times.forEach((T, i) => {
      const v = L / T;
      let invalidated = false;
      const r = cruise(sim, s, L, () => v, () => {
        if (invalid.includes(i) && !invalidated && sim.state.timing.lapTimeS > 10) { sim.timer.invalidateLap(); invalidated = true; }
      });
      s = r.s;
      ends.push(...lapEnds(r.events));
    });
    return { sim, ends };
  }

  it('mejora: 80,0 y 78,5 ⇒ mejor 78,5', () => {
    const { sim, ends } = laps([80, 78.5]);
    expect(ends.length).toBe(2);
    expect(sim.state.timing.bestLapS!).toBeCloseTo(78.5, 1);
    expect(ends[1].best).toBe(true);
  });

  it('vuelta inválida más rápida no es mejor vuelta', () => {
    const { sim, ends } = laps([80, 78.5, 70], [2]);
    expect(ends.length).toBe(3);
    const st = sim.state.timing;
    expect(st.bestLapS!).toBeCloseTo(78.5, 1);
    expect(st.lastLapS!).toBeCloseTo(70, 1);
    expect(st.lastLapValid).toBe(false);
    expect(ends[2]).toMatchObject({ valid: false, best: false });
    expect(st.lapValid).toBe(true);
  });
});

describe('Delta en vivo', () => {
  it('sin referencia: delta no disponible', () => {
    const sim = newSim();
    const L = sim.track.length;
    cruise(sim, L - 10, L / 2, () => 40, () => expect(sim.state.timing.deltaS).toBeNull());
  });

  it('vuelta idéntica: delta en ±0,05 s', () => {
    const sim = newSim();
    const L = sim.track.length;
    const v = (s: number) => 35 + 15 * Math.cos(s / 300);
    let r = cruise(sim, L - 10, 10 + L, v);    // vuelta 1 de referencia
    expect(sim.state.timing.lap).toBe(2);
    let maxAbs = 0, samples = 0;
    r = cruise(sim, r.s, L - 5, v, () => {
      const d = sim.state.timing.deltaS;
      expect(d).not.toBeNull();
      maxAbs = Math.max(maxAbs, Math.abs(d!));
      samples++;
    });
    expect(samples).toBeGreaterThan(100);
    expect(maxAbs).toBeLessThanOrEqual(0.05);
  });

  it('vuelta un 10 % más lenta en el sector 0', () => {
    const sim = newSim();
    const L = sim.track.length;
    const s0 = sim.track.sectorsS[0];
    const v = 45;
    let r = cruise(sim, L - 10, 10 + L, () => v);
    expect(sim.state.timing.lap).toBe(2);
    let deltaEnd: number | null = null;
    r = cruise(sim, r.s, s0 - r.s - 0.5, () => 0.9 * v, () => { deltaEnd = sim.state.timing.deltaS; });
    const sectorTime = s0 / v;
    expect(deltaEnd).not.toBeNull();
    expect(deltaEnd!).toBeGreaterThan(0);
    expect(Math.abs(deltaEnd! / sectorTime - 0.1) / 0.1).toBeLessThanOrEqual(0.2);
  });
});
