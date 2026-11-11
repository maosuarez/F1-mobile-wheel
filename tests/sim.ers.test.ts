import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { Simulation } from '../src/sim/simulation';
import { makeOvalTrack, makeStraightTrack } from '../src/track/synthetic';
import { full, holdSpeed, kmh, ms, place, runFor, runUntil } from './helpers/drive';

const cfg = () => structuredClone(config);
const T = full({ throttle: 1 });
const OT = full({ throttle: 1, ers: true });

function straight(o: { v?: number; charge?: number; throttle?: number } = {}): Simulation {
  const si = new Simulation(makeStraightTrack({ lengthM: 14000, halfWidthM: 8 }), cfg());
  place(si, 50, 0, o.v ?? 0);
  si.state.car.ersCharge = o.charge ?? 1;
  si.state.car.throttle = o.throttle ?? 0;
  return si;
}

// Óvalo con el coche a 20 m de la meta, por la recta, a 50 m/s.
function nearLine(charge: number): Simulation {
  const si = new Simulation(makeOvalTrack(), cfg());
  place(si, si.track.length - 20, 0, 50);
  si.state.car.ersCharge = charge;
  return si;
}

describe('Batería y despliegue base', () => {
  it('a fondo 10 s con batería llena: baja entre 0,25 y 0,35', () => {
    const si = straight();
    runFor(si, 10, T);
    const drop = 1 - si.state.car.ersCharge;
    expect(drop).toBeGreaterThanOrEqual(0.25);
    expect(drop).toBeLessThanOrEqual(0.35);
    expect(si.state.car.overtake).toBe(false);
  });

  it('a medio gas 10 s: la batería no baja', () => {
    const si = straight({ charge: 0.8 });
    runFor(si, 10, full({ throttle: 0.5 }));
    expect(si.state.car.ersCharge).toBe(0.8);
    expect(si.state.car.ersDeployKw).toBe(0);
  });

  it('batería agotada: velocidad punta entre 295 y 315 km/h', () => {
    const si = straight({ charge: 0 });
    runFor(si, 70, T);
    const v = kmh(si.state.car.speed);
    expect(si.state.car.ersCharge).toBe(0);
    expect(v).toBeGreaterThanOrEqual(295);
    expect(v).toBeLessThanOrEqual(315);
  });
});

describe('Modo adelantamiento', () => {
  it('a fondo 5 s con el botón: baja entre 0,40 y 0,50 con el indicador activo', () => {
    const si = straight();
    runFor(si, 5, OT);
    const drop = 1 - si.state.car.ersCharge;
    expect(drop).toBeGreaterThanOrEqual(0.4);
    expect(drop).toBeLessThanOrEqual(0.5);
    expect(si.state.car.overtake).toBe(true);
  });

  it('200→280 km/h con el botón al menos un 4 % más rápido', () => {
    const t = (inp: typeof T) => runUntil(straight({ v: ms(200), throttle: 1 }), (st) => st.car.speed >= ms(280), inp, 30)!;
    expect(t(OT)).toBeLessThanOrEqual(0.96 * t(T));
  });

  it('corte por batería baja: por debajo de 0,05 se desactiva y desaparece la potencia extra', () => {
    const si = straight({ v: ms(200), charge: 0.06, throttle: 1 });
    si.step(OT);
    expect(si.state.car.overtake).toBe(true);
    expect(si.state.car.ersDeployKw).toBe(config.ers.baseDeployKw + config.ers.overtakeExtraKw);
    runUntil(si, (st) => st.car.ersCharge < 0.05, OT, 5);
    si.step(OT);
    expect(si.state.car.overtake).toBe(false);
    expect(si.state.car.ersDeployKw).toBe(config.ers.baseDeployKw);
  });
});

describe('Recuperación', () => {
  it('frenada de 300 a 100 km/h con batería a 0,5: sube entre 0,02 y 0,20', () => {
    const si = straight({ v: ms(300), charge: 0.5 });
    runUntil(si, (st) => st.car.speed <= ms(100), full({ brake: 1 }), 10);
    const gain = si.state.car.ersCharge - 0.5;
    expect(gain).toBeGreaterThanOrEqual(0.02);
    expect(gain).toBeLessThanOrEqual(0.2);
  });

  it('cruzar la meta con batería a 0,5 sin frenar: sube entre 0,01 y 0,06', () => {
    const si = nearLine(0.5);
    let started = false;
    runFor(si, 1, holdSpeed(50), (_st, ev) => { if (ev.some((e) => e.type === 'lapStart')) started = true; });
    expect(started).toBe(true);
    const gain = si.state.car.ersCharge - 0.5;
    expect(gain).toBeGreaterThanOrEqual(0.01);
    expect(gain).toBeLessThanOrEqual(0.06);
  });

  it('tope: frenando con la batería a 1 sigue en 1', () => {
    const si = straight({ v: ms(300), charge: 1 });
    runFor(si, 2, full({ brake: 1 }));
    expect(si.state.car.ersCharge).toBe(1);
  });
});

describe('Límite de despliegue por vuelta', () => {
  // Límite reducido a 0,2 MJ (≈ 1,7 s de despliegue base) para alcanzarlo desplegando.
  const lowLimit = () => { const c = cfg(); c.ers.lapDeployLimitMJ = 0.2; return c; };

  it('alcanzado el límite: la batería deja de bajar y solo hay combustión', () => {
    const si = new Simulation(makeStraightTrack({ lengthM: 14000, halfWidthM: 8 }), lowLimit());
    place(si, 50, 0, ms(200));
    si.state.car.throttle = 1;
    runFor(si, 2, T);
    expect(si.state.car.ersLapDeployedMJ).toBeCloseTo(0.2, 9);
    const charge = si.state.car.ersCharge;
    expect(charge).toBeLessThan(1);
    runFor(si, 2, T);
    expect(si.state.car.ersCharge).toBe(charge);
    expect(si.state.car.ersDeployKw).toBe(0);
  });

  it('al cruzar la meta el despliegue vuelve a estar disponible', () => {
    const si = new Simulation(makeOvalTrack(), lowLimit());
    place(si, si.track.length - 180, 0, 50);
    si.state.car.throttle = 1;
    runFor(si, 2, T);
    expect(si.state.timing.lap).toBe(0);
    expect(si.state.car.ersDeployKw).toBe(0);
    expect(runUntil(si, (st) => st.timing.lap >= 1, T, 5)).not.toBeNull();
    si.step(T);
    expect(si.state.car.ersLapDeployedMJ).toBeLessThan(0.2);
    expect(si.state.car.ersDeployKw).toBe(config.ers.baseDeployKw);
  });
});
