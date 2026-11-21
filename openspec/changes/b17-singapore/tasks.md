# Tasks

## 1. Datos de Singapur (worker-sonnet)

- [ ] 1.1 `tracks.py` (design D1, `lighting`, `default_width_m`, `marginM`); `build_track.py`: línea central promediada (D2), anchos OSM/overrides (D3), `walls` con overrides, validación de longitud y sentido. Verificar: `.venv/bin/python tools/track/build_track.py --track singapore` código 0; `validate_track.py --track singapore` con los escenarios nuevos de `track-data`; `build_track.py --track interlagos` sigue dando el mismo `interlagos.json` salvo campos nuevos (diff de `samples` = 0).
- [ ] 1.2 `build_world.py` (D6: margen, límite, simplificación, `landmarks`) y `fetch_assets.py` con `qwantani_night_puresky` 1k. Verificar: `build_world.py --track singapore` código 0, archivo < 3 MB, PNG de control. Fable revisa los PNG y completa `overrides/singapore.json` (anchos, muros, escapatorias, barreras) con referencias públicas antes de la tarea 2.1.

## 2. Runtime y catálogo (worker-opus)

- [ ] 2.1 `walls` en `types/schema/track/query.ts`, uso en `car.ts` (colisión), `mesh.ts` y `trackside.ts` (D3). Tests de la spec `track-runtime` en `tests/track.query.test.ts` y `tests/render.trackside.test.ts`; test de piloto de referencia en Singapur (`tests/sim.lap.test.ts`, 85–130 s, sin muro) y de 10 rivales. Verificar: `npx vitest run`.
- [ ] 2.2 `src/shared/tracks.ts` (D4), selector en `menu.ts`, `?track=`, recarga al cambiar, error de circuito desconocido, `cfg.track` en online. Verificar: `npx vitest run` y `npm run typecheck`.
- [ ] 2.3 `src/render/night.ts` (D5): HDRI nocturno, luz cenital, postes emisivos, charcos de luz en `mesh.ts`, ventanas, noria en `world.ts`, bloom nocturno. Test `tests/render.night.test.ts` (≤ 6 mallas añadidas, preset aplicado solo con `lighting: 'night'`). Verificar: `npx vitest run`.

## 3. Verificación (worker-sonnet)

- [ ] 3.1 E2E `tests/e2e/b17_singapore.py` (puertos limpios): `/?track=singapore&debug=1&autopilot=1&timescale=8` completa vuelta; lectura de luminancia de asfalto y cielo; capturas en 4 puntos (recta de meta, curva 1, puente, zona de la noria); `?track=xyz` muestra error; Interlagos sigue igual; draw calls ≤ 200; sin errores de consola.

## 4. Cierre (Fable)

- [ ] 4.1 Revisión visual, `npx vitest run`, `npm run build`, `code-review-graph build` + `detect_changes`; commits `feat(track): circuito de Singapur con muros por tramo` y `feat(render): iluminación nocturna y selector de circuito` vía `commit-orchestrator`; `/opsx:archive b17-singapore`.
