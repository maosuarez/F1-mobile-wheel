// Mejor vuelta por circuito en localStorage; cualquier fallo se ignora
const key = (trackId: string) => `f1mw.best.${trackId}`;

export function loadBest(trackId: string): number | null {
  try {
    const v = window.localStorage.getItem(key(trackId));
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function saveBest(trackId: string, timeS: number): void {
  try {
    window.localStorage.setItem(key(trackId), String(timeS));
  } catch {
    // almacenamiento no disponible: se ignora
  }
}
