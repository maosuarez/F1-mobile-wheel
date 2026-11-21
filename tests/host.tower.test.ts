import { describe, expect, it } from 'vitest';
import { gapText, towerModel, towerEntries } from '../src/host/race/tower';
import { resultsModel } from '../src/host/race/results';
import { RaceController } from '../src/host/race/controller';
import { TEAMS } from '../src/shared/teams';
import type { Standing } from '../src/sim/race';
import raw from '../public/track/interlagos.json';
import { parseTrackJson } from '../src/track/schema';
import { buildTrack } from '../src/track/track';

const st = (id: number, pos: number, o: Partial<Standing> = {}): Standing => ({
  id, pos, lapsDone: 1, progressM: 0, gapToLeaderS: pos === 1 ? 0 : pos * 1.5, gapAheadS: pos === 1 ? null : 1.5,
  finished: false, totalTimeS: null, bestLapS: null, ...o });

describe('torre de carrera (b14 D7)', () => {
  const rc = new RaceController(buildTrack(parseTrackJson(raw)), { mode: 'race', rivals: 9, ai: 'medium', seed: 2 });
  const entries = towerEntries(rc.session.entries);
  const others = Array.from({ length: 10 }, (_, i) => i).filter((i) => i !== rc.playerId);
  const ids = [...others.slice(0, 6), rc.playerId, ...others.slice(6)];   // el jugador, séptimo
  const standings = ids.map((id, i) => st(id, i + 1));

  it('posición, vuelta y diferencias con delante y detrás', () => {
    const m = towerModel(standings, entries, rc.playerId, 5);
    expect(m.pos).toBe('P7/10');
    expect(m.lap).toBe('V 2/5');
    expect(m.ahead).toBe('−1.5');
    expect(m.behind).toBe('+1.5');
    expect(m.rows).toHaveLength(10);
    expect(m.rows[0].gap).toBe('LÍDER');
    expect(m.rows.filter((r) => r.player)).toHaveLength(1);
    expect(m.rows[6].code).toBe('JUG');
  });
  it('líder sin coche delante, último sin coche detrás; vuelta limitada al total', () => {
    const lead = towerModel([st(rc.playerId, 1, { lapsDone: 5 }), st(0, 2)], entries, rc.playerId, 5);
    expect(lead.ahead).toBe('—');
    expect(lead.behind).toBe('+1.5');
    expect(lead.lap).toBe('V 5/5');
    expect(towerModel([st(0, 1), st(rc.playerId, 2)], entries, rc.playerId, 5).behind).toBe('—');
  });
  it('gapText', () => { expect(gapText(null, '+')).toBe('—'); expect(gapText(12.34, '+')).toBe('+12.3'); expect(gapText(0.8, '−')).toBe('−0.8'); });
  it('cada coche tiene código de 3 letras y color de su escudería', () => {
    for (const e of entries) expect(e.code).toMatch(/^[A-Z]{3}$/);
    expect(new Set(entries.map((e) => e.code)).size).toBe(10);
    expect(entries.find((e) => e.id === rc.playerId)!.color).toBe(TEAMS[0].primary);
  });
});

describe('resultados de carrera (b14 D7)', () => {
  const ents = [{ id: 0, name: 'Jugador', team: 0 }, { id: 1, name: 'Lena Voss', team: 1 }, { id: 2, name: 'Kai Brandt', team: 2 }];
  it('tiempo del ganador, diferencia, +N V y mejor vuelta más rápida', () => {
    const rows = resultsModel([
      st(1, 1, { lapsDone: 5, finished: true, totalTimeS: 400.5, bestLapS: 78.2 }),
      st(0, 2, { lapsDone: 5, finished: true, totalTimeS: 403.25, gapToLeaderS: 2.75, bestLapS: 79.9 }),
      st(2, 3, { lapsDone: 3, gapToLeaderS: null, bestLapS: null }),
    ], ents, 0, 5);
    expect(rows.map((r) => r.time)).toEqual(['6:40.500', '+2.750', '+2 V']);
    expect(rows[0].best).toBe('1:18.200');
    expect(rows.map((r) => r.bestFastest)).toEqual([true, false, false]);
    expect(rows[1].player).toBe(true);
    expect(rows[2].best).toBe('-:--.---');
    expect(rows[1].team).toBe(TEAMS[0].name);
  });
});
