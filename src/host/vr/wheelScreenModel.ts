import type { HudModel } from '../hudModel';
import type { DrawOp } from './panelModel';

// Instrumentos de la pantalla del volante 3D en VR (b20 D4): instrucciones puras, sin canvas.
export const WHEEL_SCREEN_W = 592;
export const WHEEL_SCREEN_H = 512;

const BG = '#05070c', FG = '#f2f4f8', DIM = '#8d96a8';
const GOOD = '#3ddc84', BAD = '#ff5a5a';
const DRS_COLOR: Record<0 | 1 | 2, string> = { 0: '#5a6272', 1: '#3ddc84', 2: '#2e8bff' };
const ERS = '#2ec4ff', OT = '#ffd400';

const text = (id: string, t: string, x: number, y: number, size: number, align: 'left' | 'center' | 'right', color = FG, weight = 700): DrawOp =>
  ({ kind: 'text', id, text: t, x, y, size, align, color, weight });

export function wheelScreenOps(m: HudModel, drs: 0 | 1 | 2, ersPct: number, ot: boolean): DrawOp[] {
  const W = WHEEL_SCREEN_W;
  const pct = Math.max(0, Math.min(100, ersPct));
  const bar = { x: 300, y: 362, w: 268, h: 40 };
  return [
    { kind: 'rect', x: 0, y: 0, w: W, h: WHEEL_SCREEN_H, color: BG },
    text('speed', m.speed, W / 2, 125, 124, 'center'),
    text('gear', m.gear, W / 2, 335, 220, 'center'),
    text('drs', 'DRS', 24, 402, 52, 'left', DRS_COLOR[drs]),
    { kind: 'rect', ...bar, color: '#1a1f2a' },
    { kind: 'rect', x: bar.x, y: bar.y, w: Math.round(bar.w * pct / 100), h: bar.h, color: ot ? OT : ERS },
    text('lapTime', m.lapTime, 24, 490, 64, 'left', m.lapTimeInvalid ? BAD : FG),
    text('delta', m.delta, W - 24, 490, 64, 'right', m.deltaTone === 'neg' ? GOOD : m.deltaTone === 'pos' ? BAD : DIM),
  ];
}
