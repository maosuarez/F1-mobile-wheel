import { config } from '../shared/config';
import { isRoomCode, type FxKey } from '../shared/protocol';
import { setupControls } from './controls';
import { Display } from './display';
import { Haptics } from './haptics';
import { WheelNet } from './net';
import { SteeringEstimator } from './steering';
import './wheel.css';

type State = 'no-room' | 'tap' | 'connecting' | 'waiting-host' | 'active' | 'host-lost';

const params = new URLSearchParams(location.search);
const room = (params.get('room') ?? '').toUpperCase();
const debug = params.get('debug') === '1';
const w = config.wheel;

const display = new Display();
const estimator = new SteeringEstimator(w);
const vibrations: number[][] = [];
const haptics = new Haptics(w.haptics, (p) => {
  vibrations.push(Array.isArray(p) ? p : [p]);
  try { navigator.vibrate?.(p); } catch { /* sin vibración */ }
}, () => performance.now(), typeof navigator.vibrate === 'function');

const HAPTICS_KEY = 'f1.wheel.haptics';
try { if (localStorage.getItem(HAPTICS_KEY) === '0') haptics.enabled = false; } catch { /* sin almacenamiento */ }

let state: State = 'tap';
let steer = 0, thr = 0, brk = 0, ers = false;
let rtt: number | null = null;
let net: WheelNet | null = null;
let wasActive = false;

const LABELS: Record<State, string> = {
  'no-room': 'Sin sala', tap: 'Toca para empezar', connecting: 'Conectando…',
  'waiting-host': 'Esperando al PC', active: 'Conectado', 'host-lost': 'PC desconectado',
};

function setState(s: State): void {
  state = s;
  if (s === 'active') wasActive = true;
  document.body.dataset.state = s;
  display.setStatus(LABELS[s], s);
  (document.getElementById('cover-tap') as HTMLElement).hidden = s !== 'tap';
  (document.getElementById('cover-noroom') as HTMLElement).hidden = s !== 'no-room';
}

function onMotion(e: DeviceMotionEvent): void {
  const g = e.accelerationIncludingGravity;
  if (!g || g.x == null || g.y == null) return;
  const angle = screen.orientation?.angle ?? (window as { orientation?: number }).orientation ?? 90;
  const r = estimator.update(g.x, g.y, angle, performance.now());
  steer = r.steer;
  display.setFlat(r.flat);
}

// Cada API en su propio try/catch: ninguna impide que el volante funcione
async function startSensors(): Promise<void> {
  try { await document.documentElement.requestFullscreen?.(); } catch { /* sin pantalla completa */ }
  try { await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape'); } catch { /* sin bloqueo */ }
  try { await navigator.wakeLock?.request('screen'); } catch { /* sin wake lock */ }
  try {
    const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DME.requestPermission === 'function') await DME.requestPermission();
  } catch { /* permiso denegado */ }
  try { window.addEventListener('devicemotion', onMotion); } catch { /* sin sensor */ }
}

function start(): void {
  if (state !== 'tap') return;
  setState('connecting');
  net = new WheelNet(room, {
    onStatus: (s) => {
      if (s === 'open') setState('waiting-host');
      else if (s === 'connecting') setState(wasActive ? 'host-lost' : 'connecting');
      else if (wasActive) setState('host-lost');
      else setState('connecting');
    },
    onPeer: (c) => setState(c ? 'active' : wasActive ? 'host-lost' : 'waiting-host'),
    onTel: (t) => {
      display.update(t);
      rtt = Math.max(0, performance.now() - t.echo - t.hold);
      display.setRtt(t.echo > 0 ? rtt : null);
      if (t.echo <= 0) rtt = null;
    },
    onFx: (k: FxKey) => haptics.trigger(k),
  });
  net.connect();
  window.setInterval(() => net?.sendIn({ steer, thr, brk, ers, rtt }), 1000 / w.sendHz);
  void startSensors();
}

setupControls({
  onThr: (v) => { thr = v; },
  onBrk: (v) => { brk = v; },
  onErs: (on) => { ers = on; },
  onEv: (k) => net?.sendEv(k),
  onRecenter: () => estimator.recenter(),
  onHaptics: () => {
    if (!haptics.supported) return false;
    haptics.enabled = !haptics.enabled;
    try { localStorage.setItem(HAPTICS_KEY, haptics.enabled ? '1' : '0'); } catch { /* sin almacenamiento */ }
    return haptics.enabled;
  },
  hapticsSupported: haptics.supported,
  hapticsOn: haptics.enabled,
});

document.querySelector('[data-testid="tap-start"]')!.addEventListener('click', start);

if (!isRoomCode(room)) setState('no-room');
else setState('tap');

if (debug) {
  (window as unknown as { __wheel: unknown }).__wheel = {
    state: () => state,
    lastIn: () => net?.last ?? null,
    vibrations,
  };
}
