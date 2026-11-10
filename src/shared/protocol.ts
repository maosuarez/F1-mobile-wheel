// Protocolo PC <-> celular (design D3). JSON compacto, números a 3 decimales.
//
// | Mensaje | Dirección      | Frecuencia | Campos                                                                 |
// |---------|----------------|------------|------------------------------------------------------------------------|
// | in      | volante -> PC  | 60 Hz      | seq, ts, steer [-1,1], thr [0,1], brk [0,1], ers, rtt (ms | null)       |
// | ev      | volante -> PC  | al ocurrir | k: up | down | drs | cam | pause | recal                                |
// | tel     | PC -> volante  | 20 Hz      | spd, gear [-1,8], rpm, leds [0,16], drs 0|1|2, ers [0,1], ot, lap,      |
// |         |                |            | delta (s | null), warn (<=24), echo, hold (ms), dbg? {steer,thr,brk,gear}|
// | fx      | PC -> volante  | al ocurrir | k: kerb | grass | limits | shift | limiter                             |
// | peer    | relay -> ambos | al ocurrir | role, connected                                                        |
// | ping    | relay -> ambos | 2 s        | (responder pong)                                                       |

export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; export const ROOM_LENGTH = 4;
export type Role = 'host' | 'wheel';
export type EvKey = 'up' | 'down' | 'drs' | 'cam' | 'pause' | 'recal';
export type FxKey = 'kerb' | 'grass' | 'limits' | 'shift' | 'limiter';
export interface InMsg  { t: 'in'; seq: number; ts: number; steer: number; thr: number; brk: number; ers: boolean; rtt: number | null }
export interface EvMsg  { t: 'ev'; k: EvKey }
export interface TelHint { steer: number; thr: number; brk: number; gear: number }
export interface TelMsg { t: 'tel'; spd: number; gear: number; rpm: number; leds: number; drs: 0|1|2; ers: number; ot: boolean;
  lap: number; delta: number | null; warn: string; echo: number; hold: number; dbg?: TelHint }
export interface FxMsg  { t: 'fx'; k: FxKey }
export interface PeerMsg { t: 'peer'; role: Role; connected: boolean }
export interface PingMsg { t: 'ping' }  export interface PongMsg { t: 'pong' }
export type WheelToHost = InMsg | EvMsg;  export type HostToWheel = TelMsg | FxMsg;

const EV_KEYS: readonly string[] = ['up', 'down', 'drs', 'cam', 'pause', 'recal'];
const FX_KEYS: readonly string[] = ['kerb', 'grass', 'limits', 'shift', 'limiter'];
const WARN_MAX = 24;

const round3 = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;                                       // evita "-0"
};

export function encode(msg: WheelToHost | HostToWheel | PongMsg): string {
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
