import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { ShakeDetector, shakeAction } from '../src/wheel/shake';

const cfg = config.wheel.shake;
const DT = 1000 / 60;

type Sample = [number, number, number, number];               // ax, ay, az, tMs
type Axis = 0 | 1 | 2;
// Señal a 60 Hz: reposo con pulsos de aceleración lineal (amplitud, tiempo de centro) de ~50 ms en un eje (Z por defecto)
const signal = (pulses: [number, number][], durMs: number, axis: Axis = 2): Sample[] => {
  const out: Sample[] = [];
  for (let t = 0; t <= durMs; t += DT) {
    const v: [number, number, number] = [0.3, -0.2, 0.1];
    for (const [amp, tc] of pulses) if (Math.abs(t - tc) <= 25) v[axis] += amp;
    out.push([v[0], v[1], v[2], t]);
  }
  return out;
};
// Como main.ts: el detector solo recibe la componente Z
const run = (det: ShakeDetector, samples: Sample[]) => samples.map(([, , az, t]) => ({ t, ...det.update(az, t) }));
const shakes = (res: { shake: boolean }[]) => res.filter((r) => r.shake).length;

describe('ShakeDetector', () => {
  it('dos picos de 20 m/s² en Z con signo alterno separados 150 ms -> una sacudida', () => {
    const res = run(new ShakeDetector(cfg), signal([[20, 200], [-20, 350]], 1000));
    expect(shakes(res)).toBe(1);
    const hit = res.find((r) => r.shake)!;
    expect(hit.t).toBeGreaterThan(300);
    expect(hit.t).toBeLessThan(400);
  });

  it('picos alternos de 25 m/s² en X o en Y (giro brusco) -> sin efecto', () => {
    expect(shakes(run(new ShakeDetector(cfg), signal([[25, 200], [-25, 350], [25, 500]], 1000, 0)))).toBe(0);
    expect(shakes(run(new ShakeDetector(cfg), signal([[25, 200], [-25, 350], [25, 500]], 1000, 1)))).toBe(0);
  });

  it('giro de 60° en 200 ms solo con gravedad (gz casi constante, gx/gy rotando) -> sin efecto', () => {
    const det = new ShakeDetector(cfg);
    const tilt = (35 * Math.PI) / 180;                          // celular inclinado hacia atrás
    const gPlane = 9.81 * Math.cos(tilt), gz0 = 9.81 * Math.sin(tilt);
    let n = 0;
    for (let t = 0; t <= 2000; t += DT) {
      // Ida y vuelta de 60° en 200 ms, varias veces
      const ph = (t % 400) / 200;
      const ang = ((ph <= 1 ? ph : 2 - ph) * 60 * Math.PI) / 180;
      const gx = gPlane * Math.sin(ang), gy = gPlane * Math.cos(ang);
      const gz = gz0 + 0.4 * Math.sin(t / 37);                  // pequeñas variaciones de la mano
      expect(Number.isFinite(gx + gy)).toBe(true);
      if (det.update(0, t, gz).shake) n++;
    }
    expect(n).toBe(0);
  });

  it('pico único de 25 m/s² en Z (bordillo) -> sin efecto', () => {
    expect(shakes(run(new ShakeDetector(cfg), signal([[25, 200]], 2000)))).toBe(0);
  });

  it('picos del mismo signo no cuentan', () => {
    expect(shakes(run(new ShakeDetector(cfg), signal([[25, 200], [25, 350]], 1500)))).toBe(0);
  });

  it('picos alternos por debajo del umbral -> sin efecto', () => {
    expect(shakes(run(new ShakeDetector(cfg), signal([[cfg.peakMs2 - 1, 200], [-(cfg.peakMs2 - 1), 350]], 1000)))).toBe(0);
  });

  it('picos alternos más separados que windowMs -> sin efecto', () => {
    const gap = cfg.windowMs + 100;
    expect(shakes(run(new ShakeDetector(cfg), signal([[20, 200], [-20, 200 + gap]], 2000)))).toBe(0);
  });

  it('un pico viejo caducado no bloquea una sacudida posterior del mismo signo', () => {
    expect(shakes(run(new ShakeDetector(cfg), signal([[20, 100], [20, 1500], [-20, 1650]], 2500)))).toBe(1);
  });

  it('enfriamiento: una segunda sacudida dentro de cooldownMs se ignora; pasada la ventana cuenta', () => {
    const t2 = 350 + cfg.cooldownMs / 2;
    expect(shakes(run(new ShakeDetector(cfg), signal([[20, 200], [-20, 350], [20, t2], [-20, t2 + 150]], 2000)))).toBe(1);
    const t3 = 350 + cfg.cooldownMs + 100;
    expect(shakes(run(new ShakeDetector(cfg), signal([[20, 200], [-20, 350], [20, t3], [-20, t3 + 150]], 3000)))).toBe(2);
  });

  it('sacudida sostenida (muchos picos alternos) -> una sola por ventana de enfriamiento', () => {
    const pulses: [number, number][] = [];
    for (let i = 0; i < 8; i++) pulses.push([i % 2 ? -20 : 20, 200 + i * 120]);
    expect(shakes(run(new ShakeDetector(cfg), signal(pulses, 1200)))).toBe(1);
  });

  it('con gravedad incluida: la gravedad de Z estimada se resta y la sacudida se detecta (az se ignora)', () => {
    const det = new ShakeDetector(cfg);
    let n = 0;
    for (const [, , az, t] of signal([[20, 1500], [-20, 1650]], 2500)) if (det.update(99, t, 6.9 + az).shake) n++;
    expect(n).toBe(1);
  });

  it('con gravedad incluida y celular quieto -> sin efecto', () => {
    const det = new ShakeDetector(cfg);
    let n = 0;
    for (let t = 0; t <= 3000; t += DT) if (det.update(0, t, 9.7).shake) n++;
    expect(n).toBe(0);
  });
});

describe('shakeAction', () => {
  it('DRS en recta con drs = 1 -> drs (ERS no cambia)', () => {
    expect(shakeAction(1, 0.05, false, cfg)).toBe('drs');
    expect(shakeAction(1, -0.05, true, cfg)).toBe('drs');
  });

  it('ERS fuera de zona: alterna', () => {
    expect(shakeAction(0, 0.05, false, cfg)).toBe('ersOn');
    expect(shakeAction(0, 0.05, true, cfg)).toBe('ersOff');
    expect(shakeAction(2, 0, false, cfg)).toBe('ersOn');      // DRS ya abierto: no se reenvía
  });

  it('en curva no hace nada', () => {
    expect(shakeAction(1, 0.5, false, cfg)).toBeNull();
    expect(shakeAction(0, -0.5, true, cfg)).toBeNull();
    expect(shakeAction(0, cfg.straightSteer, false, cfg)).toBeNull();
  });

  it('flujo ERS: sacudida, enfriamiento y otra sacudida -> true y luego false', () => {
    const det = new ShakeDetector(cfg);
    let ers = false;
    const t3 = 350 + cfg.cooldownMs + 100;
    for (const [, , az, t] of signal([[20, 200], [-20, 350], [20, t3], [-20, t3 + 150]], 3000)) {
      if (!det.update(az, t).shake) continue;
      const a = shakeAction(0, 0.05, ers, cfg);
      if (a === 'ersOn') ers = true;
      else if (a === 'ersOff') ers = false;
      if (t < t3) expect(ers).toBe(true);
    }
    expect(ers).toBe(false);
  });
});
