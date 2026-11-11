import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import raw from '../public/track/interlagos.json';
import { parseTrackJson } from '../src/track/schema';
import { buildTrack } from '../src/track/track';
import { locateGlobal } from '../src/track/query';
import { buildEnvironment } from '../src/render/environment';
import { QUALITY } from '../src/render/quality';

const track = buildTrack(parseTrackJson(raw));

// Distancia por fuera del muro de la instancia (negativa si está dentro)
function beyondWall(x: number, z: number): number {
  const l = locateGlobal(track, x, z);
  return l.d >= 0 ? l.d - l.wallL : -l.d - l.wallR;
}
function positions(mesh: THREE.InstancedMesh): THREE.Vector3[] {
  const m = new THREE.Matrix4();
  return Array.from({ length: mesh.count }, (_, i) => mesh.getMatrixAt(i, m) && new THREE.Vector3().setFromMatrixPosition(m));
}
const get = (g: THREE.Group, n: string) => g.getObjectByName(n) as THREE.InstancedMesh;

describe('entorno', () => {
  it('Elementos fuera de la pista', () => {
    for (const level of ['high', 'low'] as const) {
      const g = buildEnvironment(track, QUALITY[level]);
      const trees = positions(get(g, 'tree-trunks'));
      expect(trees.length).toBeGreaterThanOrEqual(300);
      expect(trees.length).toBeLessThanOrEqual(QUALITY[level].trees);
      for (const p of trees) expect(beyondWall(p.x, p.z)).toBeGreaterThanOrEqual(3);
      const stands = positions(get(g, 'stands'));
      for (const p of stands) expect(beyondWall(p.x, p.z)).toBeGreaterThanOrEqual(3);
      // Cobertura de la recta principal: módulos de 12 m a lo largo de s
      const L = track.length;
      const rel = stands.map((p) => (locateGlobal(track, p.x, p.z).s - track.startS + L + 100) % L);
      expect(Math.max(...rel) - Math.min(...rel)).toBeGreaterThanOrEqual(300);
    }
  });

  it('Árboles respetan el nivel y son deterministas', () => {
    const a = get(buildEnvironment(track, QUALITY.medium), 'tree-trunks');
    const b = get(buildEnvironment(track, QUALITY.medium), 'tree-trunks');
    expect(a.count).toBe(QUALITY.medium.trees);
    expect(Array.from(a.instanceMatrix.array)).toEqual(Array.from(b.instanceMatrix.array));
  });

  it('Coste del entorno', () => {
    const g = buildEnvironment(track, QUALITY.high);
    let meshes = 0;
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
    expect(meshes).toBeLessThanOrEqual(8);
  });
});
