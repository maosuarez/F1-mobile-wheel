# Design

## Context

El HUD del host es DOM sobre `#hud` (`src/host/hud.ts`, `index.html`, `hud.css`); abajo a la derecha ya está `.hud-energy`. La pista está en memoria como `Track` con `sampleAt(t, s)`, `wrapS`, curvatura `k` y `closed` (`src/track/query.ts`). `CarState` da `x, z, yaw, s`. Convención del sim (`src/sim/car.ts`): adelante = `(cos yaw, −sin yaw)`, izquierda = `(−sin yaw, −cos yaw)` en el plano (x, z).

## Goals / Non-Goals

**Goals:** minimapa legible a 60 fps, cálculo puro testeable, cero asignaciones por fotograma.

**Non-Goals:** celular, cambiar el panel de VR existente, pista completa, rivales, zoom por velocidad.

## Decisions

**D1. Constantes** en `src/shared/config.ts`, bloque nuevo:
`minimap: { aheadM: 350, behindM: 60, stepM: 5, cornerK: 0.008, redrawHz: 30, carY: 0.72 }`
(`carY` = posición vertical del coche como fracción del alto; 0 arriba).

**D2. Módulo puro `src/track/minimap.ts`** (sin DOM ni three):
```ts
export interface MinimapPath {
  n: number;            // puntos válidos
  iCar: number;         // índice del punto en s del coche (separa "recorrido" de "por delante")
  xy: Float32Array;     // pares (x derecha, y adelante) en metros, sistema del coche
  strong: Uint8Array;   // 1 si |k| >= cornerK
}
export function createMinimapPath(cfg: typeof config.minimap): MinimapPath;   // buffers de tamaño fijo
export function buildMinimapPath(t: Track, car: { x: number; z: number; yaw: number; s: number }, cfg: typeof config.minimap, out: MinimapPath): void;
```
Puntos: `s_j = s + j·stepM` para `j = −behindM/stepM … aheadM/stepM`; `wrapS` en pistas cerradas, recorte a `[0, length]` en abiertas (`n` menor). Con `dx = x−car.x, dz = z−car.z`: `y = dx·cos(yaw) − dz·sin(yaw)`, `x = −(−dx·sin(yaw) − dz·cos(yaw))` (derecha positiva). La referencia es la posición real del coche, no la línea central, así el punto refleja el desvío lateral. Rotar con `yaw` y no con el rumbo de pista es la decisión pedida ("rumbo hacia arriba"); sin suavizado.

**D3. Dibujo `src/host/minimap.ts`**: `class Minimap { constructor(track: Track, canvas: HTMLCanvasElement); update(car: CarState, nowMs: number): void; show(v: boolean): void }`. Limita a `redrawHz`; buffer propio por `createMinimapPath`. Canvas 2D con `devicePixelRatio` limitado a `config.render.maxDpr`; recorte circular. Escala `px/m = (carY·H − margen) / aheadM`; coche en `(W/2, carY·H)`. Orden: fondo semitransparente (`--panel`), tramo recorrido (blanco 35 %), tramo delantero (blanco, trazo 4 px), curvas fuertes superpuestas (`#ffb020`, mismo trazo), punto del coche (`#35e07a` con borde oscuro, radio 5 px). Dibuja con `beginPath`/`lineTo` por tramos de igual color; sin objetos nuevos por fotograma.

**D4. DOM y CSS**: `<canvas data-testid="hud-minimap" aria-hidden="true">` dentro de `#hud`, fuera de los `section`. CSS: `position: absolute; right: clamp(12px,1.5vw,28px); bottom: calc(clamp(12px,1.5vw,28px) + 150px); width/height: clamp(160px,14vw,240px); border-radius: 50%`. El desplazamiento de 150 px es un punto de partida: el implementador lo ajusta con captura para que no solape `.hud-energy` a 1920×1080 y a 1280×720.

**D5. Integración**: en `src/host/main.ts`, tras `new Hud()` crear `new Minimap(track, canvas)`; junto a `hud.update(...)` llamar `minimap.update(sim.state.car, performance.now())`. Visible solo cuando el HUD lo está (`hud.show`): el minimapa se oculta con `#hud[hidden]` sin código extra.

**D6. VR** (ampliación pedida por el usuario): `src/host/vr/minimap.ts`, `class VrMinimap { readonly mesh: THREE.Mesh; constructor(source: HTMLCanvasElement, cfg?: GameConfig); update(version: number): void; dispose(): void }`. Plano cuadrado de lado `config.vr.minimapSizeM = 0.22` con `CanvasTexture` del **mismo canvas** que dibuja `Minimap` (no se duplica el dibujo). Material igual que `VrPanel` (`transparent`, `depthTest: false`, `depthWrite: false`, `toneMapped: false`, `renderOrder = 999`, `SRGBColorSpace`). Posición simétrica al panel: `(+(s/2 + 0.07·d), −(s/2 + 0.12·d), −d)` con `d = config.vr.hudDistanceM`. `Minimap` expone `get canvas()` y `get version()` (contador que sube en cada redibujo); `VrMinimap.update(v)` pone `texture.needsUpdate = true` solo si `v` cambió (30 Hz efectivos, no 10 Hz como el panel). Si `clientWidth` del canvas es 0, `Minimap` usa 256 px internos para seguir dibujando. En `main.ts`: crear con el panel al entrar en VR (`camera.add`), quitar al salir, y llamar `vrMinimap.update(minimap.version)` cuando `inVr`.

## Risks / Trade-offs

- Rotar con `yaw` hace girar el mapa en derrapes: se acepta; si resulta mareante, un change posterior añade suavizado.
- 80 puntos por actualización a 30 Hz es despreciable; no se necesita caché.
- Con la pista abierta (sintética) el recorte puede tener menos puntos; el dibujo usa `n`.
