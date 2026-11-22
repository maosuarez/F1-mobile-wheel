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
  // localhost: USB (adb reverse); IP privada/link-local/.local: WiFi; cualquier otro host (túnel, dominio): público
  const mode: WheelUrlMode = LOCAL_HOSTS.has(loc.hostname) ? 'usb' : isLanHost(loc.hostname) ? 'wifi' : 'public';
  return { url: origin + path, mode };
}

function isLanHost(host: string): boolean {
  if (host.endsWith('.local')) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

export function pairingHint(mode: WheelUrlMode, port: string): string {
  if (mode === 'usb') return `Conecta el celular por USB y ejecuta: adb reverse tcp:${port || '5173'} tcp:${port || '5173'}`;
  if (mode === 'wifi') return 'Celular en la misma WiFi: escanea el QR y acepta el certificado';
  return 'Escanea el QR o escribe el código en /wheel/';
}

// URL para unirse a una sala online (b19 D3): mismo origen que wheelUrl
export function joinUrl(
  loc: { protocol: string; hostname: string; port: string },
  info: RelayInfo | null,
  code: string,
  track: string,
): string {
  const pub = info?.public_url?.trim();
  const origin = pub ? pub.replace(/\/+$/, '') : `${loc.protocol}//${loc.hostname}${loc.port ? `:${loc.port}` : ''}`;
  return `${origin}/?track=${encodeURIComponent(track)}&online=join&code=${encodeURIComponent(code)}`;
}

// Navegadores de visor VR (b19 D2): no se detectan por WebXR, que Chrome Android también declara
export const VR_UA_RE = /OculusBrowser|Quest|Pico|Wolvic/i;

// Botón fijo "Usar este celular como volante": solo táctil sin hover y que no sea el navegador de un visor
export function shouldShowWheelButton(coarseNoHover: boolean, userAgent: string): boolean {
  return coarseNoHover && !VR_UA_RE.test(userAgent);
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
  // Jugador 2 (b15): tarjeta propia con su QR, código y estado
  private readonly card2 = q('pairing-p2');
  private readonly code2 = q('pairing-code-p2');
  private readonly qr2 = q('pairing-qr-p2') as HTMLCanvasElement;
  private readonly tag1 = q('pairing-tag-p1');
  private readonly status = [q('pairing-status-p1'), q('pairing-status-p2')];
  private readonly toastEl = q('toast');
  private readonly lost = q('overlay-wheel-lost');
  private readonly lostQr = q('wheel-lost-qr') as HTMLCanvasElement;
  private readonly lostCode = q('wheel-lost-code');
  private readonly lostLabel = q('wheel-lost-label');
  private readonly rooms: { room: string; url: string }[] = [];
  private lostFor = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  get qrCanvas(): HTMLCanvasElement { return this.qr; }
  get hintText(): string { return this.hint.textContent ?? ''; }
  get qrCanvasP2(): HTMLCanvasElement { return this.qr2; }
  get roomTextP2(): string { return this.code2.textContent ?? ''; }
  get roomText(): string { return this.code.textContent ?? ''; }

  // Con 2 jugadores se muestran dos tarjetas etiquetadas J1/J2; con 1 queda la interfaz de siempre
  setPlayerCount(n: number): void {
    this.pairing.dataset.players = String(n);
    this.card2.hidden = n < 2;
    this.tag1.hidden = n < 2;
    this.status[0].hidden = n < 2;
  }

  setConnected(player: number, ok: boolean): void {
    const el = this.status[player];
    if (!el) return;
    el.dataset.ok = ok ? '1' : '0';
    el.textContent = ok ? 'Conectado' : 'Esperando volante';
  }

  // player 0 = J1 (también alimenta el overlay de volante perdido); player 1 = J2
  setRoom(room: string, url: string, mode: WheelUrlMode, port: string, player = 0): void {
    this.rooms[player] = { room, url };
    if (player === 1) {
      this.code2.textContent = room;
      this.qr2.dataset.url = url;
      QRCode.toCanvas(this.qr2, url, { width: 320, margin: 2 }).catch(() => {});
      return;
    }
    this.code.textContent = room;
    if (this.lostFor === 0) this.lostCode.textContent = room;
    this.hint.textContent = pairingHint(mode, port);
    this.qr.dataset.url = url;
    const opts = { width: 320, margin: 2 };
    QRCode.toCanvas(this.qr, url, opts).catch(() => {});
    if (this.lostFor === 0) QRCode.toCanvas(this.lostQr, url, { ...opts, width: 220 }).catch(() => {});
  }

  // Overlay de volante perdido de un jugador (b15 D6): con 2 jugadores "Volante J2 desconectado" con su código y QR
  setLostPlayer(player: number, split: boolean): void {
    const label = split ? `Volante J${player + 1} desconectado` : 'Volante desconectado';
    if (this.lostLabel.textContent !== label) this.lostLabel.textContent = label;
    const r = this.rooms[player];
    if (!r || player === this.lostFor) return;
    this.lostFor = player;
    this.lostCode.textContent = r.room;
    QRCode.toCanvas(this.lostQr, r.url, { width: 220, margin: 2 }).catch(() => {});
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
