import { config } from './config';

// Escuderías y pilotos ficticios (b14 D5). Colores sRGB. Ningún nombre real de equipo, piloto ni patrocinador.
// La escudería 0 es la del jugador (colores de carVisual); su primer piloto es el jugador.

export interface Driver { name: string; code: string }   // code: 3 letras
export interface Team { name: string; primary: string; accent: string; drivers: [Driver, Driver] }

// Segundo jugador humano local (b15): comparte la escudería 0 pero no su identidad de compañero de IA.
export const PLAYER2_DRIVER: Driver = { name: 'Jugador 2', code: 'JG2' };

export const TEAMS: readonly Team[] = [
  { name: 'Escudería del jugador', primary: config.carVisual.colors.primary, accent: config.carVisual.colors.accent,
    drivers: [{ name: 'Jugador', code: 'JUG' }, { name: 'Tomás Arrieta', code: 'ARR' }] },
  { name: 'Aurora Motorsport', primary: '#7a1f3d', accent: '#f2e6c9',
    drivers: [{ name: 'Lena Voss', code: 'VOS' }, { name: 'Dario Montes', code: 'MTS' }] },
  { name: 'Volta Corse', primary: '#2f6b2a', accent: '#e8e14a',
    drivers: [{ name: 'Kai Brandt', code: 'BRD' }, { name: 'Nils Okafor', code: 'OKF' }] },
  { name: 'Kestrel GP', primary: '#e8e8ea', accent: '#d2462c',
    drivers: [{ name: 'Rafa Quintero', code: 'QTR' }, { name: 'Elio Marchetti', code: 'MCH' }] },
  { name: 'Nébula Racing', primary: '#3b2a6e', accent: '#38d6c4',
    drivers: [{ name: 'Sami Lindqvist', code: 'LDQ' }, { name: 'Joan Prat', code: 'PRT' }] },
];

// Plaza k (0..9) de la parrilla de pilotos: escudería k >> 1, piloto k & 1.
export function driverAt(k: number): { team: number; driver: Driver } {
  const team = (k >> 1) % TEAMS.length;
  return { team, driver: TEAMS[team].drivers[k & 1] };
}
