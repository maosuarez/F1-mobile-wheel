import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import raw from '../public/track/interlagos.world.json';
import trackRaw from '../public/track/interlagos.json';
import { makeStraightTrack } from '../src/track/synthetic';
import { parseTrackJson } from '../src/track/schema';
import { buildTrack } from '../src/track/track';
import { locateGlobal } from '../src/track/query';
import { parseWorldJson } from '../src/track/world';
import { buildWorld, pointInRing } from '../src/render/world';
import { objectCost } from '../src/render/scene';
import { QUALITY } from '../src/render/quality';

// Pista recta de 400 m a lo largo de +x (semiancho 6 m, escapatoria 10 m → muro a 16 m)
const track = makeStraightTrack({ lengthM: 400, halfWidthM: 6, runoffM: 10 });
const mats = () => ({ grass: new THREE.MeshStandardMaterial({ vertexColors: true }), road: new THREE.MeshStandardMaterial({ vertexColors: true }) });
const forestRing = [50, -80, 250, -80, 250, 40, 50, 40];   // invade la pista: los árboles deben quedar fuera del muro

const world = parseWorldJson({
  id: 'synthetic', version: 1, attribution: '© OpenStreetMap contributors (ODbL)',
  terrain: { x0: -100, z0: -200, cell: 10, nx: 61, nz: 41, h: new Array(61 * 41).fill(0) },
  buildings: [
    { kind: 'pit', h: 9, y: 0, ring: [0, 30, 40, 30, 40, 45, 0, 45] },
    { kind: 'grandstand', h: 14, y: 1, ring: [100, -40, 160, -40, 160, -25, 100, -25] },
    { kind: 'tower', h: 40, y: -2, ring: [300, 60, 320, 60, 320, 80, 300, 80] },
    { kind: 'generic', h: 7, y: 0, ring: [-50, 60, -30, 60, -30, 80, -50, 80] },
    { kind: 'generic', h: 12, y: 0, ring: [-50, 100, -30, 100, -40, 120] },
  ],
  water: [{ ring: [300, -150, 350, -150, 350, -100], y: -1 }],
  forest: [{ ring: forestRing }],
  pitlane: { pts: [0, 0, 20, 100, 0, 20, 200, 0, 20], w: 10 },
});

function beyondWall(t: typeof track, x: number, z: number): number {
  const l = locateGlobal(t, x, z);
  return l.d >= 0 ? l.d - l.wallL : -l.d - l.wallR;
}
function positions(mesh: THREE.InstancedMesh): THREE.Vector3[] {
  const m = new THREE.Matrix4();
  return Array.from({ length: mesh.count }, (_, i) => mesh.getMatrixAt(i, m) && new THREE.Vector3().setFromMatrixPosition(m));
}

describe('entorno real', () => {
  it('mallas ≤ 12 y elementos esperados', () => {
    const g = buildWorld(world, track, mats(), QUALITY.high);
    const meshes: THREE.Mesh[] = [];
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBeLessThanOrEqual(12);
    expect(objectCost(g).drawCalls).toBeLessThanOrEqual(12);
    for (const n of ['terrain-0', 'buildings-pit', 'buildings-grandstand', 'buildings-tower', 'buildings-generic', 'water', 'pitlane', 'tree-trunks', 'tree-crowns'])
      expect(g.getObjectByName(n), n).toBeTruthy();
    expect(g.getObjectByName('skyline')).toBeUndefined();
  });

  it('edificios con la altura correcta', () => {
    const g = buildWorld(world, track, mats(), QUALITY.high);
    const top = (n: string) => { const m = g.getObjectByName(n) as THREE.Mesh; m.geometry.computeBoundingBox(); return m.geometry.boundingBox!.max.y; };
    expect(top('buildings-pit')).toBeCloseTo(9);
    expect(top('buildings-grandstand')).toBeCloseTo(15);
    expect(top('buildings-tower')).toBeCloseTo(38);
    expect(top('buildings-generic')).toBeCloseTo(12);
  });

  it('paredes y tapas con normales hacia fuera y arriba', () => {
    const g = buildWorld(world, track, mats(), QUALITY.high);
    const geo = (g.getObjectByName('buildings-tower') as THREE.Mesh).geometry;
    const P = geo.getAttribute('position'), I = geo.getIndex()!;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), mid = new THREE.Vector3();
    for (let t = 0; t < I.count; t += 3) {
      a.fromBufferAttribute(P, I.getX(t)); b.fromBufferAttribute(P, I.getX(t + 1)); c.fromBufferAttribute(P, I.getX(t + 2));
      n.crossVectors(b.clone().sub(a), c.clone().sub(a));
      mid.copy(a).add(b).add(c).divideScalar(3);
      // Centro de la torre (310, 70): la normal se aleja del centro o apunta arriba
      const out = n.x * (mid.x - 310) + n.z * (mid.z - 70) + n.y;
      expect(out).toBeGreaterThan(0);
    }
  });

  it('árboles dentro de los bosques y fuera del muro', () => {
    for (const level of ['high', 'low'] as const) {
      const g = buildWorld(world, track, mats(), QUALITY[level]);
      const trees = positions(g.getObjectByName('tree-trunks') as THREE.InstancedMesh);
      expect(trees.length).toBeGreaterThan(0);
      expect(trees.length).toBeLessThanOrEqual(QUALITY[level].trees);
      for (const p of trees) {
        expect(pointInRing(forestRing, p.x, p.z)).toBe(true);
        expect(beyondWall(track, p.x, p.z)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('Interlagos: presupuesto del entorno', () => {
    const t = buildTrack(parseTrackJson(trackRaw));
    const g = buildWorld(parseWorldJson(raw), t, mats(), QUALITY.high);
    const cost = objectCost(g);
    expect(cost.drawCalls).toBeLessThanOrEqual(12);
    expect(cost.triangles).toBeLessThan(400_000);
  });
});
