import './hud.css';
import { config } from '../shared/config';
import { loadTrack } from '../track/load';
import { loadWorld, terrainHeight } from '../track/world';
import type { Simulation } from '../sim/simulation';
import type { RaceEvent } from '../sim/race';
import { RaceController, parseRaceOptions, raceOptionDefaults, type RaceOptions } from './race/controller';
import { RivalsRender } from '../render/rivals';
import { RivalAudio } from '../audio/rivals';
import { TEAMS } from '../shared/teams';
import { loadTrackChoice, resolveTrackId, saveTrackChoice, trackById, trackUrl } from '../shared/tracks';
import { RaceMenu, MenuPad, wheelMenuActions, type MenuChoice } from './race/menu';
import { Tower, TOWER_HZ, towerEntries } from './race/tower';
import { ResultsView, resultsModel } from './race/results';
import { NEUTRAL_INPUT, type DriverCommand, type DriverInput } from '../sim/types';
import { applyQuality, createRenderer, createScene, loadHdriSky, objectCost, rendererName, resize, shadowStats, updateScene } from '../render/scene';
import { fetchAssetManifest, loadTrackTextures } from '../render/trackMaterials';
import { AdaptiveQuality, FpsMeter, QUALITY, initialQuality, type QualityLevel, type QualitySettings } from '../render/quality';
import { buildCar, type CarVisual } from '../render/car';
import { TrackParticles } from '../render/particles';
import { PostFx } from '../render/post';
import { postConfigFor } from '../render/night';
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
import { HudView } from './hud';
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
import { parsePlayers, assignSources, keyboardLayoutFor, PLAYER_COLORS, PLAYER_LABELS, type PlayerRoom } from './split/players';
import { capQuality } from './split/layout';
import { SplitRenderer } from './split/render';
import { PairingUi, shouldShowWheelButton, wheelUrl, type RelayInfo } from './pairing';
import { onlineGrid } from './online/client';
import { LobbyView, gridTeams, nameCode, parseOnlineParams, resStandings, type LobbyResult } from './online/lobby';

type GameState = 'loading' | 'menu' | 'lobby' | 'pairing' | 'countdown' | 'racing' | 'paused' | 'results' | 'error';
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
let audioRefs: EngineAudio[] = [];   // un motor por jugador local (b15 D5)
let resultsHide: (() => void) | null = null;   // quita los atajos de teclado de la tabla de resultados

function setState(s: GameState): void {
  state = s;
  for (const a of audioRefs) a.setPaused(s !== 'racing');
  $('overlay-loading').hidden = s !== 'loading';
  $('overlay-pairing').hidden = s !== 'pairing';
  $('overlay-pause').hidden = !(s === 'paused' && pauseReason !== 'wheelLost');
  $('overlay-wheel-lost').hidden = !(s === 'paused' && pauseReason === 'wheelLost');
  $('overlay-error').hidden = s !== 'error';
  $('overlay-menu').hidden = s !== 'menu';
  $('overlay-lobby').hidden = s !== 'lobby';
  $('overlay-results').hidden = s !== 'results';
  if (s !== 'results') resultsHide?.();
}

function showError(e: unknown): void {
  $('overlay-error').textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
  setState('error');
}

// Circuito desconocido en ?track= (b17 D4): mensaje legible y botón para volver al menú sin el parámetro
function showUnknownTrack(id: string): void {
  const el = $('overlay-error');
  el.textContent = '';
  const msg = document.createElement('div');
  msg.textContent = `Circuito desconocido: «${id}»`;
  const back = document.createElement('a');
  const u = new URL(window.location.href);
  u.searchParams.delete('track');
  back.href = u.toString();
  back.className = 'menu-start';
  back.dataset.testid = 'error-back';
  back.textContent = 'Volver al menú';
  el.append(msg, back);
  setState('error');
}

// Recarga con otro circuito: se recuerda la elección (b17 D4)
function reloadWithTrack(id: string, extra: Record<string, string | null> = {}): void {
  saveTrackChoice(id);
  window.location.href = trackUrl(window.location.href, id, extra);
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
  // Circuito (b17 D4): ?track= > elección recordada > interlagos. Id desconocido → error con vuelta al menú
  const TRACK_ID = resolveTrackId(params.get('track'), loadTrackChoice());
  const trackInfo = trackById(TRACK_ID);
  if (!trackInfo) { showUnknownTrack(TRACK_ID); return; }
  // Entorno real en paralelo con la pista (b12, design D7): null → entorno procedural
  const [track, world] = await Promise.all([loadTrack(TRACK_ID), loadWorld(TRACK_ID)]);
  if (world) {
    const attr = $('attribution');
    attr.textContent = world.attribution;
    attr.hidden = false;
  }
  // Volante: sala del relay (no se abre con ?autopilot=1)
  const ui = new PairingUi();
  const nowMs = () => performance.now();
  // Una sala del relay y una WheelSource por jugador (b15 D1). J1 se abre al inicio (el menú usa su volante);
  // J2 se abre en cuanto el menú o la URL eligen 2 jugadores. `playerRooms` es el punto de enganche del grupo 2.
  const port = window.location.port;
  let relayInfo: RelayInfo | null = null;
  let everOpen = false;
  const playerRooms: PlayerRoom[] = [];
  const showRoom = (r: PlayerRoom) => {
    const { url, mode } = wheelUrl(window.location, relayInfo, r.room);
    ui.setRoom(r.room, url, mode, port, r.index);
  };
  const openRoom = (index: number): PlayerRoom => {
    let room = generateRoomCode();
    while (playerRooms.some((p) => p.room === room)) room = generateRoomCode();
    const w = new WheelSource(config, nowMs);
    const c = new RoomClient('host', room);
    c.onStatus = (st) => {
      if (st === 'open') { everOpen = true; ui.setRelayDown(false); }
      else if (st === 'closed' && !everOpen) ui.setRelayDown(true);
    };
    c.onMessage = (raw) => {
      const m = decodeAtHost(raw);
      if (m && m.t !== 'ping') w.handleMessage(m);
    };
    const r: PlayerRoom = { index, room, wheel: w, client: c };
    playerRooms.push(r);
    showRoom(r);
    c.connect();
    return r;
  };
  const room0 = useAutopilot ? null : openRoom(0);
  const wheel: WheelSource | null = room0 ? room0.wheel : null;
  if (room0) void fetchRelayInfo().then((info) => {
    relayInfo = info;
    if (info) playerRooms.forEach(showRoom); else ui.setRelayDown(true);
  });
  // Menú de modo (b14 D7). Salta si la URL elige modo/rivales/nivel/semilla, con piloto automático o en depuración
  // (salvo ?menu=1); entonces vale la URL, y sin `mode` la práctica de siempre.
  // Primer gesto (clic o tecla) del menú: se recuerda y desbloquea el audio en cuanto exista
  let gestured = false;
  const markGesture = () => { gestured = true; };
  window.addEventListener('pointerdown', markGesture, { once: true });
  window.addEventListener('keydown', markGesture, { once: true });
  const menuPad = new MenuPad(() => navigator.getGamepads?.() ?? []);
  const menuUi = new RaceMenu($('overlay-menu'), () => [
    ...(wheel ? wheelMenuActions(wheel.takeCommands(), wheel.takeUiEvents()) : []), ...menuPad.poll()],
  (c: MenuChoice) => {
    // Otro circuito: se guarda el resto de la elección y se recarga con ?track=
    const { track: t, ...rest } = c;
    saveRaceChoice(rest);
    if (t) reloadWithTrack(t);
  });
  const skipMenu = ['mode', 'rivals', 'ai', 'seed', 'players'].some((k) => params.has(k)) || useAutopilot || (debug && params.get('menu') !== '1');
  // Online (b16): `online=create|join` (parámetros en online/lobby.ts) abre el vestíbulo sin menú; no con players=2
  const urlOnline = parsePlayers(params) === 2 ? null : parseOnlineParams(params);
  const chooseRaceOptions = async (skip: boolean): Promise<RaceOptions> => {
    if (urlOnline && skip) return { mode: 'online', ...raceOptionDefaults(params) };
    if (skip) return parseRaceOptions(params) ?? { mode: 'practice', ...raceOptionDefaults(params) };
    setState('menu');
    const prev = raceOpts && raceOpts.mode !== 'online' ? { mode: raceOpts.mode, ai: raceOpts.ai, rivals: raceOpts.rivals } : null;
    const saved = prev ?? loadRaceChoice() ?? { mode: 'practice', ai: 'medium', rivals: config.race.defaultRivals };
    const c = await menuUi.choose({ ...saved, players: urlPlayers ?? loadRaceChoice()?.players ?? 1, track: track.id });
    const { online: wantsOnline, track: _t, ...choice } = c;
    saveRaceChoice(choice);
    players = c.players === 2 ? 2 : 1;
    if (wantsOnline) return { mode: 'online', rivals: c.rivals, ai: c.ai, seed: raceOptionDefaults(params).seed };
    return { mode: c.mode, rivals: c.rivals, ai: c.ai, seed: raceOptionDefaults(params).seed };
  };
  // Vestíbulo online: tras "Online" en el menú (o la URL). "Volver" regresa al menú
  const lobby = new LobbyView($('overlay-lobby'), config);
  let online = null as LobbyResult | null;
  const chooseWithLobby = async (skip: boolean): Promise<RaceOptions> => {
    for (;;) {
      const o = await chooseRaceOptions(skip);
      if (o.mode !== 'online') return o;
      setState('lobby');
      const r = await lobby.run({ params: skip ? urlOnline : null, track: track.id, laps: config.race.laps,
        seed: () => raceOptionDefaults(params).seed, wheelCode: room0 ? room0.room : null,
        // Cliente con otro circuito que el del propietario: recarga y vuelve a la sala antes del semáforo
        onTrackMismatch: (t, code, name) => reloadWithTrack(t, { online: 'join', code, name, autostart: null }) });
      if (r) { online = r; return { mode: 'online', rivals: r.cfg.rivals, ai: r.cfg.ai, seed: r.cfg.seed, laps: r.cfg.laps }; }
      skip = false;
    }
  };
  let raceOpts: RaceOptions | null = null;
  // Nº de jugadores locales: URL `players=2` > menú (recordado) > 1. Lo consume el grupo 2 (render dividido)
  const urlPlayers = parsePlayers(params);
  let players: 1 | 2 = urlPlayers ?? 1;
  raceOpts = await chooseWithLobby(skipMenu || urlOnline !== null);
  if (players === 2 && !useAutopilot) {
    ui.setPlayerCount(2);
    openRoom(1);
    // Estado de enlace por jugador en la tarjeta de emparejamiento
    window.setInterval(() => playerRooms.forEach((r) => ui.setConnected(r.index, r.wheel.link() === 'ok')), 250);
  }
  // Pantalla dividida (b15): con 2 jugadores, una entrada humana, cámara, HUD, minimapa y motor por jugador
  const split = players === 2;
  const nP: number = players;
  // Online: parrilla común (onlineGrid) con escudería por plaza; el cliente se une a la sesión (D4/D5)
  let humanSeats: number[] = [];
  const seatIsHuman = (id: number) => humanSeats.includes(id);
  const makeRace = (opts: RaceOptions): RaceController => {
    if (!online || opts.mode !== 'online') return new RaceController(track, opts, config, nP);
    const c = online.client;
    const grid = gridTeams(onlineGrid(online.cfg, c.you, c.isOwner, c.players));
    humanSeats = grid.seats.filter((q) => q.slot !== null).map((q) => q.entryId);
    const rc = new RaceController(track, opts, config, 1, grid);
    c.attach(rc.session, grid, track.length);
    rc.beforeStep = () => c.beforeStep();
    return rc;
  };
  let race = makeRace(raceOpts);
  // Torre: online, los humanos llevan las 3 primeras letras de su nombre
  const towerOf = (r: RaceController) => towerEntries(r.session.entries)
    .map((t, i) => (r.isOnline && r.session.entries[i].kind !== 'ai' && seatIsHuman(i) ? { ...t, code: nameCode(r.session.entries[i].name) } : t));
  let towerInfo = towerOf(race);

  const canvas = $('game') as HTMLCanvasElement;
  const renderer = createRenderer(canvas, debug);
  // Con GL por software, nivel 'software' sin adaptación salvo ?quality= (design D1)
  const gpuName = rendererName(renderer);
  const q0 = initialQuality(qualityParam, gpuName);
  // Con 2 jugadores la calidad no pasa de config.split.maxQuality (b15 D3)
  const capLevel = (l: QualityLevel): QualityLevel => (split ? capQuality(l, config.split.maxQuality) : l);
  // Iluminación, HDRI y suelo del circuito (b18 D2): sin cambios para circuitos de día
  const gs = createScene(track, QUALITY[capLevel(q0.level)], world, trackInfo);
  const { scene, camera } = gs;
  const carVisual = buildCar();
  const car = carVisual.group;
  car.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  scene.add(car);
  // J2: segunda copia del modelo detallado con el acento de su color (b15 D3)
  const carVisual2 = split ? buildCar({ ...config, carVisual: { ...config.carVisual, colors: { ...config.carVisual.colors, accent: PLAYER_COLORS[1] } } }) : null;
  if (carVisual2) {
    carVisual2.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    scene.add(carVisual2.group);
  }
  // Rivales instanciados (b14 D6)
  const rivalsRender = new RivalsRender(TEAMS.map((t) => ({ primary: t.primary, accent: t.accent })));
  scene.add(rivalsRender.group);
  // Rig de escritorio: el ancla es la propia cámara (design D2). El rig VR se crea al entrar en la sesión
  // Cámaras exteriores sobre el terreno real (b12, design D9)
  const ground = world ? (x: number, z: number) => terrainHeight(world, x, z) : null;
  const deskRig = new CameraRig(camera, track, config, undefined, ground);
  let rig = deskRig;
  // Motor por jugador humano; con 2, cada uno a split.engineGain y sin paneo (b15 D5)
  const audioCfg = split ? { ...config, audio: { ...config.audio, masterGain: config.audio.masterGain * config.split.engineGain } } : config;
  const audio = new EngineAudio(audioCfg);
  const rivalAudio = new RivalAudio(config);
  const fxSent: Record<FxKey, number> = { kerb: 0, grass: 0, limits: 0, shift: 0, limiter: 0 };
  // HUD: J1 en #hud-p1; con 2 jugadores, J2 en #hud-p2 (copia de la plantilla de J1) y torre compartida (b15 D4)
  const hudRoot = $('hud');
  const hudP2 = $('hud-p2');
  if (split) {
    hudP2.innerHTML = $('hud-p1').innerHTML;
    hudP2.querySelector('[data-testid="hud-tag"]')!.textContent = PLAYER_LABELS[1];
  }
  hudRoot.classList.toggle('split', split);
  hudP2.hidden = !split;
  $('race-hud').classList.toggle('split', split);
  $('split-fx').hidden = !split;
  const tower = new Tower();
  const resultsView = new ResultsView($('overlay-results'));
  resultsHide = () => resultsView.hide();
  const teamColors = TEAMS.map((t) => t.primary);
  const panel = new DebugPanel();
  hudRoot.hidden = false;

  const stepper = new FixedStepper(config.sim.dt, config.sim.maxSubSteps);
  const adapter = new KeyboardAdapter(window, {
    onRecenter: () => { if (state === 'racing') { p1.sim.recenter(); syncPrev(p1); } },
    onPause: () => togglePause(),
  });
  const padProvider = () => navigator.getGamepads?.() ?? [];

  // Jugador local: simulación, fuentes de entrada, cámara, HUD, minimapa, motor y avisos propios
  interface Pose4 { x: number; y: number; z: number; yaw: number }
  interface Pilot {
    index: number; sim: Simulation; source: InputSource; keyboard: KeyboardInput; gamepad: GamepadSource;
    wheel: WheelSource | null; client: RoomClient | null; room: string | null;
    camera: THREE.PerspectiveCamera; rig: CameraRig; car: CarVisual; hud: HudView; minimap: Minimap;
    audio: EngineAudio; warnings: WarningCenter; fx: FxPlanner; bestSectors: (number | null)[];
    prev: Pose4; cur: Pose4; pose: Pose4; lastInput: DriverInput; events: SimEvent[];
  }
  const makePilot = (i: number): Pilot => {
    const pr = playerRooms[i] ?? null;
    const keyboard = new KeyboardInput(adapter, keyboardLayoutFor(nP, i));
    const cam = i === 0 ? camera : new THREE.PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
    const root = i === 0 ? $('hud-p1') : hudP2;
    return {
      index: i, sim: race.humanSims[i], keyboard,
      source: useAutopilot ? new AutopilotSource(track) : keyboard,
      // Con 2 jugadores, el mando del índice del jugador (b15 D2); con 1, el primer mando estándar
      gamepad: split ? new GamepadSource(padProvider, config.gamepad, i) : new GamepadSource(padProvider),
      wheel: pr ? pr.wheel : null, client: pr ? pr.client : null, room: pr ? pr.room : null,
      camera: cam, rig: i === 0 ? deskRig : new CameraRig(cam, track, config, undefined, ground),
      car: i === 0 ? carVisual : carVisual2!,
      hud: new HudView(root),
      minimap: new Minimap(track, root.querySelector<HTMLCanvasElement>('[data-testid="hud-minimap"]')!, split ? PLAYER_COLORS[i] : undefined),
      audio: i === 0 ? audio : new EngineAudio(audioCfg),
      warnings: new WarningCenter(), fx: new FxPlanner(config.fx), bestSectors: [null, null, null],
      prev: { x: 0, y: 0, z: 0, yaw: 0 }, cur: { x: 0, y: 0, z: 0, yaw: 0 }, pose: { x: 0, y: 0, z: 0, yaw: 0 },
      lastInput: NEUTRAL_INPUT, events: [],
    };
  };
  const pilots: Pilot[] = Array.from({ length: nP }, (_, i) => makePilot(i));
  const p1 = pilots[0];
  audioRefs = pilots.map((p) => p.audio);
  audioRefs.forEach((a) => a.setPaused(true));
  const unlockAudio = () => { for (const a of audioRefs) void a.start().catch(() => { /* sin audio */ }); };
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });
  window.removeEventListener('pointerdown', markGesture);
  window.removeEventListener('keydown', markGesture);
  if (gestured) unlockAudio();
  const setSource = (p: Pilot, s: InputSource) => { p.source = s; p.sim.assists.autoShift = true; };
  const controllersSource = new VrControllersSource(renderer.xr);
  const label = (p: Pilot) => (split ? ` ${PLAYER_LABELS[p.index]}` : '');
  // Cámara activa del jugador: la de VR para J1 en sesión inmersiva
  const rigOf = (p: Pilot) => (p.index === 0 ? rig : p.rig);

  // Mando USB (b10): aviso al conectarlo; la selección de fuente se sondea cada fotograma en updateGamepad
  window.addEventListener('gamepadconnected', (e) => { if (e.gamepad.mapping === 'standard') ui.toast('Mando conectado'); });
  window.addEventListener('gamepaddisconnected', (e) => { if (e.gamepad.mapping === 'standard') ui.toast('Mando desconectado'); });
  const refPilot = debug && wheel ? new Autopilot(track) : null;     // sugerencia `dbg` del tel

  let wallHits = 0, maxDraw = 0, maxTris = 0, fps = 60, dpr = renderer.getPixelRatio();
  const syncPrev = (p: Pilot) => {
    const c = p.sim.state.car;
    p.cur.x = p.prev.x = c.x; p.cur.y = p.prev.y = c.y; p.cur.z = p.prev.z = c.z; p.cur.yaw = p.prev.yaw = c.yaw;
  };
  pilots.forEach((p) => { p.sim.timer.setBestLap(loadBest(track.id)); syncPrev(p); });

  let countdownEndMs = 0;
  // Número a mostrar en cuenta atrás: segundos restantes (práctica) o luces encendidas (carrera)
  const countdownNumber = () => race.isRace ? String(race.lightsOn)
    : String(Math.max(1, Math.ceil((countdownEndMs - nowMs()) / 1000)));
  let pausedFrom: 'racing' | 'countdown' = 'racing';
  let lostPlayer = 0;     // jugador cuyo volante provocó la pausa 'wheelLost' (b15 D6)
  // Práctica: cuenta atrás de 3 s. Carrera: el semáforo (avanza con los pasos de la simulación)
  const startCountdown = () => {
    if (race.isOnline) { stepper.reset(); setState('countdown'); return; }   // el semáforo lo da el reloj del servidor
    if (race.isRace) { race.startLights(); stepper.reset(); }
    else countdownEndMs = nowMs() + config.race.countdownS * 1000;
    setState('countdown');
  };
  // Cualquiera pausa para ambos (b15 D6)
  const pause = (reason: PauseReason, who = 0) => {
    if (state !== 'racing' && state !== 'countdown') return;
    if (race.isOnline) return;                    // online no se pausa (la carrera sigue en los demás PCs)
    pausedFrom = state;
    pauseReason = reason;
    if (reason === 'wheelLost') { lostPlayer = who; ui.setLostPlayer(who, split); }
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
    const assists = pilots.map((p) => ({ ...p.sim.assists }));
    race = makeRace(opts);
    pilots.forEach((p, i) => {
      p.sim = race.humanSims[i];
      p.sim.assists = assists[i];
      p.sim.timer.setBestLap(loadBest(track.id));
    });
    towerInfo = towerOf(race);
  };
  const resetCommon = () => {
    for (const p of pilots) { p.bestSectors.fill(null); syncPrev(p); p.gamepad.reset(); }
    controllersSource.reset();
    pauseReason = null;
    startCountdown();
  };
  // Online: salir de la sala y volver al menú sin los parámetros online (recarga)
  const leaveOnline = () => {
    online?.client.close();
    const q = new URLSearchParams(window.location.search);
    for (const k of ['online', 'code', 'name', 'autostart', 'laps', 'dropst']) q.delete(k);
    q.set('menu', '1');
    window.location.search = q.toString();
  };
  const restartRace = () => {
    if (race.isOnline) { if (state === 'results') leaveOnline(); return; }
    if (!(state === 'racing' || state === 'results' || (state === 'paused' && pauseReason === 'user'))) return;
    if (race.isRace) rebuild(raceOpts!);
    else if (split) pilots.forEach((p, i) => p.sim.placeOnGrid(i));   // práctica a 2: plazas 0 y 1 de la parrilla
    else p1.sim.reset();
    resetCommon();
  };
  // Desde los resultados: vuelve al menú y arranca con la nueva elección. Cambiar el nº de jugadores recarga la página
  // con la elección en la URL (la vista dividida se monta al arrancar)
  const goMenu = async () => {
    if (state !== 'results') return;
    if (race.isOnline) { leaveOnline(); return; }
    const before = players;
    raceOpts = await chooseRaceOptions(false);
    if (players !== before) {
      const q = new URLSearchParams(window.location.search);
      q.set('mode', raceOpts.mode); q.set('rivals', String(raceOpts.rivals)); q.set('ai', raceOpts.ai); q.set('players', String(players));
      window.location.search = q.toString();
      return;
    }
    rebuild(raceOpts);
    resetCommon();
  };
  const showResults = () => {
    // Online: la tabla `res` del propietario (o la clasificación local si no llega en net.resultsWaitS)
    const res = online && race.isOnline ? online.client.results : null;
    const standings = res ? resStandings(res.rows) : race.standings();
    const rows = resultsModel(standings, race.session.entries, race.playerId, race.laps, race.humanIds);
    resultsView.show(rows, restartRace, () => { void goMenu(); });
  };

  // Enter en el emparejamiento: con 1 jugador, teclado; con 2, cada uno su fuente por prioridad (b15 D2)
  const startWithoutWheels = () => {
    if (!split) { setSource(p1, p1.keyboard); startCountdown(); return; }
    let pads = 0;
    while (pads < nP && pilots[pads].gamepad.connected()) pads++;
    const kinds = assignSources(nP, pads, pilots.map((p) => (p.wheel ? p.wheel.link() : 'none')));
    pilots.forEach((p, i) => {
      if (p.source.name === 'autopilot') return;
      setSource(p, kinds[i] === 'wheel' && p.wheel ? p.wheel : kinds[i] === 'gamepad' ? p.gamepad : p.keyboard);
    });
    startCountdown();
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyC' && !e.repeat) { rig.next(); return; }
    if (e.code === 'KeyV' && !e.repeat) { const m = !audio.muted; for (const a of audioRefs) a.setMuted(m); return; }
    if (e.code === 'F3') { e.preventDefault(); panel.toggle(); return; }
    if (state === 'pairing' && (e.code === 'Enter' || e.code === 'NumpadEnter')) startWithoutWheels();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause('hidden'); });

  // Estado del volante de un jugador: toma de control, eventos de interfaz, pérdida y reanudación.
  // Con 2 jugadores, la parrilla espera a los dos volantes (o Enter / mando) y cualquier volante perdido pausa a ambos
  const updateWheel = (p: Pilot) => {
    const w = p.wheel;
    if (!w || state === 'menu') return;    // en el menú, RaceMenu lee el volante
    for (const k of w.takeUiEvents() as EvKey[]) {
      if (k === 'pause' && p.source === w) togglePause();
      else if (k === 'cam') rigOf(p).next();
      else if (k === 'restart' && p.source === w) restartRace();
    }
    if (p.source !== w) w.takeCommands();                 // órdenes sin efecto si no controla el volante
    const link = w.link();
    if (link === 'ok') {
      if (state === 'pairing') {
        setSource(p, w);
        if (pilots.every((o) => o.wheel?.link() === 'ok')) startCountdown();
      } else if (p.source !== w && (state === 'countdown' || state === 'racing' || state === 'paused')) {
        setSource(p, w); ui.toast(`Volante${label(p)} conectado`);
      } else if (state === 'paused' && pauseReason === 'wheelLost' && lostPlayer === p.index) resume();
    } else if (link === 'lost' && p.source === w) pause('wheelLost', p.index);
  };

  // Mando USB (design D4): sustituye al teclado sin volante ni sesión VR; antes de updateControllers para que,
  // al entrar en VR, el teclado devuelto pase a los mandos en el mismo fotograma
  const updateGamepad = (p: Pilot, dtMs: number) => {
    if (state === 'menu') return;                // en el menú, RaceMenu lee el mando
    const gp = p.gamepad;
    // Pantalla de emparejamiento: Cruz u Options arrancan con el mando; solo el flanco, sin arrastrar el arranque
    const events = gp.pollUi(dtMs);
    if (state === 'pairing') {
      if (events.includes('recenter') || events.includes('pause')) { setSource(p, gp); startCountdown(); }
      gp.takeCommands();
      return;
    }
    // Triángulo = cámara; Options = pausa, Cruz = recolocar y Share mantenido = reiniciar, solo si conduce el mando
    for (const ev of events) {
      if (ev === 'camera') rigOf(p).next();
      else if (p.source !== gp) continue;
      else if (ev === 'pause') togglePause();
      else if (ev === 'restart') restartRace();
      else if (state === 'racing') { p.sim.recenter(); syncPrev(p); }
    }
    if (p.source !== gp || state === 'paused') gp.takeCommands();   // órdenes sin efecto
    const next = nextGamepadSource(p.source, p.keyboard, gp, gp.connected(), p.wheel ? p.wheel.link() : 'none', inVr);
    if (next) setSource(p, next);
  };

  // Mandos VR (design D8): sustituyen al teclado solo en sesión VR y sin volante conectado; tras updateWheel (solo J1)
  const updateControllers = (dtMs: number) => {
    if (state === 'menu') return;
    // Botones de los mandos en VR: A = pausa (como P) o arranque en pairing, X = recolocar (como R),
    // clic de palanca izquierda = cámara en cualquier estado (b9, design D6)
    if (inVr) for (const ev of controllersSource.pollButtons(dtMs)) {
      if (ev === 'camera') rig.next();
      else if (ev === 'pause' && state === 'pairing') { setSource(p1, controllersSource); controllersSource.reset(); startCountdown(); }
      else if (ev === 'pause') togglePause();
      else if (ev === 'restart') restartRace();
      else if (state === 'racing') { p1.sim.recenter(); syncPrev(p1); }
    }
    if (p1.source !== controllersSource || state === 'paused') controllersSource.takeCommands();   // órdenes sin efecto
    const next = nextVrSource(p1.source, p1.keyboard, controllersSource, inVr, wheel ? wheel.link() : 'none');
    if (!next) return;
    if (next === controllersSource) controllersSource.reset();
    setSource(p1, next);
  };

  // Telemetría a net.telHz con temporizador propio (independiente del render), solo con volante conectado
  const sendTelemetry = (p: Pilot) => {
    const w = p.wheel, client = p.client;
    if (!w || !client) return;
    const link = w.link();
    if (link !== 'ok' && link !== 'stale') return;
    const sim = p.sim;
    const warn = state === 'countdown' ? countdownNumber()
      : state === 'paused' ? 'PAUSA' : p.warnings.current(sim.state, sim.state.t);
    let dbg: TelHint | undefined;
    if (refPilot && p.index === 0) {
      const r = refPilot.update(sim.state);
      dbg = { steer: r.input.steer, thr: r.input.throttle, brk: r.input.brake, gear: refPilot.suggestedGear(sim.state) };
    }
    const e = w.echo();
    const raceTel = race.isRace ? { pos: race.playerPos(p.index), laps: race.laps } : undefined;
    client.send(encode(buildTel(sim.state, { warn, echo: e.ts, hold: e.holdMs, dbg, race: raceTel })));
  };
  // Calidad adaptativa: empieza en high salvo ?quality= o GL por software, nunca vuelve a subir
  const adaptive = new AdaptiveQuality(config.quality, capLevel(q0.level), q0.locked);
  const fpsMeter = new FpsMeter(config.quality.meterFrames);
  // Con 2 jugadores, sin compositor (la viñeta va por CSS en cada mitad)
  const settingsFor = (l: QualityLevel): QualitySettings => {
    const c = capLevel(l);
    return { ...QUALITY[c], post: QUALITY[c].post && !noPost && !split };
  };
  let quality = settingsFor(adaptive.level);
  // Partículas (design D6) y posproceso (design D7) según el nivel de calidad
  const particles = new TrackParticles(quality.particles);
  scene.add(particles.points);
  const post = new PostFx(renderer, scene, camera, postConfigFor(trackInfo));
  const splitRender = split ? new SplitRenderer(renderer, gs) : null;
  const cams = pilots.map((p) => p.camera);
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
    const opts = { normals: quality.trackMaps, anisotropy, maxPx: quality.trackMaps ? undefined : 1024, ground: trackInfo.ground };
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
      vrMinimap ??= new VrMinimap(p1.minimap.canvas);
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
  // VR desactivada con 2 jugadores (b15)
  if (!split) void vr.init();

  if (debug) {
    const carCost = objectCost(car);
    installDebugApi(() => {
      const sim = p1.sim, lastInput = p1.lastInput;
      const c = sim.state.car, t = sim.state.timing;
      return {
        gameState: state, input: { ...lastInput }, speedKmh: c.speed * 3.6, s: c.s, d: c.d, surface: c.surface,
        lap: t.lap, lapTimeS: t.lapTimeS, lastLapS: t.lastLapS, lastLapValid: t.lastLapValid, bestLapS: t.bestLapS, deltaS: t.deltaS,
        fps, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        maxDrawCalls: maxDraw, maxTriangles: maxTris, dpr, wallHits, simTimeS: sim.state.t,
        room: p1.room, wheelLink: wheel ? wheel.link() : 'none', rttMs: wheel ? wheel.lastRttMs() : null,
        gear: c.gear, rpm: c.rpm, leds: c.leds, drs: c.drs, ers: c.ersCharge, ot: c.overtake,
        autoShift: sim.assists.autoShift, lapValid: t.lapValid, warn: p1.warnings.current(sim.state, sim.state.t), overheated: c.overheated,
        inputApplied: { steer: lastInput.steer, thr: lastInput.throttle, brk: lastInput.brake, ers: lastInput.ers },
        pauseReason, audio: audio.debug(), camera: rig.debug(), fxSent: { ...fxSent },
        quality: capLevel(adaptive.level), rendererName: gpuName, ...shadowStats(scene, renderer), post: quality.post,
        particlesActive: particles.debug().active, fpsAvg: fpsMeter.avg(), fpsP5: fpsMeter.p5(),
        carDrawCalls: carCost.drawCalls, carTriangles: carCost.triangles, envDrawCalls: objectCost(gs.env).drawCalls,
        tracksideDrawCalls: objectCost(gs.trackside).drawCalls, tracksideTriangles: objectCost(gs.trackside).triangles,
        assets: { textures: [...assets.textures], failed: [...assets.failed], hdri: assets.hdri },
        race: race.debug(), rivalDrawCalls: rivalsRender.drawCalls, rivalsVisible: rivalsRender.visible, rivalVoices: rivalAudio.voices(),
        // Jugadores locales (b15): uno por mitad, con su volante, fuente, entrada aplicada y cámara
        players: nP, shadowShared: splitRender?.shadow?.shared ?? null,
        pilots: pilots.map((p) => {
          const pc = p.sim.state.car;
          return { index: p.index, entryId: race.humanIds[p.index], room: p.room, wheelLink: p.wheel ? p.wheel.link() : 'none',
            source: p.source.name, speedKmh: pc.speed * 3.6, s: pc.s, d: pc.d, gear: pc.gear, lap: p.sim.state.timing.lap,
            pos: race.playerPos(p.index), input: { ...p.lastInput }, camera: rigOf(p).debug().mode,
            warn: p.warnings.current(p.sim.state, p.sim.state.t) };
        }),
        // Online (b16): remoteJumpMaxM = mayor salto de un coche remoto entre fotogramas descontando lo recorrido a su
        // velocidad media del intervalo (|Δp| − v̄·dt); remoteStepMaxM = mayor |Δp| bruto. lightsOutSrv: apagado en reloj
        // del servidor; lightsOutTargetSrv: instante objetivo (atSrv + lightsOutAtS); clockErrMs: nowSrv − Date.now()
        online: online ? (() => {
          const c = online.client;
          return { code: c.code, you: c.you, owner: c.owner, players: c.players.map((q) => ({ ...q })), status: c.status,
            remoteJumpMaxM, remoteStepMaxM, atSrv: c.atSrv, lightsOutSrv, nowSrv: c.clock.nowSrv(), clockErrMs,
            lightsOutTargetSrv: c.atSrv !== null ? c.atSrv + race.session.lightsOutAtS * 1000 : null,
            results: c.results ? { official: c.results.official, ids: c.results.rows.map((r) => r.id) } : null };
        })() : null,
      };
    }, canvas);
  }

  if (pilots.some((p) => p.client)) {
    // También evalúa el enlace del volante aquí: la pausa/reanudación no depende del render (updateWheel es idempotente)
    const telTimer = setInterval(() => { for (const p of pilots) { updateWheel(p); sendTelemetry(p); } }, 1000 / config.net.telHz);
    window.addEventListener('pagehide', () => { clearInterval(telTimer); for (const p of pilots) p.client?.close(); });
  }

  // Online: abandonos (coche retirado fuera de escena a los net.leaveHideS), cambio de propietario y conexión perdida
  let lightsOutSrv: number | null = null;     // instante del apagado en reloj del servidor (depuración)
  let remoteJumpMaxM = 0, remoteStepMaxM = 0;
  const remoteLast = new Map<number, { x: number; z: number; v: number }>();
  let clockErrMs: number | null = null;       // nowSrv − Date.now() del último fotograma (en local comparten reloj)
  if (online) {
    const c = online.client;
    const hideRetired = () => window.setTimeout(() => {
      for (const e of race.session.entries) if (e.retired && e.kind === 'remote') { race.hideCar(e.id); remoteLast.delete(e.id); }
    }, config.net.leaveHideS * 1000);
    c.on('leave', (slot) => { ui.toast(`Jugador ${slot + 1} ha abandonado`); hideRetired(); });
    c.on('owner', () => hideRetired());
    c.on('close', () => { if (state !== 'results') ui.toast('Conexión online perdida'); });
    window.addEventListener('pagehide', () => c.close());
  }

  if (useAutopilot && race.isRace) startCountdown();
  else if (useAutopilot) { stepper.reset(); setState('racing'); }
  else if (race.isOnline) startCountdown();
  else setState('pairing');

  const dt = config.sim.dt;
  const inputs: DriverInput[] = pilots.map(() => NEUTRAL_INPUT);
  const cmds: DriverCommand[][] = pilots.map(() => []);
  let raceTextMs = -1e9;
  let lastT = performance.now();
  // Bucle único con setAnimationLoop (design D1): también dispara durante una sesión WebXR
  let firstFrame = true;
  // Eventos de un paso de carrera (o del semáforo online): apagado → carrera, audio, avisos y cronometraje del jugador
  const handleRaceEvents = (raceEvents: readonly RaceEvent[]) => {
    if (online && lightsOutSrv === null && race.phase === 'green') lightsOutSrv = online.client.clock.nowSrv();
    if (state === 'countdown' && race.phase !== 'grid' && race.phase !== 'lights') setState('racing');
    for (const p of pilots) {
      for (const ev of race.playerEvents(raceEvents, p.index)) {
        p.events.push(ev);
        p.audio.onEvent(ev);
        p.warnings.push(ev, p.sim.state.t);
        if (ev.type === 'sector') { const b = p.bestSectors[ev.index]; if (b === null || ev.timeS < b!) p.bestSectors[ev.index] = ev.timeS; }
        if (ev.type === 'wallHit') { if (p.index === 0) wallHits++; }
        else if (ev.type === 'lapEnd' && ev.valid && ev.best) saveBest(track.id, ev.timeS);
      }
    }
  };
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
      const before = quality;
      quality = settingsFor(lowered);
      // Con 2 jugadores, bajar de high a medium no cambia nada (ya estaba acotada)
      if (quality.dpr !== before.dpr || quality.shadowMapSize !== before.shadowMapSize || quality.trees !== before.trees) {
        applyAll();
        ui.toast(`Calidad gráfica reducida a ${QUALITY_LABEL[capLevel(lowered)]}`);
      }
    }

    for (const p of pilots) updateWheel(p);
    for (const p of pilots) updateGamepad(p, frameDt * 1000);
    updateControllers(frameDt * 1000);
    if (state === 'countdown' && !race.isRace) {
      const left = (countdownEndMs - nowMs()) / 1000;           // coche retenido: la simulación no avanza
      if (left <= 0) { ui.setCountdown(null); stepper.reset(); setState('racing'); }
      else ui.setCountdown(Math.ceil(left));
    } else ui.setCountdown(null);

    for (const p of pilots) p.events.length = 0;
    // Online: reloj, envío de st/ai, resultados y semáforo sincronizado (nowSrv ≥ atSrv, D5)
    if (online && race.isOnline) {
      const c = online.client;
      c.tick();
      if (race.phase === 'grid' && c.lightsDue()) race.startLights();
      clockErrMs = c.clock.nowSrv() - Date.now();
      if (race.phase === 'lights' && c.atSrv !== null) {
        handleRaceEvents(race.syncLights((c.clock.nowSrv() - c.atSrv) / 1000));
      }
    }

    let alpha = 1;
    // Carrera: durante el semáforo también se dan pasos (RaceSession retiene los coches hasta el apagado)
    const stepping = state === 'racing' || (state === 'countdown' && race.isRace);
    if (stepping) {
      const r = stepper.advance(frameDt, timescale);
      alpha = r.alpha;
      for (let i = 0; i < r.steps; i++) {
        for (const p of pilots) {
          const c = p.sim.state.car;
          p.prev.x = c.x; p.prev.y = c.y; p.prev.z = c.z; p.prev.yaw = c.yaw;
          p.lastInput = inputs[p.index] = p.source.read(dt, p.sim.state);
          cmds[p.index] = p.source.takeCommands();
        }
        handleRaceEvents(split ? race.stepHumans(inputs, cmds) : race.step(inputs[0], cmds[0]));
      }
      for (const p of pilots) {
        const c = p.sim.state.car;
        p.cur.x = c.x; p.cur.y = c.y; p.cur.z = c.z; p.cur.yaw = c.yaw;
      }
      // Online: se espera a la tabla `res` (o a la local tras net.resultsWaitS, la decide el cliente)
      const done = online && race.isOnline ? online.client.results !== null : race.finished;
      if (done) { showResults(); setState('results'); }
    } else if (state === 'paused') {
      alpha = 1;
    }

    // Pose interpolada; yaw por el camino corto
    const k = stepping ? alpha : 1;
    const camDt = stepping ? frameDt : 0;
    for (const p of pilots) {
      let dy = p.cur.yaw - p.prev.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const pose = p.pose;
      pose.x = p.prev.x + (p.cur.x - p.prev.x) * k; pose.y = p.prev.y + (p.cur.y - p.prev.y) * k;
      pose.z = p.prev.z + (p.cur.z - p.prev.z) * k; pose.yaw = p.prev.yaw + dy * k;
      const pc = p.sim.state.car;
      const g = p.car.group;
      g.position.set(pose.x, pose.y, pose.z);
      g.rotation.order = 'YZX';
      g.rotation.set(0, pose.yaw, pc.pitch);
      p.car.update(pc, camDt);
      rigOf(p).update({ ...pose, pitch: pc.pitch, roll: pc.roll }, pc, camDt, p.sim.state.t);
    }
    // Remotos: pose muestreada en el instante del render (nowSrv − interpDelayMs); salto máximo entre fotogramas
    if (online && race.isOnline) {
      const c = online.client, t = c.clock.nowSrv() - config.net.interpDelayMs;
      race.sampleRemotes((id) => c.remote(id)?.sample(t) ?? null);
      const live = state === 'racing' && race.phase !== 'grid' && race.phase !== 'lights';
      for (const v of race.rivals()) {
        if (race.session.entries[v.id].kind !== 'remote' || race.session.entries[v.id].retired) continue;
        const last = remoteLast.get(v.id);
        if (last && live && frameDt > 0) {
          const d = Math.hypot(v.cur.x - last.x, v.cur.z - last.z);
          remoteStepMaxM = Math.max(remoteStepMaxM, d);
          remoteJumpMaxM = Math.max(remoteJumpMaxM, d - ((last.v + v.speed) / 2) * frameDt * timescale);
        }
        if (last) { last.x = v.cur.x; last.z = v.cur.z; last.v = v.speed; }
        else remoteLast.set(v.id, { x: v.cur.x, z: v.cur.z, v: v.speed });
      }
    }
    const pose = p1.pose;
    const cs = p1.sim.state.car;
    if (splitRender) splitRender.updateShadow(p1.pose, pilots[1].pose);
    else {
      updateScene(gs, pose.x, pose.y, pose.z, pose.yaw);
      rivalsRender.update(race.rivals(), k, camDt, camera);
    }
    if (inVr) gs.sky.position.copy(vrAnchor.position);          // en VR camera.position es local a la cabeza
    for (const p of pilots) p.audio.update(p.sim.state.car, camDt);
    rivalAudio.update(audio.output(), race.rivals(), split ? pilots.map((p) => p.pose) : pose, camera);
    if (state === 'racing') for (const p of pilots) {
      if (!((p.client && p.source === p.wheel) || p.source === p.gamepad)) continue;
      const fk = p.fx.plan(p.events, p.sim.state.car, nowMs());
      if (!fk) continue;
      if (p.source === p.gamepad) p.gamepad.rumble(fk);
      else if (p.client) { p.client.send(encode({ t: 'fx', k: fk })); fxSent[fk]++; }
    }

    particles.update(cs, pose, p1.sim.state.t);
    particles.setView(renderer.domElement.height / nP, camera.fov);
    renderer.info.reset();
    if (splitRender) {
      // Una pasada por mitad: cielo centrado en su cámara y rivales ocultos según su vista (el giro de ruedas avanza una vez)
      splitRender.render(cams, (i, cam) => {
        gs.sky.position.copy(cam.position);
        rivalsRender.update(race.rivals(), k, i === 0 ? camDt : 0, cam);
      });
    } else if (inVr) renderer.render(scene, camera);           // VR: sin posproceso, estéreo vía WebXR
    else post.render();
    const info = renderer.info.render;
    maxDraw = Math.max(maxDraw, info.calls);
    maxTris = Math.max(maxTris, info.triangles);
    dpr = renderer.getPixelRatio();

    if (inVr && vrPanel) {
      const sim = p1.sim;
      const raceInfo = (): PanelRace => ({ pos: race.playerPos(), total: race.session.entries.length,
        lap: race.session.lapsDone(race.playerId) + 1, laps: race.laps });
      const screen: PanelScreen = state === 'pairing' ? { kind: 'pairing', room: ui.roomText, hint: ui.hintText }
        : state === 'countdown' ? { kind: 'countdown', n: Number(countdownNumber()) }
        : state === 'paused' ? { kind: 'paused' }
        : { kind: 'hud', model: hudModel(sim.state, state === 'racing' ? p1.warnings.current(sim.state, sim.state.t) : '', p1.bestSectors, sim.assists.autoShift),
          race: race.isRace ? raceInfo() : undefined };
      vrPanel.update(now, screen, ui.qrCanvas);
    }
    const lights = $('race-lights');
    lights.hidden = !(state === 'countdown' && race.isRace);
    if (!lights.hidden) lights.querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i < race.lightsOn));
    const raceHud = race.isRace && (state === 'racing' || state === 'countdown' || state === 'paused');
    tower.show(raceHud);
    if (raceHud) tower.update(() => race.standings(), towerInfo, race.playerId, race.laps, performance.now(), race.humanIds);
    // Posición y vuelta propias en cada mitad (a la frecuencia de la torre)
    if (split && now - raceTextMs >= 1000 / TOWER_HZ) {
      raceTextMs = now;
      const total = race.session.entries.length, laps = race.laps;
      for (const p of pilots) p.hud.setRace(raceHud
        ? `P${race.playerPos(p.index)}/${total} · V ${Math.min(laps, race.session.lapsDone(race.humanIds[p.index]) + 1)}/${laps}` : null);
    }
    const nowPerf = performance.now();
    for (const p of pilots) {
      const ps = p.sim.state;
      p.hud.update(ps, state === 'racing' ? p.warnings.current(ps, ps.t) : '', p.bestSectors, p.sim.assists.autoShift);
      // Minimapa propio; con 2 jugadores el otro aparece con su color
      const other = split ? pilots[1 - p.index] : null;
      const mm = other ? [...race.rivals(), { team: 0, cur: other.pose, color: PLAYER_COLORS[other.index] }] : race.rivals();
      p.minimap.update(ps.car, nowPerf, mm, teamColors);
    }
    if (inVr && vrMinimap) vrMinimap.update(p1.minimap.version);
    panel.update(now, {
      fps, quality: capLevel(adaptive.level), drawCalls: info.calls, triangles: info.triangles, speedKmh: cs.speed * 3.6, s: cs.s, d: cs.d,
      surface: cs.surface, gLong: cs.aLong / config.sim.g, gLat: cs.aLat / config.sim.g,
      wheelLink: wheel ? wheel.link() : 'none', rttMs: wheel ? wheel.lastRttMs() : null,
    });
  };
  renderer.setAnimationLoop(frame);
}

setState('loading');
start().catch(showError);
