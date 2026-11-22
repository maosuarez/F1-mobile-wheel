import { describe, expect, it } from 'vitest';
import raw from '../public/track/interlagos.json';
import spaRaw from '../public/track/spa.json';
import bahrainRaw from '../public/track/bahrain.json';
import { config } from '../src/shared/config';
import { rivalSkill } from '../src/sim/rival';
import type { AiLevel } from '../src/sim/rival';
import { parseTrackJson } from '../src/track/schema';
import { buildTrack } from '../src/track/track';
import { runAiRace } from './helpers/race';

const track = buildTrack(parseTrackJson(raw));

describe('Niveles de dificultad', () => {
  // Rival en solitario 3 vueltas por nivel (semilla fija)
  const solo = (level: AiLevel) => {
    const cfg = structuredClone(config);
    cfg.race.laps = 3;
    const r = runAiRace(track, [level], cfg, 11, 400);
    const valid = r.lapTimes[0];
    return { best: Math.min(...valid), laps: valid, wall: r.wallHits[0], off: r.offS[0] };
  };
  const res = { easy: solo('easy'), medium: solo('medium'), hard: solo('hard') };

  it('hard ≥ 1 s más rápido que medium, medium ≥ 1 s más rápido que easy, hard entre 66 y 80 s', () => {
    for (const [k, v] of Object.entries(res))
      console.info(`${k}: mejor ${v.best.toFixed(3)} s, vueltas ${v.laps.map((t) => t.toFixed(2)).join(' / ')}, muros ${v.wall}, fuera ${v.off.toFixed(2)} s`);
    expect(res.easy.laps.length).toBe(3);
    expect(res.medium.best).toBeLessThanOrEqual(res.easy.best - 1);
    expect(res.hard.best).toBeLessThanOrEqual(res.medium.best - 1);
    expect(res.hard.best).toBeGreaterThanOrEqual(66);
    expect(res.hard.best).toBeLessThanOrEqual(80);
  });

  it('habilidad sembrada dentro de los rangos del diseño y determinista', () => {
    for (const lvl of ['easy', 'medium', 'hard'] as const) {
      for (let s = 0; s < 20; s++) {
        const k = rivalSkill(lvl, s);
        expect(Math.abs(k.gripUse - config.ai.levels[lvl].gripUse)).toBeLessThanOrEqual(0.015);
        expect(Math.abs(k.brakeUse - config.ai.levels[lvl].brakeUse)).toBeLessThanOrEqual(0.015);
        expect(k.reactionS).toBeGreaterThanOrEqual(0.15); expect(k.reactionS).toBeLessThanOrEqual(0.35);
        expect(k.aggression).toBeGreaterThanOrEqual(0.3); expect(k.aggression).toBeLessThanOrEqual(0.8);
        expect(k.consistency).toBeGreaterThanOrEqual(0.85); expect(k.consistency).toBeLessThanOrEqual(0.98);
        expect(rivalSkill(lvl, s)).toEqual(k);
      }
    }
  });
});

describe('Rivales completan la carrera limpiamente', () => {
  it('10 IA en medio, 5 vueltas: todos terminan, ≤ 2 muros y ≤ 3 s fuera por coche, estados finitos', () => {
    const t0 = performance.now();
    const r = runAiRace(track, new Array(10).fill('medium'), config, 1);
    const st = r.rs.standings();
    const hits = [...r.pairHits.values()].reduce((a, b) => a + b, 0);
    console.info(`carrera 10 IA: ${((performance.now() - t0) / 1000).toFixed(1)} s reales; step ${(r.stepMs * 1000).toFixed(0)} µs, IA ${(r.aiMs * 1000).toFixed(0)} µs; `
      + `muros máx ${Math.max(...r.wallHits)}, fuera máx ${Math.max(...r.offS).toFixed(2)} s, carHit ${hits}, solape máx ${r.maxOverlapRun} pasos; `
      + `ganador ${st[0].id} en ${st[0].totalTimeS?.toFixed(2)} s, último ${st[9].totalTimeS?.toFixed(2)} s`);
    expect(r.rs.phase).toBe('finished');
    expect(st.every((s) => s.finished)).toBe(true);
    expect(Math.max(...r.wallHits)).toBeLessThanOrEqual(2);
    expect(Math.max(...r.offS)).toBeLessThanOrEqual(3);
    expect(r.nonFinite).toBe(false);
    expect(r.maxOverlapRun).toBeLessThanOrEqual(1);
    expect(r.stepMs).toBeLessThan(1);
  }, 120_000);
});

describe('Tráfico y adelantamientos', () => {
  it('hard que sale detrás de easy lo adelanta antes de 5 vueltas con ≤ 2 carHit entre ambos', () => {
    // Plaza 0 easy, plaza 1 hard (8 m detrás) que además sale 1 s tarde; primera vez que el hard pasa por delante
    let passedAtLap: number | null = null, gapLap1: number | null = null;
    const r = runAiRace(track, ['easy', 'hard'], config, 2, 900, (rs) => {
      if (gapLap1 === null && rs.lapsDone(1) >= 1) gapLap1 = rs.gapAheadOf(1);
      if (passedAtLap === null && rs.phase === 'green' && rs.standings()[0].id === 1) passedAtLap = rs.lapsDone(1) + 1;
    }, [0, 1]);
    const hits = r.pairHits.get('0-1') ?? 0;
    console.info(`diferencia inicial ${gapLap1} s, adelantamiento en la vuelta ${passedAtLap}, cambios de orden ${r.leadChanges(0, 1)}, carHit ${hits}`);
    expect(passedAtLap).not.toBeNull();
    expect(passedAtLap!).toBeLessThanOrEqual(5);
    expect(hits).toBeLessThanOrEqual(2);
  }, 60_000);

  it('tráfico mixto (3 easy, 4 medium, 3 hard intercalados), 5 semillas: ≤ 15 carHit, ≤ 2 muros y ≤ 3 s fuera por coche', () => {
    const grid: AiLevel[] = ['easy', 'hard', 'medium', 'easy', 'hard', 'medium', 'easy', 'medium', 'hard', 'medium'];
    const rows = [1, 2, 3, 4, 5].map((seed) => {
      const r = runAiRace(track, grid, config, seed);
      const hits = [...r.pairHits.values()].reduce((a, b) => a + b, 0);
      let changes = 0;
      for (let a = 0; a < 10; a++) for (let b = a + 1; b < 10; b++) changes += r.leadChanges(a, b);
      return { seed, hits, wall: Math.max(...r.wallHits), off: Math.max(...r.offS), fin: r.rs.standings().every((x) => x.finished), changes, run: r.maxOverlapRun };
    });
    for (const x of rows) console.info(`mixto semilla ${x.seed}: carHit ${x.hits}, muros máx ${x.wall}, fuera máx ${x.off.toFixed(2)} s, cambios de orden ${x.changes}, solape máx ${x.run}`);
    for (const x of rows) {
      expect(x.fin).toBe(true);
      expect(x.hits).toBeLessThanOrEqual(15);
      expect(x.wall).toBeLessThanOrEqual(2);
      expect(x.off).toBeLessThanOrEqual(3);
      expect(x.run).toBeLessThanOrEqual(1);
    }
  }, 300_000);

  it('determinista: misma carrera, misma clasificación y tiempos', () => {
    const run = () => {
      const cfg = structuredClone(config);
      cfg.race.laps = 2;
      return runAiRace(track, ['hard', 'medium', 'easy', 'medium'], cfg, 5).rs.standings();
    };
    expect(run()).toEqual(run());
  }, 60_000);
});

describe('Rivales en Spa', () => {
  it('10 IA en medio, 5 vueltas: todos terminan', () => {
    const spa = buildTrack(parseTrackJson(spaRaw));
    const r = runAiRace(spa, new Array(10).fill('medium'), config, 1);
    const st = r.rs.standings();
    console.info(`Spa 10 IA: muros máx ${Math.max(...r.wallHits)}, fuera máx ${Math.max(...r.offS).toFixed(2)} s, `
      + `ganador ${st[0].id} en ${st[0].totalTimeS?.toFixed(2)} s, último ${st[9].totalTimeS?.toFixed(2)} s, mejor vuelta ${Math.min(...r.lapTimes.flat()).toFixed(2)} s`);
    expect(r.rs.phase).toBe('finished');
    expect(st.every((s) => s.finished)).toBe(true);
    expect(r.nonFinite).toBe(false);
  }, 180_000);
});

describe('Rivales en Bahréin', () => {
  it('10 IA en medio, 5 vueltas: todos terminan', () => {
    const bh = buildTrack(parseTrackJson(bahrainRaw));
    const r = runAiRace(bh, new Array(10).fill('medium'), config, 1);
    const st = r.rs.standings();
    console.info(`Bahréin 10 IA: muros máx ${Math.max(...r.wallHits)}, fuera máx ${Math.max(...r.offS).toFixed(2)} s, `
      + `ganador ${st[0].id} en ${st[0].totalTimeS?.toFixed(2)} s, último ${st[9].totalTimeS?.toFixed(2)} s, mejor vuelta ${Math.min(...r.lapTimes.flat()).toFixed(2)} s`);
    expect(r.rs.phase).toBe('finished');
    expect(st.every((s) => s.finished)).toBe(true);
    expect(r.nonFinite).toBe(false);
  }, 180_000);
});
