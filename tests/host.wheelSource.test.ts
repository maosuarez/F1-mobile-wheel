import { describe, expect, it, vi, afterEach } from 'vitest';
import { config } from '../src/shared/config';
import { decodeAtHost, encode, type InMsg } from '../src/shared/protocol';
import type { SimState } from '../src/sim/types';
import { RoomClient } from '../src/host/net/roomClient';
import { WheelSource } from '../src/host/net/wheelSource';

const STATE = {} as SimState;                                    // WheelSource no lee el estado
const mk = () => {
  let t = 10_000;
  const ws = new WheelSource(config, () => t);
  return { ws, advance: (ms: number) => { t += ms; } };
};
let seq = 0;
const inMsg = (o: Partial<InMsg> = {}): InMsg =>
  ({ t: 'in', seq: seq++, ts: 5000, steer: 0, thr: 0, brk: 0, ers: false, rtt: null, ...o });

describe('WheelSource', () => {
  it('dirección y pedales: el siguiente paso aplica exactamente el último in', () => {
    const { ws } = mk();
    expect(ws.link()).toBe('none');
    expect(ws.read(1 / 120, STATE)).toEqual({ steer: 0, throttle: 0, brake: 0, ers: false });
    ws.handleMessage(inMsg({ steer: 0.5, thr: 1, brk: 0 }));
    expect(ws.read(1 / 120, STATE)).toEqual({ steer: 0.5, throttle: 1, brake: 0, ers: false });
    expect(ws.link()).toBe('ok');
  });

  it('corte de acelerador: 300 ms sin in → throttle 0 y ers false, mantiene dirección y freno', () => {
    const { ws, advance } = mk();
    ws.handleMessage(inMsg({ steer: -0.3, thr: 1, brk: 0.4, ers: true }));
    advance(300);
    expect(ws.read(1 / 120, STATE)).toEqual({ steer: -0.3, throttle: 0, brake: 0.4, ers: false });
    expect(ws.link()).toBe('stale');
  });

  it('pausa por pérdida: lost por tiempo (> 1 000 ms)', () => {
    const { ws, advance } = mk();
    ws.handleMessage(inMsg({ thr: 1 }));
    advance(999);
    expect(ws.link()).toBe('stale');
    advance(2);
    expect(ws.link()).toBe('lost');
    ws.handleMessage(inMsg({ thr: 1 }));                         // vuelve a recibir in → reanudable
    expect(ws.link()).toBe('ok');
  });

  it('pausa por pérdida: lost inmediato por peer desconectado', () => {
    const { ws } = mk();
    ws.handleMessage(inMsg({ thr: 1, ers: true }));
    ws.handleMessage({ t: 'peer', role: 'wheel', connected: false });
    expect(ws.link()).toBe('lost');
    expect(ws.read(1 / 120, STATE).throttle).toBe(0);
    ws.handleMessage({ t: 'peer', role: 'host', connected: false }); // otro rol: se ignora
    ws.handleMessage(inMsg({ thr: 1 }));
    expect(ws.link()).toBe('ok');
  });

  it('descarta seq repetido o antiguo y lo reinicia con peer conectado', () => {
    const { ws } = mk();
    ws.handleMessage(inMsg({ seq: 100, steer: 0.2 }));
    ws.handleMessage(inMsg({ seq: 99, steer: 0.9 }));
    ws.handleMessage(inMsg({ seq: 100, steer: 0.9 }));
    expect(ws.read(1 / 120, STATE).steer).toBe(0.2);
    ws.handleMessage(inMsg({ seq: 0, steer: 0.7 }));             // sin reinicio: se descarta
    expect(ws.read(1 / 120, STATE).steer).toBe(0.2);
    ws.handleMessage({ t: 'peer', role: 'wheel', connected: true });
    ws.handleMessage(inMsg({ seq: 0, steer: 0.7 }));
    expect(ws.read(1 / 120, STATE).steer).toBe(0.7);
  });

  it('eventos entregados una sola vez: órdenes a la simulación y eventos de interfaz aparte', () => {
    const { ws } = mk();
    for (const k of ['up', 'pause', 'down', 'cam', 'drs', 'recal', 'pause'] as const) ws.handleMessage({ t: 'ev', k });
    expect(ws.takeCommands()).toEqual(['shiftUp', 'shiftDown', 'drs']);
    expect(ws.takeCommands()).toEqual([]);
    expect(ws.takeUiEvents()).toEqual(['pause', 'cam', 'recal', 'pause']);
    expect(ws.takeUiEvents()).toEqual([]);
  });

  it('echo(): último ts y holdMs desde su recepción; RTT del último in', () => {
    const { ws, advance } = mk();
    expect(ws.echo()).toEqual({ ts: 0, holdMs: 0 });
    expect(ws.lastRttMs()).toBeNull();
    ws.handleMessage(inMsg({ ts: 123_456, rtt: 8 }));
    advance(40);
    expect(ws.echo()).toEqual({ ts: 123_456, holdMs: 40 });
    expect(ws.lastRttMs()).toBe(8);
  });

  it('RTT descontando la espera del PC: 40 ms de espera + 6 ms de red → 4–12 ms', () => {
    let pc = 50_000;                                             // relojes de PC y celular no sincronizados
    const ws = new WheelSource(config, () => pc);
    const sentAt = 1000;                                         // reloj del celular al enviar el in
    ws.handleMessage(inMsg({ ts: sentAt }));                     // llega tras 3 ms de red
    pc += 40;                                                    // espera hasta el siguiente tel
    const { ts, holdMs } = ws.echo();
    const recvAt = sentAt + 3 + 40 + 3;                          // ida + espera + vuelta
    const rtt = recvAt - ts - holdMs;
    expect(rtt).toBeGreaterThanOrEqual(4); expect(rtt).toBeLessThanOrEqual(12);
  });
});

// WebSocket falso para RoomClient
class FakeWS {
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(public url: string) { FakeWS.instances.push(this); }
  send(t: string) { this.sent.push(t); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}
const Impl = FakeWS as unknown as typeof WebSocket;

describe('RoomClient', () => {
  afterEach(() => { vi.useRealTimers(); FakeWS.instances = []; });

  it('responde pong a ping sin reenviarlo y entrega el resto', () => {
    const c = new RoomClient('host', 'ABCD', { url: 'ws://x/ws/ABCD?role=host', WebSocketImpl: Impl });
    const got: string[] = [];
    c.onMessage = (r) => got.push(r);
    c.connect();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.onmessage?.({ data: '{"t":"ping"}' });
    ws.onmessage?.({ data: encode(inMsg({ steer: 0.25 })) });
    expect(ws.sent).toEqual(['{"t":"pong"}']);
    expect(got).toHaveLength(1);
    expect((decodeAtHost(got[0]) as InMsg).steer).toBe(0.25);
  });

  it('reconecta con espera 0,5 → 1 → 2 → 3 s y no reconecta tras close() ni con 4001', () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const c = new RoomClient('wheel', 'ABCD', { url: 'ws://x', WebSocketImpl: Impl });
    c.onStatus = (s) => statuses.push(s);
    c.connect();
    for (const wait of [500, 1000, 2000, 3000, 3000]) {
      const n = FakeWS.instances.length;
      FakeWS.instances[n - 1].drop();
      vi.advanceTimersByTime(wait - 1);
      expect(FakeWS.instances.length).toBe(n);
      vi.advanceTimersByTime(1);
      expect(FakeWS.instances.length).toBe(n + 1);
    }
    FakeWS.instances.at(-1)!.open();
    expect(statuses.at(-1)).toBe('open');
    FakeWS.instances.at(-1)!.drop(4001);
    vi.advanceTimersByTime(10_000);
    const n = FakeWS.instances.length;
    c.connect();
    expect(FakeWS.instances.length).toBe(n + 1);
    c.close();
    vi.advanceTimersByTime(10_000);
    expect(FakeWS.instances.length).toBe(n + 1);
  });

  it('send solo con la conexión abierta', () => {
    const c = new RoomClient('host', 'ABCD', { url: 'ws://x', WebSocketImpl: Impl });
    c.connect();
    const ws = FakeWS.instances[0];
    c.send('a');
    ws.open();
    c.send('b');
    expect(ws.sent).toEqual(['b']);
  });
});
