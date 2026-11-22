# Tasks

## 1. Relay y protocolo (worker-sonnet)

- [x] 1.1 `server/main.py`: endpoint `/ws/race/{code}` (design D1) con plazas, propietario, `lobby`, `time`, `started`, reenvío envuelto, códigos 4001/4002 y `RACE_TEST_DELAY_MS`; comentario del protocolo actualizado. Script `tools/fake_racer.py --code XXXXXX --name N` que se une y envía `st` sintéticos. Verificar con un script en el scratchpad (`websockets` de `.venv`): escenarios de "Salas de carrera en el relay".
- [x] 1.2 `src/shared/protocol.ts`: tipos y decodificadores de D2 y de los mensajes del relay (`lobby`, `time`, `r`), con tests en `tests/protocol.test.ts` (válidos, campos fuera de rango, basura). Verificar: `npx vitest run tests/protocol.test.ts`.

## 2. Red en el cliente (worker-opus)

- [x] 2.1 `src/host/online/clock.ts` (D3) y `remoteCars.ts` (D4: búfer, interpolación, extrapolación ≤ 250 ms) con tests deterministas (pérdida de paquetes, ángulos que cruzan ±π, salto < 2 m). Verificar: `npx vitest run tests/host.online.test.ts`.
- [x] 2.2 `RaceSession` con entradas `remote` y colisión unilateral (D4); test: contacto local-remoto no modifica el remoto. `src/host/online/client.ts`: conexión, envío `st`/`ai` a 20 Hz, recepción, salida sincronizada (D5), abandonos (D6), `res`. Verificar: `npx vitest run` y `npm run typecheck`.

## 3. Vestíbulo e integración (worker-sonnet)

- [x] 3.1 `src/host/online/lobby.ts` + opción "Online" en `menu.ts` (D7), estilos en `hud.css`; integración en `controller.ts`/`main.ts` y resultados con `res`. Tests de modelo de vestíbulo en `tests/host.lobby.test.ts`. Verificar: `npx vitest run`.
- [x] 3.2 E2E `tests/e2e/b16_online.py` (puertos limpios, relay con `RACE_TEST_DELAY_MS=80`): dos contextos de Chromium crean/unen sala, propietario con 4 rivales, ambos `autopilot=1`, carrera hasta resultados idénticos; tercer contexto que se une y cierra a mitad (abandono); sin errores de consola. Medir salto máximo de coche remoto con la API de depuración.

## 4. Cierre (Fable)

- [x] 4.1 `npx vitest run`, `npm run build`, `docker compose up -d --build` y prueba rápida de dos navegadores contra el contenedor; `code-review-graph build` + `detect_changes`; commits `feat(server): salas de carrera online` y `feat(host): carrera online entre PCs` vía `commit-orchestrator`; `/opsx:archive b16-online-race`.
