import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Monoplaza procedural con el morro hacia +X, suelo en y = 0. Escudería ficticia, sin logos. 4 draw calls.
export function buildCar(): THREE.Group {
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return g;
  };

  // Carrocería (rojo ficticio): monocasco, morro, pontones, caja de aire
  const nose = new THREE.ConeGeometry(0.22, 1.8, 12);
  nose.rotateZ(-Math.PI / 2);
  nose.translate(2.0, 0.38, 0);
  const airbox = box(0.5, 0.45, 0.35, -0.4, 0.95, 0);
  const bodyGeom = mergeGeometries([
    box(3.0, 0.4, 0.6, 0.0, 0.42, 0),
    nose,
    box(1.6, 0.34, 0.42, -0.1, 0.38, 0.62),
    box(1.6, 0.34, 0.42, -0.1, 0.38, -0.62),
    airbox,
  ])!;

  // Alerones y halo (gris oscuro)
  const wingGeom = mergeGeometries([
    box(0.5, 0.06, 2.0, 2.7, 0.15, 0),
    box(0.5, 0.3, 0.05, 2.7, 0.25, 1.0),
    box(0.5, 0.3, 0.05, 2.7, 0.25, -1.0),
    box(0.4, 0.08, 1.5, -2.3, 1.0, 0),
    box(0.4, 0.5, 0.05, -2.3, 0.85, 0.75),
    box(0.4, 0.5, 0.05, -2.3, 0.85, -0.75),
    box(0.15, 0.7, 0.1, -2.3, 0.65, 0),
  ])!;

  // Ruedas (negro): 4 cilindros fusionados
  const wheel = (x: number, z: number, r: number, w: number) => {
    const g = new THREE.CylinderGeometry(r, r, w, 16);
    g.rotateX(Math.PI / 2);
    g.translate(x, r, z);
    return g;
  };
  const wheelGeom = mergeGeometries([
    wheel(1.8, 0.92, 0.34, 0.36), wheel(1.8, -0.92, 0.34, 0.36),
    wheel(-1.8, 0.92, 0.36, 0.5), wheel(-1.8, -0.92, 0.36, 0.5),
  ])!;

  // Casco del piloto (amarillo)
  const helmet = new THREE.SphereGeometry(0.17, 12, 8);
  helmet.translate(0.15, 0.78, 0);

  const group = new THREE.Group();
  group.name = 'car';
  const mk = (g: THREE.BufferGeometry, color: string, rough: number) =>
    new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.1 }));
  group.add(mk(bodyGeom, '#b5121b', 0.4));
  group.add(mk(wingGeom, '#1c1c20', 0.6));
  group.add(mk(wheelGeom, '#0d0d0f', 0.9));
  group.add(mk(helmet, '#f2c200', 0.3));
  return group;
}
