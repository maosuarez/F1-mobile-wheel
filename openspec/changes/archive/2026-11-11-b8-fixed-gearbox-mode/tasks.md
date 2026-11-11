# Tasks

> Todo en serie, un solo worker-sonnet. Leer antes `design.md` y `specs/gearbox/spec.md`.

## 1. Quitar la alternancia (worker-sonnet)

- [x] 1.1 `src/host/input/keyboard.ts` y `src/host/main.ts`: eliminar `onToggleAuto` (tipo, rama `KeyM`, callback) según design D1. Criterio: `grep -rn "onToggleAuto\|KeyM" src` sin resultados. Verificación: `npx tsc --noEmit` y `npx vitest run`.
- [x] 1.2 Test unitario en `tests/` (nuevo `tests/host.keyboardNoToggle.test.ts` o extender el del adaptador si existe): pulsar `KeyM` no invoca ningún callback y no lanza. Verificación: `npx vitest run`.
- [x] 1.3 Adaptar `tests/e2e/b4_mechanics.py` caso (a) según design D4 (sin dependencias nuevas). Verificación: ejecutar el E2E en puertos limpios (ver memoria del proyecto) sin errores de consola.

- [x] 1.4 Config `config.vr.stickShiftOn = 0.7` y `stickShiftOff = 0.3` en `src/shared/config.ts`; `stickShiftEdges` en `src/host/input/vrControllersMap.ts` (design D6) con tests en el archivo de tests de mapeo VR existente (`tests/` con `vrControllersMap`): empuje adelante → `shiftUp` una vez, atrás → `shiftDown`, mantener no repite, rearme por debajo de 0.3. Verificación: `npx vitest run`.
- [x] 1.5 `src/host/input/vrControllers.ts`: leer `axes[3]` de ambos mandos en `read()`, acumular órdenes y devolverlas en `takeCommands()` (vaciando la cola); mantener `reset()` limpiando el estado de la palanca. Test con `XrFrameProvider` simulado: dos empujes atrás desde 1.ª producen `shiftDown` ×2 (integración con `Simulation` en test: gear 1 → 0 → −1 parado, con el corte de cambio entre órdenes). Verificación: `npx tsc --noEmit`, `npx vitest run`.

## 2. Cierre

- [x] 2.1 `npx vitest run` en verde, revisión `code-review-graph` (`detect_changes`) y commit Conventional Commits vía commit-orchestrator.
