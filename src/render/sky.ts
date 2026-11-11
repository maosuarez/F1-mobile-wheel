import * as THREE from 'three';
import type { GameConfig } from '../shared/config';

// Cúpula de cielo con degradado cénit-horizonte y halo del sol (design D2)
const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // siempre en el plano lejano
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uHalo;
uniform vec3 uSunDir;
uniform float uExponent;
uniform float uHaloPower;
uniform float uHaloGain;
uniform float uGlowPower;
uniform float uGlowGain;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h >= 0.0
    ? mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), uExponent))
    : mix(uHorizon, uGround, clamp(-h * 8.0, 0.0, 1.0));
  float mu = max(dot(d, uSunDir), 0.0);
  col += uHalo * (uHaloGain * pow(mu, uHaloPower) + uGlowGain * pow(mu, uGlowPower));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createSkyMaterial(cfg: GameConfig['sky'], sunDir: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: {
      uZenith: { value: new THREE.Color(cfg.zenith) },
      uHorizon: { value: new THREE.Color(cfg.horizon) },
      uGround: { value: new THREE.Color(cfg.ground) },
      uHalo: { value: new THREE.Color(cfg.haloColor) },
      uSunDir: { value: sunDir.clone().normalize() },
      uExponent: { value: cfg.exponent },
      uHaloPower: { value: cfg.haloPower },
      uHaloGain: { value: cfg.haloGain },
      uGlowPower: { value: cfg.glowPower },
      uGlowGain: { value: cfg.glowGain },
    },
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
}

// Malla de la cúpula; se recentra en la cámara cada fotograma
export function createSkyDome(material: THREE.ShaderMaterial, radius: number): THREE.Mesh {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), material);
  dome.name = 'sky';
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  return dome;
}
