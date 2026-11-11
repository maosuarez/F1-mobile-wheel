import * as THREE from 'three';
import { config as defaultConfig, type GameConfig } from '../../shared/config';
import { drawScreen, PANEL_H, PANEL_W, type DrawOp, type PanelScreen } from './panelModel';

// Panel de canvas del HUD en VR (b7, design D6): plano hijo de la cámara, esquina inferior izquierda.
// Se redibuja a config.vr.hudRedrawHz, no por fotograma.
export class VrPanel {
  readonly mesh: THREE.Mesh;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private lastMs = -Infinity;
  private lastKind = '';

  constructor(private readonly cfg: GameConfig = defaultConfig) {
    this.canvas.width = PANEL_W;
    this.canvas.height = PANEL_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const [w, h] = cfg.vr.hudSizeM;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    this.mesh.renderOrder = 999;
    // Esquina inferior izquierda: el borde superior queda ≈ 7° bajo el horizonte y el derecho ≈ 4° a la izquierda del centro
    const d = cfg.vr.hudDistanceM;
    this.mesh.position.set(-(w / 2 + 0.07 * d), -(h / 2 + 0.12 * d), -d);
  }

  // qr: canvas del QR que ya genera pairing.ts (no se regenera)
  update(nowMs: number, screen: PanelScreen, qr?: HTMLCanvasElement): void {
    const dueMs = 1000 / this.cfg.vr.hudRedrawHz;
    if (screen.kind === this.lastKind && nowMs - this.lastMs < dueMs) return;
    this.lastKind = screen.kind;
    this.lastMs = nowMs;
    this.paint(drawScreen(screen), qr);
    this.texture.needsUpdate = true;
  }

  private paint(ops: DrawOp[], qr?: HTMLCanvasElement): void {
    const g = this.ctx;
    g.clearRect(0, 0, PANEL_W, PANEL_H);
    g.textBaseline = 'alphabetic';
    for (const op of ops) {
      if (op.kind === 'rect') { g.fillStyle = op.color; g.fillRect(op.x, op.y, op.w, op.h); }
      else if (op.kind === 'text') {
        g.fillStyle = op.color; g.textAlign = op.align;
        g.font = `${op.weight ?? 700} ${op.size}px system-ui, sans-serif`;
        g.fillText(op.text, op.x, op.y);
      } else if (qr && qr.width > 0) g.drawImage(qr, op.x, op.y, op.size, op.size);
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
