import { config as defaultConfig, type GameConfig } from '../../shared/config';
import { driverAt } from '../../shared/teams';
import { RaceSession, type RaceEvent, type RacePhase, type Standing } from '../../sim/race';
import { RivalDriver, rivalSkill, type AiLevel, type CarSnapshot } from '../../sim/rival';
import type { Simulation } from '../../sim/simulation';
import type { DriverCommand, DriverInput, SimEvent } from '../../sim/types';
import type { Track } from '../../track/types';

// Controlador de carrera del host (b14 D7): encapsula RaceSession y da al bucle de main.ts el Simulation del jugador
// (`playerSim`) más los rivales para render, audio y minimapa. En práctica: RaceSession de 1 entrada, colocada como
// antes (s = start − startOffsetM, d = 0), en verde desde el principio y sin final (comportamiento previo intacto).

export type RaceMode = 'practice' | 'race';
export interface RaceOptions { mode: RaceMode; rivals: number; ai: AiLevel; seed: number }

const AI_LEVELS: readonly AiLevel[] = ['easy', 'medium', 'hard'];

// Opciones elegidas por URL (`mode=race|practice`, `rivals=N`, `ai=easy|medium|hard`, `seed=N`).
// Devuelve null si la URL no elige modo: entonces decide el menú (grupo 4).
export function parseRaceOptions(params: URLSearchParams, cfg: GameConfig = defaultConfig): RaceOptions | null {
  const mode = params.get('mode');
  if (mode !== 'race' && mode !== 'practice') return null;
  return { mode, ...raceOptionDefaults(params, cfg) };
}

// Rivales, nivel y semilla por URL o por defecto (rivales 1–9).
export function raceOptionDefaults(params: URLSearchParams, cfg: GameConfig = defaultConfig): Omit<RaceOptions, 'mode'> {
  const n = Math.round(Number(params.get('rivals')));
  const rivals = Number.isFinite(n) && n >= 1 ? Math.min(9, n) : cfg.race.defaultRivals;
  const a = params.get('ai') as AiLevel | null;
  const ai = a && AI_LEVELS.includes(a) ? a : 'medium';
  const sd = Number(params.get('seed'));
  const seed = Number.isInteger(sd) && sd > 0 ? sd : 1 + Math.floor(Math.random() * 0x7ffffffe);
  return { rivals, ai, seed };
}

// Pose de un rival en el paso anterior y en el actual (para interpolar) y su estado de render.
export interface RivalView {
  id: number; team: number;
  prev: { x: number; y: number; z: number; yaw: number };
  cur: { x: number; y: number; z: number; yaw: number };
  pitch: number; speed: number; vLong: number; steerAngle: number; rpm: number; throttle: number; limiter: boolean;
}

export class RaceController {
  readonly opts: RaceOptions;
  readonly track: Track;
  readonly session: RaceSession;
  readonly playerId: number;
  readonly playerSim: Simulation;
  private readonly cfg: GameConfig;
  private readonly drivers: (RivalDriver | null)[];
  private readonly views: RivalView[];
  private readonly snaps: CarSnapshot[];
  private readonly inputs: DriverInput[];
  private readonly commands: DriverCommand[][];

  constructor(track: Track, opts: RaceOptions, cfg: GameConfig = defaultConfig) {
    this.opts = opts;
    this.track = track;
    this.cfg = cfg;
    const race = opts.mode === 'race';
    const n = race ? 1 + Math.max(1, Math.min(9, opts.rivals)) : 1;
    this.playerId = race ? Math.min(cfg.race.playerGridSlot, n - 1) : 0;
    // Plaza k de la parrilla: el jugador es el piloto 0; los rivales toman los pilotos 1, 2, … por orden de parrilla
    let next = 1;
    const entries = Array.from({ length: n }, (_, k) => {
      const { team, driver } = driverAt(k === this.playerId ? 0 : next++);
      return { name: driver.name, team, isAi: k !== this.playerId };
    });
    this.session = new RaceSession(track, entries, cfg, opts.seed);
    this.playerSim = this.session.entries[this.playerId].sim;
    if (!race) {
      this.playerSim.reset();          // misma colocación que antes de b14 (d = 0)
      this.session.phase = 'green';    // sin semáforo: la cuenta atrás de 3 s la lleva el host
    }
    this.drivers = this.session.entries.map((e, k) => e.isAi
      ? new RivalDriver(track, rivalSkill(opts.ai, opts.seed * 101 + k, cfg), opts.seed * 977 + k, cfg) : null);
    this.views = this.session.entries.filter((e) => e.isAi).map((e) => {
      const c = e.sim.state.car;
      return { id: e.id, team: e.team, prev: { x: c.x, y: c.y, z: c.z, yaw: c.yaw }, cur: { x: c.x, y: c.y, z: c.z, yaw: c.yaw },
        pitch: c.pitch, speed: 0, vLong: 0, steerAngle: 0, rpm: c.rpm, throttle: 0, limiter: false };
    });
    this.snaps = this.session.entries.map((e) => ({ id: e.id, s: 0, d: 0, speed: 0, lapsDone: 0 }));
    this.inputs = this.session.entries.map(() => ({ steer: 0, throttle: 0, brake: 0, ers: false }));
    this.commands = this.session.entries.map(() => []);
  }

  get isRace(): boolean { return this.opts.mode === 'race'; }
  get phase(): RacePhase { return this.session.phase; }
  get lightsOn(): number { return this.session.lightsOn; }
  // La carrera ha terminado para todos (nunca en práctica).
  get finished(): boolean { return this.isRace && this.session.phase === 'finished'; }

  // Enciende el semáforo (solo carrera, desde parrilla).
  startLights(): void { if (this.isRace) this.session.startLights(); }

  // Un paso fijo para todos: entrada del jugador + IA. Devuelve todos los eventos.
  step(playerInput: DriverInput, playerCommands: readonly DriverCommand[]): RaceEvent[] {
    const rs = this.session, n = rs.entries.length;
    for (let k = 0; k < n; k++) {
      const c = rs.entries[k].sim.state.car, sn = this.snaps[k];
      sn.s = c.s; sn.d = c.d; sn.speed = c.speed; sn.lapsDone = rs.lapsDone(k);
    }
    for (let k = 0; k < n; k++) {
      const drv = this.drivers[k];
      if (!drv) { this.inputs[k] = playerInput; this.commands[k] = playerCommands as DriverCommand[]; continue; }
      const out = drv.read(rs.entries[k].sim.state, this.snaps.filter((o) => o.id !== k), { phase: rs.phase, gapAheadS: rs.gapAheadOf(k) });
      this.inputs[k] = out.input; this.commands[k] = out.commands;
    }
    for (const v of this.views) {
      const c = rs.entries[v.id].sim.state.car;
      v.prev.x = c.x; v.prev.y = c.y; v.prev.z = c.z; v.prev.yaw = c.yaw;
    }
    const events = rs.step(this.inputs, this.commands);
    this.syncViews(false);
    return events;
  }

  // Eventos del coche del jugador (sin la etiqueta `car`), para audio, avisos y cronometraje del host.
  playerEvents(events: readonly RaceEvent[]): SimEvent[] {
    const out: SimEvent[] = [];
    for (const e of events) if ('car' in e && e.type !== 'finish' && e.car === this.playerId) {
      const { car: _car, ...ev } = e as SimEvent & { car: number };
      out.push(ev as SimEvent);
    }
    return out;
  }

  // Rivales (sin el jugador) con su pose anterior y actual.
  rivals(): readonly RivalView[] { return this.views; }

  // Tras recolocar coches fuera del paso (p. ej. recentrar): pose anterior = actual.
  syncViews(snap = true): void {
    for (const v of this.views) {
      const c = this.session.entries[v.id].sim.state.car;
      v.cur.x = c.x; v.cur.y = c.y; v.cur.z = c.z; v.cur.yaw = c.yaw;
      if (snap) { v.prev.x = c.x; v.prev.y = c.y; v.prev.z = c.z; v.prev.yaw = c.yaw; }
      v.pitch = c.pitch; v.speed = c.speed; v.vLong = c.vLong; v.steerAngle = c.steerAngle;
      v.rpm = c.rpm; v.throttle = c.throttle; v.limiter = c.limiter;
    }
  }

  standings(): Standing[] { return this.session.standings(); }

  // Posición del jugador (1..N).
  playerPos(): number {
    const st = this.session.standings();
    return st.find((s) => s.id === this.playerId)?.pos ?? 1;
  }

  // Resumen para la API de depuración.
  debug(): { mode: RaceMode; phase: RacePhase; lightsOn: number; playerPos: number; standings: Standing[] } {
    return { mode: this.opts.mode, phase: this.phase, lightsOn: this.lightsOn, playerPos: this.playerPos(), standings: this.standings() };
  }
}
