import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { Simulation } from '../src/sim/simulation';
import type { DriverCommand, SimEvent } from '../src/sim/types';
import { makeStraightTrack } from '../src/track/synthetic';
import { full, holdSpeed, kmh, ms, place, runFor, runUntil } from './helpers/drive';

const cfg = () => structuredClone(config);
const T = full({ throttle: 1 });

// Recta larga; el coche en s, con la marcha y la asistencia indicadas y el acelerador ya filtrado.
function sim(o: { s?: number; v?: number; gear?: number; auto?: boolean; throttle?: number } = {}): Simulation {
  const si = new Simulation(makeStraightTrack({ lengthM: 14000, halfWidthM: 8 }), cfg());
  si.assists.autoShift = o.auto ?? false;
  place(si, o.s ?? 50, 0, o.v ?? 0);
  if (o.gear !== undefined) si.state.car.gear = o.gear;
  si.state.car.throttle = o.throttle ?? 0;
  return si;
}

const count = (ev: SimEvent[], type: SimEvent['type']) => ev.filter((e) => e.type === type).length;
const stepCmd = (si: Simulation, cmd: DriverCommand, input = T) => si.step(input, [cmd]);

describe('Marchas secuenciales', () => {
  it('subir marcha en 3.ª a 150 km/h: pasa a 4.ª y las RPM bajan en proporción (± 3 %)', () => {
    const half = full({ throttle: 0.5 });   // sin patinaje: RPM = relación × velocidad
    const si = sim({ v: ms(150), gear: 3, throttle: 0.5 });
    si.step(half);
    const before = si.state.car.rpm;
    const ev = stepCmd(si, 'shiftUp', half);
    expect(si.state.car.gear).toBe(4);
    expect(ev).toContainEqual({ type: 'shift', from: 3, to: 4 });
    const ratio = si.state.car.rpm / before;
    expect(Math.abs(ratio / (160 / 190) - 1)).toBeLessThanOrEqual(0.03);
  });

  it('tope superior: subir en 8.ª deja la 8.ª', () => {
    const si = sim({ v: ms(320), gear: 8, throttle: 1 });
    const ev = stepCmd(si, 'shiftUp');
    expect(si.state.car.gear).toBe(8);
    expect(count(ev, 'shift')).toBe(0);
  });

  it('velocidad máxima en 2.ª: 124–132 km/h con las RPM en el limitador', () => {
    const si = sim({ gear: 2 });
    runFor(si, 15, T);
    const v = kmh(si.state.car.speed);
    expect(v).toBeGreaterThanOrEqual(124);
    expect(v).toBeLessThanOrEqual(132);
    expect(si.state.car.limiter).toBe(true);
    expect(si.state.car.rpm).toBeCloseTo(12500, 0);
    expect(si.state.car.gear).toBe(2);
  });
});

describe('RPM y limitador', () => {
  it('ralentí: parado en 1.ª, 4 000 ± 100 rpm', () => {
    const si = sim();
    runFor(si, 1, full());
    expect(si.state.car.gear).toBe(1);
    expect(Math.abs(si.state.car.rpm - 4000)).toBeLessThanOrEqual(100);
  });

  it('limitador: RPM ≤ 12 500, sin aceleración positiva y un solo evento por entrada', () => {
    const si = sim();
    let maxRpm = 0;
    const ev = runFor(si, 10, T, (st) => { maxRpm = Math.max(maxRpm, st.car.rpm); });
    expect(si.state.car.limiter).toBe(true);
    expect(maxRpm).toBeLessThanOrEqual(12500);
    expect(count(ev, 'limiter')).toBe(1);
    // En el limitador la velocidad ya no crece
    const v0 = si.state.car.speed;
    let vMax = v0;
    runFor(si, 2, T, (st) => { vMax = Math.max(vMax, st.car.speed); });
    expect(vMax - v0).toBeLessThan(0.05);
    expect(si.state.car.speed).toBeLessThanOrEqual(v0 + 1e-9);
  });

  it('punto muerto: a fondo las RPM suben hacia el limitador y el coche no se mueve', () => {
    const si = sim();
    stepCmd(si, 'shiftDown', full());
    expect(si.state.car.gear).toBe(0);
    runFor(si, 2, T);
    expect(si.state.car.rpm).toBeGreaterThan(11500);
    expect(si.state.car.rpm).toBeLessThanOrEqual(12500);
    expect(si.state.car.speed).toBe(0);
  });
});

describe('Entrega de potencia según las RPM', () => {
  it('150→200 km/h en 8.ª tarda al menos un 25 % más que en 5.ª', () => {
    const t = (gear: number) => runUntil(sim({ v: ms(150), gear, throttle: 1 }), (st) => st.car.speed >= ms(200), T, 30)!;
    const t8 = t(8), t5 = t(5);
    expect(t8).toBeGreaterThanOrEqual(1.25 * t5);
  });

  it('con cambio automático: 0–100 en 2,4–3,2 s y 0–200 en menos de 6,5 s', () => {
    const si = sim({ auto: true });
    const t100 = runUntil(si, (st) => st.car.speed >= ms(100), T, 10)!;
    const t200 = t100 + runUntil(si, (st) => st.car.speed >= ms(200), T, 20)!;
    expect(t100).toBeGreaterThanOrEqual(2.4);
    expect(t100).toBeLessThanOrEqual(3.2);
    expect(t200).toBeLessThan(6.5);
  });
});

describe('Corte de potencia al cambiar', () => {
  it('subir a fondo a 150 km/h: fuerza motriz 0 durante 40 ± 9 ms y evento de cambio', () => {
    const si = sim({ v: ms(150), gear: 3, throttle: 1 });
    si.step(T);
    expect(si.state.car.aLong).toBeGreaterThan(0);
    const ev = stepCmd(si, 'shiftUp');
    expect(ev).toContainEqual({ type: 'shift', from: 3, to: 4 });
    // Sin fuerza motriz la aceleración es la del arrastre y la rodadura (negativa)
    let cutSteps = si.state.car.aLong < 0 ? 1 : 0;
    expect(cutSteps).toBe(1);
    for (let i = 0; i < 20; i++) {
      si.step(T);
      if (si.state.car.aLong < 0) cutSteps++;
      else break;
    }
    const cutMs = cutSteps * si.cfg.sim.dt * 1000;
    expect(cutMs).toBeGreaterThanOrEqual(31);
    expect(cutMs).toBeLessThanOrEqual(49);
  });

  it('una orden durante el corte se aplica al terminar (máximo una)', () => {
    const si = sim({ v: ms(150), gear: 3, throttle: 1 });
    stepCmd(si, 'shiftUp');
    stepCmd(si, 'shiftUp');
    stepCmd(si, 'shiftUp');
    expect(si.state.car.gear).toBe(4);
    runFor(si, 0.2, T);
    expect(si.state.car.gear).toBe(5);
  });
});

describe('Protección de reducción', () => {
  it('bajar de 8.ª a 7.ª a 320 km/h se rechaza', () => {
    const si = sim({ v: ms(320), gear: 8 });
    const ev = stepCmd(si, 'shiftDown', full());
    expect(si.state.car.gear).toBe(8);
    expect(count(ev, 'shiftRejected')).toBe(1);
  });

  it('bajar de 8.ª a 7.ª a 250 km/h se acepta', () => {
    const si = sim({ v: ms(250), gear: 8 });
    stepCmd(si, 'shiftDown', full());
    expect(si.state.car.gear).toBe(7);
  });
});

describe('Marcha atrás y punto muerto', () => {
  it('parado en 1.ª, bajar dos veces: N y luego R; retrocede sin superar 60 km/h', () => {
    const si = sim({ s: 1000 });
    stepCmd(si, 'shiftDown', full());
    expect(si.state.car.gear).toBe(0);
    stepCmd(si, 'shiftDown', full());
    runFor(si, 0.1, full());
    expect(si.state.car.gear).toBe(-1);
    const s0 = si.state.car.s;
    let vMax = 0;
    runFor(si, 15, T, (st) => { vMax = Math.max(vMax, st.car.speed); });
    expect(si.state.car.s).toBeLessThan(s0 - 50);
    expect(si.state.car.vLong).toBeLessThan(0);
    expect(kmh(vMax)).toBeLessThanOrEqual(60.5);
    expect(kmh(vMax)).toBeGreaterThan(50);
  });

  it('en N a 40 km/h, bajar se rechaza', () => {
    const si = sim({ v: ms(40), gear: 0 });
    const ev = stepCmd(si, 'shiftDown', full());
    expect(si.state.car.gear).toBe(0);
    expect(count(ev, 'shiftRejected')).toBe(1);
  });
});

describe('Sobrecalentamiento', () => {
  // Aceleración motriz a 250 km/h en 7.ª, solo combustión (batería vacía).
  const driveAccel = (overheated: boolean) => {
    const si = sim({ s: 1000, v: ms(250), gear: 7, throttle: 1 });
    si.state.car.ersCharge = 0;
    si.state.car.overheated = overheated;
    si.state.car.engineTemp = overheated ? 1.2 : 0;
    si.step(T);
    const c = si.cfg, v = si.state.car.speed;
    return si.state.car.aLong + 0.5 * c.sim.rho * c.aero.cdA * v * v / c.car.massKg + c.car.rollingCoef * c.sim.g;
  };

  it('6 s en el limitador: sobrecalentamiento y potencia un 20 % menor', () => {
    const si = sim();
    runUntil(si, (st) => st.car.limiter, T, 10);
    const ev = runFor(si, 6, T);
    expect(si.state.car.overheated).toBe(true);
    expect(ev).toContainEqual({ type: 'overheat', on: true });
    expect(driveAccel(true) / driveAccel(false)).toBeCloseTo(0.8, 2);
  });

  it('enfriamiento: 10 s por debajo de 11 000 rpm lo desactiva', () => {
    const si = sim();
    runUntil(si, (st) => st.car.limiter, T, 10);
    runFor(si, 6, T);
    expect(si.state.car.overheated).toBe(true);
    place(si, si.state.car.s, 0, ms(70));   // conserva la temperatura
    let maxRpm = 0;
    const ev = runFor(si, 10, holdSpeed(ms(70)), (st) => { maxRpm = Math.max(maxRpm, st.car.rpm); });
    expect(maxRpm).toBeLessThan(11000);
    expect(si.state.car.overheated).toBe(false);
    expect(ev).toContainEqual({ type: 'overheat', on: false });
  });
});

describe('Cambio automático como asistencia', () => {
  it('desde parado a fondo llega a 8.ª sin tocar el limitador más de 0,1 s seguidos', () => {
    const si = sim({ auto: true });
    let run = 0, maxRun = 0;
    runFor(si, 40, T, (st) => {
      run = st.car.limiter ? run + 1 : 0;
      maxRun = Math.max(maxRun, run);
    });
    expect(si.state.car.gear).toBe(8);
    expect(maxRun * si.cfg.sim.dt).toBeLessThanOrEqual(0.1);
  });

  it('a 185 km/h constantes durante 10 s cambia como máximo una vez', () => {
    const si = sim({ auto: true, v: ms(185), throttle: 0.5 });
    const ev = runFor(si, 10, holdSpeed(ms(185)));
    expect(Math.abs(kmh(si.state.car.speed) - 185)).toBeLessThan(3);
    expect(count(ev, 'shift')).toBeLessThanOrEqual(1);
  });

  it('modo manual: a fondo sin cambios se queda en 1.ª en el limitador', () => {
    const si = sim({ auto: false });
    runFor(si, 8, T);
    expect(si.state.car.gear).toBe(1);
    expect(si.state.car.limiter).toBe(true);
  });
});
