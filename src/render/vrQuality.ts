import { QUALITY, type QualitySettings } from './quality';

// Perfil fijo para VR (b7, design D3): sin posproceso ni MSAA, sombras a 1024, árboles y partículas a la mitad de 'high'
export const VR_QUALITY: QualitySettings = {
  dpr: 1.0, shadows: true, shadowMapSize: 1024, post: false, msaaSamples: 0,
  trees: QUALITY.high.trees / 2, particles: QUALITY.high.particles / 2, envMapSize: 128, trackMaps: true,
};
