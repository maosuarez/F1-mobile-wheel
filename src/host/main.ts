import './hud.css';
import { config } from '../shared/config';
import { loadTrack } from '../track/load';
import { loadWorld, terrainHeight } from '../track/world';
import type { Simulation } from '../sim/simulation';
import { RaceController, parseRaceOptions, raceOptionDefaults, type RaceOptions } from './race/controller';
import { RivalsRender } from '../render/rivals';
import { RivalAudio } from '../audio/rivals';
import { TEAMS } from '../shared/teams';
import { RaceMenu, MenuPad, wheelMenuActions } from './race/menu';
import { Tower, towerEntries } from './race/tower';
import { ResultsView, resultsModel } from './race/results';
import { NEUTRAL_INPUT, type DriverInput } from '../sim/types';
import { applyQuality, createRenderer, createScene, loadHdriSky, objectCost, rendererName, resize, shadowStats, updateScene } from '../render/scene';
import { fetchAssetManifest, loadTrackTextures } from '../render/trackMaterials';
import { AdaptiveQuality, FpsMeter, QUALITY, initialQuality, type QualityLevel, type QualitySettings } from '../render/quality';
import { buildCar } from '../render/car';
import { TrackParticles } from '../render/particles';
import { PostFx } from '../render/post';
import { VR_QUALITY } from '../render/vrQuality';
import { VrSession } from './vr/session';
import { VrPanel } from './vr/panel';
import { VrMinimap } from './vr/minimap';
import type { PanelScreen, PanelRace } from './vr/panelModel';
import { hudModel } from './hudModel';
import * as THREE from 'three';
import { CameraRig } from '../render/cameras/rig';
import { EngineAudio } from '../audio/engine';
import { FxPlanner } from './net/fx';
import type { FxKey, EvKey } from '../shared/protocol';
import type { SimEvent } from '../sim/types';
import { FixedStepper } from './loop';
import { Hud } from './hud';
import { Minimap } from './minimap';
import { DebugPanel } from './debugPanel';
import { installDebugApi } from './debugApi';
import { loadBest, saveBest, loadRaceChoice, saveRaceChoice } from './storage';
import { KeyboardAdapter, KeyboardInput } from './input/keyboard';
import { AutopilotSource } from './input/autopilotSource';
import type { InputSource } from './input/types';
import { VrControllersSource, nextVrSource } from './input/vrControllers';
import { GamepadSource, nextGamepadSource } from './input/gamepad';
import { Autopilot } from '../sim/autopilot';
import { decodeAtHost, encode, generateRoomCode, type TelHint } from '../shared/protocol';
import { RoomClient } from './net/roomClient';
import { WheelSource } from './net/wheelSource';
import { WarningCenter } from './warnings';
import { buildTel } from './net/telemetry';
import { PairingUi, shouldShowWheelButton, wheelUrl, type RelayInfo } from './pairing';

type GameState = 'loading' | 'menu' | 'pairing' | 'countdown' | 'racing' | 'paused' | 'results' | 'error';
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
let resultsHide: (() => void) | null = null;   // quita los atajos de teclado de la tabla de resultados

function setState(s: GameState): void {
  state = s;
  audioRef?.setPaused(s !== 'racing');
  $('overlay-loading').hidden = s !== 'loading';
  $('overlay-pairing').hidden = s !== 'pairing';
  $('overlay-pause').hidden = !(s === 'paused' && pauseReason !== 'wheelLost');
  $('overlay-wheel-lost').hidden = !(s === 'paused' && pauseReason === 'wheelLost');
  $('overlay-error').hidden = s !== 'error';
  $('overlay-menu').hidden = s !== 'menu';
  $('overlay-results').hidden = s !== 'results';
  if (s !== 'results') resultsHide?.();
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

async function initWheelButton(): Promise<void> {
  const btn = document.querySelector<HTMLElement>('[data-testid="open-wheel"]');
  if (!btn) return;
  const coarse = window.matchMedia('(pointer: coarse) and (hover: none)').matches;
  if (!coarse) return;
  let vr = false;
  try { vr = (await navigator.xr?.isSessionSupported('immersive-vr')) ?? false; } catch { /* sin WebXR */ }
  btn.hidden = !shouldShowWheelButton(coarse, vr);
}
void initWheelButton();

async function start(): Promise<void> {
  // Entorno real en paralelo con la pista (b12, design D7): null → entorno procedural
  const TRACK_ID = 'interlagos';
  const [track, world] = await Promise.all([loadTrack(TRACK_ID), loadWorld(TRACK_ID)]);
  if (world) {
    const attr = $('attribution');
    attr.textContent = world.attribution;
    attr.hidden = false;
  }
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
  // Menú de modo (b14 D7). Salta si la URL elige modo/rivales/nivel/semilla, con piloto automático o en depuración
  // (salvo ?menu=1); entonces vale la URL, y sin `mode` la práctica de siempre.
  // Primer gesto (clic o tecla) del menú: se recuerda y desbloquea el audio en cuanto exista
  let gestured = false;
  const markGesture = () => { gestured = true; };
  window.addEventListener('pointerdown', markGesture, { once: true });
  window.addEventListener('keydown', markGesture, { once: true });
  const menuPad = new MenuPad(() => navigator.getGamepads?.() ?? []);
  const menuUi = new RaceMenu($('overlay-menu'), () => [
    ...(wheel ? wheelMenuActions(wheel.takeCommands(), wheel.takeUiEvents()) : []), ...menuPad.poll()]);
  const skipMenu = ['mode', 'rivals', 'ai', 'seed'].some((k) => params.has(k)) || useAutopilot || (debug && params.get('menu') !== '1');
  const chooseRaceOptions = async (skip: boolean): Promise<RaceOptions> => {
    if (skip) return parseRaceOptions(params) ?? { mode: 'practice', ...raceOptionDefaults(params) };
    setState('menu');
    const c = await menuUi.choose(raceOpts ?? loadRaceChoice() ?? { mode: 'practice', ai: 'medium', rivals: config.race.defaultRivals });
    saveRaceChoice(c);
    return { mode: c.mode, rivals: c.rivals, ai: c.ai, seed: raceOptionDefaults(params).seed };
  };
  let raceOpts: RaceOptions | null = null;
  raceOpts = await chooseRaceOptions(skipMenu);
  let race = new RaceController(track, raceOpts);
  let towerInfo = towerEntries(race.session.entries);
  let sim: Simulation = race.playerSim;
  sim.timer.setBestLap(loadBest(track.id));

  const canvas = $('game') as HTMLCanvasElement;
  const renderer = createRenderer(canvas, debug);
  // Con GL por software, nivel 'software' sin adaptación salvo ?quality= (design D1)
  const gpuName = rendererName(renderer);
  const q0 = initialQuality(qualityParam, gpuName);
  const gs = createScene(track, QUALITY[q0.level], world);
  const { scene, camera } = gs;
  const carVisual = buildCar();
  const car = carVisual.group;
  car.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  scene.add(car);
  // Rivales instanciados (b14 D6)
  const rivalsRender = new RivalsRender(TEAMS.map((t) => ({ primary: t.primary, accent: t.accent })));
  scene.add(rivalsRender.group);
  // Rig de escritorio: el ancla es la propia cámara (design D2). El rig VR se crea al entrar en la sesión
  // Cámaras exteriores sobre el terreno real (b12, design D9)
  const ground = world ? (x: number, z: number) => terrainHeight(world, x, z) : null;
  const deskRig = new CameraRig(camera, track, config, undefined, ground);
  let rig = deskRig;
  const audio = new EngineAudio(config);
  audioRef = audio;
  const rivalAudio = new RivalAudio(config);
  audio.setPaused(true);
  const fxPlanner = new FxPlanner(config.fx);
  const fxSent: Record<FxKey, number> = { kerb: 0, grass: 0, limits: 0, shift: 0, limiter: 0 };
  const unlockAudio = () => { void audio.start().catch(() => { /* sin audio */ }); };
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });
  window.removeEventListener('pointerdown', markGesture);
  window.removeEventListener('keydown', markGesture);
  if (gestured) unlockAudio();
  const hud = new Hud();
  const tower = new Tower();
  const resultsView = new ResultsView($('overlay-results'));
  resultsHide = () => resultsView.hide();
  const teamColors = TEAMS.map((t) => t.primary);
  const minimap = new Minimap(track, document.querySelector<HTMLCanvasElement>('[data-testid="hud-minimap"]')!);
  const panel = new DebugPanel();
  hud.show(true);
  const warnings = new WarningCenter();
  const bestSectors: (number | null)[] = [null, null, null];

  const stepper = new FixedStepper(config.sim.dt, config.sim.maxSubSteps);
  const adapter = new KeyboardAdapter(window, {
    onRecenter: () => { if (state === 'racing') { sim.recenter(); syncPrev(); } },
    onPause: () => togglePause(),
  });
  const keyboardSource = new KeyboardInput(adapter);
  let source: InputSource = useAutopilot ? new AutopilotSource(track) : keyboardSource;
  const setSource = (s: InputSource) => { source = s; sim.assists.autoShift = true; };
  const controllersSource = new VrControllersSource(renderer.xr);
  const gamepadSource = new GamepadSource(() => navigator.getGamepads?.() ?? []);

  // Mando USB (b10): aviso al conectarlo; la selección de fuente se sondea cada fotograma en updateGamepad
  window.addEventListener('gamepadconnected', (e) => { if (e.gamepad.mapping === 'standard') ui.toast('Mando conectado'); });
  window.addEventListener('gamepaddisconnected', (e) => { if (e.gamepad.mapping === 'standard') ui.toast('Mando desconectado'); });
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
  // Número a mostrar en cuenta atrás: segundos restantes (práctica) o luces encendidas (carrera)
  const countdownNumber = () => race.isRace ? String(race.lightsOn)
    : String(Math.max(1, Math.ceil((countdownEndMs - nowMs()) / 1000)));
  let pausedFrom: 'racing' | 'countdown' = 'racing';
  // Práctica: cuenta atrás de 3 s. Carrera: el semáforo (avanza con los pasos de la simulación)
  const startCountdown = () => {
    if (race.isRace) { race.startLights(); stepper.reset(); }
    else countdownEndMs = nowMs() + config.race.countdownS * 1000;
    setState('countdown');
  };
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

  // Reinicio (b9): solo en carrera, resultados o pausa de usuario; vuelve a parrilla con cuenta atrás (o semáforo).
  // Sala, fuente y cámara no cambian. En carrera se rehace la sesión con las mismas opciones
  const rebuild = (opts: RaceOptions) => {
    const assists = { ...sim.assists };
    race = new RaceController(track, opts);
    sim = race.playerSim;
    sim.assists = assists;
    sim.timer.setBestLap(loadBest(track.id));
    towerInfo = towerEntries(race.session.entries);
  };
  const resetCommon = () => {
    bestSectors.fill(null);
    syncPrev();
    controllersSource.reset();
    gamepadSource.reset();
    pauseReason = null;
    startCountdown();
  };
  const restartRace = () => {
    if (!(state === 'racing' || state === 'results' || (state === 'paused' && pauseReason === 'user'))) return;
    if (race.isRace) rebuild(raceOpts!); else sim.reset();
    resetCommon();
  };
  // Desde los resultados: vuelve al menú y arranca con la nueva elección
  const goMenu = async () => {
    if (state !== 'results') return;
    raceOpts = await chooseRaceOptions(false);
    rebuild(raceOpts);
    resetCommon();
  };
  const showResults = () => {
    const rows = resultsModel(race.standings(), race.session.entries, race.playerId, config.race.laps);
    resultsView.show(rows, restartRace, () => { void goMenu(); });
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
    if (!wheel || state === 'menu') return;    // en el menú, RaceMenu lee el volante
    for (const k of wheel.takeUiEvents() as EvKey[]) {
      if (k === 'pause' && source === wheel) togglePause();
      else if (k === 'cam') rig.next();
      else if (k === 'restart' && source === wheel) restartRace();
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

  // Mando USB (design D4): sustituye al teclado sin volante ni sesión VR; antes de updateControllers para que,
  // al entrar en VR, el teclado devuelto pase a los mandos en el mismo fotograma
  const updateGamepad = (dtMs: number) => {
    if (state === 'menu') return;                // en el menú, RaceMenu lee el mando
    // Pantalla de emparejamiento: Cruz u Options arrancan con el mando; solo el flanco, sin arrastrar el arranque
    const events = gamepadSource.pollUi(dtMs);
    if (state === 'pairing') {
      if (events.includes('recenter') || events.includes('pause')) { setSource(gamepadSource); startCountdown(); }
      gamepadSource.takeCommands();
      return;
    }
    // Triángulo = cámara; Options = pausa, Cruz = recolocar y Share mantenido = reiniciar, solo si conduce el mando
    for (const ev of events) {
      if (ev === 'camera') rig.next();
      else if (source !== gamepadSource) continue;
      else if (ev === 'pause') togglePause();
      else if (ev === 'restart') restartRace();
      else if (state === 'racing') { sim.recenter(); syncPrev(); }
    }
    if (source !== gamepadSource || state === 'paused') gamepadSource.takeCommands();   // órdenes sin efecto
    const next = nextGamepadSource(source, keyboardSource, gamepadSource, gamepadSource.connected(),
      wheel ? wheel.link() : 'none', inVr);
    if (next) setSource(next);
  };

  // Mandos VR (design D8): sustituyen al teclado solo en sesión VR y sin volante conectado; tras updateWheel
  const updateControllers = (dtMs: number) => {
    if (state === 'menu') return;
    // Botones de los mandos en VR: A = pausa (como P) o arranque en pairing, X = recolocar (como R),
    // clic de palanca izquierda = cámara en cualquier estado (b9, design D6)
    if (inVr) for (const ev of controllersSource.pollButtons(dtMs)) {
      if (ev === 'camera') rig.next();
      else if (ev === 'pause' && state === 'pairing') { setSource(controllersSource); controllersSource.reset(); startCountdown(); }
      else if (ev === 'pause') togglePause();
      else if (ev === 'restart') restartRace();
      else if (state === 'racing') { sim.recenter(); syncPrev(); }
    }
    if (source !== controllersSource || state === 'paused') controllersSource.takeCommands();   // órdenes sin efecto
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
    const warn = state === 'countdown' ? countdownNumber()
      : state === 'paused' ? 'PAUSA' : warnings.current(sim.state, sim.state.t);
    let dbg: TelHint | undefined;
    if (refPilot) {
      const r = refPilot.update(sim.state);
      dbg = { steer: r.input.steer, thr: r.input.throttle, brk: r.input.brake, gear: refPilot.suggestedGear(sim.state) };
    }
    const e = wheel.echo();
    const raceTel = race.isRace ? { pos: race.playerPos(), laps: config.race.laps } : undefined;
    client.send(encode(buildTel(sim.state, { warn, echo: e.ts, hold: e.holdMs, dbg, race: raceTel })));
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

  // Assets CC0 (b13, design D7): texturas fotoescaneadas y cielo HDRI; lo que falle conserva el respaldo procedural
  const assets = { textures: [] as string[], failed: [] as string[], hdri: null as boolean | null };
  void fetchAssetManifest().then(async (manifest) => {
    const anisotropy = Math.min(config.assets.anisotropy, renderer.capabilities.getMaxAnisotropy());
    // Perfil software (trackMaps = false): texturas de 1k y sin normal maps
    const opts = { normals: quality.trackMaps, anisotropy, maxPx: quality.trackMaps ? undefined : 1024 };
    const [tex, sky] = await Promise.all([loadTrackTextures(gs.meshes.materials, opts, manifest), loadHdriSky(gs, manifest)]);
    assets.textures = tex.loaded; assets.failed = tex.failed; assets.hdri = sky;
    if (sky) applyAll();
  });

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
  let vrMinimap: VrMinimap | null = null;
  const vr = new VrSession(renderer, $('vr-enter') as HTMLButtonElement, navigator, window.isSecureContext, {
    onStart: () => {
      inVr = true;
      vrRig ??= new CameraRig(camera, track, config, vrAnchor, ground);
      syncRigMode(vrRig, deskRig);
      rig = vrRig;
      scene.add(vrAnchor);
      vrAnchor.add(camera);
      camera.position.set(0, 0, 0);
      camera.quaternion.identity();
      vrPanel ??= new VrPanel();
      camera.add(vrPanel.mesh);
      vrMinimap ??= new VrMinimap(minimap.canvas);
      camera.add(vrMinimap.mesh);
      quality = VR_QUALITY;
      applyAll();
    },
    onEnd: () => {
      inVr = false;
      if (vrPanel) camera.remove(vrPanel.mesh);
      if (vrMinimap) camera.remove(vrMinimap.mesh);
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
        tracksideDrawCalls: objectCost(gs.trackside).drawCalls, tracksideTriangles: objectCost(gs.trackside).triangles,
        assets: { textures: [...assets.textures], failed: [...assets.failed], hdri: assets.hdri },
        race: race.debug(), rivalDrawCalls: rivalsRender.drawCalls, rivalsVisible: rivalsRender.visible, rivalVoices: rivalAudio.voices(),
      };
    }, canvas);
  }

  if (client) {
    // También evalúa el enlace del volante aquí: la pausa/reanudación no depende del render (updateWheel es idempotente)
    const telTimer = setInterval(() => { updateWheel(); sendTelemetry(); }, 1000 / config.net.telHz);
    window.addEventListener('pagehide', () => { clearInterval(telTimer); client?.close(); });
  }

  if (useAutopilot && race.isRace) startCountdown();
  else if (useAutopilot) { stepper.reset(); setState('racing'); }
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
    updateGamepad(frameDt * 1000);
    updateControllers(frameDt * 1000);
    if (state === 'countdown' && !race.isRace) {
      const left = (countdownEndMs - nowMs()) / 1000;           // coche retenido: la simulación no avanza
      if (left <= 0) { ui.setCountdown(null); stepper.reset(); setState('racing'); }
      else ui.setCountdown(Math.ceil(left));
    } else ui.setCountdown(null);

    let alpha = 1;
    const frameEvents: SimEvent[] = [];
    // Carrera: durante el semáforo también se dan pasos (RaceSession retiene los coches hasta el apagado)
    const stepping = state === 'racing' || (state === 'countdown' && race.isRace);
    if (stepping) {
      const r = stepper.advance(frameDt, timescale);
      alpha = r.alpha;
      for (let i = 0; i < r.steps; i++) {
        const c = sim.state.car;
        prev.x = c.x; prev.y = c.y; prev.z = c.z; prev.yaw = c.yaw;
        lastInput = source.read(dt, sim.state);
        const raceEvents = race.step(lastInput, source.takeCommands());
        const events = race.playerEvents(raceEvents);
        if (state === 'countdown' && race.phase !== 'grid' && race.phase !== 'lights') setState('racing');
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
      if (race.finished) { showResults(); setState('results'); }
    } else if (state === 'paused') {
      alpha = 1;
    }

    // Pose interpolada; yaw por el camino corto
    const k = stepping ? alpha : 1;
    let dy = cur.yaw - prev.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const pose = {
      x: prev.x + (cur.x - prev.x) * k, y: prev.y + (cur.y - prev.y) * k,
      z: prev.z + (cur.z - prev.z) * k, yaw: prev.yaw + dy * k,
    };
    const cs = sim.state.car;
    const camDt = stepping ? frameDt : 0;
    car.position.set(pose.x, pose.y, pose.z);
    car.rotation.order = 'YZX';
    car.rotation.set(0, pose.yaw, cs.pitch);
    carVisual.update(cs, camDt);
    rig.update({ ...pose, pitch: cs.pitch, roll: cs.roll }, cs, camDt, sim.state.t);
    updateScene(gs, pose.x, pose.y, pose.z, pose.yaw);
    rivalsRender.update(race.rivals(), k, camDt, camera);
    if (inVr) gs.sky.position.copy(vrAnchor.position);          // en VR camera.position es local a la cabeza
    audio.update(cs, camDt);
    rivalAudio.update(audio.output(), race.rivals(), pose, camera);
    if (state === 'racing' && ((client && source === wheel) || source === gamepadSource)) {
      const fk = fxPlanner.plan(frameEvents, cs, nowMs());
      if (fk) {
        if (source === gamepadSource) gamepadSource.rumble(fk);
        else if (client) { client.send(encode({ t: 'fx', k: fk })); fxSent[fk]++; }
      }
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
      const raceInfo = (): PanelRace => ({ pos: race.playerPos(), total: race.session.entries.length,
        lap: race.session.lapsDone(race.playerId) + 1, laps: config.race.laps });
      const screen: PanelScreen = state === 'pairing' ? { kind: 'pairing', room: ui.roomText, hint: ui.hintText }
        : state === 'countdown' ? { kind: 'countdown', n: Number(countdownNumber()) }
        : state === 'paused' ? { kind: 'paused' }
        : { kind: 'hud', model: hudModel(sim.state, state === 'racing' ? warnings.current(sim.state, sim.state.t) : '', bestSectors, sim.assists.autoShift),
          race: race.isRace ? raceInfo() : undefined };
      vrPanel.update(now, screen, ui.qrCanvas);
    }
    const lights = $('race-lights');
    lights.hidden = !(state === 'countdown' && race.isRace);
    if (!lights.hidden) lights.querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i < race.lightsOn));
    const raceHud = race.isRace && (state === 'racing' || state === 'countdown' || state === 'paused');
    tower.show(raceHud);
    if (raceHud) tower.update(() => race.standings(), towerInfo, race.playerId, config.race.laps, performance.now());
    hud.update(sim.state, state === 'racing' ? warnings.current(sim.state, sim.state.t) : '', bestSectors, sim.assists.autoShift);
    minimap.update(sim.state.car, performance.now(), race.rivals(), teamColors);
    if (inVr && vrMinimap) vrMinimap.update(minimap.version);
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
