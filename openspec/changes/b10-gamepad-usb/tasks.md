# Tasks

> OPCIONAL, después de b8 y b9 (usa `holdDetector` y `restartRace` de b9). En serie. Cada worker lee `design.md` y `specs/gamepad-input/spec.md`. Sin dependencias nuevas.

## 1. Mapeo puro (worker-sonnet)

- [ ] 1.1 `config.gamepad` (D3) y `src/host/input/gamepadMap.ts` (D1) con `tests/host.gamepadMap.test.ts`: escenarios de dirección, zona muerta, gatillos, flanco de R1/L1/Cuadrado. Verificación: `npx vitest run tests/host.gamepadMap.test.ts`.

## 2. Fuente y selección (worker-opus)

- [ ] 2.1 `src/host/input/gamepad.ts` (D2) y `nextGamepadSource` (D4) con tests con `GamepadProvider` simulado: conexión, prioridad, desconexión vuelve al teclado. Verificación: `npx vitest run`.
- [ ] 2.2 Integrar en `src/host/main.ts`: eventos `gamepadconnected`/`gamepaddisconnected`, aviso, `pollUi` (pausa, cámara, recolocar, reiniciar), `takeCommands` en el bucle. Verificación: `npx tsc --noEmit`, `npx vitest run`.

## 3. Vibración (worker-sonnet)

- [ ] 3.1 `rumble` (D5) conectado a los `fx`; test con actuador simulado y sin actuador (no lanza). Verificación: `npx vitest run`.

## 4. Verificación y cierre

- [ ] 4.1 E2E Playwright con `navigator.getGamepads` simulado por `add_init_script` (sin errores de consola, conducción y reinicio). La prueba con el mando físico queda aplazada (ver validación con dispositivo).
- [ ] 4.2 `npx vitest run` en verde, `code-review-graph` y commit Conventional Commits vía commit-orchestrator.
