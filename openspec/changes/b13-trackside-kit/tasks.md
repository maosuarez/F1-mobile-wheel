# Tasks

## 1. Datos de borde de pista (worker-sonnet)

- [ ] 1.1 `tools/track/racing_line.py` con `racing_line(...)` (design D2) y autotest `--selftest` sobre un óvalo sintético (rl hacia el interior en las curvas, dentro de cotas). Verificar: `.venv/bin/python -m tools.track.racing_line --selftest`.
- [ ] 1.2 `build_track.py`: escribir `samples.rl`, heurísticas de `runoffs`, `barriers`, `kerbs[].type` y `boards` (D3); extender `apply_overrides` con esas claves (prevalencia por solape). Añadir campos a `plot_plan` (colores por tipo de escapatoria y barrera). Verificar: `.venv/bin/python tools/track/build_track.py --track interlagos` y `validate_track.py --track interlagos` con los escenarios nuevos de `track-data` y `trackside` (curvatura −20 %, cobertura de tipos, override). Fable revisa el PNG y completa `overrides/interlagos.json` antes de la tarea 2.1.
- [ ] 1.3 `tools/assets/fetch_assets.py` (D7): descarga a `public/assets/<id>/` y escribe `manifest.json`; idempotente. Verificar: ejecutarlo dos veces; segunda vez sin descargas; tamaño total < 20 MB.

## 2. Runtime de pista y simulación (worker-opus)

- [ ] 2.1 `src/track/types.ts`, `schema.ts`, `track.ts`: campos opcionales y tablas por muestra (D1). `query.ts` `classify` con `gravel`/`runoff` (D4). `config.surface.gravel/runoff`. Tests: `tests/track.schema.test.ts` (compatibilidad y tramos), `tests/track.query.test.ts` (escenarios Grava y Escapatoria de asfalto), `tests/sim.surfaces.test.ts` (Grava frena más, La grava no atrapa). Verificar: `npx vitest run`.
- [ ] 2.2 Adaptar consumidores de `Surface`: `src/host/net/fx.ts` (gravel → grass), `src/render/cameras/math.ts`, `src/render/particles.ts` (polvo de grava) y cualquier `switch` exhaustivo que `npm run typecheck` señale. Verificar: `npm run typecheck` y `npx vitest run`.

## 3. Render de borde y materiales (worker-opus)

- [ ] 3.1 `src/render/trackMaterials.ts`: carga de texturas CC0 con respaldo procedural (D7), material de grava y hormigón; `scene.ts`: HDRI con `RGBELoader` → PMREM y fondo, sol alineado, niebla. Test `tests/render.materials.test.ts` (respaldo cuando el loader falla, sin lanzar). Verificar: `npx vitest run`.
- [ ] 3.2 `src/track/mesh.ts`: goma centrada en `rl` (D6) y escapatoria por material (D5); `src/render/trackside.ts` `buildTrackside` (pianos con perfil, barreras, valla, carteles, comisarios, líneas de boxes, marcas de frenada) sustituyendo al muro. Tests `tests/render.trackside.test.ts`: barrera a `wl/wr + runoff_m` ± 0,1 m, ≤ 15 mallas. Verificar: `npx vitest run` y `npm run typecheck`.
- [ ] 3.3 Comprobación con `webapp-testing` (puertos limpios): capturas en recta principal (casco y persecución), S do Senna, Descida do Lago y Junção; panel F3 ≤ 200 draw calls; sin errores de consola; prueba de respaldo bloqueando `/assets/asphalt_track/*`. Guardar capturas en el scratchpad para Fable.

## 4. Cierre (Fable)

- [ ] 4.1 Revisión visual de capturas, `npx vitest run`, `npm run build`, `code-review-graph build` + `detect_changes`; commits `feat(track): datos de borde de pista y trazada ideal` y `feat(render): kit de borde de pista y materiales CC0` vía `commit-orchestrator`; `/opsx:archive b13-trackside-kit`.
