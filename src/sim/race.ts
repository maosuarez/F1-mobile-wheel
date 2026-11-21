import { config as defaultConfig } from '../shared/config';
import type { GameConfig } from '../shared/config';
import { deltaS, wrapS } from '../track/query';
import type { Track } from '../track/types';
import { resolveCollisions } from './collision';
import { onLapStartErs } from './ers';
import { mulberry32 } from './rng';
import { Simulation } from './simulation';
import type { DriverCommand, DriverInput, SimEvent } from './types';
import { NEUTRAL_INPUT } from './types';

// Sesión de carrera multicoche (b14 D1): un Simulation por coche, semáforo, colisiones (D2), clasificación en vivo,
// diferencias por checkpoints, DRS por detección (D4) y final de carrera. Pura y determinista.

export type RacePhase = 'grid' | 'lights' | 'green' | 'finishing' | 'finished';
export interface RaceEntry { id: number; name: string; team: number; isAi: boolean; sim: Simulation }
export interface Standing {
  id: number; pos: number; lapsDone: number; progressM: number; gapToLeaderS: number | null;
  gapAheadS: number | null; finished: boolean; totalTimeS: number | null; bestLapS: number | null;
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

  constructor(track: Track, entries: { name: string; team: number; isAi: boolean }[], cfg: GameConfig = defaultConfig, seed = 1) {
    this.track = track;
    this.cfg = cfg;
    this.n = entries.length;
    this.practice = this.n === 1;
    this.entries = entries.map((e, id) => {
      const sim = new Simulation(track, cfg);
      sim.placeOnGrid(id);
      sim.drsEnabled = this.practice;
      return { id, name: e.name, team: e.team, isAi: e.isAi, sim };
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

  // Tiempo de carrera desde el apagado (s); igual al reloj de cada Simulation.
  get raceTimeS(): number {
    return this.n > 0 ? this.entries[0].sim.state.t : 0;
  }

  // Avanza un dt para todos los coches. inputs/commands indexados por id.
  step(inputs: readonly DriverInput[], commands: readonly (readonly DriverCommand[])[]): RaceEvent[] {
    const events: RaceEvent[] = [];
    if (this.phase === 'grid') return events;
    if (this.phase === 'lights') {
      this.lightsSteps++;
      const t = this.lightsSteps * this.cfg.sim.dt;
      if (t >= this.lightsOutAtS - 1e-9) {
        this.phase = 'green';
        this.lightsOn = 0;
        events.push({ type: 'lightsOut' });
      } else {
        this.lightsOn = Math.min(LIGHTS, 1 + Math.floor(t / this.cfg.race.lightsIntervalS + 1e-9));
      }
      return events;
    }

    // 1. Simulación de cada coche en orden de id
    const crossings: { car: number; t: number }[] = [];
    for (let i = 0; i < this.n; i++) {
      const sim = this.entries[i].sim;
      this.sPrev[i] = sim.state.car.s;
      const ev = sim.step(inputs[i] ?? NEUTRAL_INPUT, commands[i] ?? []);
      for (const e of ev) {
        events.push({ ...e, car: i });
        if (e.type === 'lapStart') crossings.push({ car: i, t: sim.state.t - sim.state.timing.lapTimeS });
      }
    }

    // 2. Colisiones; si un empujón cruza una frontera de cronometraje, el cronómetro lo registra ahora
    const cars = this.entries.map((e) => e.sim.state.car);
    const sAfter = cars.map((c) => c.s);
    for (const h of resolveCollisions(cars, this.track, this.cfg)) events.push({ type: 'carHit', ...h });
    for (let i = 0; i < this.n; i++) {
      if (cars[i].s === sAfter[i]) continue;
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
    if (this.phase === 'finishing' && (this.finishOrder.length === this.n
        || tNow - (this.leaderFinishT ?? tNow) >= this.cfg.race.finishTimeoutS)) this.phase = 'finished';

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
    return Math.max(0, this.entries[id].sim.state.timing.lap - 1);
  }

  // Progreso desde la línea de meta: lapsDone·L + distancia en la vuelta; antes de la primera vuelta, s − L.
  private progressOf(id: number): number {
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
