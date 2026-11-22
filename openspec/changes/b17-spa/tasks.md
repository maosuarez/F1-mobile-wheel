# Tasks

## 1. Datos de Spa (worker-sonnet)

- [x] 1.1 `tracks.py` (design D1, comprobando el bbox contra OSM), validación de relieve (D2) en `validate_track.py`, `overrides/spa.json` inicial vacío. Verificar: `build_track.py --track spa`, `build_world.py --track spa` y `validate_track.py --track spa --world` con código 0; `spa.world.json` < 3 MB; PNG de control; `build_track.py --track interlagos` deja `interlagos.json` igual (diff de `samples` = 0). Fable revisa los PNG, completa `overrides/spa.json` (D3) y nombres de curvas; regenerar.

## 2. Runtime y catálogo (worker-opus)

- [x] 2.1 `src/shared/tracks.ts` (D4), selector en `menu.ts`, `?track=`, recarga al cambiar, error de circuito desconocido, `cfg.track` en online (recarga del cliente si no coincide). Tests: catálogo y resolución del id (`?track` > recordado > interlagos), piloto de referencia en Spa (95–150 s, DRS ≥ 1) en `tests/sim.lap.test.ts` y 10 rivales `medium` a 5 vueltas. Verificar: `npx vitest run --maxWorkers=2` y `npm run typecheck`.

## 3. Verificación (worker-sonnet)

- [x] 3.1 E2E `tests/e2e/b17_spa.py` (puertos limpios): `/?track=spa&debug=1&autopilot=1&timescale=8` completa vuelta; capturas en La Source, Eau Rouge/Raidillon, Pouhon y la chicane; selector del menú recarga con `?track=spa`; `?track=xyz` muestra error; Interlagos sigue igual; draw calls ≤ 200; sin errores de consola.

## 4. Cierre (Fable)

- [ ] 4.1 Revisión visual, `npx vitest run`, `npm run build`, `code-review-graph build` + `detect_changes`; commits `feat(track): circuito de Spa-Francorchamps` y `feat(host): selector de circuito` vía `commit-orchestrator`; `/opsx:archive b17-spa`.
