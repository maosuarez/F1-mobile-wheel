import { describe, expect, it } from 'vitest';
import raw from '../public/track/interlagos.json';
import { config } from '../src/shared/config';
import { Autopilot } from '../src/sim/autopilot';
import { Simulation } from '../src/sim/simulation';
import type { DriverCommand, DriverInput } from '../src/sim/types';
import { NEUTRAL_INPUT } from '../src/sim/types';
import { parseTrackJson } from '../src/track/schema';
import { buildTrack } from '../src/track/track';

const track = buildTrack(parseTrackJson(raw));

// Conduce con el piloto de referencia hasta completar 2 vueltas (máx. 400 s), con `delaySteps` de latencia.
function drive(delaySteps = 0) {
  const cfg = structuredClone(config);
  const sim = new Simulation(track, cfg);
  const pilot = new Autopilot(track, cfg);
  const queue: { input: DriverInput; commands: DriverCommand[] }[] =
    Array.from({ length: delaySteps }, () => ({ input: NEUTRAL_INPUT, commands: [] }));
  const laps: number[] = [];
  let wallHits = 0, grass = 0, maxSpeed = 0, grassAtS: number | null = null;
  let drsOpens = 0, maxGear = 0;   // en la vuelta lanzada (2.ª)
  const maxSteps = Math.round(400 / cfg.sim.dt);
  for (let i = 0; i < maxSteps && laps.length < 2; i++) {
    queue.push(pilot.update(sim.state));
    const { input, commands } = queue.shift()!;
    const ev = sim.step(input, commands);
    const lap2 = sim.state.timing.lap === 2;
    for (const e of ev) {
      if (e.type === 'wallHit') wallHits++;
      if (e.type === 'lapEnd') laps.push(e.timeS);
      if (e.type === 'drs' && e.open && lap2) drsOpens++;
    }
    if (lap2) maxGear = Math.max(maxGear, sim.state.car.gear);
    if (sim.state.car.surface === 'grass') { grass++; grassAtS ??= sim.state.car.s; }
    maxSpeed = Math.max(maxSpeed, sim.state.car.speed);
  }
  return { laps, wallHits, grass, grassAtS, maxSpeed, drsOpens, maxGear };
}

describe('Piloto de referencia en Interlagos', () => {
  const r = drive();

  it('dos vueltas sin muros ni hierba', () => {
    console.info(`vueltas ${r.laps.map((t) => t.toFixed(3)).join(' / ')} s, vmax ${(r.maxSpeed * 3.6).toFixed(1)} km/h, hierba en s=${r.grassAtS}`);
    expect(r.wallHits).toBe(0);
    expect(r.grass).toBe(0);
    expect(r.laps.length).toBe(2);
  });

  it('vuelta lanzada entre 62 y 105 s', () => {
    expect(r.laps[1]).toBeGreaterThanOrEqual(62);
    expect(r.laps[1]).toBeLessThanOrEqual(105);
  });

  it('vuelta lanzada: el DRS se abre al menos una vez y se llega a 7.ª o más', () => {
    console.info(`DRS abierto ${r.drsOpens} veces, marcha máxima ${r.maxGear}`);
    expect(r.drsOpens).toBeGreaterThanOrEqual(1);
    expect(r.maxGear).toBeGreaterThanOrEqual(7);
  });

  it('suggestedGear coincide con la marcha del automático', () => {
    const cfg = structuredClone(config);
    const sim = new Simulation(track, cfg);
    const pilot = new Autopilot(track, cfg);
    let match = 0, n = 0;
    for (let i = 0; i < Math.round(40 / cfg.sim.dt); i++) {
      const { input, commands } = pilot.update(sim.state);
      sim.step(input, commands);
      if (sim.state.car.shiftCutS === 0) { n++; if (pilot.suggestedGear(sim.state) === sim.state.car.gear) match++; }
    }
    expect(match / n).toBeGreaterThan(0.95);
  });

  it('robustez ante 100 ms de latencia', () => {
    const d = drive(12);
    console.info(`con latencia: vueltas ${d.laps.map((t) => t.toFixed(3)).join(' / ')} s, muros ${d.wallHits}, hierba en s=${d.grassAtS}`);
    expect(d.wallHits).toBe(0);
    expect(d.laps.length).toBe(2);
  });

  it('determinismo: tiempos idénticos en dos ejecuciones', () => {
    const d = drive();
    expect(d.laps).toEqual(r.laps);
  });
});
