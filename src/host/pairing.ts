import QRCode from 'qrcode';

// Emparejamiento por QR (design D4): URL del volante, overlay, cuenta atrás y avisos.

export type WheelUrlMode = 'usb' | 'wifi' | 'public';
export interface RelayInfo { lan_ips: string[]; public_url: string | null }

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function wheelUrl(
  loc: { protocol: string; hostname: string; port: string },
  info: RelayInfo | null,
  room: string,
): { url: string; mode: WheelUrlMode } {
  const path = `/wheel/?room=${encodeURIComponent(room)}`;
  const pub = info?.public_url?.trim();
  if (pub) return { url: pub.replace(/\/+$/, '') + path, mode: 'public' };
  const origin = `${loc.protocol}//${loc.hostname}${loc.port ? `:${loc.port}` : ''}`;
  // localhost: el celular llega por USB con adb reverse; cualquier otra dirección es la IP de la red local
  return { url: origin + path, mode: LOCAL_HOSTS.has(loc.hostname) ? 'usb' : 'wifi' };
}

export function pairingHint(mode: WheelUrlMode, port: string): string {
  if (mode === 'usb') return `Conecta el celular por USB y ejecuta: adb reverse tcp:${port || '5173'} tcp:${port || '5173'}`;
  if (mode === 'wifi') return 'Celular en la misma WiFi: escanea el QR y acepta el certificado';
  return 'Escanea el QR con el celular';
}

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

// Interfaz de emparejamiento: overlay con QR, overlay de volante perdido, cuenta atrás y toast
export class PairingUi {
  private readonly pairing = q('pairing');
  private readonly code = q('pairing-code');
  private readonly qr = q('pairing-qr') as HTMLCanvasElement;
  private readonly hint = q('pairing-hint');
  private readonly relay = q('pairing-relay');
  private readonly countdown = q('countdown');
  private readonly toastEl = q('toast');
  private readonly lost = q('overlay-wheel-lost');
  private readonly lostQr = q('wheel-lost-qr') as HTMLCanvasElement;
  private readonly lostCode = q('wheel-lost-code');
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  get qrCanvas(): HTMLCanvasElement { return this.qr; }
  get hintText(): string { return this.hint.textContent ?? ''; }
  get roomText(): string { return this.code.textContent ?? ''; }

  setRoom(room: string, url: string, mode: WheelUrlMode, port: string): void {
    this.code.textContent = room;
    this.lostCode.textContent = room;
    this.hint.textContent = pairingHint(mode, port);
    this.qr.dataset.url = url;
    const opts = { width: 320, margin: 2 };
    QRCode.toCanvas(this.qr, url, opts).catch(() => {});
    QRCode.toCanvas(this.lostQr, url, { ...opts, width: 220 }).catch(() => {});
  }

  setRelayDown(down: boolean): void { this.relay.hidden = !down; }
  showPairing(v: boolean): void { this.pairing.hidden = !v; }
  showLost(v: boolean): void { this.lost.hidden = !v; }

  setCountdown(n: number | null): void {
    this.countdown.hidden = n === null;
    if (n !== null && this.countdown.textContent !== String(n)) this.countdown.textContent = String(n);
  }

  toast(text: string, ms = 2500): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toastEl.hidden = true; this.toastTimer = null; }, ms);
  }
}
