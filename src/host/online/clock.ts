import { config as defaultConfig, type GameConfig } from '../../shared/config';

// Reloj común con el servidor (b16 D3). Al entrar: net.clockPings peticiones `time` en serie (el relay no las numera);
// offset = mediana de srv − (t0 + t1)/2. Después, una petición cada net.clockResyncS y offset = media móvil de las
// últimas net.clockPings muestras. Los tiempos de red van en ms del reloj del servidor.

const RETRY_MS = 2000;   // si una respuesta no llega en este tiempo se vuelve a preguntar

export class ClockSync {
  offsetMs = 0;
  synced = false;
  /** Último tiempo de ida y vuelta medido (ms). */
  rttMs: number | null = null;
  private readonly samples: number[] = [];
  private initial = 0;               // muestras que faltan de la ráfaga inicial
  private pendingT0: number | null = null;
  private lastSyncMs = 0;
  private readonly pings: number;
  private readonly resyncMs: number;

  // send: envía {t:'time'}; now: reloj local en ms (performance.now en el navegador).
  constructor(private readonly send: () => void, private readonly now: () => number, cfg: GameConfig = defaultConfig) {
    this.pings = Math.max(1, cfg.net.clockPings);
    this.resyncMs = cfg.net.clockResyncS * 1000;
  }

  // Ráfaga inicial (al conectar al vestíbulo).
  begin(): void {
    this.samples.length = 0;
    this.synced = false;
    this.initial = this.pings;
    this.ask();
  }

  // Respuesta {t:'time', srv}.
  onTime(srv: number): void {
    if (this.pendingT0 === null) return;
    const t1 = this.now(), t0 = this.pendingT0;
    this.pendingT0 = null;
    this.rttMs = t1 - t0;
    this.samples.push(srv - (t0 + t1) / 2);
    if (this.samples.length > this.pings) this.samples.shift();
    this.lastSyncMs = t1;
    if (this.initial > 0) {
      this.initial--;
      if (this.initial > 0) { this.ask(); return; }
      const s = [...this.samples].sort((a, b) => a - b);
      const m = s.length >> 1;
      this.offsetMs = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
      this.synced = true;
      return;
    }
    this.offsetMs = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }

  // Llamar a menudo (p. ej. cada fotograma): reintentos y re-sincronización periódica.
  tick(): void {
    const t = this.now();
    if (this.pendingT0 !== null) { if (t - this.pendingT0 >= RETRY_MS) this.ask(); return; }
    if (this.synced && t - this.lastSyncMs >= this.resyncMs) this.ask();
  }

  // Ahora en el reloj del servidor (ms).
  nowSrv(): number { return this.now() + this.offsetMs; }

  // Instante del servidor → reloj local (ms).
  toLocal(srvMs: number): number { return srvMs - this.offsetMs; }

  private ask(): void {
    this.pendingT0 = this.now();
    this.send();
  }
}
