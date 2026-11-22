// Calibración del volante del celular antes de la salida en VR (b20 D6): decisiones puras

export interface CalibrationCtx { inVr: boolean; online: boolean; players: number; wheelOk: boolean; wheelIsSource: boolean }

// Espera de calibración antes de la cuenta atrás: solo en VR, fuera de online, 1 jugador y con el volante conectado al mando
export function needsCalibration(c: CalibrationCtx): boolean {
  return c.inVr && !c.online && c.players === 1 && c.wheelOk && c.wheelIsSource;
}

// Campo `cal` de la telemetría: durante la espera, y en online con VR durante el vestíbulo y la cuenta atrás (sin bloquear)
export function telCal(state: string, online: boolean, inVr: boolean): boolean {
  return state === 'calibrating' || (online && inVr && (state === 'lobby' || state === 'countdown'));
}

// Al salir de VR durante la espera de calibración, la salida arranca sin esperar (sin VR no hay espera)
export function startsOnVrExit(state: string): boolean {
  return state === 'calibrating';
}
