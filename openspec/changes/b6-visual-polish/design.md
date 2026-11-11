# Design

## Context

Tras el bloque 5: escena con luz hemisférica + direccional sin sombras, coche procedural simple (`src/render/car.ts`), mallas de pista con colores por vértice y tres materiales compartidos, `CameraRig`, `DebugSnapshot` con draw calls y triángulos. Este PC tiene una GPU integrada Radeon Vega: es la máquina objetivo de la medición. Skills: `threejs-aaa-graphics-builder` (rúbrica y dirección de arte), `threejs-lighting`, `threejs-materials`, `threejs-postprocessing`, `threejs-performance`.

## Goals / Non-Goals

**Goals:** salto visual con coste acotado y medible; todo procedural y determinista; niveles de calidad.

**Non-Goals:** WebGPU/TSL (se mantiene `WebGLRenderer`); activos externos o generados con IA; cambios en `src/sim`, `src/shared/protocol.ts` o el volante.

## Decisions

### D1. Niveles de calidad (`src/render/quality.ts`)

```ts
export type QualityLevel = 'high' | 'medium' | 'low';
export interface QualitySettings { dpr: number; shadows: boolean; shadowMapSize: number; post: boolean; msaaSamples: number; trees: number; particles: number; envMapSize: number }
export const QUALITY: Record<QualityLevel, QualitySettings>;
export class AdaptiveQuality { constructor(q: GameConfig['quality'], initial: QualityLevel, locked: boolean);
  level: QualityLevel; sample(frameDtS: number, active: boolean): QualityLevel | null }   // devuelve el nuevo nivel si cambia (puro)
export class FpsMeter { push(frameDtS: number): void; avg(): number; p5(): number; reset(): void }
```

`QUALITY`: `high { dpr: 1.5, shadows: true, 2048, post: true, msaa: 4, trees: 600, particles: 400, env: 256 }`, `medium { 1.25, true, 1024, false, 0, 400, 250, 128 }`, `low { 1.0, false, 0, false, 0, 300, 120, 64 }`. `config.quality = { downFps: 50, windowS: 3 }`. `?quality=` fija el nivel y bloquea la adaptación; `?post=0` fuerza `post: false`. Cambiar de nivel reconfigura en caliente (DPR, `shadowMap`, pasadas, `InstancedMesh.count`) sin recargar.

### D2. Luz, cielo y entorno de reflexión (`src/render/scene.ts`, `src/render/sky.ts`)

- `renderer.toneMapping = ACESFilmicToneMapping`, `outputColorSpace = SRGBColorSpace`, `shadowMap.type = PCFSoftShadowMap`.
- Sol: un `DirectionalLight` con `castShadow`; cámara ortográfica de sombra de 60 × 60 m centrada 15 m por delante del coche, reposicionada cada fotograma y ajustada a incrementos de un téxel para que no tiemble. Solo el coche proyecta sombra; la pista la recibe. `HemisphereLight` de relleno.
- Cielo: cúpula con `ShaderMaterial` de degradado (cénit, horizonte, halo del sol), `depthWrite: false`, `fog: false`. `scene.fog = THREE.Fog` con el color del horizonte.
- Entorno de reflexión: `PMREMGenerator.fromScene` sobre una escena auxiliar con solo la cúpula, una vez al arrancar → `scene.environment`. *Alternativa descartada:* HDRI externo (activo externo, más peso).

### D3. Coche (`src/render/car.ts`, `src/render/carMaterials.ts`)

`buildCar(): CarVisual` con `interface CarVisual { group: THREE.Group; wheels: { fl, fr, rl, rr: THREE.Object3D }; flap: THREE.Object3D; update(car: CarState, dtS: number): void }`. Geometría procedural (`ExtrudeGeometry`, `LatheGeometry`, cajas biseladas) fusionada por material con `BufferGeometryUtils.mergeGeometries`: carrocería (un `MeshPhysicalMaterial` con `clearcoat` y colores por vértice para la decoración), carbono, neumático, llanta. Ruedas y `rear-wing-flap` como objetos separados para animarlos; el resto se fusiona conservando un `Object3D` vacío con cada nombre exigido como marcador de la pieza. `update`: giro de ruedas `vLong/radio`, viraje delantero `steerAngle`, cabeceo y balanceo visuales `≤ 1,5°` filtrados, apertura del plano móvil 0 → 35° con `car.drs === 2`. Decoración: dos colores propios y un dorsal; ningún texto ni forma que recuerde a un equipo real.

Habitáculo (vista principal): `cockpit` (borde y reposacabezas), `halo` con pilar central fino, `steering-wheel` (objeto aparte que gira `steer × 120°`, con pantalla emisiva) y `suspension` (brazos delanteros). La cámara de casco queda detrás del volante y bajo el aro del halo; `camera.helmet.offset` se reajusta aquí. Diámetro de rueda 0,72 m (radio 0,36), ancho de neumático delantero 0,305 m y trasero 0,405 m, ancho total 2,0 m.

### D4. Superficies (`src/render/trackMaterials.ts`, cambios en `src/track/mesh.ts`)

Texturas en `CanvasTexture` generadas con un PRNG sembrado, ≤ 1024 px: grano de asfalto (color + `roughnessMap`), hierba (ruido de dos escalas). `mesh.ts` conserva los colores por vértice y añade: UV (`u` lateral en metros / 4, `v = s / 4`), oscurecimiento por vértice de la banda de goma (gaussiana centrada en `d = 0`, 3 m de ancho, −15 % de luminancia) y franjas de siega en la hierba por `s`. Cajones de parrilla y línea ajedrezada como una cinta más de la malla `road` del primer trozo. `buildTrackMeshes` pasa a recibir los materiales como parámetro; los tests de continuidad y presupuesto del bloque 2 siguen vigentes.

### D5. Entorno (`src/render/environment.ts`)

`buildEnvironment(track, settings): THREE.Group` con: gradas (`InstancedMesh` de un módulo de 12 m, a ambos lados de la recta principal, colocadas a `muro + 4 m`), árboles (2 `InstancedMesh`: tronco y copa; posiciones con PRNG sembrado a `muro + 3…60 m`, descartando las que caigan a menos de `muro + 3 m` de cualquier otro tramo de pista usando `locateGlobal`), y un anillo lejano de silueta (una malla, sin niebla propia). Público de las gradas como textura de ruido de color, sin figuras.

### D6. Partículas (`src/render/particles.ts`)

Un único `THREE.Points` con `ShaderMaterial` y atributos por partícula (posición inicial, velocidad, tiempo de nacimiento, tipo); la animación se calcula en el vertex shader a partir de `uTime`, así la CPU solo escribe al emitir. Emisión desde las ruedas en contacto: tierra si `surface === 'grass'` y `speed > 5 m/s`; humo si `slip > 0.6` y `speed > 16,7 m/s`. Tamaño del anillo = `settings.particles`. `debug(): { active: number }`.

### D7. Posproceso (`src/render/post.ts`)

`EffectComposer` de `three/examples/jsm` con `RenderPass` → `UnrealBloomPass` (a media resolución, umbral 0,9, intensidad 0,35) → pasada final propia que combina viñeta y `OutputPass` (tonos + sRGB). Destino con `samples = msaaSamples`. Con `post: false` se renderiza directo al lienzo con el antialias nativo.

### D8. Medición

- `DebugSnapshot` += `quality`, `rendererName` (extensión `WEBGL_debug_renderer_info`), `shadowLights`, `shadowMapSize`, `post`, `particlesActive`, `fpsAvg`, `fpsP5`, `carDrawCalls`, `carTriangles`, `envDrawCalls`.
- `tests/e2e/b6_perf.py`: Chromium con `--enable-gpu --ignore-gpu-blocklist --use-angle=gl-egl` (probar también `--use-angle=vulkan`); si `rendererName` contiene `SwiftShader` o `llvmpipe`, imprime `SIN GPU` y sale con código 2; si no, mide una vuelta a 1920×1080 con `autopilot=1&timescale=1` y exige media ≥ 55 y p5 ≥ 45.
- `tests/e2e/b6_visual.py`: capturas de referencia en `out/b6_*.png` con `?debug=1&autopilot=1&timescale=4` deteniéndose (pausa) en los `s` de las curvas pedidas, y métricas de píxel calculadas en la propia página con un `canvas` 2D sobre `renderer.domElement` (`preserveDrawingBuffer` solo con `debug=1`), sin dependencias nuevas: `window.__f1.pixels(region)` devuelve luminancia media y fracciones de blanco y negro puros.

## Risks / Trade-offs

- [No se alcanzan 55 fps en la Radeon Vega con `high`] → la adaptación baja de nivel; el criterio de fluidez se evalúa con la calidad que el juego elige solo, y se informa del nivel resultante.
- [Chromium headless no usa la GPU real] → salida con código 2 y validación manual del usuario con F3.
- [`UnrealBloomPass` caro a 1080p] → media resolución; es lo primero que cae en `medium`.
- [La sombra tiembla o se recorta al moverse] → ajuste a téxel y frustum pequeño centrado en el coche.
- [La nota de la rúbrica es subjetiva] → la puntúa el orquestador sobre capturas fijas y la confirma el usuario; las métricas de píxel acotan los fallos gruesos.
