# Tasks

## 1. Datos y assets (worker-sonnet)

- [x] 1.1 `tracks.py` (D1, bbox comprobado contra OSM, trazado GP), `overrides/bahrain.json` inicial vacío; `fetch_assets.py` con HDRI nocturno y arena (D3, ids verificados en la API). Verificar: `build_track.py --track bahrain`, `build_world.py --track bahrain` y `validate_track.py --track bahrain --world` con código 0; `bahrain.world.json` < 3 MB; PNG de control; `fetch_assets.py` con código 0 y manifiesto actualizado; `interlagos.json`/`spa.json` sin cambios en `samples`. Fable revisa los PNG y completa `overrides/bahrain.json`; regenerar.

## 2. Runtime (worker-opus)

- [x] 2.1 `TrackInfo` (D2) y Bahréin en el catálogo; `src/render/night.ts` (D4) con `config.night`, charcos de luz en `mesh.ts`, ventanas emisivas, bloom nocturno; suelo de arena (D5) en `world.ts`/materiales. Tests: `tests/render.night.test.ts` (≤ 6 mallas añadidas, nada aplicado con `day`), desierto sin árboles, piloto de referencia en Bahréin (75–125 s, DRS ≥ 1) y 10 rivales `medium` a 5 vueltas. Verificar: `npx vitest run --maxWorkers=2` y `npm run typecheck`.

## 3. Verificación (worker-sonnet)

- [x] 3.1 E2E `tests/e2e/b18_bahrain.py` (puertos limpios): `/?track=bahrain&debug=1&autopilot=1&timescale=8` completa vuelta; luminancia de asfalto ≥ 0,25 y cielo ≤ 0,15 en una recta; capturas en recta de meta, curva 1, curva 4 y curva 10; selector ofrece los 3 circuitos; Interlagos y Spa siguen de día; draw calls ≤ 200; sin errores de consola.

## 4. Cierre (Fable)

- [ ] 4.1 Revisión visual, `npx vitest run`, `npm run build`, `code-review-graph build` + `detect_changes`; commits `feat(track): circuito de Bahréin` y `feat(render): iluminación nocturna y suelo de desierto` vía `commit-orchestrator`; `/opsx:archive b18-bahrain`; redespliegue del contenedor.
