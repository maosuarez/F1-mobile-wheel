import { describe, expect, it } from 'vitest';
import raw from '../public/track/interlagos.json';
import { config } from '../src/shared/config';
import { minCircleDistance } from '../src/sim/collision';
import { RaceSession } from '../src/sim/race';
import type { RaceEvent, Standing } from '../src/sim/race';
import { deltaS } from '../src/track/query';
import { parseTrackJson } from '../src/track/schema';
import { makeOvalTrack } from '../src/track/synthetic';
import { buildTrack } from '../src/track/track';
import type { Track } from '../src/track/types';
import { laneInput } from './helpers/race';

const track = buildTrack(parseTrackJson(raw));
const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `C${i}`, team: i >> 1, isAi: true }));

// Avanza la sesión hasta el apagado de las luces.
function toGreen(rs: RaceSession): void {
  rs.startLights();
  for (let i = 0; i < 2000 && rs.phase === 'lights'; i++) rs.step([], []);
}

// Comprueba la coherencia de la clasificación.
function checkStandings(st: Standing[], finishOrder: number[]): void {
  expect(st.map((s) => s.pos)).toEqual(st.map((_, i) => i + 1));
  expect(new Set(st.map((s) => s.id)).size).toBe(st.length);
  const fin = st.filter((s) => s.finished);
  expect(fin.map((s) => s.id)).toEqual(finishOrder);
  expect(st.slice(0, fin.length).every((s) => s.finished)).toBe(true);
  const rest = st.slice(fin.length);
  for (let i = 1; i < rest.length; i++) expect(rest[i - 1].progressM).toBeGreaterThanOrEqual(rest[i].progressM);
}

describe('Parrilla escalonada', () => {
  it('10 coches en sus cajones, lado alterno, parados y sin solaparse', () => {
    const rs = new RaceSession(track, entries(10));
    const cars = rs.entries.map((e) => e.sim.state.car);
    cars.forEach((c, k) => {
      expect(Math.abs(deltaS(track, track.startS - 20 - 8 * k, c.s))).toBeLessThanOrEqual(0.5);
      expect(Math.abs(Math.abs(c.d) - 2.4)).toBeLessThanOrEqual(0.2);
      expect(Math.sign(c.d)).toBe(k % 2 === 0 ? 1 : -1);
      expect(c.speed).toBe(0);
      expect(rs.entries[k].sim.state.timing.lap).toBe(0);
    });
    for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++)
      expect(minCircleDistance(cars[i], cars[j], config)).toBeGreaterThan(2 * config.race.carRadiusM);
  });
});

describe('Semáforo de salida', () => {
  it('1..5 luces a 1 s, apagado entre 4,2 y 7,0 s y nadie se mueve antes', () => {
    const rs = new RaceSession(track, entries(10), config, 7);
    const pos0 = rs.entries.map((e) => [e.sim.state.car.x, e.sim.state.car.z]);
    rs.startLights();
    const dt = config.sim.dt;
    let t = 0, outAt: number | null = null;
    const full = () => rs.entries.map(() => ({ steer: 0, throttle: 1, brake: 0, ers: false }));
    while (outAt === null && t < 10) {
      const ev = rs.step(full(), []);
      t += dt;
      if (ev.some((e) => e.type === 'lightsOut')) outAt = t;
      else {
        expect(rs.lightsOn).toBe(Math.min(5, 1 + Math.floor(t + 1e-9)));
        rs.entries.forEach((e, i) => { expect(e.sim.state.car.x).toBe(pos0[i][0]); expect(e.sim.state.car.z).toBe(pos0[i][1]); });
      }
    }
    expect(outAt).not.toBeNull();
    expect(outAt!).toBeGreaterThanOrEqual(4.2 - dt);
    expect(outAt!).toBeLessThanOrEqual(7.0 + dt);
    expect(rs.phase).toBe('green');
    expect(rs.lightsOn).toBe(0);
    rs.step(full(), []);
    expect(rs.entries[0].sim.state.car.speed).toBeGreaterThan(0);
  });

  it('misma semilla, mismo apagado; otra semilla lo cambia', () => {
    const a = new RaceSession(track, entries(2), config, 42).lightsOutAtS;
    const b = new RaceSession(track, entries(2), config, 42).lightsOutAtS;
    const c = new RaceSession(track, entries(2), config, 43).lightsOutAtS;
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});

// Carrera en el óvalo con conductores de carril a velocidades distintas.
function ovalRace(laps: number, speeds: number[], lanes: number[], maxS = 600) {
  const cfg = structuredClone(config);
  cfg.race.laps = laps;
  const oval: Track = makeOvalTrack({ halfWidthM: 8 });
  const rs = new RaceSession(oval, entries(speeds.length), cfg, 3);
  toGreen(rs);
  const finishOrder: number[] = [];
  const events: RaceEvent[] = [];
  const phases: string[] = [];
  for (let i = 0; i < maxS / cfg.sim.dt && rs.phase !== 'finished'; i++) {
    const inputs = rs.entries.map((e, k) => laneInput(e.sim, lanes[k], speeds[k]));
    const ev = rs.step(inputs, []);
    for (const e of ev) { events.push(e); if (e.type === 'finish') finishOrder.push(e.car); }
    if (phases[phases.length - 1] !== rs.phase) phases.push(rs.phase);
    if (i % 12 === 0) checkStandings(rs.standings(), finishOrder);
  }
  return { rs, finishOrder, events, phases };
}

describe('Carrera y clasificación', () => {
  it('final: finishing al completar el líder, cada coche termina al cruzar la meta y luego finished', () => {
    const { rs, finishOrder, events, phases } = ovalRace(2, [42, 38, 34], [3, 0, -3]);
    expect(phases).toEqual(['green', 'finishing', 'finished']);
    expect(finishOrder).toEqual([0, 1, 2]);
    const st = rs.standings();
    checkStandings(st, finishOrder);
    expect(st.every((s) => s.finished && s.lapsDone >= 2)).toBe(true);
    expect(st[0].gapToLeaderS).toBe(0);
    expect(st[1].gapToLeaderS!).toBeGreaterThan(0);
    expect(st[2].gapAheadS!).toBeCloseTo(st[2].totalTimeS! - st[1].totalTimeS!, 9);
    expect(events.filter((e) => e.type === 'finish').map((e) => (e as { pos: number }).pos)).toEqual([1, 2, 3]);
    expect(st.every((s) => s.bestLapS !== null)).toBe(true);
  });

  it('final por tiempo: 60 s después del líder aunque un coche no termine', () => {
    const { rs, finishOrder, phases } = ovalRace(1, [42, 0], [3, -3]);
    expect(phases[phases.length - 1]).toBe('finished');
    expect(finishOrder).toEqual([0]);
    const st = rs.standings();
    expect(st[1].finished).toBe(false);
    expect(st[1].totalTimeS).toBeNull();
    const leaderT = st[0].totalTimeS!;
    expect(rs.raceTimeS - leaderT).toBeGreaterThanOrEqual(config.race.finishTimeoutS - 0.02);
    expect(rs.raceTimeS - leaderT).toBeLessThanOrEqual(config.race.finishTimeoutS + 0.02);
  });

  it('diferencias en vivo: el de detrás va por detrás en tiempo', () => {
    const cfg = structuredClone(config);
    const oval = makeOvalTrack({ halfWidthM: 8 });
    const rs = new RaceSession(oval, entries(2), cfg, 3);
    toGreen(rs);
    for (let i = 0; i < 40 / cfg.sim.dt; i++) rs.step(rs.entries.map((e, k) => laneInput(e.sim, k ? -3 : 3, k ? 35 : 40)), []);
    const st = rs.standings();
    expect(st[0].id).toBe(0);
    expect(st[1].gapAheadS!).toBeGreaterThan(0.5);
    expect(st[1].gapAheadS).toBe(st[1].gapToLeaderS);
  });
});

describe('Rendimiento de la simulación multicoche', () => {
  it('10 coches durante 60 s simulados: coste medio de step < 1 ms', () => {
    const rs = new RaceSession(track, entries(10), config, 5);
    toGreen(rs);
    const steps = Math.round(60 / config.sim.dt);
    let spent = 0;
    for (let i = 0; i < steps; i++) {
      const inputs = rs.entries.map((e) => laneInput(e.sim, e.sim.state.car.d > 0 ? 2.4 : -2.4, 25));
      const t0 = performance.now();
      rs.step(inputs, []);
      spent += performance.now() - t0;
      if (i % 120 === 0) rs.standings();
    }
    const avg = spent / steps;
    console.info(`coste medio RaceSession.step (10 coches): ${(avg * 1000).toFixed(1)} µs`);
    for (const e of rs.entries) for (const v of Object.values(e.sim.state.car)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    expect(avg).toBeLessThan(1);
  });
});
