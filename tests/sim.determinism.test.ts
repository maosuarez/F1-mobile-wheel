import { describe, expect, it } from 'vitest';
import raw from '../public/track/interlagos.json';
import { config } from '../src/shared/config';
import { Simulation } from '../src/sim/simulation';
import type { DriverInput } from '../src/sim/types';
import { parseTrackJson } from '../src/track/schema';
import { buildTrack } from '../src/track/track';

const track = buildTrack(parseTrackJson(raw));

// PRNG sembrado (mulberry32) propio del test.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Secuencia de entradas variadas: tramos de 0,5 s con acelerador, freno y dirección aleatorios.
function inputs(seed: number, steps: number): DriverInput[] {
  const rnd = mulberry32(seed);
  const out: DriverInput[] = [];
  let cur: DriverInput = { steer: 0, throttle: 1, brake: 0, ers: false };
  for (let i = 0; i < steps; i++) {
    if (i % 60 === 0) {
      const braking = rnd() < 0.25;
      cur = { steer: rnd() * 2 - 1, throttle: braking ? 0 : rnd(), brake: braking ? rnd() : 0, ers: rnd() < 0.5 };
    }
    out.push(cur);
  }
  return out;
}

function run(seq: DriverInput[]) {
  const sim = new Simulation(track, structuredClone(config));
  let wallHits = 0;
  let offTrack = 0;
  let allFinite = true;
  for (const inp of seq) {
    const ev = sim.step(inp);
    wallHits += ev.filter((e) => e.type === 'wallHit').length;
    if (sim.state.car.surface === 'grass') offTrack++;
    for (const v of Object.values(sim.state.car)) {
      if (typeof v === 'number' && !Number.isFinite(v)) allFinite = false;
    }
    for (const v of Object.values(sim.state.timing)) {
      if (typeof v === 'number' && !Number.isFinite(v)) allFinite = false;
    }
  }
  return { state: sim.state, wallHits, offTrack, allFinite };
}

describe('Simulación determinista a paso fijo', () => {
  it('repetición idéntica de 6 000 pasos', () => {
    const seq = inputs(1234, 6000);
    const a = run(seq);
    const b = run(seq);
    expect(a.state.stepCount).toBe(6000);
    expect(a.state.t).toBe(6000 * config.sim.dt);
    expect(b.state).toStrictEqual(a.state);
    for (const [k, v] of Object.entries(a.state.car)) {
      expect(Object.is((b.state.car as unknown as Record<string, unknown>)[k], v)).toBe(true);
    }
  });

  it('estado siempre finito en 20 000 pasos con salidas de pista y muros', () => {
    const r = run(inputs(98765, 20000));
    expect(r.allFinite).toBe(true);
    expect(r.offTrack).toBeGreaterThan(0);
    expect(r.wallHits).toBeGreaterThan(0);
  });
});

describe('aislamiento de src/sim', () => {
  it('no importa de render, audio ni host', () => {
    const files = (import.meta as unknown as { glob: (p: string, o: object) => Record<string, string> })
      .glob('../src/sim/**/*.ts', { query: '?raw', import: 'default', eager: true });
    const names = Object.keys(files);
    expect(names.length).toBeGreaterThan(0);
    const bad = /(?:^|\s)(?:import|export)\b[^;]*?\bfrom\s*['"][^'"]*\/(?:render|audio|host)(?:\/|['"])|^\s*import\s*['"][^'"]*\/(?:render|audio|host)(?:\/|['"])/m;
    for (const n of names) expect(bad.test(files[n]), n).toBe(false);
  });
});
