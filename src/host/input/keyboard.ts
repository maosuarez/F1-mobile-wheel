import { config } from '../../shared/config';
import type { DriverCommand, DriverInput, SimState } from '../../sim/types';
import type { InputSource } from './types';

export interface KeyState { isDown(code: string): boolean }

// 'both' = un solo jugador con WASD y flechas (comportamiento original); 'p1' = WASD + Q/E/F + Espacio; 'p2' = config.split.p2Keys
export type KeyboardLayout = 'p1' | 'p2' | 'both';
interface Bindings { left: string[]; right: string[]; up: string[]; down: string[]; ers: string; edges: [string, DriverCommand][] }

export function keyBindings(layout: KeyboardLayout, p2 = config.split.p2Keys): Bindings {
  const wasd = { left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'] };
  const p1Edges: [string, DriverCommand][] = [['KeyE', 'shiftUp'], ['KeyQ', 'shiftDown'], ['KeyF', 'drs']];
  if (layout === 'p2') {
    return { left: [p2.left], right: [p2.right], up: [p2.up], down: [p2.down], ers: p2.ers,
             edges: [[p2.shiftUp, 'shiftUp'], [p2.shiftDown, 'shiftDown'], [p2.drs, 'drs']] };
  }
  if (layout === 'p1') return { ...wasd, ers: 'Space', edges: p1Edges };
  return { left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], ers: 'Space', edges: p1Edges };
}

const move = (v: number, target: number, rise: number, fall: number, dt: number): number => {
  // Hacia un valor mayor en módulo se usa la rampa de subida; hacia el reposo, la de bajada
  const rising = Math.abs(target) > Math.abs(v) || Math.sign(target) !== Math.sign(v) && target !== 0;
  const rate = 1 / (rising ? rise : fall);
  const step = rate * dt;
  return v < target ? Math.min(v + step, target) : Math.max(v - step, target);
};

// Lógica de teclado con rampas; el estado de teclas se inyecta (sin DOM)
export class KeyboardInput implements InputSource {
  readonly name = 'keyboard' as const;
  private steer = 0; private throttle = 0; private brake = 0;
  private pending: DriverCommand[] = [];
  private prevDown: Record<string, boolean> = {};

  private readonly b: Bindings;

  constructor(private readonly keys: KeyState, layout: KeyboardLayout = 'both', private readonly cfg = config.keyboard) {
    this.b = keyBindings(layout);
  }

  read(dtS: number, _state?: SimState): DriverInput {
    const k = this.keys, c = this.cfg, b = this.b;
    const any = (codes: string[]) => codes.some((x) => k.isDown(x));
    const steerT = (any(b.right) ? 1 : 0) - (any(b.left) ? 1 : 0);
    const thrT = any(b.up) ? 1 : 0;
    const brkT = any(b.down) ? 1 : 0;
    this.steer = move(this.steer, steerT, c.steerRiseS, c.steerFallS, dtS);
    this.throttle = move(this.throttle, thrT, c.pedalRiseS, c.pedalFallS, dtS);
    this.brake = move(this.brake, brkT, c.pedalRiseS, c.pedalFallS, dtS);
    // Órdenes por flanco: una pulsación mantenida genera una sola orden
    for (const [code, cmd] of b.edges) {
      const d = k.isDown(code);
      if (d && !this.prevDown[code]) this.pending.push(cmd);
      this.prevDown[code] = d;
    }
    return { steer: this.steer, throttle: this.throttle, brake: this.brake, ers: k.isDown(b.ers) };
  }

  takeCommands(): DriverCommand[] { const c = this.pending; this.pending = []; return c; }
}

const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash']);

// Adaptador fino de eventos del navegador
export class KeyboardAdapter implements KeyState {
  private down = new Set<string>();
  constructor(private readonly target: Window, private readonly cb: { onRecenter?: () => void; onPause?: () => void } = {}) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  isDown(code: string): boolean { return this.down.has(code); }

  private onDown = (e: KeyboardEvent) => {
    if (PREVENT.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    if (e.code === 'KeyR') this.cb.onRecenter?.();
    if (e.code === 'KeyP' || e.code === 'Escape') this.cb.onPause?.();
  };
  private onUp = (e: KeyboardEvent) => { this.down.delete(e.code); };
  private onBlur = () => { this.down.clear(); };

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
