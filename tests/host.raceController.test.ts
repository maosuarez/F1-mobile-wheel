import { describe, expect, it } from 'vitest';
import raw from '../public/track/interlagos.json';
import { config } from '../src/shared/config';
import { RaceController, parseRaceOptions } from '../src/host/race/controller';
import { towerEntries } from '../src/host/race/tower';
import { Simulation } from '../src/sim/simulation';
import { parseTrackJson } from '../src/track/schema';
import { buildTrack } from '../src/track/track';

const track = buildTrack(parseTrackJson(raw));
const q = (s: string) => new URLSearchParams(s);
const full = { steer: 0, throttle: 1, brake: 0, ers: false };
const NEUTRAL = { steer: 0, throttle: 0, brake: 0, ers: false };

describe('Controlador de carrera del host (b14 D7)', () => {
  it('opciones por URL: modo, rivales 1–9 y nivel; sin modo → null (decide el menú)', () => {
    expect(parseRaceOptions(q(''))).toBeNull();
    expect(parseRaceOptions(q('mode=race&rivals=5&ai=hard&seed=7'))).toEqual({ mode: 'race', rivals: 5, ai: 'hard', seed: 7 });
    const o = parseRaceOptions(q('mode=race&rivals=40&ai=xx'))!;
    expect(o.rivals).toBe(9);
    expect(o.ai).toBe('medium');
    expect(parseRaceOptions(q('mode=practice'))!.rivals).toBe(config.race.defaultRivals);
  });

  it('práctica idéntica a un Simulation suelto: misma parrilla (d = 0), sin semáforo y mismos estados', () => {
    const rc = new RaceController(track, { mode: 'practice', rivals: 9, ai: 'medium', seed: 1 });
    const ref = new Simulation(track);
    expect(rc.rivals()).toHaveLength(0);
    expect(rc.playerSim.state.car.d).toBeCloseTo(ref.state.car.d, 9);
    expect(rc.playerSim.state.car.s).toBeCloseTo(ref.state.car.s, 9);
    for (let i = 0; i < 600; i++) {
      const ev = rc.step(full, []);
      const evRef = ref.step(full, []);
      expect(rc.playerEvents(ev)).toEqual(evRef);
    }
    expect(rc.playerSim.state.car.x).toBe(ref.state.car.x);
    expect(rc.playerSim.state.car.speed).toBe(ref.state.car.speed);
    expect(rc.finished).toBe(false);
  });

  it('carrera: rivales + jugador en la plaza playerGridSlot, semáforo y rivales con pose', () => {
    const rc = new RaceController(track, { mode: 'race', rivals: 9, ai: 'medium', seed: 3 });
    expect(rc.session.entries).toHaveLength(10);
    expect(rc.playerId).toBe(config.race.playerGridSlot);
    expect(rc.session.entries[rc.playerId].isAi).toBe(false);
    expect(rc.rivals()).toHaveLength(9);
    expect(new Set(rc.session.entries.map((e) => e.name)).size).toBe(10);
    expect(rc.phase).toBe('grid');
    rc.startLights();
    let lightsOut = false;
    for (let i = 0; i < 9 / config.sim.dt && !lightsOut; i++) lightsOut = rc.step(full, []).some((e) => e.type === 'lightsOut');
    expect(lightsOut).toBe(true);
    for (let i = 0; i < 240; i++) rc.step(full, []);
    expect(rc.playerSim.state.car.speed).toBeGreaterThan(5);
    const moving = rc.rivals().filter((v) => v.speed > 5);
    expect(moving.length).toBe(9);
    for (const v of rc.rivals()) for (const n of [v.cur.x, v.cur.z, v.prev.x, v.prev.z]) expect(Number.isFinite(n)).toBe(true);
    expect(rc.playerPos()).toBeGreaterThanOrEqual(1);
  });

  it('pocos rivales: el jugador sale último si hay menos plazas que playerGridSlot', () => {
    const rc = new RaceController(track, { mode: 'race', rivals: 3, ai: 'easy', seed: 1 });
    expect(rc.session.entries).toHaveLength(4);
    expect(rc.playerId).toBe(3);
  });
  it('2 jugadores (b15): 10 coches con rivals=8, humanos en cajones contiguos y cada uno con su entrada', () => {
    const rc = new RaceController(track, { mode: 'race', rivals: 8, ai: 'medium', seed: 5 }, config, 2);
    expect(rc.session.entries).toHaveLength(10);
    expect(rc.humanIds).toEqual([config.race.playerGridSlot, config.race.playerGridSlot + 1]);
    expect(rc.humanIds.map((id) => rc.session.entries[id].isAi)).toEqual([false, false]);
    expect(rc.rivals()).toHaveLength(8);
    expect(rc.humanIds.map((id) => rc.session.entries[id].name)).toEqual(['Jugador', 'Jugador 2']);
    expect(towerEntries(rc.session.entries).filter((t) => rc.humanIds.includes(t.id)).map((t) => t.code)).toEqual(['JUG', 'JG2']);
    expect(rc.humanSims[0]).toBe(rc.playerSim);
    expect(new RaceController(track, { mode: 'race', rivals: 9, ai: 'medium', seed: 5 }, config, 2).session.entries).toHaveLength(10);
    rc.startLights();
    let out = false;
    for (let i = 0; i < 9 / config.sim.dt && !out; i++) out = rc.stepHumans([full, NEUTRAL], [[], []]).some((e) => e.type === 'lightsOut');
    expect(out).toBe(true);
    for (let i = 0; i < 240; i++) rc.stepHumans([full, NEUTRAL], [[], []]);
    expect(rc.humanSims[0].state.car.speed).toBeGreaterThan(5);
    expect(rc.humanSims[1].state.car.speed).toBeLessThan(1);
    expect(rc.playerPos(1)).toBeGreaterThanOrEqual(1);
  });

  it('práctica a 2: plazas 0 y 1 de la parrilla, en verde y sin rivales', () => {
    const rc = new RaceController(track, { mode: 'practice', rivals: 9, ai: 'medium', seed: 1 }, config, 2);
    expect(rc.session.entries).toHaveLength(2);
    expect(rc.rivals()).toHaveLength(0);
    expect(rc.phase).toBe('green');
    const [a, b] = rc.humanSims.map((s) => s.state.car);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1);
  });
});
