// Pulsación sostenida: update() devuelve true una sola vez al cruzar el umbral y se rearma al soltar
export interface HoldDetector { update(pressed: boolean, dtMs: number): boolean; reset(): void }

export function holdDetector(thresholdMs: number): HoldDetector {
  let heldMs = 0;
  let fired = false;
  return {
    update(pressed, dtMs) {
      if (!pressed) { heldMs = 0; fired = false; return false; }
      heldMs += dtMs;
      if (!fired && heldMs >= thresholdMs) { fired = true; return true; }
      return false;
    },
    reset() { heldMs = 0; fired = false; },
  };
}
