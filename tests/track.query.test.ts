import { describe, expect, it } from 'vitest';
import raw from '../public/track/interlagos.json';
import { parseTrackJson } from '../src/track/schema';
import { buildTrack } from '../src/track/track';
import { crossedStart, deltaS, drsZoneAt, locate, locateGlobal, sampleAt, sectorAt, wrapS } from '../src/track/query';
import type { Track } from '../src/track/types';

const t = buildTrack(parseTrackJson(raw));
const L = t.length;

// Punto de mundo a partir de la muestra i desplazado d0 a lo largo de la normal.
const pointAt = (i: number, d0: number) => ({ x: t.x[i] + d0 * t.nx[i], z: t.z[i] + d0 * t.nz[i] });

describe('Localización en coordenadas de pista', () => {
  it('puntos conocidos en Interlagos', () => {
    for (let k = 0; k < 200; k++) {
      const i = Math.floor((k * t.n) / 200);
      for (const d0 of [-5, 0, 4]) {
        const p = pointAt(i, d0);
        const loc = locate(t, p.x, p.z, i);
        expect(Math.abs(deltaS(t, t.s[i], loc.s))).toBeLessThan(0.25);
        expect(Math.abs(loc.d - d0)).toBeLessThan(0.25);
      }
    }
  });

  it('seguimiento continuo en la costura', () => {
    let s = L - 30;
    let p = sampleAt(t, s);
    let loc = locate(t, p.x, p.z, Math.round(s / t.step));
    let prev = loc.s;
    for (let step = 0; step < 60; step++) {
      s = wrapS(t, s + 1);
      p = sampleAt(t, s);
      loc = locate(t, p.x, p.z, loc.i);
      const ds = deltaS(t, prev, loc.s);
      expect(ds).toBeGreaterThan(0);
      expect(ds).toBeLessThanOrEqual(1.5);
      prev = loc.s;
    }
    expect(Math.abs(deltaS(t, loc.s, 30))).toBeLessThan(0.25);
  });

  it('recuperación tras teletransporte', () => {
    let checked = 0;
    for (let i = 0; i < t.n; i += 37) {
      const p = pointAt(i, 2);
      // Índice previo con la muestra a más de 200 m del punto
      let hint = (i + Math.floor(t.n / 2)) % t.n;
      while (Math.hypot(t.x[hint] - p.x, t.z[hint] - p.z) <= 200) hint = (hint + 7) % t.n;
      expect(locate(t, p.x, p.z, hint)).toEqual(locateGlobal(t, p.x, p.z));
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('altura interpolada a mitad de dos muestras', () => {
    for (const i of [100, 700, 1500, 2100]) {
      const j = i + 1;
      const loc = locate(t, (t.x[i] + t.x[j]) / 2, (t.z[i] + t.z[j]) / 2, i);
      const lo = Math.min(t.y[i], t.y[j]), hi = Math.max(t.y[i], t.y[j]);
      expect(loc.y).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(loc.y).toBeLessThanOrEqual(hi + 1e-9);
      expect(Math.abs(loc.y - (t.y[i] + t.y[j]) / 2)).toBeLessThan(0.01);
    }
  });
});

describe('Clasificación de superficie', () => {
  // Muestra dentro de un piano izquierdo y otra sin piano derecho
  const iKerbL = (() => {
    const kb = t.kerbs.find((k) => k.side === 'left')!;
    return Math.round((kb.s0 + kb.s1) / 2 / t.step);
  })();
  const iNoKerbR = (() => {
    for (let i = 10; i < t.n; i++) if (!t.kerbR[i] && !t.kerbR[i - 1] && !t.kerbR[i + 1]) return i;
    throw new Error('sin muestra libre de piano derecho');
  })();

  it('asfalto', () => {
    for (const i of [iKerbL, iNoKerbR, 50, 1200]) {
      for (const d0 of [t.wl[i] - 0.05, 0, -(t.wr[i] - 0.05)]) {
        const p = pointAt(i, d0);
        const loc = locate(t, p.x, p.z, i);
        expect(loc.surface).toBe('asphalt');
        expect(loc.kerbSide).toBeNull();
      }
    }
  });

  it('piano', () => {
    const p = pointAt(iKerbL, t.wl[iKerbL] + 0.6);
    const loc = locate(t, p.x, p.z, iKerbL);
    expect(loc.surface).toBe('kerb');
    expect(loc.kerbSide).toBe('left');
  });

  it('hierba junto a un piano', () => {
    const p = pointAt(iKerbL, t.wl[iKerbL] + 1.5);
    const loc = locate(t, p.x, p.z, iKerbL);
    expect(loc.surface).toBe('grass');
    expect(loc.kerbSide).toBeNull();
  });

  it('hierba sin piano', () => {
    const p = pointAt(iNoKerbR, -(t.wr[iNoKerbR] + 0.6));
    const loc = locate(t, p.x, p.z, iNoKerbR);
    expect(loc.surface).toBe('grass');
  });

  it('distancia al muro = borde + runoff', () => {
    const loc = locate(t, t.x[iKerbL], t.z[iKerbL], iKerbL);
    expect(loc.wallL).toBeCloseTo(loc.wl + t.runoff, 9);
    expect(loc.wallR).toBeCloseTo(loc.wr + t.runoff, 9);
  });
});

describe('Consultas de zonas y de meta', () => {
  const t2: Track = {
    ...t, length: 4309, sectorsS: [1400, 2900],
    drsZones: [{ detect_s: 3700, start_s: 3900, end_s: 250 }],
  };

  it('zona DRS que cruza la meta', () => {
    expect(drsZoneAt(t2, 4200)).toBe(0);
    expect(drsZoneAt(t2, 100)).toBe(0);
    expect(drsZoneAt(t2, 300)).toBe(-1);
  });

  it('sectores', () => {
    expect(sectorAt(t2, 10)).toBe(0);
    expect(sectorAt(t2, 1400)).toBe(1);
    expect(sectorAt(t2, 4000)).toBe(2);
  });

  it('cruce hacia delante', () => {
    expect(crossedStart(t2, t2.length - 0.4, 0.3)).toBe(true);
  });

  it('cruce hacia atrás', () => {
    expect(crossedStart(t2, 0.3, t2.length - 0.4)).toBe(false);
  });
});
