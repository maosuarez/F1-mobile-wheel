import * as THREE from 'three';
import { config, type GameConfig } from '../shared/config';

export interface CameraTarget { x: number; y: number; z: number; yaw: number }

// Cámara de seguimiento con suavizado exponencial (el bloque 5 la sustituye)
export class ChaseCamera {
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private initialized = false;

  constructor(readonly camera: THREE.PerspectiveCamera, private readonly cfg: GameConfig = config) {}

  private desired(t: CameraTarget, outPos: THREE.Vector3, outLook: THREE.Vector3) {
    const { distM, heightM, lookAheadM } = this.cfg.render.chase;
    const fx = Math.cos(t.yaw), fz = -Math.sin(t.yaw);   // forward (D1)
    outPos.set(t.x - fx * distM, t.y + heightM, t.z - fz * distM);
    outLook.set(t.x + fx * lookAheadM, t.y + 0.8, t.z + fz * lookAheadM);
  }

  // Coloca la cámara sin suavizado
  snap(t: CameraTarget): void {
    this.desired(t, this.pos, this.look);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this.initialized = true;
  }

  update(t: CameraTarget, dtS: number): void {
    if (!this.initialized) { this.snap(t); return; }
    const p = new THREE.Vector3(), l = new THREE.Vector3();
    this.desired(t, p, l);
    const a = 1 - Math.exp(-this.cfg.render.chase.stiffness * dtS);
    this.pos.lerp(p, a);
    this.look.lerp(l, a);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
