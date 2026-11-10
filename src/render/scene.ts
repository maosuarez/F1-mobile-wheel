import * as THREE from 'three';
import type { Track } from '../track/types';
import { config } from '../shared/config';
import { buildTrackMeshes, type TrackMeshes } from '../track/mesh';

export interface GameScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  meshes: TrackMeshes;
}

// DPR limitado a config.render.maxDpr
export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, config.render.maxDpr));
  renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
  return renderer;
}

// Cielo plano, niebla, luz hemisférica + direccional sin sombras, mallas de pista y cámara
export function createScene(track: Track): GameScene {
  const scene = new THREE.Scene();
  const sky = new THREE.Color('#8fb4d9');
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, config.render.far * 0.3, config.render.far * 0.95);
  scene.add(new THREE.HemisphereLight('#cfe3ff', '#4a5a3a', 1.0));
  const sun = new THREE.DirectionalLight('#fff2da', 2.0);
  sun.position.set(-200, 400, 150);
  sun.castShadow = false;
  scene.add(sun);

  const meshes = buildTrackMeshes(track);
  scene.add(meshes.group);

  const camera = new THREE.PerspectiveCamera(config.render.fovDeg, 1, config.render.near, config.render.far);
  return { scene, camera, meshes };
}

// Ajusta renderer y cámara al tamaño del canvas
export function resize(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
  const canvas = renderer.domElement;
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, config.render.maxDpr));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
