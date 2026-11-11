# Tasks

> Orden y paralelismo: 1 → (2, 3 y 4 en paralelo: `src/audio`, `src/render/cameras`, `src/host/net/fx.ts`) → 5 → 6. Cada worker lee antes `design.md` y la spec de su capacidad.

## 1. Configuración (worker-sonnet)

- [ ] 1.1 Añadir a `src/shared/config.ts` los bloques `audio`, `camera`, `fx` de design D1 (sin eliminar todavía `render.chase`). Verificación: `npx tsc --noEmit` y `npx vitest run` en verde.

## 2. Audio del motor (worker-opus, skill `f1-car-feel` §9)

- [ ] 2.1 `src/audio/engineParams.ts` (design D2). Test `tests/audio.params.test.ts`: scenarios "Frecuencias de referencia", "Brillo", "Volumen", "Viento", la envolvente de cambio (≥ 50 % de caída durante 40 ± 15 ms) y la modulación del limitador (contando cruces por la media en 1 s: 12–18 Hz). Verificación: `npx vitest run tests/audio.params.test.ts`.
- [ ] 2.2 `src/audio/engine.ts` (`EngineAudio`, grafo de design D2, ruido con LCG sembrado, rampas, compresor, analizador con `debug=1`, silencio persistente). Verificación: `npx tsc --noEmit`; el comportamiento en navegador se comprueba en 6.1.

## 3. Cámaras (worker-opus, skills `f1-car-feel` §10, `threejs-gameplay-systems`)

- [ ] 3.1 `src/render/cameras/math.ts` (design D3). Test `tests/cameras.math.test.ts`: scenarios "Sin sobreoscilación", "Independencia de los fps" (resorte a 30 y 144 pasos por segundo), "Valores extremos e intermedios" de FOV, los cuatro de "Temblor de cámara" que no dependen de la simulación, "Reparto" y "Cambio al pasar" de TV sobre Interlagos, y "Encuadre" (ancho visible = `2·dist·tan(fovV/2)·16/9`). Verificación: `npx vitest run tests/cameras.math.test.ts`.
- [ ] 3.2 `src/render/cameras/rig.ts` (`CameraRig`). Test `tests/cameras.rig.test.ts` con una `THREE.PerspectiveCamera` real en Node: "Primera persona por defecto", "Ciclo completo", "Corte limpio", "Velocidad constante", "Derrape", "Balanceo en curva", "Frenada". Verificación: `npx vitest run tests/cameras.rig.test.ts`.

## 4. Háptica (worker-opus, skill `phone-wheel-controller` §7)

- [ ] 4.1 `src/host/net/fx.ts` (`FxPlanner`, design D4). Test `tests/host.fx.test.ts` con reloj inyectado: un `it` por scenario de `specs/haptic-feedback/spec.md` salvo "Sin volante". Verificación: `npx vitest run tests/host.fx.test.ts`.

## 5. Integración en el host (worker-sonnet)

- [ ] 5.1 `src/host/main.ts`: crear `EngineAudio` e invocar `start()` en el gesto que inicia la partida; `update`/`onEvent` por fotograma y por evento; pausa y tecla V. Sustituir la cámara por `CameraRig` (C y `ev cam`), eliminar `src/render/chaseCamera.ts` y `config.render.chase`. Enviar `fx` con `FxPlanner` solo con volante en control y sin pausa. Ampliar `DebugSnapshot` (design D5). Añadir un test en `tests/sim.determinism.test.ts` que confirme que la simulación no importa nada de `src/render`, `src/audio` ni `src/host` (`grep` desde el test con `fs`). Verificación: `npx tsc --noEmit`, `npx vitest run` y `npm run build` en verde.

## 6. Verificación y cierre

- [ ] 6.1 (worker-sonnet, skill `webapp-testing`) `tests/e2e/b5_feel.py`, fallando ante errores de consola: (a) `/?debug=1` recién cargada: `snapshot().audio` es `null` y no hay avisos de autoplay; (b) tras Enter, cuenta atrás y 3 s acelerando: `audio.state = "running"`, `rms > 0.01`, `f0Hz` coherente con las RPM (± 5 %); (c) pausa: `rms < 0.001` en 0,3 s; reanudar lo recupera; (d) V silencia, recargar mantiene el silencio, V lo quita; (e) arranca en `helmet`; C tres veces recorre `chase`, `tv`, `helmet`, con capturas `out/b5_chase.png`, `out/b5_helmet.png`, `out/b5_tv.png`; (f) con `autopilot=1&timescale=4` durante 40 s: `camera.fovDeg` supera 80 en recta y baja de 75 en curva lenta, `audio.peak ≤ 0.98`; (g) con el volante del E2E del bloque 3 y `fake_wheel.py --script straight --duration 8`: `fxSent.shift ≥ 3` y la página del volante registra vibraciones `[12]`; con teclado `fxSent` queda todo a 0. Verificación: el script sale con código 0.
- [ ] 6.2 (usuario) Escuchar el motor y probar las tres cámaras; con el celular, confirmar que se nota la vibración en cambio, piano, hierba y limitador. Verificación: el usuario confirma o indica qué ajustar.
- [ ] 6.3 (orquestador) `npx tsc --noEmit`, `npx vitest run`, E2E de los bloques 2–5 en verde; revisar las tres capturas; revisión con `code-review-graph`; commit `feat(feel): audio del motor, cámaras, FOV dinámico y háptica`.
