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
