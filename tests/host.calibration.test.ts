import { describe, expect, it } from 'vitest';
import { needsCalibration, startsOnVrExit, telCal } from '../src/host/vr/calibration';

describe('calibración antes de la salida en VR (b20 D6)', () => {
  const base = { inVr: true, online: false, players: 1, wheelOk: true, wheelIsSource: true };
  it('en VR con el volante conectado y al mando se espera la calibración', () => {
    expect(needsCalibration(base)).toBe(true);
  });
  it('sin VR, online, 2 jugadores o sin volante al mando no hay espera', () => {
    expect(needsCalibration({ ...base, inVr: false })).toBe(false);
    expect(needsCalibration({ ...base, online: true })).toBe(false);
    expect(needsCalibration({ ...base, players: 2 })).toBe(false);
    expect(needsCalibration({ ...base, wheelOk: false })).toBe(false);
    expect(needsCalibration({ ...base, wheelIsSource: false })).toBe(false);
  });
  it('telemetría cal: durante la espera; online con VR en vestíbulo y cuenta atrás; nunca sin VR', () => {
    expect(telCal('calibrating', false, true)).toBe(true);
    expect(telCal('lobby', true, true)).toBe(true);
    expect(telCal('countdown', true, true)).toBe(true);
    expect(telCal('racing', true, true)).toBe(false);
    expect(telCal('countdown', false, true)).toBe(false);
    expect(telCal('countdown', true, false)).toBe(false);
    expect(telCal('pairing', false, false)).toBe(false);
  });
  it('al salir de VR durante la espera arranca la cuenta atrás; en otros estados no', () => {
    expect(startsOnVrExit('calibrating')).toBe(true);
    for (const st of ['pairing', 'countdown', 'racing', 'paused']) expect(startsOnVrExit(st)).toBe(false);
  });
});
