import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { aeroFactors } from '../src/sim/drs';
import { Simulation } from '../src/sim/simulation';
import type { SimEvent } from '../src/sim/types';
import type { Track } from '../src/track/types';
import { makeStraightTrack } from '../src/track/synthetic';
import { full, holdSpeed, kmh, ms, place, runFor, runUntil } from './helpers/drive';

// Toda la potencia disponible (batería y límite por vuelta prácticamente ilimitados).
const cfg = () => {
  const c = structuredClone(config);
  c.ers.capacityMJ = 1e6;
  c.ers.lapDeployLimitMJ = 1e6;
  return c;
};
const T = full({ throttle: 1 });

// Recta sintética con una zona DRS añadida en el test.
function straightWithZone(start: number, end: number, o: { lengthM?: number; halfWidthM?: number } = {}): Track {
  const t = makeStraightTrack({ lengthM: o.lengthM ?? 14000, halfWidthM: o.halfWidthM ?? 8 });
  t.drsZones = [{ detect_s: start - 50, start_s: start, end_s: end }];
  return t;
}

function sim(track: Track, s: number, v: number): Simulation {
  const si = new Simulation(track, cfg());
  place(si, s, 0, v);
  si.state.car.throttle = 1;
  return si;
}

const drsEvents = (ev: SimEvent[]) => ev.filter((e) => e.type === 'drs');

// Coloca el coche en zona con el DRS abierto.
function openInZone(): Simulation {
  const si = sim(straightWithZone(500, 3000), 1000, ms(250));
  si.step(T);
  expect(si.state.car.drs).toBe(1);
  si.step(T, ['drs']);
  expect(si.state.car.drs).toBe(2);
  return si;
}

describe('Disponibilidad por zonas', () => {
  it('al entrar en la zona el estado pasa de 0 a 1', () => {
    const si = sim(straightWithZone(500, 1500), 400, ms(200));
    si.step(T);
    expect(si.state.car.drs).toBe(0);
    runUntil(si, (st) => st.car.s >= 500, T, 5);
    si.step(T);
    expect(si.state.car.drs).toBe(1);
  });

  it('fuera de zona la orden no tiene efecto y la aerodinámica no cambia', () => {
    const si = sim(straightWithZone(500, 1500), 100, ms(200));
    const ev = si.step(T, ['drs']);
    expect(si.state.car.drs).toBe(0);
    expect(drsEvents(ev)).toEqual([]);
    expect(aeroFactors(si.state.car, si.cfg)).toEqual({ cda: 1, cla: 1 });
  });
});

describe('Apertura manual', () => {
  it('con estado 1, la orden abre (2) con evento de apertura', () => {
    const si = sim(straightWithZone(500, 3000), 1000, ms(250));
    si.step(T);
    const ev = si.step(T, ['drs']);
    expect(si.state.car.drs).toBe(2);
    expect(drsEvents(ev)).toEqual([{ type: 'drs', open: true }]);
    expect(aeroFactors(si.state.car, si.cfg)).toEqual({ cda: config.drs.cdaFactor, cla: config.drs.claFactor });
  });

  it('con estado 2, la orden cierra (1)', () => {
    const si = openInZone();
    si.step(T, ['drs']);
    expect(si.state.car.drs).toBe(1);
  });
});

describe('Efecto aerodinámico', () => {
  it('velocidad punta con DRS abierto entre 8 y 18 km/h mayor (recta toda zona DRS)', () => {
    const top = (open: boolean) => {
      const si = sim(straightWithZone(0, 14000), 50, 0);
      si.step(T, open ? ['drs'] : []);
      expect(si.state.car.drs).toBe(open ? 2 : 1);
      runFor(si, 70, T);
      expect(si.state.car.drs).toBe(open ? 2 : 1);
      return kmh(si.state.car.speed);
    };
    const diff = top(true) - top(false);
    expect(diff).toBeGreaterThanOrEqual(8);
    expect(diff).toBeLessThanOrEqual(18);
  });

  it('aceleración lateral máxima a 250 km/h entre un 2 % y un 10 % menor con DRS abierto', () => {
    const lat = (open: boolean) => {
      const si = new Simulation(straightWithZone(0, 6000, { lengthM: 6000, halfWidthM: 400 }), cfg());
      place(si, 3000, -150, ms(250));
      si.step(holdSpeed(ms(250), -1)(si.state), open ? ['drs'] : []);
      runFor(si, 3, holdSpeed(ms(250), -1));
      let sum = 0, n = 0;
      runFor(si, 1, holdSpeed(ms(250), -1), (st) => { sum += Math.abs(st.car.aLat); n++; });
      expect(si.state.car.drs).toBe(open ? 2 : 1);
      expect(Math.abs(kmh(si.state.car.speed) - 250)).toBeLessThan(5);
      return sum / n;
    };
    const ratio = lat(true) / lat(false);
    expect(ratio).toBeGreaterThanOrEqual(0.9);
    expect(ratio).toBeLessThanOrEqual(0.98);
  });
});

describe('Cierre automático', () => {
  it('al pisar el freno al 30 % se cierra en el siguiente paso con evento', () => {
    const si = openInZone();
    const ev = si.step(full({ brake: 0.3 }));
    expect(si.state.car.drs).not.toBe(2);
    expect(drsEvents(ev)).toEqual([{ type: 'drs', open: false }]);
  });

  it('al cruzar end_s con el DRS abierto pasa a 0', () => {
    const si = openInZone();
    runUntil(si, (st) => st.car.s > 3000, T, 30);
    si.step(T);
    expect(si.state.car.drs).toBe(0);
  });

  it('reapertura en la misma zona tras cerrarse por freno', () => {
    const si = openInZone();
    si.step(full({ brake: 0.3 }));
    expect(si.state.car.drs).toBe(1);
    si.step(T);
    si.step(T, ['drs']);
    expect(si.state.car.drs).toBe(2);
  });
});
