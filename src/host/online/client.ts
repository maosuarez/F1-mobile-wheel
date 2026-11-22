import { config as defaultConfig, type GameConfig } from '../../shared/config';
import {
  decodeAtRace, encode, RACE_CODE_LENGTH, RACE_NAME_MAX, ROOM_ALPHABET,
  type LobbyMsg, type NetAiCar, type NetCfg, type NetMsg, type NetResRow, type RaceToRelay,
} from '../../shared/protocol';
import { driverAt } from '../../shared/teams';
import type { EntryKind, RaceEntrySpec, RaceSession } from '../../sim/race';
import { ClockSync } from './clock';
import { RemoteCar, sampleFromAi, sampleFromCar } from './remoteCars';

// Cliente de carrera online (b16 D3–D6) sobre /ws/race/{code}?name=. Sin UI: el vestíbulo y el menú (grupo 3) lo
// cablean con esta API.
//
// Flujo:
//   const c = new OnlineClient({ code, name, team }); c.on('lobby', ...); c.connect();
//   propietario: c.configure({ track, laps, rivals, ai, seed }); c.start();
//   todos, en 'start' (cfg, atSrv): const g = onlineGrid(cfg, c.you, c.isOwner, c.players);
//     session = new RaceSession(track, g.entries, cfgConLaps, cfg.seed); c.attach(session, g, track.length);
//   cada fotograma: c.tick(); if (session.phase === 'grid' && c.lightsDue()) session.startLights();
//   antes de cada session.step: c.beforeStep();
//   'leave' (abandono: el coche ya está retirado en la sesión; quitarlo de la escena 2 s después), 'results'.

export type OnlineStatus = 'idle' | 'connecting' | 'lobby' | 'countdown' | 'racing' | 'closed';
export interface OnlinePlayer { slot: number; name: string; team: number }
export interface OnlineSetup { track: string; laps: number; rivals: number; ai: NetCfg['ai']; seed: number }
// Plaza de la parrilla online: entryId = índice en RaceSession; slot = plaza del relay (null en IA); ai = índice de IA.
export interface OnlineSeat { entryId: number; slot: number | null; ai: number | null; kind: EntryKind; name: string; team: number }
export interface OnlineGrid { entries: RaceEntrySpec[]; seats: OnlineSeat[]; localId: number }

export interface OnlineEvents {
  status: (s: OnlineStatus) => void;
  lobby: (players: readonly OnlinePlayer[], owner: number, you: number) => void;
  cfg: (cfg: NetCfg) => void;
  start: (cfg: NetCfg, atSrv: number) => void;
  leave: (slot: number, entryId: number | null) => void;        // entryId: su entrada en la sesión (si la hay)
  owner: (owner: number, previous: number) => void;              // cambio de propietario
  results: (rows: NetResRow[], official: boolean) => void;       // official: tabla `res` del propietario
  close: (code: number) => void;                                 // 4001 sala llena, 4002 empezada / sin latido, 4400 inválida
}

export interface RaceSocket {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number): void;
}

export interface OnlineClientOptions {
  code: string; name: string; team: number;
  cfg?: GameConfig;
  url?: string;                                  // por defecto: mismo origen, /ws/race/{code}?name=
  socketFactory?: (url: string) => RaceSocket;   // por defecto: new WebSocket(url)
  now?: () => number;                            // reloj local en ms (performance.now)
  dropStEvery?: number;                          // pruebas: descarta 1 de cada N `st` recibidos (0 = ninguno)
  startLeadMs?: number;                          // margen entre `start` y el semáforo (D5: 3000)
}

const OPEN = 1;
const START_LEAD_MS = 3000;

export function generateRaceCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < RACE_CODE_LENGTH; i++) s += ROOM_ALPHABET[Math.min(ROOM_ALPHABET.length - 1, Math.floor(rand() * ROOM_ALPHABET.length))];
  return s;
}

export function isRaceCode(s: string): boolean {
  return typeof s === 'string' && s.length === RACE_CODE_LENGTH && [...s].every((c) => ROOM_ALPHABET.includes(c));
}

/** Normaliza lo escrito en el campo de código: mayúsculas, solo alfabeto, máx. 6. */
export function sanitizeRaceInput(s: string): string {
  return [...s.toUpperCase()].filter((c) => ROOM_ALPHABET.includes(c)).slice(0, RACE_CODE_LENGTH).join('');
}

export function raceUrl(code: string, name: string): string {
  const loc = globalThis.location;
  const proto = loc?.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc?.host ?? 'localhost'}/ws/race/${encodeURIComponent(code)}?name=${encodeURIComponent(name.slice(0, RACE_NAME_MAX))}`;
}

// Parrilla común (D2/D5): humanos en el orden de cfg.grid, luego cfg.rivals IA. La IA es 'ai' en el propietario y
// 'remote' en los demás; el resto de humanos son 'remote'.
export function onlineGrid(cfg: NetCfg, you: number, isOwner: boolean, players: readonly OnlinePlayer[]): OnlineGrid {
  const seats: OnlineSeat[] = [];
  cfg.grid.forEach((slot, i) => {
    const p = players.find((q) => q.slot === slot);
    seats.push({ entryId: i, slot, ai: null, kind: slot === you ? 'local' : 'remote', name: p?.name || `Jugador ${slot + 1}`, team: p?.team ?? 0 });
  });
  for (let k = 0; k < cfg.rivals; k++) {
    const { team, driver } = driverAt(cfg.grid.length + k);
    seats.push({ entryId: seats.length, slot: null, ai: k, kind: isOwner ? 'ai' : 'remote', name: driver.name, team });
  }
  const local = seats.find((s) => s.kind === 'local');
  return { entries: seats.map((s) => ({ name: s.name, team: s.team, kind: s.kind })), seats, localId: local ? local.entryId : -1 };
}

// Tabla de resultados desde la clasificación de la sesión (orden por posición).
export function buildResults(session: RaceSession): NetResRow[] {
  return session.standings().map((s) => ({ id: s.id, tt: s.totalTimeS, laps: s.lapsDone, best: s.bestLapS, dnf: !!s.dnf }));
}

type Listeners = { [K in keyof OnlineEvents]?: OnlineEvents[K][] };

export class OnlineClient {
  readonly code: string;
  readonly name: string;
  readonly team: number;
  readonly clock: ClockSync;
  status: OnlineStatus = 'idle';
  you = -1;
  owner = -1;
  players: OnlinePlayer[] = [];
  netCfg: NetCfg | null = null;     // última configuración (propia si es propietario, recibida si no)
  atSrv: number | null = null;      // instante del semáforo (ms servidor)
  results: { rows: NetResRow[]; official: boolean } | null = null;

  private readonly cfg: GameConfig;
  private readonly opts: OnlineClientOptions;
  private readonly now: () => number;
  private ws: RaceSocket | null = null;
  private readonly ls: Listeners = {};
  private readonly teams = new Map<number, number>();   // plaza → equipo (de hello)
  private session: RaceSession | null = null;
  private grid: OnlineGrid | null = null;
  private readonly remotes = new Map<number, RemoteCar>();   // entryId → coche remoto
  private nextSendMs = 0;
  private stCount = 0;
  private resSent = false;
  private finishedAtMs: number | null = null;

  constructor(opts: OnlineClientOptions) {
    this.opts = opts;
    this.code = opts.code;
    this.name = opts.name.slice(0, RACE_NAME_MAX);
    this.team = opts.team;
    this.cfg = opts.cfg ?? defaultConfig;
    this.now = opts.now ?? (() => performance.now());
    this.clock = new ClockSync(() => this.send({ t: 'time' }), this.now, this.cfg);
  }

  get isOwner(): boolean { return this.you >= 0 && this.you === this.owner; }

  on<K extends keyof OnlineEvents>(k: K, fn: OnlineEvents[K]): () => void {
    const arr = (this.ls[k] ??= []) as OnlineEvents[K][];
    arr.push(fn);
    return () => { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); };
  }

  connect(): void {
    if (this.ws) return;
    this.setStatus('connecting');
    const url = this.opts.url ?? raceUrl(this.code, this.name);
    let ws: RaceSocket;
    try {
      ws = this.opts.socketFactory ? this.opts.socketFactory(url) : (new WebSocket(url) as unknown as RaceSocket);
    } catch { this.handleClose(1006); return; }
    this.ws = ws;
    ws.onmessage = (e) => { if (this.ws === ws && typeof e.data === 'string') this.handle(e.data); };
    ws.onerror = () => {};
    ws.onclose = (e) => { if (this.ws === ws) { this.ws = null; this.handleClose(e.code); } };
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) { try { ws.close(); } catch { /* ya cerrado */ } }
    if (this.status !== 'closed') this.handleClose(1000);
  }

  // Propietario: fija la configuración (la parrilla son las plazas conectadas en orden) y la difunde.
  configure(setup: OnlineSetup): NetCfg | null {
    if (!this.isOwner || this.status !== 'lobby') return null;
    const rivals = Math.max(0, Math.min(9, 10 - this.players.length, Math.round(setup.rivals)));   // parrilla ≤ 10
    this.netCfg = { t: 'cfg', track: setup.track, laps: setup.laps, rivals, ai: setup.ai, seed: setup.seed,
      grid: this.players.map((p) => p.slot).sort((a, b) => a - b) };
    this.send(this.netCfg);
    this.emit('cfg', this.netCfg);
    return this.netCfg;
  }

  // Propietario: cfg actualizado → start { atSrv: ahora + 3 s } → started (D5). Devuelve atSrv o null.
  start(setup?: OnlineSetup): number | null {
    if (!this.isOwner || this.status !== 'lobby') return null;
    const base = setup ?? this.netCfg;
    if (!base) return null;
    const cfg = this.configure({ track: base.track, laps: base.laps, rivals: base.rivals, ai: base.ai, seed: base.seed });
    if (!cfg) return null;
    const atSrv = Math.round(this.clock.nowSrv() + (this.opts.startLeadMs ?? START_LEAD_MS));
    this.send({ t: 'start', atSrv });
    this.send({ t: 'started' });
    this.beginCountdown(cfg, atSrv);
    return atSrv;
  }

  // Une la sesión creada con onlineGrid(...) tras 'start'. trackLength para interpolar s.
  attach(session: RaceSession, grid: OnlineGrid, trackLength: number): void {
    this.session = session;
    this.grid = grid;
    this.remotes.clear();
    for (const s of grid.seats) if (s.kind === 'remote') this.remotes.set(s.entryId, new RemoteCar(trackLength, this.cfg));
    this.resSent = false;
    this.finishedAtMs = null;
    this.results = null;
    this.nextSendMs = this.now();
    // Abandonos ocurridos entre 'start' y attach
    for (const s of grid.seats) if (s.slot !== null && !this.players.some((p) => p.slot === s.slot)) session.retire(s.entryId);
  }

  // Coche remoto de una entrada (para depuración / render).
  remote(entryId: number): RemoteCar | undefined { return this.remotes.get(entryId); }

  // El semáforo debe empezar (nowSrv ≥ atSrv).
  lightsDue(): boolean {
    return this.atSrv !== null && (this.status === 'countdown' || this.status === 'racing') && this.clock.nowSrv() >= this.atSrv;
  }

  // Antes de cada session.step: coloca los remotos en su pose interpolada (nowSrv − interpDelayMs).
  beforeStep(): void {
    const s = this.session;
    if (!s) return;
    const t = this.clock.nowSrv() - this.cfg.net.interpDelayMs;
    for (const [id, rc] of this.remotes) {
      if (s.entries[id].retired) continue;
      const p = rc.sample(t);
      if (p) s.setRemote(id, p);
    }
  }

  // Cada fotograma: reloj, envío de st/ai a net.raceHz y resultados.
  tick(): void {
    this.clock.tick();
    const s = this.session, g = this.grid;
    if (!s || !g) return;
    if (this.status === 'countdown' && this.lightsDue()) this.setStatus('racing');
    const t = this.now(), period = 1000 / this.cfg.net.raceHz;
    if (t >= this.nextSendMs) {
      this.nextSendMs = t - this.nextSendMs > period ? t + period : this.nextSendMs + period;
      this.sendState(s, g);
    }
    if (s.phase !== 'finished') return;
    this.finishedAtMs ??= t;
    if (this.isOwner && !this.resSent) {
      this.resSent = true;
      const rows = buildResults(s);
      this.send({ t: 'res', rows });
      this.setResults(rows, true);
    } else if (!this.results && t - this.finishedAtMs >= this.cfg.net.resultsWaitS * 1000) {
      this.setResults(buildResults(s), false);
    }
  }

  // --- internos ---

  private sendState(s: RaceSession, g: OnlineGrid): void {
    const ts = Math.round(this.clock.nowSrv());
    if (g.localId >= 0) {
      const id = g.localId, st = s.entries[id].sim.state, c = st.car;
      const tt = s.finishTimeS(id);
      this.send({ t: 'st', ts, x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, roll: c.roll, v: c.speed, steer: c.steerAngle,
        s: c.s, d: c.d, laps: s.lapsDone(id), prog: s.progressM(id), drs: c.drs, fin: tt !== null, tt, best: st.timing.bestLapS });
    }
    if (!this.isOwner) return;
    const cars: NetAiCar[] = [];
    for (const seat of g.seats) {
      if (seat.ai === null || seat.kind !== 'ai') continue;
      const id = seat.entryId, st = s.entries[id].sim.state, c = st.car;
      const tt = s.finishTimeS(id);
      cars.push([c.x, c.y, c.z, c.yaw, c.speed, c.steerAngle, c.s, c.d, s.lapsDone(id), s.progressM(id), tt !== null, tt, st.timing.bestLapS]);
    }
    if (cars.length) this.send({ t: 'ai', ts, cars });
  }

  private send(m: RaceToRelay): void {
    const ws = this.ws;
    if (ws && ws.readyState === OPEN) ws.send(encode(m));
  }

  private setStatus(s: OnlineStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }

  private emit<K extends keyof OnlineEvents>(k: K, ...args: Parameters<OnlineEvents[K]>): void {
    for (const fn of [...(this.ls[k] ?? [])]) (fn as (...a: Parameters<OnlineEvents[K]>) => void)(...args);
  }

  private setResults(rows: NetResRow[], official: boolean): void {
    this.results = { rows, official };
    this.emit('results', rows, official);
  }

  private beginCountdown(cfg: NetCfg, atSrv: number): void {
    this.netCfg = cfg;
    this.atSrv = atSrv;
    this.setStatus('countdown');
    this.emit('start', cfg, atSrv);
  }

  private handleClose(code: number): void {
    this.setStatus('closed');
    this.emit('close', code);
  }

  private handle(raw: string): void {
    const m = decodeAtRace(raw);
    if (!m) return;
    switch (m.t) {
      case 'ping': this.send({ t: 'pong' }); return;
      case 'time': this.clock.onTime(m.srv); return;
      case 'lobby': this.onLobby(m); return;
      case 'r': this.onGame(m.f, m.m); return;
    }
  }

  private onLobby(m: LobbyMsg): void {
    const first = this.you < 0;
    const prevSlots = new Set(this.players.map((p) => p.slot));
    const prevOwner = this.owner;
    this.you = m.you;
    this.owner = m.owner;
    this.players = m.players.map((p) => ({ slot: p.slot, name: p.name,
      team: p.slot === m.you ? this.team : this.teams.get(p.slot) ?? 0 })).sort((a, b) => a.slot - b.slot);
    if (first) {
      this.setStatus('lobby');
      this.clock.begin();
    }
    const now = new Set(this.players.map((p) => p.slot));
    const joined = this.players.some((p) => !prevSlots.has(p.slot) && p.slot !== m.you);
    if (first || joined) this.send({ t: 'hello', name: this.name, team: this.team });
    if (joined && this.isOwner && this.netCfg && this.status === 'lobby') this.configure(this.netCfg);
    for (const slot of prevSlots) if (!now.has(slot)) this.onLeave(slot);
    if (!first && prevOwner !== m.owner) {
      // D6: el propietario se fue durante la carrera → su IA queda retirada en los demás
      if (!now.has(prevOwner)) this.retireAi();
      this.emit('owner', m.owner, prevOwner);
    }
    this.emit('lobby', this.players, this.owner, this.you);
  }

  private onLeave(slot: number): void {
    this.teams.delete(slot);
    const seat = this.grid?.seats.find((s) => s.slot === slot) ?? null;
    if (seat && this.session) this.session.retire(seat.entryId);
    if (seat) this.remotes.get(seat.entryId)?.clear();
    this.emit('leave', slot, seat ? seat.entryId : null);
  }

  private retireAi(): void {
    const s = this.session, g = this.grid;
    if (!s || !g) return;
    for (const seat of g.seats) if (seat.ai !== null && seat.kind === 'remote') s.retire(seat.entryId);
  }

  private onGame(f: number, m: NetMsg): void {
    switch (m.t) {
      case 'hello': {
        this.teams.set(f, m.team);
        const p = this.players.find((q) => q.slot === f);
        if (p) { p.team = m.team; this.emit('lobby', this.players, this.owner, this.you); }
        return;
      }
      case 'cfg':
        if (f !== this.owner || this.status !== 'lobby') return;
        this.netCfg = m;
        this.emit('cfg', m);
        return;
      case 'start':
        if (f !== this.owner || this.status !== 'lobby' || !this.netCfg) return;
        this.beginCountdown(this.netCfg, m.atSrv);
        return;
      case 'st': {
        const seat = this.grid?.seats.find((s) => s.slot === f);
        if (!seat || seat.kind !== 'remote') return;
        const n = this.opts.dropStEvery ?? 0;
        if (n > 0 && ++this.stCount % n === 0) return;
        this.remotes.get(seat.entryId)?.push(sampleFromCar(m));
        return;
      }
      case 'ai': {
        if (f !== this.owner || !this.grid) return;
        let k = 0;
        for (const seat of this.grid.seats) {
          if (seat.ai === null) continue;
          const c = m.cars[k++];
          if (!c) break;
          if (seat.kind === 'remote') this.remotes.get(seat.entryId)?.push(sampleFromAi(m.ts, c));
        }
        return;
      }
      case 'res':
        if (f !== this.owner) return;
        this.setResults(m.rows, true);
        return;
    }
  }
}
