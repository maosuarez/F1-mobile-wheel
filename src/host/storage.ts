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

// Última elección del menú de carrera (b14): modo, dificultad y rivales; lo inválido se descarta
export interface RaceChoice { mode: 'practice' | 'race'; ai: 'easy' | 'medium' | 'hard'; rivals: number }
const CHOICE_KEY = 'f1mw.raceChoice';

export function loadRaceChoice(): RaceChoice | null {
  try {
    const raw = window.localStorage.getItem(CHOICE_KEY);
    if (raw === null) return null;
    const o = JSON.parse(raw) as Partial<RaceChoice>;
    if ((o.mode !== 'practice' && o.mode !== 'race') || (o.ai !== 'easy' && o.ai !== 'medium' && o.ai !== 'hard')) return null;
    const n = Math.round(Number(o.rivals));
    if (!Number.isFinite(n) || n < 1 || n > 9) return null;
    return { mode: o.mode, ai: o.ai, rivals: n };
  } catch {
    return null;
  }
}

export function saveRaceChoice(c: RaceChoice): void {
  try {
    window.localStorage.setItem(CHOICE_KEY, JSON.stringify(c));
  } catch {
    // almacenamiento no disponible: se ignora
  }
}
