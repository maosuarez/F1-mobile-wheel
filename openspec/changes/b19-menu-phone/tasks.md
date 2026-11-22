# Tasks

## 1. Detección del celular y URL para unirse (worker-sonnet)

- [x] 1.1 En `src/host/pairing.ts` cambiar `shouldShowWheelButton` a `(coarseNoHover: boolean, userAgent: string)` con `VR_UA_RE` exportada (design D2) y añadir `joinUrl(loc, info, code, track)` (design D3). Actualizar `tests/host.pairing.test.ts`: Android con UA de Chrome móvil → true; UA con `OculusBrowser` o `Pico` → false; puntero fino → false; `joinUrl` con y sin `public_url` y con código/circuito codificados. Verificar: `npx vitest run tests/host.pairing.test.ts --maxWorkers=2`.
- [x] 1.2 En `src/host/main.ts` hacer `initWheelButton()` síncrono con `navigator.userAgent` (sin `navigator.xr`) y guardar `isPhone` para el menú. Verificar: `npx tsc --noEmit` sin errores.

## 2. Menú rediseñado (worker-sonnet, skill `frontend-design`)

- [x] 2.1 Reescribir `RaceMenu.render()` en `src/host/race/menu.ts` y añadir el bloque `/* b19 menú */` en `src/host/hud.css` según design D1, conservando todos los `data-testid`, `aria-pressed`, `data-row`, `data-val` y `data-focus`. Añadir el 4.º parámetro `opts.phoneWheel` y la tarjeta `menu-open-wheel` (D2); `main.ts` pasa `{ phoneWheel: isPhone }`. Sin tocar la lógica pura. Verificar: `npx vitest run tests/host.menu.test.ts --maxWorkers=2` en verde y captura del menú a 1280×720 y 360×740 con Playwright (sin scroll horizontal a 360 px).

## 3. QR para unirse y overlay en carrera online (worker-sonnet)

- [x] 3.1 `LobbyRunOptions.joinUrl` y canvas `lobby-join-qr` en `src/host/online/lobby.ts` (design D3); `main.ts` lo pasa. Añadir a `tests/host.lobby.test.ts` un caso puro si se extrae un helper; si no, cubrir en E2E. Verificar: `npx vitest run tests/host.lobby.test.ts --maxWorkers=2`.
- [x] 3.2 Overlay `overlay-qr` y botón `qr-toggle` en `index.html` + estilos en `hud.css`, clase `QrOverlay` en `src/host/online/qrOverlay.ts` y cableado en `main.ts` (tecla O, botón, visibilidad solo online) según design D4. Verificar: `npx tsc --noEmit` y `npx vitest run --maxWorkers=2` en verde.

## 4. Verificación y cierre

- [x] 4.1 E2E `tests/e2e/b19_menu_phone.py` (Playwright, puertos limpios según la memoria del proyecto): (a) menú a 1280×720 y 360×740 sin scroll horizontal, `menu-mode-race` + flecha izquierda + Enter arranca carrera; (b) contexto móvil (`is_mobile=True`, `has_touch=True`, UA Android Chrome) → `open-wheel` y `menu-open-wheel` visibles; UA con `OculusBrowser` → ocultos; escritorio → ocultos; (c) dos páginas online: la que crea la sala muestra `lobby-join-qr` con `data-url` que contiene `online=join&code=`; en carrera, O muestra `overlay-qr` con `qr-room-closed` visible, O lo oculta, y `simTimeS` siguió avanzando. Sin errores de consola. Verificar: `.venv/bin/python tests/e2e/b19_menu_phone.py` sale con 0.
- [ ] 4.2 Cierre (Fable): `npx vitest run` en verde, E2E 4.1 en verde, `code-review-graph build` + `detect_changes`, commit Conventional Commits vía `commit-orchestrator` (`feat(host): menú de modo con estética de retransmisión, acceso al volante en celular y QR online`).

## Workflow follow-up

- `/opsx:archive b19-menu-phone` tras el commit.
