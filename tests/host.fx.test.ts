import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import type { FxKey } from '../src/shared/protocol';
import type { CarState, SimEvent } from '../src/sim/types';
import { FxPlanner } from '../src/host/net/fx';

// Reloj inyectado: fotogramas a 60 Hz.
const FRAME_MS = 1000 / 60;
const car = (o: Partial<CarState> = {}) =>
  ({ speed: 100 / 3.6, surface: 'asphalt', limiter: false, ...o }) as unknown as CarState;

/** Ejecuta `frames` fotogramas desde t0 y devuelve los fx emitidos. */
function run(p: FxPlanner, c: CarState, frames: number, t0 = 0, events: (i: number) => SimEvent[] = () => []): FxKey[] {
  const out: FxKey[] = [];
  for (let i = 0; i < frames; i++) {
    const k = p.plan(events(i), c, t0 + i * FRAME_MS);
    if (k) out.push(k);
  }
  return out;
}
const count = (a: FxKey[], k: FxKey) => a.filter((x) => x === k).length;

describe('FxPlanner (spec haptic-feedback)', () => {
  it('Cambio de marcha: exactamente un shift', () => {
    const p = new FxPlanner(config.fx);
    const sent = run(p, car(), 60, 0, (i) => (i === 5 ? [{ type: 'shift', from: 3, to: 4 }] : []));
    expect(sent).toEqual(['shift']);
  });

  it('Reducción rechazada: un limits', () => {
    const p = new FxPlanner(config.fx);
    const sent = run(p, car(), 30, 0, (i) => (i === 0 ? [{ type: 'shiftRejected' }] : []));
    expect(sent).toEqual(['limits']);
  });

  it('Piano: 1 s a 100 km/h da 7-9 kerb y ninguno tras volver al asfalto', () => {
    const p = new FxPlanner(config.fx);
    const onKerb = run(p, car({ surface: 'kerb' }), 60);
    expect(count(onKerb, 'kerb')).toBeGreaterThanOrEqual(7);
    expect(count(onKerb, 'kerb')).toBeLessThanOrEqual(9);
    expect(onKerb.every((k) => k === 'kerb')).toBe(true);
    expect(run(p, car({ surface: 'asphalt' }), 60, 60 * FRAME_MS)).toEqual([]);
  });

  it('Parado en la hierba: ningún fx', () => {
    const p = new FxPlanner(config.fx);
    expect(run(p, car({ surface: 'grass', speed: 0 }), 120)).toEqual([]);
  });

  it('Limitador: 1 s da 8-11 limiter', () => {
    const p = new FxPlanner(config.fx);
    const sent = run(p, car({ limiter: true }), 60);
    expect(count(sent, 'limiter')).toBeGreaterThanOrEqual(8);
    expect(count(sent, 'limiter')).toBeLessThanOrEqual(11);
    expect(sent.every((k) => k === 'limiter')).toBe(true);
  });

  it('Coincidencia de efectos: shift primero y kerb en el siguiente hueco', () => {
    const p = new FxPlanner(config.fx);
    const c = car({ surface: 'kerb' });
    // Entra al piano y cambia de marcha en el mismo paso.
    expect(p.plan([{ type: 'shift', from: 4, to: 5 }], c, 0)).toBe('shift');
    let t = 0, k: FxKey | null = null;
    while (k === null && t < 500) { t += FRAME_MS; k = p.plan([], c, t); }
    expect(k).toBe('kerb');
    expect(t).toBeGreaterThanOrEqual(config.fx.minGapMs);
    expect(t).toBeLessThan(config.fx.minGapMs + FRAME_MS + 1e-9);
  });

  it('Caudal acotado: nunca dos fx a menos de minGapMs, limits antes que shift', () => {
    const p = new FxPlanner(config.fx);
    const c = car({ surface: 'kerb', limiter: true });
    const times: number[] = [];
    const sent: FxKey[] = [];
    for (let i = 0; i < 120; i++) {
      const ev: SimEvent[] = i === 0 ? [{ type: 'shift', from: 7, to: 8 }, { type: 'wallHit', speedMs: 30 }, { type: 'limits' }] : [];
      const k = p.plan(ev, c, i * FRAME_MS);
      if (k) { sent.push(k); times.push(i * FRAME_MS); }
    }
    expect(sent.slice(0, 2)).toEqual(['limits', 'shift']);
    expect(count(sent, 'limits')).toBe(1);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(config.fx.minGapMs - 1e-9);
  });
});
