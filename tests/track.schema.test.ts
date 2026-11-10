import { describe, expect, it } from 'vitest';
import { parseTrackJson, SAMPLE_COLUMNS } from '../src/track/schema';

function valid(): any {
  const samples: Record<string, number[]> = {};
  for (const c of SAMPLE_COLUMNS) samples[c] = [0, 1, 2];
  return {
    id: 't', name: 'T', length_m: 3, direction: 'ccw', step_m: 1, samples,
    start_s: 0, sectors_s: [1, 2],
    drs_zones: [{ detect_s: 0, start_s: 1, end_s: 2 }],
    corners: [{ n: 1, name: 'A', s: 1 }],
    kerbs: [{ s0: 0, s1: 1, side: 'left' }],
    runoff_m: 10,
  };
}

describe('parseTrackJson', () => {
  it('acepta un objeto mínimo válido', () => {
    expect(parseTrackJson(valid()).id).toBe('t');
  });
  it('campo ausente', () => {
    const t = valid(); delete t.samples.wl;
    expect(() => parseTrackJson(t)).toThrow(/samples\.wl/);
  });
  it('tipo incorrecto', () => {
    const t = valid(); t.length_m = '3';
    expect(() => parseTrackJson(t)).toThrow(/length_m/);
  });
  it('columnas de distinta longitud', () => {
    const t = valid(); t.samples.x = [0, 1];
    expect(() => parseTrackJson(t)).toThrow(/samples\.x/);
  });
  it('valor no finito', () => {
    const t = valid(); t.samples.y[1] = NaN;
    expect(() => parseTrackJson(t)).toThrow(/samples\.y\[1\]/);
  });
  it('side inválido', () => {
    const t = valid(); t.kerbs[0].side = 'up';
    expect(() => parseTrackJson(t)).toThrow(/kerbs\[0\]\.side/);
  });
  it('sectors_s de longitud distinta de 2', () => {
    const t = valid(); t.sectors_s = [1];
    expect(() => parseTrackJson(t)).toThrow(/sectors_s/);
  });
  it('direction inválida', () => {
    const t = valid(); t.direction = 'x';
    expect(() => parseTrackJson(t)).toThrow(/direction/);
  });
});
