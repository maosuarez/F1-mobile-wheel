import { config, type GameConfig } from '../../shared/config';
import type { DriverCommand, DriverInput, SimState } from '../../sim/types';
import type { WheelLink } from '../net/wheelSource';
import type { InputSource } from './types';
import { holdDetector, type HoldDetector } from '../../shared/hold';
import { mapControllers, rollFromQuaternion, stickShiftEdges, type StickShiftState } from './vrControllersMap';

// Lo mínimo de renderer.xr (WebXRManager) que necesita la fuente
export interface XrFrameProvider {
  getSession(): XRSession | null;
  getFrame(): XRFrame | null;
  getReferenceSpace(): XRReferenceSpace | null;
}

// Mandos WebXR como fuente de entrada (design D7)
export class VrControllersSource implements InputSource {
  readonly name = 'controllers' as const;
  private steer = 0;
  private stick: StickShiftState = { latched: false };
  private pending: DriverCommand[] = [];

  constructor(private readonly xr: XrFrameProvider, private readonly cfg: GameConfig['vr'] = config.vr) {}

  read(dtS: number, _state?: SimState): DriverInput {
    let rightTrigger = 0, leftTrigger = 0;
    let rightRollRad: number | null = null;
    let stickY = 0;
    const session = this.xr.getSession();
    if (session) {
      const frame = this.xr.getFrame();
      const ref = this.xr.getReferenceSpace();
      for (const src of session.inputSources) {
        const trigger = src.gamepad?.buttons[0]?.value ?? 0;
        const y = src.gamepad?.axes?.[3] ?? 0;
        if (Math.abs(y) > Math.abs(stickY)) stickY = y;
        if (src.handedness === 'right') {
          rightTrigger = trigger;
          if (frame && ref && src.gripSpace) {
            const o = frame.getPose(src.gripSpace, ref)?.transform.orientation;
            if (o) rightRollRad = rollFromQuaternion(o.x, o.y, o.z, o.w);
          }
        } else if (src.handedness === 'left') leftTrigger = trigger;
      }
    }
    const sh = stickShiftEdges(this.stick, stickY, this.cfg);
    this.stick = sh.state;
    if (sh.cmd) this.pending.push(sh.cmd);
    const input = mapControllers({ rightTrigger, leftTrigger, rightRollRad, prevSteer: this.steer }, dtS, this.cfg);
    this.steer = input.steer;
    return input;
  }

  takeCommands(): DriverCommand[] { const c = this.pending; this.pending = []; return c; }

  reset(): void { this.steer = 0; this.stick = { latched: false }; this.pending = []; }

  // Botones A (derecho) y X (izquierdo): buttons[4] en el mapeo xr-standard. Se sondea cada fotograma
  // en VR, también en pausa (read() solo corre en carrera)
  // B (derecho) e Y (izquierdo), buttons[5]: reinicio con pulsación sostenida (b9)
  pollButtons(dtMs = 0): VrButtonEvent[] {
    const cur = { a: false, x: false };
    let b = false, y = false;
    const session = this.xr.getSession();
    if (session) for (const src of session.inputSources) {
      const pressed = src.gamepad?.buttons[4]?.pressed ?? false;
      const second = src.gamepad?.buttons[5]?.pressed ?? false;
      if (src.handedness === 'right') { cur.a = pressed; b = second; }
      else if (src.handedness === 'left') { cur.x = pressed; y = second; }
    }
    const ev = buttonEdges(this.prevButtons, cur);
    this.prevButtons = cur;
    const holdR = this.holdRight.update(b, dtMs), holdL = this.holdLeft.update(y, dtMs);
    if (holdR || holdL) ev.push('restart');
    return ev;
  }
  private holdRight: HoldDetector = holdDetector(config.race.restartHoldMs);
  private holdLeft: HoldDetector = holdDetector(config.race.restartHoldMs);
  private prevButtons: VrButtons = { a: false, x: false };
}

export interface VrButtons { a: boolean; x: boolean }
export type VrButtonEvent = 'pause' | 'recenter' | 'restart';

// Flanco de subida: mantener un botón genera un solo evento
export function buttonEdges(prev: VrButtons, cur: VrButtons): VrButtonEvent[] {
  const ev: VrButtonEvent[] = [];
  if (cur.a && !prev.a) ev.push('pause');
  if (cur.x && !prev.x) ev.push('recenter');
  return ev;
}

// Prioridad (design D8): volante conectado > mandos (con sesión VR) > teclado
export const controllersCanDrive = (inVr: boolean, wheelLink: WheelLink): boolean =>
  inVr && wheelLink !== 'ok' && wheelLink !== 'stale';

// Fuente a fijar tras updateWheel, o null si no hay cambio. Los mandos solo sustituyen al teclado
// (nunca al volante ni al piloto automático) y lo devuelven al dejar de poder conducir
export function nextVrSource(current: InputSource, keyboard: InputSource, controllers: InputSource,
  inVr: boolean, wheelLink: WheelLink): InputSource | null {
  const can = controllersCanDrive(inVr, wheelLink);
  if (can && current === keyboard) return controllers;
  if (!can && current === controllers) return keyboard;
  return null;
}
