# Tasks

> Orden y paralelismo: 1 → 2 → (3 → 4 → 5) en paralelo con 6 → 7 → 8. Antes de empezar, cada worker lee `design.md` de este change y la spec de la capacidad que implementa.

## 1. Configuración y tipos base (worker-sonnet)

- [x] 1.1 Crear `src/shared/config.ts` copiando el objeto de design D2 y exportando `GameConfig`. Añadir a `src/track/types.ts` `Surface`, las constantes de geometría, `Track` y `TrackLocation` (design D3). Crear `src/sim/types.ts` con todos los tipos de design D5 y `NEUTRAL_INPUT`. Verificación: `npx tsc --noEmit` en verde.

## 2. Pista en memoria y consultas (worker-opus, skill `track-pipeline` §5)

- [x] 2.1 `src/track/track.ts` (`buildTrack`: arrays `Float64Array`, `tx/tz`, `kerbL/kerbR` por muestra con envoltura, `closed: true`) y `src/track/load.ts`. Test `tests/track.build.test.ts`: carga `public/track/interlagos.json` con `fs`, comprueba N, tangentes unitarias, y que un JSON sin `samples.wl` lanza un error que contiene `samples.wl`. Verificación: `npx vitest run tests/track.build.test.ts`.
- [x] 2.2 `src/track/synthetic.ts` (`makeStraightTrack`, `makeOvalTrack`, design D3). Test `tests/track.synthetic.test.ts` con los dos scenarios de "Pistas sintéticas". Verificación: `npx vitest run tests/track.synthetic.test.ts`.
- [x] 2.3 `src/track/query.ts` completo (design D3). Test `tests/track.query.test.ts`: un `it` por cada scenario de los requirements "Localización en coordenadas de pista", "Clasificación de superficie" y "Consultas de zonas y de meta" de `specs/track-runtime/spec.md`. Verificación: `npx vitest run tests/track.query.test.ts` y `grep -rE "from 'three'|window\.|document\." src/track/query.ts src/track/track.ts src/track/synthetic.ts` sin resultados.

## 3. Dinámica del vehículo (worker-opus, skill `f1-car-feel` §1–§3, §7)

- [x] 3.1 `src/sim/car.ts` (`gripAccel`, `maxSteerRad`, `stepCar` longitudinal: filtros de pedal, tracción, potencia, freno, arrastre, rodadura, pendiente, parada) y `src/sim/simulation.ts` (`Simulation` con `step`, `reset`, `recenter`; cronómetro aún sin conectar). Crear `tests/helpers/drive.ts` con utilidades (`runFor(sim, seconds, input)`, `runUntil(sim, pred, input, maxS)`, `kmh()`). Test `tests/sim.longitudinal.test.ts`: scenarios de "Velocidad punta", "Aceleración", "Frenada dependiente de la carga" y "Pendientes" (frenada cuesta abajo, rodar cuesta arriba). Ajustar solo valores de `config` para entrar en banda. Verificación: `npx vitest run tests/sim.longitudinal.test.ts`.
- [x] 3.2 Completar `stepCar` lateral: suavizado de dirección, ángulo máximo por velocidad, giro deseado, subviraje, círculo de fricción, sobreviraje, relajación del vector velocidad, `aLong/aLat/slip`. Test `tests/sim.lateral.test.ts`: scenarios de "Agarre lateral dependiente de la velocidad", "Círculo de fricción", "Dirección sensible a la velocidad", "Subviraje al exceder el agarre" y "Estado observable" (fuerzas g). Verificación: `npx vitest run tests/sim.lateral.test.ts`.
- [x] 3.3 Superficies y muros en `stepCar` (μ y rodadura por superficie, ruido de piano con LCG sembrado, muro, eventos `surface` y `wallHit`, altura/pitch/roll de pista). Test `tests/sim.surfaces.test.ts`: scenarios de "Superficies", "Muros", altura sobre la pista y evento de superficie. Verificación: `npx vitest run tests/sim.surfaces.test.ts`.
- [x] 3.4 Test `tests/sim.determinism.test.ts`: los dos scenarios de "Simulación determinista a paso fijo" (entradas aleatorias con un PRNG sembrado definido en el propio test). Verificación: `npx vitest run tests/sim.determinism.test.ts` y `grep -rE "Math\.random|performance\.now|Date\.now|from 'three'" src/sim` sin resultados.

## 4. Cronometraje (worker-opus, skill `f1-car-feel` §8)

- [x] 4.1 `src/sim/timing.ts` (`LapTimer`, design D5) e integración en `Simulation.step`. Test `tests/sim.timing.test.ts`: un `it` por scenario de `specs/lap-timing/spec.md` excepto los de "Persistencia" (usar óvalo sintético y, cuando haga falta velocidad constante o teletransporte, manipular `sim.state.car` directamente en el test). Verificación: `npx vitest run tests/sim.timing.test.ts`.

## 5. Piloto de referencia (worker-opus)

- [x] 5.1 `src/sim/autopilot.ts` (design D6). Test `tests/sim.lap.test.ts` sobre Interlagos real: scenarios de "Vuelta completa sin intervención", "Robustez ante latencia" (cola FIFO de 12 pasos en el test) y "Determinismo del piloto". Imprimir con `console.info` los dos tiempos de vuelta y la velocidad máxima. Ajustar solo `config.autopilot.*`. Verificación: `npx vitest run tests/sim.lap.test.ts`. Si no se logra sin tocar la física, detenerse y reportar dónde (`s`) se sale el coche.

## 6. Mallas y render (worker-sonnet, skills `track-pipeline` §4, `threejs-fundamentals`, `threejs-geometry`)

- [x] 6.1 `src/track/mesh.ts` (design D4). Test `tests/track.mesh.test.ts` (entorno node; `three` funciona sin DOM para geometría): scenarios de "Mallas de pista continuas" y "Mallas dentro del presupuesto". Verificación: `npx vitest run tests/track.mesh.test.ts`.
- [x] 6.2 `src/render/scene.ts`, `src/render/car.ts`, `src/render/chaseCamera.ts` (design D7). `scene.ts` exporta `createRenderer(canvas)`, `createScene(track)`, `resize()`; DPR = `min(devicePixelRatio, config.render.maxDpr)`. Sin logos ni marcas. Verificación: `npx tsc --noEmit`; la comprobación visual llega en 7.3.

## 7. Armazón del juego (worker-sonnet, skill `threejs-gameplay-systems`)

- [x] 7.1 `src/host/loop.ts` (`FixedStepper`) y `src/host/format.ts`. Test `tests/host.loop.test.ts`: scenarios "Independencia de los fps" y "Fotograma largo", más formato `1:18.457`. Verificación: `npx vitest run tests/host.loop.test.ts`.
- [x] 7.2 `src/host/input/types.ts`, `keyboard.ts` (rampas de `config.keyboard`, `preventDefault` en flechas y espacio, R → `recenter`, P/Escape → pausa) y `autopilotSource.ts`. Test `tests/host.keyboard.test.ts` de las rampas con una clase que reciba el estado de teclas inyectado (sin DOM). Verificación: `npx vitest run tests/host.keyboard.test.ts`.
- [x] 7.3 `index.html`, `src/host/main.ts`, `hud.ts`, `hud.css`, `debugPanel.ts`, `debugApi.ts`, `storage.ts` (design D7): estados, overlay de inicio, pausa (incluida `visibilitychange`), interpolación, HUD con los `data-testid`, F3, parámetros `debug`, `autopilot`, `timescale`, persistencia de la mejor vuelta. Verificación: `npm run build` en verde y `npm run dev` sirve `/` sin errores de consola (comprobación manual rápida con el script de 8.1).

## 8. Verificación de extremo a extremo y cierre

- [x] 8.1 (worker-sonnet, skill `webapp-testing`) Añadir `playwright` a `requirements.txt` e instalarlo en `.venv` (`.venv/bin/python -m playwright install chromium` si falta el navegador). Crear `tests/e2e/b2_drive.py`: (a) abre `/?debug=1`, comprueba el primer fotograma (scenario "Primer fotograma") y guarda `out/b2_grid.png`; (b) pulsa flecha arriba 3 s y comprueba velocidad > 80 km/h; (c) pausa con P 3 s y comprueba el scenario "Pausar y reanudar"; (d) abre `/?debug=1&autopilot=1&timescale=8`, espera `lap ≥ 2` (máx. 180 s), comprueba `lastLapS` entre 62 y 105, `wallHits = 0`, `maxDrawCalls < 200`, `maxTriangles < 600000`, `dpr ≤ 1.5`, guarda `out/b2_lap.png`; (e) recarga y comprueba que `hud-best` muestra la mejor vuelta; (f) abre `/` sin `debug` y comprueba que `window.__f1` es `undefined`; (g) falla si hubo algún mensaje de consola de nivel `error` o `pageerror`. Verificación: el comando de design D7 sale con código 0.
- [x] 8.2 (orquestador) `npx tsc --noEmit`, `npx vitest run` y el E2E en verde; revisar `out/b2_grid.png` y `out/b2_lap.png` (pista continua, sin costura en la meta); revisión con `code-review-graph`; commit `feat(game): pista, física y cronómetro jugables con teclado`.
