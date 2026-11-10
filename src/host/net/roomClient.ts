import { encode, type Role } from '../../shared/protocol';

// Cliente WebSocket de una sala del relay (design D4). Lo usan el host y el volante.
// Reconexión con espera creciente 0,5 -> 3 s; responde pong a cada ping del relay (que no se reenvía a onMessage).

const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 3000;
const OPEN = 1;
// Cierres definitivos: 4001 reemplazado por otra conexión (reconectar provocaría un duelo), 4400 petición inválida
const NO_RETRY_CODES = new Set([4001, 4400]);
const PING = '{"t":"ping"}';

export class RoomClient {
  onMessage: (raw: string) => void = () => {};
  onStatus: (s: 'connecting' | 'open' | 'closed') => void = () => {};

  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = BACKOFF_MIN_MS;
  private stopped = false;
  private readonly WS: typeof WebSocket;
  private readonly url: string | undefined;

  constructor(private readonly role: Role, private readonly room: string, opts?: { url?: string; WebSocketImpl?: typeof WebSocket }) {
    this.url = opts?.url;
    this.WS = opts?.WebSocketImpl ?? globalThis.WebSocket;
  }

  // URL por defecto: mismo origen que la página (proxy /ws de Vite)
  private resolveUrl(): string {
    if (this.url) return this.url;
    const loc = globalThis.location;
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${loc.host}/ws/${encodeURIComponent(this.room)}?role=${this.role}`;
  }

  connect(): void {
    this.stopped = false;
    this.clearTimer();
    this.open();
  }

  private open(): void {
    this.onStatus('connecting');
    let ws: WebSocket;
    try { ws = new this.WS(this.resolveUrl()); } catch { this.scheduleRetry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.backoffMs = BACKOFF_MIN_MS;
      this.onStatus('open');
    };
    ws.onmessage = (e: MessageEvent) => {
      if (this.ws !== ws || typeof e.data !== 'string') return;
      if (e.data.trim() === PING) { this.send(encode({ t: 'pong' })); return; }
      this.onMessage(e.data);
    };
    ws.onerror = () => {};                                       // el cierre llega por onclose
    ws.onclose = (e: CloseEvent) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.onStatus('closed');
      if (!this.stopped && !NO_RETRY_CODES.has(e.code)) this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    this.clearTimer();
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    this.timer = setTimeout(() => { this.timer = null; if (!this.stopped) this.open(); }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
  }

  send(text: string): void {
    if (this.ws && this.ws.readyState === OPEN) this.ws.send(text);
  }

  close(): void {
    this.stopped = true;
    this.clearTimer();
    const ws = this.ws;
    this.ws = null;
    if (ws) { try { ws.close(); } catch { /* ya cerrado */ } }
    this.onStatus('closed');
  }
}
