import { describe, it, expect } from 'vitest';
import { mapGamepad, EMPTY_GAMEPAD_STATE, type GamepadState } from '../src/host/input/gamepadMap';
import { config } from '../src/shared/config';

const pad = (axisX = 0, pressed: number[] = [], values: Record<number, number> = {}): GamepadState => ({
  axes: [axisX, 0, 0, 0],
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) || (values[i] ?? 0) > 0, value: values[i] ?? (pressed.includes(i) ? 1 : 0) })),
});

describe('mapGamepad', () => {
  it('dirección y pedales', () => {
    const r = mapGamepad(pad(-1, [], { 7: 0.5 }), EMPTY_GAMEPAD_STATE);
    expect(r.input.steer).toBeCloseTo(-1);
    expect(r.input.throttle).toBeCloseTo((0.5 - 0.05) / 0.95);
    expect(r.input.brake).toBe(0);
  });
  it('zona muerta del stick', () => {
    expect(mapGamepad(pad(0.05), EMPTY_GAMEPAD_STATE).input.steer).toBe(0);
  });
  it('expo aplicada y signo conservado', () => {
    const r = mapGamepad(pad(0.5), EMPTY_GAMEPAD_STATE).input.steer;
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(0.5);
    expect(mapGamepad(pad(-0.5), EMPTY_GAMEPAD_STATE).input.steer).toBeCloseTo(-r);
    expect(config.gamepad.steerExpo).toBe(1.4);
  });
  it('gatillos con zona muerta', () => {
    const r = mapGamepad(pad(0, [], { 6: 0.03, 7: 1 }), EMPTY_GAMEPAD_STATE).input;
    expect(r.brake).toBe(0);
    expect(r.throttle).toBe(1);
  });
  it('R1 sostenido emite un único shiftUp', () => {
    let prev = EMPTY_GAMEPAD_STATE; let n = 0;
    for (let i = 0; i < 10; i++) { const s = pad(0, [5]); n += mapGamepad(s, prev).commands.filter(c => c === 'shiftUp').length; prev = s; }
    expect(n).toBe(1);
  });
  it('L1 y Cuadrado por flanco', () => {
    expect(mapGamepad(pad(0, [4]), EMPTY_GAMEPAD_STATE).commands).toEqual(['shiftDown']);
    expect(mapGamepad(pad(0, [2]), EMPTY_GAMEPAD_STATE).commands).toEqual(['drs']);
    expect(mapGamepad(pad(0, [2]), pad(0, [2])).commands).toEqual([]);
  });
  it('ERS mantenido y acciones de UI', () => {
    expect(mapGamepad(pad(0, [1]), pad(0, [1])).ers).toBe(true);
    expect(mapGamepad(pad(0, [1]), EMPTY_GAMEPAD_STATE).input.ers).toBe(true);
    expect(mapGamepad(pad(0, [9, 3, 0]), EMPTY_GAMEPAD_STATE).ui).toEqual(['pause', 'camera', 'recenter']);
    expect(mapGamepad(pad(0, [9]), pad(0, [9])).ui).toEqual([]);
  });
  it('estado vacío o NaN no rompe', () => {
    const r = mapGamepad({ axes: [NaN], buttons: [] }, EMPTY_GAMEPAD_STATE);
    expect(r.input).toEqual({ steer: 0, throttle: 0, brake: 0, ers: false });
  });
});
