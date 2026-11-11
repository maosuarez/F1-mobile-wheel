import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { GamepadSource, findStandardPad, gamepadCanDrive, nextGamepadSource, type GamepadLike } from '../src/host/input/gamepad';
import { nextVrSource } from '../src/host/input/vrControllers';
import type { InputSource } from '../src/host/input/types';
import type { DriverInput } from '../src/sim/types';
import { Simulation } from '../src/sim/simulation';
import { makeStraightTrack } from '../src/track/synthetic';

const dt = config.sim.dt;

// Mando simulado con mapeo estándar: 17 botones, 4 ejes
function makePad(mapping = 'standard') {
  const pad = {
    mapping, connected: true,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };
  const press = (i: number, on = true, value = on ? 1 : 0) => { pad.buttons[i] = { pressed: on, value }; };
  return { pad, press };
}

const fake = (name: InputSource['name']): InputSource => ({
  name, read: () => ({ steer: 0, throttle: 0, brake: 0, ers: false }), takeCommands: () => [],
});

describe('GamepadSource', () => {
  it('conexión: detecta un mando estándar; ignora mapeos no estándar y huecos nulos', () => {
    const list: (GamepadLike | null)[] = [];
    const src = new GamepadSource(() => list);
    src.pollUi(16);
    expect(src.connected()).toBe(false);
    list.push(null, makePad('').pad);
    src.pollUi(16);
    expect(src.connected()).toBe(false);
    const { pad } = makePad();
    list.push(pad);
    src.pollUi(16);
    expect(src.connected()).toBe(true);
    expect(findStandardPad(list)).toBe(pad);
  });

  it('dirección y pedales desde el último sondeo; desconexión vuelve a neutro', () => {
    const { pad, press } = makePad();
    const list: (GamepadLike | null)[] = [pad];
    const src = new GamepadSource(() => list);
    pad.axes[0] = -1; press(7, true, 0.5);
    src.pollUi(16);
    const i = src.read(dt);
    expect(i.steer).toBe(-1);
    expect(i.throttle).toBeGreaterThan(0.4);
    expect(i.brake).toBe(0);
    list[0] = null;
    src.pollUi(16);
    expect(src.connected()).toBe(false);
    expect(src.read(dt)).toEqual({ steer: 0, throttle: 0, brake: 0, ers: false });
  });

  it('R1 mantenido 10 fotogramas → un único shiftUp; takeCommands vacía la cola', () => {
    const { pad, press } = makePad();
    const src = new GamepadSource(() => [pad]);
    press(5);
    for (let k = 0; k < 10; k++) src.pollUi(16);
    expect(src.takeCommands()).toEqual(['shiftUp']);
    expect(src.takeCommands()).toEqual([]);
  });

  it('UI por flanco y Share mantenido restartHoldMs → un solo restart', () => {
    const { pad, press } = makePad();
    const src = new GamepadSource(() => [pad]);
    press(9); press(3); press(0);
    expect(src.pollUi(16).sort()).toEqual(['camera', 'pause', 'recenter']);
    expect(src.pollUi(16)).toEqual([]);
    press(8);
    const evs: string[] = [];
    const frames = Math.ceil(config.race.restartHoldMs / 16) + 20;
    for (let k = 0; k < frames; k++) evs.push(...src.pollUi(16));
    expect(evs).toEqual(['restart']);
    press(8, false); src.pollUi(16); press(8);
    for (let k = 0; k < frames; k++) evs.push(...src.pollUi(16));
    expect(evs).toEqual(['restart', 'restart']);   // se rearma al soltar
  });

  it('el proveedor que lanza no rompe el sondeo', () => {
    const src = new GamepadSource(() => { throw new Error('sin permisos'); });
    expect(src.pollUi(16)).toEqual([]);
    expect(src.connected()).toBe(false);
  });

  it('neutro y marcha atrás en automático: L1 dos veces 1 → 0 → -1; R1 dos veces vuelve a 1', () => {
    const { pad, press } = makePad();
    const src = new GamepadSource(() => [pad]);
    const si = new Simulation(makeStraightTrack({ lengthM: 2000, halfWidthM: 8 }), structuredClone(config));
    si.assists.autoShift = true;
    si.state.car.gear = 1;
    const tap = (btn: number) => {
      press(btn); src.pollUi(16); press(btn, false); src.pollUi(16);
      si.step(src.read(dt), src.takeCommands());
      for (let k = 0; k < Math.ceil(config.gears.shiftCutS / dt) + 2; k++) si.step(src.read(dt), src.takeCommands());
    };
    tap(4); expect(si.state.car.gear).toBe(0);
    tap(4); expect(si.state.car.gear).toBe(-1);
    tap(5); expect(si.state.car.gear).toBe(0);
    tap(5); expect(si.state.car.gear).toBe(1);
  });
});

describe('nextGamepadSource (prioridad volante > VR > gamepad > teclado)', () => {
  const kb = fake('keyboard'), gp = fake('gamepad'), wheel = fake('wheel'), ctrl = fake('controllers'), ap = fake('autopilot');

  it('conexión: con mando y sin volante ni VR, sustituye al teclado', () => {
    expect(nextGamepadSource(kb, kb, gp, true, 'none', false)).toBe(gp);
    expect(nextGamepadSource(kb, kb, gp, true, 'lost', false)).toBe(gp);
    expect(nextGamepadSource(gp, kb, gp, true, 'none', false)).toBeNull();
  });

  it('prioridad: nunca sustituye al volante, a los mandos VR ni al piloto automático', () => {
    expect(nextGamepadSource(wheel, kb, gp, true, 'ok', false)).toBeNull();
    expect(nextGamepadSource(ctrl, kb, gp, true, 'none', true)).toBeNull();
    expect(nextGamepadSource(ap, kb, gp, true, 'none', false)).toBeNull();
    expect(gamepadCanDrive(true, 'ok', false)).toBe(false);
    expect(gamepadCanDrive(true, 'stale', false)).toBe(false);
    expect(gamepadCanDrive(true, 'none', true)).toBe(false);
  });

  it('desconexión, volante conectado o entrada en VR devuelven el teclado', () => {
    expect(nextGamepadSource(gp, kb, gp, false, 'none', false)).toBe(kb);
    expect(nextGamepadSource(gp, kb, gp, true, 'ok', false)).toBe(kb);
    // En VR: gamepad → teclado y, en el mismo fotograma, los mandos VR toman el teclado
    const s1 = nextGamepadSource(gp, kb, gp, true, 'none', true) ?? gp;
    expect(s1).toBe(kb);
    expect(nextVrSource(s1, kb, ctrl, true, 'none')).toBe(ctrl);
  });

  it('desconexión en carrera: el coche conserva su estado y el cambio sigue en automático', () => {
    const { pad, press } = makePad();
    const list: (GamepadLike | null)[] = [pad];
    const src = new GamepadSource(() => list);
    const si = new Simulation(makeStraightTrack({ lengthM: 2000, halfWidthM: 8 }), structuredClone(config));
    let source: InputSource = kb;
    const setSource = (s: InputSource) => { source = s; si.assists.autoShift = true; };
    const frame = () => {
      src.pollUi(16);
      const next = nextGamepadSource(source, kb, src, src.connected(), 'none', false);
      if (next) setSource(next);
      const input: DriverInput = source.read(dt, si.state);
      si.step(input, source.takeCommands());
    };
    press(7);
    for (let k = 0; k < 120; k++) frame();
    expect(source).toBe(src);
    const speed = si.state.car.speed;
    expect(speed).toBeGreaterThan(0);
    list[0] = null;
    frame();
    expect(source).toBe(kb);
    expect(si.assists.autoShift).toBe(true);
    expect(si.state.car.speed).toBeGreaterThan(speed * 0.9);
  });
});

describe('GamepadSource.rumble', () => {
  it('con actuador: reproduce dual-rumble', () => {
    const calls: unknown[][] = [];
    const { pad } = makePad();
    (pad as unknown as GamepadLike & { vibrationActuator: unknown }).vibrationActuator = {
      playEffect: (...a: unknown[]) => { calls.push(a); return Promise.resolve('complete'); },
    };
    const src = new GamepadSource(() => [pad as GamepadLike]);
    src.rumble('kerb');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('dual-rumble');
  });

  it('sin actuador, sin mando o con actuador que falla: no lanza', () => {
    const { pad } = makePad();
    expect(() => new GamepadSource(() => [pad as GamepadLike]).rumble('limits')).not.toThrow();
    expect(() => new GamepadSource(() => []).rumble('grass')).not.toThrow();
    const bad = { ...pad, vibrationActuator: { playEffect: () => { throw new Error('x'); } } };
    expect(() => new GamepadSource(() => [bad as GamepadLike]).rumble('shift')).not.toThrow();
    const rej = { ...pad, vibrationActuator: { playEffect: () => Promise.reject(new Error('x')) } };
    expect(() => new GamepadSource(() => [rej as GamepadLike]).rumble('limiter')).not.toThrow();
  });
});
