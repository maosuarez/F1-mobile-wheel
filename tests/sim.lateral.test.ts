import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { gripAccel, maxSteerRad } from '../src/sim/car';
import { Simulation } from '../src/sim/simulation';
import type { SimState } from '../src/sim/types';
import { makeOvalTrack, makeStraightTrack } from '../src/track/synthetic';
import { G, full, holdSpeed, kmh, ms, place, runFor } from './helpers/drive';

const cfg = () => structuredClone(config);
// Explanada llana: recta muy ancha
const plain = () => makeStraightTrack({ lengthM: 6000, halfWidthM: 400 });

// Aceleración lateral sostenida media (último segundo) a velocidad mantenida con la dirección al máximo.
function sustainedLat(v: number, steer = -1): { aLat: number; sim: Simulation } {
  const sim = new Simulation(plain(), cfg());
  place(sim, 3000, -150, v);
  runFor(sim, 3, holdSpeed(v, steer));
  let sum = 0, n = 0;
  runFor(sim, 1, holdSpeed(v, steer), (st) => { sum += Math.abs(st.car.aLat); n++; });
  return { aLat: sum / n, sim };
}

describe('Agarre lateral dependiente de la velocidad', () => {
  it('a 250 km/h entre 3,5 y 4,8 g', () => {
    const { aLat, sim } = sustainedLat(ms(250));
    console.info(`g lateral a 250 km/h: ${(aLat / G).toFixed(2)} (v=${kmh(sim.state.car.speed).toFixed(1)})`);
    expect(Math.abs(kmh(sim.state.car.speed) - 250)).toBeLessThan(5);
    expect(aLat / G).toBeGreaterThanOrEqual(3.5);
    expect(aLat / G).toBeLessThanOrEqual(4.8);
  });

  it('a 100 km/h entre 1,7 y 2,5 g', () => {
    const { aLat, sim } = sustainedLat(ms(100));
    expect(Math.abs(kmh(sim.state.car.speed) - 100)).toBeLessThan(5);
    expect(aLat / G).toBeGreaterThanOrEqual(1.7);
    expect(aLat / G).toBeLessThanOrEqual(2.5);
  });
});

describe('Círculo de fricción', () => {
  it('frenada en apoyo a 200 km/h', () => {
    const c = cfg();
    const run = (brake: number) => {
      const sim = new Simulation(plain(), c);
      place(sim, 3000, 0, ms(200));
      let maxLat = 0, maxRatio = 0;
      runFor(sim, 0.5, full({ steer: 1, brake }), (st: SimState) => {
        const car = st.car;
        const v = car.speed;
        // Aceleración de neumáticos = total − arrastre − rodadura (longitudinal)
        const aDrag = 0.5 * c.sim.rho * c.aero.cdA * v * v / c.car.massKg;
        const aRoll = c.car.rollingCoef * c.sim.g;
        const aTireLong = car.aLong + aDrag + aRoll;
        const aMax = gripAccel(v, 1, c);
        maxRatio = Math.max(maxRatio, Math.hypot(aTireLong, car.aLat) / aMax);
        maxLat = Math.max(maxLat, Math.abs(car.aLat));
      });
      return { maxLat, maxRatio };
    };
    const braking = run(1);
    const turning = run(0);
    expect(braking.maxRatio).toBeLessThanOrEqual(1.05);
    expect(braking.maxLat).toBeLessThan(turning.maxLat);
  });
});

describe('Dirección sensible a la velocidad', () => {
  it('volantazo a 300 km/h: deriva ≤ 8° y sin trompo', () => {
    const sim = new Simulation(plain(), cfg());
    place(sim, 2000, -100, ms(300));
    let maxBeta = 0;
    let yawTurned = 0;
    let prevYaw = sim.state.car.yaw;
    runFor(sim, 2, full({ steer: 1 }), (st) => {
      const beta = Math.abs(Math.atan2(st.car.vLat, st.car.vLong));
      maxBeta = Math.max(maxBeta, beta);
      let dy = st.car.yaw - prevYaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      yawTurned += dy;
      prevYaw = st.car.yaw;
    });
    expect(maxBeta * 180 / Math.PI).toBeLessThanOrEqual(8);
    expect(sim.state.car.vLong).toBeGreaterThan(0);
    expect(yawTurned).toBeLessThan(0);   // gira a la derecha, de forma controlada
  });

  it('suavizado: 63 % del ángulo final entre 40 y 90 ms', () => {
    const c = cfg();
    const sim = new Simulation(plain(), c);
    place(sim, 3000, 0, 0);
    const final = maxSteerRad(0, c);
    let t63 = -1;
    runFor(sim, 0.3, full({ steer: 1 }), (st) => {
      if (t63 < 0 && st.car.steerAngle >= 0.632 * final) t63 = st.t;
    });
    expect(t63).toBeGreaterThanOrEqual(0.04);
    expect(t63).toBeLessThanOrEqual(0.09);
  });

  it('giro cerrado a 40 km/h: radio entre 10 y 20 m', () => {
    const sim = new Simulation(plain(), cfg());
    place(sim, 3000, 0, ms(40));
    runFor(sim, 3, holdSpeed(ms(40), 1));
    let sum = 0, n = 0;
    runFor(sim, 1, holdSpeed(ms(40), 1), (st) => { sum += st.car.speed / Math.abs(st.car.yawRate); n++; });
    const radius = sum / n;
    expect(radius).toBeGreaterThanOrEqual(10);
    expect(radius).toBeLessThanOrEqual(20);
  });

  it('signo: dirección positiva hacia +X desvía a la derecha (d decrece)', () => {
    const sim = new Simulation(makeStraightTrack({ lengthM: 3000, halfWidthM: 20 }), cfg());
    place(sim, 500, 0, ms(100));
    runFor(sim, 0.5, full({ steer: 1 }));
    expect(sim.state.car.d).toBeLessThan(-0.1);
  });
});

describe('Subviraje al exceder el agarre', () => {
  it('entrada a 200 km/h en curva de 60 m: sale por el exterior', () => {
    const track = makeOvalTrack({ straightM: 1000, radiusM: 60 });
    const sim = new Simulation(track, cfg());
    const curveStart = 500;   // la curva 1 empieza en straightM / 2
    place(sim, curveStart - 30, 0, ms(200));
    let minD = 0;
    runFor(sim, 3, (st) => full({ steer: st.car.s >= curveStart && st.car.s < curveStart + Math.PI * 60 ? -1 : 0 }), (st) => {
      if (st.car.s < curveStart + Math.PI * 60) minD = Math.min(minD, st.car.d);
    });
    expect(minD).toBeLessThan(-track.wr[0]);
  });
});

describe('Estado observable', () => {
  it('frenada en recta a ~4 g: aLong −4 g ± 5 % y aLat ≈ 0', () => {
    const c = cfg();
    const sim = new Simulation(plain(), c);
    // Velocidad a la que la deceleración total es 4 g: buscar por bisección
    const decel = (v: number) => c.car.brakeGripFactor * gripAccel(v, 1, c)
      + 0.5 * c.sim.rho * c.aero.cdA * v * v / c.car.massKg + c.car.rollingCoef * c.sim.g;
    let lo = 10, hi = 100;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (decel(mid) < 4 * G) lo = mid; else hi = mid; }
    place(sim, 3000, 0, lo);
    sim.state.car.brake = 1;
    sim.step(full({ brake: 1 }));
    expect(Math.abs(sim.state.car.aLong / G + 4)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(sim.state.car.aLat / G)).toBeLessThanOrEqual(0.05);
  });
});
