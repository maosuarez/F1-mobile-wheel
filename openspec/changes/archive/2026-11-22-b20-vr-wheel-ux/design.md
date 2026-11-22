# Design

## Context

- Volante: `src/wheel/main.ts` envía `in` a `config.wheel.sendHz` con `steer/thr/brk/ers`; `ers` hoy es un botón mantenido (`controls.ts`, `btn-ers`) y DRS un evento (`btn-drs`). `SteeringEstimator` (`steering.ts`) da `steer` a partir de `accelerationIncludingGravity`. `Display` pinta la telemetría `tel`.
- Host: `buildTel` (`src/host/net/telemetry.ts`) arma `tel`; `updateWheel` (`main.ts`) atiende `pause/cam/restart` e ignora `recal`. `startCountdown()` arranca la cuenta atrás o el semáforo; online lo da el reloj del servidor.
- VR: `VrPanel` (`src/host/vr/panel.ts`) pinta `drawScreen(PanelScreen)` (`panelModel.ts`) en un plano hijo de la cámara; `CameraRig.debug().mode` vale `'chase' | 'helmet' | 'tv'`. La torre de carrera ya tiene modelo puro `towerModel()` en `src/host/race/tower.ts`.
- Habitáculo: `src/render/car.ts` crea `steering-wheel` (grupo) con la placa y `screenGeom` (cara del piloto hacia −X, 0,095 m alto × 0,11 m ancho, centro local ≈ (−0,022, 0,0025, 0)).
- `tel.drs`: 0 no disponible, 1 listo, 2 abierto.

## Goals / Non-Goals

**Goals:** gesto de agitar robusto y sin tirones de dirección; layout VR del celular; instrumentos en el volante 3D; panel de carrera VR; calibración previa en VR.

**Non-Goals:** cambiar el relay, los mandos de Quest, el teclado o el mando USB; háptica nueva; cambiar el HUD de escritorio.

## Decisions

### D1. Protocolo: campos opcionales en `tel`
- `TelMsg` gana `vr?: boolean` y `cal?: boolean`. `encode` los omite si son falsos/ausentes; `decodeTel` acepta solo booleanos (otro tipo → se ignora el campo sin invalidar el mensaje, como `pos/laps`). Actualizar la tabla de cabecera de `protocol.ts` y el docstring de `server/main.py` (solo comentario).
- `buildTel(state, extra)` gana `extra.vr?: boolean` y `extra.cal?: boolean` y los copia solo si son `true`.
- No hay `EvKey` nuevo: la sacudida usa `drs` (evento) y `ers` (campo de `in`); la calibración usa `recal`.

### D2. Detector de sacudidas (`src/wheel/shake.ts`, puro)
- Config nueva en `src/shared/config.ts` → `config.wheel.shake = { peakMs2: 14, windowMs: 450, peaks: 2, cooldownMs: 900, straightSteer: 0.2, ersOffBrake: 0.3, freezeMs: 350 }`.
- `class ShakeDetector { constructor(cfg); update(ax: number, ay: number, az: number, tMs: number): { shake: boolean; active: boolean } }`. Entrada: aceleración lineal (`DeviceMotionEvent.acceleration`; si viene null, `accelerationIncludingGravity` menos una gravedad estimada con filtro paso bajo de α = 0,1 dentro de la clase). Toma el eje de mayor módulo de cada muestra; un pico es `|a| > peakMs2` con signo opuesto al pico anterior; `shake = true` cuando se acumulan `peaks` picos dentro de `windowMs`; luego ignora todo durante `cooldownMs`. `active = true` desde el primer pico candidato hasta `freezeMs` después del último.
- `shakeAction(drs: 0|1|2, steer: number, ersOn: boolean, cfg): 'drs' | 'ersOn' | 'ersOff' | null`: `|steer| >= straightSteer` → null; `drs === 1` → `'drs'`; si no → alterna ERS.
- `main.ts` (volante): en `onMotion` llama a ambos; mientras `active`, no actualiza `steer` (mantiene el último valor) aunque el estimador siga filtrando. `ers` pasa a ser un latch; en el temporizador de envío, si `brk > ersOffBrake` → `ers = false`. Guarda `lastDrs` desde `onTel`.
- Alternativa descartada: doble sacudida para ERS; más falsos positivos y más difícil de aprender.

### D3. Layout del volante
- `wheel/index.html`: quitar `.actions` con `btn-ers` y `btn-drs`; quitar `onErs` y los `press` de esos botones en `controls.ts`. `.pedal-brk` crece con `flex: 1` en la columna izquierda.
- Modo VR: `Display.update(t)` pone `document.body.dataset.vr = t.vr ? '1' : '0'`. En `wheel.css`, con `body[data-vr="1"]`: se ocultan `.leds`, `.screen`, `.strip-info`, `.warn`; el `.menu` (`menu-panel`) se muestra siempre como rejilla 2×2 dentro de `.center` (ignorando `hidden` con `display:grid !important`) con botones de `min-height: 64px`; `btn-menu` y `btn-haptics` ocultos. En modo VR, CÁMARA/CENTRAR/PAUSA no cierran el panel (el cierre de `setMenu(false)` no tiene efecto visible porque el CSS fuerza la rejilla).
- Calibración: `wheel/index.html` añade `<div class="cover cover-cal" id="cover-cal" hidden><button class="start" data-testid="cal-start" type="button">CALIBRAR</button></div>` (ocupa toda la pantalla). En `onTel`: si `t.cal && !calDone` → mostrar; si `!t.cal` → `calDone = false` y ocultar. Al tocar (pointerdown en toda la capa): `estimator.recenter()`, `steer = 0`, `net.sendEv('recal')`, `calDone = true`, ocultar.

### D4. Instrumentos en el volante 3D
- Modelo puro `src/host/vr/wheelScreenModel.ts`: `WHEEL_SCREEN_W = 592`, `WHEEL_SCREEN_H = 512`; `wheelScreenOps(m: HudModel, drs: 0|1|2, ersPct: number, ot: boolean): DrawOp[]` (reutiliza `DrawOp` de `panelModel.ts`): marcha grande al centro (≥ 200 px), velocidad arriba (≥ 120 px), tiempo de vuelta y delta abajo (≥ 64 px, delta en verde/rojo), etiqueta DRS (gris/verde/azul según 0/1/2) y barra de ERS con `ot` resaltado.
- Render `src/render/wheelScreen.ts`: `class WheelScreen { readonly mesh: THREE.Mesh; constructor(); update(nowMs: number, ops: DrawOp[], redrawHz: number); dispose() }` con un `CanvasTexture` y `MeshBasicMaterial({ toneMapped: false })` en un `PlaneGeometry(0.11, 0.095)` girado para mirar a −X, posición local `(-0.0225, 0.0025, 0)` dentro de `steering-wheel` (justo delante de la pantalla emisiva). Un solo draw call. Para pintar, extraer de `VrPanel.paint` una función `paintOps(ctx, ops, qr?)` exportada en `src/host/vr/panel.ts` y reutilizarla.
- `car.ts`: el objeto devuelto expone `steeringWheel: THREE.Object3D` (el grupo `steer`) para que el host añada la malla. `main.ts`: al entrar en VR se crea `WheelScreen` y se añade al volante del coche de J1; `mesh.visible = inVr && rig.debug().mode === 'helmet'`; se actualiza solo si es visible; al salir de VR se quita.

### D5. Panel de carrera en VR
- `PanelScreen` gana `{ kind: 'race'; race: PanelRace; ahead: string; behind: string; rows: TowerRow[]; speed?: string; gear?: string }`; `drawScreen` lo pinta: cabecera `P{pos}/{total} · V {lap}/{laps}` (≥ 56 px), diferencias delante/detrás (≥ 40 px) y hasta 6 filas (≥ 34 px) con posición, punto de color, código y diferencia; la fila del jugador resaltada. Con `speed/gear` (cámaras que no son casco) los pinta en la esquina superior derecha.
- `main.ts` construye `rows` con `towerModel(...)` (las mismas entradas que la torre de escritorio, `towerInfo` ya incluye los códigos de nombres online) recortado a 6 filas centradas en el jugador por una función pura `towerWindow(rows: TowerRow[], n: number): TowerRow[]` en `tower.ts`.
- Selección en el bucle VR: `pairing/countdown/paused/calibrating` → como hasta ahora (+ `calibrate`); `race.isRace` → `race` (con `speed/gear` si la cámara no es casco); práctica + casco → `vrPanel.mesh.visible = false`; práctica + otra cámara → `hud` actual.
- `PanelScreen` gana también `{ kind: 'calibrate' }`: texto "CALIBRA EL VOLANTE" / "EN EL CELULAR" (≥ 80 px) y "A = SALTAR" (28 px).

### D6. Estado `calibrating` en el host
- `GameState` gana `'calibrating'`. Nueva función en `main.ts`: `const needsCal = () => inVr && !race.isOnline && pilots.length === 1 && p1.wheel?.link() === 'ok' && p1.source === p1.wheel`. Las llamadas a `startCountdown()` desde la parrilla, el reinicio y `startWithoutWheels` pasan por `beginStart()`: si `needsCal()` → `setState('calibrating')`, si no → `startCountdown()`.
- En `updateWheel`, evento `recal` con `state === 'calibrating'` y `p.source === w` → `startCountdown()`. Enter (listener existente) o el botón A del mando de Quest (rama de arranque existente de `vrControllers`) en `calibrating` → `startCountdown()`. La pausa no aplica en `calibrating`.
- Telemetría: `cal = state === 'calibrating' || (race.isOnline && inVr && (state === 'lobby' || state === 'countdown'))`; `vr = inVr`. El overlay de escritorio en `calibrating` reutiliza el texto del toast/aviso: `ui.toast('Calibra el volante en el celular', 4000)` al entrar.

## Risks / Trade-offs

- [Umbrales de sacudida sin probar en dispositivo] → Constantes en config; validación con celular real aplazada (ver memoria del proyecto). Los tests cubren picos sintéticos y bordillos.
- [El latch de ERS puede quedarse activo si no se frena] → La sim corta el modo con batería < 0,05.
- [Quitar DRS/ERS del volante es breaking] → Decisión explícita del usuario; teclado, mando y Quest conservan sus controles.
- [Texto pequeño en la pantalla del volante 3D] → Fuentes grandes y solo 5 datos; si no se lee en el visor, ampliar el plano en un change posterior.
