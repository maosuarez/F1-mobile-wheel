import type { GameConfig } from '../../src/shared/config';
import { RaceSession } from '../../src/sim/race';
import type { RaceEvent } from '../../src/sim/race';
import { RivalDriver, rivalSkill } from '../../src/sim/rival';
import type { AiLevel, CarSnapshot } from '../../src/sim/rival';
import type { Track } from '../../src/track/types';
import { maxSteerRad } from '../../src/sim/car';
import type { Simulation } from '../../src/sim/simulation';
import type { DriverInput } from '../../src/sim/types';
import { sampleAt } from '../../src/track/query';

// Conductor de carril para tests: persecución pura hacia la línea desplazada a d y control proporcional de velocidad.
export function laneInput(sim: Simulation, d: number, vTarget: number): DriverInput {
  const car = sim.state.car;
  const p = sampleAt(sim.track, car.s + 8 + 0.35 * car.speed);
  const dx = p.x + d * p.nx - car.x, dz = p.z + d * p.nz - car.z;
  const ahead = dx * Math.cos(car.yaw) - dz * Math.sin(car.yaw);
  const left = -dx * Math.sin(car.yaw) - dz * Math.cos(car.yaw);
  const delta = Math.atan(2 * sim.cfg.car.wheelbaseM * left / Math.max(ahead * ahead + left * left, 1e-6));
  const steer = Math.max(-1, Math.min(1, -delta / maxSteerRad(car.speed, sim.cfg)));
  const err = vTarget - car.speed;
  return { steer, throttle: err > 0 ? Math.min(1, err * 0.25) : 0, brake: err < 0 ? Math.min(1, -err * 0.35) : 0, ers: false };
}


export interface AiRaceResult {
  rs: RaceSession; wallHits: number[]; offS: number[]; pairHits: Map<string, number>; events: RaceEvent[];
  stepMs: number; aiMs: number; overlapSteps: number; maxOverlapRun: number; leadChanges: (a: number, b: number) => number;
  lapTimes: number[][]; nonFinite: boolean;
}

// Carrera solo con IA: un RivalDriver por coche (plaza = índice). maxS: tiempo simulado máximo tras el apagado.
// holdS[k]: segundos que el coche k espera frenado tras el apagado (salida retrasada).
export function runAiRace(track: Track, levels: AiLevel[], cfg: GameConfig, seed = 1, maxS = 900,
                          onStep?: (rs: RaceSession, drivers: RivalDriver[]) => void, holdS: number[] = []): AiRaceResult {
  const n = levels.length;
  const rs = new RaceSession(track, levels.map((_, i) => ({ name: `IA${i}`, team: i >> 1, isAi: true })), cfg, seed);
  const drivers = levels.map((l, i) => new RivalDriver(track, rivalSkill(l, seed * 101 + i, cfg), seed * 977 + i, cfg));
  rs.startLights();
  const wallHits = new Array(n).fill(0), offS = new Array(n).fill(0);
  const pairHits = new Map<string, number>();
  const events: RaceEvent[] = [];
  const lapTimes: number[][] = levels.map(() => []);
  const before: number[] = [];   // posición relativa por pares para contar cambios de orden
  const changes = new Map<string, number>();
  let stepMs = 0, aiMs = 0, steps = 0, overlapSteps = 0, run = 0, maxOverlapRun = 0, nonFinite = false;
  const dt = cfg.sim.dt, r2 = 2 * cfg.race.carRadiusM;
  for (let i = 0; i < (maxS + 10) / dt && rs.phase !== 'finished'; i++) {
    const t0 = performance.now();
    const snaps: CarSnapshot[] = rs.entries.map((e) => ({ id: e.id, s: e.sim.state.car.s, d: e.sim.state.car.d, speed: e.sim.state.car.speed, lapsDone: rs.lapsDone(e.id) }));
    const out = drivers.map((d, k) => d.read(rs.entries[k].sim.state, snaps.filter((o) => o.id !== k), { phase: rs.phase, gapAheadS: rs.gapAheadOf(k) }));
    rs.entries.forEach((_, k) => {
      if (rs.phase === 'green' && rs.raceTimeS < (holdS[k] ?? 0)) out[k] = { input: { steer: 0, throttle: 0, brake: 1, ers: false }, commands: [] };
    });
    const t1 = performance.now();
    const ev = rs.step(out.map((o) => o.input), out.map((o) => o.commands));
    const t2 = performance.now();
    if (rs.phase !== 'lights') { aiMs += t1 - t0; stepMs += t2 - t1; steps++; }
    for (const e of ev) {
      events.push(e);
      if (e.type === 'wallHit') wallHits[e.car]++;
      if (e.type === 'lapEnd') lapTimes[e.car].push(e.timeS);
      if (e.type === 'carHit') { const key = `${e.a}-${e.b}`; pairHits.set(key, (pairHits.get(key) ?? 0) + 1); }
    }
    let overl = false;
    rs.entries.forEach((e, k) => {
      const c = e.sim.state.car;
      if (c.surface === 'grass' || c.surface === 'gravel') offS[k] += dt;
      for (const v of [c.x, c.z, c.speed, c.yaw, c.s, c.d]) if (!Number.isFinite(v)) nonFinite = true;
      for (let j = k + 1; j < n; j++) {
        const o = rs.entries[j].sim.state.car;
        if (Math.hypot(o.x - c.x, o.z - c.z) < 6 && minCircle(c, o, cfg) < r2 - 1e-6) overl = true;
      }
    });
    if (overl) { overlapSteps++; run++; maxOverlapRun = Math.max(maxOverlapRun, run); } else run = 0;
    if (rs.phase === 'green' || rs.phase === 'finishing') {
      const st = rs.standings();
      const pos: number[] = [];
      for (const s of st) pos[s.id] = s.pos;
      if (before.length) for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++)
        if (Math.sign(pos[a] - pos[b]) !== Math.sign(before[a] - before[b])) changes.set(`${a}-${b}`, (changes.get(`${a}-${b}`) ?? 0) + 1);
      pos.forEach((p, k) => { before[k] = p; });
    }
    onStep?.(rs, drivers);
  }
  return { rs, wallHits, offS, pairHits, events, stepMs: stepMs / steps, aiMs: aiMs / steps, overlapSteps, maxOverlapRun,
    leadChanges: (a, b) => changes.get(`${Math.min(a, b)}-${Math.max(a, b)}`) ?? 0, lapTimes, nonFinite };
}

function minCircle(a: { x: number; z: number; yaw: number }, b: { x: number; z: number; yaw: number }, cfg: GameConfig): number {
  const h = cfg.race.carHalfLenM;
  let m = Infinity;
  for (let i = -1; i <= 1; i += 2) for (let j = -1; j <= 1; j += 2)
    m = Math.min(m, Math.hypot(b.x + j * Math.cos(b.yaw) * h - a.x - i * Math.cos(a.yaw) * h, b.z - j * Math.sin(b.yaw) * h - a.z + i * Math.sin(a.yaw) * h));
  return m;
}
