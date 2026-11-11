import { describe, expect, it } from 'vitest';
import {
  ROOM_ALPHABET, ROOM_LENGTH, decodeAtHost, decodeAtWheel, encode, generateRoomCode, isRoomCode,
  type EvMsg, type FxMsg, type InMsg, type TelMsg,
} from '../src/shared/protocol';

const IN: InMsg = { t: 'in', seq: 42, ts: 123456.789, steer: -0.25, thr: 0.8, brk: 0, ers: true, rtt: 7.5 };
const TEL: TelMsg = { t: 'tel', spd: 287.4, gear: 7, rpm: 11800, leds: 12, drs: 2, ers: 0.6, ot: false,
  lap: 3, delta: -0.125, warn: 'PAUSA', echo: 123456.789, hold: 12.5 };

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
