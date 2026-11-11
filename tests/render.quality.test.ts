import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { AdaptiveQuality, FpsMeter, QUALITY, initialQuality, isSoftwareGl, type QualityLevel } from '../src/render/quality';

// Alimenta `secs` segundos a `fps` y devuelve los cambios de nivel
const feed = (aq: AdaptiveQuality, fps: number, secs: number, active = true) => {
  const changes: QualityLevel[] = [];
  const frames = Math.round(fps * secs);
  for (let i = 0; i < frames; i++) {
    const r = aq.sample(1 / fps, active);
    if (r) changes.push(r);
  }
  return changes;
};

describe('AdaptiveQuality', () => {
  it('Bajada automática: 3 s a 40 fps → medium una vez; otros 3 s → low', () => {
    const aq = new AdaptiveQuality(config.quality, 'high', false);
    expect(feed(aq, 40, 2.9)).toEqual([]);
    expect(feed(aq, 40, 0.2)).toEqual(['medium']);
    expect(aq.level).toBe('medium');
    expect(feed(aq, 40, 3.1)).toEqual(['low']);
    expect(feed(aq, 40, 10)).toEqual([]);
    expect(aq.level).toBe('low');
  });

  it('Sin oscilación: tras bajar a medium, 60 fps no la hacen subir', () => {
    const aq = new AdaptiveQuality(config.quality, 'high', false);
    feed(aq, 40, 3.1);
    expect(aq.level).toBe('medium');
    expect(feed(aq, 60, 20)).toEqual([]);
    expect(aq.level).toBe('medium');
  });

  it('Pausa o pestaña oculta: los fotogramas inactivos no cuentan', () => {
    const aq = new AdaptiveQuality(config.quality, 'high', false);
    expect(feed(aq, 10, 30, false)).toEqual([]);
    expect(aq.level).toBe('high');
    feed(aq, 40, 2);
    feed(aq, 10, 30, false);                    // la pausa no completa la ventana
    expect(aq.level).toBe('high');
    expect(feed(aq, 40, 1.1)).toEqual(['medium']);
  });

  it('nivel fijado con ?quality= no se adapta', () => {
    const aq = new AdaptiveQuality(config.quality, 'high', true);
    expect(feed(aq, 20, 10)).toEqual([]);
    expect(aq.level).toBe('high');
  });

  it('a 60 fps se queda en high', () => {
    const aq = new AdaptiveQuality(config.quality, 'high', false);
    expect(feed(aq, 60, 30)).toEqual([]);
  });

  it('niveles decrecientes', () => {
    expect(QUALITY.low.shadows).toBe(false);
    expect(QUALITY.low.post).toBe(false);
    expect(QUALITY.low.dpr).toBe(1);
    expect(QUALITY.high.dpr).toBeLessThanOrEqual(1.5);
    expect(QUALITY.high.shadowMapSize).toBeLessThanOrEqual(2048);
  });
});

describe('FpsMeter', () => {
  it('media y percentil 5 sobre una serie conocida', () => {
    const m = new FpsMeter();
    for (let i = 0; i < 95; i++) m.push(1 / 60);
    for (let i = 0; i < 5; i++) m.push(1 / 30);
    expect(m.avg()).toBeCloseTo(100 / (95 / 60 + 5 / 30), 6);   // 57,14
    expect(m.p5()).toBeCloseTo(30, 6);
  });

  it('serie 1..100 fps: p5 = 5', () => {
    const m = new FpsMeter();
    for (let f = 100; f >= 1; f--) m.push(1 / f);
    expect(m.p5()).toBeCloseTo(5, 6);
  });

  it('capacidad: conserva solo los últimos fotogramas; reset vacía', () => {
    const m = new FpsMeter(10);
    for (let i = 0; i < 50; i++) m.push(1 / 20);
    for (let i = 0; i < 10; i++) m.push(1 / 50);
    expect(m.avg()).toBeCloseTo(50, 6);
    m.reset();
    expect(m.avg()).toBe(0);
    expect(m.p5()).toBe(0);
  });
});

describe('perfil software (GL por software)', () => {
  const swift = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
  it('detecta SwiftShader y llvmpipe sin distinguir mayúsculas', () => {
    expect(isSoftwareGl(swift)).toBe(true);
    expect(isSoftwareGl('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareGl('LLVMPIPE')).toBe(true);
    expect(isSoftwareGl('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)')).toBe(false);
  });
  it('arranca en software bloqueado; GPU real en high adaptativo; ?quality= manda', () => {
    expect(initialQuality(null, swift)).toEqual({ level: 'software', locked: true });
    expect(initialQuality(null, 'AMD Radeon')).toEqual({ level: 'high', locked: false });
    expect(initialQuality('high', swift)).toEqual({ level: 'high', locked: true });
    expect(initialQuality('low', 'AMD Radeon')).toEqual({ level: 'low', locked: true });
    expect(initialQuality('bogus', swift)).toEqual({ level: 'software', locked: true });
  });
  it('software = low sin entorno ni texturas de pista; low conserva ambos', () => {
    expect(QUALITY.software).toEqual({ ...QUALITY.low, envMapSize: 0, trackMaps: false });
    expect(QUALITY.low.envMapSize).toBeGreaterThan(0);
    expect(QUALITY.low.trackMaps).toBe(true);
  });
  it('no adapta desde software aunque no esté bloqueado', () => {
    const aq = new AdaptiveQuality(config.quality, 'software', false);
    expect(feed(aq, 10, 10)).toEqual([]);
    expect(aq.level).toBe('software');
  });
});
