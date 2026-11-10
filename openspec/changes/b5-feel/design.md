# Design

## Context

Tras el bloque 4: `CarState` expone `rpm`, `throttle`, `speed`, `limiter`, `aLong`, `aLat`, `surface`, `slip`; `SimEvent` incluye `shift`, `shiftRejected`, `limiter`, `limits`, `wallHit`, `surface`; el volante ya vibra al recibir `fx` y envía `ev cam`; existe `src/render/chaseCamera.ts` (seguimiento simple). Skill `f1-car-feel` §9–§10.

## Goals / Non-Goals

**Goals:** toda la lógica (parámetros de audio, resortes, FOV, temblor, planificación de `fx`) en funciones puras testeables en Node; los nodos de Web Audio y la cámara de Three.js son envoltorios finos.

**Non-Goals:** muestras de audio, HRTF/espacialización, repeticiones, transición animada entre cámaras.

## Decisions

### D1. Configuración nueva

```ts
audio:  { masterGain: 0.6, cylindersFactor: 3, idleGain: 0.28, fullGain: 0.85, cutoffMinHz: 500, cutoffMaxHz: 5200,
          rpmCutoffBoost: 0.6, squareMix: 0.35, turboGain: 0.12, windGain: 0.35, windRefMs: 90,
          paramTauS: 0.02, shiftDipS: 0.04, shiftDipGain: 0.3, crackS: 0.05, crackGain: 0.5, limiterHz: 15, limiterDepth: 0.5 },
camera: { fovMinDeg: 70, fovMaxDeg: 84, fovRefKmh: 320,
          chase: { distM: 7.5, heightM: 2.6, lookAheadM: 8, omega: 9, velocityBlend: 0.7 },
          helmet: { offset: [0.15, 0.82, 0], rollDegPerG: 1.0, pitchDegPerG: 0.6, maxDeg: 6, lookSteerDeg: 5, omega: 14 },
          tv: { spacingM: 300, heightM: 7, outsideM: 10, leadM: 20, minFovDeg: 6, maxFovDeg: 50, frameWidthM: 14 },
          shake: { kerbM: 0.03, grassM: 0.05, highSpeedM: 0.012, highSpeedKmh: 250, highSpeedRefKmh: 330, hz: [17, 23, 31] } },
fx:     { minGapMs: 80, kerbRepeatMs: 120, grassRepeatMs: 300, limiterRepeatMs: 100, minSpeedKmh: 20 },
```

`config.render.chase` se elimina (lo sustituye `camera.chase`).

### D2. Audio (`src/audio/`)

```ts
// engineParams.ts  (puro)
export interface EngineAudioInput { rpm: number; throttle: number; speedMs: number; limiter: boolean }
export interface EngineAudioParams { f0Hz: number; sawGain: number; squareGain: number; cutoffHz: number; engineGain: number; turboGain: number; turboHz: number; windGain: number; windCutoffHz: number }
export function engineParams(i: EngineAudioInput, a: GameConfig['audio']): EngineAudioParams;
export function limiterGainAt(tS: number, a: GameConfig['audio']): number;            // modulación 0..1
export function shiftEnvelope(tSinceShiftS: number, a: GameConfig['audio']): number;  // multiplicador de ganancia
// engine.ts
export class EngineAudio { constructor(cfg: GameConfig);
  start(): Promise<void>;                       // crea/reanuda AudioContext; llamar solo desde un gesto
  update(car: CarState, dtS: number): void; onEvent(e: SimEvent): void;
  setPaused(p: boolean): void; setMuted(m: boolean): void; readonly muted: boolean;
  debug(): { state: string; f0Hz: number; rms: number; peak: number } | null }
```

Grafo: `osc sierra (f0)` + `osc cuadrada (2·f0)` → `GainNode` de mezcla → `WaveShaperNode` (tanh suave) → `BiquadFilter lowpass (cutoffHz)` → `engineGain` → `shiftGain` → `limiterGain` → `master`. Ruido blanco en bucle (un `AudioBuffer` de 2 s generado con un LCG sembrado) → `bandpass (turboHz ∝ rpm)` → `turboGain` → `master`; el mismo ruido → `lowpass (windCutoffHz)` → `windGain` → `master`. `master` → `DynamicsCompressor` (limitador) → `destination`, con un `AnalyserNode` en paralelo solo con `debug=1`. Todos los cambios con `setTargetAtTime(valor, now, paramTauS)`; caída de cambio y chasquido con `setValueAtTime` + `linearRampToValueAtTime`. Pausa y silencio: rampa de `master` a 0 en 0,1 s (no `suspend`, para reanudar sin chasquido). Preferencia en `localStorage` `f1mw.muted` (try/catch). Tecla V.

### D3. Cámaras (`src/render/cameras/`)

```ts
// math.ts  (puro, sin three)
export class CriticalSpring { constructor(omega: number); x: number; v: number; step(target: number, dtS: number): number; snap(x: number): void }   // solución analítica exacta ⇒ independiente de los fps
export function fovFor(speedKmh: number, c: GameConfig['camera']): number;
export function shakeAmplitude(car: CarState, c: GameConfig['camera']): number;
export function shakeOffset(amplitudeM: number, tS: number, c: GameConfig['camera']): [number, number];   // suma de senos de `hz`
export interface TvCamera { s: number; x: number; y: number; z: number }
export function buildTvCameras(track: Track, c: GameConfig['camera']): TvCamera[];
export function activeTvCamera(cams: TvCamera[], track: Track, carS: number): number;
export function tvFovDeg(distM: number, c: GameConfig['camera']): number;
// rig.ts
export type CameraMode = 'chase' | 'helmet' | 'tv';
export interface CarPose { x: number; y: number; z: number; yaw: number; pitch: number; roll: number }
export class CameraRig { constructor(camera: THREE.PerspectiveCamera, track: Track, cfg: GameConfig);
  mode: CameraMode; next(): CameraMode;
  update(pose: CarPose, car: CarState, dtS: number, tS: number): void;
  debug(): { mode: CameraMode; fovDeg: number; shakeM: number; pos: [number, number, number]; tvIndex: number } }
```

- **Persecución:** tres `CriticalSpring` (x, y, z) hacia `pose − dir·distM + altura`, con `dir` = mezcla (`velocityBlend`) entre rumbo y dirección de la velocidad (solo si `speed > 5 m/s`). Mira a `pose + dirVelocidad·lookAheadM`.
- **Casco:** posición = `pose` + `offset` en ejes del coche, sin resorte de posición; resortes (`helmet.omega`) sobre el balanceo `−aLat/g·rollDegPerG` y el cabeceo `−aLong/g·pitchDegPerG`, recortados a `maxDeg`; guiñada extra `steer·lookSteerDeg`. `near = 0.1`.
- **TV:** cámara i en `s_i = (i + 1)·spacing − leadM`, desplazada `wl + outsideM` a la izquierda y `heightM` sobre la pista; activa la del tramo `floor(s / spacing)`; el número de cámaras es `round(length / spacingM)` y el espaciado real `length / n`. `tvFovDeg` devuelve el FOV vertical que encuadra `frameWidthM` de ancho a esa distancia con aspecto 16:9 (`2·atan(frameWidthM / (2·dist·16/9))`), recortado a `[minFovDeg, maxFovDeg]`.
- Al cambiar de modo: `snap` de todos los resortes al objetivo. El temblor se suma en el espacio de la cámara tras calcular la pose; `tS` es el tiempo de simulación (determinista).
- `main.ts`: C y `ev cam` → `rig.next()`. `src/render/chaseCamera.ts` se elimina.

### D4. Háptica (`src/host/net/fx.ts`)

```ts
export class FxPlanner { constructor(f: GameConfig['fx']);
  plan(events: readonly SimEvent[], car: CarState, nowMs: number): FxKey | null }   // como máximo un fx por llamada
```

Cola interna de puntuales (`limits` antes que `shift`) y temporizadores de continuos (`kerb`, `grass`, `limiter`). `plan` devuelve `null` si pasaron menos de `minGapMs` desde el último envío. `main.ts` llama a `plan` una vez por fotograma solo si el volante está en control y el juego no está en pausa, y envía `encode({ t: 'fx', k })`.

### D5. Depuración

`DebugSnapshot` += `audio` (resultado de `EngineAudio.debug()`), `camera` (resultado de `CameraRig.debug()`), `fxSent: Record<FxKey, number>`.

## Risks / Trade-offs

- [El sintetizador suena a zumbido y no a motor] → criterio subjetivo no automatizable: el usuario lo escucha al cerrar el bloque; los mandos son `squareMix`, el `WaveShaper` y `rpmCutoffBoost`.
- [Audio en Chromium headless] → funciona con salida nula; si el `AnalyserNode` devuelve silencio en ese entorno, el E2E lo reporta y la comprobación de RMS pasa a manual.
- [El temblor o el FOV marean] → amplitudes conservadoras y todas en `config.camera`.
- [La cámara de casco muestra el interior del coche provisional] → aceptado hasta el bloque 6, que añade halo y habitáculo.
