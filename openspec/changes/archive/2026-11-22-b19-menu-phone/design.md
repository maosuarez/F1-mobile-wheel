# Design

## Context

- `RaceMenu.render()` (`src/host/race/menu.ts`) pinta filas de botones genéricos; la lógica pura (`menuRows`, `menuStep`, `menuSet`, acciones de teclado/mando/volante) está cubierta por `tests/host.menu.test.ts` y el E2E `b14_race.py` usa los `data-testid` `menu`, `menu-<fila>-<valor>`, `menu-start`, `menu-online`.
- Regresión del volante: `shouldShowWheelButton(coarse, vr)` (`src/host/pairing.ts`) oculta el botón si `navigator.xr.isSessionSupported('immersive-vr')` es true; Chrome Android lo devuelve true en muchos celulares. El enlace secundario `pairing-wheel-link` vive en el overlay de emparejamiento, que desde b14 aparece después del menú.
- El relay rechaza entradas a una sala empezada (4002); no se toca.
- `LobbyView.render()` reescribe `innerHTML` en cada cambio, así que cualquier canvas de QR se recrea.

## Goals / Non-Goals

**Goals:** rediseño solo visual del menú (sin cambiar el modelo ni las acciones); detección del celular sin depender de WebXR; QR de la sala en el vestíbulo y overlay de QR en carrera online.

**Non-Goals:** fuentes web externas (el contenedor debe funcionar sin internet), imágenes nuevas, cambios en el vestíbulo más allá del QR.

## Decisions

### D1. Menú con estética de retransmisión, mismo modelo
- `RaceMenu.render()` genera esta estructura (clases nuevas en `src/host/hud.css`, bloque `/* b19 menú */`):
  - Cabecera `.gp-head`: franja roja inclinada (`clip-path` en paralelogramo) con "GRAN PREMIO" en cursiva condensada y, debajo, el nombre del circuito activo en mayúsculas.
  - Tarjeta de circuito `.gp-track` (fila `track`): una tarjeta por circuito con `name`, `country` y una etiqueta `DÍA`/`NOCHE` según `TrackInfo.lighting`; la seleccionada lleva borde rojo y una banda de cuadros (`repeating-conic-gradient`) en el borde izquierdo.
  - Fila `mode`: tarjetas grandes `.gp-mode` (Práctica / Carrera 5 vueltas) con subtítulo ("Vuelta libre, sin rivales" / "Salida con semáforo y rivales IA").
  - Filas `ai`, `rivals`, `players`: controles segmentados `.gp-seg` (botones pegados, el activo en blanco con texto negro).
  - Pie `.gp-actions`: botón `Empezar` rojo sólido grande y `Online` con borde; la pista de controles abajo en pequeño.
- Cada elemento seleccionable sigue siendo `<button class="menu-opt ..." data-row data-val data-testid="menu-<fila>-<valor>" aria-pressed>`; se conservan `data-testid="menu"`, `menu-start`, `menu-online` y el atributo `data-focus` en la fila enfocada. Así no cambian `tests/host.menu.test.ts` ni `b14_race.py`.
- Paleta como variables CSS en `.overlay.menu`: `--gp-red:#e10600`, `--gp-ink:#15151e`, `--gp-paper:#f5f5f7`, `--gp-line:#38383f`. Tipografía: `font-family: "Titillium Web", "Barlow Condensed", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif; font-stretch: condensed; font-style: italic` en títulos (solo fuentes del sistema, sin descargas). Ninguna se llama F1 ni copia logos.
- Responsivo: por debajo de 520 px las tarjetas de modo y circuito pasan a una columna y `.menu-card` usa `width: 100%` con `padding: 16px`.
- Alternativa descartada: reescribir el menú como pantalla por pasos; cambiaría el modelo y los tests sin necesidad.

### D2. Detección del celular por user agent de visor, no por WebXR
- `shouldShowWheelButton(coarseNoHover: boolean, userAgent: string): boolean` en `src/host/pairing.ts` devuelve `coarseNoHover && !VR_UA_RE.test(userAgent)` con `export const VR_UA_RE = /OculusBrowser|Quest|Pico|Wolvic/i`.
- `initWheelButton()` en `main.ts` deja de llamar a `navigator.xr.isSessionSupported`, pasa `navigator.userAgent` y es síncrono; exporta el resultado en una variable `isPhone` que usa el menú.
- `RaceMenu` recibe un 4.º parámetro de constructor `opts: { phoneWheel?: boolean } = {}`; con `phoneWheel` true, `render()` añade al principio una tarjeta `<a class="gp-phone" data-testid="menu-open-wheel" href="/wheel/">Usar este celular como volante</a>` (verde `#35e07a`, ancho completo).
- Alternativa descartada: seguir consultando WebXR con lista blanca de Android; frágil y asíncrona.

### D3. URL para unirse
- `joinUrl(loc, info, code: string, track: string): string` en `src/host/pairing.ts`, con el mismo origen que `wheelUrl` (`public_url` del relay si existe, si no el origen de la página): `<origen>/?track=<track>&online=join&code=<code>` (valores con `encodeURIComponent`).
- `LobbyRunOptions` gana `joinUrl?: (code: string) => string`. Con sala creada, `LobbyView.render()` añade `<canvas class="lobby-qr" data-testid="lobby-join-qr" width="200" height="200">` con `data-url` y un pie "Escanea para unirte"; tras cada `innerHTML` se llama `QRCode.toCanvas(canvas, url, { width: 200, margin: 2 })`. Sin `joinUrl` no se pinta.
- `main.ts` pasa `joinUrl: (code) => joinUrl(location, relayInfo, code, track.id)` (`relayInfo` ya se obtiene con `fetchRelayInfo()`).

### D4. Overlay de QR en carrera online
- `index.html`: `<div id="overlay-qr" class="overlay qr" data-testid="overlay-qr" hidden>` con dos tarjetas: volante (`canvas data-testid="qr-wheel"` + `data-testid="qr-wheel-code"`) y sala (`canvas data-testid="qr-room"` + `data-testid="qr-room-code"` + `data-testid="qr-room-closed"` con el texto "Sala cerrada: la carrera ya empezó"). Y un botón `<button class="qr-toggle" data-testid="qr-toggle" hidden>QR</button>` fijo arriba a la derecha.
- Clase nueva `QrOverlay` en `src/host/online/qrOverlay.ts`: `constructor(root: HTMLElement)`, `set(wheel: { url: string; code: string } | null, room: { url: string; code: string; closed: boolean })`, `toggle(): boolean`, `hide()`, `get visible`. Pinta los QR con `qrcode` al abrir (no en cada fotograma).
- `main.ts`: `qr-toggle` visible solo si `online && race.isOnline` y el estado es `countdown`, `racing` o `results`. En el listener de `keydown` existente: `KeyO` sin repetición y con carrera online → `qrOverlay.toggle()`; fuera de online no hace nada. `closed` = la carrera ya salió del vestíbulo (siempre true en carrera, se deja el parámetro para el vestíbulo futuro). El overlay no cambia `state` ni llama a `pause`.
- El volante sigue tomando el control a mitad de carrera por la rama existente de `updateWheel` (`p.source !== w` en `countdown/racing`); no se toca.

## Risks / Trade-offs

- [El user agent puede mentir] → Si un visor nuevo no está en `VR_UA_RE`, solo verá un botón de más; se amplía la regex.
- [Las fuentes condensadas pueden no estar instaladas] → La pila termina en `system-ui`; el diseño se apoya en cursiva, inclinación y color, no en una fuente concreta.
- [QR de la sala inútil en carrera] → Se muestra marcado como cerrado para que el código siga a mano; entrar en carrera queda fuera de alcance.
