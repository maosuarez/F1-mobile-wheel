import './hud.css';
import { config } from '../shared/config';
import { loadTrack } from '../track/load';
import { Simulation } from '../sim/simulation';
import { NEUTRAL_INPUT, type DriverInput } from '../sim/types';
import { applyQuality, createRenderer, createScene, objectCost, rendererName, resize, shadowStats, updateScene } from '../render/scene';
import { AdaptiveQuality, FpsMeter, QUALITY, initialQuality, type QualityLevel, type QualitySettings } from '../render/quality';
import { buildCar } from '../render/car';
import { TrackParticles } from '../render/particles';
import { PostFx } from '../render/post';
import { VR_QUALITY } from '../render/vrQuality';
import { VrSession } from './vr/session';
import { VrPanel } from './vr/panel';
import type { PanelScreen } from './vr/panelModel';
import { hudModel } from './hudModel';
import * as THREE from 'three';
import { CameraRig } from '../render/cameras/rig';
import { EngineAudio } from '../audio/engine';
import { FxPlanner } from './net/fx';
import type { FxKey, EvKey } from '../shared/protocol';
import type { SimEvent } from '../sim/types';
import { FixedStepper } from './loop';
import { Hud } from './hud';
import { DebugPanel } from './debugPanel';
import { installDebugApi } from './debugApi';
import { loadBest, saveBest } from './storage';
import { KeyboardAdapter, KeyboardInput } from './input/keyboard';
import { AutopilotSource } from './input/autopilotSource';
import type { InputSource } from './input/types';
import { VrControllersSource, nextVrSource } from './input/vrControllers';
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
// Calidad (design D1): ?quality= fija el nivel y bloquea la adaptación; ?post=0 desactiva el posproceso
const qualityParam = params.get('quality');
const noPost = params.get('post') === '0';
const QUALITY_LABEL: Record<QualityLevel, string> = { high: 'alta', medium: 'media', low: 'baja', software: 'software' };

const $ = (id: string) => document.getElementById(id)!;
let state: GameState = 'loading';
let pauseReason: PauseReason | null = null;
let audioRef: EngineAudio | null = null;

function setState(s: GameState): void {
  state = s;
  audioRef?.setPaused(s !== 'racing');
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
  const renderer = createRenderer(canvas, debug);
  // Con GL por software, nivel 'software' sin adaptación salvo ?quality= (design D1)
  const gpuName = rendererName(renderer);
  const q0 = initialQuality(qualityParam, gpuName);
  const gs = createScene(track, QUALITY[q0.level]);
  const { scene, camera } = gs;
  const carVisual = buildCar();
  const car = carVisual.group;
  car.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  scene.add(car);
  // Rig de escritorio: el ancla es la propia cámara (design D2). El rig VR se crea al entrar en la sesión
  const deskRig = new CameraRig(camera, track, config);
  let rig = deskRig;
  const audio = new EngineAudio(config);
  audioRef = audio;
  audio.setPaused(true);
  const fxPlanner = new FxPlanner(config.fx);
  const fxSent: Record<FxKey, number> = { kerb: 0, grass: 0, limits: 0, shift: 0, limiter: 0 };
  const unlockAudio = () => { void audio.start().catch(() => { /* sin audio */ }); };
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });
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
  const controllersSource = new VrControllersSource(renderer.xr);

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
    if (e.code === 'KeyC' && !e.repeat) { rig.next(); return; }
    if (e.code === 'KeyV' && !e.repeat) { audio.setMuted(!audio.muted); return; }
    if (e.code === 'F3') { e.preventDefault(); panel.toggle(); return; }
    if (state === 'pairing' && (e.code === 'Enter' || e.code === 'NumpadEnter')) { setSource(keyboardSource); startCountdown(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause('hidden'); });

  // Estado del volante: toma de control, eventos de interfaz, pérdida y reanudación
  const updateWheel = () => {
    if (!wheel) return;
    for (const k of wheel.takeUiEvents() as EvKey[]) {
      if (k === 'pause' && source === wheel) togglePause();
      else if (k === 'cam') rig.next();
    }
    if (source !== wheel) wheel.takeCommands();                 // órdenes sin efecto si no controla el volante
    const link = wheel.link();
    if (link === 'ok') {
      if (state === 'pairing') { setSource(wheel); startCountdown(); }
      else if (source !== wheel && (state === 'countdown' || state === 'racing' || state === 'paused')) {
        setSource(wheel); ui.toast('Volante conectado');
      } else if (state === 'paused' && pauseReason === 'wheelLost') resume();
    } else if (link === 'lost' && source === wheel) pause('wheelLost');
  };

  // Mandos VR (design D8): sustituyen al teclado solo en sesión VR y sin volante conectado; tras updateWheel
  const updateControllers = () => {
    // Botones de los mandos en VR: A = pausa (como P), X = recolocar (como R)
    if (inVr) for (const ev of controllersSource.pollButtons()) {
      if (ev === 'pause') togglePause();
      else if (state === 'racing') { sim.recenter(); syncPrev(); }
    }
    const next = nextVrSource(source, keyboardSource, controllersSource, inVr, wheel ? wheel.link() : 'none');
    if (!next) return;
    if (next === controllersSource) controllersSource.reset();
    setSource(next);
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
  // Calidad adaptativa: empieza en high salvo ?quality= o GL por software, nunca vuelve a subir
  const adaptive = new AdaptiveQuality(config.quality, q0.level, q0.locked);
  const fpsMeter = new FpsMeter(config.quality.meterFrames);
  const settingsFor = (l: QualityLevel): QualitySettings => ({ ...QUALITY[l], post: QUALITY[l].post && !noPost });
  let quality = settingsFor(adaptive.level);
  // Partículas (design D6) y posproceso (design D7) según el nivel de calidad
  const particles = new TrackParticles(quality.particles);
  scene.add(particles.points);
  const post = new PostFx(renderer, scene, camera);
  // El compositor hace varios render(): el contador de draw calls se reinicia una vez por fotograma
  renderer.info.autoReset = false;
  const applyAll = () => {
    applyQuality(renderer, camera, quality, gs);
    particles.setCapacity(quality.particles);
    post.apply(quality);
  };
  window.addEventListener('resize', () => {
    if (renderer.xr.isPresenting) return;                       // en VR el tamaño lo fija el visor
    resize(renderer, camera, quality.dpr); post.syncSize();
  });
  applyAll();

  // Modo VR (b7): perfil fijo VR_QUALITY sin adaptativo ni posproceso; cámara hija del ancla (design D2/D3)
  const vrAnchor = new THREE.Object3D();
  let vrRig: CameraRig | null = null;
  // Copia el modo de cámara activo; next() siempre fuerza un corte (snap) en el siguiente update
  const syncRigMode = (to: CameraRig, from: CameraRig) => {
    const target = from.debug().mode;
    do to.next(); while (to.debug().mode !== target);
  };
  let inVr = false;
  let vrPanel: VrPanel | null = null;
  const vr = new VrSession(renderer, $('vr-enter') as HTMLButtonElement, navigator, window.isSecureContext, {
    onStart: () => {
      inVr = true;
      vrRig ??= new CameraRig(camera, track, config, vrAnchor);
      syncRigMode(vrRig, deskRig);
      rig = vrRig;
      scene.add(vrAnchor);
      vrAnchor.add(camera);
      camera.position.set(0, 0, 0);
      camera.quaternion.identity();
      vrPanel ??= new VrPanel();
      camera.add(vrPanel.mesh);
      quality = VR_QUALITY;
      applyAll();
    },
    onEnd: () => {
      inVr = false;
      if (vrPanel) camera.remove(vrPanel.mesh);
      vrAnchor.remove(camera);
      scene.remove(vrAnchor);
      if (vrRig) syncRigMode(deskRig, vrRig);
      rig = deskRig;
      quality = settingsFor(adaptive.level);
      applyAll();
    },
    onError: (e) => ui.toast(`No se pudo entrar en VR: ${e instanceof Error ? e.message : String(e)}`),
  });
  void vr.init();

  if (debug) {
    const carCost = objectCost(car);
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
        pauseReason, audio: audio.debug(), camera: rig.debug(), fxSent: { ...fxSent },
        quality: adaptive.level, rendererName: gpuName, ...shadowStats(scene, renderer), post: quality.post,
        particlesActive: particles.debug().active, fpsAvg: fpsMeter.avg(), fpsP5: fpsMeter.p5(),
        carDrawCalls: carCost.drawCalls, carTriangles: carCost.triangles, envDrawCalls: objectCost(gs.env).drawCalls,
      };
    }, canvas);
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
  // Bucle único con setAnimationLoop (design D1): también dispara durante una sesión WebXR
  let firstFrame = true;
  const frame = (now: number) => {
    if (firstFrame) { firstFrame = false; lastT = now; }   // igual que el arranque anterior: primer dt = 0
    const frameDt = Math.min((now - lastT) / 1000, 1);
    lastT = now;
    if (frameDt > 0) fps += (1 / frameDt - fps) * 0.1;
    // Solo cuentan los fotogramas de juego activo con la pestaña visible
    const active = (state === 'racing' || state === 'countdown') && !document.hidden;
    if (active) fpsMeter.push(frameDt);
    const lowered = inVr ? null : adaptive.sample(frameDt, active);
    if (lowered) {
      quality = settingsFor(lowered);
      applyAll();
      ui.toast(`Calidad gráfica reducida a ${QUALITY_LABEL[lowered]}`);
    }

    updateWheel();
    updateControllers();
    if (state === 'countdown') {
      const left = (countdownEndMs - nowMs()) / 1000;           // coche retenido: la simulación no avanza
      if (left <= 0) { ui.setCountdown(null); stepper.reset(); setState('racing'); }
      else ui.setCountdown(Math.ceil(left));
    } else ui.setCountdown(null);

    let alpha = 1;
    const frameEvents: SimEvent[] = [];
    if (state === 'racing') {
      const r = stepper.advance(frameDt, timescale);
      alpha = r.alpha;
      for (let i = 0; i < r.steps; i++) {
        const c = sim.state.car;
        prev.x = c.x; prev.y = c.y; prev.z = c.z; prev.yaw = c.yaw;
        lastInput = source.read(dt, sim.state);
        const events = sim.step(lastInput, source.takeCommands());
        for (const ev of events) {
          frameEvents.push(ev);
          audio.onEvent(ev);
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
    const camDt = state === 'racing' ? frameDt : 0;
    car.position.set(pose.x, pose.y, pose.z);
    car.rotation.order = 'YZX';
    car.rotation.set(0, pose.yaw, cs.pitch);
    carVisual.update(cs, camDt);
    rig.update({ ...pose, pitch: cs.pitch, roll: cs.roll }, cs, camDt, sim.state.t);
    updateScene(gs, pose.x, pose.y, pose.z, pose.yaw);
    if (inVr) gs.sky.position.copy(vrAnchor.position);          // en VR camera.position es local a la cabeza
    audio.update(cs, camDt);
    if (client && source === wheel && state === 'racing') {
      const fk = fxPlanner.plan(frameEvents, cs, nowMs());
      if (fk) { client.send(encode({ t: 'fx', k: fk })); fxSent[fk]++; }
    }

    particles.update(cs, pose, sim.state.t);
    particles.setView(renderer.domElement.height, camera.fov);
    renderer.info.reset();
    if (inVr) renderer.render(scene, camera);                   // VR: sin posproceso, estéreo vía WebXR
    else post.render();
    const info = renderer.info.render;
    maxDraw = Math.max(maxDraw, info.calls);
    maxTris = Math.max(maxTris, info.triangles);
    dpr = renderer.getPixelRatio();

    if (inVr && vrPanel) {
      const screen: PanelScreen = state === 'pairing' ? { kind: 'pairing', room: ui.roomText, hint: ui.hintText }
        : state === 'countdown' ? { kind: 'countdown', n: Math.max(1, Math.ceil((countdownEndMs - nowMs()) / 1000)) }
        : state === 'paused' ? { kind: 'paused' }
        : { kind: 'hud', model: hudModel(sim.state, state === 'racing' ? warnings.current(sim.state, sim.state.t) : '', bestSectors, sim.assists.autoShift) };
      vrPanel.update(now, screen, ui.qrCanvas);
    }
    hud.update(sim.state, state === 'racing' ? warnings.current(sim.state, sim.state.t) : '', bestSectors, sim.assists.autoShift);
    panel.update(now, {
      fps, quality: adaptive.level, drawCalls: info.calls, triangles: info.triangles, speedKmh: cs.speed * 3.6, s: cs.s, d: cs.d,
      surface: cs.surface, gLong: cs.aLong / config.sim.g, gLat: cs.aLat / config.sim.g,
      wheelLink: wheel ? wheel.link() : 'none', rttMs: wheel ? wheel.lastRttMs() : null,
    });
  };
  renderer.setAnimationLoop(frame);
}

setState('loading');
start().catch(showError);
