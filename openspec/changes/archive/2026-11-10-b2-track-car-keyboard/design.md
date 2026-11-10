# Design

## Context

Tras el bloque 1 existen `public/track/interlagos.json`, `src/track/types.ts` (`TrackJson`), `src/track/schema.ts` (`parseTrackJson`), `package.json`, Vitest y `.venv`. Las skills `f1-car-feel` (§1–§3, §7, §8, §11) y `track-pipeline` (§4–§5) dan fórmulas y valores iniciales; aquí se fijan contratos, rutas y decisiones que esas skills dejan abiertas. Estos contratos son la base de los bloques 3–6: no cambiarlos sin pasar por el orquestador.

## Goals / Non-Goals

**Goals:** contratos estables de `Track`, `Simulation`, `DriverInput` e `InputSource`; vuelta completable demostrada sin humano; física dentro de las bandas de `specs/vehicle-dynamics`.

**Non-Goals:** marchas/RPM/DRS/ERS (los campos de entrada existen pero se ignoran); calidad visual; audio.

## Decisions

### D1. Convenciones de mundo

Y arriba. Rumbo `yaw` en radianes, antihorario visto desde arriba, con `forward = (cos yaw, 0, −sin yaw)`. Un objeto Three.js con el morro hacia +X usa `rotation.y = yaw`. Izquierda del coche = `(−sin yaw, 0, −cos yaw)`… equivalente a la normal de pista `(nx, nz) = (tz, −tx)`. `steer > 0` = derecha = `yaw` decrece. `d > 0` = izquierda. `k > 0` = curva a la izquierda. Unidades SI; km/h solo en HUD y tests.

### D2. Configuración (`src/shared/config.ts`)

Objeto mutable exportado `config` (no `as const`, para clonar y alterar en tests) y `export type GameConfig = typeof config`. Valores iniciales; el worker ajusta **solo valores**, no claves, hasta cumplir las bandas de la spec:

```ts
export const config = {
  sim:   { dt: 1/120, maxSubSteps: 8, g: 9.81, rho: 1.2, startOffsetM: 20 },
  car:   { massKg: 800, wheelbaseM: 3.6, halfWidthM: 1.0, powerKw: 680,   // 560 combustión + 120 ERS; el bloque 4 lo separa
           mu: 1.7, rearLoadFraction: 0.6, brakeGripFactor: 0.85, rollingCoef: 0.015,
           steerMaxLowDeg: 16, steerMaxHighDeg: 3.5, steerSpeedRefMs: 85, steerTauS: 0.06,
           pedalTauS: 0.03, alignRate: 10, oversteerGain: 0.6, minSpeedForSlipMs: 3 },
  aero:  { cdA: 1.5, clA: 4.0 },
  surface: { asphalt: { mu: 1.0, rolling: 1 }, kerb: { mu: 0.85, rolling: 1, yawNoise: 0.02 },
             grass: { mu: 0.45, rolling: 6 },
             wall: { restitution: 0.3, speedLoss: 0.15, yawKickRad: 0.12 } },
  timing: { traceStepM: 10 },
  keyboard: { steerRiseS: 0.18, steerFallS: 0.12, pedalRiseS: 0.08, pedalFallS: 0.05 },
  autopilot: { lookaheadBaseM: 8, lookaheadPerMs: 0.35, latGripUse: 0.72, brakeGripUse: 0.65,
               speedPreviewS: 0.25, throttleGain: 0.25, brakeGain: 0.35, maxSpeedMs: 95 },
  render: { maxDpr: 1.5, trackChunks: 20, fovDeg: 70, near: 0.3, far: 2500,
            chase: { distM: 7.5, heightM: 2.6, lookAheadM: 6, stiffness: 8 } },
};
```

### D3. Pista en memoria (`src/track/`)

```ts
// types.ts (añadir)
export type Surface = 'asphalt' | 'kerb' | 'grass';
export const KERB_WIDTH_M = 1.2, KERB_HEIGHT_M = 0.03, EDGE_LINE_M = 0.3, WALL_HEIGHT_M = 1.0;
export interface Track {
  id: string; name: string; length: number; step: number; n: number; closed: boolean; direction: 'ccw'|'cw';
  s: Float64Array; x: Float64Array; y: Float64Array; z: Float64Array; wl: Float64Array; wr: Float64Array;
  nx: Float64Array; nz: Float64Array; tx: Float64Array; tz: Float64Array;   // tx,tz = (−nz, nx)
  k: Float64Array; pitch: Float64Array; bank: Float64Array;
  kerbL: Uint8Array; kerbR: Uint8Array;        // 1 si la muestra i tiene piano en ese lado (precalculado)
  startS: number; sectorsS: [number, number]; drsZones: DrsZone[]; corners: Corner[]; kerbs: Kerb[]; runoff: number;
}
export interface TrackLocation { i: number; s: number; d: number; y: number; pitch: number; bank: number; k: number;
  heading: number; wl: number; wr: number; surface: Surface; kerbSide: TrackSide | null; wallL: number; wallR: number }
// track.ts
export function buildTrack(json: TrackJson): Track;
// load.ts
export async function loadTrack(id: string): Promise<Track>;        // fetch(`/track/${id}.json`) → parseTrackJson → buildTrack
// query.ts  (sin three ni DOM)
export function wrapS(t: Track, s: number): number;
export function deltaS(t: Track, from: number, to: number): number;   // con signo, camino más corto
export function inRangeS(t: Track, s: number, s0: number, s1: number): boolean;   // s0 > s1 ⇒ cruza 0
export function locate(t: Track, x: number, z: number, hintIndex: number): TrackLocation;
export function locateGlobal(t: Track, x: number, z: number): TrackLocation;
export function sampleAt(t: Track, s: number): { x:number; y:number; z:number; tx:number; tz:number; nx:number; nz:number; wl:number; wr:number; k:number; pitch:number; heading:number };
export function drsZoneAt(t: Track, s: number): number;               // índice o −1
export function sectorAt(t: Track, s: number): 0 | 1 | 2;
export function crossedStart(t: Track, sPrev: number, s: number): boolean;
// synthetic.ts
export function makeStraightTrack(o?: { lengthM?: number; halfWidthM?: number; pitch?: number; runoffM?: number }): Track;  // abierta, hacia +X
export function makeOvalTrack(o?: { straightM?: number; radiusM?: number; halfWidthM?: number; kerbs?: boolean; runoffM?: number }): Track;
```

`locate`: muestra más cercana en ventana de ±20 índices desde `hintIndex` (con envoltura si `closed`); si la distancia mínima supera 60 m, cae a `locateGlobal`. Después proyecta sobre el segmento hacia el vecino más próximo para obtener `s` continuo, e interpola normal, anchos, `y`, `pitch`, `k`. `d` = producto escalar con la normal interpolada. `wallL = wl + runoff`, `wallR = wr + runoff`. `heading = atan2(−tz, tx)`. `crossedStart`: `deltaS(sPrev, s) > 0` y `startS` está en `(sPrev, s]` módulo `length`, con `|deltaS| < length/4`.

### D4. Mallas (`src/track/mesh.ts`)

```ts
export interface TrackMeshes { group: THREE.Group; materials: { road: THREE.Material; grass: THREE.Material; wall: THREE.Material }; chunks: number; triangles: number }
export function buildTrackMeshes(track: Track, chunks?: number): TrackMeshes;
export function buildRingPositions(track: Track, i: number): Float32Array;   // sección transversal de la muestra i; base de los tests de continuidad
```

Por trozo, 3 mallas con nombres `road-<c>`, `grass-<c>`, `wall-<c>`:
- `road`: asfalto + franjas blancas + pianos fusionados en un `BufferGeometry` con colores por vértice y un `MeshStandardMaterial({ vertexColors: true })` compartido. Asfalto gris `#2b2b2e`; franjas `#e8e8e8` elevadas 5 mm; pianos elevados `KERB_HEIGHT_M` con bandas alternas rojo `#c8102e`/blanco cada 2 muestras. *Alternativa descartada:* texturas en canvas por superficie (más draw calls y trabajo que corresponde al bloque 6).
- `grass`: de borde (o piano) hasta `wallL/wallR`, 5 cm por debajo del asfalto en el lado exterior. `wall`: cinta vertical de `WALL_HEIGHT_M`.
- Los trozos comparten el anillo frontera (el trozo c incluye el primer anillo del c+1; el último incluye el anillo 0). `v = s/10`, normales con `computeVertexNormals` salvo asfalto (se calculan de la sección para evitar costuras). Cada malla calcula `boundingSphere`.
- Extras: `ground` (plano grande a `min(y) − 0,5`) y `start-line` (cinta ajedrezada de 1 m en `startS`).

### D5. Simulación (`src/sim/`, sin three ni DOM)

```ts
// types.ts
export interface DriverInput { steer: number; throttle: number; brake: number; ers: boolean }   // steer [-1,1], pedales [0,1]
export type DriverCommand = 'shiftUp' | 'shiftDown' | 'drs';                                       // ignorados en este bloque
export const NEUTRAL_INPUT: DriverInput;
export interface CarState {
  x: number; y: number; z: number; yaw: number; pitch: number; roll: number;
  vx: number; vz: number; speed: number; vLong: number; vLat: number; yawRate: number;
  steerAngle: number; throttle: number; brake: number;         // valores filtrados aplicados
  aLong: number; aLat: number;                                  // m/s² en ejes del coche
  slip: number;                                                 // 0..1 deslizamiento (ángulo de deriva normalizado / patinaje)
  s: number; d: number; trackIndex: number; surface: Surface; kerbSide: TrackSide | null;
}
export interface TimingState { lap: number; lapTimeS: number; lastLapS: number | null; lastLapValid: boolean;
  bestLapS: number | null; sector: 0|1|2; sectorTimesS: (number|null)[]; lastSectorTimesS: (number|null)[];
  lapValid: boolean; deltaS: number | null }
export type SimEvent =
  | { type: 'lapStart'; lap: number }
  | { type: 'lapEnd'; lap: number; timeS: number; valid: boolean; best: boolean }
  | { type: 'sector'; index: 0|1|2; timeS: number }
  | { type: 'wallHit'; speedMs: number }
  | { type: 'surface'; surface: Surface };
export interface SimState { t: number; stepCount: number; car: CarState; timing: TimingState }
// car.ts
export function gripAccel(speed: number, surfaceMu: number, cfg: GameConfig): number;   // μ·(g + Fl/m)·μSurface
export function maxSteerRad(speed: number, cfg: GameConfig): number;
export function stepCar(car: CarState, input: DriverInput, track: Track, cfg: GameConfig, events: SimEvent[]): void;
// timing.ts
export class LapTimer { constructor(track: Track, cfg: GameConfig); readonly state: TimingState;
  update(sPrev: number, s: number, tPrev: number, t: number, events: SimEvent[]): void;
  invalidateLap(): void; setBestLap(timeS: number | null): void; reset(): void }
// simulation.ts
export class Simulation { constructor(track: Track, cfg?: GameConfig);
  readonly track: Track; readonly cfg: GameConfig; readonly state: SimState; readonly timer: LapTimer;
  step(input: DriverInput, commands?: readonly DriverCommand[]): SimEvent[];   // avanza exactamente cfg.sim.dt
  reset(): void;                    // parrilla: s = startS − startOffsetM, d = 0, parado
  recenter(): void }                // tecla R: línea central en el s actual, parado, rumbo de pista
```

Modelo (skill `f1-car-feel` §2–§3), en este orden por paso: filtrar entradas (`steerTauS`, `pedalTauS`) → `locate` → agarre `aMax = gripAccel(...)` → fuerza motriz `min(P/max(v, 5), μ·rearLoadFraction·(m·g + Fl)·μSurface)` × acelerador → freno `brake·brakeGripFactor·aMax` → arrastre, rodadura (× `rolling` de la superficie) y `−g·sin(pitch)` → giro deseado `r = v·tan(δ)/L` recortado a `aLatDisponible/v` (subviraje), donde `aLatDisponible` sale del círculo de fricción tras descontar la demanda longitudinal → término de sobreviraje `oversteerGain × exceso de tracción` → integrar `yaw` → relajar el vector velocidad hacia el rumbo con tasa `alignRate × aMax/(μ·g)` → integrar posición (Euler semi-implícito) → `locate` de nuevo → muro (recortar `d`, restitución, `speedLoss`, `yawKickRad`, evento) → `y`, `pitch`, `roll` de la pista → eventos de superficie. Sin marcha atrás: con `vLong ≤ 0` y freno, `v = 0`. El ruido de piano usa un LCG sembrado guardado en la instancia (determinismo). Prohibido `Math.random` y `performance.now` en `src/sim`.

**Tren motriz provisional:** potencia constante `car.powerKw` sin marchas. El bloque 4 lo sustituye por la caja; la suma combustión + ERS seguirá siendo 680 kW para no reajustar `cdA`.

**Cronómetro:** instante de cruce interpolado linealmente por `s` dentro del paso. Traza de referencia para el delta: tiempo transcurrido cada `traceStepM` de la mejor vuelta válida de la sesión. Vuelta contada solo si se visitaron los sectores 0→1→2.

### D6. Piloto de referencia (`src/sim/autopilot.ts`)

```ts
export function buildSpeedProfile(track: Track, cfg: GameConfig): Float64Array;   // m/s por muestra
export class Autopilot { constructor(track: Track, cfg?: GameConfig);
  update(state: SimState): { input: DriverInput; commands: DriverCommand[] } }
```

Perfil: `vLat(i)` resolviendo `v²·|k| = latGripUse·gripAccel(v)` (cerrado: `v² = μ·g·u / (|k| − μ·u·clA·ρ/(2m))`, tope `maxSpeedMs` si el denominador ≤ 0), y dos pasadas hacia atrás sobre la vuelta con `brakeGripUse` para limitar por frenada. Dirección: persecución pura hacia el punto de la línea central a `lookaheadBaseM + lookaheadPerMs·v`, `steer = clamp(−δ/maxSteerRad(v))`. Pedales: control proporcional sobre `vObjetivo(s + v·speedPreviewS) − v`. Sigue la línea central, no la trazada ideal: es una prueba de completabilidad, no un rival. *Alternativa descartada:* reproducir una traza de entradas grabada (diverge en lazo abierto con latencia de red).

### D7. Armazón (`src/host/`, `src/render/`)

```ts
// src/host/input/types.ts
export interface InputSource { readonly name: 'keyboard' | 'autopilot' | 'wheel';
  read(dtS: number, state: SimState): DriverInput; takeCommands(): DriverCommand[] }
// src/host/loop.ts  (puro, testeable)
export class FixedStepper { constructor(dt: number, maxSubSteps: number);
  advance(frameDtS: number, timescale?: number): { steps: number; alpha: number } }
// src/host/format.ts
export function formatLapTime(s: number | null): string;      // "1:18.457", "-:--.---"
export function formatDelta(s: number | null): string;        // "+0.123", "−0.045", ""
```

Archivos: `index.html`, `src/host/main.ts` (arranque y máquina de estados `loading → ready → racing ⇄ paused`, `error`), `src/host/loop.ts`, `src/host/input/keyboard.ts`, `src/host/input/autopilotSource.ts`, `src/host/hud.ts` + `src/host/hud.css`, `src/host/debugPanel.ts`, `src/host/debugApi.ts`, `src/host/storage.ts` (clave `f1mw.best.<trackId>`, try/catch), `src/render/scene.ts` (renderer, luz hemisférica + direccional sin sombras, niebla, cielo plano), `src/render/car.ts` (`buildCar(): THREE.Group`, monoplaza procedural simple con el morro hacia +X, ≤ 8 draw calls, colores de escudería ficticia, sin logos), `src/render/chaseCamera.ts` (seguimiento con suavizado exponencial; el bloque 5 lo sustituye).

- `timescale` multiplica el tiempo de fotograma y el máximo de pasos (`maxSubSteps × timescale`); solo con `debug=1`.
- API de depuración: `window.__f1 = { snapshot(): DebugSnapshot }` con `DebugSnapshot = { gameState, input, speedKmh, s, d, surface, lap, lapTimeS, lastLapS, lastLapValid, bestLapS, deltaS, fps, drawCalls, triangles, maxDrawCalls, maxTriangles, dpr, wallHits, simTimeS }`.
- HUD con `data-testid`: `hud-speed`, `hud-lap`, `hud-laptime`, `hud-last`, `hud-best`, `hud-delta`, `overlay-start`, `overlay-pause`, `overlay-error`, `debug-panel`.
- Interpolación: se guarda la pose previa `(x, y, z, yaw)` y se mezcla con `alpha` (ángulo por el camino corto).
- E2E: `tests/e2e/b2_drive.py` (Playwright Python, Chromium headless con `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`), lanzado con `.venv/bin/python .claude/skills/webapp-testing/scripts/with_server.py --server "npm run dev" --port 5173 -- .venv/bin/python tests/e2e/b2_drive.py`.

## Risks / Trade-offs

- [El piloto de referencia no completa la vuelta con los valores iniciales] → ajustar solo `config.autopilot.*`; si exige bajar `latGripUse` de 0,5 es síntoma de un fallo en la física o en `k`: reportar.
- [Bandas físicas incompatibles entre sí con un único juego de constantes] → reportar la banda concreta y los valores medidos; el orquestador ajusta la spec.
- [Chromium headless con SwiftShader va lento] → `timescale=8` y medir draw calls/triángulos, no fps; los fps se validan en el bloque 6 con GPU real.
- [Seguir la línea central da vueltas lentas (~85–100 s)] → aceptado; la banda de la spec lo cubre.
