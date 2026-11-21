import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import raw from '../public/track/interlagos.json';
import { parseTrackJson } from '../src/track/schema';
import { buildTrack } from '../src/track/track';
import { buildTrackMeshes, buildRingPositions, gridSlotCenter } from '../src/track/mesh';
import { Simulation } from '../src/sim/simulation';
import { config } from '../src/shared/config';
import { createAsphaltTextures } from '../src/render/trackMaterials';
import { KERB_HEIGHT_M } from '../src/track/types';

const track = buildTrack(parseTrackJson(raw));
const m = buildTrackMeshes(track);
const meshes: THREE.Mesh[] = [];
m.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
const byName = (n: string) => meshes.find((x) => x.name === n)!;
const pos = (n: string) => byName(n).geometry.getAttribute('position');
// Solo los anillos compartidos están al inicio del buffer: 6 vértices en road
// (b13: la escapatoria va en mallas por material y el muro lo sustituyen las barreras de trackside)
const RING = { road: 6 } as const;

describe('Mallas de pista continuas', () => {
  it('el último anillo de cada trozo coincide con el primero del siguiente (incluido el cierre)', () => {
    for (const kind of ['road'] as const) {
      const V = RING[kind];
      for (let c = 0; c < m.chunks; c++) {
        const cur = pos(`${kind}-${c}`);
        const nxt = pos(`${kind}-${(c + 1) % m.chunks}`);
        // número de anillos del trozo = (vértices de anillo)/V; en road hay vértices de piano al final,
        // así que se calcula con el rango de índices
        const rings = ringsInChunk(c);
        const lastStart = (rings - 1) * V;
        for (let k = 0; k < V; k++) {
          for (let a = 0; a < 3; a++) {
            expect(Math.abs(cur.getComponent(lastStart + k, a) - nxt.getComponent(k, a))).toBeLessThan(1e-3);
          }
        }
      }
    }
  });

  it('el anillo 0 coincide con buildRingPositions(track, 0)', () => {
    const r = buildRingPositions(track, 0);
    const p = pos('road-0');
    for (let k = 0; k < 6; k++) for (let a = 0; a < 3; a++) expect(p.getComponent(k, a)).toBeCloseTo(r[k * 3 + a], 4);
  });

  it('sin NaN y normales de asfalto con Y > 0,9', () => {
    for (const mesh of meshes) {
      const arr = mesh.geometry.getAttribute('position').array as Float32Array;
      expect(arr.some(Number.isNaN), mesh.name).toBe(false);
    }
    for (const mesh of meshes.filter((x) => x.name.startsWith('road-'))) {
      const nor = mesh.geometry.getAttribute('normal');
      let minY = Infinity;
      for (let i = 0; i < nor.count; i++) minY = Math.min(minY, nor.getY(i));
      expect(minY, mesh.name).toBeGreaterThan(0.9);
    }
  });

  it('pianos 2–4 cm sobre el asfalto y sin geometría donde no hay piano', () => {
    let withKerb = 0, without = 0;
    for (let i = 0; i < track.n; i += 3) {
      const r = buildRingPositions(track, i);
      const yAsR = r[0 * 3 + 1], yAsL = r[1 * 3 + 1];
      const ks: [number, number, number][] = [[6, 0, track.kerbR[i]], [7, 0, track.kerbR[i]], [8, 1, track.kerbL[i]], [9, 1, track.kerbL[i]]];
      for (const [k, side, flag] of ks) {
        const dy = r[k * 3 + 1] - (side === 0 ? yAsR : yAsL);
        if (flag) {
          withKerb++;
          expect(dy).toBeGreaterThan(0.02); expect(dy).toBeLessThan(0.04);
          expect(dy).toBeCloseTo(KERB_HEIGHT_M, 2);
        } else {
          without++;
          expect(Math.abs(dy)).toBeLessThan(1e-6);
          // colapsado sobre el borde del asfalto
          const e = side === 0 ? 0 : 1;
          for (let a = 0; a < 3; a += 2) expect(Math.abs(r[k * 3 + a] - r[e * 3 + a])).toBeLessThan(1e-4);
        }
      }
    }
    expect(withKerb).toBeGreaterThan(0);
    expect(without).toBeGreaterThan(0);
  });
});

// Anillos por trozo (misma partición que mesh.ts)
function ringsInChunk(c: number): number {
  const n = track.n, C = m.chunks;
  const a = Math.floor((c * n) / C);
  const b = c === C - 1 ? n : Math.floor(((c + 1) * n) / C);
  return b - a + 1;
}

describe('Mallas dentro del presupuesto', () => {
  it('trozos, mallas, materiales y triángulos', () => {
    expect(m.chunks).toBeGreaterThanOrEqual(16);
    expect(m.chunks).toBeLessThanOrEqual(24);
    expect(meshes.length).toBeLessThanOrEqual(70);
    const mats = new Set(meshes.map((x) => x.material));
    expect(mats.size).toBeLessThanOrEqual(4);
    expect(m.triangles).toBeLessThan(150000);
    for (const mesh of meshes) expect(mesh.geometry.boundingSphere).not.toBeNull();
    for (let c = 0; c < m.chunks; c++) {
      const names = meshes.filter((x) => x.name.endsWith(`-${c}`)).map((x) => x.name);
      expect(names.length).toBeLessThanOrEqual(3);
    }
    expect(byName('start-line')).toBeDefined();
    expect(byName('ground')).toBeDefined();
  });
});

describe('Superficies (b6)', () => {
  it('UV finitas en todas las mallas', () => {
    for (const mesh of meshes) {
      const uv = mesh.geometry.getAttribute('uv');
      expect(uv).toBeDefined();
      const arr = uv.array as Float32Array;
      for (let i = 0; i < arr.length; i++) expect(Number.isFinite(arr[i])).toBe(true);
    }
  });

  it('texturas procedurales ≤ 1024 px y reproducibles', () => {
    const mat = m.materials.road as THREE.MeshStandardMaterial;
    for (const tex of [mat.map!, mat.roughnessMap!, (m.materials.grass as THREE.MeshStandardMaterial).map!]) {
      const { width, height } = tex.image as { width: number; height: number };
      expect(width).toBeLessThanOrEqual(1024);
      expect(height).toBeLessThanOrEqual(1024);
    }
    const a = createAsphaltTextures(7, 64).color.image.data as Uint8Array;
    const b = createAsphaltTextures(7, 64).color.image.data as Uint8Array;
    const c = createAsphaltTextures(8, 64).color.image.data as Uint8Array;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });
});

describe('Cajones de parrilla (b14 D1)', () => {
  it('cada cajón está centrado en la posición del coche k de Simulation.placeOnGrid (±0,5 m)', () => {
    const p = pos('start-line');
    const CHECKER = 12 * 2 * 4, PER_BOX = 16;
    expect(p.count).toBe(CHECKER + config.surfaces.gridSlots * PER_BOX);
    const sim = new Simulation(track);
    for (let k = 0; k < config.surfaces.gridSlots; k++) {
      let x = 0, z = 0;
      for (let v = 0; v < PER_BOX; v++) { x += p.getX(CHECKER + k * PER_BOX + v); z += p.getZ(CHECKER + k * PER_BOX + v); }
      x /= PER_BOX; z /= PER_BOX;
      sim.placeOnGrid(k);
      const c = sim.state.car;
      expect(Math.hypot(c.x - x, c.z - z), `cajón ${k}`).toBeLessThan(0.5);
      const g = gridSlotCenter(track, k);
      expect(Math.hypot(g.x - x, g.z - z)).toBeLessThan(0.05);
      expect(Math.sign(c.d)).toBe(k % 2 === 0 ? 1 : -1);
    }
  });
});
