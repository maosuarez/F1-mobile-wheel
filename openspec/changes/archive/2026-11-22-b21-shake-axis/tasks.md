# Tasks

## 1. Detector solo en Z (worker-opus)

- [x] 1.1 `src/wheel/shake.ts` con la firma de D1 y sin `active`; quitar `freezeMs` de `config.wheel.shake` (`src/shared/config.ts`); `src/wheel/main.ts` sin congelado (D2) y con la nueva llamada, manteniendo la firma de `injectMotion` (D3). Reescribir `tests/wheel.shake.test.ts`: picos en Z disparan; picos alternos de 25 m/s² en X/Y no; giro de 60° en 200 ms solo con gravedad (gz casi constante, gx/gy rotando) no; pico único no; enfriamiento; `shakeAction` igual. Verificar: `npx vitest run tests/wheel.shake.test.ts --maxWorkers=2`, `npx tsc --noEmit` y `npx vitest run --maxWorkers=2`.

## 2. E2E y cierre

- [x] 2.1 (worker-opus) Ajustar `tests/e2e/b20_vr_wheel.py` y `tests/e2e/b11_wheel_ui.py` para inyectar los picos en Z; añadir en b20 un check: picos alternos en X sin efecto y `steer` sigue a la gravedad inyectada. Verificar: ambos scripts salen con 0 (puertos limpios, servidores matados por PID).
- [x] 2.2 (Fable) `npx vitest run` en verde, `code-review-graph` `detect_changes`, commit `fix(wheel): sacudida solo en el eje perpendicular a la pantalla y sin congelar la dirección` vía `commit-orchestrator`, archivo y redespliegue.
