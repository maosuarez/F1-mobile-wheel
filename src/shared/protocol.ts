// Protocolo PC <-> celular (design D3). JSON compacto, números a 3 decimales.
//
// | Mensaje | Dirección      | Frecuencia | Campos                                                                 |
// |---------|----------------|------------|------------------------------------------------------------------------|
// | in      | volante -> PC  | 60 Hz      | seq, ts, steer [-1,1], thr [0,1], brk [0,1], ers, rtt (ms | null)       |
// | ev      | volante -> PC  | al ocurrir | k: up | down | drs | cam | pause | recal | restart                        |
// | tel     | PC -> volante  | 20 Hz      | spd, gear [-1,8], rpm, leds [0,16], drs 0|1|2, ers [0,1], ot, lap,      |
// |         |                |            | delta (s | null), warn (<=24), echo, hold (ms), dbg? {steer,thr,brk,gear},|
// |         |                |            | pos?, laps? (carrera: posición y vueltas totales),                     |
// |         |                |            | vr?, cal? (b20: host en VR / pide calibrar; solo si true)              |
// | fx      | PC -> volante  | al ocurrir | k: kerb | grass | limits | shift | limiter                             |
// | peer    | relay -> ambos | al ocurrir | role, connected                                                        |
// | ping    | relay -> ambos | 2 s        | (responder pong)                                                       |
//
// Carrera online (b16, /ws/race/{code}; el relay no parsea el juego):
// | lobby   | relay -> todos | al ocurrir | you, owner (plazas 0..5), players [{slot,name}]                        |
// | time    | cli -> relay   | 5 + cada 10 s | {t:'time'}; respuesta {t:'time', srv} (ms epoch del servidor)       |
// | started | propietario -> relay | 1 vez | {t:'started'}; marca la sala empezada (no se reenvía)               |
// | r       | relay -> demás | al ocurrir | f (plaza origen), m (mensaje de juego tal cual): hello, cfg, start,    |
// |         |                |            | st (20 Hz), ai (20 Hz, propietario), res                               |
// Cierres: 4400 petición inválida, 4001 sala llena, 4002 sala empezada / sin latido.

export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; export const ROOM_LENGTH = 4;
export type Role = 'host' | 'wheel';
export type EvKey = 'up' | 'down' | 'drs' | 'cam' | 'pause' | 'recal' | 'restart';
export type FxKey = 'kerb' | 'grass' | 'limits' | 'shift' | 'limiter';
export interface InMsg  { t: 'in'; seq: number; ts: number; steer: number; thr: number; brk: number; ers: boolean; rtt: number | null }
export interface EvMsg  { t: 'ev'; k: EvKey }
export interface TelHint { steer: number; thr: number; brk: number; gear: number }
export interface TelMsg { t: 'tel'; spd: number; gear: number; rpm: number; leds: number; drs: 0|1|2; ers: number; ot: boolean;
  lap: number; delta: number | null; warn: string; echo: number; hold: number; dbg?: TelHint;
  pos?: number; laps?: number;   // pos/laps: solo en carrera (b14); opcionales y compatibles
  vr?: boolean; cal?: boolean }  // b20: solo se envían si true; decodeTel ignora tipos no booleanos
export interface FxMsg  { t: 'fx'; k: FxKey }
export interface PeerMsg { t: 'peer'; role: Role; connected: boolean }
export interface PingMsg { t: 'ping' }  export interface PongMsg { t: 'pong' }
export type WheelToHost = InMsg | EvMsg;  export type HostToWheel = TelMsg | FxMsg;

// --- Carrera online (b16, design D2) ---
export const RACE_CODE_LENGTH = 6;
export const RACE_NAME_MAX = 16;
export const RACE_MAX = 6;
export const RACE_AI_MAX = 16;
export type NetAiLevel = 'easy' | 'medium' | 'hard';
export interface NetHello { t: 'hello'; name: string; team: number }
export interface NetCfg { t: 'cfg'; track: string; laps: number; rivals: number; ai: NetAiLevel; seed: number; grid: number[] }
export interface NetStart { t: 'start'; atSrv: number }
export interface NetStarted { t: 'started' }
export interface NetCar { t: 'st'; ts: number; x: number; y: number; z: number; yaw: number; pitch: number; roll: number; v: number;
  steer: number; s: number; d: number; laps: number; prog: number; drs: 0 | 1 | 2; fin: boolean; tt: number | null; best: number | null }
/** [x, y, z, yaw, v, steer, s, d, laps, prog, fin, tt, best] */
export type NetAiCar = [number, number, number, number, number, number, number, number, number, number, boolean, number | null, number | null];
export interface NetAi { t: 'ai'; ts: number; cars: NetAiCar[] }
export interface NetResRow { id: number; tt: number | null; laps: number; best: number | null; dnf: boolean }
export interface NetRes { t: 'res'; rows: NetResRow[] }
export type NetMsg = NetHello | NetCfg | NetStart | NetCar | NetAi | NetRes;
export interface TimeReq { t: 'time' }
export interface TimeMsg { t: 'time'; srv: number }
export interface LobbyPlayer { slot: number; name: string }
export interface LobbyMsg { t: 'lobby'; you: number; owner: number; players: LobbyPlayer[] }
export interface RelayMsg { t: 'r'; f: number; m: NetMsg }
export type RaceToRelay = NetMsg | NetStarted | TimeReq | PongMsg;
export type RelayToRace = LobbyMsg | TimeMsg | RelayMsg | PingMsg;

const EV_KEYS: readonly string[] = ['up', 'down', 'drs', 'cam', 'pause', 'recal', 'restart'];
const FX_KEYS: readonly string[] = ['kerb', 'grass', 'limits', 'shift', 'limiter'];
const WARN_MAX = 24;

const round3 = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;                                       // evita "-0"
};

export function encode(msg: WheelToHost | HostToWheel | PongMsg | RaceToRelay): string {
  return JSON.stringify(msg, (_k, v) => (typeof v === 'number' ? round3(v) : v));
}

// Utilidades de validación: devuelven undefined si el tipo no cuadra
type Obj = Record<string, unknown>;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function parse(raw: string): Obj | null {
  if (typeof raw !== 'string') return null;
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return null; }
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return null;
  return typeof (o as Obj).t === 'string' ? (o as Obj) : null;
}

function decodePeer(o: Obj): PeerMsg | null {
  if ((o.role !== 'host' && o.role !== 'wheel') || typeof o.connected !== 'boolean') return null;
  return { t: 'peer', role: o.role, connected: o.connected };
}

function decodeIn(o: Obj): InMsg | null {
  const { seq, ts, steer, thr, brk, ers } = o;
  if (!isNum(seq) || !isNum(ts) || !isNum(steer) || !isNum(thr) || !isNum(brk) || typeof ers !== 'boolean') return null;
  const rtt = o.rtt === undefined || o.rtt === null ? null : isNum(o.rtt) ? Math.max(0, o.rtt) : undefined;
  if (rtt === undefined) return null;
  return { t: 'in', seq, ts, steer: clamp(steer, -1, 1), thr: clamp(thr, 0, 1), brk: clamp(brk, 0, 1), ers, rtt };
}

function decodeHint(v: unknown): TelHint | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || typeof v !== 'object') return null;
  const { steer, thr, brk, gear } = v as Obj;
  if (!isNum(steer) || !isNum(thr) || !isNum(brk) || !isNum(gear)) return null;
  return { steer: clamp(steer, -1, 1), thr: clamp(thr, 0, 1), brk: clamp(brk, 0, 1), gear: clamp(Math.round(gear), -1, 8) };
}

function decodeTel(o: Obj): TelMsg | null {
  const { spd, gear, rpm, leds, drs, ers, ot, lap, warn, echo, hold } = o;
  if (!isNum(spd) || !isNum(gear) || !isNum(rpm) || !isNum(leds) || !isNum(drs) || !isNum(ers) || typeof ot !== 'boolean'
    || !isNum(lap) || typeof warn !== 'string' || !isNum(echo) || !isNum(hold)) return null;
  const delta = o.delta === null || o.delta === undefined ? null : isNum(o.delta) ? o.delta : undefined;
  if (delta === undefined) return null;
  const dbg = decodeHint(o.dbg);
  if (dbg === null) return null;
  const msg: TelMsg = {
    t: 'tel', spd: Math.max(0, spd), gear: clamp(Math.round(gear), -1, 8), rpm: Math.max(0, rpm),
    leds: clamp(Math.round(leds), 0, 16), drs: clamp(Math.round(drs), 0, 2) as 0 | 1 | 2, ers: clamp(ers, 0, 1), ot,
    lap: Math.max(0, Math.round(lap)), delta, warn: warn.slice(0, WARN_MAX), echo, hold: Math.max(0, hold),
  };
  if (dbg) msg.dbg = dbg;
  // pos/laps opcionales (b14): si no son números válidos se ignoran sin invalidar el mensaje
  if (isNum(o.pos) && isNum(o.laps)) { msg.pos = Math.max(1, Math.round(o.pos)); msg.laps = Math.max(1, Math.round(o.laps)); }
  // vr/cal opcionales (b20): solo booleanos; otro tipo se ignora sin invalidar el mensaje
  if (typeof o.vr === 'boolean') msg.vr = o.vr;
  if (typeof o.cal === 'boolean') msg.cal = o.cal;
  return msg;
}

export function decodeAtHost(raw: string): InMsg | EvMsg | PeerMsg | PingMsg | null {
  const o = parse(raw);
  if (!o) return null;
  switch (o.t) {
    case 'in': return decodeIn(o);
    case 'ev': return typeof o.k === 'string' && EV_KEYS.includes(o.k) ? { t: 'ev', k: o.k as EvKey } : null;
    case 'peer': return decodePeer(o);
    case 'ping': return { t: 'ping' };
    default: return null;
  }
}

export function decodeAtWheel(raw: string): TelMsg | FxMsg | PeerMsg | PingMsg | null {
  const o = parse(raw);
  if (!o) return null;
  switch (o.t) {
    case 'tel': return decodeTel(o);
    case 'fx': return typeof o.k === 'string' && FX_KEYS.includes(o.k) ? { t: 'fx', k: o.k as FxKey } : null;
    case 'peer': return decodePeer(o);
    case 'ping': return { t: 'ping' };
    default: return null;
  }
}

const intIn = (v: unknown, lo: number, hi: number): number | null =>
  isNum(v) && Math.round(v) >= lo && Math.round(v) <= hi ? Math.round(v) : null;
const numOrNull = (v: unknown): number | null | undefined => (v === null ? null : isNum(v) ? v : undefined);

function decodeCar(o: Obj): NetCar | null {
  const { ts, x, y, z, yaw, pitch, roll, v, steer, s, d, laps, prog, fin } = o;
  if (!isNum(ts) || !isNum(x) || !isNum(y) || !isNum(z) || !isNum(yaw) || !isNum(pitch) || !isNum(roll) || !isNum(v)
    || !isNum(steer) || !isNum(s) || !isNum(d) || !isNum(laps) || !isNum(prog) || typeof fin !== 'boolean') return null;
  const tt = numOrNull(o.tt ?? null), best = numOrNull(o.best ?? null);
  if (tt === undefined || best === undefined || !isNum(o.drs)) return null;
  return { t: 'st', ts, x, y, z, yaw, pitch, roll, v: Math.max(0, v), steer: clamp(steer, -1, 1), s, d,
    laps: Math.max(0, Math.round(laps)), prog, drs: clamp(Math.round(o.drs), 0, 2) as 0 | 1 | 2, fin, tt, best };
}

function decodeAiCar(a: unknown): NetAiCar | null {
  if (!Array.isArray(a) || a.length !== 13) return null;
  for (let i = 0; i < 10; i++) if (!isNum(a[i])) return null;
  const tt = numOrNull(a[11]), best = numOrNull(a[12]);
  if (typeof a[10] !== 'boolean' || tt === undefined || best === undefined) return null;
  return [a[0], a[1], a[2], a[3], Math.max(0, a[4]), clamp(a[5], -1, 1), a[6], a[7], Math.max(0, Math.round(a[8])), a[9], a[10], tt, best];
}

function decodeNetObj(o: Obj): NetMsg | null {
  switch (o.t) {
    case 'hello': {
      const team = intIn(o.team, 0, 99);
      return typeof o.name === 'string' && team !== null ? { t: 'hello', name: o.name.slice(0, RACE_NAME_MAX), team } : null;
    }
    case 'cfg': {
      const laps = intIn(o.laps, 1, 99), rivals = intIn(o.rivals, 0, 9);
      if (laps === null || rivals === null || typeof o.track !== 'string' || o.track.length > 32 || !isNum(o.seed)
        || (o.ai !== 'easy' && o.ai !== 'medium' && o.ai !== 'hard') || !Array.isArray(o.grid) || o.grid.length > RACE_MAX) return null;
      const grid: number[] = [];
      for (const g of o.grid) { const n = intIn(g, 0, RACE_MAX - 1); if (n === null) return null; grid.push(n); }
      return { t: 'cfg', track: o.track, laps, rivals, ai: o.ai, seed: o.seed, grid };
    }
    case 'start': return isNum(o.atSrv) ? { t: 'start', atSrv: o.atSrv } : null;
    case 'st': return decodeCar(o);
    case 'ai': {
      if (!isNum(o.ts) || !Array.isArray(o.cars) || o.cars.length > RACE_AI_MAX) return null;
      const cars: NetAiCar[] = [];
      for (const c of o.cars) { const d = decodeAiCar(c); if (!d) return null; cars.push(d); }
      return { t: 'ai', ts: o.ts, cars };
    }
    case 'res': {
      if (!Array.isArray(o.rows) || o.rows.length > RACE_MAX + RACE_AI_MAX) return null;
      const rows: NetResRow[] = [];
      for (const r of o.rows) {
        if (r === null || typeof r !== 'object') return null;
        const { id, laps, dnf } = r as Obj;
        const tt = numOrNull((r as Obj).tt ?? null), best = numOrNull((r as Obj).best ?? null);
        if (!isNum(id) || !isNum(laps) || typeof dnf !== 'boolean' || tt === undefined || best === undefined) return null;
        rows.push({ id: Math.max(0, Math.round(id)), tt, laps: Math.max(0, Math.round(laps)), best, dnf });
      }
      return { t: 'res', rows };
    }
    default: return null;
  }
}

/** Mensaje de juego suelto (el `m` de un `r`). */
export function decodeNet(raw: string): NetMsg | null {
  const o = parse(raw);
  return o ? decodeNetObj(o) : null;
}

/** Lo que llega de /ws/race/{code}: lobby, time, r (envuelto) o ping. */
export function decodeAtRace(raw: string): RelayToRace | null {
  const o = parse(raw);
  if (!o) return null;
  switch (o.t) {
    case 'lobby': {
      const you = intIn(o.you, 0, RACE_MAX - 1), owner = intIn(o.owner, 0, RACE_MAX - 1);
      if (you === null || owner === null || !Array.isArray(o.players) || o.players.length > RACE_MAX) return null;
      const players: LobbyPlayer[] = [];
      for (const p of o.players) {
        if (p === null || typeof p !== 'object') return null;
        const slot = intIn((p as Obj).slot, 0, RACE_MAX - 1);
        if (slot === null || typeof (p as Obj).name !== 'string') return null;
        players.push({ slot, name: ((p as Obj).name as string).slice(0, RACE_NAME_MAX) });
      }
      return { t: 'lobby', you, owner, players };
    }
    case 'time': return isNum(o.srv) ? { t: 'time', srv: o.srv } : null;
    case 'r': {
      const f = intIn(o.f, 0, RACE_MAX - 1);
      if (f === null || o.m === null || typeof o.m !== 'object' || Array.isArray(o.m)) return null;
      const m = typeof (o.m as Obj).t === 'string' ? decodeNetObj(o.m as Obj) : null;
      return m ? { t: 'r', f, m } : null;
    }
    case 'ping': return { t: 'ping' };
    default: return null;
  }
}

export function generateRoomCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < ROOM_LENGTH; i++) {
    const idx = Math.min(ROOM_ALPHABET.length - 1, Math.floor(rand() * ROOM_ALPHABET.length));
    s += ROOM_ALPHABET[idx];
  }
  return s;
}

export function isRoomCode(s: string): boolean {
  if (typeof s !== 'string' || s.length !== ROOM_LENGTH) return false;
  for (const c of s) if (!ROOM_ALPHABET.includes(c)) return false;
  return true;
}

/** Normaliza lo escrito en el campo de sala: mayúsculas, solo alfabeto, máx. ROOM_LENGTH. */
export function sanitizeRoomInput(s: string): string {
  let out = '';
  for (const c of s.toUpperCase()) {
    if (ROOM_ALPHABET.includes(c)) out += c;
    if (out.length >= ROOM_LENGTH) break;
  }
  return out;
}
