import { describe, expect, it } from 'vitest';
import { config } from '../src/shared/config';
import { minCircleDistance, resolveCollisions } from '../src/sim/collision';
import type { CarHit } from '../src/sim/collision';
import { Simulation } from '../src/sim/simulation';
import { makeStraightTrack } from '../src/track/synthetic';
import { holdSpeed, ms, place } from './helpers/drive';

const track = makeStraightTrack({ lengthM: 4000, halfWidthM: 8 });

// Alcance por detrás: A a 200 km/h detrás de B a 100 km/h en la misma d.
function rearEnd(d = 0, dB = d) {
  const a = new Simulation(track, config), b = new Simulation(track, config);
  place(a, 1000, d, ms(200));
  place(b, 1030, dB, ms(100));
  const hits: CarHit[] = [];
  let minDist = Infinity, vA0 = 0, vB0 = 0, firstHit = -1;
  for (let i = 0; i < 240; i++) {
    const preA = a.state.car.speed, preB = b.state.car.speed;
    a.step(holdSpeed(ms(200))(a.state));
    b.step(holdSpeed(ms(100))(b.state));
    const h = resolveCollisions([a.state.car, b.state.car], track, config);
    if (h.length && firstHit < 0) { firstHit = i; vA0 = preA; vB0 = preB; }
    hits.push(...h);
    minDist = Math.min(minDist, minCircleDistance(a.state.car, b.state.car, config));
    if (firstHit >= 0 && i === firstHit) {
      expect(b.state.car.speed).toBeGreaterThan(vB0);
      expect(a.state.car.speed).toBeLessThan(vA0);
    }
  }
  return { a: a.state.car, b: b.state.car, hits, minDist };
}

describe('Colisiones entre coches', () => {
  it('alcance por detrás: sin interpenetración, el de delante gana velocidad, el de detrás pierde, carHit', () => {
    const r = rearEnd();
    expect(r.hits.length).toBeGreaterThanOrEqual(1);
    expect(r.hits[0]).toMatchObject({ a: 0, b: 1 });
    expect(r.hits[0].impulse).toBeGreaterThan(0);
    expect(r.minDist).toBeGreaterThanOrEqual(1.7);
    expect(r.b.s).toBeGreaterThan(r.a.s);
  });

  it('alcance desplazado lateralmente: también separa y gira', () => {
    const r = rearEnd(0, 1.2);
    expect(r.hits.length).toBeGreaterThanOrEqual(1);
    expect(r.minDist).toBeGreaterThanOrEqual(1.7);
    for (const c of [r.a, r.b]) for (const v of Object.values(c)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
  });

  it('determinista: misma entrada, mismo resultado exacto', () => {
    const r1 = rearEnd(0, 0.7), r2 = rearEnd(0, 0.7);
    expect(r2.a).toEqual(r1.a);
    expect(r2.b).toEqual(r1.b);
    expect(r2.hits).toEqual(r1.hits);
  });

  it('coches separados: sin cambios', () => {
    const a = new Simulation(track, config), b = new Simulation(track, config);
    place(a, 1000, 2.4, ms(100));
    place(b, 1000, -2.4, ms(100));
    const ca = { ...a.state.car }, cb = { ...b.state.car };
    expect(resolveCollisions([a.state.car, b.state.car], track, config)).toEqual([]);
    expect(a.state.car).toEqual(ca);
    expect(b.state.car).toEqual(cb);
  });
});
