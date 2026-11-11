import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { config } from '../src/shared/config';
import { createCarState, maxSteerRad } from '../src/sim/car';
import { buildCar } from '../src/render/car';

const DEG = Math.PI / 180;
const mk = (over: Record<string, unknown> = {}) => ({ ...createCarState(), ...over }) as ReturnType<typeof createCarState>;
const spinOf = (w: THREE.Object3D) => w.getObjectByName('spin')!;

describe('coche visual', () => {
  it('Partes presentes', () => {
    const { group } = buildCar();
    for (const n of ['nose', 'front-wing', 'rear-wing', 'rear-wing-flap', 'sidepods', 'airbox', 'halo', 'floor', 'cockpit',
      'steering-wheel', 'suspension', 'wheel-fl', 'wheel-fr', 'wheel-rl', 'wheel-rr']) {
      expect(group.getObjectByName(n), n).toBeDefined();
    }
  });

  it('Proporciones', () => {
    const { group } = buildCar();
    const s = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
    expect(s.x).toBeGreaterThanOrEqual(5.2); expect(s.x).toBeLessThanOrEqual(5.8);
    expect(s.z).toBeGreaterThanOrEqual(1.9); expect(s.z).toBeLessThanOrEqual(2.05);
    expect(s.y).toBeGreaterThanOrEqual(0.9); expect(s.y).toBeLessThanOrEqual(1.1);
  });

  it('Ruedas delanteras', () => {
    const v = buildCar();
    v.update(mk({ steerAngle: -10 * DEG }), 1 / 60);   // izquierda
    for (const w of [v.wheels.fl, v.wheels.fr]) expect(w.rotation.y / DEG).toBeCloseTo(10, 0);
    for (const w of [v.wheels.rl, v.wheels.rr]) expect(w.rotation.y).toBe(0);
  });

  it('Giro de las ruedas', () => {
    const v = buildCar();
    const vMs = 100 / 3.6, dt = 0.01;
    v.update(mk({ vLong: vMs, speed: vMs }), dt);
    for (const w of [v.wheels.fl, v.wheels.fr, v.wheels.rl, v.wheels.rr]) {
      const omega = -spinOf(w).rotation.z / dt;
      expect(Math.abs(omega / (vMs / config.carVisual.wheelRadiusM) - 1)).toBeLessThan(0.05);
    }
  });

  it('DRS visible', () => {
    const v = buildCar();
    const dt = 1 / 60;
    const open = mk({ drs: 2 }), closed = mk({ drs: 0 });
    for (let i = 0; i < Math.ceil(0.3 / dt); i++) v.update(open, dt);
    expect(-v.flap.rotation.z / DEG).toBeCloseTo(config.carVisual.flapOpenDeg, 3);
    for (let i = 0; i < Math.ceil(0.3 / dt); i++) v.update(closed, dt);
    expect(v.flap.rotation.z).toBeCloseTo(0, 6);
  });

  it('Volante solidario con la dirección', () => {
    const v = buildCar();
    const speed = 50;
    v.update(mk({ speed, vLong: speed, steerAngle: 0.5 * maxSteerRad(speed, config) }), 1 / 60);   // derecha
    const sw = v.group.getObjectByName('steering-wheel')!;
    expect(sw.rotation.x / DEG).toBeCloseTo(0.5 * config.carVisual.steerWheelDeg, 3);
    expect(v.wheels.fl.rotation.y).toBeLessThan(0);   // mismo sentido (derecha = Y negativo)
    expect(Math.sign(sw.rotation.x)).toBe(1);
  });

  it('Coste del coche', () => {
    const { group } = buildCar();
    let drawCalls = 0, tris = 0;
    group.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry;
      drawCalls++;
      tris += Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
    });
    expect(drawCalls).toBeLessThanOrEqual(14);
    expect(tris).toBeLessThanOrEqual(60000);
  });
});
