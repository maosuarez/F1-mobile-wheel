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

type GameState = 'loading' | 'ready' | 'racing' | 'paused' | 'error';

const params = new URLSearchParams(window.location.search);
const debug = params.get('debug') === '1';
const useAutopilot = debug && params.get('autopilot') === '1';
const tsRaw = Number(params.get('timescale'));
const timescale = debug && Number.isFinite(tsRaw) && tsRaw >= 1 ? Math.min(16, tsRaw) : 1;

const $ = (id: string) => document.getElementById(id)!;
let state: GameState = 'loading';

function setState(s: GameState): void {
  state = s;
  $('overlay-loading').hidden = s !== 'loading';
  $('overlay-start').hidden = s !== 'ready';
  $('overlay-pause').hidden = s !== 'paused';
  $('overlay-error').hidden = s !== 'error';
}

function showError(e: unknown): void {
  $('overlay-error').textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
  setState('error');
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

  const stepper = new FixedStepper(config.sim.dt, config.sim.maxSubSteps);
  const adapter = new KeyboardAdapter(window, {
    onRecenter: () => { if (state === 'racing') { sim.recenter(); syncPrev(); } },
    onPause: () => { if (state === 'racing') pause(); else if (state === 'paused') resume(); },
  });
  const source: InputSource = useAutopilot ? new AutopilotSource(track) : new KeyboardInput(adapter);

  let lastInput: DriverInput = NEUTRAL_INPUT;
  let wallHits = 0, maxDraw = 0, maxTris = 0, fps = 60, dpr = renderer.getPixelRatio();
  const prev = { x: 0, y: 0, z: 0, yaw: 0 };
  const cur = { x: 0, y: 0, z: 0, yaw: 0 };
  const syncPrev = () => {
    const c = sim.state.car;
    cur.x = prev.x = c.x; cur.y = prev.y = c.y; cur.z = prev.z = c.z; cur.yaw = prev.yaw = c.yaw;
  };
  syncPrev();

  const pause = () => { if (state === 'racing') setState('paused'); };
  const resume = () => { if (state === 'paused') { stepper.reset(); setState('racing'); } };
  const begin = () => { if (state === 'ready') { stepper.reset(); setState('racing'); } };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') { e.preventDefault(); panel.toggle(); return; }
    if (state === 'ready' && !e.metaKey && !e.ctrlKey && !e.altKey) begin();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
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
      };
    });
  }

  setState('ready');
  if (useAutopilot) begin();

  const dt = config.sim.dt;
  let lastT = performance.now();
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const frameDt = Math.min((now - lastT) / 1000, 1);
    lastT = now;
    if (frameDt > 0) fps += (1 / frameDt - fps) * 0.1;

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

    hud.update(cs.speed * 3.6, sim.state.timing);
    panel.update(now, {
      fps, drawCalls: info.calls, triangles: info.triangles, speedKmh: cs.speed * 3.6, s: cs.s, d: cs.d,
      surface: cs.surface, gLong: cs.aLong / config.sim.g, gLat: cs.aLat / config.sim.g,
    });
  };
  requestAnimationFrame((t) => { lastT = t; frame(t); });
}

setState('loading');
start().catch(showError);
