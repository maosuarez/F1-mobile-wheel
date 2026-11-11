import { describe, expect, it } from 'vitest';
import raw from '../public/track/interlagos.json';
import { config } from '../src/shared/config';
import { createCarState } from '../src/sim/car';
import { parseTrackJson } from '../src/track/schema';
import { buildTrack } from '../src/track/track';
import { locateGlobal, sampleAt } from '../src/track/query';
import { activeTvCamera, buildTvCameras, CriticalSpring, fovFor, shakeAmplitude, shakeOffset, tvFovDeg } from '../src/render/cameras/math';
import type { Surface } from '../src/track/types';

const c = config.camera;
const track = buildTrack(parseTrackJson(raw));
const DEG = Math.PI / 180;

function carAt(kmh: number, surface: Surface) {
  const car = createCarState();
  car.speed = kmh / 3.6; car.vx = car.speed; car.surface = surface;
  return car;
}

// Máximo |offset| muestreado durante 1 s
function maxShake(amp: number): number {
  let m = 0;
  for (let i = 0; i < 1000; i++) { const [x, y] = shakeOffset(amp, i / 1000, c); m = Math.max(m, Math.abs(x), Math.abs(y)); }
  return m;
}

describe('CriticalSpring', () => {
  it('Sin sobreoscilación: salto de 5 m', () => {
    const sp = new CriticalSpring(c.chase.omega);
    sp.snap(0);
    const dt = 1 / 60;
    let max = 0, t95: number | null = null;
    for (let i = 1; i <= 600; i++) {
      const x = sp.step(5, dt);
      max = Math.max(max, x);
      if (t95 === null && x >= 0.95 * 5) t95 = i * dt;
    }
    expect(max).toBeLessThanOrEqual(5 * 1.01);
    expect(t95).not.toBeNull();
    expect(t95!).toBeLessThan(0.8);
    expect(sp.x).toBeCloseTo(5, 3);
  });

  it('Independencia de los fps: 30 frente a 144 pasos por segundo', () => {
    // Objetivo en movimiento: aceleración, curva y salto
    const target = (t: number) => 83 * t + 4 * Math.sin(2.5 * t) + (t > 1 ? 5 : 0);
    const run = (fps: number) => {
      const sp = new CriticalSpring(c.chase.omega);
      sp.snap(target(0));
      const n = 2 * fps;
      for (let i = 1; i <= n; i++) sp.step(target(i / fps), 1 / fps);
      return sp.x;
    };
    expect(Math.abs(run(30) - run(144))).toBeLessThan(0.05);
  });
});

describe('Campo de visión dinámico', () => {
  it('Valores extremos e intermedios', () => {
    expect(Math.abs(fovFor(0, c) - 70)).toBeLessThan(0.2);
    expect(Math.abs(fovFor(160, c) - 77)).toBeLessThan(0.2);
    expect(Math.abs(fovFor(320, c) - 84)).toBeLessThan(0.2);
    expect(fovFor(380, c)).toBe(84);
  });
});

describe('Temblor de cámara', () => {
  it('Asfalto a velocidad media: sin temblor', () => {
    const a = shakeAmplitude(carAt(200, 'asphalt'), c);
    expect(a).toBe(0);
    expect(shakeOffset(a, 1.234, c)).toEqual([0, 0]);
  });

  it('Piano y hierba a 150 km/h', () => {
    const k = shakeAmplitude(carAt(150, 'kerb'), c);
    const g = shakeAmplitude(carAt(150, 'grass'), c);
    expect(k).toBeGreaterThan(0);
    expect(g).toBeGreaterThan(k);
    expect(maxShake(g)).toBeLessThan(0.1);
    expect(maxShake(k)).toBeGreaterThan(0);
  });

  it('Parado sobre hierba: amplitud 0', () => {
    expect(shakeAmplitude(carAt(0, 'grass'), c)).toBe(0);
    expect(shakeAmplitude(carAt(50, 'grass'), c)).toBeCloseTo(c.shake.grassM / 2, 10);
  });

  it('Alta velocidad: asfalto a 300 km/h', () => {
    const a = shakeAmplitude(carAt(300, 'asphalt'), c);
    expect(a).toBeGreaterThanOrEqual(0.001);
    expect(a).toBeLessThanOrEqual(0.02);
    expect(maxShake(a)).toBeLessThanOrEqual(a + 1e-12);
  });

  it('Determinista: mismo tS ⇒ mismo desplazamiento', () => {
    expect(shakeOffset(0.03, 2.5, c)).toEqual(shakeOffset(0.03, 2.5, c));
  });
});

describe('Cámaras de TV en Interlagos', () => {
  const cams = buildTvCameras(track, c);

  it('Reparto: 12–18 cámaras, elevadas y fuera de la pista', () => {
    expect(cams.length).toBeGreaterThanOrEqual(12);
    expect(cams.length).toBeLessThanOrEqual(18);
    for (const cam of cams) {
      const loc = locateGlobal(track, cam.x, cam.z);
      expect(cam.y - sampleAt(track, loc.s).y).toBeGreaterThan(3);
      const outside = loc.d >= 0 ? loc.d - loc.wl : -loc.d - loc.wr;
      expect(outside).toBeGreaterThan(5);
    }
  });

  it('Cambio al pasar: la siguiente cámara se activa al superar el s de la activa (con wrap en meta)', () => {
    const n = cams.length;
    const eps = 83 / 120;   // menos de un paso de simulación a 300 km/h
    for (let i = 0; i < n; i++) {
      const si = cams[i].s;
      expect(activeTvCamera(cams, track, si - eps)).toBe(i);
      expect(activeTvCamera(cams, track, si + eps)).toBe((i + 1) % n);
    }
    // Paso por meta: la última cámara (s ≈ L − leadM) sigue activa hasta superarla y luego la 0
    const L = track.length;
    expect(activeTvCamera(cams, track, L - c.tv.leadM - eps)).toBe(n - 1);
    expect(activeTvCamera(cams, track, L - eps)).toBe(0);
    expect(activeTvCamera(cams, track, L + eps)).toBe(0);
    expect(activeTvCamera(cams, track, eps)).toBe(0);
  });

  it('Encuadre: ancho visible a 40 y 250 m entre 12 y 60 m', () => {
    for (const dist of [40, 250]) {
      const fov = tvFovDeg(dist, c);
      const width = 2 * dist * Math.tan((fov * DEG) / 2) * (16 / 9);
      expect(width).toBeGreaterThanOrEqual(12);
      expect(width).toBeLessThanOrEqual(60);
    }
  });
});
