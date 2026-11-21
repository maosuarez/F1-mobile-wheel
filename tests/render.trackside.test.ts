import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import raw from '../public/track/interlagos.json';
import { parseTrackJson } from '../src/track/schema';
import { buildTrack } from '../src/track/track';
import { locate } from '../src/track/query';
import { buildTrackMeshes, brakeMarkAt } from '../src/track/mesh';
import { createTrackMaterials } from '../src/render/trackMaterials';
import { buildTrackside, createTracksideMaterials, kerbTypeTables } from '../src/render/trackside';
import { objectCost } from '../src/render/scene';
import { QUALITY } from '../src/render/quality';
import { config } from '../src/shared/config';

const track = buildTrack(parseTrackJson(raw));
const tmats = createTrackMaterials(false);
const group = buildTrackside(track, createTracksideMaterials(tmats), QUALITY.high);
const meshes: THREE.Mesh[] = [];
group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
const byName = (n: string) => meshes.find((m) => m.name === n);

// Para cada muestra con barrera del tipo dado, distancia horizontal del punto del muro de la simulación
// (borde + runoff_m sobre la normal) al vértice más cercano de la malla de esa barrera. Rejilla de 1 m.
function wallGaps(mesh: THREE.Mesh, code: number): number[] {
  const p = mesh.geometry.getAttribute('position');
  const grid = new Map<string, number[]>();
  for (let v = 0; v < p.count; v++) {
    const key = `${Math.floor(p.getX(v))},${Math.floor(p.getZ(v))}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(v);
  }
  const gaps: number[] = [];
  for (let i = 0; i < track.n; i++) {
    for (const side of [1, -1]) {
      if ((side > 0 ? track.barrierL : track.barrierR)[i] !== code) continue;
      const d = side > 0 ? track.wl[i] + track.runoff : -(track.wr[i] + track.runoff);
      const x = track.x[i] + d * track.nx[i], z = track.z[i] + d * track.nz[i];
      let best = Infinity;
      for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) {
        for (const v of grid.get(`${Math.floor(x) + gx},${Math.floor(z) + gz}`) ?? []) best = Math.min(best, Math.hypot(p.getX(v) - x, p.getZ(v) - z));
      }
      gaps.push(best);
    }
  }
  return gaps;
}

describe('Kit de borde de pista (b13)', () => {
  it('barrera alineada con el muro físico: cara interna a borde + runoff_m ± 0,1 m', () => {
    for (const [name, code] of [['barrier-armco', 0], ['barrier-tecpro', 1], ['barrier-concrete', 2]] as const) {
      const m = byName(name);
      expect(m, name).toBeDefined();
      const gaps = wallGaps(m!, code);
      expect(gaps.length, name).toBeGreaterThan(0);
      expect(Math.max(...gaps), name).toBeLessThan(0.1);
    }
  });

  it('presupuesto: ≤ 15 draw calls y triángulos acotados', () => {
    const cost = objectCost(group);
    expect(meshes.length).toBeLessThanOrEqual(15);
    expect(cost.drawCalls).toBeLessThanOrEqual(15);
    expect(cost.triangles).toBeLessThan(200000);
    for (const m of meshes) {
      const arr = m.geometry.getAttribute('position').array as Float32Array;
      expect(arr.every(Number.isFinite), m.name).toBe(true);
    }
  });

  it('elementos presentes: pianos, tres barreras, valla, carteles y comisarios', () => {
    for (const n of ['kerbs', 'barrier-tecpro', 'barrier-armco', 'barrier-concrete', 'fence', 'boards-150', 'boards-100', 'boards-50', 'marshals']) {
      expect(byName(n), n).toBeDefined();
    }
    const boards = ['boards-150', 'boards-100', 'boards-50'].map((n) => (byName(n) as THREE.InstancedMesh).count);
    expect(boards.reduce((a, b) => a + b, 0)).toBe(track.boards.length);
    expect((byName('marshals') as THREE.InstancedMesh).count).toBe(Math.floor(track.length / config.trackside.marshalEveryM));
  });

  it('pianos con perfil: dentados hasta serratedH y salchichas hasta sausageH', () => {
    const types = kerbTypeTables(track);
    const has = (c: number) => types.L.includes(c) || types.R.includes(c);
    expect(has(1)).toBe(true);
    const p = byName('kerbs')!.geometry.getAttribute('position');
    // Altura máxima de los pianos sobre la línea central más cercana
    let maxH = 0, hint = 0;
    for (let v = 0; v < p.count; v++) {
      const loc = locate(track, p.getX(v), p.getZ(v), hint);
      hint = loc.i;
      maxH = Math.max(maxH, p.getY(v) - loc.y - loc.d * Math.tan(track.bank[loc.i]));
    }
    const T = config.trackside;
    expect(maxH).toBeGreaterThan((has(2) ? T.sausageH : T.serratedH) - 0.02);
    expect(maxH).toBeLessThan(Math.max(T.sausageH, T.serratedH) + 0.02);
  });
});

describe('Goma en la trazada (design D6)', () => {
  it('la estación más oscura de cada anillo está en rl', () => {
    const m = buildTrackMeshes(track, tmats);
    const road = m.group.getObjectByName('road-3') as THREE.Mesh;
    const pos = road.geometry.getAttribute('position'), col = road.geometry.getAttribute('color');
    const n = track.n, C = m.chunks;
    const a = Math.floor((3 * n) / C), b = Math.floor((4 * n) / C);
    const rings = b - a + 1, stations = 5;
    let checked = 0;
    for (let r = 0; r < rings; r += 5) {
      const i = a + r;
      if (brakeMarkAt(track, track.s[i]) > 0) continue;   // las marcas de frenada oscurecen las rodadas
      let best = -1, bestC = Infinity;
      for (let k = 0; k < stations; k++) {
        const v = rings * 6 + r * stations + k;
        if (col.getX(v) < bestC) { bestC = col.getX(v); best = v; }
      }
      const d = (pos.getX(best) - track.x[i]) * track.nx[i] + (pos.getZ(best) - track.z[i]) * track.nz[i];
      expect(Math.abs(d - track.rl[i])).toBeLessThan(0.05);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
    // La trazada no es la línea central en este tramo
    expect(Math.max(...Array.from(track.rl.subarray(a, b), Math.abs))).toBeGreaterThan(1);
  });
});
