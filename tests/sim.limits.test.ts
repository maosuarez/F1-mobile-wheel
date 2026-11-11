import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { Simulation } from '../src/sim/simulation';
import type { SimEvent } from '../src/sim/types';
import { NEUTRAL_INPUT } from '../src/sim/types';
import { deltaS } from '../src/track/query';
import { makeOvalTrack } from '../src/track/synthetic';
import { place } from './helpers/drive';

const V = 60;
const newSim = () => new Simulation(makeOvalTrack(), structuredClone(config));

// Recorre `dist` metros desde sFrom a velocidad V, recolocando el coche antes de cada paso en (s, d(s)).
function cruise(sim: Simulation, sFrom: number, dist: number, d: (s: number) => number): SimEvent[] {
  const events: SimEvent[] = [];
  let done = 0, s = sFrom;
  while (done < dist) {
    place(sim, s, d(s), V);
    events.push(...sim.step(NEUTRAL_INPUT));
    const sNew = sim.state.car.s;
    done += Math.abs(deltaS(sim.track, s, sNew));
    s = sNew;
  }
  return events;
}

const limits = (ev: SimEvent[]) => ev.filter((e) => e.type === 'limits').length;

// Cruza la meta para empezar la vuelta 1; devuelve la simulación en s ≈ 20.
function inLap1(): Simulation {
  const sim = newSim();
  cruise(sim, sim.track.length - 20, 40, () => 0);
  expect(sim.state.timing.lap).toBe(1);
  expect(sim.state.timing.lapValid).toBe(true);
  return sim;
}

describe('Invalidación por salida de pista', () => {
  it('d = wl + 1,2 durante la vuelta: inválida con evento de límites', () => {
    const sim = inLap1();
    const wl = sim.track.wl[0];
    const ev = cruise(sim, sim.state.car.s, 10, () => wl + 1.2);
    expect(sim.state.car.offTrack).toBe(true);
    expect(sim.state.timing.lapValid).toBe(false);
    expect(limits(ev)).toBe(1);
  });

  it('sobre el piano, d = wl + 0,8: la vuelta sigue siendo válida', () => {
    const sim = inLap1();
    const wl = sim.track.wl[0];
    const ev = cruise(sim, sim.state.car.s, 100, () => wl + 0.8);
    expect(sim.state.timing.lapValid).toBe(true);
    expect(limits(ev)).toBe(0);
  });

  it('un evento por excursión; otro solo tras volver dentro de los bordes y salir de nuevo', () => {
    const sim = inLap1();
    const wl = sim.track.wl[0];
    let ev = cruise(sim, sim.state.car.s, 2 * V, () => wl + 2);   // 2 s fuera
    expect(limits(ev)).toBe(1);
    ev = cruise(sim, sim.state.car.s, 10, () => wl + 0.5);        // entre el borde y el margen: no rearma
    ev.push(...cruise(sim, sim.state.car.s, 10, () => wl + 2));
    expect(limits(ev)).toBe(0);
    ev = cruise(sim, sim.state.car.s, 10, () => 0);               // dentro: rearma
    ev.push(...cruise(sim, sim.state.car.s, 10, () => wl + 2));
    expect(limits(ev)).toBe(1);
  });
});

describe('Consecuencias de la vuelta inválida', () => {
  it('vuelta inválida más rápida que la mejor: la mejor no cambia y la última queda inválida', () => {
    const sim = inLap1();
    sim.timer.setBestLap(1000);
    const wl = sim.track.wl[0];
    const L = sim.track.length;
    const ev = cruise(sim, sim.state.car.s, L, (s) => (s > 100 && s < 120 ? wl + 1.5 : 0));
    const end = ev.find((e) => e.type === 'lapEnd');
    expect(end).toMatchObject({ type: 'lapEnd', lap: 1, valid: false, best: false });
    expect(sim.state.timing.bestLapS).toBe(1000);
    expect(sim.state.timing.lastLapValid).toBe(false);
    // Nueva vuelta: empieza válida
    expect(sim.state.timing.lap).toBe(2);
    expect(sim.state.timing.lapValid).toBe(true);
  });

  it('antes de la primera vuelta no se invalida nada y la vuelta 1 empieza válida', () => {
    const sim = newSim();
    const wl = sim.track.wl[0];
    const L = sim.track.length;
    cruise(sim, L - 200, 50, () => wl + 2);
    expect(sim.state.timing.lap).toBe(0);
    expect(sim.state.car.offTrack).toBe(true);
    cruise(sim, sim.state.car.s, 200, () => 0);
    expect(sim.state.timing.lap).toBe(1);
    expect(sim.state.timing.lapValid).toBe(true);
  });
});
