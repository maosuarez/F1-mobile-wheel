import { describe, expect, it } from 'vitest';
import { WarningCenter } from '../src/host/warnings';
import type { SimState } from '../src/sim/types';

const st = (overheated = false) => ({ car: { overheated } }) as unknown as SimState;

describe('WarningCenter', () => {
  it('sin eventos no hay aviso', () => { expect(new WarningCenter().current(st(), 0)).toBe(''); });
  it('REDUCCIÓN dura 1 s', () => {
    const w = new WarningCenter();
    w.push({ type: 'shiftRejected' }, 10);
    expect(w.current(st(), 10.5)).toBe('REDUCCIÓN');
    expect(w.current(st(), 10.9)).toBe('REDUCCIÓN');
    expect(w.current(st(), 11.1)).toBe('');
  });
  it('LÍMITES dura 3 s', () => {
    const w = new WarningCenter();
    w.push({ type: 'limits' }, 5);
    expect(w.current(st(), 7.9)).toBe('LÍMITES');
    expect(w.current(st(), 8.1)).toBe('');
  });
  it('MOTOR mientras dure el sobrecalentamiento y con prioridad máxima', () => {
    const w = new WarningCenter();
    w.push({ type: 'limits' }, 5); w.push({ type: 'shiftRejected' }, 5);
    expect(w.current(st(true), 5.5)).toBe('MOTOR');
    expect(w.current(st(true), 60)).toBe('MOTOR');
    expect(w.current(st(false), 5.5)).toBe('LÍMITES');
  });
  it('LÍMITES prevalece sobre REDUCCIÓN', () => {
    const w = new WarningCenter();
    w.push({ type: 'shiftRejected' }, 1); w.push({ type: 'limits' }, 1);
    expect(w.current(st(), 1.5)).toBe('LÍMITES');
    expect(w.current(st(), 4.5)).toBe('');
  });
  it('ignora eventos ajenos', () => {
    const w = new WarningCenter();
    w.push({ type: 'limiter' }, 1); w.push({ type: 'wallHit', speedMs: 5 }, 1);
    expect(w.current(st(), 1.1)).toBe('');
  });
});
