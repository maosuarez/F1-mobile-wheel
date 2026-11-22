import { describe, expect, it, vi } from 'vitest';
import { KeyboardAdapter, KeyboardInput } from '../src/host/input/keyboard';
import { config } from '../src/shared/config';

const mk = () => {
  const down = new Set<string>();
  return { down, kb: new KeyboardInput({ isDown: (c) => down.has(c) }) };
};
const time = (kb: KeyboardInput, pick: (i: ReturnType<KeyboardInput['read']>) => number, target: (v: number) => boolean) => {
  const dt = 1 / 120;
  for (let i = 1; i < 240; i++) if (target(pick(kb.read(dt)))) return i * dt;
  return Infinity;
};

describe('KeyboardInput', () => {
  it('dirección sube a 1 entre 0,1 y 0,3 s y vuelve a 0 en < 0,2 s', () => {
    const { down, kb } = mk();
    down.add('ArrowRight');
    const up = time(kb, (i) => i.steer, (v) => v >= 1);
    expect(up).toBeGreaterThan(0.1); expect(up).toBeLessThan(0.3);
    down.clear();
    const fall = time(kb, (i) => i.steer, (v) => v <= 0);
    expect(fall).toBeLessThan(0.2);
  });
  it('izquierda es negativa y A/D equivalen', () => {
    const { down, kb } = mk();
    down.add('KeyA');
    for (let i = 0; i < 60; i++) kb.read(1 / 120);
    expect(kb.read(1 / 120).steer).toBe(-1);
  });
  it('pedales con rampa y valores acotados', () => {
    const { down, kb } = mk();
    down.add('KeyW');
    const first = kb.read(1 / 120);
    expect(first.throttle).toBeGreaterThan(0); expect(first.throttle).toBeLessThan(1);
    for (let i = 0; i < 60; i++) kb.read(1 / 120);
    const r = kb.read(1 / 120);
    expect(r.throttle).toBe(1); expect(r.brake).toBe(0);
    down.clear(); down.add('ArrowDown');
    for (let i = 0; i < 60; i++) kb.read(1 / 120);
    expect(kb.read(1 / 120)).toMatchObject({ throttle: 0, brake: 1 });
    expect(config.keyboard.pedalRiseS).toBeGreaterThan(0);
  });
  it('E mantenida genera un solo shiftUp; Q y F también por flanco', () => {
    const { down, kb } = mk();
    down.add('KeyE');
    for (let i = 0; i < 30; i++) kb.read(1 / 120);
    expect(kb.takeCommands()).toEqual(['shiftUp']);
    expect(kb.takeCommands()).toEqual([]);
    down.delete('KeyE'); kb.read(1 / 120);
    down.add('KeyE'); down.add('KeyQ'); down.add('KeyF');
    kb.read(1 / 120);
    expect(kb.takeCommands()).toEqual(['shiftUp', 'shiftDown', 'drs']);
  });
  it('Espacio da ers = true mientras dura', () => {
    const { down, kb } = mk();
    expect(kb.read(1 / 120).ers).toBe(false);
    down.add('Space');
    expect(kb.read(1 / 120).ers).toBe(true);
    expect(kb.read(1 / 120).ers).toBe(true);
    down.delete('Space');
    expect(kb.read(1 / 120).ers).toBe(false);
  });
});

describe('KeyboardAdapter sin alternancia de cambio', () => {
  it('KeyM no invoca ningún callback ni lanza', () => {
    const target = new EventTarget() as unknown as Window;
    const cb = { onRecenter: vi.fn(), onPause: vi.fn() };
    const ad = new KeyboardAdapter(target, cb);
    const ev = new Event('keydown') as Event & { code: string; repeat: boolean };
    ev.code = 'KeyM'; ev.repeat = false;
    expect(() => target.dispatchEvent(ev)).not.toThrow();
    expect(cb.onRecenter).not.toHaveBeenCalled();
    expect(cb.onPause).not.toHaveBeenCalled();
    ad.dispose();
  });
});

describe('KeyboardInput layouts (b15)', () => {
  const mkL = (layout: 'p1' | 'p2' | 'both') => {
    const down = new Set<string>();
    return { down, kb: new KeyboardInput({ isDown: (c) => down.has(c) }, layout) };
  };
  const run = (kb: KeyboardInput) => { let i = kb.read(1 / 120); for (let n = 0; n < 60; n++) i = kb.read(1 / 120); return i; };
  it('p1 ignora las flechas y p2 ignora WASD', () => {
    const a = mkL('p1'), b = mkL('p2');
    a.down.add('ArrowUp'); b.down.add('KeyW');
    expect(run(a.kb).throttle).toBe(0);
    expect(run(b.kb).throttle).toBe(0);
    a.down.clear(); b.down.clear();
    a.down.add('KeyW'); b.down.add('ArrowUp');
    expect(run(a.kb).throttle).toBe(1);
    expect(run(b.kb).throttle).toBe(1);
  });
  it('teclas independientes: una pulsación solo afecta a su jugador', () => {
    const down = new Set<string>();
    const ks = { isDown: (c: string) => down.has(c) };
    const p1 = new KeyboardInput(ks, 'p1'), p2 = new KeyboardInput(ks, 'p2');
    down.add('ArrowUp');
    expect(run(p1).throttle).toBe(0);
    expect(run(p2).throttle).toBe(1);
  });
  it('p2: dirección, freno, órdenes y ERS de config.split.p2Keys', () => {
    const { down, kb } = mkL('p2');
    down.add('ArrowLeft'); down.add('ArrowDown'); down.add('ShiftRight');
    const i = run(kb);
    expect(i.steer).toBe(-1); expect(i.brake).toBe(1); expect(i.ers).toBe(true);
    down.add('Period'); down.add('Comma'); down.add('Slash');
    kb.read(1 / 120);
    expect(kb.takeCommands()).toEqual(['shiftUp', 'shiftDown', 'drs']);
    kb.read(1 / 120);
    expect(kb.takeCommands()).toEqual([]);                  // flanco: sin repetición
  });
  it('p1: Q/E/F y Espacio; no usa las teclas de p2', () => {
    const { down, kb } = mkL('p1');
    down.add('KeyE'); down.add('Space'); down.add('Period');
    expect(kb.read(1 / 120).ers).toBe(true);
    expect(kb.takeCommands()).toEqual(['shiftUp']);
  });
  it('both (un jugador) mezcla WASD y flechas como antes', () => {
    const { down, kb } = mkL('both');
    down.add('ArrowUp'); down.add('KeyA');
    const i = run(kb);
    expect(i.throttle).toBe(1); expect(i.steer).toBe(-1);
  });
});
