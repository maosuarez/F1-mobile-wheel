import { describe, expect, it } from 'vitest';
import raw from '../public/track/interlagos.json';
import { parseTrackJson } from '../src/track/schema';
import { buildTrack } from '../src/track/track';

describe('buildTrack (Interlagos)', () => {
  const json = parseTrackJson(raw);
  const t = buildTrack(json);

  it('expone N muestras, length y pista cerrada', () => {
    expect(t.n).toBe(json.samples.s.length);
    expect(t.length).toBe(json.length_m);
    expect(t.closed).toBe(true);
    for (const a of [t.s, t.x, t.y, t.z, t.wl, t.wr, t.nx, t.nz, t.tx, t.tz, t.k, t.pitch, t.bank]) {
      expect(a).toBeInstanceOf(Float64Array);
      expect(a.length).toBe(t.n);
    }
    expect(t.kerbL.length).toBe(t.n);
    expect(t.kerbR.length).toBe(t.n);
  });

  it('tangentes unitarias y = (−nz, nx)', () => {
    for (let i = 0; i < t.n; i++) {
      expect(Math.abs(Math.hypot(t.tx[i], t.tz[i]) - 1)).toBeLessThan(1e-9);
      expect(t.tx[i]).toBeCloseTo(-t.nz[i], 12);
      expect(t.tz[i]).toBeCloseTo(t.nx[i], 12);
    }
  });

  it('tangente alineada con el avance de las muestras', () => {
    for (let i = 0; i < t.n; i++) {
      const j = (i + 1) % t.n;
      const dx = t.x[j] - t.x[i], dz = t.z[j] - t.z[i];
      expect((dx * t.tx[i] + dz * t.tz[i]) / Math.hypot(dx, dz)).toBeGreaterThan(0.95);
    }
  });

  it('marca pianos por muestra', () => {
    const kb = json.kerbs.find((k) => k.side === 'left')!;
    const i = Math.round((kb.s0 + kb.s1) / 2 / t.step);
    expect(t.kerbL[i]).toBe(1);
  });

  it('JSON sin samples.wl falla con un mensaje que contiene samples.wl', () => {
    const bad = structuredClone(raw) as { samples: Record<string, unknown> };
    delete bad.samples.wl;
    expect(() => buildTrack(parseTrackJson(bad))).toThrow(/samples\.wl/);
    const unparsed = structuredClone(json) as unknown as { samples: Record<string, unknown> };
    delete unparsed.samples.wl;
    expect(() => buildTrack(unparsed as never)).toThrow(/samples\.wl/);
  });
});
