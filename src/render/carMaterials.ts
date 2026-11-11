import * as THREE from 'three';
import type { GameConfig } from '../shared/config';

export interface CarMaterials {
  body: THREE.MeshPhysicalMaterial;
  carbon: THREE.MeshStandardMaterial;
  tire: THREE.MeshStandardMaterial;
  rim: THREE.MeshStandardMaterial;
  screen: THREE.MeshStandardMaterial;
}

// Materiales PBR del monoplaza: pintura con barniz (colores por vértice), carbono, neumático mate, llanta metálica y pantalla emisiva
export function createCarMaterials(cfg: GameConfig): CarMaterials {
  const c = cfg.carVisual.colors;
  return {
    body: new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2 }),
    carbon: new THREE.MeshStandardMaterial({ color: c.carbon, metalness: 0.3, roughness: 0.5 }),
    tire: new THREE.MeshStandardMaterial({ color: '#0c0c0e', metalness: 0, roughness: 0.95 }),
    rim: new THREE.MeshStandardMaterial({ color: c.rim, metalness: 0.9, roughness: 0.28 }),
    screen: new THREE.MeshStandardMaterial({ color: '#05080a', emissive: c.screen, emissiveIntensity: 1.4, roughness: 0.4 }),
  };
}
