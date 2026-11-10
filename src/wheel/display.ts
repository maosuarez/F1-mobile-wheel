import type { TelMsg } from '../shared/protocol';

// Pantalla de telemetría del volante: solo DOM, sin lógica de red.

const q = <T extends HTMLElement>(root: ParentNode, id: string): T => {
  const el = root.querySelector<T>(`[data-testid="${id}"]`);
  if (!el) throw new Error(`falta data-testid=${id}`);
  return el;
};

export class Display {
  private readonly speed = q(document, 'disp-speed');
  private readonly gear = q(document, 'disp-gear');
  private readonly ledsBox = q(document, 'disp-leds');
  private readonly leds: HTMLElement[] = [];
  private readonly drs = q(document, 'disp-drs');
  private readonly ot = q(document, 'disp-ot');
  private readonly ers = q(document, 'disp-ers');
  private readonly ersFill = this.ers.querySelector('i') as HTMLElement;
  private readonly lap = q(document, 'disp-lap');
  private readonly delta = q(document, 'disp-delta');
  private readonly warn = q(document, 'disp-warn');
  private readonly rtt = q(document, 'disp-rtt');
  private readonly status = q(document, 'wheel-status');
  private readonly flat = q(document, 'flat-warning');

  constructor() {
    for (let i = 0; i < 15; i++) {
      const d = document.createElement('i');
      d.className = `led ${i < 5 ? 'g' : i < 10 ? 'r' : 'b'}`;
      this.ledsBox.appendChild(d);
      this.leds.push(d);
    }
  }

  update(t: TelMsg): void {
    this.speed.textContent = String(Math.round(t.spd));
    this.gear.textContent = t.gear === -1 ? 'R' : t.gear === 0 ? 'N' : String(t.gear);
    this.gear.dataset.kind = t.gear === -1 ? 'r' : t.gear === 0 ? 'n' : 'g';
    const limiter = t.leds >= 16;
    this.leds.forEach((d, i) => d.classList.toggle('on', limiter || i < t.leds));
    this.ledsBox.classList.toggle('limiter', limiter);
    this.drs.dataset.state = String(t.drs);
    this.drs.textContent = t.drs === 2 ? 'DRS ABIERTO' : t.drs === 1 ? 'DRS LISTO' : 'DRS';
    this.ot.dataset.on = t.ot ? '1' : '0';
    this.ers.dataset.value = String(t.ers);
    this.ersFill.style.width = `${Math.round(t.ers * 100)}%`;
    this.lap.textContent = String(t.lap);
    this.delta.textContent = t.delta === null ? '—' : `${t.delta >= 0 ? '+' : '−'}${Math.abs(t.delta).toFixed(3)}`;
    this.warn.textContent = t.warn;
  }

  setRtt(ms: number | null): void {
    this.rtt.textContent = ms === null ? '—' : `${Math.round(ms)} ms`;
  }

  setStatus(text: string, state: string): void {
    this.status.textContent = text;
    this.status.dataset.state = state;
  }

  setFlat(on: boolean): void {
    this.flat.hidden = !on;
  }
}
