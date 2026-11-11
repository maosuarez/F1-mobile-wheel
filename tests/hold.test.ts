import { describe, it, expect } from 'vitest';
import { holdDetector } from '../src/shared/hold';

describe('holdDetector', () => {
  it('dispara una sola vez al cruzar el umbral', () => {
    const h = holdDetector(1000);
    const r: boolean[] = [];
    for (let i = 0; i < 15; i++) r.push(h.update(true, 100));
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(r[9]).toBe(true);
  });
  it('no dispara en un toque corto', () => {
    const h = holdDetector(1000);
    for (let i = 0; i < 3; i++) expect(h.update(true, 100)).toBe(false);
    expect(h.update(false, 16)).toBe(false);
  });
  it('se rearma al soltar', () => {
    const h = holdDetector(1000);
    expect(h.update(true, 1000)).toBe(true);
    h.update(false, 16);
    expect(h.update(true, 500)).toBe(false);
    expect(h.update(true, 500)).toBe(true);
  });
});
