import { describe, expect, it } from 'vitest';
import raw from '../public/track/interlagos.world.json';
import { parseWorldJson, terrainHeight } from '../src/track/world';

function minimal(): Record<string, unknown> {
  return {
    id: 'mini', version: 1, attribution: '© OpenStreetMap contributors (ODbL)',
    terrain: { x0: 0, z0: 0, cell: 10, nx: 2, nz: 2, h: [0, 10, 20, 30] },
    buildings: [{ kind: 'pit', h: 9, y: 0, ring: [0, 0, 10, 0, 10, 10, 0, 10] }],
    water: [{ ring: [0, 0, 5, 0, 5, 5], y: -1 }],
    forest: [{ ring: [0, 0, 5, 0, 5, 5] }],
    pitlane: { pts: [0, 0, 0, 10, 0, 0], w: 10 },
  };
}

describe('world.json', () => {
  it('JSON válido mínimo', () => {
    const w = parseWorldJson(minimal());
    expect(w.id).toBe('mini');
    expect(Array.from(w.terrain.h)).toEqual([0, 1, 2, 3]);   // dm → m
    expect(w.buildings[0].kind).toBe('pit');
    expect(w.pitlane?.w).toBe(10);
    expect(terrainHeight(w, 5, 5)).toBeCloseTo(1.5);
  });

  it('h con longitud incorrecta lanza', () => {
    const j = minimal();
    (j.terrain as { h: number[] }).h = [0, 1, 2];
    expect(() => parseWorldJson(j)).toThrow(/terrain\.h/);
  });

  it('anillo impar lanza', () => {
    const j = minimal();
    (j.buildings as { ring: number[] }[])[0].ring = [0, 0, 10, 0, 10, 10, 0];
    expect(() => parseWorldJson(j)).toThrow(/par/);
  });

  it('pitlane nulo es válido', () => {
    const j = minimal();
    j.pitlane = null;
    expect(parseWorldJson(j).pitlane).toBeNull();
  });

  it('interlagos.world.json valida', () => {
    const w = parseWorldJson(raw);
    expect(w.id).toBe('interlagos');
    expect(w.attribution).toContain('OpenStreetMap');
    expect(w.terrain.h.length).toBe(w.terrain.nx * w.terrain.nz);
    expect(w.buildings.some((b) => b.kind === 'pit')).toBe(true);
    expect(w.buildings.some((b) => b.kind === 'grandstand')).toBe(true);
    expect(w.water.length).toBeGreaterThan(0);
    expect(w.pitlane).not.toBeNull();
  });
});
