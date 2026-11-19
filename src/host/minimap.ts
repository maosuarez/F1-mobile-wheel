import { config } from '../shared/config';
import type { CarState } from '../sim/types';
import { buildMinimapPath, createMinimapPath, type MinimapPath } from '../track/minimap';
import type { Track } from '../track/types';

// Minimapa de anticipación del HUD (b8, design D3). Canvas 2D, sin asignaciones por fotograma.
const MARGIN_PX = 14;
const STROKE_PX = 4;
const CAR_R = 5;
export const MINIMAP_FALLBACK_PX = 256;   // tamaño interno si el canvas no tiene layout (VR)

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly path: MinimapPath;
  private readonly minDtMs: number;
  private lastMs = -1e9;
  private cssSize = 0;
  private dpr = 1;
  private visible = true;
  private ver = 0;

  constructor(private readonly track: Track, private readonly canvasEl: HTMLCanvasElement) {
    this.ctx = canvasEl.getContext('2d');
    this.path = createMinimapPath(config.minimap);
    this.minDtMs = 1000 / config.minimap.redrawHz;
  }

  get canvas(): HTMLCanvasElement { return this.canvasEl; }
  get version(): number { return this.ver; }

  show(v: boolean): void {
    this.visible = v;
    this.canvasEl.hidden = !v;
  }

  private resize(): void {
    const css = this.canvasEl.clientWidth || MINIMAP_FALLBACK_PX;
    const dpr = Math.min(window.devicePixelRatio || 1, config.render.maxDpr);
    if (css === this.cssSize && dpr === this.dpr && this.canvasEl.width > 0) return;
    this.cssSize = css; this.dpr = dpr;
    const px = Math.max(1, Math.round(css * dpr));
    this.canvasEl.width = px; this.canvasEl.height = px;
  }

  update(car: CarState, nowMs: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.visible || nowMs - this.lastMs < this.minDtMs) return;
    this.lastMs = nowMs;
    this.resize();
    const W = this.canvasEl.width, H = this.canvasEl.height;
    if (W < 2) return;
    const k = this.dpr;
    const cx = W / 2, cy = config.minimap.carY * H;
    const scale = (cy - MARGIN_PX * k) / config.minimap.aheadM;
    buildMinimapPath(this.track, car, config.minimap, this.path);
    const { n, iCar, xy, strong } = this.path;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(8,10,14,.62)';
    ctx.fillRect(0, 0, W, H);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.lineWidth = STROKE_PX * k;

    // Tramo recorrido y tramo por delante
    this.stroke(ctx, 0, Math.min(iCar, n - 1), cx, cy, scale, 'rgba(255,255,255,.35)', null);
    this.stroke(ctx, iCar, n - 1, cx, cy, scale, '#ffffff', null);
    // Curvas fuertes superpuestas (solo por delante)
    this.stroke(ctx, iCar, n - 1, cx, cy, scale, '#ffb020', strong);

    ctx.beginPath();
    ctx.arc(cx, cy, CAR_R * k, 0, Math.PI * 2);
    ctx.fillStyle = '#35e07a'; ctx.fill();
    ctx.lineWidth = 2 * k; ctx.strokeStyle = '#0a0c10'; ctx.stroke();
    ctx.restore();
    this.ver++;
  }

  // Traza [i0, i1]; con `mask` solo los segmentos cuyos dos extremos están marcados.
  private stroke(ctx: CanvasRenderingContext2D, i0: number, i1: number, cx: number, cy: number, scale: number,
                 color: string, mask: Uint8Array | null): void {
    const xy = this.path.xy;
    ctx.strokeStyle = color;
    ctx.beginPath();
    let pen = false;
    for (let i = i0; i <= i1; i++) {
      if (mask && (mask[i] === 0 || (i === i1 && !pen))) { pen = false; continue; }
      const X = cx + xy[2 * i] * scale, Y = cy - xy[2 * i + 1] * scale;
      if (pen) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
      pen = true;
    }
    ctx.stroke();
  }
}
