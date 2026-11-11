import './hud.css';
import { config } from '../shared/config';
import { loadTrack } from '../track/load';
import { Simulation } from '../sim/simulation';
import { NEUTRAL_INPUT, type DriverInput } from '../sim/types';
import { createRenderer, createScene, resize } from '../render/scene';
import { buildCar } from '../render/car';
import { ChaseCamera } from '../render/chaseCamera';
import { FixedStepper } from './loop';
import { Hud } from './hud';
import { DebugPanel } from './debugPanel';
import { installDebugApi } from './debugApi';
import { loadBest, saveBest } from './storage';
import { KeyboardAdapter, KeyboardInput } from './input/keyboard';
import { AutopilotSource } from './input/autopilotSource';
import type { InputSource } from './input/types';
import { Autopilot } from '../sim/autopilot';
import { decodeAtHost, encode, generateRoomCode, type TelHint } from '../shared/protocol';
import { RoomClient } from './net/roomClient';
import { WheelSource } from './net/wheelSource';
import { WarningCenter } from './warnings';
import { buildTel } from './net/telemetry';
import { PairingUi, wheelUrl, type RelayInfo } from './pairing';

type GameState = 'loading' | 'pairing' | 'countdown' | 'racing' | 'paused' | 'error';
type PauseReason = 'user' | 'hidden' | 'wheelLost';

const params = new URLSearchParams(window.location.search);
const debug = params.get('debug') === '1';
const useAutopilot = debug && params.get('autopilot') === '1';
const tsRaw = Number(params.get('timescale'));
const timescale = debug && Number.isFinite(tsRaw) && tsRaw >= 1 ? Math.min(16, tsRaw) : 1;

const $ = (id: string) => document.getElementById(id)!;
let state: GameState = 'loading';
let pauseReason: PauseReason | null = null;

function setState(s: GameState): void {
  state = s;
  $('overlay-loading').hidden = s !== 'loading';
  $('overlay-pairing').hidden = s !== 'pairing';
  $('overlay-pause').hidden = !(s === 'paused' && pauseReason !== 'wheelLost');
  $('overlay-wheel-lost').hidden = !(s === 'paused' && pauseReason === 'wheelLost');
  $('overlay-error').hidden = s !== 'error';
}

function showError(e: unknown): void {
  $('overlay-error').textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
  setState('error');
}

async function fetchRelayInfo(): Promise<RelayInfo | null> {
  try {
    const r = await fetch('/api/info');
    if (!r.ok) return null;
    const j = await r.json() as Partial<RelayInfo>;
    return { lan_ips: Array.isArray(j.lan_ips) ? j.lan_ips : [], public_url: typeof j.public_url === 'string' ? j.public_url : null };
  } catch { return null; }
}

async function start(): Promise<void> {
  const track = await loadTrack('interlagos');
  const sim = new Simulation(track);
  sim.timer.setBestLap(loadBest(track.id));

  const canvas = $('game') as HTMLCanvasElement;
  const renderer = createRenderer(canvas);
  const { scene, camera } = createScene(track);
  const car = buildCar();
  scene.add(car);
  const chase = new ChaseCamera(camera);
  const hud = new Hud();
  const panel = new DebugPanel();
  hud.show(true);
  const warnings = new WarningCenter();
  const bestSectors: (number | null)[] = [null, null, null];

  const stepper = new FixedStepper(config.sim.dt, config.sim.maxSubSteps);
  const adapter = new KeyboardAdapter(window, {
    onRecenter: () => { if (state === 'racing') { sim.recenter(); syncPrev(); } },
    onPause: () => togglePause(),
    onToggleAuto: () => { if (state === 'racing' && source !== wheel) sim.assists.autoShift = !sim.assists.autoShift; },
  });
  const keyboardSource = new KeyboardInput(adapter);
  let source: InputSource = useAutopilot ? new AutopilotSource(track) : keyboardSource;
  const setSource = (s: InputSource) => { source = s; sim.assists.autoShift = s.name !== 'wheel'; };

  // Volante: sala del relay (no se abre con ?autopilot=1)
  const ui = new PairingUi();
  const nowMs = () => performance.now();
  const wheel = useAutopilot ? null : new WheelSource(config, nowMs);
  const room = useAutopilot ? null : generateRoomCode();
  let client: RoomClient | null = null;
  if (wheel && room) {
    const port = window.location.port;
    const showRoom = (info: RelayInfo | null) => {
      const { url, mode } = wheelUrl(window.location, info, room);
      ui.setRoom(room, url, mode, port);
    };
    showRoom(null);
    let everOpen = false;
    client = new RoomClient('host', room);
    client.onStatus = (st) => {
      if (st === 'open') { everOpen = true; ui.setRelayDown(false); }
      else if (st === 'closed' && !everOpen) ui.setRelayDown(true);
    };
    client.onMessage = (raw) => {
      const m = decodeAtHost(raw);
      if (m && m.t !== 'ping') wheel.handleMessage(m);
    };
    client.connect();
    void fetchRelayInfo().then((info) => { if (info) showRoom(info); else ui.setRelayDown(true); });
  }
  const refPilot = debug && wheel ? new Autopilot(track) : null;     // sugerencia `dbg` del tel

  let lastInput: DriverInput = NEUTRAL_INPUT;
  let wallHits = 0, maxDraw = 0, maxTris = 0, fps = 60, dpr = renderer.getPixelRatio();
  const prev = { x: 0, y: 0, z: 0, yaw: 0 };
  const cur = { x: 0, y: 0, z: 0, yaw: 0 };
  const syncPrev = () => {
    const c = sim.state.car;
    cur.x = prev.x = c.x; cur.y = prev.y = c.y; cur.z = prev.z = c.z; cur.yaw = prev.yaw = c.yaw;
  };
  syncPrev();

  let countdownEndMs = 0;
  let pausedFrom: 'racing' | 'countdown' = 'racing';
  const startCountdown = () => { countdownEndMs = nowMs() + config.race.countdownS * 1000; setState('countdown'); };
  const pause = (reason: PauseReason) => {
    if (state !== 'racing' && state !== 'countdown') return;
    pausedFrom = state;
    pauseReason = reason;
    setState('paused');
  };
  const resume = () => {
    if (state !== 'paused') return;
    pauseReason = null;
    if (pausedFrom === 'countdown') startCountdown();
    else { stepper.reset(); setState('racing'); }
  };
  // Solo la pausa por volante perdido se reanuda sola; las demás, con P o el botón del volante
  const togglePause = () => {
    if (state === 'racing' || state === 'countdown') pause('user');
    else if (state === 'paused' && pauseReason !== 'wheelLost') resume();
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') { e.preventDefault(); panel.toggle(); return; }
    if (state === 'pairing' && (e.code === 'Enter' || e.code === 'NumpadEnter')) { setSource(keyboardSource); startCountdown(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause('hidden'); });

  // Estado del volante: toma de control, eventos de interfaz, pérdida y reanudación
  const updateWheel = () => {
    if (!wheel) return;
    for (const k of wheel.takeUiEvents()) if (k === 'pause' && source === wheel) togglePause();
    if (source !== wheel) wheel.takeCommands();                 // órdenes sin efecto si no controla el volante
    const link = wheel.link();
    if (link === 'ok') {
      if (state === 'pairing') { setSource(wheel); startCountdown(); }
      else if (source !== wheel && (state === 'countdown' || state === 'racing' || state === 'paused')) {
        setSource(wheel); ui.toast('Volante conectado');
      } else if (state === 'paused' && pauseReason === 'wheelLost') resume();
    } else if (link === 'lost' && source === wheel) pause('wheelLost');
  };

  // Telemetría a net.telHz con temporizador propio (independiente del render), solo con volante conectado
  const sendTelemetry = () => {
    if (!wheel || !client) return;
    const link = wheel.link();
    if (link !== 'ok' && link !== 'stale') return;
    const now = nowMs();
    const warn = state === 'countdown' ? String(Math.max(1, Math.ceil((countdownEndMs - now) / 1000)))
      : state === 'paused' ? 'PAUSA' : warnings.current(sim.state, sim.state.t);
    let dbg: TelHint | undefined;
    if (refPilot) {
      const r = refPilot.update(sim.state);
      dbg = { steer: r.input.steer, thr: r.input.throttle, brk: r.input.brake, gear: refPilot.suggestedGear(sim.state) };
    }
    const e = wheel.echo();
    client.send(encode(buildTel(sim.state, { warn, echo: e.ts, hold: e.holdMs, dbg })));
  };
  window.addEventListener('resize', () => resize(renderer, camera));
  resize(renderer, camera);

  if (debug) {
    installDebugApi(() => {
      const c = sim.state.car, t = sim.state.timing;
      return {
        gameState: state, input: { ...lastInput }, speedKmh: c.speed * 3.6, s: c.s, d: c.d, surface: c.surface,
        lap: t.lap, lapTimeS: t.lapTimeS, lastLapS: t.lastLapS, lastLapValid: t.lastLapValid, bestLapS: t.bestLapS, deltaS: t.deltaS,
        fps, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        maxDrawCalls: maxDraw, maxTriangles: maxTris, dpr, wallHits, simTimeS: sim.state.t,
        room, wheelLink: wheel ? wheel.link() : 'none', rttMs: wheel ? wheel.lastRttMs() : null,
        gear: c.gear, rpm: c.rpm, leds: c.leds, drs: c.drs, ers: c.ersCharge, ot: c.overtake,
        autoShift: sim.assists.autoShift, lapValid: t.lapValid, warn: warnings.current(sim.state, sim.state.t), overheated: c.overheated,
        inputApplied: { steer: lastInput.steer, thr: lastInput.throttle, brk: lastInput.brake, ers: lastInput.ers },
        pauseReason,
      };
    });
  }

  if (client) {
    // También evalúa el enlace del volante aquí: la pausa/reanudación no depende del render (updateWheel es idempotente)
    const telTimer = setInterval(() => { updateWheel(); sendTelemetry(); }, 1000 / config.net.telHz);
    window.addEventListener('pagehide', () => { clearInterval(telTimer); client?.close(); });
  }

  if (useAutopilot) { stepper.reset(); setState('racing'); }
  else setState('pairing');

  const dt = config.sim.dt;
  let lastT = performance.now();
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const frameDt = Math.min((now - lastT) / 1000, 1);
    lastT = now;
    if (frameDt > 0) fps += (1 / frameDt - fps) * 0.1;

    updateWheel();
    if (state === 'countdown') {
      const left = (countdownEndMs - nowMs()) / 1000;           // coche retenido: la simulación no avanza
      if (left <= 0) { ui.setCountdown(null); stepper.reset(); setState('racing'); }
      else ui.setCountdown(Math.ceil(left));
    } else ui.setCountdown(null);

    let alpha = 1;
    if (state === 'racing') {
      const r = stepper.advance(frameDt, timescale);
      alpha = r.alpha;
      for (let i = 0; i < r.steps; i++) {
        const c = sim.state.car;
        prev.x = c.x; prev.y = c.y; prev.z = c.z; prev.yaw = c.yaw;
        lastInput = source.read(dt, sim.state);
        const events = sim.step(lastInput, source.takeCommands());
        for (const ev of events) {
          warnings.push(ev, sim.state.t);
          if (ev.type === 'sector') { const b = bestSectors[ev.index]; if (b === null || ev.timeS < b!) bestSectors[ev.index] = ev.timeS; }
          if (ev.type === 'wallHit') wallHits++;
          else if (ev.type === 'lapEnd' && ev.valid && ev.best) saveBest(track.id, ev.timeS);
        }
      }
      const c = sim.state.car;
      cur.x = c.x; cur.y = c.y; cur.z = c.z; cur.yaw = c.yaw;
    } else if (state === 'paused') {
      alpha = 1;
    }

    // Pose interpolada; yaw por el camino corto
    const k = state === 'racing' ? alpha : 1;
    let dy = cur.yaw - prev.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const pose = {
      x: prev.x + (cur.x - prev.x) * k, y: prev.y + (cur.y - prev.y) * k,
      z: prev.z + (cur.z - prev.z) * k, yaw: prev.yaw + dy * k,
    };
    const cs = sim.state.car;
    car.position.set(pose.x, pose.y, pose.z);
    car.rotation.order = 'YZX';
    car.rotation.set(0, pose.yaw, cs.pitch);
    chase.update(pose, state === 'racing' ? frameDt : 0);

    renderer.render(scene, camera);
    const info = renderer.info.render;
    maxDraw = Math.max(maxDraw, info.calls);
    maxTris = Math.max(maxTris, info.triangles);
    dpr = renderer.getPixelRatio();

    hud.update(sim.state, state === 'racing' ? warnings.current(sim.state, sim.state.t) : '', bestSectors, sim.assists.autoShift);
    panel.update(now, {
      fps, drawCalls: info.calls, triangles: info.triangles, speedKmh: cs.speed * 3.6, s: cs.s, d: cs.d,
      surface: cs.surface, gLong: cs.aLong / config.sim.g, gLat: cs.aLat / config.sim.g,
      wheelLink: wheel ? wheel.link() : 'none', rttMs: wheel ? wheel.lastRttMs() : null,
    });
  };
  requestAnimationFrame((t) => { lastT = t; frame(t); });
}

setState('loading');
start().catch(showError);
