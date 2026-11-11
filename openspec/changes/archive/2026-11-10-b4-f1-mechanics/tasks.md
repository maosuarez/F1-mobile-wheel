# Tasks

> Orden y paralelismo: 1 → (2 → 3 → 4 → 5 → 6, en serie: comparten `car.ts` y `simulation.ts`) en paralelo con 7 → 8 → 9. Cada worker lee antes `design.md` y la spec de su capacidad.

## 1. Tipos y configuración (worker-sonnet)

- [x] 1.1 Ampliar `src/sim/types.ts` (design D1) y `src/shared/config.ts` (design D2: sustituir `car.powerKw` por `car.icePowerKw` y añadir `gears`, `drs`, `ers`, `limits`, `hud`). Inicializar los campos nuevos en la creación del estado (`gear: 1`, `rpm: idle`, `drs: 0`, `ersCharge: 1`, resto a 0/false) y añadir `assists` a `Simulation`. Mantener temporalmente la potencia total de 680 kW en `stepCar` (`icePowerKw + ers.baseDeployKw`) para que todo siga en verde. Verificación: `npx tsc --noEmit` y `npx vitest run` en verde.

## 2. Caja de cambios (worker-opus, skill `f1-car-feel` §4)

- [x] 2.1 `src/sim/gearbox.ts`: funciones puras `gearTopMs`, `rpmFor`, `powerFactor`, `ledsFor`, `canShiftTo`, `autoShiftCommand` (design D3). Test `tests/sim.gearbox.pure.test.ts`: scenario "Progresión" de LEDs, ralentí, `powerFactor` en 4 000/9 000/12 000/12 500, `canShiftTo` para los scenarios de reducción rechazada/aceptada y de marcha atrás. Verificación: `npx vitest run tests/sim.gearbox.pure.test.ts`.
- [x] 2.2 `stepGearbox` e integración en `Simulation.step` y `stepCar` (fuerza motriz por RPM, corte de cambio, limitador, punto muerto, marcha atrás, freno motor, RPM con patinaje, orden en cola durante el corte). Test `tests/sim.gearbox.test.ts`: un `it` por scenario de "Marchas secuenciales", "RPM y limitador", "Entrega de potencia según las RPM", "Corte de potencia al cambiar", "Protección de reducción", "Marcha atrás y punto muerto". Verificación: `npx vitest run tests/sim.gearbox.test.ts`.
- [x] 2.3 Sobrecalentamiento y cambio automático. Añadir a `tests/sim.gearbox.test.ts` los scenarios de "Sobrecalentamiento" y "Cambio automático como asistencia". Verificación: `npx vitest run tests/sim.gearbox.test.ts`.

## 3. ERS (worker-opus, skill `f1-car-feel` §5)

- [x] 3.1 `src/sim/ers.ts` e integración (design D3; quitar la potencia fija temporal de 1.1). Test `tests/sim.ers.test.ts`: un `it` por scenario de `specs/ers/spec.md` excepto "Controles". Verificación: `npx vitest run tests/sim.ers.test.ts`.

## 4. DRS (worker-opus, skill `f1-car-feel` §6)

- [x] 4.1 `src/sim/drs.ts` e integración (`aeroFactors` aplicado a arrastre y carga en `stepCar` y `gripAccel`). Test `tests/sim.drs.test.ts` con una recta sintética con una zona DRS añadida en el test: un `it` por scenario de `specs/drs/spec.md` excepto "Controles". Verificación: `npx vitest run tests/sim.drs.test.ts`.

## 5. Límites de pista (worker-opus, skill `f1-car-feel` §7)

- [x] 5.1 `src/sim/limits.ts` e integración. Test `tests/sim.limits.test.ts`: un `it` por scenario de `specs/track-limits/spec.md` (colocando el coche con `d` conocido en un óvalo sintético). Verificación: `npx vitest run tests/sim.limits.test.ts`.

## 6. Regresión de la física y piloto de referencia (worker-opus)

- [x] 6.1 Adaptar los tests del bloque 2 a la caja real sin relajar ninguna banda: `tests/sim.longitudinal.test.ts` usa una copia de `config` con `ers.capacityMJ = 1e6` y `ers.lapDeployLimitMJ = 1e6` para "toda la potencia disponible". Reajustar solo valores de `config` (`aero.cdA`, `gears.*`, `drs.cdaFactor`, `car.rearLoadFraction`) hasta que todas las bandas de `vehicle-dynamics`, `gearbox`, `drs` y `ers` pasen a la vez. Verificación: `npx vitest run` completo en verde. Si dos bandas resultan incompatibles, detenerse y reportar los valores medidos.
- [x] 6.2 `src/sim/autopilot.ts` (design D4): orden `drs`, `suggestedGear`. `tests/sim.lap.test.ts` sigue cumpliendo `reference-driver` y además comprueba que en la vuelta lanzada el DRS se abre al menos una vez y la marcha máxima usada es ≥ 7. En `src/host/net/telemetry.ts`, `dbg.gear = suggestedGear`. Verificación: `npx vitest run tests/sim.lap.test.ts tests/host.telemetry.test.ts`.

## 7. Entrada y telemetría en el host (worker-sonnet)

- [x] 7.1 `src/host/input/keyboard.ts`: E, Q, F por flanco, Espacio mantenido, M (design D5); `autoShift` según la fuente de entrada en `main.ts`. Ampliar `tests/host.keyboard.test.ts`: una pulsación mantenida de E genera un solo `shiftUp`; Espacio da `ers = true` mientras dura. Verificación: `npx vitest run tests/host.keyboard.test.ts`.
- [x] 7.2 `src/host/warnings.ts` (`WarningCenter`) y `buildTel` con valores reales (`gear`, `rpm`, `leds`, `drs`, `ers`, `ot`, `warn`). Test `tests/host.warnings.test.ts`: scenarios de "Avisos"; ampliar `tests/host.telemetry.test.ts` con los scenarios de "Telemetría del volante coherente". Ampliar `DebugSnapshot`. Verificación: `npx vitest run tests/host.warnings.test.ts tests/host.telemetry.test.ts`.

## 8. HUD de carrera (worker-sonnet, skill `threejs-game-ui-designer`)

- [x] 8.1 Reescribir `src/host/hud.ts` y `src/host/hud.css` (design D5) con todos los `data-testid` y estados, actualización solo si cambia el valor, sin marcas. Extraer a `src/host/hudModel.ts` una función pura `hudModel(state, warn, bestSectors): HudModel` (textos y estados ya formateados) y testearla en `tests/host.hud.test.ts`: scenarios "Marcha y LEDs", "Limitador", "Batería", "Delta", "Sector mejorado", "Vuelta inválida". Verificación: `npx vitest run tests/host.hud.test.ts` y `npm run build`.

## 9. Verificación y cierre

- [x] 9.1 (worker-sonnet, skill `webapp-testing`) `tests/e2e/b4_mechanics.py`, fallando ante errores de consola: (a) `/?debug=1` con teclado: tras Enter y la cuenta atrás, M desactiva el automático, acelerar mantiene 1.ª en el limitador con `leds = 16` y el contenedor de LEDs parpadea; E sube a 2.ª; (b) `/?debug=1&autopilot=1&timescale=8` durante 2 vueltas: `drs` pasa por 1 y 2, `hud-drs` refleja el estado, `ers` baja de 1 y vuelve a subir en alguna frenada, `gear` llega a ≥ 7, las vueltas son válidas y `lastLapS` está entre 62 y 105; (c) capturas `out/b4_hud_1080.png` y `out/b4_hud_720.png` y comprobación por `bounding_box` de que ningún par de elementos `[data-testid^="hud-"]` hermanos se solapa ni sale de la ventana; (d) con el volante de `tests/e2e/b3_wheel.py` reutilizado: un evento `up` cambia `disp-gear`, y `tools/fake_wheel.py --script lap` sigue completando la vuelta en modo manual. Verificación: el script sale con código 0.
- [x] 9.2 (orquestador) `npx tsc --noEmit`, `npx vitest run`, E2E de los bloques 2–4 en verde; revisar capturas del HUD; revisión con `code-review-graph`; commit `feat(sim): marchas, DRS, ERS, límites de pista y HUD de carrera`.
