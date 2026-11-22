// Catálogo de circuitos (b17 D4). Cada id tiene /track/<id>.json y /track/<id>.world.json.
export interface TrackInfo { id: string; name: string; country: string }

export const TRACKS: TrackInfo[] = [
  { id: 'interlagos', name: 'Interlagos', country: 'Brasil' },
  { id: 'spa', name: 'Spa-Francorchamps', country: 'Bélgica' },
];

export const DEFAULT_TRACK_ID = 'interlagos';

export function trackById(id: string): TrackInfo | undefined {
  return TRACKS.find((t) => t.id === id);
}

// Id del circuito a cargar: `?track` (aunque sea desconocido: se muestra el error) > recordado válido > interlagos
export function resolveTrackId(param: string | null, remembered: string | null): string {
  if (param !== null) return param;
  if (remembered !== null && trackById(remembered)) return remembered;
  return DEFAULT_TRACK_ID;
}

// Elección recordada del menú; cualquier fallo del almacenamiento se ignora
const TRACK_KEY = 'f1mw.track';

export function loadTrackChoice(storage: () => Storage = () => window.localStorage): string | null {
  try {
    const v = storage().getItem(TRACK_KEY);
    return v !== null && trackById(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveTrackChoice(id: string, storage: () => Storage = () => window.localStorage): void {
  try {
    storage().setItem(TRACK_KEY, id);
  } catch {
    // almacenamiento no disponible: se ignora
  }
}

// URL con `?track=<id>` (conserva el resto de parámetros); `extra` añade o quita (null) parámetros
export function trackUrl(href: string, id: string, extra: Record<string, string | null> = {}): string {
  const u = new URL(href);
  u.searchParams.set('track', id);
  for (const [k, v] of Object.entries(extra)) {
    if (v === null) u.searchParams.delete(k); else u.searchParams.set(k, v);
  }
  return u.toString();
}
