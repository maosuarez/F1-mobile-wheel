import QRCode from 'qrcode';

// Overlay de QR en carrera online (b19 D4): QR y código del volante de este PC y de la sala. No pausa nada;
// los QR se pintan al abrir, no en cada fotograma.
export interface QrTarget { url: string; code: string }

export class QrOverlay {
  private wheel: QrTarget | null = null;
  private room: (QrTarget & { closed: boolean }) | null = null;

  constructor(private readonly root: HTMLElement) {}

  private q<T extends HTMLElement>(id: string): T { return this.root.querySelector<T>(`[data-testid="${id}"]`)!; }

  get visible(): boolean { return !this.root.hidden; }

  set(wheel: QrTarget | null, room: QrTarget & { closed: boolean }): void {
    this.wheel = wheel;
    this.room = room;
    if (this.visible) this.paint();
  }

  toggle(): boolean {
    if (this.visible) this.hide();
    else { this.root.hidden = false; this.paint(); }
    return this.visible;
  }

  hide(): void { this.root.hidden = true; }

  private paint(): void {
    const w = this.wheel, r = this.room;
    this.q('qr-wheel-card').hidden = !w;
    if (w) {
      this.q('qr-wheel-code').textContent = w.code;
      const c = this.q<HTMLCanvasElement>('qr-wheel');
      c.dataset.url = w.url;
      QRCode.toCanvas(c, w.url, { width: 220, margin: 2 }).catch(() => {});
    }
    if (r) {
      this.q('qr-room-code').textContent = r.code;
      this.q('qr-room-closed').hidden = !r.closed;
      const c = this.q<HTMLCanvasElement>('qr-room');
      c.dataset.url = r.url;
      QRCode.toCanvas(c, r.url, { width: 220, margin: 2 }).catch(() => {});
    }
  }
}
