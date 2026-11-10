import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { SteeringEstimator, shapeSteer, tiltDeg } from '../src/wheel/steering';

const G = 9.81;
const w = config.wheel;
// Gravedad en el plano de la pantalla para un ángulo φ (horario +) con orientación 90 y centro en (g, 0)
const grav = (phiDeg: number) => {
  const r = (phiDeg * Math.PI) / 180;
  return [G * Math.cos(r), G * Math.sin(r)] as const;
};
// Alimenta el estimador a 60 Hz con un ángulo fijo y devuelve la última salida y el tiempo final
const feed = (est: SteeringEstimator, phiDeg: number, t0Ms: number, n: number) => {
  let out = est.update(...grav(phiDeg), 90, t0Ms);
  for (let i = 1; i < n; i++) out = est.update(...grav(phiDeg), 90, t0Ms + (i * 1000) / 60);
  return { out, tMs: t0Ms + ((n - 1) * 1000) / 60 };
};
// PRNG sembrado (mulberry32) y ruido gaussiano (Box-Muller)
const mulberry32 = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gaussian = (rand: () => number) => () =>
  Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

describe('dirección por inclinación', () => {
  it('giro a la derecha: +30° con orientación 90 y steer positivo', () => {
    const phi = tiltDeg(8.5, 4.905, 90) - tiltDeg(9.81, 0, 90);
    expect(phi).toBeGreaterThan(29.5); expect(phi).toBeLessThan(30.5);
    const est = new SteeringEstimator(w);
    est.update(9.81, 0, 90, 0);                                 // calibra el centro
    let out = est.update(8.5, 4.905, 90, 1000 / 60);
    for (let i = 2; i < 60; i++) out = est.update(8.5, 4.905, 90, (i * 1000) / 60);
    expect(out.phiDeg).toBeGreaterThan(29.5); expect(out.phiDeg).toBeLessThan(30.5);
    expect(out.steer).toBeGreaterThan(0);
  });
  it('misma respuesta con orientación 270', () => {
    const phi = tiltDeg(-8.5, -4.905, 270) - tiltDeg(-9.81, 0, 270);
    expect(phi).toBeGreaterThan(29.5); expect(phi).toBeLessThan(30.5);
    const est = new SteeringEstimator(w);
    est.update(-9.81, 0, 270, 0);
    let out = est.update(-8.5, -4.905, 270, 1000 / 60);
    for (let i = 2; i < 60; i++) out = est.update(-8.5, -4.905, 270, (i * 1000) / 60);
    expect(out.phiDeg).toBeGreaterThan(29.5); expect(out.phiDeg).toBeLessThan(30.5);
    expect(out.steer).toBeGreaterThan(0);
  });
  it('recorrido completo: +75° da exactamente 1', () => {
    expect(shapeSteer(75, w)).toBe(1);
    expect(shapeSteer(-75, w)).toBe(-1);
    expect(shapeSteer(60, w)).toBe(1);
  });
  it('zona muerta: 1° estable da 0', () => {
    expect(shapeSteer(1, w)).toBe(0);
    const est = new SteeringEstimator(w);
    est.update(...grav(0), 90, 0);
    expect(feed(est, 1, 1000 / 60, 120).out.steer).toBe(0);
  });
  it('steerSign invierte el signo', () => {
    expect(shapeSteer(30, { ...w, steerSign: -1 })).toBeCloseTo(-shapeSteer(30, w), 12);
  });
});

describe('curva de respuesta', () => {
  it('mitad del recorrido normalizado da 0,369 ± 0,005', () => {
    const phi = w.deadzoneDeg + 0.5 * (w.rangeDeg - w.deadzoneDeg);
    expect(Math.abs(shapeSteer(phi, w) - 0.369)).toBeLessThanOrEqual(0.005);
  });
  it('monotonía de −60° a +60° en pasos de 0,5°', () => {
    let prev = -Infinity;
    for (let phi = -60; phi <= 60 + 1e-9; phi += 0.5) {
      const s = shapeSteer(phi, w);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });
});

describe('filtrado sin temblor ni retraso', () => {
  it('celular quieto a 20° con ruido 0,05 m/s²: pico a pico < 0,02 en los últimos 4 s', () => {
    const noise = gaussian(mulberry32(12345));
    const est = new SteeringEstimator(w);
    est.update(...grav(0), 90, 0);                              // centro en 0°
    const [ax0, ay0] = grav(20);
    let lo = Infinity, hi = -Infinity;
    for (let i = 1; i <= 300; i++) {
      const tMs = (i * 1000) / 60;
      const { steer } = est.update(ax0 + 0.05 * noise(), ay0 + 0.05 * noise(), 90, tMs);
      if (tMs > 1000) { lo = Math.min(lo, steer); hi = Math.max(hi, steer); }
    }
    expect(hi - lo).toBeLessThan(0.02);
  });
  it('giro rápido de 0° a 30°: 90 % del valor final en < 200 ms', () => {
    const est = new SteeringEstimator(w);
    const { tMs } = feed(est, 0, 0, 60);
    const target = 0.9 * shapeSteer(30, w);
    let reached = Infinity;
    for (let i = 1; i <= 60; i++) {
      const t = tMs + (i * 1000) / 60;
      if (est.update(...grav(30), 90, t).steer >= target) { reached = t - tMs; break; }
    }
    expect(reached).toBeLessThan(200);
  });
});

describe('celular casi plano', () => {
  it('gravedad (0.3, 0.2, 9.8): conserva el último steer y avisa', () => {
    const est = new SteeringEstimator(w);
    est.update(...grav(0), 90, 0);
    const { out, tMs } = feed(est, 25, 1000 / 60, 60);
    const flat = est.update(0.3, 0.2, 90, tMs + 1000 / 60);
    expect(flat.flat).toBe(true);
    expect(flat.steer).toBe(out.steer);
    expect(out.flat).toBe(false);
  });
});

describe('calibración del centro', () => {
  it('inclinado 12° y "Centrar": steer pasa a 0 en esa posición', () => {
    const est = new SteeringEstimator(w);
    est.update(...grav(0), 90, 0);
    const { out, tMs } = feed(est, 12, 1000 / 60, 60);
    expect(out.steer).toBeGreaterThan(0);
    est.recenter();
    const after = feed(est, 12, tMs + 1000 / 60, 30).out;
    expect(after.steer).toBe(0);
    expect(Math.abs(after.phiDeg)).toBeLessThan(1e-9);
  });
  it('el centro se fija con la primera muestra válida', () => {
    const est = new SteeringEstimator(w);
    expect(est.update(...grav(40), 90, 0).steer).toBe(0);
  });
});
