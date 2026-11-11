import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { canShiftTo, gearTopMs, ledsFor, powerFactor, rpmFor } from '../src/sim/gearbox';
import { ms } from './helpers/drive';

const cfg = config;

describe('Caja: funciones puras', () => {
  it('relaciones: cada marcha llega al limitador a su velocidad tope', () => {
    expect(gearTopMs(2, cfg)).toBeCloseTo(ms(130), 9);
    expect(gearTopMs(8, cfg)).toBeCloseTo(ms(350), 9);
    expect(gearTopMs(-1, cfg)).toBeCloseTo(ms(60), 9);
    expect(rpmFor(ms(130), 2, cfg)).toBeCloseTo(12500, 6);
  });

  it('ralentí: parado en 1.ª, RPM = 4 000 ± 100', () => {
    expect(Math.abs(rpmFor(0, 1, cfg) - 4000)).toBeLessThanOrEqual(100);
    expect(rpmFor(5, 0, cfg)).toBe(4000);
  });

  it('progresión de LEDs: 9 000 → 0, 10 700 → 6–8, 12 000 → 15, 12 500 → 16', () => {
    expect(ledsFor(9000, cfg)).toBe(0);
    const mid = ledsFor(10700, cfg);
    expect(mid).toBeGreaterThanOrEqual(6);
    expect(mid).toBeLessThanOrEqual(8);
    expect(ledsFor(12000, cfg)).toBe(15);
    expect(ledsFor(12500, cfg)).toBe(16);
  });

  it('powerFactor en 4 000 / 9 000 / 12 000 / 12 500', () => {
    expect(powerFactor(4000, cfg)).toBeCloseTo(0.45, 9);
    expect(powerFactor(9000, cfg)).toBeCloseTo(1, 9);
    expect(powerFactor(12000, cfg)).toBeCloseTo(1, 9);
    expect(powerFactor(12500, cfg)).toBe(0);
    expect(powerFactor(8000, cfg)).toBeLessThan(1);
  });

  it('reducción rechazada: 8.ª → 7.ª a 320 km/h', () => {
    expect(canShiftTo(7, 8, ms(320), cfg)).toBe(false);
  });

  it('reducción aceptada: 8.ª → 7.ª a 250 km/h', () => {
    expect(canShiftTo(7, 8, ms(250), cfg)).toBe(true);
  });

  it('marcha atrás: solo desde N y por debajo de 5 km/h', () => {
    expect(canShiftTo(-1, 0, 0, cfg)).toBe(true);
    expect(canShiftTo(-1, 0, ms(40), cfg)).toBe(false);
    expect(canShiftTo(-1, 1, 0, cfg)).toBe(false);
    expect(canShiftTo(0, 1, ms(40), cfg)).toBe(true);
  });
});
