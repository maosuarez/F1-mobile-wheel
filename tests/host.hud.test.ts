import { describe, expect, it } from 'vitest';
import { hudModel } from '../src/host/hudModel';
import type { SimState } from '../src/sim/types';

const mk = (car: object = {}, timing: object = {}) => ({
  t: 0, stepCount: 0,
  car: { speed: 50, gear: 5, leds: 9, drs: 0, ersCharge: 1, overtake: false, ...car },
  timing: { lap: 2, lapTimeS: 30, lastLapS: null, lastLapValid: true, bestLapS: null, sector: 1, sectorTimesS: [null, null, null],
    lastSectorTimesS: [null, null, null], lapValid: true, deltaS: null, ...timing },
}) as unknown as SimState;
const none = [null, null, null];

describe('hudModel', () => {
  it('Marcha y LEDs: 5.ª con 9 LEDs', () => {
    const m = hudModel(mk(), '', none);
    expect(m.gear).toBe('5'); expect(m.ledsOn).toBe(9); expect(m.blink).toBe(false);
    expect(m.speed).toBe('180');
  });
  it('etiquetas R y N', () => {
    expect(hudModel(mk({ gear: -1 }), '', none).gear).toBe('R');
    expect(hudModel(mk({ gear: 0 }), '', none).gear).toBe('N');
  });
  it('Limitador: leds 16 enciende los 15 y parpadea', () => {
    const m = hudModel(mk({ leds: 16 }), '', none);
    expect(m.ledsOn).toBe(15); expect(m.blink).toBe(true);
  });
  it('Batería: 0,42 con adelantamiento', () => {
    const m = hudModel(mk({ ersCharge: 0.42, overtake: true, drs: 1 }), '', none);
    expect(m.ersPct).toBe(42); expect(m.overtake).toBe(true); expect(m.drs).toBe(1);
  });
  it('Delta: −0,234 en verde, positivo en rojo', () => {
    const a = hudModel(mk({}, { deltaS: -0.234 }), '', none);
    expect(a.delta).toBe('−0.234'); expect(a.deltaTone).toBe('neg');
    expect(hudModel(mk({}, { deltaS: 0.1 }), '', none).deltaTone).toBe('pos');
    expect(hudModel(mk(), '', none).deltaTone).toBe('none');
  });
  it('Sector mejorado / peor / sin completar', () => {
    const m = hudModel(mk({}, { sector: 2, sectorTimesS: [20, 25, null] }), '', [21, 24, null]);
    expect(m.sectors).toEqual(['better', 'slower', 'none']);
  });
  it('sector 3 de la vuelta anterior justo tras la meta', () => {
    const m = hudModel(mk({}, { sector: 0, lapTimeS: 1, lastSectorTimesS: [20, 25, 30] }), '', [20, 25, 31]);
    expect(m.sectors).toEqual(['none', 'none', 'better']);
  });
  it('Vuelta inválida: tiempo en curso y última tachados', () => {
    const m = hudModel(mk({}, { lapValid: false, lastLapS: 80, lastLapValid: false }), '', none);
    expect(m.lapTimeInvalid).toBe(true); expect(m.lastInvalid).toBe(true);
    const ok = hudModel(mk({}, { lastLapS: 80 }), '', none);
    expect(ok.lapTimeInvalid).toBe(false); expect(ok.lastInvalid).toBe(false);
  });
  it('aviso y automático pasan tal cual', () => {
    const m = hudModel(mk(), 'MOTOR', none, false);
    expect(m.warn).toBe('MOTOR'); expect(m.auto).toBe(false);
  });
});
