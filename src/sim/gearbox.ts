import type { GameConfig } from '../shared/config';
import type { CarState, DriverCommand, DriverInput, SimEvent } from './types';

// Caja secuencial de 8 marchas, RPM, limitador, LEDs y sobrecalentamiento (design D3, skill f1-car-feel §4).

const LIMITER_RELEASE_RPM = 200;   // histéresis para salir del limitador (un evento por entrada)
const EPS = 1e-9;

// Cola de una orden recibida durante el corte de cambio (máximo una).
const pending = new WeakMap<CarState, 'shiftUp' | 'shiftDown'>();

// Velocidad (m/s) a la que la marcha alcanza el limitador.
export function gearTopMs(gear: number, cfg: GameConfig): number {
  const g = cfg.gears;
  if (gear === -1) return g.reverseTopKmh / 3.6;
  if (gear >= 1 && gear <= g.topSpeedKmh.length) return g.topSpeedKmh[gear - 1] / 3.6;
  return Infinity;   // punto muerto: sin relación
}

// RPM proporcionales a la velocidad en la marcha, sin patinaje; ralentí como mínimo. Sin recortar al limitador.
export function rpmFor(vLong: number, gear: number, cfg: GameConfig): number {
  const g = cfg.gears;
  if (gear === 0) return g.idleRpm;
  const v = gear === -1 ? -vLong : vLong;
  return Math.max(g.idleRpm, g.limiterRpm * v / gearTopMs(gear, cfg));
}

// Fracción de la potencia de combustión según las RPM (interpolación lineal de powerCurve); 0 en el limitador.
export function powerFactor(rpm: number, cfg: GameConfig): number {
  const g = cfg.gears;
  if (rpm >= g.limiterRpm) return 0;
  const c = g.powerCurve;
  if (rpm <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (rpm <= c[i][0]) {
      const [r0, p0] = c[i - 1], [r1, p1] = c[i];
      return p0 + (p1 - p0) * (rpm - r0) / (r1 - r0);
    }
  }
  return c[c.length - 1][1];
}

// LEDs de cambio: 0..15 entre ledStartFrac y ledFullFrac del limitador, 16 en el limitador.
export function ledsFor(rpm: number, cfg: GameConfig): number {
  const g = cfg.gears;
  if (rpm >= g.limiterRpm) return 16;
  const u = (rpm / g.limiterRpm - g.ledStartFrac) / (g.ledFullFrac - g.ledStartFrac);
  return Math.min(15, Math.max(0, Math.round(u * 15)));
}

// ¿Se puede engranar `target` desde `from` a la velocidad vLong?
export function canShiftTo(target: number, from: number, vLong: number, cfg: GameConfig): boolean {
  const g = cfg.gears;
  if (target < -1 || target > g.topSpeedKmh.length) return false;
  if (target === -1) return from === 0 && Math.abs(vLong) < g.reverseMaxEntryKmh / 3.6;
  if (target === 0) return true;
  if (target < from) return rpmFor(vLong, target, cfg) <= g.limiterRpm + g.downshiftMarginRpm;
  return true;
}

// Orden del cambio automático: sube cerca del punto óptimo, reduce al perder velocidad. Nunca engrana N ni R.
export function autoShiftCommand(car: CarState, input: DriverInput, cfg: GameConfig): 'shiftUp' | 'shiftDown' | null {
  const g = cfg.gears;
  if (car.gear < 1) return null;
  if (car.gear < g.topSpeedKmh.length && car.rpm >= g.auto.upFrac * g.limiterRpm && input.throttle > 0.2) return 'shiftUp';
  if (car.gear > 1 && rpmFor(car.vLong, car.gear - 1, cfg) < g.auto.downFrac * g.limiterRpm) return 'shiftDown';
  return null;
}

// Aplica una orden de cambio; devuelve true si cambió la marcha.
function applyShift(car: CarState, cmd: 'shiftUp' | 'shiftDown', cfg: GameConfig, events: SimEvent[]): boolean {
  const from = car.gear;
  const target = cmd === 'shiftUp' ? from + 1 : from - 1;
  if (target > cfg.gears.topSpeedKmh.length || target < -1) return false;   // topes: sin efecto
  if (!canShiftTo(target, from, car.vLong, cfg)) {
    events.push({ type: 'shiftRejected' });
    return false;
  }
  car.gear = target;
  car.shiftCutS = cfg.gears.shiftCutS;
  if (target !== 0) car.rpm = Math.min(rpmFor(car.vLong, target, cfg), cfg.gears.limiterRpm);
  car.limiter = false;
  events.push({ type: 'shift', from, to: target });
  return true;
}

// Vacía la orden en cola (reinicio o recolocación del coche).
export function clearGearboxQueue(car: CarState): void {
  pending.delete(car);
}

// Paso de la caja antes de stepCar: corte, órdenes (manuales y automáticas), RPM en punto muerto, limitador y temperatura.
export function stepGearbox(car: CarState, input: DriverInput, commands: readonly DriverCommand[], autoShift: boolean,
                            cfg: GameConfig, events: SimEvent[]): void {
  const g = cfg.gears;
  const dt = cfg.sim.dt;

  // 1. Corte de cambio; al terminar, se aplica la orden en cola
  if (car.shiftCutS > 0) {
    car.shiftCutS = car.shiftCutS - dt > EPS ? car.shiftCutS - dt : 0;
    if (car.shiftCutS === 0) {
      const q = pending.get(car);
      pending.delete(car);
      if (q) applyShift(car, q, cfg, events);
    }
  }

  // 2. Órdenes manuales (también con la asistencia activa)
  let manual = false;
  for (const c of commands) {
    if (c !== 'shiftUp' && c !== 'shiftDown') continue;
    manual = true;
    if (car.shiftCutS > 0) { if (!pending.has(car)) pending.set(car, c); }
    else applyShift(car, c, cfg, events);
  }

  // 3. Cambio automático
  if (autoShift && !manual && car.shiftCutS === 0) {
    const a = autoShiftCommand(car, input, cfg);
    if (a) applyShift(car, a, cfg, events);
  }

  // 4. RPM en punto muerto: relajación hacia ralentí + acelerador
  if (car.gear === 0) {
    const target = g.idleRpm + Math.min(Math.max(input.throttle, 0), 1) * (g.limiterRpm - g.idleRpm);
    car.rpm += (target - car.rpm) * (1 - Math.exp(-g.neutralRevRate * dt));
    car.leds = ledsFor(car.rpm, cfg);
  }

  // 5. Limitador con histéresis: un evento por entrada
  const raw = car.gear === 0 ? car.rpm : rpmFor(car.vLong, car.gear, cfg);
  if (!car.limiter && raw >= g.limiterRpm) {
    car.limiter = true;
    events.push({ type: 'limiter' });
  } else if (car.limiter && raw < g.limiterRpm - LIMITER_RELEASE_RPM) {
    car.limiter = false;
  }

  // 6. Sobrecalentamiento: calienta en el limitador, enfría fuera
  const o = g.overheat;
  if (car.limiter) car.engineTemp = Math.min(o.max, car.engineTemp + o.heatPerS * dt);
  else car.engineTemp = Math.max(0, car.engineTemp - o.coolPerS * dt);
  if (!car.overheated && car.engineTemp >= o.threshold) {
    car.overheated = true;
    events.push({ type: 'overheat', on: true });
  } else if (car.overheated && car.engineTemp <= o.recover) {
    car.overheated = false;
    events.push({ type: 'overheat', on: false });
  }
}
