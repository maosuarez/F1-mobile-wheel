import { describe, expect, it } from 'vitest';
import { ClockSync } from '../src/host/online/clock';
import {
  buildResults, generateRaceCode, isRaceCode, onlineGrid, OnlineClient, sanitizeRaceInput, type RaceSocket,
} from '../src/host/online/client';
import { RemoteCar, type RemoteSample } from '../src/host/online/remoteCars';
import { config } from '../src/shared/config';
import { decodeNet, type NetCfg } from '../src/shared/protocol';
import { minCircleDistance } from '../src/sim/collision';
import { RaceSession, type RemotePose } from '../src/sim/race';
import { mulberry32 } from '../src/sim/rng';
import { Simulation } from '../src/sim/simulation';
import { makeOvalTrack, makeStraightTrack } from '../src/track/synthetic';
import { holdSpeed, ms, place } from './helpers/drive';

// --- Reloj (D3) ---
describe('ClockSync', () => {
  // Servidor adelantado OFFSET ms; latencias de ida/vuelta deterministas
  const OFFSET = 123456;
  function rig(lat: number[]) {
    let t = 1000, k = 0, sent = 0;
    const clock = new ClockSync(() => { sent++; }, () => t);
    const answer = () => {
      const up = lat[k % lat.length], down = lat[(k + 1) % lat.length]; k++;
      t += up; const srv = t + OFFSET; t += down;
      clock.onTime(srv);
    };
    return { clock, answer, sent: () => sent, advance: (ms: number) => { t += ms; } };
  }

  it('5 pings en serie y offset = mediana (resistente a un valor atípico)', () => {
    const r = rig([10, 10, 10, 10, 400, 10, 10, 10, 10, 10]);
    r.clock.begin();
    expect(r.sent()).toBe(1);
    for (let i = 0; i < 4; i++) { r.answer(); expect(r.clock.synced).toBe(false); }
    expect(r.sent()).toBe(5);
    r.answer();
    expect(r.clock.synced).toBe(true);
    expect(r.sent()).toBe(5);
    expect(Math.abs(r.clock.offsetMs - OFFSET)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.clock.toLocal(r.clock.nowSrv()) - (r.clock.nowSrv() - r.clock.offsetMs))).toBe(0);
  });

  it('re-sincroniza cada 10 s con media móvil y reintenta si no hay respuesta', () => {
    const r = rig([20]);
    r.clock.begin();
    for (let i = 0; i < 5; i++) r.answer();
    r.advance(9000); r.clock.tick();
    expect(r.sent()).toBe(5);
    r.advance(1000); r.clock.tick();
    expect(r.sent()).toBe(6);
    r.advance(2500); r.clock.tick();       // respuesta perdida → reintento
    expect(r.sent()).toBe(7);
    r.answer();
    expect(Math.abs(r.clock.offsetMs - OFFSET)).toBeLessThanOrEqual(1);
  });
});

// --- Coches remotos (D4) ---
const base: Omit<RemoteSample, 'ts' | 'x' | 'z' | 'yaw'> = {
  y: 0, pitch: 0, roll: 0, v: 0, steer: 0, s: 0, d: 0, laps: 0, prog: 0, drs: 0, fin: false, tt: null, best: null,
};
const smp = (ts: number, x: number, z: number, yaw = 0, o: Partial<RemoteSample> = {}): RemoteSample => ({ ...base, ts, x, z, yaw, ...o });

describe('RemoteCar', () => {
  it('interpola linealmente y extrapola como mucho maxExtrapMs; más allá, quieto', () => {
    const rc = new RemoteCar(1000);
    expect(rc.sample(0)).toBeNull();
    rc.push(smp(1000, 0, 0)); rc.push(smp(1050, 5, 0));
    expect(rc.sample(1025)!.x).toBeCloseTo(2.5, 9);
    expect(rc.sample(900)!.x).toBe(0);
    expect(rc.sample(1150)!.x).toBeCloseTo(15, 9);                       // 100 ms de extrapolación
    const lim = rc.sample(1050 + config.net.maxExtrapMs)!.x;
    expect(lim).toBeCloseTo(5 + 5 * config.net.maxExtrapMs / 50, 9);
    expect(rc.sample(5000)!.x).toBe(lim);
  });

  it('ángulos por el camino corto al cruzar ±π y s con vuelta de pista', () => {
    const rc = new RemoteCar(1000);
    rc.push(smp(0, 0, 0, Math.PI - 0.1, { s: 990 }));
    rc.push(smp(100, 0, 0, -Math.PI + 0.1, { s: 10 }));
    const p = rc.sample(50)!;
    expect(Math.abs(Math.abs(p.yaw) - Math.PI)).toBeLessThan(1e-9);
    expect(p.s === 0 || Math.abs(p.s - 1000) < 1e-9 || p.s < 1e-9).toBe(true);
    const q = rc.sample(75)!;
    expect(q.s).toBeCloseTo(5, 9);
    expect(q.yaw).toBeCloseTo(-Math.PI + 0.05, 9);
  });

  it('ignora estados repetidos o desordenados', () => {
    const rc = new RemoteCar(1000);
    rc.push(smp(100, 1, 0)); rc.push(smp(50, 99, 0)); rc.push(smp(100, 99, 0));
    expect(rc.size).toBe(1);
  });

  it('300 km/h en curva, 80 ms de retardo con variación y 1 de cada 10 perdido: salto entre fotogramas < 2 m', () => {
    const v = 300 / 3.6, R = 400;
    const rc = new RemoteCar(0);
    const pos = (tMs: number) => { const a = (v * tMs / 1000) / R; return { x: R * Math.sin(a), z: R * (1 - Math.cos(a)), yaw: -a }; };
    const arrivals: { at: number; s: RemoteSample }[] = [];
    let n = 0;
    for (let ts = 0; ts <= 10000; ts += 50) {
      if (++n % 10 === 0) continue;                                    // pérdida
      const p = pos(ts);
      arrivals.push({ at: ts + 80 + ((n * 37) % 30), s: smp(ts, p.x, p.z, p.yaw, { v }) });
    }
    arrivals.sort((a, b) => a.at - b.at);
    let k = 0, prev: RemotePose | null = null, maxJump = 0, maxErr = 0;
    for (let f = 0; f < 540; f++) {                                      // hasta ~9,5 s (los datos acaban en 10 s)
      const now = 500 + f * (1000 / 60) + ((f * 7) % 5);              // fotogramas irregulares
      while (k < arrivals.length && arrivals[k].at <= now) rc.push(arrivals[k++].s);
      const p = rc.sample(now - config.net.interpDelayMs)!;
      if (prev) maxJump = Math.max(maxJump, Math.hypot(p.x - prev.x, p.z - prev.z));
      const truth = pos(now - config.net.interpDelayMs);
      maxErr = Math.max(maxErr, Math.hypot(p.x - truth.x, p.z - truth.z));
      prev = p;
    }
    expect(maxJump).toBeLessThan(2);
    expect(maxErr).toBeLessThan(1);
  });
});

// --- RaceSession con remotos (D4/D6) ---
describe('RaceSession con entradas remotas', () => {
  const straight = makeStraightTrack({ lengthM: 4000, halfWidthM: 8 });
  const scratch = new Simulation(straight, config);
  const poseAt = (s: number, v: number): RemotePose => {
    place(scratch, s, 0, v);
    const c = scratch.state.car;
    return { x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: 0, roll: 0, v, steer: 0, s: c.s, d: c.d, laps: 0, prog: s, drs: 0, fin: false, tt: null, best: null };
  };

  it('kind por defecto: isAi → ai, si no local', () => {
    const rs = new RaceSession(straight, [{ name: 'A', team: 0, isAi: true }, { name: 'B', team: 0, isAi: false }, { name: 'C', team: 0, kind: 'remote' }], config, 1);
    expect(rs.entries.map((e) => e.kind)).toEqual(['ai', 'local', 'remote']);
    expect(rs.entries.map((e) => e.isAi)).toEqual([true, false, false]);
  });

  it('contacto local → remoto: el local se separa y frena; el remoto no se modifica', () => {
    const rs = new RaceSession(straight, [{ name: 'L', team: 0, kind: 'local' }, { name: 'R', team: 0, kind: 'remote' }], config, 1);
    rs.phase = 'green';
    place(rs.entries[0].sim, 1000, 0, ms(200));
    const vR = ms(100);
    let sR = 1030, hits = 0, minDist = Infinity, hitStep = -1;
    const remoteCar = rs.entries[1].sim.state.car;
    for (let i = 0; i < 240; i++) {
      sR += vR * config.sim.dt;
      const p = poseAt(sR, vR);
      rs.setRemote(1, p);
      const vL0 = rs.entries[0].sim.state.car.speed;
      const ev = rs.step([holdSpeed(ms(200))(rs.entries[0].sim.state)], []);
      const h = ev.filter((e) => e.type === 'carHit').length;
      if (h && hitStep < 0) { hitStep = i; expect(rs.entries[0].sim.state.car.speed).toBeLessThan(vL0); }
      hits += h;
      // El remoto mostrado es exactamente la pose recibida
      expect(remoteCar.x).toBe(p.x); expect(remoteCar.z).toBe(p.z); expect(remoteCar.yaw).toBe(p.yaw);
      expect(remoteCar.speed).toBe(vR); expect(remoteCar.s).toBe(p.s);
      minDist = Math.min(minDist, minCircleDistance(rs.entries[0].sim.state.car, remoteCar, config));
    }
    expect(hits).toBeGreaterThan(0);
    expect(minDist).toBeGreaterThan(1.5);
    expect(rs.entries[0].sim.state.car.s).toBeLessThan(sR);           // no lo atraviesa
  });

  it('remoto contra remoto no se resuelve; un retirado se clasifica último con dnf y no colisiona', () => {
    const rs = new RaceSession(straight, [{ name: 'A', team: 0, kind: 'remote' }, { name: 'B', team: 0, kind: 'remote' }, { name: 'C', team: 0, kind: 'local' }], config, 1);
    rs.phase = 'green';
    const p = poseAt(1500, 50);
    rs.setRemote(0, p); rs.setRemote(1, { ...p, prog: 1500.5 });
    const ev = rs.step([], []);
    expect(ev.some((e) => e.type === 'carHit')).toBe(false);
    expect(rs.entries[0].sim.state.car.x).toBe(p.x);
    expect(rs.standings()[0].id).toBe(1);
    rs.retire(1);
    const st = rs.standings();
    expect(st[st.length - 1]).toMatchObject({ id: 1, dnf: true });
    expect(rs.raceTimeS).toBeCloseTo(config.sim.dt, 12);               // el reloj avanza aunque la entrada 0 sea remota
  });

  it('final con remotos: fin/tt del remoto cuentan y los retirados no bloquean el final', () => {
    const c = { ...config, race: { ...config.race, laps: 1 } };
    const oval = makeOvalTrack();
    const rs = new RaceSession(oval, [{ name: 'R', team: 0, kind: 'remote' }, { name: 'X', team: 0, kind: 'remote' }], c, 1);
    rs.phase = 'green';
    const c0 = rs.entries[0].sim.state.car;
    rs.setRemote(0, { x: c0.x, y: c0.y, z: c0.z, yaw: c0.yaw, pitch: 0, roll: 0, v: 50, steer: 0, s: c0.s, d: 0, laps: 1, prog: oval.length + 1, drs: 0, fin: true, tt: 80, best: 80 });
    const ev = rs.step([], []);
    expect(ev).toContainEqual({ type: 'finish', car: 0, pos: 1 });
    expect(rs.phase).toBe('finishing');
    rs.retire(1);
    expect(rs.phase).toBe('finished');
    expect(buildResults(rs)).toEqual([{ id: 0, tt: 80, laps: 1, best: 80, dnf: false }, { id: 1, tt: null, laps: 0, best: null, dnf: true }]);
  });
});

// --- Cliente (D5/D6) con un socket falso ---
class FakeSocket implements RaceSocket {
  readyState = 1;
  onopen: RaceSocket['onopen'] = null;
  onmessage: RaceSocket['onmessage'] = null;
  onclose: RaceSocket['onclose'] = null;
  onerror: RaceSocket['onerror'] = null;
  sent: string[] = [];
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
  recv(o: unknown) { this.onmessage?.({ data: typeof o === 'string' ? o : JSON.stringify(o) }); }
  types() { return this.sent.map((s) => JSON.parse(s).t as string); }
  last(t: string) { const s = [...this.sent].reverse().find((x) => JSON.parse(x).t === t); return s ? JSON.parse(s) : null; }
}

function mkClient(name: string, team = 0) {
  let t = 0;
  const sock = new FakeSocket();
  const c = new OnlineClient({ code: 'ABC234', name, team, socketFactory: () => sock, now: () => t });
  c.connect();
  return { c, sock, advance: (ms: number) => { t += ms; }, syncClock: (srvOffset: number) => {
    for (let i = 0; i < config.net.clockPings; i++) sock.recv({ t: 'time', srv: t + srvOffset });
  } };
}
const lobby = (you: number, owner: number, slots: number[]) =>
  ({ t: 'lobby', you, owner, players: slots.map((s) => ({ slot: s, name: `P${s}` })) });

describe('OnlineClient', () => {
  it('códigos de 6 caracteres', () => {
    const code = generateRaceCode(() => 0.5);
    expect(isRaceCode(code)).toBe(true);
    expect(isRaceCode('ABC23')).toBe(false);
    expect(sanitizeRaceInput('ab-c2 34x9')).toBe('ABC234');
  });

  it('vestíbulo: hello y time al entrar, pong al ping, equipos por hello', () => {
    const { c, sock } = mkClient('Ana', 3);
    const lobbies: number[][] = [];
    c.on('lobby', (ps) => lobbies.push(ps.map((p) => p.slot)));
    sock.recv(lobby(0, 0, [0]));
    expect(c.status).toBe('lobby');
    expect(c.isOwner).toBe(true);
    expect(sock.types()).toEqual(['time', 'hello']);
    expect(sock.last('hello')).toEqual({ t: 'hello', name: 'Ana', team: 3 });
    sock.recv({ t: 'ping' });
    expect(sock.types().at(-1)).toBe('pong');
    sock.recv(lobby(0, 0, [0, 1]));                                    // alguien entra → hello de nuevo
    expect(sock.types().filter((t) => t === 'hello').length).toBe(2);
    sock.recv({ t: 'r', f: 1, m: { t: 'hello', name: 'Bea', team: 5 } });
    expect(c.players).toEqual([{ slot: 0, name: 'P0', team: 3 }, { slot: 1, name: 'P1', team: 5 }]);
    expect(lobbies.length).toBe(3);
    sock.recv('basura'); sock.recv({ t: 'r', f: 9, m: { t: 'hello' } });
  });

  it('salida sincronizada: el propietario manda cfg, start, started; el otro arranca en el mismo atSrv', () => {
    const A = mkClient('A'), B = mkClient('B');
    A.sock.recv(lobby(0, 0, [0, 1])); B.sock.recv(lobby(1, 0, [0, 1]));
    A.syncClock(5000); B.advance(777); B.syncClock(5000 - 777);
    expect(Math.abs(A.c.clock.nowSrv() - B.c.clock.nowSrv())).toBeLessThan(1);
    expect(B.c.start({ track: 't', laps: 5, rivals: 2, ai: 'medium', seed: 7 })).toBeNull();   // no propietario
    const atSrv = A.c.start({ track: 'interlagos', laps: 5, rivals: 2, ai: 'hard', seed: 7 })!;
    expect(A.sock.types().slice(-3)).toEqual(['cfg', 'start', 'started']);
    expect(atSrv).toBe(Math.round(A.c.clock.nowSrv() + 3000));
    let started: [NetCfg, number] | null = null;
    B.c.on('start', (cfg, at) => { started = [cfg, at]; });
    for (const raw of A.sock.sent.slice(-3, -1)) B.sock.recv(`{"t":"r","f":0,"m":${raw}}`);
    expect(started![1]).toBe(atSrv);
    expect(started![0]).toMatchObject({ grid: [0, 1], rivals: 2, seed: 7 });
    expect(B.c.status).toBe('countdown');
    expect(B.c.lightsDue()).toBe(false);
    B.advance(2999); expect(B.c.lightsDue()).toBe(false);
    B.advance(2); expect(B.c.lightsDue()).toBe(true);
  });

  it('carrera: st/ai a 20 Hz, remotos en la sesión, abandono y resultados del propietario', () => {
    const A = mkClient('A'), B = mkClient('B');
    A.sock.recv(lobby(0, 0, [0, 1])); B.sock.recv(lobby(1, 0, [0, 1]));
    A.syncClock(0); B.syncClock(0);
    A.c.start({ track: 'oval', laps: 1, rivals: 1, ai: 'easy', seed: 3 });
    for (const raw of A.sock.sent.slice(-3, -1)) B.sock.recv(`{"t":"r","f":0,"m":${raw}}`);
    const cfg = A.c.netCfg!;
    const oval = makeOvalTrack();
    const gA = onlineGrid(cfg, A.c.you, true, A.c.players), gB = onlineGrid(cfg, B.c.you, false, B.c.players);
    expect(gA.seats.map((s) => s.kind)).toEqual(['local', 'remote', 'ai']);
    expect(gB.seats.map((s) => s.kind)).toEqual(['remote', 'local', 'remote']);
    const rsA = new RaceSession(oval, gA.entries, config, cfg.seed), rsB = new RaceSession(oval, gB.entries, config, cfg.seed);
    A.c.attach(rsA, gA, oval.length); B.c.attach(rsB, gB, oval.length);
    rsA.phase = 'green'; rsB.phase = 'green';
    const n0 = A.sock.sent.length;
    const relay = (from: { sock: FakeSocket }, to: { sock: FakeSocket }, f: number, start: number) => {
      for (const raw of from.sock.sent.slice(start)) {
        const m = decodeNet(raw);
        if (m) to.sock.recv(`{"t":"r","f":${f},"m":${raw}}`);
      }
    };
    let iA = n0, iB = B.sock.sent.length;
    for (let f = 0; f < 60; f++) {                                       // 1 s a 60 fps
      A.advance(1000 / 60); B.advance(1000 / 60);
      A.c.tick(); B.c.tick();
      relay(A, B, 0, iA); iA = A.sock.sent.length;
      relay(B, A, 1, iB); iB = B.sock.sent.length;
      A.c.beforeStep(); B.c.beforeStep();
      rsA.step([{ steer: 0, throttle: 1, brake: 0, ers: false }], []);
      rsB.step([{ steer: 0, throttle: 0, brake: 0, ers: false }, { steer: 0, throttle: 1, brake: 0, ers: false }], []);
    }
    const stA = A.sock.sent.slice(n0).filter((s) => JSON.parse(s).t === 'st').length;
    const aiA = A.sock.sent.slice(n0).filter((s) => JSON.parse(s).t === 'ai').length;
    expect(stA).toBeGreaterThanOrEqual(19); expect(stA).toBeLessThanOrEqual(21);
    expect(aiA).toBe(stA);
    expect(B.sock.sent.some((s) => JSON.parse(s).t === 'ai')).toBe(false);
    // El coche de A en B y la IA de A en B siguen a sus originales (con el retardo de interpolación)
    const dA = Math.hypot(rsB.entries[0].sim.state.car.x - rsA.entries[0].sim.state.car.x, rsB.entries[0].sim.state.car.z - rsA.entries[0].sim.state.car.z);
    expect(dA).toBeGreaterThan(0);
    expect(dA).toBeLessThan(rsA.entries[0].sim.state.car.speed * 0.2 + 1);
    expect(B.c.remote(2)!.size).toBeGreaterThan(0);
    // Abandono del propietario: B retira a A y a la IA, y pasa a ser propietario
    const left: number[] = [];
    B.c.on('leave', (slot) => left.push(slot));
    B.sock.recv(lobby(1, 1, [1]));
    expect(left).toEqual([0]);
    expect(rsB.entries[0].retired).toBe(true);
    expect(rsB.entries[2].retired).toBe(true);
    expect(B.c.isOwner).toBe(true);
    // B termina solo → compila res
    let res: { official: boolean; n: number } | null = null;
    B.c.on('results', (rows, official) => { res = { official, n: rows.length }; });
    rsB.phase = 'finished';
    B.c.tick();
    expect(res).toEqual({ official: true, n: 3 });
    expect(B.sock.last('res').rows.map((r: { dnf: boolean }) => r.dnf)).toEqual([false, true, true]);
  });

  it('sin res del propietario en 10 s: resultados locales no oficiales; res posterior los sustituye', () => {
    const A = mkClient('A');
    A.sock.recv(lobby(1, 0, [0, 1]));
    A.sock.recv({ t: 'r', f: 0, m: { t: 'cfg', track: 'o', laps: 1, rivals: 0, ai: 'easy', seed: 1, grid: [0, 1] } });
    A.sock.recv({ t: 'r', f: 0, m: { t: 'start', atSrv: 0 } });
    const g = onlineGrid(A.c.netCfg!, 1, false, A.c.players);
    const oval = makeOvalTrack();
    const rs = new RaceSession(oval, g.entries, config, 1);
    A.c.attach(rs, g, oval.length);
    const got: boolean[] = [];
    A.c.on('results', (_r, official) => got.push(official));
    rs.phase = 'finished';
    A.c.tick(); A.advance(9999); A.c.tick();
    expect(got).toEqual([]);
    A.advance(2); A.c.tick();
    expect(got).toEqual([false]);
    A.sock.recv({ t: 'r', f: 0, m: { t: 'res', rows: [{ id: 0, tt: 1, laps: 1, best: 1, dnf: false }] } });
    expect(got).toEqual([false, true]);
    expect(A.c.results!.official).toBe(true);
  });

  it('cierre del relay: estado closed y código', () => {
    const { c, sock } = mkClient('A');
    const codes: number[] = [];
    c.on('close', (k) => codes.push(k));
    sock.onclose?.({ code: 4001 });
    expect(c.status).toBe('closed');
    expect(codes).toEqual([4001]);
  });
});

// --- Fluidez de remotos con latencia y pérdidas (spec "Coches remotos fluidos") ---
describe('RemoteCar con latencia, jitter y pérdidas', () => {
  it('a 60 fps, 80 ms ± jitter y 1 de cada 10 st perdido: |Δp| − v̄·dt < 2 m', () => {
    const R = 200, V = 80, L = 2 * Math.PI * R;
    const sendMs = 1000 / config.net.raceHz, frameMs = 1000 / 60;
    const rng = mulberry32(7);
    const at = (t: number): RemoteSample => {
      const a = (V * t / 1000) / R;
      return { ts: t, x: R * Math.cos(a), y: 0, z: -R * Math.sin(a), yaw: a + Math.PI / 2, pitch: 0, roll: 0, v: V, steer: 0,
        s: (V * t / 1000) % L, d: 0, laps: 0, prog: V * t / 1000, drs: 0, fin: false, tt: null, best: null };
    };
    // Mensajes enviados a raceHz, con llegada = envío + 80 ms + jitter (±5 ms); se pierde 1 de cada 10
    const inbox: { arrive: number; s: RemoteSample }[] = [];
    for (let k = 0, t = 0; t <= 20000; k++, t += sendMs) {
      if (k % 10 === 9) continue;
      inbox.push({ arrive: t + 80 + (rng() * 2 - 1) * 5, s: at(t) });
    }
    inbox.sort((a, b) => a.arrive - b.arrive);
    const rc = new RemoteCar(L);
    let next = 0, prev: RemotePose | null = null, worst = -Infinity;
    for (let f = 0; f * frameMs <= 20000; f++) {
      const now = f * frameMs;
      while (next < inbox.length && inbox[next].arrive <= now) rc.push(inbox[next++].s);
      const p = rc.sample(now - config.net.interpDelayMs);
      if (p && prev && now > 1000) {
        const d = Math.hypot(p.x - prev.x, p.z - prev.z);
        worst = Math.max(worst, d - ((prev.v + p.v) / 2) * (frameMs / 1000));
      }
      prev = p;
    }
    expect(worst).toBeGreaterThan(-Infinity);
    expect(worst).toBeLessThan(2);
  });
});

// --- Semáforo por reloj del servidor (D5) ---
describe('RaceSession.syncLights', () => {
  const track = makeOvalTrack();
  const specs = [{ name: 'A', team: 0 }, { name: 'B', team: 1 }];

  it('un PC lento (pocos pasos) apaga al mismo elapsed que uno rápido', () => {
    const fast = new RaceSession(track, specs, config, 42), slow = new RaceSession(track, specs, config, 42);
    fast.startLights(); slow.startLights();
    const target = fast.lightsOutAtS;
    let outFast: number | null = null, outSlow: number | null = null;
    // Rápido: 60 fps, todos los pasos del intervalo. Lento: 5 fps y 1 solo paso por fotograma (sim por detrás).
    for (let f = 0; outFast === null; f++) {
      const t = f / 60;
      const ev = fast.syncLights(t);
      for (let i = 0; i < 2; i++) fast.step([], []);
      if (ev.some((e) => e.type === 'lightsOut')) outFast = t;
    }
    for (let f = 0; outSlow === null; f++) {
      const t = f / 5;
      const ev = slow.syncLights(t);
      slow.step([], []);
      if (ev.some((e) => e.type === 'lightsOut')) outSlow = t;
    }
    expect(outFast).toBeGreaterThanOrEqual(target - 1e-9);
    expect(outFast! - target).toBeLessThan(1 / 60 + 1e-9);
    expect(outSlow).toBeGreaterThanOrEqual(target - 1e-9);
    expect(outSlow! - target).toBeLessThan(1 / 5 + 1e-9);
    expect(fast.phase).toBe('green'); expect(slow.phase).toBe('green');
  });

  it('fija las luces por tiempo y step() no las avanza tras syncLights; fuera de "lights" no hace nada', () => {
    const rs = new RaceSession(track, specs, config, 42);
    expect(rs.syncLights(10)).toEqual([]);
    rs.startLights();
    rs.syncLights(2.5);
    expect(rs.lightsOn).toBe(3);
    for (let i = 0; i < 2000; i++) rs.step([], []);
    expect(rs.phase).toBe('lights');
    expect(rs.lightsOn).toBe(3);
    expect(rs.syncLights(rs.lightsOutAtS)).toEqual([{ type: 'lightsOut' }]);
    expect(rs.lightsOn).toBe(0);
    expect(rs.syncLights(100)).toEqual([]);
  });
});
