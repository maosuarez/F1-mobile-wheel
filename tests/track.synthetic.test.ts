import { describe, expect, it } from 'vitest';
import { makeOvalTrack, makeStraightTrack } from '../src/track/synthetic';
import { locate, sampleAt } from '../src/track/query';

describe('pistas sintéticas', () => {
  it('recta con pendiente: altura en s = 1000 y curvatura nula', () => {
    const t = makeStraightTrack({ lengthM: 5000, pitch: -0.05 });
    expect(t.closed).toBe(false);
    expect(Math.abs(sampleAt(t, 1000).y - -50)).toBeLessThanOrEqual(0.1);
    for (let i = 0; i < t.n; i++) expect(t.k[i]).toBe(0);
    // Consulta de posición sobre la recta
    const loc = locate(t, 1000, 0, 500);
    expect(loc.s).toBeCloseTo(1000, 6);
    expect(Math.abs(loc.y - -50)).toBeLessThanOrEqual(0.1);
  });

  it('óvalo cerrado: longitud y curvatura en curvas', () => {
    const t = makeOvalTrack({ straightM: 1000, radiusM: 150 });
    const L = 2 * 1000 + 2 * Math.PI * 150;
    expect(t.closed).toBe(true);
    expect(Math.abs(t.length - L) / L).toBeLessThanOrEqual(0.01);
    // Longitud geométrica por las muestras
    let geo = 0;
    for (let i = 0; i < t.n; i++) {
      const j = (i + 1) % t.n;
      geo += Math.hypot(t.x[j] - t.x[i], t.z[j] - t.z[i]);
    }
    expect(Math.abs(geo - L) / L).toBeLessThanOrEqual(0.01);
    // Curvatura en el centro de cada curva
    for (const c of t.corners) {
      expect(Math.abs(sampleAt(t, c.s).k - 1 / 150) * 150).toBeLessThanOrEqual(0.05);
    }
    let curveSamples = 0;
    for (let i = 0; i < t.n; i++) {
      if (t.k[i] !== 0) { curveSamples++; expect(Math.abs(t.k[i] - 1 / 150) * 150).toBeLessThanOrEqual(0.05); }
    }
    expect(curveSamples).toBeGreaterThan(0);
  });
});
