import { describe, expect, it } from 'vitest';
import raw from '../public/track/interlagos.json';
import { config } from '../src/shared/config';
import { maxSteerRad } from '../src/sim/car';
import { Simulation } from '../src/sim/simulation';
import type { SimEvent } from '../src/sim/types';
import { sampleAt } from '../src/track/query';
import { parseTrackJson } from '../src/track/schema';
import { makeStraightTrack } from '../src/track/synthetic';
import { buildTrack } from '../src/track/track';
import type { Track } from '../src/track/types';
import { full, holdSpeed, ms, place, runFor } from './helpers/drive';

const cfg = () => structuredClone(config);
const DEG = Math.PI / 180;

// Aceleración lateral media sostenida (último segundo) a velocidad mantenida y giro máximo a la izquierda.
function sustainedLat(track: Track, d: number, v: number) {
  const sim = new Simulation(track, cfg());
  place(sim, 3000, d, v);
  runFor(sim, 3, holdSpeed(v, -1));
  let sum = 0, n = 0;
  const surfaces = new Set<string>();
  runFor(sim, 1, holdSpeed(v, -1), (st) => { sum += Math.abs(st.car.aLat); n++; surfaces.add(st.car.surface); });
  return { aLat: sum / n, surfaces };
}

// Aceleración lateral media en una ventana corta tras girar al máximo desde el borde izquierdo.
function shortWindowLat(track: Track, d: number, v: number) {
  const c = cfg();
  const sim = new Simulation(track, c);
  place(sim, 3000, d, v, -2 * DEG);
  sim.state.car.steerAngle = -maxSteerRad(v, c);
  let sum = 0, n = 0;
  const surfaces = new Set<string>();
  runFor(sim, 0.4, holdSpeed(v, -1), (st) => {
    if (st.t > 0.3) { sum += Math.abs(st.car.aLat); n++; surfaces.add(st.car.surface); }
  });
  return { aLat: sum / n, surfaces };
}

describe('Superficies', () => {
  it('giro en hierba: 35–55 % del de asfalto a 100 km/h', () => {
    const asphalt = sustainedLat(makeStraightTrack({ lengthM: 6000, halfWidthM: 400 }), -150, ms(100));
    const grass = sustainedLat(makeStraightTrack({ lengthM: 6000, halfWidthM: 1, runoffM: 600 }), 150, ms(100));
    expect([...asphalt.surfaces]).toEqual(['asphalt']);
    expect([...grass.surfaces]).toEqual(['grass']);
    const ratio = grass.aLat / asphalt.aLat;
    expect(ratio).toBeGreaterThanOrEqual(0.35);
    expect(ratio).toBeLessThanOrEqual(0.55);
  });

  it('la hierba frena al menos el doble que el asfalto', () => {
    const lost = (track: Track, d: number) => {
      const sim = new Simulation(track, cfg());
      place(sim, 1000, d, ms(60));
      runFor(sim, 2, full());
      expect(sim.state.car.surface).toBe(d === 0 ? 'asphalt' : 'grass');
      return ms(60) - sim.state.car.speed;
    };
    const asphalt = lost(makeStraightTrack({ lengthM: 3000, halfWidthM: 8 }), 0);
    const grass = lost(makeStraightTrack({ lengthM: 3000, halfWidthM: 1, runoffM: 50 }), 20);
    expect(grass).toBeGreaterThanOrEqual(2 * asphalt);
  });

  it('piano: 80–90 % del agarre lateral del asfalto a 100 km/h', () => {
    const kerbTrack = makeStraightTrack({ lengthM: 6000, halfWidthM: 6 });
    kerbTrack.kerbL.fill(1);
    const kerb = shortWindowLat(kerbTrack, 6.05, ms(100));
    const asphalt = shortWindowLat(makeStraightTrack({ lengthM: 6000, halfWidthM: 400 }), 0, ms(100));
    expect([...kerb.surfaces]).toEqual(['kerb']);
    const ratio = kerb.aLat / asphalt.aLat;
    expect(ratio).toBeGreaterThanOrEqual(0.8);
    expect(ratio).toBeLessThanOrEqual(0.9);
  });
});

describe('Muros', () => {
  const track = () => makeStraightTrack({ lengthM: 3000, halfWidthM: 6, runoffM: 18 });

  it('impacto lateral a 150 km/h con 20°', () => {
    const t = track();
    const sim = new Simulation(t, cfg());
    place(sim, 500, 15, ms(150), 20 * DEG);
    const wall = t.wl[0] + t.runoff;
    let maxD = 0;
    let before = 0, after = -1;
    const events: SimEvent[] = [];
    runFor(sim, 1.5, full(), (st, ev) => {
      maxD = Math.max(maxD, Math.abs(st.car.d));
      const hit = ev.find((e) => e.type === 'wallHit');
      if (hit && after < 0) { before = (hit as { speedMs: number }).speedMs; after = st.car.speed; }
      events.push(...ev);
    });
    expect(maxD).toBeLessThanOrEqual(wall + 0.05);
    expect(events.some((e) => e.type === 'wallHit')).toBe(true);
    expect(after).toBeGreaterThanOrEqual(0);
    expect(after).toBeLessThanOrEqual(0.85 * before);
  });

  it('recuperación: se separa del muro y vuelve al asfalto', () => {
    const t = track();
    const sim = new Simulation(t, cfg());
    place(sim, 500, 15, ms(150), 20 * DEG);
    runFor(sim, 1, full());
    const dWall = sim.state.car.d;
    let minD = dWall, backOnAsphalt = false;
    runFor(sim, 4, full({ steer: 0.3, throttle: 0.5 }), (st) => {
      minD = Math.min(minD, st.car.d);
      if (st.car.surface === 'asphalt') backOnAsphalt = true;
    });
    expect(minD).toBeLessThan(dWall - 1);
    expect(backOnAsphalt).toBe(true);
  });
});

describe('Altura y eventos', () => {
  it('altura sobre la pista en Interlagos (< 0,05 m en todo paso)', () => {
    const t = buildTrack(parseTrackJson(raw));
    const sim = new Simulation(t, cfg());
    let maxErr = 0;
    runFor(sim, 90, (st) => {
      const p = sampleAt(t, st.car.s);
      const err = Math.atan2(Math.sin(st.car.yaw - p.heading), Math.cos(st.car.yaw - p.heading));
      const steer = Math.max(-1, Math.min(1, 3 * err + 0.15 * st.car.d));
      return holdSpeed(20, steer)(st);
    }, (st) => {
      maxErr = Math.max(maxErr, Math.abs(st.car.y - sampleAt(t, st.car.s).y));
    });
    expect(sim.state.car.s).toBeGreaterThan(0);
    expect(maxErr).toBeLessThan(0.05);
  });

  it('evento único de superficie al pasar de asfalto a hierba', () => {
    const sim = new Simulation(makeStraightTrack({ lengthM: 3000, halfWidthM: 6 }), cfg());
    place(sim, 500, 4, ms(100), 10 * DEG);
    const ev: SimEvent[] = [];
    runFor(sim, 1, full(), (_st, e) => ev.push(...e));
    expect(sim.state.car.surface).toBe('grass');
    const surf = ev.filter((e) => e.type === 'surface');
    expect(surf).toEqual([{ type: 'surface', surface: 'grass' }]);
  });
});
