# Design

## Context

Tras el bloque 2 existen `Simulation`, `InputSource`, `Autopilot`, el armazón del host (`main.ts` con estados `loading → ready → racing ⇄ paused`), el HUD, el panel F3 y `window.__f1`. La skill `phone-wheel-controller` describe el comportamiento; aquí se fijan contratos, rutas y lo que la skill no resuelve.

## Goals / Non-Goals

**Goals:** canal PC↔celular verificable sin dispositivo (tests de Vitest, script de relay, E2E con dos páginas y volante simulado); lógica del volante en funciones puras.

**Non-Goals:** efecto de `up/down/drs/ers` en la física (bloque 4); emisión de `fx` y cámaras (bloque 5). El host ya transporta esos eventos hasta `InputSource.takeCommands()`.

## Decisions

### D1. Relay (`server/main.py`)

Un solo archivo, FastAPI. Estado: `rooms: dict[str, Room]` con `Room = {host: Conn | None, wheel: Conn | None}` y `Conn = {ws, last_seen: float}`. Constantes por variable de entorno para poder probar rápido: `RELAY_PING_S` (2), `RELAY_TIMEOUT_S` (6), `PUBLIC_URL`. Códigos de cierre: 4400 petición inválida, 4001 reemplazado, 4002 sin latido. El servidor solo inspecciona un mensaje para saber si es `{"t":"pong"}` (comparación de cadena tras `strip`, sin parsear el resto); cualquier mensaje recibido refresca `last_seen`. Una tarea asyncio por conexión envía `ping` y vigila el tiempo límite. Mensajes de más de 4 096 bytes se descartan. Cabecera del archivo: comentario que replica la tabla del protocolo (convención de `context.md`). `lan_ips`: IPv4 de `socket.getaddrinfo(hostname)` más el truco del socket UDP a `10.255.255.255`, sin `127.*`.

`requirements.txt` += `fastapi`, `uvicorn[standard]`, `websockets`.

Verificación sin pytest: `tools/check_relay.py` arranca `uvicorn server.main:app` en un puerto libre con `RELAY_PING_S=0.3 RELAY_TIMEOUT_S=1.0`, ejecuta con `websockets` y `urllib` un caso por scenario de `specs/wheel-relay` (salvo "Un solo origen"), imprime `OK/FAIL` y sale ≠ 0 si alguno falla.

### D2. Vite

`vite.config.ts`: `build.rollupOptions.input = { main: 'index.html', wheel: 'wheel/index.html' }`; `server.proxy = { '/ws': { target: 'ws://localhost:8000', ws: true }, '/api': 'http://localhost:8000' }`; si `process.env.HTTPS === '1'`, añadir `@vitejs/plugin-basic-ssl`. Script `dev:wifi: "HTTPS=1 vite --host --port 5173"`.

### D3. Protocolo (`src/shared/protocol.ts`)

```ts
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; export const ROOM_LENGTH = 4;
export type Role = 'host' | 'wheel';
export type EvKey = 'up' | 'down' | 'drs' | 'cam' | 'pause' | 'recal';
export type FxKey = 'kerb' | 'grass' | 'limits' | 'shift' | 'limiter';
export interface InMsg  { t: 'in'; seq: number; ts: number; steer: number; thr: number; brk: number; ers: boolean; rtt: number | null }
export interface EvMsg  { t: 'ev'; k: EvKey }
export interface TelHint { steer: number; thr: number; brk: number; gear: number }
export interface TelMsg { t: 'tel'; spd: number; gear: number; rpm: number; leds: number; drs: 0|1|2; ers: number; ot: boolean;
  lap: number; delta: number | null; warn: string; echo: number; hold: number; dbg?: TelHint }
export interface FxMsg  { t: 'fx'; k: FxKey }
export interface PeerMsg { t: 'peer'; role: Role; connected: boolean }
export interface PingMsg { t: 'ping' }  export interface PongMsg { t: 'pong' }
export type WheelToHost = InMsg | EvMsg;  export type HostToWheel = TelMsg | FxMsg;
export function encode(msg: WheelToHost | HostToWheel | PongMsg): string;          // redondeo a 3 decimales
export function decodeAtHost(raw: string): InMsg | EvMsg | PeerMsg | PingMsg | null;   // valida y recorta
export function decodeAtWheel(raw: string): TelMsg | FxMsg | PeerMsg | PingMsg | null;
export function generateRoomCode(rand?: () => number): string;
export function isRoomCode(s: string): boolean;
```

Extensiones respecto a la skill, y por qué: `tel.hold` + `in.rtt` (sin `hold`, el RTT incluiría hasta 50 ms de espera del ciclo de 20 Hz y el criterio "RTT < 30 ms" sería inalcanzable; `in.rtt` permite mostrarlo en F3); `tel.dbg` (permite que `fake_wheel.py --script lap` complete una vuelta de verdad en lazo cerrado sin duplicar el piloto en Python). Hasta el bloque 4, el host envía `gear = 1`, `rpm = 0`, `leds = 0`, `drs = 0`, `ers = 1`, `ot = false`.

### D4. Host (`src/host/net/`, `src/host/pairing.ts`)

```ts
// net/roomClient.ts
export class RoomClient { constructor(role: Role, room: string, opts?: { url?: string; WebSocketImpl?: typeof WebSocket });
  onMessage: (raw: string) => void; onStatus: (s: 'connecting' | 'open' | 'closed') => void;
  connect(): void; send(text: string): void; close(): void }     // reconexión con espera 0,5 → 3 s; responde pong a ping
// net/wheelSource.ts   (lógica pura con reloj inyectado)
export type WheelLink = 'none' | 'ok' | 'stale' | 'lost';
export class WheelSource implements InputSource { constructor(cfg: GameConfig, now: () => number);
  handleMessage(msg: InMsg | EvMsg | PeerMsg): void; link(): WheelLink; lastRttMs(): number | null;
  takeUiEvents(): EvKey[];          // 'pause', 'cam', 'recal' para el armazón
  echo(): { ts: number; holdMs: number } }
// net/telemetry.ts
export function buildTel(state: SimState, extra: { warn: string; echo: number; hold: number; dbg?: TelHint }): TelMsg;
// pairing.ts
export function wheelUrl(loc: { protocol: string; hostname: string; port: string }, info: { lan_ips: string[]; public_url: string | null } | null, room: string): { url: string; mode: 'usb' | 'wifi' | 'public' };
```

- Máquina de estados ampliada: `loading → pairing → countdown → racing ⇄ paused`. Motivos de pausa: `'user' | 'hidden' | 'wheelLost'`; solo `wheelLost` se reanuda solo. `?autopilot=1` salta `pairing` y no abre WebSocket.
- `WheelSource.read`: último `in`; si la edad > `net.inputStaleMs` → `throttle = 0`, `ers = false`; `link() = 'lost'` si la edad > `net.inputLostMs` o llegó `peer` desconectado. `seq` se reinicia al llegar `peer` conectado.
- Telemetría: en cada fotograma, si pasaron ≥ `1000/net.telHz` ms y hay volante, `send(encode(buildTel(...)))`. `warn` durante la cuenta atrás: `"3"`, `"2"`, `"1"`; en pausa: `"PAUSA"`.
- Con `debug=1`, `Autopilot.update(state)` se evalúa en cada envío y va en `dbg` (marcha sugerida 1 hasta el bloque 4).
- QR con `qrcode` (`toCanvas`, 320 px). `data-testid`: `pairing`, `pairing-code`, `pairing-qr`, `pairing-hint`, `countdown`, `toast`, `overlay-wheel-lost`.
- `DebugSnapshot` += `room`, `wheelLink`, `rttMs`, `inputApplied: { steer, thr, brk, ers }`, `pauseReason`.
- `config` += `net: { telHz: 20, inputStaleMs: 250, inputLostMs: 1000 }`, `race: { countdownS: 3 }`.

### D5. Volante (`wheel/index.html`, `src/wheel/`)

```ts
// steering.ts  (puro)
export function tiltDeg(ax: number, ay: number, screenAngle: number): number;   // wrap180(screenAngle − atan2(ax, ay)·180/π); horario = positivo
export class OneEuroFilter { constructor(minCutoff: number, beta: number, dCutoff: number); filter(x: number, tS: number): number; reset(): void }
export function shapeSteer(phiDeg: number, w: GameConfig['wheel']): number;      // zona muerta, recorrido, curva, recorte, signo
export class SteeringEstimator { constructor(w: GameConfig['wheel']);
  update(ax: number, ay: number, screenAngle: number, tMs: number): { steer: number; flat: boolean; phiDeg: number };
  recenter(): void }
// haptics.ts  (puro, con vibrate y reloj inyectados)
export class Haptics { constructor(w: GameConfig['wheel']['haptics'], vibrate: (p: number | number[]) => void, now: () => number);
  enabled: boolean; trigger(k: FxKey): void }
// pedals.ts
export function pedalValue(clientY: number, rect: { top: number; height: number }): number;   // 0 abajo, 1 arriba, recortado
```

Además: `main.ts` (estados `no-room | tap | connecting | waiting-host | active | host-lost`), `net.ts` (reutiliza `RoomClient` con rol `wheel`; envío de `in` con `setInterval` a `wheel.sendHz`), `controls.ts` (Pointer Events con `setPointerCapture`, `touch-action: none`), `display.ts`, `wheel.css`.

```ts
config.wheel = { steerSign: 1, rangeDeg: 60, deadzoneDeg: 1.5, curveK: 0.35, flatThreshold: 3,
  oneEuro: { minCutoff: 1.0, beta: 0.02, dCutoff: 1.0 }, sendHz: 60, pedalMode: 'analog' as 'analog' | 'digital', pedalRampMs: 120,
  haptics: { minGapMs: 80, patterns: { shift: [12], kerb: [25], grass: [40, 30, 40], limits: [120], limiter: [8] } } };
```

- **Signo:** con el celular apaisado (ángulo de pantalla 90) el eje +X del dispositivo apunta arriba y `(ax, ay) ≈ (9,81, 0)`; al girar en sentido horario crece `ay`, luego `atan2(ax, ay)` decrece: por eso `tiltDeg = screenAngle − atan2(...)`. `steerSign` permite invertirlo si la validación con dispositivo real lo contradice.
- Si existe `DeviceMotionEvent.requestPermission`, se llama en el primer toque.
- `data-testid`: `tap-start`, `wheel-status`, `pedal-thr`, `pedal-brk`, `paddle-up`, `paddle-down`, `btn-drs`, `btn-cam`, `btn-center`, `btn-pause`, `btn-ers`, `btn-haptics`, `disp-speed`, `disp-gear`, `disp-leds` (cada LED `.led.on`), `disp-drs`, `disp-ers`, `disp-warn`, `disp-rtt`, `flat-warning`.
- Con `?debug=1` la página expone `window.__wheel = { state(), lastIn(), vibrations: number[][] }` para el E2E.
- Dirección de diseño (skill `frontend-design`): volante de competición original, oscuro, tipografía condensada, sin imitar el de ningún equipo o juego existente.

### D6. Volante simulado (`tools/fake_wheel.py`)

`asyncio` + `websockets`. Bucle de envío a 60 Hz, tarea de recepción, respuesta a `ping`. `lap`: `steer/thr/brk` = último `dbg`; si `dbg.gear ≠ tel.gear`, un `ev` `up`/`down` cada 150 ms como máximo; termina cuando `tel.lap ≥ laps + 1`; sin `dbg` en 3 s tras el primer `tel` → salida 3. Imprime el tiempo de vuelta medido entre cambios de `tel.lap`.

### D7. E2E (`tests/e2e/b3_wheel.py`)

Lanzado con `with_server.py` y dos servidores (`.venv/bin/uvicorn server.main:app --port 8000` y `npm run dev`). Contexto host 1280×720 y contexto volante con `has_touch`, `is_mobile`, viewport 800×360. Movimiento sintético: `window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x, y, z } }))` y, si hace falta, parchear `screen.orientation.angle` con `add_init_script`.

## Risks / Trade-offs

- [El signo o el eje de la gravedad difiere en el dispositivo real] → `steerSign` y validación manual obligatoria (tarea 7.2).
- [No hay `adb` en este PC] → la validación USB la hace el usuario; el bloque no se cierra sin ella.
- [`tel.dbg` hace que `lap` no pruebe un controlador independiente] → aceptado: lo que verifica es el transporte de extremo a extremo con latencia real; la conducción ya se prueba en `tests/sim.lap.test.ts`.
- [Mensajes de error de WebSocket en consola cuando el relay no está] → los E2E arrancan siempre el relay; el caso "Relay no disponible" se verifica aparte tolerando solo ese error de red.
