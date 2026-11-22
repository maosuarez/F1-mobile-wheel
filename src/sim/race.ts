import { config as defaultConfig } from '../shared/config';
import type { GameConfig } from '../shared/config';
import { deltaS, wrapS } from '../track/query';
import type { Track } from '../track/types';
import { COLLIDE_IGNORE, COLLIDE_REMOTE, resolveCollisions } from './collision';
import { onLapStartErs } from './ers';
import { mulberry32 } from './rng';
import { Simulation } from './simulation';
import type { DriverCommand, DriverInput, SimEvent } from './types';
import { NEUTRAL_INPUT } from './types';

// Sesión de carrera multicoche (b14 D1): un Simulation por coche, semáforo, colisiones (D2), clasificación en vivo,
// diferencias por checkpoints, DRS por detección (D4) y final de carrera. Pura y determinista.

export type RacePhase = 'grid' | 'lights' | 'green' | 'finishing' | 'finished';
// b16 D4: 'local' (humano de este PC), 'ai' (IA simulada aquí), 'remote' (pose recibida por red; no se integra)
export type EntryKind = 'local' | 'ai' | 'remote';
export interface RaceEntry { id: number; name: string; team: number; kind: EntryKind; isAi: boolean; retired: boolean; sim: Simulation }
// Entrada al construir: kind por defecto según isAi ('ai' | 'local').
export interface RaceEntrySpec { name: string; team: number; isAi?: boolean; kind?: EntryKind }
// Estado de un coche remoto en un instante (ya interpolado). steer = ángulo de dirección (rad); prog = progreso (m)
// desde la línea de meta como Standing.progressM; tt = tiempo total al terminar (s).
export interface RemotePose {
  x: number; y: number; z: number; yaw: number; pitch: number; roll: number; v: number; steer: number;
  s: number; d: number; laps: number; prog: number; drs: 0 | 1 | 2; fin: boolean; tt: number | null; best: number | null;
}
export interface Standing {
  id: number; pos: number; lapsDone: number; progressM: number; gapToLeaderS: number | null;
  gapAheadS: number | null; finished: boolean; totalTimeS: number | null; bestLapS: number | null;
  dnf?: boolean;   // retirado (b16 D6)
}
export type RaceEvent =
  | (SimEvent & { car: number })
  | { type: 'lightsOut' }
  | { type: 'finish'; car: number; pos: number }
  | { type: 'carHit'; a: number; b: number; impulse: number };

const LIGHTS = 5;

export class RaceSession {
  readonly track: Track;
  readonly cfg: GameConfig;
  readonly entries: RaceEntry[];
  phase: RacePhase = 'grid';
  lightsOn = 0;                       // 0..5
  readonly lightsOutAtS: number;      // instante del apagado desde startLights (s)
  private lightsSteps = 0;
  private clockLights = false;        // online (b16 D5): las luces las fija syncLights con el reloj, no step()
  private readonly n: number;
  private readonly practice: boolean;  // 1 coche: DRS siempre habilitado por detección, como en práctica
  private readonly progress: Float64Array;
  private readonly cpTimes: Float64Array[];   // tiempo de paso por cada checkpoint (NaN = no pasado)
  private readonly lastCp: Int32Array;
  private readonly cpOffset: number;          // desplazamiento para que el índice de checkpoint sea ≥ 0
  private readonly drsZone: Int32Array;       // zona cuya detección rige el DRS del coche (−1 ninguna)
  private readonly finishT: (number | null)[];
  private readonly finishOrder: number[] = [];
  private leaderFinishT: number | null = null;
  private order: number[];                    // ids ordenados por posición (actualizado en cada paso)
  private readonly sPrev: Float64Array;
  private readonly modes: Uint8Array;          // modo de colisión por coche (dinámico / remoto / ignorado)
  private readonly remote: { laps: number; prog: number; fin: boolean; tt: number | null }[];

  constructor(track: Track, entries: RaceEntrySpec[], cfg: GameConfig = defaultConfig, seed = 1) {
    this.track = track;
    this.cfg = cfg;
    this.n = entries.length;
    this.practice = this.n === 1;
    this.entries = entries.map((e, id) => {
      const sim = new Simulation(track, cfg);
      sim.placeOnGrid(id);
      sim.drsEnabled = this.practice;
      const kind: EntryKind = e.kind ?? (e.isAi ? 'ai' : 'local');
      return { id, name: e.name, team: e.team, kind, isAi: kind === 'ai', retired: false, sim };
    });
    this.modes = new Uint8Array(this.n);
    this.remote = this.entries.map((e) => {
      if (e.kind === 'remote') this.modes[e.id] = COLLIDE_REMOTE;
      return { laps: 0, prog: 0, fin: false, tt: null };
    });
    const r = cfg.race;
    const rng = mulberry32(seed);
    this.lightsOutAtS = (LIGHTS - 1) * r.lightsIntervalS + r.lightsHoldMinS + rng() * (r.lightsHoldMaxS - r.lightsHoldMinS);
    this.progress = new Float64Array(this.n);
    this.cpOffset = track.length;
    const cpCount = Math.ceil(((r.laps + 3) * track.length) / r.gapStepM) + 2;
    this.cpTimes = this.entries.map(() => new Float64Array(cpCount).fill(NaN));
    this.lastCp = new Int32Array(this.n);
    this.drsZone = new Int32Array(this.n).fill(-1);
    this.finishT = this.entries.map(() => null);
    this.sPrev = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      if (this.entries[i].kind === 'remote') this.remote[i].prog = this.simProgress(i);   // hasta la primera pose
      this.progress[i] = this.progressOf(i);
      this.lastCp[i] = this.cpIndex(this.progress[i]) - 1;   // aún no ha pasado ningún checkpoint
    }
    this.order = this.computeOrder();
  }

  // grid → lights (la primera luz se enciende ya).
  startLights(): void {
    if (this.phase !== 'grid') return;
    this.phase = 'lights';
    this.lightsSteps = 0;
    this.lightsOn = 1;
  }

  // Online (b16 D5): fija el semáforo según el tiempo transcurrido desde su inicio en reloj del servidor (s) y pasa a
  // verde si elapsedS ≥ lightsOutAtS. Desde la primera llamada, step() deja de avanzar las luces por pasos.
  syncLights(elapsedS: number): RaceEvent[] {
    const events: RaceEvent[] = [];
    if (this.phase !== 'lights') return events;
    this.clockLights = true;
    this.applyLights(Math.max(0, elapsedS), events);
    return events;
  }

  private applyLights(t: number, events: RaceEvent[]): void {
    if (t >= this.lightsOutAtS - 1e-9) {
      this.phase = 'green';
      this.lightsOn = 0;
      events.push({ type: 'lightsOut' });
    } else {
      this.lightsOn = Math.min(LIGHTS, 1 + Math.floor(t / this.cfg.race.lightsIntervalS + 1e-9));
    }
  }

  // Coloca un coche remoto en la pose recibida (b16 D4). No toca coches no remotos. Se llama antes de step().
  setRemote(id: number, p: RemotePose): void {
    const e = this.entries[id];
    if (!e || e.kind !== 'remote') return;
    const c = e.sim.state.car;
    c.x = p.x; c.y = p.y; c.z = p.z; c.yaw = p.yaw; c.pitch = p.pitch; c.roll = p.roll;
    c.vx = p.v * Math.cos(p.yaw); c.vz = -p.v * Math.sin(p.yaw);
    c.speed = p.v; c.vLong = p.v; c.vLat = 0; c.steerAngle = p.steer; c.drs = p.drs;
    c.s = p.s; c.d = p.d;
    e.sim.state.timing.bestLapS = p.best;
    const r = this.remote[id];
    r.laps = Math.max(0, p.laps); r.prog = p.prog; r.fin = p.fin; r.tt = p.tt;
  }

  // Retira un coche (DNF, b16 D6): deja de colisionar y se clasifica detrás de los activos.
  retire(id: number): void {
    const e = this.entries[id];
    if (!e || e.retired) return;
    e.retired = true;
    this.modes[id] = COLLIDE_IGNORE;
    this.order = this.computeOrder();
    this.checkFinished();
  }

  // Progreso (m) desde la línea de meta (como Standing.progressM).
  progressM(id: number): number { return this.progress[id]; }

  // Tiempo total al terminar (s) o null.
  finishTimeS(id: number): number | null { return this.finishT[id] ?? null; }

  // Tiempo de carrera desde el apagado (s); igual al reloj de cada Simulation.
  get raceTimeS(): number {
    return this.n > 0 ? this.entries[0].sim.state.t : 0;
  }

  // Avanza un dt para todos los coches. inputs/commands indexados por id.
  step(inputs: readonly DriverInput[], commands: readonly (readonly DriverCommand[])[]): RaceEvent[] {
    const events: RaceEvent[] = [];
    if (this.phase === 'grid') return events;
    if (this.phase === 'lights') {
      if (this.clockLights) return events;
      this.lightsSteps++;
      this.applyLights(this.lightsSteps * this.cfg.sim.dt, events);
      return events;
    }

    // 1. Simulación de cada coche en orden de id
    const crossings: { car: number; t: number }[] = [];
    for (let i = 0; i < this.n; i++) {
      const sim = this.entries[i].sim;
      this.sPrev[i] = sim.state.car.s;
      if (this.entries[i].kind === 'remote') {
        // No se integra: solo avanza su reloj para que raceTimeS no dependa de qué entrada es remota
        sim.state.stepCount++;
        sim.state.t = sim.state.stepCount * this.cfg.sim.dt;
        const r = this.remote[i];
        if (r.fin && r.tt !== null && this.finishT[i] === null) crossings.push({ car: i, t: r.tt });
        continue;
      }
      const ev = sim.step(inputs[i] ?? NEUTRAL_INPUT, commands[i] ?? []);
      for (const e of ev) {
        events.push({ ...e, car: i });
        if (e.type === 'lapStart') crossings.push({ car: i, t: sim.state.t - sim.state.timing.lapTimeS });
      }
    }

    // 2. Colisiones; si un empujón cruza una frontera de cronometraje, el cronómetro lo registra ahora
    const cars = this.entries.map((e) => e.sim.state.car);
    const sAfter = cars.map((c) => c.s);
    for (const h of resolveCollisions(cars, this.track, this.cfg, this.modes)) events.push({ type: 'carHit', ...h });
    for (let i = 0; i < this.n; i++) {
      if (cars[i].s === sAfter[i] || this.entries[i].kind === 'remote') continue;
      const sim = this.entries[i].sim;
      const ev: SimEvent[] = [];
      sim.timer.update(sAfter[i], cars[i].s, sim.state.t, sim.state.t, ev);
      for (const e of ev) {
        events.push({ ...e, car: i });
        if (e.type === 'lapStart') { onLapStartErs(cars[i], this.cfg); crossings.push({ car: i, t: sim.state.t }); }
      }
    }

    // 3. Progreso y checkpoints de diferencias
    const tNow = this.raceTimeS, tPrev = tNow - this.cfg.sim.dt;
    for (let i = 0; i < this.n; i++) {
      const p0 = this.progress[i], p1 = this.progressOf(i);
      this.progress[i] = p1;
      const k1 = Math.min(this.cpIndex(p1), this.cpTimes[i].length - 1);
      for (let k = this.lastCp[i] + 1; k <= k1; k++) {
        if (k < 0) continue;
        const pk = k * this.cfg.race.gapStepM - this.cpOffset;
        const u = p1 > p0 ? Math.min(Math.max((pk - p0) / (p1 - p0), 0), 1) : 1;
        if (Number.isNaN(this.cpTimes[i][k])) this.cpTimes[i][k] = tPrev + u * (tNow - tPrev);
      }
      if (k1 > this.lastCp[i]) this.lastCp[i] = k1;
    }

    // 4. Final: el líder completa las vueltas; después cada coche termina al cruzar la meta siguiente
    crossings.sort((a, b) => a.t - b.t || a.car - b.car);
    for (const c of crossings) {
      if (this.finishT[c.car] !== null) continue;
      const lapsDone = this.lapsDone(c.car);
      if (this.phase === 'green' && lapsDone >= this.cfg.race.laps) {
        this.phase = 'finishing';
        this.leaderFinishT = c.t;
      }
      if (this.phase === 'finishing') {
        this.finishT[c.car] = c.t;
        this.finishOrder.push(c.car);
        events.push({ type: 'finish', car: c.car, pos: this.finishOrder.length });
      }
    }
    this.checkFinished();

    // 5. Clasificación y detección DRS
    this.order = this.computeOrder();
    if (!this.practice) this.updateDrs();
    return events;
  }

  // Clasificación ordenada por posición.
  standings(): Standing[] {
    const out: Standing[] = [];
    const leader = this.order[0];
    for (let pos = 0; pos < this.order.length; pos++) {
      const id = this.order[pos];
      const st = this.entries[id].sim.state;
      out.push({
        id, pos: pos + 1, lapsDone: this.lapsDone(id), progressM: this.progress[id],
        gapToLeaderS: pos === 0 ? 0 : this.gap(id, leader),
        gapAheadS: pos === 0 ? null : this.gap(id, this.order[pos - 1]),
        finished: this.finishT[id] !== null, totalTimeS: this.finishT[id], bestLapS: st.timing.bestLapS,
      });
      if (this.entries[id].retired) out[out.length - 1].dnf = true;
    }
    return out;
  }

  // Diferencia con el coche de delante (s) o null.
  gapAheadOf(id: number): number | null {
    const pos = this.order.indexOf(id);
    return pos > 0 ? this.gap(id, this.order[pos - 1]) : null;
  }

  // Vueltas completadas.
  lapsDone(id: number): number {
    if (this.entries[id].kind === 'remote') return this.remote[id].laps;
    return Math.max(0, this.entries[id].sim.state.timing.lap - 1);
  }

  // Fin de carrera: todos los activos han terminado (los retirados no cuentan) o se agotó el tiempo tras el líder.
  private checkFinished(): void {
    if (this.phase !== 'finishing') return;
    let pending = 0;
    for (let i = 0; i < this.n; i++) if (this.finishT[i] === null && !this.entries[i].retired) pending++;
    if (pending === 0 || this.raceTimeS - (this.leaderFinishT ?? this.raceTimeS) >= this.cfg.race.finishTimeoutS) this.phase = 'finished';
  }

  // Progreso desde la línea de meta: lapsDone·L + distancia en la vuelta; antes de la primera vuelta, s − L.
  private progressOf(id: number): number {
    return this.entries[id].kind === 'remote' ? this.remote[id].prog : this.simProgress(id);
  }

  private simProgress(id: number): number {
    const t = this.track;
    const st = this.entries[id].sim.state;
    const dist = wrapS(t, st.car.s - t.startS);
    return st.timing.lap >= 1 ? (st.timing.lap - 1) * t.length + dist : dist - t.length;
  }

  private cpIndex(p: number): number {
    return Math.floor((p + this.cpOffset) / this.cfg.race.gapStepM);
  }

  // Diferencia de tiempo de a respecto a b (b por delante): terminados por tiempo total, si no, último checkpoint común.
  private gap(a: number, b: number): number | null {
    const fa = this.finishT[a], fb = this.finishT[b];
    if (fa !== null && fb !== null) return fa - fb;
    const k = this.lastCp[a];
    if (k < 0) return null;
    const ta = this.cpTimes[a][k], tb = this.cpTimes[b][k];
    return Number.isNaN(ta) || Number.isNaN(tb) ? null : ta - tb;
  }

  private computeOrder(): number[] {
    const ids = this.entries.map((e) => e.id);
    const rank = (id: number) => this.finishOrder.indexOf(id);
    return ids.sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      if (ra >= 0 || rb >= 0) return ra < 0 ? 1 : rb < 0 ? -1 : ra - rb;
      const da = this.entries[a].retired, db = this.entries[b].retired;
      if (da !== db) return da ? 1 : -1;
      return this.progress[b] - this.progress[a] || a - b;
    });
  }

  // D4: al pasar por detect_s se decide la habilitación (≤ drsGapS del de delante y vuelta ≥ drsFromLap);
  // se mantiene hasta cruzar end_s de esa zona.
  private updateDrs(): void {
    const t = this.track, r = this.cfg.race;
    const crossed = (s0: number, s1: number, b: number) => {
      const ds = deltaS(t, s0, s1);
      if (ds <= 0 || ds >= t.length / 4) return false;
      const a = wrapS(t, b - s0);
      return a > 0 && a <= ds;
    };
    for (let i = 0; i < this.n; i++) {
      if (this.entries[i].kind === 'remote') continue;   // su DRS llega por red
      const sim = this.entries[i].sim;
      const s0 = this.sPrev[i], s1 = sim.state.car.s;
      for (let z = 0; z < t.drsZones.length; z++) {
        const zone = t.drsZones[z];
        if (this.drsZone[i] === z && crossed(s0, s1, zone.end_s)) { this.drsZone[i] = -1; sim.drsEnabled = false; }
        if (crossed(s0, s1, zone.detect_s)) {
          const gap = this.gapAheadOf(i);
          this.drsZone[i] = z;
          sim.drsEnabled = sim.state.timing.lap >= r.drsFromLap && gap !== null && gap <= r.drsGapS;
        }
      }
    }
  }
}
