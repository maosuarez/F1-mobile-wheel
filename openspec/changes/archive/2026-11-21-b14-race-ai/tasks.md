# Tasks

## 1. Sesión de carrera en la simulación (worker-opus)

- [x] 1.1 `Simulation.placeOnGrid(slot)` y `stepDrs(..., enabled)` (design D1, D4; comprobar el lado de los cajones en `mesh.ts`). Constantes `config.race`/`config.ai` (D8). Tests: parrilla de 10 en `tests/sim.race.test.ts`, escenarios DRS nuevos en `tests/sim.drs.test.ts`. Verificar: `npx vitest run`.
- [x] 1.2 `src/sim/collision.ts` (D2) con tests de alcance por detrás y determinismo en `tests/sim.collision.test.ts`. Verificar: `npx vitest run tests/sim.collision.test.ts`.
- [x] 1.3 `src/sim/race.ts` `RaceSession` (D1): semáforo, orden de paso, progreso, checkpoints de diferencias, fin de carrera, eventos. Tests de la spec `race-session` (semáforo, clasificación coherente, final, coste < 1 ms). Verificar: `npx vitest run tests/sim.race.test.ts`.

## 2. IA de rivales (worker-opus)

- [x] 2.1 `src/shared/teams.ts` (D5) con test de nombres prohibidos. `src/sim/rival.ts` `RivalDriver` (D3): perfil sobre la trazada, persecución, salida, DRS/ERS, inconsistencia sembrada. Test de ritmo por nivel en `tests/sim.rival.test.ts`. Verificar: `npx vitest run tests/sim.rival.test.ts`.
- [x] 2.2 Tráfico: seguimiento, adelantamiento, evitar alcances (D3). Tests de la spec `rival-ai` (carrera limpia de 10, adelantamiento, determinismo). Ajustar solo constantes de `config.ai` si fallan; si no basta, parar y reportar. Verificar: `npx vitest run`.

- [x] 2.3 Tráfico mixto (D3 "Evitar alcances"): escenario "Tráfico mixto" de `rival-ai` con 5 semillas. Ajustar `config.ai` y la lógica de seguimiento/adelantamiento; los escenarios anteriores siguen en verde. Verificar: `npx vitest run --maxWorkers=2`.

## 3. Host: menú, controlador y render (worker-opus)

- [x] 3.1 Corregir los cajones de parrilla en `src/track/mesh.ts` (D1) con test en `tests/track.mesh.test.ts`. `src/host/race/controller.ts` (D7) e integración en `main.ts` (estados `menu` y `results`, semáforo en lugar de cuenta atrás en carrera, práctica idéntica). Debug API `race`. Verificar: `npm run typecheck`, `npx vitest run` (los tests de host existentes siguen en verde).
- [x] 3.2 `src/render/rivals.ts` (D6) con test `tests/render.rivals.test.ts` (≤ 4 mallas instanciadas, matrices finitas, colores por escudería). Integrar en la escena. Verificar: `npx vitest run`.
- [x] 3.3 Audio de los 2 rivales más cercanos con `PannerNode` (D7) en `src/audio/`; test de selección de los 2 más cercanos a < 80 m. Verificar: `npx vitest run`.

## 4. Presentación (worker-sonnet)

- [x] 4.1 `src/host/race/menu.ts` (opciones, teclado/ratón/mando/volante, `storage.ts`, parámetros URL) con tests en `tests/host.menu.test.ts`; estilos en `hud.css`. Verificar: `npx vitest run tests/host.menu.test.ts`.
- [x] 4.2 `tower.ts` y `results.ts` (D7), puntos de rivales en `src/host/minimap.ts`, posición/vuelta en `src/host/vr/panelModel.ts`, `pos`/`laps` opcionales en `protocol.ts` (con test de compatibilidad) y su visualización en `src/wheel/`. Verificar: `npx vitest run` y `npm run typecheck`.
- [x] 4.3 E2E con `webapp-testing` (puertos limpios): `/?debug=1&mode=race&rivals=9&autopilot=1&timescale=8` hasta resultados (esperar por `race.phase`), capturas de parrilla con luces, torre y resultados; `/?debug=1&mode=practice&autopilot=1&timescale=8` completa una vuelta como antes; sin errores de consola. Guardar script en `tests/e2e/b14_race.py`.

## 5. Cierre (Fable)

- [x] 5.1 Actualizar `context.md` (rivales y modos); `npx vitest run`, `npm run build`, draw calls ≤ 200 con 9 rivales; `code-review-graph build` + `detect_changes`; commits `feat(sim): sesión de carrera e IA de rivales` y `feat(host): modo carrera a 5 vueltas` vía `commit-orchestrator`; `/opsx:archive b14-race-ai`.
