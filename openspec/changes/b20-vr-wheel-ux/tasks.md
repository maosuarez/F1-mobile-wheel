# Tasks

## 1. Protocolo y config (worker-sonnet)

- [ ] 1.1 `src/shared/protocol.ts`: campos opcionales `vr` y `cal` en `TelMsg`, `encode`/`decodeTel` según design D1; cabecera del protocolo y docstring de `server/main.py` (solo comentario). `buildTel` en `src/host/net/telemetry.ts` con `extra.vr/cal`. `config.wheel.shake` en `src/shared/config.ts` (D2). Tests en `tests/protocol.test.ts` y `tests/host.telemetry.test.ts`: ida y vuelta con y sin los campos; tipo inválido se ignora sin invalidar. Verificar: `npx vitest run tests/protocol.test.ts tests/host.telemetry.test.ts --maxWorkers=2`.

## 2. Volante: sacudida, layout y calibración

- [ ] 2.1 (worker-opus) `src/wheel/shake.ts` con `ShakeDetector` y `shakeAction` (D2) y `tests/wheel.shake.test.ts` cubriendo todos los escenarios de "Agitar para DRS y ERS" de `specs/wheel-ui/spec.md` (picos sintéticos, enfriamiento, curva, pico único, congelado de dirección vía `active`). Verificar: `npx vitest run tests/wheel.shake.test.ts --maxWorkers=2`.
- [ ] 2.2 (worker-sonnet) `wheel/index.html`, `src/wheel/controls.ts`, `src/wheel/main.ts`, `src/wheel/display.ts`, `src/wheel/wheel.css`: quitar botones DRS/ERS, freno más grande, cableado de la sacudida (latch de ERS, apagado al frenar, dirección congelada), modo VR con `body[data-vr]` y capa `cover-cal` (D2, D3). Exponer en `window.__wheel` (modo debug) `injectMotion(ax, ay, az, gx, gy, tMs)` para el E2E. Verificar: `npx tsc --noEmit` y `npx vitest run --maxWorkers=2`.

## 3. Host VR (worker-opus)

- [ ] 3.1 `src/host/vr/panelModel.ts` (`race`, `calibrate`), `src/host/race/tower.ts` (`towerWindow`), `src/host/vr/wheelScreenModel.ts` y `paintOps` extraída en `src/host/vr/panel.ts` (D4, D5). Tests en `tests/host.vrPanel.test.ts` y `tests/host.tower.test.ts`: escenario online de 6 coches con el jugador 4.º, ventana de 6 filas en los extremos, ops del volante con `200` y `6`. Verificar: `npx vitest run tests/host.vrPanel.test.ts tests/host.tower.test.ts --maxWorkers=2`.
- [ ] 3.2 `src/render/wheelScreen.ts`, `steeringWheel` expuesto en `src/render/car.ts` y cableado en `src/host/main.ts`: visibilidad por cámara de casco, selección de pantalla del panel, estado `calibrating`, `beginStart()`, `recal`, Enter/A para saltar y campos `vr/cal` en la telemetría (D4, D5, D6). Test de `render.car.test.ts` que comprueba `steeringWheel` y que fuera de VR los draw calls no cambian. Verificar: `npx tsc --noEmit` y `npx vitest run --maxWorkers=2`.

## 4. Verificación y cierre

- [ ] 4.1 E2E `tests/e2e/b20_vr_wheel.py` (puertos limpios según la memoria del proyecto): página del volante con `?debug=1` contra un host de prueba que envía `tel` (o el host real): (a) sin `btn-drs`/`btn-ers`, freno ≥ 60 % del alto; (b) `injectMotion` con dos picos alternos en recta y `drs=1` → un `ev drs`; con `drs=0` → `ers` true y luego false al frenar; (c) `tel` con `vr=true` → `disp-speed` oculto y 4 botones visibles ≥ 64 px; (d) `tel` con `cal=true` → `cal-start` visible, al tocar sale `ev recal` y se oculta. Host: con `__debug` simular VR si existe un gancho; si no, cubrir `calibrating` con Vitest y dejar la validación con visor real como pendiente manual. Sin errores de consola. Verificar: `.venv/bin/python tests/e2e/b20_vr_wheel.py` sale con 0.
- [ ] 4.2 Cierre (Fable): `npx vitest run` en verde, E2E 4.1 en verde, `code-review-graph build` + `detect_changes`, commits Conventional Commits vía `commit-orchestrator` (`feat(wheel): agitar para DRS/ERS, modo VR y calibración` y `feat(vr): instrumentos en el volante y panel de carrera`). Prueba con visor y celular real: pendiente para la revisión final.

## Workflow follow-up

- `/opsx:archive b20-vr-wheel-ux` tras los commits.
