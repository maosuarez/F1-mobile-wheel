import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RivalsRender, type RivalRenderState } from '../src/render/rivals';
import { TEAMS } from '../src/shared/teams';

const teams = TEAMS.map((t) => ({ primary: t.primary, accent: t.accent }));
const rival = (i: number, x: number, over: Partial<RivalRenderState> = {}): RivalRenderState => ({
  team: 1 + (i >> 1) % 4, prev: { x, y: 0, z: i * 3, yaw: 0.1 }, cur: { x: x + 1, y: 0, z: i * 3, yaw: 0.2 },
  pitch: 0, vLong: 30, steerAngle: 0.05, ...over,
});
const camera = () => {
  const c = new THREE.PerspectiveCamera();
  c.position.set(0, 2, 0);
  c.lookAt(1, 2, 0);              // mira hacia +X
  c.updateMatrixWorld(true);
  return c;
};

describe('Render de rivales (b14 D6)', () => {
  it('≤ 4 mallas instanciadas y 4 draw calls con 9 rivales', () => {
    const r = new RivalsRender(teams);
    const ims: THREE.InstancedMesh[] = [];
    r.group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) ims.push(o as THREE.InstancedMesh); });
    let meshes = 0;
    r.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
    expect(ims.length).toBeLessThanOrEqual(4);
    expect(meshes).toBe(ims.length);
    r.update(Array.from({ length: 9 }, (_, i) => rival(i, 10 + i * 8)), 0.5, 1 / 60, camera());
    expect(r.drawCalls).toBeLessThanOrEqual(4);
    expect(r.meshes.paint.count).toBe(9);
    expect(r.meshes.wheels.count).toBe(36);
    expect(r.visible).toBe(9);
  });

  it('matrices finitas e interpoladas entre el paso anterior y el actual', () => {
    const r = new RivalsRender(teams);
    r.update([rival(0, 10)], 0.5, 1 / 60, camera());
    const m = new THREE.Matrix4();
    for (const im of Object.values(r.meshes)) for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m);
      for (const v of m.elements) expect(Number.isFinite(v)).toBe(true);
    }
    r.meshes.paint.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBeCloseTo(10.5, 6);
    // Ruedas cerca del coche (≤ 2,5 m del centro)
    for (let w = 0; w < 4; w++) {
      r.meshes.wheels.getMatrixAt(w, m);
      expect(new THREE.Vector3().setFromMatrixPosition(m).distanceTo(new THREE.Vector3(10.5, 0, 0))).toBeLessThan(2.5);
    }
  });

  it('colores por escudería: pintura primaria y acento por instancia', () => {
    const r = new RivalsRender(teams);
    const rs = [rival(0, 10, { team: 1 }), rival(1, 20, { team: 3 })];
    r.update(rs, 1, 0, camera());
    const c = new THREE.Color();
    for (let i = 0; i < rs.length; i++) {
      r.meshes.paint.getColorAt(i, c);
      expect(c.getHex()).toBe(new THREE.Color(TEAMS[rs[i].team].primary).getHex());
      r.meshes.accent.getColorAt(i, c);
      expect(c.getHex()).toBe(new THREE.Color(TEAMS[rs[i].team].accent).getHex());
    }
  });

  it('las ruedas giran con la velocidad', () => {
    const r = new RivalsRender(teams);
    const m0 = new THREE.Matrix4(), m1 = new THREE.Matrix4();
    r.update([rival(0, 10)], 1, 0, camera());
    r.meshes.wheels.getMatrixAt(2, m0);
    r.update([rival(0, 10)], 1, 0.05, camera());
    r.meshes.wheels.getMatrixAt(2, m1);
    expect(m0.equals(m1)).toBe(false);
  });

  it('oculta los rivales a más de rivalCullM por detrás de la cámara', () => {
    const r = new RivalsRender(teams);
    r.update([rival(0, -700), rival(1, -100), rival(2, 700)], 1, 0, camera());
    expect(r.visible).toBe(2);
    const m = new THREE.Matrix4();
    r.meshes.paint.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixScale(m).length()).toBe(0);
  });
});
