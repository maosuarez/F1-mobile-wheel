# Design

## Context

El relay empareja exactamente 1 `host` y 1 `wheel` por sala de 4 caracteres. `WheelSource` gestiona una sala. El teclado mezcla WASD y flechas en un solo jugador. `main.ts` tiene un `rig` de cámara, un HUD DOM, un minimapa y un `post` (bloom + viñeta).

## Decisions

### D1. Una sala por jugador
El PC crea N códigos de sala distintos y una `WheelSource` por jugador. El relay no cambia. La pantalla de emparejamiento muestra un QR por jugador con su etiqueta "J1"/"J2" y su color. El volante no cambia.

### D2. Jugadores y fuentes
```ts
// src/host/split/players.ts
export interface LocalPlayer { index: number; entryId: number; source: InputSource; rig: CameraRig; hud: HudView; minimap: Minimap; wheel: WheelSource | null; gamepadIndex: number | null }
export function assignSources(n: number, pads: number, wheels: WheelLink[]): ('wheel'|'gamepad'|'keyboard')[]
```
Prioridad por jugador: volante enlazado de su sala > mando con índice = jugador > teclado de su mitad. El teclado se separa en `KeyboardInput(keys, layout: 'p1'|'p2'|'both')` (`both` = comportamiento actual para un jugador). J2: flechas, `Comma`/`Period` cambio, `Slash` DRS, `ShiftRight` ERS. Mando: `GamepadInput` recibe índice fijo.

### D3. Render dividido
```ts
// src/host/split/layout.ts
export function viewports(n: number, w: number, h: number): { x: number; y: number; w: number; h: number }[]  // n=2: arriba J1, abajo J2
```
Por fotograma: para cada jugador `renderer.setViewport/ setScissor(true)`, su cámara con `aspect = w/h` de la mitad, `renderer.render(scene, cam)`. Sin `EffectComposer` en modo dividido (la viñeta se aplica con un overlay CSS por mitad). Calidad forzada a ≤ `medium` (`quality.ts`), sombra única centrada entre los dos coches con `shadowExtentM` ampliado si están a < 150 m; si están más lejos, la sombra sigue a J1 y J2 usa sombra de contacto falsa (disco oscuro bajo el coche). Cada humano se dibuja siempre con el modelo detallado (2 copias); los rivales de IA, con instanciado.

### D4. HUD y minimapa por mitad
`hud.ts` se convierte en `HudView` instanciable sobre un contenedor; `index.html` tiene `#hud-p1`, `#hud-p2` (posicionados en cada mitad con CSS) y la torre en el borde derecho, compartida. Minimapa: un canvas por jugador. Avisos (límites, DRS) por jugador.

### D5. Audio
Un motor procedural por jugador humano; ganancia `split.engineGain` (0,6) cada uno, sin paneo. Rivales: los 2 más cercanos a cualquiera de los dos jugadores.

### D6. Pausa y reinicio
Cualquiera pausa para ambos; la pérdida de enlace de cualquier volante activo pausa con el aviso "Volante J2 desconectado".

### D7. Constantes
`config.split = { maxPlayers: 2, engineGain: 0.6, maxQuality: 'medium', p2Keys: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', shiftUp: 'Period', shiftDown: 'Comma', drs: 'Slash', ers: 'ShiftRight' } }`. Parámetro URL `players=2`.

## Risks / Trade-offs

- Dos pasadas de escena duplican draw calls: con calidad `medium` y rivales instanciados, objetivo ≤ 2 × 150; se mide en el E2E y en GPU real.
- Pantalla arriba/abajo reduce el campo vertical: es la convención en juegos de carreras.
