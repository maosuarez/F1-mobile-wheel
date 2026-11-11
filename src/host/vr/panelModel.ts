import type { HudModel } from '../hudModel';

// Instrucciones de dibujo puras para el panel VR (b7, design D6): testeables sin canvas.
export const PANEL_W = 1024;
export const PANEL_H = 512;

export type DrawOp =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string }
  | { kind: 'text'; id: string; text: string; x: number; y: number; size: number; align: 'left' | 'center' | 'right'; color: string; weight?: number }
  | { kind: 'qr'; x: number; y: number; size: number };       // el panel copia aquí el canvas del QR de pairing.ts

export type PanelScreen =
  | { kind: 'hud'; model: HudModel }
  | { kind: 'pairing'; room: string; hint: string }
  | { kind: 'countdown'; n: number }
  | { kind: 'paused' };

const BG = 'rgba(8,10,16,0.78)';
const FG = '#f2f4f8', DIM = '#8d96a8', WARN = '#ffb020', BAD = '#ff5a5a';

const rect = (x: number, y: number, w: number, h: number, color: string): DrawOp => ({ kind: 'rect', x, y, w, h, color });
const text = (id: string, t: string, x: number, y: number, size: number, align: 'left' | 'center' | 'right', color = FG, weight = 700): DrawOp =>
  ({ kind: 'text', id, text: t, x, y, size, align, color, weight });

// HUD: velocidad, marcha, vuelta, tiempos y un único aviso (el modelo ya trae el aviso prioritario resuelto)
export function drawPanelModel(m: HudModel): DrawOp[] {
  const ops: DrawOp[] = [rect(0, 0, PANEL_W, PANEL_H, BG)];
  ops.push(text('speed', m.speed, 300, 250, 190, 'right'));
  ops.push(text('speedUnit', 'km/h', 320, 250, 44, 'left', DIM, 500));
  ops.push(text('gear', m.gear, 820, 250, 220, 'center', FG));
  ops.push(text('lap', `VUELTA ${m.lap}`, 40, 70, 48, 'left', DIM));
  ops.push(text('lapTime', m.lapTime, 40, 340, 80, 'left', m.lapTimeInvalid ? BAD : FG));
  ops.push(text('last', `ÚLT ${m.last}`, 40, 420, 52, 'left', m.lastInvalid ? BAD : DIM, 600));
  ops.push(text('best', `MEJOR ${m.best}`, 40, 485, 52, 'left', DIM, 600));
  if (m.warn !== '') ops.push(text('warn', m.warn, 780, 440, 76, 'center', WARN));
  return ops;
}

export function drawScreen(s: PanelScreen): DrawOp[] {
  switch (s.kind) {
    case 'hud': return drawPanelModel(s.model);
    case 'pairing': return [
      rect(0, 0, PANEL_W, PANEL_H, BG),
      text('pairTitle', 'SALA', 40, 90, 48, 'left', DIM),
      text('room', s.room, 40, 250, 150, 'left'),
      text('hint', s.hint.length > 52 ? `${s.hint.slice(0, 51)}…` : s.hint, 40, 470, 30, 'left', DIM, 500),
      { kind: 'qr', x: 640, y: 96, size: 320 },
    ];
    case 'countdown': return [rect(0, 0, PANEL_W, PANEL_H, BG), text('countdown', String(s.n), 512, 340, 300, 'center')];
    case 'paused': return [rect(0, 0, PANEL_W, PANEL_H, BG), text('paused', 'PAUSA', 512, 320, 200, 'center', WARN)];
  }
}
