import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { Haptics } from '../src/wheel/haptics';
import { pedalValue } from '../src/wheel/pedals';

const mk = () => {
  let t = 1000;
  const calls: (number | number[])[] = [];
  const h = new Haptics(config.wheel.haptics, (p) => calls.push(p), () => t);
  return { h, calls, advance: (ms: number) => { t += ms; } };
};

describe('vibración', () => {
  it('shift solicita una vibración de 12 ms', () => {
    const { h, calls } = mk();
    h.trigger('shift');
    expect(calls).toEqual([[12]]);
  });
  it('cada efecto tiene su patrón', () => {
    const { h, calls, advance } = mk();
    for (const k of ['kerb', 'grass', 'limits', 'limiter'] as const) { h.trigger(k); advance(100); }
    expect(calls).toEqual([[25], [40, 30, 40], [120], [8]]);
  });
  it('10 fx en 100 ms: como máximo 2 llamadas', () => {
    const { h, calls, advance } = mk();
    for (let i = 0; i < 10; i++) { h.trigger('kerb'); advance(10); }
    expect(calls.length).toBeLessThanOrEqual(2);
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });
  it('desactivada no vibra', () => {
    const { h, calls } = mk();
    h.enabled = false;
    h.trigger('shift');
    expect(calls).toHaveLength(0);
  });
});

describe('vibración sin soporte', () => {
  it('no dispara si no hay soporte', () => {
    const calls: (number | number[])[] = [];
    const h = new Haptics(config.wheel.haptics, (p) => calls.push(p), () => 1000, false);
    h.trigger('shift');
    expect(h.supported).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it('con soporte, la preferencia apagada se respeta', () => {
    const calls: (number | number[])[] = [];
    const h = new Haptics(config.wheel.haptics, (p) => calls.push(p), () => 1000, true);
    h.enabled = false;
    h.trigger('kerb');
    expect(calls).toHaveLength(0);
  });
});

describe('pedalValue', () => {
  const rect = { top: 100, height: 200 };
  it('abajo 0, arriba 1', () => {
    expect(pedalValue(300, rect)).toBe(0);
    expect(pedalValue(100, rect)).toBe(1);
  });
  it('tres cuartos de la altura da 0,75', () => {
    expect(pedalValue(150, rect)).toBeCloseTo(0.75, 9);
  });
  it('fuera de la zona se recorta', () => {
    expect(pedalValue(400, rect)).toBe(0);
    expect(pedalValue(20, rect)).toBe(1);
    expect(pedalValue(150, { top: 0, height: 0 })).toBe(0);
  });
});
