# Design

## Context

Relay FastAPI (`server/main.py`) ya expone `/ws/{room}` y `/api/info`; en desarrollo Vite hace proxy. `PairingUi.wheelUrl` ya usa `public_url`. `VrControllersSource` ya tiene gatillos, roll, palanca como marcha, A/X y B/Y sostenido (`src/host/input/vrControllers.ts`). En `src/host/main.ts` `updateControllers` solo corre con `inVr`, pero el estado `pairing` solo arranca con Enter, volante o mando USB: en VR no hay arranque.

## Goals / Non-Goals

**Goals:** un contenedor, un puerto; entrada manual del código; VR jugable solo con mandos.
**Non-Goals:** ver el celular en VR, cambios en sim o protocolo, mapeos configurables.

## Decisions

**D1 Servir estáticos desde el relay.** `server/main.py` monta `StaticFiles(directory=DIST_DIR, html=True)` en `/` DESPUÉS de las rutas `/ws` y `/api` (`DIST_DIR` por env, por defecto `dist`; el montaje solo se hace si existe el directorio, para no romper el desarrollo). Sin nginx. `/wheel/` resuelve a `dist/wheel/index.html` con `html=True`.

**D2 Imagen.** Dockerfile multi-stage: etapa `node:22-alpine` (`npm ci`, `npm run build`; el build ejecuta `tsc --noEmit`), etapa final `python:3.12-slim` con `requirements-server.txt` (`fastapi`, `uvicorn[standard]`), copia `server/` y `dist/`, usuario no root, `CMD uvicorn server.main:app --host 0.0.0.0 --port 8000`. `requirements.txt` queda para herramientas de pista (no se toca). Healthcheck con `python -c urllib` sobre `/api/info` (la slim no trae curl). `.dockerignore`: `node_modules`, `dist`, `out`, `.venv`, `.git`, `tools/track/.cache`, `tests`, `.claude`, `openspec`.

**D3 Compose.** `ports: "${HOST_PORT:-28473}:8000"`, `environment: PUBLIC_URL`, `restart: unless-stopped`. Instrucciones de despliegue y de cloudflared (`service: http://localhost:28473`) como comentarios en el propio compose (no se crean `.md`). Cloudflared da HTTPS, necesario para WebXR y para que el celular use `wss`.

**D4 Entrada del código.** En `wheel/index.html` el `cover-noroom` añade `<input data-testid="room-input" maxlength="4" autocapitalize="characters">` y `<button data-testid="room-join" disabled>`. En `src/wheel/main.ts`: sanear con `ROOM_ALPHABET`, habilitar con `isRoomCode`, y `location.search = ?room=CODE` al unirse (recarga limpia, sin tocar el flujo de estados). Función pura `sanitizeRoomInput(s: string): string` exportada desde `src/shared/protocol.ts` para testearla.

**D5 Mapeo de mandos.** Constantes en `config.vr`: `gripButton: 1`, `stickClickButton: 3`. `VrControllersState` gana `rightGrip: boolean`; `mapControllers` devuelve `ers: rightGrip`. `VrControllersSource` encola `'drs'` por flanco del agarre izquierdo (mismo patrón que `stickShiftEdges`, sin estado nuevo salvo `prevLeftGrip`). `VrButtons` gana `stick: boolean` y `buttonEdges` emite `'camera'` por flanco de `buttons[3]` izquierdo; `VrButtonEvent` añade `'camera'` y `'start'`. `'start'` = flanco de A (el mismo evento `pause` se reinterpreta en `main.ts`: en `pairing` arranca, en carrera pausa).

**D6 Arranque en main.ts.** En `updateControllers`: si `inVr` y `state === 'pairing'` y llega `pause` (A): `setSource(controllersSource)`, `controllersSource.reset()`, `startCountdown()`. `camera` → `rig.next()` siempre. `takeCommands()` se descarta con la misma regla que ya aplica al volante cuando `state==='paused'` o la fuente no es los mandos.

**D7 Leyenda.** `panelModel.ts`: función `legendOps(): DrawOp[]` con ids `legendStart`, `legendDrs`, `legendErs`, `legendCam`, `legendGear`, `legendPause` (texto ≤ 44 chars, tamaño 28 px) usada por `pairing` y `paused`. En `pairing` el código sube a `size: 170`, el QR se reduce a 220 px (el usuario en VR prioriza el código escrito), y el hint se acorta. Sin cambios de lienzo (1024×512).

## Risks / Trade-offs

- Índices de botones `xr-standard` en Quest 3 (grip=1, palanca=3) no verificados con visor real: validación aplazada; los índices viven en `config.vr` para corregirlos sin tocar lógica.
- `npm ci` en la imagen exige `package-lock.json` versionado (lo está).
- El relay sin estado en memoria: reiniciar el contenedor cierra las salas; el celular y el host reconectan por su cuenta.
