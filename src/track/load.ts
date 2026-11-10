import type { Track } from './types';
import { parseTrackJson } from './schema';
import { buildTrack } from './track';

// Carga /track/<id>.json, lo valida y lo convierte en pista en memoria.
export async function loadTrack(id: string): Promise<Track> {
  const url = `/track/${id}.json`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`No se pudo cargar ${url}: ${(e as Error).message}`);
  }
  if (!res.ok) throw new Error(`No se pudo cargar ${url}: HTTP ${res.status}`);
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new Error(`${url}: JSON inválido`);
  }
  return buildTrack(parseTrackJson(raw));
}
