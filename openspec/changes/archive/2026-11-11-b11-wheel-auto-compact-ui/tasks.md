# Tasks

> En serie, un solo worker-sonnet (comparten `src/wheel/*` y `main.ts`). Leer antes `design.md`, `specs/gearbox/spec.md` y `specs/wheel-ui/spec.md`. Sin dependencias npm nuevas.

## 1. Cambio automático con el volante

- [x] 1.1 `src/host/main.ts` `setSource` (D1); adaptar el E2E `tests/e2e/b4_mechanics.py` caso (d) (D6) y añadir test unitario/sim del escenario "Volante llega a neutro y marcha atrás" y "Automático con volante" si aplica. Verificación: `npx tsc --noEmit`, `npx vitest run`.

## 2. Interfaz compacta

- [x] 2.1 `wheel/index.html`, `src/wheel/wheel.css`, `src/wheel/controls.ts`: layout D2 y menú D3. Criterio: en 360×800 y 800×360 (landscape) `btn-drs`/`btn-ers` ≥56×56 px, nada se solapa con pedales y el menú abre y cierra. Verificación: `npx tsc --noEmit`, `npx vitest run`.
- [x] 2.2 Vibración (D4): `haptics.ts`, `main.ts`, `controls.ts` con tests unitarios (soporte, preferencia recordada, no dispara sin soporte). Verificación: `npx vitest run`.

## 3. Verificación y cierre

- [x] 3.1 Actualizar E2E existentes (b3, b5, b9, b10 si aplica) según D6 y ejecutar b3, b4, b9 y un nuevo `tests/e2e/b11_wheel_ui.py` (vista principal sin botones secundarios, abrir menú → CÁMARA envía un `ev`, tamaño de DRS/ERS, pedal no se interrumpe al tocar DRS, captura de pantalla en el scratchpad). Puertos limpios; sin errores de consola.
- [x] 3.2 `npx vitest run` en verde, `code-review-graph` y commit Conventional Commits vía commit-orchestrator.
