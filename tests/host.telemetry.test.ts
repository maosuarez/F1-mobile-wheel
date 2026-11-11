import { describe, expect, it } from 'vitest';
import { encode } from '../src/shared/protocol';
import type { SimState } from '../src/sim/types';
import { buildTel } from '../src/host/net/telemetry';

const state = (speedMs: number, lap: number, deltaS: number | null, car: object = {}) =>
  ({ t: 12, stepCount: 1440, car: { speed: speedMs, gear: 1, rpm: 0, leds: 0, drs: 0, ersCharge: 1, overtake: false, ...car }, timing: { lap, deltaS } }) as unknown as SimState;

describe('buildTel', () => {
  it('campos y rangos de la spec, sin dbg si no se pasa', () => {
    const tel = buildTel(state(80, 2, -0.4), { warn: '', echo: 1234.5, hold: 17 });
    expect(tel).toEqual({ t: 'tel', spd: 288, gear: 1, rpm: 0, leds: 0, drs: 0, ers: 1, ot: false,
      lap: 2, delta: -0.4, warn: '', echo: 1234.5, hold: 17 });
    expect('dbg' in tel).toBe(false);
    expect(encode(tel)).not.toContain('dbg');
    expect(new TextEncoder().encode(encode(tel)).length).toBeLessThan(300);
  });
  it('delta null, warn recortado a 24 y hold no negativo', () => {
    const tel = buildTel(state(0, 1, null), { warn: 'W'.repeat(40), echo: 0, hold: -5 });
    expect(tel.delta).toBeNull();
    expect(tel.warn).toHaveLength(24);
    expect(tel.hold).toBe(0);
    expect(tel.spd).toBe(0);
    expect(buildTel(state(0, 1, null), { warn: '3', echo: 0, hold: 0 }).warn).toBe('3');
  });
  it('incluye dbg recortado a rango cuando se pasa', () => {
    const tel = buildTel(state(50, 1, null), { warn: '', echo: 0, hold: 0, dbg: { steer: 1.4, thr: 1.2, brk: -0.1, gear: 1 } });
    expect(tel.dbg).toEqual({ steer: 1, thr: 1, brk: 0, gear: 1 });
    const t2 = buildTel(state(50, 1, null), { warn: '', echo: 0, hold: 0, dbg: { steer: -0.3, thr: 0.5, brk: 0.2, gear: 1 } });
    expect(t2.dbg).toEqual({ steer: -0.3, thr: 0.5, brk: 0.2, gear: 1 });
  });
  it('lleva los valores reales del coche', () => {
    const tel = buildTel(state(60, 3, 0.1, { gear: 6, rpm: 11000, leds: 9, drs: 2, ersCharge: 0.7, overtake: true }), { warn: 'LÍMITES', echo: 0, hold: 0 });
    expect(tel).toMatchObject({ gear: 6, rpm: 11000, leds: 9, drs: 2, ot: true, warn: 'LÍMITES' });
    expect(tel.ers).toBeCloseTo(0.7, 2);
  });
  it('acota gear, leds y ers', () => {
    const tel = buildTel(state(0, 1, null, { gear: 12, leds: 30, ersCharge: 1.4 }), { warn: '', echo: 0, hold: 0 });
    expect(tel).toMatchObject({ gear: 8, leds: 16, ers: 1 });
  });
  it('dbg.gear acepta la marcha sugerida y se acota a [-1, 8]', () => {
    const mk = (gear: number) => buildTel(state(50, 1, null), { warn: '', echo: 0, hold: 0, dbg: { steer: 0, thr: 1, brk: 0, gear } }).dbg!.gear;
    expect(mk(5)).toBe(5);
    expect(mk(11)).toBe(8);
    expect(mk(-4)).toBe(-1);
  });
});
