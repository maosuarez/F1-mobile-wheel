import { describe, expect, it } from 'vitest';
import { hudModel } from '../src/host/hudModel';
import { drawPanelModel, drawScreen, legendOps, PANEL_H, PANEL_W, type DrawOp } from '../src/host/vr/panelModel';
import { WarningCenter } from '../src/host/warnings';
import { towerModel, towerWindow, type TowerEntry } from '../src/host/race/tower';
import { wheelScreenOps, WHEEL_SCREEN_H, WHEEL_SCREEN_W } from '../src/host/vr/wheelScreenModel';
import type { Standing } from '../src/sim/race';
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

describe('panel VR: leyenda de los mandos (b9)', () => {
  const ids = ['legendStart', 'legendDrs', 'legendErs', 'legendCam', 'legendGear', 'legendPause'];
  const size = (o: DrawOp[], id: string) => { const x = o.find((y) => y.kind === 'text' && y.id === id); return x && x.kind === 'text' ? x.size : undefined; };

  it('legendOps: ids de la spec, textos ≤ 44 caracteres a 28 px y dentro del lienzo', () => {
    const l = legendOps();
    expect(l.map((o) => (o.kind === 'text' ? o.id : ''))).toEqual(ids);
    for (const o of l) {
      if (o.kind !== 'text') throw new Error('op inesperado');
      expect(o.text.length).toBeLessThanOrEqual(44);
      expect(o.size).toBe(28);
      expect(o.x).toBeGreaterThanOrEqual(0); expect(o.x).toBeLessThan(PANEL_W);
      expect(o.y).toBeGreaterThan(0); expect(o.y).toBeLessThan(PANEL_H);
    }
    expect(txt(l, 'legendStart')).toBe('A = EMPEZAR');
  });

  it('Leyenda: pairing incluye legendStart y legendDrs y el código con size >= 150', () => {
    const o = drawScreen({ kind: 'pairing', room: 'AB12', hint: 'Escanea el QR con el celular o pulsa A para empezar sin él' });
    for (const id of ids) expect(txt(o, id)).toBeDefined();
    expect(size(o, 'room')!).toBeGreaterThanOrEqual(150);
    expect(txt(o, 'hint')!.length).toBeLessThanOrEqual(44);
    const qr = o.find((x) => x.kind === 'qr');
    expect(qr && qr.kind === 'qr' ? qr.size : 0).toBe(220);
  });

  it('Pausa: paused incluye legendDrs', () => {
    const o = drawScreen({ kind: 'paused' });
    expect(txt(o, 'legendDrs')).toBeDefined();
    expect(txt(o, 'paused')).toBe('PAUSA');
  });

  it('el HUD de carrera no lleva leyenda', () => {
    expect(ops(mk()).some((x) => x.kind === 'text' && x.id.startsWith('legend'))).toBe(false);
  });
  it('carrera: posición y vuelta en el panel; en práctica no aparecen', () => {
    const o = drawPanelModel(hudModel(mk(), '', none), { pos: 4, total: 10, lap: 2, laps: 5 });
    expect(txt(o, 'race')).toBe('P4/10 · V 2/5');
    expect(txt(drawPanelModel(hudModel(mk(), '', none), { pos: 1, total: 10, lap: 6, laps: 5 }), 'race')).toBe('P1/10 · V 5/5');
    expect(txt(ops(mk()), 'race')).toBeUndefined();
    expect(txt(drawScreen({ kind: 'hud', model: hudModel(mk(), '', none), race: { pos: 4, total: 10, lap: 2, laps: 5 } }), 'race')).toBe('P4/10 · V 2/5');
  });
});

describe('panel VR de carrera y calibración (b20 D5)', () => {
  const st = (id: number, pos: number): Standing => ({ id, pos, lapsDone: 1, progressM: 0, gapToLeaderS: pos === 1 ? 0 : pos * 1.5,
    gapAheadS: pos === 1 ? null : 1.5, finished: false, totalTimeS: null, bestLapS: null });
  // Online: 3 humanos (códigos derivados del nombre) y 3 IA; el jugador (id 0) va 4.º
  const entries: TowerEntry[] = [
    { id: 0, code: 'MAO', color: '#e10600' }, { id: 1, code: 'ANA', color: '#00a0de' }, { id: 2, code: 'LUI', color: '#ff8700' },
    { id: 3, code: 'VOS', color: '#2293d1' }, { id: 4, code: 'BRA', color: '#00d2be' }, { id: 5, code: 'KEL', color: '#ffffff' },
  ];
  const standings = [3, 1, 4, 0, 2, 5].map((id, i) => st(id, i + 1));
  const tw = towerModel(standings, entries, 0, 5);
  const screen = (o: object = {}) => drawScreen({ kind: 'race', race: { pos: 4, total: 6, lap: 2, laps: 5 }, ahead: tw.ahead, behind: tw.behind,
    rows: towerWindow(tw.rows, 6), ...o });
  const size = (o: DrawOp[], id: string) => { const x = o.find((y) => y.kind === 'text' && y.id === id); return x && x.kind === 'text' ? x.size : 0; };

  it('online, jugador 4.º con casco: P4/6, vuelta, diferencias, 6 filas con códigos y sin velocidad', () => {
    const o = screen();
    expect(txt(o, 'race')).toBe('P4/6 · V 2/5');
    expect(size(o, 'race')).toBeGreaterThanOrEqual(56);
    expect(txt(o, 'ahead')).toContain('−1.5');
    expect(txt(o, 'behind')).toContain('+1.5');
    expect(size(o, 'ahead')).toBeGreaterThanOrEqual(40);
    const codes = Array.from({ length: 6 }, (_, i) => txt(o, `row${i}Code`));
    expect(codes).toEqual(['VOS', 'ANA', 'BRA', 'MAO', 'LUI', 'KEL']);
    expect(txt(o, 'row6Code')).toBeUndefined();
    expect(size(o, 'row0Code')).toBeGreaterThanOrEqual(34);
    expect(txt(o, 'speed')).toBeUndefined();
    expect(txt(o, 'gear')).toBeUndefined();
    for (const x of o) if (x.kind === 'text') { expect(x.y).toBeGreaterThan(0); expect(x.y).toBeLessThan(PANEL_H); }
  });
  it('otras cámaras: velocidad y marcha arriba a la derecha', () => {
    const o = screen({ speed: '212', gear: '7' });
    expect(txt(o, 'speed')).toContain('212');
    expect(txt(o, 'gear')).toBe('7');
  });
  it('calibrar: textos grandes y A = SALTAR a 28 px', () => {
    const o = drawScreen({ kind: 'calibrate' });
    expect(txt(o, 'cal1')).toBe('CALIBRA EL VOLANTE');
    expect(txt(o, 'cal2')).toBe('EN EL CELULAR');
    expect(size(o, 'cal1')).toBeGreaterThanOrEqual(80);
    expect(size(o, 'cal2')).toBeGreaterThanOrEqual(80);
    expect(txt(o, 'calSkip')).toBe('A = SALTAR');
    expect(size(o, 'calSkip')).toBe(28);
  });
});

describe('pantalla del volante 3D (b20 D4)', () => {
  const m = hudModel(mk({ speed: 200 / 3.6, gear: 6 }, { deltaS: -0.25 }), '', none);
  const o = wheelScreenOps(m, 1, 60, false);
  const op = (id: string) => o.find((x) => x.kind === 'text' && x.id === id) as Extract<DrawOp, { kind: 'text' }>;

  it('200 km/h en 6.ª: velocidad, marcha y tiempo m:ss.mmm', () => {
    expect(op('speed').text).toBe('200');
    expect(op('gear').text).toBe('6');
    expect(op('lapTime').text).toMatch(/^\d:\d{2}\.\d{3}$/);
    expect(op('gear').size).toBeGreaterThanOrEqual(200);
    expect(op('speed').size).toBeGreaterThanOrEqual(120);
    expect(op('lapTime').size).toBeGreaterThanOrEqual(64);
    expect(op('delta').size).toBeGreaterThanOrEqual(64);
    for (const x of o) if (x.kind === 'text') { expect(x.x).toBeGreaterThanOrEqual(0); expect(x.x).toBeLessThanOrEqual(WHEEL_SCREEN_W); expect(x.y).toBeLessThan(WHEEL_SCREEN_H); }
  });
  it('delta verde/rojo y DRS gris/verde/azul', () => {
    const pos = wheelScreenOps(hudModel(mk({}, { deltaS: 0.4 }), '', none), 0, 60, false);
    const col = (ops: DrawOp[], id: string) => (ops.find((x) => x.kind === 'text' && x.id === id) as Extract<DrawOp, { kind: 'text' }>).color;
    expect(col(o, 'delta')).not.toBe(col(pos, 'delta'));
    const drs = [0, 1, 2].map((d) => col(wheelScreenOps(m, d as 0 | 1 | 2, 60, false), 'drs'));
    expect(new Set(drs).size).toBe(3);
  });
  it('barra de ERS proporcional y resaltada con modo adelantamiento', () => {
    const bars = (ops: DrawOp[]) => ops.filter((x) => x.kind === 'rect').slice(-1)[0] as Extract<DrawOp, { kind: 'rect' }>;
    const a = bars(wheelScreenOps(m, 0, 50, false)), b = bars(wheelScreenOps(m, 0, 100, true));
    expect(b.w).toBeCloseTo(a.w * 2, 0);
    expect(a.color).not.toBe(b.color);
  });
});
