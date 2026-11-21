# Tasks

## 1. Datos de Monza (worker-sonnet)

- [ ] 1.1 `tracks.py` (design D1) y `build_world.py` (`disused_track`, D3). Verificar: `build_track.py --track monza`, `build_world.py --track monza` y `validate_track.py --track monza --world` con código 0; PNG de control. Fable revisa los PNG y completa `overrides/monza.json` con referencias públicas; regenerar.

## 2. Runtime (worker-opus)

- [ ] 2.1 `TrackInfo.aero` y `scaledConfig` (D2) aplicado en controlador de carrera, piloto de referencia y rivales; Monza en `src/shared/tracks.ts`. Tests: velocidad punta +8 km/h, vuelta de referencia 75–110 s, 10 rivales completan 5 vueltas. Verificar: `npx vitest run`.
- [ ] 2.2 `disused_track` en `src/track/world.ts` y `src/render/world.ts` (D3) y priorización de árboles (D4), con tests en `tests/render.world.test.ts`. Verificar: `npx vitest run`.

## 3. Verificación (worker-sonnet)

- [ ] 3.1 E2E `tests/e2e/b18_monza.py` (puertos limpios): carrera automática completa en Monza; capturas en Rettifilo, Lesmo, Ascari, Curva Alboreto y recta con el anillo al fondo; Interlagos y Singapur siguen cargando; draw calls ≤ 200; sin errores de consola.

## 4. Cierre (Fable)

- [ ] 4.1 Revisión visual, `npx vitest run`, `npm run build`, `code-review-graph build` + `detect_changes`; commit `feat(track): circuito de Monza con baja carga aerodinámica` vía `commit-orchestrator`; `/opsx:archive b18-monza`.
