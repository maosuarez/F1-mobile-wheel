import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { applyDeadzone, mapControllers, rollFromQuaternion, stickShiftEdges, type StickShiftState } from '../src/host/input/vrControllersMap';
import { VrControllersSource, buttonEdges, controllersCanDrive, nextVrSource, type XrFrameProvider } from '../src/host/input/vrControllers';
import type { InputSource } from '../src/host/input/types';
import type { DriverInput } from '../src/sim/types';
import { Simulation } from '../src/sim/simulation';
import { makeStraightTrack } from '../src/track/synthetic';

const cfg = config.vr;
const dt = config.sim.dt;
const DEG45 = Math.PI / 4;

// Cuaternión de un roll θ a la derecha: rotación de -θ sobre +Z
const rollQuat = (theta: number) => ({ x: 0, y: 0, z: Math.sin(-theta / 2), w: Math.cos(-theta / 2) });

describe('mapControllers', () => {
  it('Conducción con mandos: 45° a la derecha + gatillo derecho → dirección positiva con rampa, sin saltos', () => {
    const target = Math.min(1, DEG45 / cfg.steerRangeRad);
    let steer = 0;
    const maxStep = cfg.steerRampPerS * dt + 1e-9;
    for (let i = 0; i < 200; i++) {
      const out = mapControllers({ rightTrigger: 0.8, leftTrigger: 0, rightRollRad: DEG45, prevSteer: steer }, dt, cfg);
      expect(out.steer).toBeGreaterThan(0);
      expect(Math.abs(out.steer - steer)).toBeLessThanOrEqual(maxStep);   // sin saltos
      expect(out.throttle).toBeGreaterThan(0);
      expect(out.brake).toBe(0);
      if (i === 0) expect(out.steer).toBeLessThan(target);                 // primer paso aún en la rampa
      steer = out.steer;
    }
    expect(steer).toBeCloseTo(target, 6);
  });

  it('roll desde cuaternión: positivo a la derecha, negativo a la izquierda', () => {
    const r = rollQuat(DEG45), l = rollQuat(-DEG45);
    expect(rollFromQuaternion(r.x, r.y, r.z, r.w)).toBeCloseTo(DEG45, 6);
    expect(rollFromQuaternion(l.x, l.y, l.z, l.w)).toBeCloseTo(-DEG45, 6);
    expect(rollFromQuaternion(0, 0, 0, 1)).toBeCloseTo(0, 9);
  });

  it('zona muerta de gatillos y reescalado', () => {
    expect(applyDeadzone(cfg.triggerDeadzone, cfg.triggerDeadzone)).toBe(0);
    expect(applyDeadzone(0.03, cfg.triggerDeadzone)).toBe(0);
    expect(applyDeadzone(1, cfg.triggerDeadzone)).toBe(1);
    expect(applyDeadzone(0.06, cfg.triggerDeadzone)).toBeGreaterThan(0);
    const out = mapControllers({ rightTrigger: 0.04, leftTrigger: 0.04, rightRollRad: 0, prevSteer: 0 }, dt, cfg);
    expect(out.throttle).toBe(0);
    expect(out.brake).toBe(0);
  });

  it('límites: dirección en [-1,1], pedales en [0,1], sin pose vuelve a 0 con rampa', () => {
    let steer = 0;
    for (let i = 0; i < 500; i++) steer = mapControllers({ rightTrigger: 2, leftTrigger: -1, rightRollRad: -Math.PI, prevSteer: steer }, dt, cfg).steer;
    expect(steer).toBe(-1);
    const o = mapControllers({ rightTrigger: 2, leftTrigger: 1.5, rightRollRad: null, prevSteer: steer }, dt, cfg);
    expect(o.throttle).toBe(1);
    expect(o.brake).toBe(1);
    expect(o.steer).toBeCloseTo(-1 + cfg.steerRampPerS * dt, 9);
    expect(mapControllers({ rightTrigger: NaN, leftTrigger: 0, rightRollRad: NaN, prevSteer: 0 }, dt, cfg))
      .toEqual({ steer: 0, throttle: 0, brake: 0, ers: false });
  });
});

// XR falso: solo lo que lee VrControllersSource
function fakeXr(rightTrigger: number, leftTrigger: number, theta: number | null): XrFrameProvider {
  const grip = {};
  const ref = {};
  const sources = [
    { handedness: 'right', gripSpace: grip, gamepad: { buttons: [{ value: rightTrigger }] } },
    { handedness: 'left', gripSpace: {}, gamepad: { buttons: [{ value: leftTrigger }] } },
  ];
  const frame = {
    getPose: (space: unknown) => (space === grip && theta !== null ? { transform: { orientation: rollQuat(theta) } } : undefined),
  };
  return {
    getSession: () => ({ inputSources: sources }) as unknown as XRSession,
    getFrame: () => frame as unknown as XRFrame,
    getReferenceSpace: () => ref as unknown as XRReferenceSpace,
  };
}

describe('VrControllersSource', () => {
  it('lee gatillos y roll del grip derecho y aplica la rampa entre lecturas', () => {
    const src = new VrControllersSource(fakeXr(1, 0.5, DEG45));
    expect(src.name).toBe('controllers');
    const a = src.read(dt);
    const b = src.read(dt);
    expect(a.throttle).toBe(1);
    expect(a.brake).toBeGreaterThan(0);
    expect(a.steer).toBeGreaterThan(0);
    expect(b.steer).toBeGreaterThan(a.steer);
    expect(src.takeCommands()).toEqual([]);
  });

  it('sin sesión devuelve entrada neutra', () => {
    const src = new VrControllersSource({ getSession: () => null, getFrame: () => null, getReferenceSpace: () => null });
    expect(src.read(dt)).toEqual({ steer: 0, throttle: 0, brake: 0, ers: false });
  });
});

describe('Prioridad del volante', () => {
  const stub = (name: InputSource['name'], input: DriverInput): InputSource => ({ name, read: () => input, takeCommands: () => [] });
  const keyboard = stub('keyboard', { steer: 0, throttle: 0, brake: 0, ers: false });
  const wheel = stub('wheel', { steer: -0.3, throttle: 0.2, brake: 0, ers: false });

  it('mandos solo con sesión VR y sin volante conectado', () => {
    expect(controllersCanDrive(true, 'none')).toBe(true);
    expect(controllersCanDrive(true, 'lost')).toBe(true);
    expect(controllersCanDrive(true, 'ok')).toBe(false);
    expect(controllersCanDrive(true, 'stale')).toBe(false);
    expect(controllersCanDrive(false, 'none')).toBe(false);
  });

  it('volante conectado en sesión VR: la entrada aplicada es la del volante y los mandos no alteran el coche', () => {
    const controllers = new VrControllersSource(fakeXr(1, 0, DEG45));
    let source: InputSource = wheel;
    for (const link of ['ok', 'stale'] as const) {
      const next = nextVrSource(source, keyboard, controllers, true, link);
      if (next) source = next;
      expect(source).toBe(wheel);
      expect(source.read(dt, undefined as never)).toEqual({ steer: -0.3, throttle: 0.2, brake: 0, ers: false });
    }
    // Aunque los mandos estuvieran conduciendo, al conectar el volante dejan de hacerlo
    expect(nextVrSource(controllers, keyboard, controllers, true, 'ok')).toBe(keyboard);
  });

  it('sin volante: teclado → mandos al entrar en VR y vuelta al teclado al salir', () => {
    const controllers = new VrControllersSource(fakeXr(1, 0, DEG45));
    expect(nextVrSource(keyboard, keyboard, controllers, true, 'none')).toBe(controllers);
    expect(nextVrSource(controllers, keyboard, controllers, true, 'none')).toBeNull();
    expect(nextVrSource(controllers, keyboard, controllers, false, 'none')).toBe(keyboard);
    expect(nextVrSource(keyboard, keyboard, controllers, false, 'none')).toBeNull();
  });
});

describe('Botones de los mandos (flanco de subida)', () => {
  const btn = { a: false, x: false };
  // Mandos falsos con buttons[4] (A en el derecho, X en el izquierdo) controlables desde el test
  const xr: XrFrameProvider = {
    getSession: () => ({ inputSources: [
      { handedness: 'right', gamepad: { buttons: [{ value: 0 }, {}, {}, {}, { pressed: btn.a }] } },
      { handedness: 'left', gamepad: { buttons: [{ value: 0 }, {}, {}, {}, { pressed: btn.x }] } },
    ] }) as unknown as XRSession,
    getFrame: () => null,
    getReferenceSpace: () => null,
  };

  it('mantener A no alterna la pausa en cada fotograma', () => {
    const src = new VrControllersSource(xr);
    btn.a = true;
    const events = Array.from({ length: 30 }, () => src.pollButtons()).flat();
    expect(events).toEqual(['pause']);
    btn.a = false;
    expect(src.pollButtons()).toEqual([]);
    btn.a = true;
    expect(src.pollButtons()).toEqual(['pause']);
    btn.a = false;
  });

  it('X recoloca una vez por pulsación', () => {
    const src = new VrControllersSource(xr);
    btn.x = true;
    expect(src.pollButtons()).toEqual(['recenter']);
    expect(src.pollButtons()).toEqual([]);
    btn.x = false;
  });

  it('B sostenido genera un solo restart; toque corto no; Y también', () => {
    const b = { r: false, l: false };
    const xr2: XrFrameProvider = {
      getSession: () => ({ inputSources: [
        { handedness: 'right', gamepad: { buttons: [{ value: 0 }, {}, {}, {}, {}, { pressed: b.r }] } },
        { handedness: 'left', gamepad: { buttons: [{ value: 0 }, {}, {}, {}, {}, { pressed: b.l }] } },
      ] }) as unknown as XRSession,
      getFrame: () => null,
      getReferenceSpace: () => null,
    };
    const src = new VrControllersSource(xr2);
    const hold = config.race.restartHoldMs;
    b.r = true;
    expect(src.pollButtons(300)).toEqual([]);
    b.r = false;
    expect(src.pollButtons(16)).toEqual([]);                        // toque corto
    b.r = true;
    const ev = Array.from({ length: 30 }, () => src.pollButtons(hold / 10)).flat();
    expect(ev).toEqual(['restart']);                                // un solo evento aunque siga pulsado
    b.r = false; src.pollButtons(16);
    b.l = true;
    expect(src.pollButtons(hold)).toEqual(['restart']);
    b.l = false;
  });

  it('buttonEdges puro', () => {
    expect(buttonEdges({ a: false, x: false }, { a: true, x: true })).toEqual(['pause', 'recenter']);
    expect(buttonEdges({ a: true, x: true }, { a: true, x: true })).toEqual([]);
    expect(buttonEdges({ a: true, x: false }, { a: false, x: false })).toEqual([]);
  });
});

describe('stickShiftEdges', () => {
  const run = (ys: number[]) => {
    let st: StickShiftState = { latched: false };
    const cmds: (string | null)[] = [];
    for (const y of ys) { const r = stickShiftEdges(st, y, cfg); st = r.state; if (r.cmd) cmds.push(r.cmd); }
    return cmds;
  };
  it('adelante → shiftUp una vez; atrás → shiftDown una vez', () => {
    expect(run([0, -0.9, 0])).toEqual(['shiftUp']);
    expect(run([0, 0.9, 0])).toEqual(['shiftDown']);
  });
  it('mantener 20 fotogramas no repite', () => {
    expect(run(Array(20).fill(-1))).toEqual(['shiftUp']);
  });
  it('rearme solo por debajo de 0.3 (histéresis)', () => {
    expect(run([-1, -0.5, -1, -0.35, -1])).toEqual(['shiftUp']);
    expect(run([-1, -0.2, -1])).toEqual(['shiftUp', 'shiftUp']);
    expect(run([0.5, 0.6])).toEqual([]);   // bajo el umbral de activación
  });
});

describe('VrControllersSource: palanca → órdenes de marcha', () => {
  const axes = { l: 0, r: 0 };
  const xr: XrFrameProvider = {
    getSession: () => ({ inputSources: [
      { handedness: 'right', gamepad: { buttons: [{ value: 0 }], axes: [0, 0, 0, axes.r] } },
      { handedness: 'left', gamepad: { buttons: [{ value: 0 }], axes: [0, 0, 0, axes.l] } },
    ] }) as unknown as XRSession,
    getFrame: () => null,
    getReferenceSpace: () => null,
  };
  const push = (src: VrControllersSource, which: 'l' | 'r', y: number) => {
    axes[which] = y; src.read(dt); axes[which] = 0; src.read(dt);
  };

  it('vacía la cola y reset limpia la palanca', () => {
    const src = new VrControllersSource(xr);
    axes.r = -1; src.read(dt); src.read(dt);
    expect(src.takeCommands()).toEqual(['shiftUp']);
    expect(src.takeCommands()).toEqual([]);
    src.reset(); src.read(dt);     // sigue empujada: tras reset cuenta como gesto nuevo
    expect(src.takeCommands()).toEqual(['shiftUp']);
    axes.r = 0; src.read(dt); src.takeCommands();
  });

  it('dos empujes atrás desde 1.ª parado: 1 → 0 → -1; adelante dos veces vuelve a 1', () => {
    const src = new VrControllersSource(xr);
    const si = new Simulation(makeStraightTrack({ lengthM: 2000, halfWidthM: 8 }), structuredClone(config));
    si.state.car.gear = 1;
    const idle: DriverInput = { steer: 0, throttle: 0, brake: 0, ers: false };
    const gesture = (which: 'l' | 'r', y: number) => {
      push(src, which, y);
      si.step(idle, src.takeCommands());
      for (let i = 0; i < Math.ceil(config.gears.shiftCutS / dt) + 2; i++) si.step(idle);   // corte de cambio
    };
    gesture('r', 0.9); expect(si.state.car.gear).toBe(0);
    gesture('l', 0.9); expect(si.state.car.gear).toBe(-1);
    gesture('r', -0.9); expect(si.state.car.gear).toBe(0);
    gesture('l', -0.9); expect(si.state.car.gear).toBe(1);
  });
});
