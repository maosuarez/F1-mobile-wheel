# Tasks

## 1. Entradas por jugador (worker-sonnet)

- [ ] 1.1 `KeyboardInput` con `layout: 'p1'|'p2'|'both'` y `config.split.p2Keys` (design D2, D7); `GamepadInput` con índice fijo. Tests en `tests/host.keyboard.test.ts` y `tests/host.gamepad.test.ts` (teclas independientes; 1 jugador sin cambios). Verificar: `npx vitest run`.
- [ ] 1.2 `src/host/split/players.ts` `assignSources` con tests; pairing con N salas y N QR etiquetados (`pairing.ts`, `index.html`, `hud.css`). Verificar: `npx vitest run tests/host.pairing.test.ts tests/host.split.test.ts`.

## 2. Render y HUD divididos (worker-opus)

- [ ] 2.1 `src/host/split/layout.ts` `viewports` con test; render por viewport con scissor, cámaras por jugador, calidad ≤ `medium`, sin composer y viñeta CSS, sombra según D3. Verificar: `npm run typecheck` y `npx vitest run`.
- [ ] 2.2 `HudView` instanciable, minimapa por jugador, torre compartida con 2 jugadores resaltados, avisos por jugador, audio de 2 motores (D4, D5), pausa por desconexión (D6). Integración en `main.ts` con `players` del menú y URL. Verificar: `npx vitest run` y `npm run typecheck`.

## 3. Verificación (worker-sonnet)

- [ ] 3.1 E2E `tests/e2e/b15_split.py` con `webapp-testing` (puertos limpios): `/?debug=1&players=2&mode=race&rivals=8` con dos `fake_wheel.py --script lap` en las dos salas; comprobar que cada coche responde a su volante, captura de la pantalla dividida, desconexión de J2 → pausa con aviso, draw calls ≤ 320, sin errores de consola.

## 4. Cierre (Fable)

- [ ] 4.1 `npx vitest run`, `npm run build`, revisión de capturas, `code-review-graph build` + `detect_changes`; commit `feat(host): pantalla dividida para 2 jugadores locales` vía `commit-orchestrator`; `/opsx:archive b15-local-split`.
