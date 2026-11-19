import * as THREE from 'three';
import { config as defaultConfig, type GameConfig } from '../../shared/config';

// Minimapa en VR (b8, design D6): plano hijo de la cámara, esquina inferior derecha.
// Comparte el canvas que dibuja Minimap; solo sube la textura cuando cambia `version`.
export class VrMinimap {
  readonly mesh: THREE.Mesh;
  private readonly texture: THREE.CanvasTexture;
  private lastVersion = -1;

  constructor(source: HTMLCanvasElement, cfg: GameConfig = defaultConfig) {
    this.texture = new THREE.CanvasTexture(source);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const s = cfg.vr.minimapSizeM;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(s, s), mat);
    this.mesh.renderOrder = 999;
    const d = cfg.vr.hudDistanceM;
    this.mesh.position.set(s / 2 + 0.07 * d, -(s / 2 + 0.12 * d), -d);
  }

  update(version: number): void {
    if (version === this.lastVersion) return;
    this.lastVersion = version;
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
