import { rpmFor } from '../../src/sim/gearbox';
import type { Simulation } from '../../src/sim/simulation';
import type { DriverInput, SimEvent, SimState } from '../../src/sim/types';
import { locate, sampleAt } from '../../src/track/query';

export const G = 9.81;
export const kmh = (ms: number) => ms * 3.6;
export const ms = (kmhV: number) => kmhV / 3.6;

type InputFn = DriverInput | ((st: SimState) => DriverInput);
const resolve = (inp: InputFn, st: SimState) => (typeof inp === 'function' ? inp(st) : inp);

// Ejecuta la simulación durante `seconds`, devolviendo todos los eventos.
export function runFor(sim: Simulation, seconds: number, input: InputFn, onStep?: (st: SimState, ev: SimEvent[]) => void): SimEvent[] {
  const steps = Math.round(seconds / sim.cfg.sim.dt);
  const all: SimEvent[] = [];
  for (let i = 0; i < steps; i++) {
    const ev = sim.step(resolve(input, sim.state));
    all.push(...ev);
    onStep?.(sim.state, ev);
  }
  return all;
}

// Ejecuta hasta que pred sea cierto; devuelve el tiempo transcurrido o null si se supera maxS.
export function runUntil(sim: Simulation, pred: (st: SimState) => boolean, input: InputFn, maxS: number): number | null {
  const t0 = sim.state.t;
  const steps = Math.round(maxS / sim.cfg.sim.dt);
  for (let i = 0; i < steps; i++) {
    sim.step(resolve(input, sim.state));
    if (pred(sim.state)) return sim.state.t - t0;
  }
  return null;
}

// Coloca el coche en (s, d) con rumbo de pista (+ yawOffset) y velocidad dada a lo largo del rumbo.
export function place(sim: Simulation, s: number, d: number, speed: number, yawOffset = 0): void {
  const t = sim.track;
  const c = sim.state.car;
  const p = sampleAt(t, s);
  c.x = p.x + d * p.nx; c.z = p.z + d * p.nz;
  c.yaw = p.heading + yawOffset;
  c.vx = speed * Math.cos(c.yaw); c.vz = -speed * Math.sin(c.yaw);
  c.speed = speed; c.vLong = speed; c.vLat = 0; c.yawRate = 0;
  c.steerAngle = 0; c.aLong = 0; c.aLat = 0; c.slip = 0;
  const loc = locate(t, c.x, c.z, Math.round(s / t.step));
  c.s = loc.s; c.d = loc.d; c.trackIndex = loc.i; c.surface = loc.surface; c.kerbSide = loc.kerbSide;
  // Marcha que llevaría el automático a esa velocidad (la más corta por debajo del punto de subida)
  const gc = sim.cfg.gears;
  let gear = 1;
  while (gear < gc.topSpeedKmh.length && rpmFor(speed, gear, sim.cfg) >= gc.auto.upFrac * gc.limiterRpm) gear++;
  c.gear = gear; c.rpm = Math.min(rpmFor(speed, gear, sim.cfg), gc.limiterRpm); c.shiftCutS = 0; c.limiter = false;
}

// Controlador proporcional de velocidad sobre el acelerador.
export const holdSpeed = (target: number, steer = 0) => (st: SimState): DriverInput => ({
  steer, throttle: Math.min(1, Math.max(0, 0.3 + (target - st.car.speed) * 0.5)), brake: 0, ers: false,
});

export const full = (o: Partial<DriverInput> = {}): DriverInput => ({ steer: 0, throttle: 0, brake: 0, ers: false, ...o });
