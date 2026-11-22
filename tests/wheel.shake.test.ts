import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { ShakeDetector, shakeAction } from '../src/wheel/shake';

const cfg = config.wheel.shake;
const DT = 1000 / 60;

type Sample = [number, number, number, number];               // ax, ay, az, tMs
// Señal a 60 Hz: reposo con pulsos de aceleración lineal en el eje X (amplitud, tiempo de centro) de ~50 ms
const signal = (pulses: [number, number][], durMs: number): Sample[] => {
  const out: Sample[] = [];
  for (let t = 0; t <= durMs; t += DT) {
    let ax = 0;
    for (const [amp, tc] of pulses) if (Math.abs(t - tc) <= 25) ax += amp;
    out.push([ax, 0.3, -0.2, t]);
  }
  return out;
};
const run = (det: ShakeDetector, samples: Sample[]) => samples.map(([ax, ay, az, t]) => ({ t, ...det.update(ax, ay, az, t) }));
const shakes = (res: { shake: boolean }[]) => res.filter((r) => r.shake).length;

describe('ShakeDetector', () => {
  it('dos picos de 20 m/s² con signo alterno separados 150 ms -> una sacudida', () => {
    const res = run(new ShakeDetector(cfg), signal([[20, 200], [-20, 350]], 1000));
    expect(shakes(res)).toBe(1);
    const hit = res.find((r) => r.shake)!;
    expect(hit.t).toBeGreaterThan(300);
    expect(hit.t).toBeLessThan(400);
  });

  it('pico único de 25 m/s² (bordillo) -> sin efecto', () => {
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

  it('usa el eje de mayor módulo de cada muestra', () => {
    const det = new ShakeDetector(cfg);
    const res: boolean[] = [];
    for (let t = 0; t <= 800; t += DT) {
      const az = Math.abs(t - 200) <= 25 ? 20 : Math.abs(t - 350) <= 25 ? -20 : 0;
      res.push(det.update(3, -4, az, t).shake);
    }
    expect(res.filter(Boolean).length).toBe(1);
  });

  it('active desde el primer pico hasta freezeMs después del último', () => {
    const res = run(new ShakeDetector(cfg), signal([[20, 200], [-20, 350]], 1500));
    expect(res.filter((r) => r.t < 170).every((r) => !r.active)).toBe(true);
    const firstActive = res.find((r) => r.active)!;
    expect(firstActive.t).toBeGreaterThanOrEqual(175);
    expect(firstActive.t).toBeLessThanOrEqual(200);
    // Durante toda la sacudida está activo (dirección congelada)
    expect(res.filter((r) => r.t >= 200 && r.t <= 350).every((r) => r.active)).toBe(true);
    const lastPeak = res.filter((r) => r.shake)[0].t;
    expect(res.filter((r) => r.t > lastPeak && r.t <= lastPeak + cfg.freezeMs).every((r) => r.active)).toBe(true);
    expect(res.filter((r) => r.t > lastPeak + cfg.freezeMs + 1).every((r) => !r.active)).toBe(true);
  });

  it('un pico único de bordillo congela brevemente pero no dispara', () => {
    const res = run(new ShakeDetector(cfg), signal([[25, 200]], 1500));
    expect(res.some((r) => r.active)).toBe(true);
    expect(res.filter((r) => r.t > 225 + cfg.freezeMs + 1).every((r) => !r.active)).toBe(true);
  });

  it('con gravedad incluida: la gravedad estimada se resta y la sacudida se detecta', () => {
    const det = new ShakeDetector(cfg);
    let n = 0;
    // Gravedad repartida en Y/Z (celular inclinado en apaisado) con pulsos alternos en X
    for (const [ax, , , t] of signal([[20, 1500], [-20, 1650]], 2500)) if (det.update(ax, 6.9, 6.9, t, true).shake) n++;
    expect(n).toBe(1);
  });

  it('con gravedad incluida y celular quieto -> sin efecto', () => {
    const det = new ShakeDetector(cfg);
    let n = 0;
    for (let t = 0; t <= 3000; t += DT) if (det.update(0.2, 9.7, 1.1, t, true).shake) n++;
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
    for (const [ax, ay, az, t] of signal([[20, 200], [-20, 350], [20, t3], [-20, t3 + 150]], 3000)) {
      if (!det.update(ax, ay, az, t).shake) continue;
      const a = shakeAction(0, 0.05, ers, cfg);
      if (a === 'ersOn') ers = true;
      else if (a === 'ersOff') ers = false;
      if (t < t3) expect(ers).toBe(true);
    }
    expect(ers).toBe(false);
  });
});
