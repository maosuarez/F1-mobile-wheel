import { config } from '../../shared/config';
import type { DriverCommand, DriverInput, SimState } from '../../sim/types';
import type { InputSource } from './types';

export interface KeyState { isDown(code: string): boolean }

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

  constructor(private readonly keys: KeyState, private readonly cfg = config.keyboard) {}

  read(dtS: number, _state?: SimState): DriverInput {
    const k = this.keys, c = this.cfg;
    const steerT = (k.isDown('ArrowRight') || k.isDown('KeyD') ? 1 : 0) - (k.isDown('ArrowLeft') || k.isDown('KeyA') ? 1 : 0);
    const thrT = k.isDown('ArrowUp') || k.isDown('KeyW') ? 1 : 0;
    const brkT = k.isDown('ArrowDown') || k.isDown('KeyS') ? 1 : 0;
    this.steer = move(this.steer, steerT, c.steerRiseS, c.steerFallS, dtS);
    this.throttle = move(this.throttle, thrT, c.pedalRiseS, c.pedalFallS, dtS);
    this.brake = move(this.brake, brkT, c.pedalRiseS, c.pedalFallS, dtS);
    return { steer: this.steer, throttle: this.throttle, brake: this.brake, ers: false };
  }

  takeCommands(): DriverCommand[] { return []; }
}

const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

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
