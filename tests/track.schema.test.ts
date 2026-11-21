import { describe, expect, it } from 'vitest';
import raw from '../public/track/interlagos.json';
import { parseTrackJson, SAMPLE_COLUMNS } from '../src/track/schema';
import { buildTrack } from '../src/track/track';

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

describe('Campos opcionales de borde de pista (b13)', () => {
  it('compatibilidad: sin campos opcionales usa trazada 0, pianos planos, hierba y guardarraíl', () => {
    const j = parseTrackJson(valid());
    expect(j.runoffs).toBeUndefined();
    expect(j.samples.rl).toBeUndefined();
    const t = buildTrack(j);
    expect(Array.from(t.rl)).toEqual([0, 0, 0]);
    expect(t.kerbs[0].type ?? 'flat').toBe('flat');
    expect(Array.from(t.runoffL)).toEqual([0, 0, 0]);
    expect(Array.from(t.barrierR)).toEqual([0, 0, 0]);
    expect(t.runoffs).toEqual([]); expect(t.barriers).toEqual([]); expect(t.boards).toEqual([]);
  });

  it('tramos válidos en interlagos.json', () => {
    const j = parseTrackJson(raw);
    const N = j.samples.s.length;
    expect(j.samples.rl).toHaveLength(N);
    for (const sp of [...j.runoffs!, ...j.barriers!]) {
      for (const s of [sp.s0, sp.s1]) { expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThan(j.length_m); }
      expect(['left', 'right']).toContain(sp.side);
    }
    expect(j.runoffs!.length).toBeGreaterThan(0);
    expect(j.barriers!.length).toBeGreaterThan(0);
    expect(j.boards!.length).toBeGreaterThan(0);
  });

  it('tipos y longitudes inválidos', () => {
    const a = valid(); a.runoffs = [{ s0: 0, s1: 1, side: 'left', type: 'sand' }];
    expect(() => parseTrackJson(a)).toThrow(/runoffs\[0\]\.type/);
    const b = valid(); b.barriers = [{ s0: 0, s1: 9, side: 'left', type: 'armco' }];
    expect(() => parseTrackJson(b)).toThrow(/barriers\[0\]\.s1/);
    const c = valid(); c.samples.rl = [0, 1];
    expect(() => parseTrackJson(c)).toThrow(/samples\.rl/);
    const d = valid(); d.kerbs[0].type = 'zigzag';
    expect(() => parseTrackJson(d)).toThrow(/kerbs\[0\]\.type/);
    const e = valid(); e.boards = [{ s: 1, side: 'left', m: 75 }];
    expect(() => parseTrackJson(e)).toThrow(/boards\[0\]\.m/);
  });

  it('tablas por muestra: tramo que cruza la meta y prevalencia del último', () => {
    const j = parseTrackJson({ ...valid(), runoffs: [{ s0: 2, s1: 0.5, side: 'right', type: 'gravel' }, { s0: 0, s1: 0.5, side: 'right', type: 'asphalt' }],
      barriers: [{ s0: 1, s1: 2, side: 'left', type: 'tecpro' }] });
    const t = buildTrack(j);
    expect(Array.from(t.runoffR)).toEqual([1, 0, 2]);
    expect(Array.from(t.barrierL)).toEqual([0, 1, 1]);
  });
});
