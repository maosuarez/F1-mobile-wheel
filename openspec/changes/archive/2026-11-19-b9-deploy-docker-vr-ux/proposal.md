# Proposal

## Why

El juego corre hoy con `vite dev` + relay en el PC. Se quiere dejarlo permanente como contenedor en el servidor, detrás de cloudflared, con un único puerto alto del host. Además, en las gafas Meta Quest 3 el flujo actual falla: el QR casi no se puede escanear, el volante del celular no se ve, y en la pantalla de emparejamiento VR no hay forma de arrancar con los mandos (solo Enter o el celular). Los mandos solo cubren pausa, recolocar, reinicio, marcha por palanca y pedales; faltan DRS, ERS y cámara.

Referencia: [context.md](../../../context.md); módulo adicional fuera de los bloques 1–6, acordado con el usuario. Extiende `b7-vr` (con 6.3 pendiente) sin duplicarlo.

## What Changes

- Imagen Docker multi-stage (build de Vite + relay FastAPI) y `docker-compose.yml`: el relay sirve `dist/`, `/ws` y `/api` en un solo puerto; un solo puerto de host configurable (por defecto 28473). `PUBLIC_URL` por entorno para el QR.
- Volante del celular: la pantalla "sin sala" permite escribir el código de 4 caracteres y unirse.
- VR: jugar solo con los mandos sin celular. A arranca desde el emparejamiento, agarre izquierdo = DRS, agarre derecho = ERS (mantener), clic de palanca izquierda = cámara. El panel VR muestra una leyenda del mapeo y el código de sala grande.
- Contenerizar (Dockerfile, compose, `.dockerignore`) y subir a `origin/main` sin force.

## Capabilities

### New Capabilities

- `docker-deploy`: empaquetado y ejecución del juego como contenedor de un solo puerto.
- `vr-quest-controls`: arranque y acciones completas con los mandos de Quest y leyenda en el panel VR.

### Modified Capabilities

- `wheel-ui`: entrada manual del código de sala.

## Impact

- `server/main.py` (servir estáticos, healthcheck), `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `requirements-server.txt`.
- `wheel/index.html`, `src/wheel/main.ts`, `src/wheel/wheel.css`.
- `src/host/input/vrControllers*.ts`, `src/host/vr/panelModel.ts`, `src/host/main.ts`, `src/shared/config.ts`.
- Sin cambios en `src/sim` ni en `protocol.ts`. Sin dependencias npm nuevas.

**Fuera de alcance:** ver el volante del celular dentro de VR, passthrough, seguimiento de manos, configuración de cloudflared (lo hace el usuario), validación en visor real (aplazada, ver memoria `device-validation-deferred`).
