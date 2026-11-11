import { describe, it, expect } from 'vitest';
import { QUALITY } from '../src/render/quality';
import { VR_QUALITY } from '../src/render/vrQuality';

describe('VR_QUALITY', () => {
  it('perfil VR: sin posproceso, dpr 1, sombras <= 1024', () => {
    expect(VR_QUALITY.post).toBe(false);
    expect(VR_QUALITY.dpr).toBe(1);
    expect(VR_QUALITY.shadowMapSize).toBeLessThanOrEqual(1024);
    expect(VR_QUALITY.msaaSamples).toBe(0);
    expect(VR_QUALITY.trees).toBe(300);
    expect(VR_QUALITY.particles).toBe(200);
  });

  it('QUALITY high/medium/low conservan sus valores', () => {
    expect(QUALITY.high).toEqual({ dpr: 1.5, shadows: true, shadowMapSize: 2048, post: true, msaaSamples: 4, trees: 600, particles: 400, envMapSize: 256, trackMaps: true });
    expect(QUALITY.medium).toEqual({ dpr: 1.25, shadows: true, shadowMapSize: 1024, post: false, msaaSamples: 0, trees: 400, particles: 250, envMapSize: 128, trackMaps: true });
    expect(QUALITY.low).toEqual({ dpr: 1.0, shadows: false, shadowMapSize: 0, post: false, msaaSamples: 0, trees: 300, particles: 120, envMapSize: 64, trackMaps: true });
  });
});
