import { describe, expect, it } from 'vitest';
import { hudModel } from '../src/host/hudModel';
import { drawPanelModel, drawScreen, type DrawOp } from '../src/host/vr/panelModel';
import { WarningCenter } from '../src/host/warnings';
import type { SimState } from '../src/sim/types';

const mk = (car: object = {}, timing: object = {}) => ({
  t: 0, stepCount: 0,
  car: { speed: 50, gear: 5, leds: 9, drs: 0, ersCharge: 1, overtake: false, overheated: false, ...car },
  timing: { lap: 2, lapTimeS: 78.457, lastLapS: 80.1, lastLapValid: true, bestLapS: 79.003, sector: 1, sectorTimesS: [null, null, null],
    lastSectorTimesS: [null, null, null], lapValid: true, deltaS: null, ...timing },
}) as unknown as SimState;
const none = [null, null, null];
const txt = (ops: DrawOp[], id: string) => { const o = ops.find((x) => x.kind === 'text' && x.id === id); return o && o.kind === 'text' ? o.text : undefined; };
const ops = (s: SimState, warn = '') => drawPanelModel(hudModel(s, warn, none));

describe('panel VR: drawPanelModel', () => {
  it('formato m:ss.mmm en tiempos', () => {
    const o = ops(mk());
    expect(txt(o, 'lapTime')).toBe('1:18.457');
    expect(txt(o, 'last')).toContain('1:20.100');
    expect(txt(o, 'best')).toContain('1:19.003');
    expect(txt(ops(mk({}, { lastLapS: null, bestLapS: null })), 'best')).toContain('-:--.---');
  });
  it('marcha R/N/1-8 y velocidad', () => {
    expect(txt(ops(mk({ gear: -1 })), 'gear')).toBe('R');
    expect(txt(ops(mk({ gear: 0 })), 'gear')).toBe('N');
    for (let g = 1; g <= 8; g++) expect(txt(ops(mk({ gear: g })), 'gear')).toBe(String(g));
    expect(txt(ops(mk()), 'speed')).toBe('180');
    expect(txt(ops(mk()), 'lap')).toContain('2');
  });
  it('aviso prioritario único: MOTOR > LÍMITES > REDUCCIÓN', () => {
    const w = new WarningCenter();
    w.push({ type: 'limits' } as never, 0);
    w.push({ type: 'shiftRejected' } as never, 0);
    const warns = (s: SimState) => ops(s, w.current(s, 0.5)).filter((o) => o.kind === 'text' && o.id === 'warn');
    expect(warns(mk({ overheated: true }))).toHaveLength(1);
    expect(txt(ops(mk({ overheated: true }), w.current(mk({ overheated: true }), 0.5)), 'warn')).toBe('MOTOR');
    expect(txt(ops(mk(), w.current(mk(), 0.5)), 'warn')).toBe('LÍMITES');
    expect(txt(ops(mk(), w.current(mk(), 4)), 'warn')).toBeUndefined();
    const r = new WarningCenter(); r.push({ type: 'shiftRejected' } as never, 0);
    expect(txt(ops(mk(), r.current(mk(), 0.5)), 'warn')).toBe('REDUCCIÓN');
  });
  it('no dibuja en la zona central del panel de aviso vacío', () => {
    expect(txt(ops(mk()), 'warn')).toBeUndefined();
  });
});

describe('panel VR: emparejamiento y pausa', () => {
  it('sala igual al texto del DOM y casilla de QR', () => {
    const room = 'AB12';                                          // mismo valor que pairing-code
    const o = drawScreen({ kind: 'pairing', room, hint: 'Escanea el QR con el celular' });
    expect(txt(o, 'room')).toBe(room);
    expect(o.some((x) => x.kind === 'qr')).toBe(true);
  });
  it('cuenta atrás y PAUSA', () => {
    expect(txt(drawScreen({ kind: 'countdown', n: 3 }), 'countdown')).toBe('3');
    expect(txt(drawScreen({ kind: 'paused' }), 'paused')).toBe('PAUSA');
  });
});
