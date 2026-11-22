import { config } from '../../shared/config';
import type { KeyboardLayout } from '../input/keyboard';
import type { RoomClient } from '../net/roomClient';
import type { WheelLink, WheelSource } from '../net/wheelSource';

// Jugadores locales (b15, design D1/D2). Lógica pura; el armazón (main.ts del grupo 2) construye LocalPlayer con esto.

export type PlayerSourceKind = 'wheel' | 'gamepad' | 'keyboard';
export const PLAYER_LABELS = ['J1', 'J2'] as const;
export const PLAYER_COLORS = ['#ff8a3d', '#4cc3ff'] as const;

// Una sala del relay por jugador: código propio y su WheelSource
export interface PlayerRoom { index: number; room: string; wheel: WheelSource; client: RoomClient }

// Número de jugadores desde la URL (`players=2`); null si falta o no es válido
export function parsePlayers(params: URLSearchParams): 1 | 2 | null {
  const n = Number(params.get('players'));
  if (!params.has('players') || !Number.isInteger(n) || n < 1 || n > config.split.maxPlayers) return null;
  return n === 2 ? 2 : 1;
}

// Prioridad por jugador: volante enlazado de su sala > mando con índice = jugador > teclado de su mitad.
// `pads` = nº de mandos estándar presentes en índices contiguos desde 0; el jugador i usa el mando i
export function assignSources(n: number, pads: number, wheels: readonly WheelLink[]): PlayerSourceKind[] {
  const out: PlayerSourceKind[] = [];
  for (let i = 0; i < n; i++) {
    const w = wheels[i];
    out.push(w === 'ok' || w === 'stale' ? 'wheel' : i < pads ? 'gamepad' : 'keyboard');
  }
  return out;
}

// Teclado: con 1 jugador WASD y flechas en el mismo coche; con 2, J1 WASD y J2 flechas
export const keyboardLayoutFor = (n: number, index: number): KeyboardLayout => (n <= 1 ? 'both' : index === 0 ? 'p1' : 'p2');
