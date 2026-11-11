import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { shouldEmit, TrackParticles, type EmitCar, type ParticlePose } from '../src/render/particles';

const KMH = 1 / 3.6;
const DT = 1 / 60;
const pose: ParticlePose = { x: 10, y: 2, z: -5, yaw: 0.7 };

// Avanza el sistema con tiempo inyectado desde t0 durante durS; devuelve el tiempo final
function run(p: TrackParticles, car: EmitCar, t0: number, durS: number): number {
  let t = t0;
  const n = Math.round(durS / DT);
  for (let i = 0; i < n; i++) { t += DT; p.update(car, pose, t); }
  return t;
}

// Coordenadas en ejes del coche (x adelante, z lateral) de un punto del mundo
function toCar(x: number, z: number): { lx: number; lz: number } {
  const dx = x - pose.x, dz = z - pose.z, c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}

describe('Efectos de pista', () => {
  it('Tierra en la hierba', () => {
    const grass: EmitCar = { surface: 'grass', speed: 100 * KMH, slip: 0.1 };
    expect(shouldEmit(grass)).toEqual({ dirt: true, smoke: false });
    expect(shouldEmit({ ...grass, surface: 'asphalt' })).toEqual({ dirt: false, smoke: false });

    const p = new TrackParticles(400);
    p.update(grass, pose, 0);
    let t = run(p, grass, 0, 0.5);
    const d = p.debug();
    expect(d.dirt).toBeGreaterThan(0);
    expect(d.smoke).toBe(0);
    // Detrás del eje de cada rueda: nacen por detrás del centro de la rueda en el eje longitudinal
    const L = config.car.wheelbaseM / 2;
    for (const a of p.alive()) {
      const { lx } = toCar(a.x, a.z);
      const axle = lx > 0 ? L : -L;
      expect(lx - axle).toBeLessThan(0);
      expect(lx - axle).toBeGreaterThan(-0.5);
    }

    // De vuelta al asfalto: ninguna partícula nueva desde ese instante, y en 0,2 s ya no se emite
    const tBack = t;
    t = run(p, { ...grass, surface: 'asphalt' }, t, 0.2);
    expect(p.alive().filter((a) => a.birth > tBack)).toHaveLength(0);
    const before = p.debug().active;
    t = run(p, { ...grass, surface: 'asphalt' }, t, 0.1);
    expect(p.debug().active).toBeLessThanOrEqual(before);
    run(p, { ...grass, surface: 'asphalt' }, t, config.particles.dirtLifeS);
    expect(p.debug().active).toBe(0);
  });

  it('Humo al deslizar', () => {
    const sliding: EmitCar = { surface: 'asphalt', speed: 70 * KMH, slip: 0.7 };
    expect(shouldEmit(sliding)).toEqual({ dirt: false, smoke: true });
    expect(shouldEmit({ ...sliding, speed: 55 * KMH }).smoke).toBe(false);
    expect(shouldEmit({ ...sliding, slip: 0.5 }).smoke).toBe(false);

    const p = new TrackParticles(400);
    p.update(sliding, pose, 0);
    run(p, sliding, 0, 0.5);
    const alive = p.alive();
    expect(p.debug().smoke).toBeGreaterThan(0);
    expect(alive.every((a) => a.type === 'smoke')).toBe(true);
    // Solo desde las ruedas traseras
    for (const a of alive) expect(toCar(a.x, a.z).lx).toBeLessThan(-config.car.wheelbaseM / 2 + 0.5);
    const zs = alive.map((a) => toCar(a.x, a.z).lz);
    expect(Math.min(...zs)).toBeLessThan(0);
    expect(Math.max(...zs)).toBeGreaterThan(0);
  });

  it('Sin efectos en reposo', () => {
    const still: EmitCar = { surface: 'grass', speed: 0, slip: 1 };
    expect(shouldEmit(still)).toEqual({ dirt: false, smoke: false });
    const p = new TrackParticles(400);
    p.update(still, pose, 0);
    run(p, still, 0, 2);
    expect(p.debug().active).toBe(0);
  });

  it('Pausa: sin avance de tiempo no se emite', () => {
    const grass: EmitCar = { surface: 'grass', speed: 30, slip: 0.9 };
    const p = new TrackParticles(400);
    p.update(grass, pose, 0);
    const t = run(p, grass, 0, 0.3);
    const n = p.alive().length;
    for (let i = 0; i < 30; i++) p.update(grass, pose, t);
    expect(p.alive().length).toBe(n);
  });

  it('El anillo respeta la capacidad', () => {
    const p = new TrackParticles(50);
    const car: EmitCar = { surface: 'grass', speed: 60, slip: 0.9 };
    p.update(car, pose, 0);
    run(p, car, 0, 1);
    expect(p.debug().active).toBeLessThanOrEqual(50);
    expect(p.debug().active).toBeGreaterThan(0);
  });
});
