import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { VrMinimap } from '../src/host/vr/minimap';

const fakeCanvas = () => ({ width: 256, height: 256, getContext: () => ({}) }) as unknown as HTMLCanvasElement;

describe('VrMinimap', () => {
  it('posición: x>0, y<0, z=-d y sin intersección con el panel', () => {
    const m = new VrMinimap(fakeCanvas());
    const p = m.mesh.position;
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(0);
    expect(p.z).toBeCloseTo(-config.vr.hudDistanceM);
    const box = (o: THREE.Mesh) => new THREE.Box3().setFromObject(o);
    const panel = { mesh: new THREE.Mesh(new THREE.PlaneGeometry(...config.vr.hudSizeM)) };
    const d = config.vr.hudDistanceM, [w, h] = config.vr.hudSizeM;
    panel.mesh.position.set(-(w / 2 + 0.07 * d), -(h / 2 + 0.12 * d), -d);
    m.mesh.updateMatrixWorld(); panel.mesh.updateMatrixWorld();
    expect(box(m.mesh).intersectsBox(box(panel.mesh))).toBe(false);
  });
  it('refresco: 30 versiones nuevas = 30 subidas; sin cambio = 0', () => {
    const m = new VrMinimap(fakeCanvas());
    const tex = (m.mesh.material as THREE.MeshBasicMaterial).map!;
    m.update(0); const base = tex.version;
    for (let v = 1; v <= 30; v++) m.update(v);
    expect(tex.version - base).toBe(30);
    const after = tex.version;
    for (let i = 0; i < 10; i++) m.update(30);
    expect(tex.version - after).toBe(0);
  });
});
