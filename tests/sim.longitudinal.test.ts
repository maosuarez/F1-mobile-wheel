import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { Simulation } from '../src/sim/simulation';
import { makeStraightTrack } from '../src/track/synthetic';
import { G, full, kmh, ms, place, runFor, runUntil } from './helpers/drive';

// Toda la potencia disponible: batería y límite por vuelta prácticamente ilimitados.
const cfg = () => {
  const c = structuredClone(config);
  c.ers.capacityMJ = 1e6;
  c.ers.lapDeployLimitMJ = 1e6;
  return c;
};
const flat = () => makeStraightTrack({ lengthM: 12000, halfWidthM: 8 });
const THROTTLE = full({ throttle: 1 });
const BRAKE = full({ brake: 1 });

// Simulación en una recta, parada en s = 50.
function straightSim(pitch = 0) {
  const sim = new Simulation(makeStraightTrack({ lengthM: 12000, halfWidthM: 8, pitch }), cfg());
  place(sim, 50, 0, 0);
  return sim;
}

// Distancia de frenada de v0 a v1 (m/s), con pedal previamente filtrado al 100 %.
function brakeDistance(sim: Simulation, v0: number, v1: number): number {
  place(sim, 100, 0, v0);
  sim.state.car.brake = 1;
  const s0 = sim.state.car.s;
  runUntil(sim, (st) => st.car.speed <= v1, BRAKE, 30);
  return sim.state.car.s - s0;
}

// Deceleración (m/s², positiva) con freno al 100 % a la velocidad v.
function decelAt(v: number): number {
  const sim = new Simulation(flat(), cfg());
  place(sim, 100, 0, v);
  sim.state.car.brake = 1;
  sim.step(BRAKE);
  return -sim.state.car.aLong;
}

describe('Velocidad punta', () => {
  it('recta larga: 315–335 km/h y estable en el último segundo', () => {
    const sim = straightSim();
    runFor(sim, 59, THROTTLE);
    const v59 = kmh(sim.state.car.speed);
    runFor(sim, 1, THROTTLE);
    const v60 = kmh(sim.state.car.speed);
    console.info(`velocidad punta ${v60.toFixed(1)} km/h`);
    expect(v60).toBeGreaterThanOrEqual(315);
    expect(v60).toBeLessThanOrEqual(335);
    expect(Math.abs(v60 - v59)).toBeLessThan(0.5);
  });
});

describe('Aceleración', () => {
  it('0–100 km/h entre 2,2 y 3,2 s', () => {
    const t = runUntil(straightSim(), (st) => st.car.speed >= ms(100), THROTTLE, 10);
    console.info(`0-100 ${t?.toFixed(2)} s`);
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThanOrEqual(2.2);
    expect(t!).toBeLessThanOrEqual(3.2);
  });

  it('0–200 km/h en menos de 6,5 s', () => {
    const t = runUntil(straightSim(), (st) => st.car.speed >= ms(200), THROTTLE, 20);
    console.info(`0-200 ${t?.toFixed(2)} s`);
    expect(t).not.toBeNull();
    expect(t!).toBeLessThan(6.5);
  });

  it('limitada por tracción por debajo de 60 km/h (≤ 1,4 g)', () => {
    const sim = straightSim();
    let maxA = 0;
    runUntil(sim, (st) => {
      maxA = Math.max(maxA, st.car.aLong);
      return st.car.speed >= ms(60);
    }, THROTTLE, 10);
    expect(maxA).toBeGreaterThan(0);
    expect(maxA).toBeLessThanOrEqual(1.4 * G);
  });
});

describe('Frenada dependiente de la carga', () => {
  it('distancia de 300 a 80 km/h entre 90 y 140 m', () => {
    const d = brakeDistance(straightSim(), ms(300), ms(80));
    console.info(`frenada 300-80 ${d.toFixed(1)} m`);
    expect(d).toBeGreaterThanOrEqual(90);
    expect(d).toBeLessThanOrEqual(140);
  });

  it('pico de deceleración a 280 km/h entre 4,0 y 5,8 g', () => {
    const a = decelAt(ms(280)) / G;
    expect(a).toBeGreaterThanOrEqual(4.0);
    expect(a).toBeLessThanOrEqual(5.8);
  });

  it('deceleración a 80 km/h entre 1,2 y 2,2 g', () => {
    const a = decelAt(ms(80)) / G;
    expect(a).toBeGreaterThanOrEqual(1.2);
    expect(a).toBeLessThanOrEqual(2.2);
  });

  it('parada completa sin retroceso ni oscilación', () => {
    const sim = straightSim();
    place(sim, 100, 0, ms(100));
    let prevS = sim.state.car.s;
    let backwards = false;
    runFor(sim, 6, BRAKE, (st) => {
      if (st.car.s < prevS - 1e-9) backwards = true;
      prevS = st.car.s;
    });
    expect(sim.state.car.speed).toBe(0);
    expect(backwards).toBe(false);
    const s = sim.state.car.s;
    runFor(sim, 2, BRAKE);
    expect(sim.state.car.s).toBe(s);
    expect(sim.state.car.speed).toBe(0);
  });
});

describe('Pendientes', () => {
  it('frenada de 200 a 80 km/h cuesta abajo entre un 2 % y un 20 % más larga', () => {
    const dFlat = brakeDistance(straightSim(0), ms(200), ms(80));
    const dDown = brakeDistance(straightSim(-0.08), ms(200), ms(80));
    const ratio = dDown / dFlat;
    expect(ratio).toBeGreaterThanOrEqual(1.02);
    expect(ratio).toBeLessThanOrEqual(1.2);
  });

  it('rodando cuesta arriba pierde velocidad más rápido que en llano', () => {
    const lost = (pitch: number) => {
      const sim = straightSim(pitch);
      place(sim, 100, 0, ms(100));
      runFor(sim, 3, full());
      return ms(100) - sim.state.car.speed;
    };
    expect(lost(0.08)).toBeGreaterThan(lost(0) * 1.2);
  });
});
