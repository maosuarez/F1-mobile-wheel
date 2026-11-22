import type { HudModel } from '../hudModel';
import type { TowerRow } from '../race/tower';

// Instrucciones de dibujo puras para el panel VR (b7, design D6): testeables sin canvas.
export const PANEL_W = 1024;
export const PANEL_H = 512;

export type DrawOp =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string }
  | { kind: 'text'; id: string; text: string; x: number; y: number; size: number; align: 'left' | 'center' | 'right'; color: string; weight?: number }
  | { kind: 'qr'; x: number; y: number; size: number };       // el panel copia aquí el canvas del QR de pairing.ts

// Posición y vuelta de carrera (b14); ausente en práctica
export interface PanelRace { pos: number; total: number; lap: number; laps: number }

export type PanelScreen =
  | { kind: 'hud'; model: HudModel; race?: PanelRace }
  | { kind: 'pairing'; room: string; hint: string }
  | { kind: 'countdown'; n: number }
  | { kind: 'paused' }
  // b20 D5: panel de carrera en VR (speed/gear solo con cámaras que no son casco) y espera de calibración
  | { kind: 'race'; race: PanelRace; ahead: string; behind: string; rows: TowerRow[]; speed?: string; gear?: string }
  | { kind: 'calibrate' };

const BG = 'rgba(8,10,16,0.78)';
const FG = '#f2f4f8', DIM = '#8d96a8', WARN = '#ffb020', BAD = '#ff5a5a';

const rect = (x: number, y: number, w: number, h: number, color: string): DrawOp => ({ kind: 'rect', x, y, w, h, color });
const text = (id: string, t: string, x: number, y: number, size: number, align: 'left' | 'center' | 'right', color = FG, weight = 700): DrawOp =>
  ({ kind: 'text', id, text: t, x, y, size, align, color, weight });

// HUD: velocidad, marcha, vuelta, tiempos y un único aviso (el modelo ya trae el aviso prioritario resuelto)
export function drawPanelModel(m: HudModel, race?: PanelRace): DrawOp[] {
  const ops: DrawOp[] = [rect(0, 0, PANEL_W, PANEL_H, BG)];
  ops.push(text('speed', m.speed, 300, 250, 190, 'right'));
  ops.push(text('speedUnit', 'km/h', 320, 250, 44, 'left', DIM, 500));
  ops.push(text('gear', m.gear, 820, 250, 220, 'center', FG));
  ops.push(text('lap', `VUELTA ${m.lap}`, 40, 70, 48, 'left', DIM));
  ops.push(text('lapTime', m.lapTime, 40, 340, 80, 'left', m.lapTimeInvalid ? BAD : FG));
  ops.push(text('last', `ÚLT ${m.last}`, 40, 420, 52, 'left', m.lastInvalid ? BAD : DIM, 600));
  ops.push(text('best', `MEJOR ${m.best}`, 40, 485, 52, 'left', DIM, 600));
  if (race) ops.push(text('race', `P${race.pos}/${race.total} · V ${Math.min(race.lap, race.laps)}/${race.laps}`, 984, 70, 48, 'right', WARN));
  if (m.warn !== '') ops.push(text('warn', m.warn, 780, 440, 76, 'center', WARN));
  return ops;
}

// Leyenda del mapeo de los mandos de Quest (b9, design D7): dos columnas en la franja inferior,
// misma posición en pairing y paused. Textos ≤ 44 caracteres a 28 px
export const LEGEND_SIZE = 28;
export function legendOps(): DrawOp[] {
  const rows = [310, 350, 390];
  const col = (id: string, t: string, x: number, y: number, color = FG) => text(id, t, x, y, LEGEND_SIZE, 'left', color, 600);
  return [
    col('legendStart', 'A = EMPEZAR', 40, rows[0], WARN),
    col('legendDrs', 'AGARRE IZQ = DRS', 40, rows[1]),
    col('legendErs', 'AGARRE DER = ERS', 40, rows[2]),
    col('legendCam', 'CLIC PALANCA IZQ = CÁMARA', 540, rows[0]),
    col('legendGear', 'PALANCA = MARCHAS', 540, rows[1]),
    col('legendPause', 'A = PAUSA · B/Y = REINICIO', 540, rows[2]),
  ];
}

const HINT_MAX = 44;

// Panel de carrera (b20 D5): cabecera, diferencias y hasta 6 filas de la torre con el jugador resaltado
export const RACE_ROWS = 6;
function raceOps(s: Extract<PanelScreen, { kind: 'race' }>): DrawOp[] {
  const r = s.race;
  const ops: DrawOp[] = [rect(0, 0, PANEL_W, PANEL_H, BG)];
  ops.push(text('race', `P${r.pos}/${r.total} · V ${Math.min(r.lap, r.laps)}/${r.laps}`, 40, 76, 60, 'left', WARN));
  ops.push(text('ahead', `▲ ${s.ahead}`, 40, 140, 42, 'left', FG, 600));
  ops.push(text('behind', `▼ ${s.behind}`, 300, 140, 42, 'left', FG, 600));
  if (s.speed !== undefined) ops.push(text('speed', `${s.speed} km/h`, 820, 76, 56, 'right'));
  if (s.gear !== undefined) ops.push(text('gear', s.gear, 984, 76, 60, 'right'));
  s.rows.slice(0, RACE_ROWS).forEach((row, i) => {
    const y = 210 + i * 52;
    if (row.player) ops.push(rect(30, y - 40, 600, 50, 'rgba(255,176,32,0.22)'));
    ops.push(text(`row${i}Pos`, String(row.pos), 90, y, 36, 'right', row.player ? WARN : DIM));
    ops.push(rect(110, y - 28, 10, 30, row.color));
    ops.push(text(`row${i}Code`, row.code, 140, y, 36, 'left', FG));
    ops.push(text(`row${i}Gap`, row.gap, 610, y, 36, 'right', row.player ? FG : DIM, 600));
  });
  return ops;
}

export function drawScreen(s: PanelScreen): DrawOp[] {
  switch (s.kind) {
    case 'hud': return drawPanelModel(s.model, s.race);
    case 'pairing': return [
      rect(0, 0, PANEL_W, PANEL_H, BG),
      text('pairTitle', 'SALA', 40, 70, 44, 'left', DIM),
      text('room', s.room, 40, 240, 170, 'left'),
      ...legendOps(),
      text('hint', s.hint.length > HINT_MAX ? `${s.hint.slice(0, HINT_MAX - 1)}…` : s.hint, 40, 475, 28, 'left', DIM, 500),
      { kind: 'qr', x: 774, y: 30, size: 220 },
    ];
    case 'countdown': return [rect(0, 0, PANEL_W, PANEL_H, BG), text('countdown', String(s.n), 512, 340, 300, 'center')];
    case 'paused': return [
      rect(0, 0, PANEL_W, PANEL_H, BG),
      text('paused', 'PAUSA', 512, 220, 170, 'center', WARN),
      ...legendOps(),
    ];
    case 'race': return raceOps(s);
    case 'calibrate': return [
      rect(0, 0, PANEL_W, PANEL_H, BG),
      text('cal1', 'CALIBRA EL VOLANTE', 512, 200, 84, 'center', WARN),
      text('cal2', 'EN EL CELULAR', 512, 310, 84, 'center'),
      text('calSkip', 'A = SALTAR', 512, 440, LEGEND_SIZE, 'center', DIM, 600),
    ];
  }
}
