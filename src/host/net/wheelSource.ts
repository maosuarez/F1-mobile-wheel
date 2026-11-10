import type { GameConfig } from '../../shared/config';
import type { EvKey, EvMsg, InMsg, PeerMsg } from '../../shared/protocol';
import { NEUTRAL_INPUT, type DriverCommand, type DriverInput, type SimState } from '../../sim/types';
import type { InputSource } from '../input/types';

// Volante como fuente de entrada (design D4). Lógica pura con reloj inyectado (ms).

export type WheelLink = 'none' | 'ok' | 'stale' | 'lost';

const COMMANDS: Partial<Record<EvKey, DriverCommand>> = { up: 'shiftUp', down: 'shiftDown', drs: 'drs' };

export class WheelSource implements InputSource {
  readonly name = 'wheel' as const;
  private last: InMsg | null = null;
  private lastAtMs = 0;
  private lastSeq = -Infinity;
  private peerGone = false;
  private commands: DriverCommand[] = [];
  private uiEvents: EvKey[] = [];

  constructor(private readonly cfg: GameConfig, private readonly now: () => number) {}

  handleMessage(msg: InMsg | EvMsg | PeerMsg): void {
    switch (msg.t) {
      case 'in':
        if (msg.seq <= this.lastSeq) return;                     // duplicado o desordenado
        this.lastSeq = msg.seq;
        this.last = msg;
        this.lastAtMs = this.now();
        this.peerGone = false;
        return;
      case 'ev': {
        const c = COMMANDS[msg.k];
        if (c) this.commands.push(c); else this.uiEvents.push(msg.k);
        return;
      }
      case 'peer':
        if (msg.role !== 'wheel') return;
        if (msg.connected) this.lastSeq = -Infinity;             // un volante nuevo empieza su seq desde 0
        else this.peerGone = true;
        return;
    }
  }

  private ageMs(): number { return this.now() - this.lastAtMs; }

  read(_dtS: number, _state: SimState): DriverInput {
    const m = this.last;
    if (!m) return { ...NEUTRAL_INPUT };
    const input: DriverInput = { steer: m.steer, throttle: m.thr, brake: m.brk, ers: m.ers };
    // Sin entradas recientes: soltar acelerador y ERS, mantener dirección y freno
    if (this.peerGone || this.ageMs() > this.cfg.net.inputStaleMs) { input.throttle = 0; input.ers = false; }
    return input;
  }

  takeCommands(): DriverCommand[] {
    const c = this.commands;
    this.commands = [];
    return c;
  }

  // 'pause', 'cam', 'recal' para el armazón; cada evento se entrega una sola vez
  takeUiEvents(): EvKey[] {
    const e = this.uiEvents;
    this.uiEvents = [];
    return e;
  }

  link(): WheelLink {
    if (this.peerGone) return 'lost';
    if (!this.last) return 'none';
    const age = this.ageMs();
    if (age > this.cfg.net.inputLostMs) return 'lost';
    if (age > this.cfg.net.inputStaleMs) return 'stale';
    return 'ok';
  }

  lastRttMs(): number | null { return this.last ? this.last.rtt : null; }

  // ts del último `in` y tiempo que lleva retenido en el PC (para que el volante descuente la espera del RTT)
  echo(): { ts: number; holdMs: number } {
    if (!this.last) return { ts: 0, holdMs: 0 };
    return { ts: this.last.ts, holdMs: Math.max(0, this.ageMs()) };
  }
}
