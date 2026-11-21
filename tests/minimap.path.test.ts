import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { minimapPoint } from '../src/host/minimap';
import { buildMinimapPath, createMinimapPath } from '../src/track/minimap';
import { sampleAt } from '../src/track/query';
import { makeOvalTrack, makeStraightTrack } from '../src/track/synthetic';

const cfg = config.minimap;
const DEG = Math.PI / 180;

// Coche sobre la línea central en s con el rumbo de la pista más yawOffset.
function carAt(t: ReturnType<typeof makeOvalTrack>, s: number, yawOffset = 0) {
  const p = sampleAt(t, s);
  return { x: p.x, z: p.z, yaw: p.heading + yawOffset, s };
}

describe('Recorte local del minimapa', () => {
  it('Recta alineada: puntos por delante en x = 0 y y de 5 a 350 m', () => {
    const t = makeStraightTrack();
    const out = createMinimapPath(cfg);
    buildMinimapPath(t, carAt(t, 1000), cfg, out);
    expect(out.n).toBe(83);
    expect(out.iCar).toBe(12);
    for (let i = out.iCar + 1; i < out.n; i++) {
      expect(Math.abs(out.xy[2 * i])).toBeLessThanOrEqual(0.05);
      expect(out.xy[2 * i + 1]).toBeCloseTo((i - out.iCar) * 5, 1);
    }
    expect(out.xy[2 * (out.iCar + 1) + 1]).toBeCloseTo(5, 1);
    expect(Math.abs(out.xy[2 * (out.n - 1) + 1] - 350)).toBeLessThanOrEqual(5);
    // El tramo recorrido queda detrás
    expect(out.xy[1]).toBeCloseTo(-60, 1);
  });

  it('Rumbo desalineado: 30° a la izquierda pone el primer punto 30° a la derecha', () => {
    const t = makeStraightTrack();
    const out = createMinimapPath(cfg);
    buildMinimapPath(t, carAt(t, 1000, 30 * DEG), cfg, out);
    const x = out.xy[2 * (out.iCar + 1)], y = out.xy[2 * (out.iCar + 1) + 1];
    expect(x).toBeGreaterThan(0);
    expect(Math.abs(Math.atan2(x, y) / DEG - 30)).toBeLessThanOrEqual(1);
  });

  it('Cruce de meta: sin saltos a 100 m del final de la vuelta', () => {
    const t = makeOvalTrack();
    const out = createMinimapPath(cfg);
    buildMinimapPath(t, carAt(t, t.length - 100), cfg, out);
    expect(out.n).toBe(83);
    for (let i = 1; i < out.n; i++) {
      const d = Math.hypot(out.xy[2 * i] - out.xy[2 * i - 2], out.xy[2 * i + 1] - out.xy[2 * i - 1]);
      expect(d).toBeLessThanOrEqual(7.5);
    }
  });

  it('Curva a izquierda: deriva a x < 0 y se marca como curva fuerte', () => {
    // Óvalo antihorario: la curva 1 empieza en s = straightM/2 y gira a la izquierda
    const t = makeOvalTrack({ radiusM: 100 });
    const c1 = 500;
    const out = createMinimapPath(cfg);
    buildMinimapPath(t, carAt(t, c1 - 150), cfg, out);
    let checked = 0;
    for (let i = out.iCar + 1; i < out.n; i++) {
      const ahead = (i - out.iCar) * cfg.stepM;
      if (ahead >= 160) {
        expect(out.xy[2 * i]).toBeLessThan(0);
        expect(out.strong[i]).toBe(1);
        checked++;
      } else if (ahead <= 145) {
        expect(out.strong[i]).toBe(0);
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('Recta sin marcas: ningún punto es curva fuerte', () => {
    const t = makeStraightTrack();
    const out = createMinimapPath(cfg);
    buildMinimapPath(t, carAt(t, 1000), cfg, out);
    for (let i = 0; i < out.n; i++) expect(out.strong[i]).toBe(0);
  });

  it('Pista abierta: recorta al inicio y n es menor', () => {
    const t = makeStraightTrack();
    const out = createMinimapPath(cfg);
    buildMinimapPath(t, carAt(t, 20), cfg, out);
    expect(out.n).toBe(75);
    expect(out.iCar).toBe(4);
    expect(out.xy[2 * out.iCar + 1]).toBeCloseTo(0, 3);
  });

  it('Rendimiento: 1000 llamadas con media ≤ 0,3 ms', () => {
    const t = makeOvalTrack();
    const out = createMinimapPath(cfg);
    for (let i = 0; i < 50; i++) buildMinimapPath(t, carAt(t, i * 37), cfg, out);
    const car = carAt(t, 0);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      car.s = (i * 7.3) % t.length;
      buildMinimapPath(t, car, cfg, out);
    }
    const mean = (performance.now() - t0) / 1000;
    expect(mean).toBeLessThanOrEqual(0.3);
  });
});

describe('Puntos de rivales en el minimapa (b14)', () => {
  it('minimapPoint coincide con el recorte: un punto de la pista a 50 m queda en el mismo sitio', () => {
    const t = makeOvalTrack();
    const car = carAt(t, 300, 0.3);
    const out = createMinimapPath(cfg);
    buildMinimapPath(t, car, cfg, out);
    const j = out.iCar + 10;                                    // stepM = 5 → 50 m por delante
    const p = sampleAt(t, 300 + 50);
    const q = minimapPoint(car, p.x, p.z);
    expect(q.x).toBeCloseTo(out.xy[2 * j], 3);
    expect(q.y).toBeCloseTo(out.xy[2 * j + 1], 3);
  });
  it('un rival delante en línea recta tiene x ≈ 0 e y > 0', () => {
    const t = makeStraightTrack();
    const car = carAt(t, 1000);
    const p = sampleAt(t, 1040);
    const q = minimapPoint(car, p.x, p.z);
    expect(Math.abs(q.x)).toBeLessThan(1e-6);
    expect(q.y).toBeCloseTo(40, 3);
  });
});
