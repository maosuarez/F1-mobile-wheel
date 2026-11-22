import { describe, expect, it } from 'vitest';
import {
  ROOM_ALPHABET, ROOM_LENGTH, decodeAtHost, decodeAtWheel, encode, generateRoomCode, isRoomCode, sanitizeRoomInput,
  decodeAtRace, decodeNet, type EvMsg, type FxMsg, type InMsg, type LobbyMsg, type NetAi, type NetCar, type NetCfg, type NetRes,
  type RelayMsg, type TelMsg,
} from '../src/shared/protocol';

const IN: InMsg = { t: 'in', seq: 42, ts: 123456.789, steer: -0.25, thr: 0.8, brk: 0, ers: true, rtt: 7.5 };
const TEL: TelMsg = { t: 'tel', spd: 287.4, gear: 7, rpm: 11800, leds: 12, drs: 2, ers: 0.6, ot: false,
  lap: 3, delta: -0.125, warn: 'PAUSA', echo: 123456.789, hold: 12.5 };

describe('protocolo: vr/cal (b20), opcionales', () => {
  it('sin vr/cal no aparecen y el mensaje decodifica igual', () => {
    expect(encode(TEL)).not.toMatch(/"(vr|cal)"/);
    const t = decodeAtWheel(encode(TEL)) as TelMsg;
    expect('vr' in t || 'cal' in t).toBe(false);
  });
  it('ida y vuelta con vr y cal', () => {
    const t = decodeAtWheel(encode({ ...TEL, vr: true, cal: true })) as TelMsg;
    expect(t.vr).toBe(true);
    expect(t.cal).toBe(true);
    const u = decodeAtWheel(encode({ ...TEL, vr: true })) as TelMsg;
    expect(u.vr).toBe(true);
    expect('cal' in u).toBe(false);
  });
  it('tipo inválido se ignora sin invalidar el mensaje', () => {
    const t = decodeAtWheel(JSON.stringify({ ...TEL, vr: 1, cal: 'si' })) as TelMsg;
    expect(t).not.toBeNull();
    expect('vr' in t || 'cal' in t).toBe(false);
    expect(t.spd).toBe(287.4);
  });
});

describe('protocolo: pos/laps de carrera (b14), compatibles', () => {
  it('un tel sin pos/laps sigue siendo válido y no los inventa', () => {
    const t = decodeAtWheel(encode(TEL)) as TelMsg;
    expect(t).toEqual(TEL);
    expect('pos' in t || 'laps' in t).toBe(false);
  });
  it('un tel con pos y laps los conserva (enteros ≥ 1) y sigue por debajo de 300 bytes', () => {
    const msg: TelMsg = { ...TEL, pos: 4, laps: 5 };
    expect(decodeAtWheel(encode(msg))).toEqual(msg);
    expect(new TextEncoder().encode(encode({ ...msg, spd: 359.999, delta: -99.999, warn: 'X'.repeat(24), dbg: { steer: -0.999, thr: 0.999, brk: 0.999, gear: 8 } })).length).toBeLessThan(300);
    const t = decodeAtWheel(JSON.stringify({ ...TEL, pos: 0, laps: 5.4 })) as TelMsg;
    expect(t.pos).toBe(1);
    expect(t.laps).toBe(5);
  });
  it('pos/laps inválidos se ignoran sin invalidar el mensaje', () => {
    const t = decodeAtWheel(JSON.stringify({ ...TEL, pos: 'x', laps: 5 })) as TelMsg;
    expect(t.spd).toBe(TEL.spd);
    expect('pos' in t).toBe(false);
  });
});

describe('protocolo: codificación compacta', () => {
  it('redondea a 3 decimales', () => {
    expect(encode({ ...IN, steer: 0.123456789 })).toContain('"steer":0.123');
  });
  it('cualquier in o tel válido ocupa < 300 bytes', () => {
    const worstIn: InMsg = { t: 'in', seq: 99999999, ts: 9999999999.999, steer: -0.999, thr: 0.999, brk: 0.999, ers: false, rtt: 99999.999 };
    const worstTel: TelMsg = { ...TEL, spd: 359.999, rpm: 15000.123, delta: -99.999, warn: 'X'.repeat(24), echo: 9999999999.999,
      hold: 999.999, dbg: { steer: -0.999, thr: 0.999, brk: 0.999, gear: 8 } };
    for (const m of [IN, worstIn, TEL, worstTel]) expect(new TextEncoder().encode(encode(m)).length).toBeLessThan(300);
  });
});

describe('protocolo: validación de lo recibido', () => {
  it('descarta basura sin lanzar', () => {
    for (const raw of ['hola', '{"t":"in","steer":"x"}', '', 'null', '[]', '42', '{"t":5}', '{}']) {
      expect(() => decodeAtHost(raw)).not.toThrow();
      expect(decodeAtHost(raw)).toBeNull();
      expect(() => decodeAtWheel(raw)).not.toThrow();
      expect(decodeAtWheel(raw)).toBeNull();
    }
  });
  it('recorta valores fuera de rango', () => {
    const m = decodeAtHost(JSON.stringify({ ...IN, steer: 7, thr: -2, brk: 3 })) as InMsg;
    expect(m.steer).toBe(1); expect(m.thr).toBe(0); expect(m.brk).toBe(1);
    const t = decodeAtWheel(JSON.stringify({ ...TEL, gear: 12, leds: 40, drs: 5, ers: 2, warn: 'Y'.repeat(40) })) as TelMsg;
    expect(t.gear).toBe(8); expect(t.leds).toBe(16); expect(t.drs).toBe(2); expect(t.ers).toBe(1); expect(t.warn.length).toBe(24);
  });
  it('descarta eventos desconocidos', () => {
    expect(decodeAtHost('{"t":"ev","k":"nitro"}')).toBeNull();
    expect(decodeAtWheel('{"t":"fx","k":"boom"}')).toBeNull();
  });
  it('cada extremo descarta los mensajes del otro sentido', () => {
    expect(decodeAtHost(encode(TEL))).toBeNull();
    expect(decodeAtWheel(encode(IN))).toBeNull();
  });
  it('acepta peer y ping', () => {
    expect(decodeAtHost('{"t":"peer","role":"wheel","connected":false}')).toEqual({ t: 'peer', role: 'wheel', connected: false });
    expect(decodeAtWheel('{"t":"peer","role":"host","connected":true}')).toEqual({ t: 'peer', role: 'host', connected: true });
    expect(decodeAtHost('{"t":"ping"}')).toEqual({ t: 'ping' });
    expect(decodeAtWheel('{"t":"ping"}')).toEqual({ t: 'ping' });
    expect(decodeAtHost('{"t":"peer","role":"x","connected":true}')).toBeNull();
  });
});

describe('protocolo: ida y vuelta', () => {
  it('in', () => {
    expect(decodeAtHost(encode(IN))).toEqual(IN);
    const noRtt = { ...IN, rtt: null };
    expect(decodeAtHost(encode(noRtt))).toEqual(noRtt);
  });
  it('ev (todas las claves)', () => {
    for (const k of ['up', 'down', 'drs', 'cam', 'pause', 'recal', 'restart'] as const) {
      const m: EvMsg = { t: 'ev', k };
      expect(decodeAtHost(encode(m))).toEqual(m);
    }
  });
  it('tel con y sin dbg', () => {
    expect(decodeAtWheel(encode(TEL))).toEqual(TEL);
    expect(decodeAtWheel(encode({ ...TEL, delta: null }))).toEqual({ ...TEL, delta: null });
    const withDbg: TelMsg = { ...TEL, dbg: { steer: 0.5, thr: 1, brk: 0, gear: 1 } };
    expect(decodeAtWheel(encode(withDbg))).toEqual(withDbg);
    expect('dbg' in (decodeAtWheel(encode(TEL)) as TelMsg)).toBe(false);
  });
  it('fx (todas las claves)', () => {
    for (const k of ['kerb', 'grass', 'limits', 'shift', 'limiter'] as const) {
      const m: FxMsg = { t: 'fx', k };
      expect(decodeAtWheel(encode(m))).toEqual(m);
    }
  });
  it('pong', () => {
    expect(encode({ t: 'pong' })).toBe('{"t":"pong"}');
  });
});

describe('código de sala', () => {
  it('1 000 códigos de longitud 4 y solo alfabeto permitido', () => {
    for (let i = 0; i < 1000; i++) {
      const c = generateRoomCode();
      expect(c).toHaveLength(ROOM_LENGTH);
      for (const ch of c) expect(ROOM_ALPHABET).toContain(ch);
      expect(isRoomCode(c)).toBe(true);
    }
    expect(ROOM_ALPHABET).not.toMatch(/[0O1I]/);
  });
  it('rand en los extremos', () => {
    expect(generateRoomCode(() => 0)).toBe('AAAA');
    expect(generateRoomCode(() => 0.999999)).toBe('9999');
  });
  it('isRoomCode', () => {
    expect(isRoomCode('ABCD')).toBe(true);
    expect(isRoomCode('AB2Z')).toBe(true);
    for (const s of ['abcd', 'ABC', 'ABCDE', 'AB0D', 'ABOD', 'AB1D', 'ABID', '', 'AB D']) expect(isRoomCode(s)).toBe(false);
  });
});

describe('sanitizeRoomInput', () => {
  it('mayúsculas, filtra alfabeto y máx. 4', () => {
    expect(sanitizeRoomInput('abcd')).toBe('ABCD');
    expect(sanitizeRoomInput('a1b-0c')).toBe('ABC');
    expect(sanitizeRoomInput('abcdefg')).toBe('ABCD');
    expect(sanitizeRoomInput('')).toBe('');
  });
});

describe('protocolo: carrera online (b16)', () => {
  const CAR: NetCar = { t: 'st', ts: 1700000000123, x: 10.123, y: 1.5, z: -3.25, yaw: 3.14, pitch: 0.01, roll: -0.02, v: 83.4,
    steer: 0.4, s: 1234.5, d: -1.2, laps: 2, prog: 2.31, drs: 1, fin: false, tt: null, best: 70.123 };
  const CFG: NetCfg = { t: 'cfg', track: 'interlagos', laps: 5, rivals: 4, ai: 'medium', seed: 12345, grid: [2, 0, 1] };
  const AI: NetAi = { t: 'ai', ts: 5, cars: [[1, 2, 3, 0.5, 70, 0.1, 100, 0.5, 1, 1.2, false, null, 71.5], [0, 0, 0, 0, 0, 0, 0, 0, 5, 5, true, 400, 70]] };
  const RES: NetRes = { t: 'res', rows: [{ id: 0, tt: 400.5, laps: 5, best: 70, dnf: false }, { id: 3, tt: null, laps: 2, best: null, dnf: true }] };
  const wrap = (m: unknown, f = 1) => JSON.stringify({ t: 'r', f, m });

  it('mensajes de juego envueltos en r hacen ida y vuelta', () => {
    for (const m of [CAR, CFG, AI, RES, { t: 'hello', name: 'Ana', team: 3 } as const, { t: 'start', atSrv: 1700000003000 } as const]) {
      expect(decodeAtRace(wrap(JSON.parse(encode(m))))).toEqual({ t: 'r', f: 1, m });
      expect(decodeNet(encode(m))).toEqual(m);
    }
  });
  it('encode redondea a 3 decimales y st cabe en 300 bytes', () => {
    expect(encode({ ...CAR, x: 1.23456789 })).toContain('"x":1.235');
    expect(new TextEncoder().encode(encode({ ...CAR, x: -9999.999, s: 99999.999, tt: 9999.999, best: 9999.999 })).length).toBeLessThan(300);
  });
  it('lobby y time válidos', () => {
    const lobby: LobbyMsg = { t: 'lobby', you: 1, owner: 0, players: [{ slot: 0, name: 'A' }, { slot: 1, name: 'B' }] };
    expect(decodeAtRace(JSON.stringify(lobby))).toEqual(lobby);
    expect(decodeAtRace('{"t":"time","srv":1700000000000}')).toEqual({ t: 'time', srv: 1700000000000 });
    expect(decodeAtRace('{"t":"ping"}')).toEqual({ t: 'ping' });
    expect(encode({ t: 'time' })).toBe('{"t":"time"}');
  });
  it('campos fuera de rango se acotan o se rechazan', () => {
    const c = (decodeNet(JSON.stringify({ ...CAR, steer: 9, v: -5, drs: 7, laps: -2.4 })) as NetCar);
    expect([c.steer, c.v, c.drs, c.laps]).toEqual([1, 0, 2, 0]);
    expect(decodeNet(JSON.stringify({ ...CFG, laps: 0 }))).toBeNull();
    expect(decodeNet(JSON.stringify({ ...CFG, rivals: 10 }))).toBeNull();
    expect(decodeNet(JSON.stringify({ ...CFG, ai: 'brutal' }))).toBeNull();
    expect(decodeNet(JSON.stringify({ ...CFG, grid: [6] }))).toBeNull();
    expect(decodeAtRace(wrap(CAR, 9))).toBeNull();
    expect(decodeAtRace(JSON.stringify({ t: 'lobby', you: 6, owner: 0, players: [] }))).toBeNull();
    expect((decodeNet(JSON.stringify({ t: 'hello', name: 'X'.repeat(40), team: 1 })) as { name: string }).name.length).toBe(16);
  });
  it('basura devuelve null', () => {
    for (const raw of ['', 'x', '[]', 'null', '{"t":5}', '{"t":"zzz"}', '{"t":"st"}', '{"t":"ai","ts":1,"cars":[[1]]}',
      '{"t":"res","rows":[null]}', '{"t":"r","f":1}', '{"t":"r","f":1,"m":"x"}', '{"t":"r","f":1,"m":{"t":"zzz"}}', '{"t":"time","srv":"a"}']) {
      expect(decodeAtRace(raw)).toBeNull();
      expect(decodeNet(raw)).toBeNull();
    }
    expect(decodeAtRace(JSON.stringify({ t: 'r', f: 0, m: { ...CAR, x: 'a' } } as RelayMsg | object))).toBeNull();
  });
});
