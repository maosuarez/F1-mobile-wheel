import { describe, expect, it } from 'vitest';
import { assignVoices, nearestRivals } from '../src/audio/rivals';
import { config } from '../src/shared/config';

const r = (id: number, x: number, z = 0) => ({ id, cur: { x, z } });
const { rivalMaxM, rivalVoices } = config.audio;

describe('Sonido de rivales (b14 D7)', () => {
  it('elige los 2 más cercanos a menos de 80 m, del más cercano al más lejano', () => {
    expect(rivalMaxM).toBe(80);
    expect(rivalVoices).toBe(2);
    const rivals = [r(1, 50), r(2, -10), r(3, 0, 30), r(4, 79.9), r(5, 5, 5)];
    expect(nearestRivals(0, 0, rivals, rivalMaxM, rivalVoices)).toEqual([5, 2]);
  });

  it('ignora los que están a 80 m o más y devuelve menos si no hay suficientes', () => {
    expect(nearestRivals(0, 0, [r(1, 80), r(2, 0, -120), r(3, 60, 60)], rivalMaxM, rivalVoices)).toEqual([]);
    expect(nearestRivals(10, 10, [r(1, 95), r(2, 20, 10)], rivalMaxM, rivalVoices)).toEqual([2]);
  });

  it('nunca más de 2 voces y desempate determinista por id', () => {
    const ids = nearestRivals(0, 0, [r(4, 10), r(3, -10), r(9, 0, 10), r(1, 0, -10)], rivalMaxM, rivalVoices);
    expect(ids).toEqual([1, 3]);
  });

  it('las voces conservan su rival mientras siga entre los elegidos', () => {
    let v = assignVoices([null, null], [3, 7]);
    expect(v).toEqual([3, 7]);
    v = assignVoices(v, [7, 2]);
    expect(v).toEqual([2, 7]);
    v = assignVoices(v, []);
    expect(v).toEqual([null, null]);
  });
});
