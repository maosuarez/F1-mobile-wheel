import { describe, expect, it } from 'vitest';
import raw from '../public/track/interlagos.json';
import { parseTrackJson } from '../src/track/schema';

const t = parseTrackJson(raw);
const S = t.samples;
const N = S.s.length;
const L = t.length_m;
const st = t.step_m;
const span = (a: number, b: number) => (((b - a) % L) + L) % L;
const maxAbs = (a: number[]) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const mean = (a: number[]) => a.reduce((m, v) => m + v, 0) / a.length;
const inRange = (lo: number, hi: number) => S.s.map((s, i) => (s >= lo && s <= hi ? i : -1)).filter((i) => i >= 0);
const minY = (lo: number, hi: number) => Math.min(...inRange(lo, hi).map((i) => S.y[i]));

describe('interlagos.json', () => {
  it('columnas completas y homogéneas', () => {
    expect(N).toBeGreaterThanOrEqual(2000);
    for (const c of Object.keys(S) as (keyof typeof S)[]) {
      expect(S[c].length).toBe(N);
      expect(S[c].every(Number.isFinite)).toBe(true);
    }
  });
  it('muestreo uniforme', () => {
    expect(S.s[0]).toBe(0);
    expect(maxAbs(S.s.map((s, i) => s - i * st))).toBeLessThan(0.002);
    expect(st).toBeGreaterThanOrEqual(1.9);
    expect(st).toBeLessThanOrEqual(2.1);
    expect(Math.abs(N * st - L)).toBeLessThan(0.01);
  });
  it('origen en la meta', () => {
    expect(Math.abs(S.x[0])).toBeLessThan(0.01);
    expect(Math.abs(S.y[0])).toBeLessThan(0.01);
    expect(Math.abs(S.z[0])).toBeLessThan(0.01);
    expect(t.start_s).toBe(0);
  });
  it('normal izquierda unitaria', () => {
    let maxAng = 0;
    for (let i = 0; i < N; i++) {
      const a = (i + 1) % N, b = (i - 1 + N) % N;
      const tx = S.x[a] - S.x[b], tz = S.z[a] - S.z[b];
      const m = Math.hypot(tx, tz);
      const nn = Math.hypot(S.nx[i], S.nz[i]);
      expect(nn).toBeGreaterThan(0.999);
      expect(nn).toBeLessThan(1.001);
      const cos = (S.nx[i] * (tz / m) + S.nz[i] * (-tx / m)) / nn;
      maxAng = Math.max(maxAng, (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI);
    }
    expect(maxAng).toBeLessThan(3);
  });
  it('longitud de Interlagos', () => {
    expect(L).toBeGreaterThanOrEqual(4266);
    expect(L).toBeLessThanOrEqual(4352);
  });
  it('cierre del bucle', () => {
    const gap = Math.hypot(S.x[N - 1] - S.x[0], S.z[N - 1] - S.z[0]);
    expect(gap).toBeGreaterThanOrEqual(1.5);
    expect(gap).toBeLessThanOrEqual(2.5);
    expect(Math.abs(S.y[N - 1] - S.y[0])).toBeLessThan(0.5);
  });
  it('sentido antihorario', () => {
    let a = 0;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      a += S.x[i] * -S.z[j] - S.x[j] * -S.z[i];
    }
    expect(a / 2).toBeGreaterThan(0);
    expect(t.direction).toBe('ccw');
  });
  it('curvatura sin picos', () => {
    expect(maxAbs(S.k)).toBeLessThan(0.12);
    expect(S.k.some((v) => v > 0)).toBe(true);
    expect(S.k.some((v) => v < 0)).toBe(true);
  });
  it('rango de anchos', () => {
    const w = S.wl.map((v, i) => v + S.wr[i]);
    expect(Math.min(...w)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...w)).toBeLessThanOrEqual(25);
    expect(Math.min(...S.wl)).toBeGreaterThanOrEqual(3);
    expect(Math.min(...S.wr)).toBeGreaterThanOrEqual(3);
  });
  it('desnivel total', () => {
    const r = Math.max(...S.y) - Math.min(...S.y);
    expect(r).toBeGreaterThanOrEqual(25);
    expect(r).toBeLessThanOrEqual(60);
  });
  it('bajada tras la S do Senna', () => {
    expect(minY(200, 1500)).toBeLessThanOrEqual(S.y[0] - 10);
  });
  it('subida de boxes', () => {
    expect(minY(2800, 3600)).toBeLessThanOrEqual(S.y[0] - 15);
    expect(mean(inRange(3200, 3800).map((i) => S.pitch[i]))).toBeGreaterThan(0.02);
  });
  it('pendiente coherente y suave', () => {
    let d = 0;
    for (let i = 1; i < N - 1; i++) d = Math.max(d, Math.abs(S.pitch[i] - (S.y[i + 1] - S.y[i - 1]) / (2 * st)));
    expect(d).toBeLessThan(0.01);
    expect(maxAbs(S.pitch)).toBeLessThan(0.15);
    expect(maxAbs(S.bank)).toBe(0);
  });
  it('sectores', () => {
    const [a, b] = t.sectors_s;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(L);
    expect(Math.min(a, b - a, L - b)).toBeGreaterThanOrEqual(0.15 * L);
  });
  it('zonas DRS de Interlagos', () => {
    expect(t.drs_zones.length).toBe(2);
    let contains0 = false;
    for (const z of t.drs_zones) {
      for (const v of [z.detect_s, z.start_s, z.end_s]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(L);
      }
      const len = span(z.start_s, z.end_s);
      expect(len).toBeGreaterThanOrEqual(300);
      expect(len).toBeLessThanOrEqual(1300);
      const idx = S.s.map((s, i) => (span(z.start_s, s) <= len ? i : -1)).filter((i) => i >= 0);
      expect(idx.filter((i) => Math.abs(S.k[i]) < 1 / 150).length / idx.length).toBeGreaterThanOrEqual(0.8);
      if (idx.includes(0)) contains0 = true;
    }
    expect(contains0).toBe(true);
  });
  it('curvas de Interlagos', () => {
    const c = t.corners;
    expect(c.length).toBeGreaterThanOrEqual(12);
    expect(c.length).toBeLessThanOrEqual(16);
    c.forEach((q, i) => {
      expect(q.n).toBe(i + 1);
      if (i > 0) expect(q.s).toBeGreaterThan(c[i - 1].s);
    });
    const names = c.map((q) => q.name);
    for (const n of ['S do Senna', 'Curva do Sol', 'Bico de Pato', 'Junção']) expect(names).toContain(n);
  });
  it('pianos procedurales', () => {
    const kb = t.kerbs;
    expect(kb.length).toBeGreaterThanOrEqual(8);
    for (const k of kb) {
      const len = span(k.s0, k.s1);
      expect(len).toBeGreaterThanOrEqual(20);
      expect(len).toBeLessThanOrEqual(400);
    }
    for (const side of ['left', 'right'] as const) {
      const q = kb.filter((k) => k.side === side).sort((a, b) => a.s0 - b.s0);
      q.forEach((k, i) => {
        const nx = q[(i + 1) % q.length];
        if (nx === k) return;
        const gap = span(k.s1, nx.s0);
        const overlap = span(nx.s0, k.s1) < span(k.s0, nx.s0);
        expect(overlap).toBe(false);
        expect(gap).toBeGreaterThanOrEqual(15);
      });
    }
  });
});
