import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { engineParams, limiterGainAt, shiftEnvelope } from '../src/audio/engineParams';

const a = config.audio;
const p = (rpm: number, throttle: number, speedMs = 50) => engineParams({ rpm, throttle, speedMs, limiter: false }, a);

describe('audio del motor: parámetros', () => {
  it('Frecuencias de referencia: 4000 → 200 Hz, 12000 → 600 Hz (±1 %)', () => {
    expect(Math.abs(p(4000, 0.5).f0Hz - 200) / 200).toBeLessThan(0.01);
    expect(Math.abs(p(12000, 0.5).f0Hz - 600) / 600).toBeLessThan(0.01);
  });

  it('Brillo: el corte crece monótono con el acelerador y termina ≥ 3× el inicial', () => {
    for (const rpm of [4000, 8000, 12000]) {
      let prev = -Infinity;
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const c = p(rpm, t).cutoffHz;
        expect(c).toBeGreaterThan(prev);
        prev = c;
      }
      expect(p(rpm, 1).cutoffHz).toBeGreaterThanOrEqual(3 * p(rpm, 0).cutoffHz);
    }
  });

  it('Volumen: a 10 000 rpm la ganancia a fondo es ≥ 2× la de vacío y ≤ 1', () => {
    const idle = p(10000, 0).engineGain;
    const full = p(10000, 1).engineGain;
    expect(full).toBeGreaterThanOrEqual(2 * idle);
    expect(full).toBeLessThanOrEqual(1);
    for (let t = 0; t <= 1.0001; t += 0.1) expect(p(10000, t).engineGain).toBeLessThanOrEqual(1);
  });

  it('Viento: crece monótono de 50 a 300 km/h y a 50 km/h es < 10 % del de 300 km/h', () => {
    let prev = -Infinity;
    for (let kmh = 50; kmh <= 300; kmh += 10) {
      const g = p(8000, 0.5, kmh / 3.6).windGain;
      expect(g).toBeGreaterThan(prev);
      prev = g;
    }
    expect(p(8000, 0.5, 50 / 3.6).windGain).toBeLessThan(0.1 * p(8000, 0.5, 300 / 3.6).windGain);
  });

  it('Envolvente de cambio: caída ≥ 50 % durante 40 ± 15 ms', () => {
    const dt = 0.0001;
    let below = 0;
    let min = 1;
    for (let t = 0; t < 0.3; t += dt) {
      const g = shiftEnvelope(t, a);
      min = Math.min(min, g);
      if (g <= 0.5) below += dt;
    }
    expect(min).toBeLessThanOrEqual(0.5);
    expect(below).toBeGreaterThanOrEqual(0.025);
    expect(below).toBeLessThanOrEqual(0.055);
    expect(shiftEnvelope(-0.01, a)).toBe(1);
    expect(shiftEnvelope(0.2, a)).toBe(1);
  });

  it('Limitador: modulación entre 12 y 18 Hz (cruces por la media en 1 s)', () => {
    const fs = 4000;
    const samples = Array.from({ length: fs }, (_, k) => limiterGainAt(k / fs, a));
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    let crossings = 0;
    for (let k = 1; k < samples.length; k++) {
      if ((samples[k - 1] - mean) * (samples[k] - mean) < 0) crossings++;
    }
    const hz = crossings / 2;
    expect(hz).toBeGreaterThanOrEqual(12);
    expect(hz).toBeLessThanOrEqual(18);
    for (const v of samples) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
});
