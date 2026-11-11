# Tasks

> Orden 1 → 4, en serie (comparten `main.ts`). Cada worker lee antes `design.md` y `specs/game-restart/spec.md`. Sin dependencias nuevas.

## 1. Utilidad y configuración (worker-sonnet)

- [x] 1.1 Añadir `config.race.restartHoldMs = 1000` y crear `src/shared/hold.ts` (design D1, D2) con `tests/hold.test.ts`: dispara una vez al cruzar el umbral, no dispara en toque corto, se rearma al soltar. Verificación: `npx vitest run tests/hold.test.ts`.

## 2. Reinicio en el host y protocolo (worker-sonnet)

- [x] 2.1 `src/shared/protocol.ts`: añadir `restart` a `EvKey`/`EV_KEYS` y actualizar comentario y test de protocolo; revisar `server/main.py` (D5). Verificación: `npx vitest run`.
- [x] 2.2 `src/host/main.ts`: `restartRace()` (D3) y rama `restart` en `updateWheel` (D7). Verificación: `npx tsc --noEmit`, `npx vitest run`.

## 3. Entradas (worker-sonnet)

- [x] 3.1 `src/host/input/vrControllers.ts` + `main.ts`: pulsación sostenida de B/Y (D4); test unitario del evento `restart` con `holdDetector`. Verificación: `npx vitest run`.
- [x] 3.2 `wheel/index.html` y `src/wheel/controls.ts`: botón REINICIAR sostenido (D6). Verificación: `npx tsc --noEmit`.

## 4. Verificación y cierre

- [x] 4.1 E2E Playwright (`tests/e2e/b9_restart.py`, puertos limpios, volante simulado `fake_wheel.py` o cliente WS): evento `restart` en `racing` → `countdown`, `simTimeS` 0; toque corto sin efecto; sin errores de consola. Verificación: ejecutar el script.
- [x] 4.2 `npx vitest run` en verde, `code-review-graph` y commit Conventional Commits vía commit-orchestrator.
