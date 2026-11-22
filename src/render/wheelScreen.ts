import * as THREE from 'three';
import { paintOps } from '../host/vr/panel';
import type { DrawOp } from '../host/vr/panelModel';
import { WHEEL_SCREEN_H, WHEEL_SCREEN_W } from '../host/vr/wheelScreenModel';

// Instrumentos en la pantalla del volante 3D (b20 D4): un plano con CanvasTexture dentro de `steering-wheel`,
// justo delante de la pantalla emisiva y mirando a −X (hacia el piloto). Un draw call y una textura.
export class WheelScreen {
  readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private lastMs = -Infinity;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = WHEEL_SCREEN_W;
    this.canvas.height = WHEEL_SCREEN_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.095), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    this.mesh.name = 'wheel-screen';
    this.mesh.rotation.y = -Math.PI / 2;      // normal hacia −X; el eje X del lienzo queda hacia +Z (derecha del piloto)
    this.mesh.position.set(-0.0225, 0.0025, 0);
  }

  // Redibuja como mucho a redrawHz
  update(nowMs: number, ops: DrawOp[], redrawHz: number): void {
    if (nowMs - this.lastMs < 1000 / redrawHz) return;
    this.lastMs = nowMs;
    paintOps(this.ctx, ops);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
