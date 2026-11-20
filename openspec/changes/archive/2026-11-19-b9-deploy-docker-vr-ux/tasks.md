# Tasks

## 1. Servidor estático y Docker (worker-sonnet)

- [x] 1.1 En `server/main.py` montar `StaticFiles(directory=os.environ.get("DIST_DIR","dist"), html=True)` en `/` después de las rutas, solo si el directorio existe (design D1). Crear `requirements-server.txt` con `fastapi` y `uvicorn[standard]`. Verificar: `npm run build && .venv/bin/uvicorn server.main:app --port 8112` y `curl -sf localhost:8112/` y `/wheel/` y `/api/info` dan 200 (matar el proceso después).
- [x] 1.2 Crear `Dockerfile` multi-stage, `.dockerignore` y `docker-compose.yml` según design D2/D3 (puerto `${HOST_PORT:-28473}:8000`, `PUBLIC_URL`, restart, healthcheck, comentarios de despliegue y cloudflared; sin `.md`). Verificar: `docker compose build` termina sin error; `docker compose config` válido.
- [x] 1.3 Levantar con `HOST_PORT=28473 docker compose up -d`, comprobar `/`, `/wheel/`, `/api/info`, un par de WebSockets host/wheel por el mismo puerto (script en el scratchpad con `websockets` de `.venv`) y `docker inspect` = healthy. Dejar el contenedor corriendo.

## 2. Código de sala manual en el volante (worker-sonnet)

- [x] 2.1 Añadir `sanitizeRoomInput` en `src/shared/protocol.ts` con test en `tests/protocol.test.ts` (mayúsculas, filtra alfabeto, máx. 4). Verificar: `npx vitest run tests/protocol.test.ts`.
- [x] 2.2 Input y botón en `cover-noroom` (`wheel/index.html`), lógica en `src/wheel/main.ts` y estilo en `src/wheel/wheel.css` (campo grande, objetivo táctil ≥ 56 px, spec wheel-ui). Verificar: `npx vitest run` y `npm run typecheck`; comprobación con `webapp-testing` (puertos limpios): abrir `/wheel/`, escribir `abcd`, Unirse → URL `?room=ABCD`, sin errores de consola; `?room=ZZZ0` muestra el formulario.

## 3. Mandos de Quest (worker-opus)

- [x] 3.1 `src/shared/config.ts` (`vr.gripButton`, `vr.stickClickButton`), `vrControllersMap.ts` (`rightGrip` → `ers`) y `vrControllers.ts` (orden `drs` por flanco del agarre izquierdo; `buttonEdges` con `camera`), según design D5. Tests en `tests/host.vrControllers.test.ts` para los escenarios DRS, ERS y Cámara. Verificar: `npx vitest run tests/host.vrControllers.test.ts`.
- [x] 3.2 `src/host/main.ts` `updateControllers`: A en `pairing` con `inVr` arranca con los mandos; `camera` → `rig.next()`; descartar órdenes según design D6. Verificar: `npm run typecheck` y `npx vitest run`.
- [x] 3.3 `src/host/vr/panelModel.ts`: `legendOps()` y pantallas `pairing`/`paused` según design D7 (código ≥ 150 px, ids de la spec). Tests en `tests/host.vrPanel.test.ts`. Verificar: `npx vitest run tests/host.vrPanel.test.ts`.

## 4. Cierre, GitHub y archivo (Fable)

- [x] 4.1 `npx vitest run` y `npm run build` en verde; E2E rápido del host y del volante con `webapp-testing` en puertos limpios sin errores de consola; revisión `code-review-graph` (`code-review-graph build` por terminal y `detect_changes`).
- [x] 4.2 Commits Conventional Commits por parte vía `commit-orchestrator` (`feat(deploy)`, `feat(wheel)`, `feat(vr)`), `git push origin main` sin force; verificar `git status` limpio y `git log origin/main -1`. Tras el push, `/opsx:archive b9-deploy-docker-vr-ux` y marcar 6.3 de `b7-vr` queda fuera (decisión del usuario).
