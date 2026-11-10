# Tasks

> Asignación: grupos 1 y 2–4 son independientes y pueden ir en paralelo. Todos `worker-sonnet`. Skill a cargar en 2–4: `track-pipeline`. Leer antes `design.md` de este change.

## 1. Andamiaje del repo (worker-sonnet)

- [x] 1.1 Crear `.gitignore`, `package.json`, `tsconfig.json` y `vitest.config.ts` exactamente como en design D1; instalar `typescript vite vitest three @types/three` como devDependencies/dependencies (`three` en dependencies). Verificación: `npx tsc --noEmit` y `npx vitest run --passWithNoTests` terminan con código 0.
- [x] 1.2 Crear `src/track/types.ts` y `src/track/schema.ts` con las firmas de design D6. `parseTrackJson` lanza `Error` con la ruta del campo (`samples.wl`, `kerbs[3].side`…) ante: campo ausente, tipo incorrecto, columnas de distinta longitud, valores no finitos, `side` inválido, `sectors_s` que no sea de 2 elementos. Archivo de test `tests/track.schema.test.ts` con un objeto mínimo válido construido en el test y al menos 6 casos inválidos. Verificación: `npx vitest run tests/track.schema.test.ts` en verde.

## 2. Pipeline: geometría (worker-sonnet, skill `track-pipeline`)

- [x] 2.1 Crear `requirements.txt` (design D1) y el entorno: `uv venv .venv --python 3.12 && uv pip install --python .venv/bin/python -r requirements.txt`. Crear `tools/track/tracks.py` con `TrackSpec` y `TRACKS` (design D2). Verificación: `.venv/bin/python -c "import fastf1, scipy, matplotlib; from tools.track.tracks import TRACKS; print(sorted(TRACKS))"` imprime `['interlagos', 'monza']` (crear `tools/__init__.py` y `tools/track/__init__.py` vacíos).
- [x] 2.2 En `tools/track/build_track.py`: CLI (`--track`, error con lista de soportados si es desconocido), `load_centerline` (clon `git clone --depth 1` de TUMFTM en `tools/track/.cache/racetrack-database` si no existe; devuelve `None` si falta el CSV) y `resample_closed` (design D3). Verificación: `.venv/bin/python tools/track/build_track.py --track foo` sale ≠ 0; un `--debug-step centerline` imprime N, `step_m` y longitud, con longitud entre 4 266 y 4 352 m para Interlagos.
- [x] 2.3 `load_fastf1` (design D2/D3): caché en `tools/track/.cache/fastf1`, recorrido de `years`, conversión ×0,1 con la comprobación de ±5 % de longitud, 3–5 vueltas más rápidas promediadas, `corners` y `sector_fracs`. Si ninguna temporada carga: mensaje que mencione FastF1 y `sys.exit(2)` sin escribir nada. Verificación: `--debug-step fastf1` imprime año usado, nº de vueltas, longitud de la vuelta (±5 % de 4 309) y rango de Z en metros (entre 25 y 60).
- [x] 2.4 `align_2d` (design D4) y fijado de sentido y de meta (design D3: inversión si procede, rotación del array, origen en la meta, respaldo de ancho 14 m con aviso si `load_centerline` devolvió `None`). Verificación: `--debug-step align` imprime residuo medio < 10 m, `direction = ccw` y área con signo > 0.

## 3. Pipeline: elevación, metadatos y salida (worker-sonnet, skill `track-pipeline`)

- [x] 3.1 `transfer_elevation` y `derive` (design D3). Verificación: `--debug-step elev` imprime `max(y) − min(y)` entre 25 y 60, `|y[N−1] − y[0]|` < 0,5 y `max|pitch|` < 0,15.
- [x] 3.2 `propose_metadata` y `apply_overrides` (design D5; claves de override en la spec, requirement "Ajustes manuales persistentes"; `kerbs_add`/`kerbs_remove` son listas de `{s0, s1, side}`, y `kerbs_remove` elimina los tramos propuestos que se solapen). Verificación: `--debug-step meta` imprime 2 sectores, 2 zonas DRS (una conteniendo `s = 0`), 12–16 curvas con los cuatro nombres exigidos y ≥ 8 pianos.
- [x] 3.3 `write_json` (orden de claves y redondeos de design D3), `plot_plan`, `plot_elev` (backend `Agg`, 1600×1200 px, contenido exigido por el requirement "Imágenes de control") y resumen final por consola. Verificación: `.venv/bin/python tools/track/build_track.py --track interlagos` sale 0 y crea los tres archivos; ejecutarlo dos veces y comparar `sha256sum public/track/interlagos.json` (idéntico).

## 4. Validación (worker-sonnet)

- [x] 4.1 `tools/track/validate_track.py <ruta.json>`: una comprobación por scenario numérico de `specs/track-data/spec.md` (formato, fidelidad, anchos, elevación, metadatos), una línea `OK|FAIL <criterio>: <valor medido>` por comprobación, exit 0 solo si todas pasan. Los umbrales dependientes del circuito (longitud oficial, sentido, nº de zonas DRS, nombres de curvas, ventanas de elevación) se leen de `TRACKS[id]` o se aplican solo si `id == "interlagos"`. Verificación: sale 0 con `public/track/interlagos.json`; con una copia en `/tmp` con `length_m = 5000` sale ≠ 0, y con otra copia con todas las columnas de `samples` invertidas sale ≠ 0.
- [x] 4.2 `tests/track.data.test.ts`: lee `public/track/interlagos.json` con `fs`, lo pasa por `parseTrackJson` y repite en TypeScript los mismos scenarios numéricos (un `it` por scenario). Verificación: `npx vitest run` en verde.
- [x] 4.3 Si algún umbral de la spec falla con datos reales pero el PNG es coherente con Interlagos, NO cambiar el umbral: detenerse y reportar al orquestador el valor medido. Verificación: resumen final con la tabla `OK/FAIL` completa.

## 5. Cierre del bloque (orquestador)

- [x] 5.1 Revisar `out/interlagos_plan.png` y `out/interlagos_elev.png`; si DRS, pianos, sectores o meta no son plausibles, escribir `tools/track/overrides/interlagos.json`, regenerar y revalidar. Verificación: validador y `npx vitest run` en verde tras regenerar.
- [x] 5.2 `npx tsc --noEmit` y `npx vitest run` en verde; construir el grafo y revisar con `code-review-graph` (`detect_changes`); commit `feat(track): pipeline de datos de Interlagos y contrato track.json`.
