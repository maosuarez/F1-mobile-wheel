import { describe, expect, it } from 'vitest';
import raw from '../public/track/interlagos.json';
import { config } from '../src/shared/config';
import type { NetCfg } from '../src/shared/protocol';
import { driverAt } from '../src/shared/teams';
import { onlineGrid, type OnlinePlayer } from '../src/host/online/client';
import {
  clampLobbyRivals, closeText, nameCode, gridTeams, lobbyCanStart, lobbyRows, maxLobbyRivals, parseOnlineParams, resStandings, sanitizeName,
} from '../src/host/online/lobby';
import { menuOnlineEnabled } from '../src/host/race/menu';
import { RaceController } from '../src/host/race/controller';
import { resultsModel } from '../src/host/race/results';
import { parseTrackJson } from '../src/track/schema';
import { buildTrack } from '../src/track/track';

const q = (s: string) => new URLSearchParams(s);
const players: OnlinePlayer[] = [{ slot: 0, name: 'Ana', team: 0 }, { slot: 1, name: 'Beto', team: 0 }];
const cfg: NetCfg = { t: 'cfg', track: 'interlagos', laps: 3, rivals: 2, ai: 'easy', seed: 7, grid: [0, 1] };

describe('vestíbulo online: modelo (b16 D7)', () => {
  it('parámetros de URL: online=create|join, código saneado, nombre, rivales, autostart, laps y dropst', () => {
    expect(parseOnlineParams(q(''))).toBeNull();
    expect(parseOnlineParams(q('online=xx'))).toBeNull();
    const c = parseOnlineParams(q('online=create&name=%20Ana%20%20Li%20&rivals=2&ai=hard&autostart=2&laps=1&dropst=10'))!;
    expect(c).toEqual({ action: 'create', code: null, name: 'Ana Li', rivals: 2, ai: 'hard', laps: 1, autostart: 2, dropSt: 10 });
    const j = parseOnlineParams(q('online=join&code=ab-c234'))!;
    expect(j.code).toBe('ABC234');
    expect(parseOnlineParams(q('online=join&code=ABC'))!.code).toBeNull();
    const bad = parseOnlineParams(q('online=join&rivals=40&ai=xx&autostart=0&laps=0'))!;
    expect([bad.rivals, bad.ai, bad.autostart, bad.laps, bad.dropSt]).toEqual([null, null, 0, null, 0]);
  });

  it('nombre: sin controles ni espacios sobrantes y como mucho 16 caracteres', () => {
    expect(sanitizeName('  Ana\u0007   María ')).toBe('Ana María');
    expect(sanitizeName('x'.repeat(40))).toHaveLength(16);
    expect(sanitizeName('   ')).toBe('');
  });

  it('rivales de IA: 0..9 y la parrilla no pasa de 10 con los humanos', () => {
    expect(maxLobbyRivals(1)).toBe(9);
    expect(maxLobbyRivals(2)).toBe(8);
    expect(maxLobbyRivals(6)).toBe(config.net.gridMax - 6);
    expect(clampLobbyRivals(12, 3)).toBe(7);
    expect(clampLobbyRivals(-2, 1)).toBe(0);
    expect(clampLobbyRivals(4.4, 1)).toBe(4);
  });

  it('lista de jugadores ordenada por plaza con propietario y "tú"', () => {
    const rows = lobbyRows([{ slot: 2, name: '', team: 0 }, ...players], 0, 2);
    expect(rows.map((r) => r.slot)).toEqual([0, 1, 2]);
    expect(rows[0]).toMatchObject({ name: 'Ana', owner: true, you: false });
    expect(rows[2]).toMatchObject({ name: 'Jugador 3', owner: false, you: true });
  });

  it('solo el propietario en el vestíbulo puede empezar (≥ 1 jugador)', () => {
    expect(lobbyCanStart({ isOwner: true, status: 'lobby', players })).toBe(true);
    expect(lobbyCanStart({ isOwner: false, status: 'lobby', players })).toBe(false);
    expect(lobbyCanStart({ isOwner: true, status: 'countdown', players })).toBe(false);
    expect(lobbyCanStart({ isOwner: true, status: 'lobby', players: [] })).toBe(false);
  });

  it('código de torre de un humano por su nombre', () => {
    expect(nameCode('Ángel Ruiz')).toBe('ANG');
    expect(nameCode('Li')).toBe('LIX');
    expect(nameCode('***')).toBe('XXX');
  });

  it('textos de cierre del relay', () => {
    expect(closeText(4001)).toMatch(/llena/);
    expect(closeText(4002)).toMatch(/empezado/);
    expect(closeText(1006)).toMatch(/conectar/);
  });

  it('Online deshabilitado con 2 jugadores locales', () => {
    expect(menuOnlineEnabled({ mode: 'race', ai: 'medium', rivals: 3, players: 1 })).toBe(true);
    expect(menuOnlineEnabled({ mode: 'race', ai: 'medium', rivals: 3 })).toBe(true);
    expect(menuOnlineEnabled({ mode: 'race', ai: 'medium', rivals: 3, players: 2 })).toBe(false);
  });

  it('escudería de los humanos por plaza de la parrilla, igual en todos los PCs', () => {
    const a = gridTeams(onlineGrid(cfg, 0, true, players)), b = gridTeams(onlineGrid(cfg, 1, false, players));
    expect(a.entries.map((e) => e.team)).toEqual(b.entries.map((e) => e.team));
    expect(a.entries[0].team).toBe(driverAt(0).team);
    expect(a.entries[2].team).toBe(driverAt(2).team);
    expect(a.entries.map((e) => e.name).slice(0, 2)).toEqual(['Ana', 'Beto']);
  });

  it('tabla `res` → clasificación con diferencias y DNF', () => {
    const st = resStandings([
      { id: 2, tt: 300, laps: 3, best: 95, dnf: false }, { id: 0, tt: 301.5, laps: 3, best: 94, dnf: false },
      { id: 1, tt: null, laps: 1, best: null, dnf: true },
    ]);
    expect(st.map((s) => [s.id, s.pos])).toEqual([[2, 1], [0, 2], [1, 3]]);
    expect(st[1].gapToLeaderS).toBeCloseTo(1.5, 9);
    expect(st[2].dnf).toBe(true);
    const entries = [0, 1, 2].map((id) => ({ id, name: `P${id}`, team: 0 }));
    const rows = resultsModel(st, entries, 0, 3);
    expect(rows.map((r) => r.time)).toEqual(['5:00.000', '+1.500', 'DNF']);
    expect(rows[1].player).toBe(true);
  });
});

describe('controlador de carrera online (b16)', () => {
  const track = buildTrack(parseTrackJson(raw));
  const opts = { mode: 'online' as const, rivals: 2, ai: 'easy' as const, seed: 7, laps: 3 };

  it('parrilla común, vueltas de la cfg y render de todos los coches no locales', () => {
    const g = gridTeams(onlineGrid(cfg, 1, false, players));
    const rc = new RaceController(track, opts, config, 1, g);
    expect(rc.isRace && rc.isOnline).toBe(true);
    expect(rc.laps).toBe(3);
    expect(rc.playerId).toBe(1);
    expect(rc.session.entries.map((e) => e.kind)).toEqual(['remote', 'local', 'remote', 'remote']);
    expect(rc.rivals().map((v) => v.id)).toEqual([0, 2, 3]);    // humano remoto + IA remota
    const own = new RaceController(track, opts, config, 1, gridTeams(onlineGrid(cfg, 0, true, players)));
    expect(own.session.entries.map((e) => e.kind)).toEqual(['local', 'remote', 'ai', 'ai']);
    expect(own.rivals().map((v) => v.id)).toEqual([1, 2, 3]);   // humano remoto + IA local
  });

  it('beforeStep entre la pose anterior y el paso; sampleRemotes y hideCar', () => {
    const rc = new RaceController(track, opts, config, 1, gridTeams(onlineGrid(cfg, 1, false, players)));
    let calls = 0;
    rc.beforeStep = () => { calls++; };
    rc.step({ steer: 0, throttle: 0, brake: 0, ers: false }, []);
    expect(calls).toBe(1);
    const c0 = rc.session.entries[0].sim.state.car;
    rc.sampleRemotes((id) => (id === 0 ? { x: c0.x + 3, y: c0.y, z: c0.z, yaw: 0.5, pitch: 0, roll: 0, v: 50, steer: 0.1,
      s: c0.s, d: c0.d, laps: 0, prog: 0, drs: 0, fin: false, tt: null, best: null } : null));
    const v = rc.rivals().find((r) => r.id === 0)!;
    expect(v.cur.x).toBeCloseTo(c0.x + 3, 9);
    expect(v.prev.x).toBe(v.cur.x);
    expect(v.speed).toBe(50);
    rc.hideCar(0);
    expect(rc.rivals().map((r) => r.id)).toEqual([2, 3]);
  });

  it('carrera local intacta: los rivales siguen siendo solo la IA', () => {
    const rc = new RaceController(track, { mode: 'race', rivals: 3, ai: 'easy', seed: 1 }, config, 2);
    expect(rc.laps).toBe(config.race.laps);
    expect(rc.rivals()).toHaveLength(3);
    expect(rc.rivals().every((v) => rc.session.entries[v.id].isAi)).toBe(true);
  });
});
