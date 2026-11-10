# Tasks

> Requisito previo: bloques 1–5 cerrados. Orden y paralelismo: 1 → (2, 3, 4, 5 y 6 en paralelo: archivos distintos) → 7 → 8 → 9. Tras cada grupo, `npx vitest run` debe seguir en verde. Cada worker lee antes `design.md` y carga la skill `threejs-aaa-graphics-builder` además de las indicadas.

## 1. Calidad y medición (worker-opus, skill `threejs-performance`)

- [ ] 1.1 `src/render/quality.ts` (design D1) y `config.quality`. Test `tests/render.quality.test.ts`: scenarios "Bajada automática", "Sin oscilación", "Pausa o pestaña oculta" y `FpsMeter` (media y percentil 5 sobre una serie conocida). Verificación: `npx vitest run tests/render.quality.test.ts`.
- [ ] 1.2 Integrar en `src/host/main.ts` y `src/render/scene.ts`: `?quality=`, `?post=0`, aplicación en caliente de `QualitySettings` (por ahora solo DPR), aviso discreto al bajar de nivel, y campos nuevos de `DebugSnapshot` (design D8) con los valores disponibles. Verificación: `npx tsc --noEmit`, `npm run build`.

## 2. Luz, sombras y cielo (worker-opus, skills `threejs-lighting`, `threejs-shaders`)

- [ ] 2.1 `src/render/sky.ts` y cambios en `src/render/scene.ts` (design D2): ACES, sRGB, cúpula con degradado, niebla, sol con sombra que sigue al coche ajustada a téxel, relleno hemisférico, `scene.environment` por PMREM, respeto de `QualitySettings.shadows/shadowMapSize/envMapSize`. Verificación: `npm run build` y captura `out/b6_light.png` con un script Playwright temporal en la que se vea la sombra del coche; `snapshot().shadowLights === 1`.

## 3. Monoplaza (worker-sonnet, skills `threejs-geometry`, `threejs-materials`)

- [ ] 3.1 Reescribir `src/render/car.ts` y crear `src/render/carMaterials.ts` (design D3) con `CarVisual` y `update`. Test `tests/render.car.test.ts` (Node): scenarios "Partes presentes", "Proporciones", "Ruedas delanteras", "Giro de las ruedas", "DRS visible" y "Coste del coche" (contar mallas y triángulos del grupo). Adaptar `main.ts` a `CarVisual.update`. Sin logos, nombres ni decoraciones reales. Verificación: `npx vitest run tests/render.car.test.ts` y `npm run build`.

## 4. Superficies (worker-sonnet, skills `threejs-textures`, `threejs-materials`)

- [ ] 4.1 `src/render/trackMaterials.ts` y cambios en `src/track/mesh.ts` (design D4): texturas procedurales sembradas, UV, banda de goma, franjas de hierba, cajones de parrilla, materiales como parámetro. `tests/track.mesh.test.ts` sigue en verde sin relajar umbrales y añade: UV finitas y texturas ≤ 1024 px. Verificación: `npx vitest run tests/track.mesh.test.ts` y `npm run build`.

## 5. Entorno (worker-sonnet, skills `threejs-geometry`, `threejs-performance`)

- [ ] 5.1 `src/render/environment.ts` (design D5) e integración en la escena, con `QualitySettings.trees`. Test `tests/render.environment.test.ts` (Node, con Interlagos): scenario "Elementos fuera de la pista" (usando `locateGlobal` sobre cada instancia) y "Coste del entorno" (≤ 8 mallas). Verificación: `npx vitest run tests/render.environment.test.ts`.

## 6. Partículas y posproceso (worker-opus, skills `threejs-shaders`, `threejs-postprocessing`)

- [ ] 6.1 `src/render/particles.ts` (design D6) con un emisor lógico puro `shouldEmit(car): { dirt: boolean; smoke: boolean }`. Test `tests/render.particles.test.ts`: los tres scenarios de "Efectos de pista" a nivel de `shouldEmit` y de recuento de partículas activas con tiempo inyectado. Verificación: `npx vitest run tests/render.particles.test.ts`.
- [ ] 6.2 `src/render/post.ts` (design D7) e integración con `QualitySettings.post/msaaSamples` y `?post=0`; redimensionado correcto del compositor. Verificación: `npm run build` y dos capturas `out/b6_post_on.png` / `out/b6_post_off.png` del mismo instante (juego en pausa) que difieran.

## 7. Integración de niveles (worker-sonnet)

- [ ] 7.1 Conectar todos los sistemas a `QualitySettings` en caliente (sombras, posproceso, árboles, partículas, DPR) y completar `DebugSnapshot` (`carDrawCalls`, `envDrawCalls`, `particlesActive`, `rendererName`, `fpsAvg`, `fpsP5`) y `window.__f1.pixels(region)` (design D8). Verificación: `npx tsc --noEmit`, `npx vitest run`, `npm run build`; abrir con `?quality=low` y `?quality=high` y comprobar con un script temporal que `low` tiene `shadowLights = 0`, `post = false`, `dpr = 1` y menos draw calls.

## 8. Verificación automática (worker-sonnet, skills `webapp-testing`, `threejs-qa-release`)

- [ ] 8.1 `tests/e2e/b6_visual.py` (design D8), fallando ante errores o avisos de WebGL en consola: (a) 8 capturas de referencia `out/b6_grid.png`, `b6_senna.png`, `b6_sol.png`, `b6_bico.png`, `b6_juncao.png`, `b6_straight.png`, `b6_helmet.png`, `b6_tv.png` (los `s` se leen de `corners` del JSON); (b) scenarios "Sombra del coche" y "Exposición correcta" con `__f1.pixels`; (c) "Posproceso activo" (esquinas 5–30 % más oscuras); (d) vuelta completa con `autopilot=1&timescale=8` en `chase`, `helmet` y `tv`: `maxDrawCalls < 200`, `maxTriangles < 600000`, `shadowLights = 1`, `shadowMapSize ≤ 2048`, `dpr ≤ 1.5`; (e) "Selección manual" y "Diferencias medibles" de niveles; (f) "Carga": parrilla visible en < 5 s. Verificación: el script sale con código 0.
- [ ] 8.2 `tests/e2e/b6_perf.py` (design D8). Verificación: sale 0 con media ≥ 55 y p5 ≥ 45 imprimiendo `rendererName` y el nivel final, o sale 2 imprimiendo `SIN GPU` (entonces queda pendiente 9.1).

## 9. Cierre

- [ ] 9.1 (usuario, solo si 8.2 salió con código 2) Abrir el juego a 1920×1080 en el navegador normal, dar una vuelta con F3 abierto y confirmar ≥ 55 fps de media. Verificación: el usuario informa de los fps y del nivel de calidad mostrado.
- [ ] 9.2 (orquestador) Puntuar las 8 capturas con la rúbrica de `threejs-aaa-graphics-builder` (media ≥ 7, ninguna categoría < 5); si no llega, reasignar al worker correspondiente indicando la categoría. `npx tsc --noEmit`, `npx vitest run` y los E2E de los bloques 2–6 en verde sin modificar umbrales; revisión con `code-review-graph`; commit `feat(render): pulido visual con iluminación, coche detallado, entorno y posproceso`.
