import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../src/host/loop';
import { formatDelta, formatLapTime } from '../src/host/format';

const DT = 1 / 120;
const run = (fps: number, secs: number) => {
  const st = new FixedStepper(DT, 8);
  let total = 0;
  const frames = Math.round(fps * secs);
  for (let i = 0; i < frames; i++) total += st.advance(1 / fps).steps;
  return total;
};

describe('FixedStepper', () => {
  it('independiente de los fps', () => {
    expect(Math.abs(run(30, 10) - 1200)).toBeLessThanOrEqual(1);
    expect(Math.abs(run(144, 10) - 1200)).toBeLessThanOrEqual(1);
  });
  it('fotograma largo: máx 8 pasos y descarta el resto', () => {
    const st = new FixedStepper(DT, 8);
    expect(st.advance(2).steps).toBe(8);
    expect(st.advance(0).steps).toBe(0);
  });
  it('alpha en [0,1)', () => {
    const st = new FixedStepper(DT, 8);
    const r = st.advance(DT * 1.5);
    expect(r.steps).toBe(1);
    expect(r.alpha).toBeCloseTo(0.5, 6);
  });
  it('timescale multiplica tiempo y máximo de pasos', () => {
    const st = new FixedStepper(DT, 8);
    expect(st.advance(1 / 60, 4).steps).toBe(8);
    expect(st.advance(2, 4).steps).toBe(32);
  });
});

describe('formato', () => {
  it('tiempos', () => {
    expect(formatLapTime(78.4567)).toBe('1:18.457');
    expect(formatLapTime(null)).toBe('-:--.---');
    expect(formatLapTime(59.9996)).toBe('1:00.000');
  });
  it('delta', () => {
    expect(formatDelta(0.123)).toBe('+0.123');
    expect(formatDelta(-0.045)).toBe('−0.045');
    expect(formatDelta(null)).toBe('');
  });
});
