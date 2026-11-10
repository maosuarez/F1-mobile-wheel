# Tasks

> Orden y paralelismo: 1 y 2 en paralelo → 3 y 4 en paralelo (archivos distintos: `src/host` frente a `src/wheel`) → 5 → 6 → 7. Cada worker lee antes `design.md` y la spec de su capacidad.

## 1. Relay (worker-sonnet, skill `phone-wheel-controller` §3)

- [x] 1.1 Añadir `fastapi`, `uvicorn[standard]`, `websockets` a `requirements.txt` e instalarlos en `.venv`. Crear `server/__init__.py` y `server/main.py` según design D1 (salas, reemplazo, reenvío, límite de 4 096 bytes, `peer`, latido con `RELAY_PING_S`/`RELAY_TIMEOUT_S`, códigos 4400/4001/4002, `/api/info`, comentario con la tabla del protocolo). Verificación: `.venv/bin/uvicorn server.main:app --port 8000` arranca y `curl -s localhost:8000/api/info` devuelve JSON con `lan_ips` y `public_url`.
- [x] 1.2 Crear `tools/check_relay.py` (design D1): un caso por scenario de `specs/wheel-relay/spec.md` excepto "Proxy de desarrollo". Verificación: `.venv/bin/python tools/check_relay.py` imprime todas las líneas `OK` y sale con código 0.
- [x] 1.3 `vite.config.ts` según design D2 (dos entradas, proxy, HTTPS opcional con `@vitejs/plugin-basic-ssl`, script `dev:wifi`). Crear un `wheel/index.html` mínimo provisional. Verificación: con relay y `npm run dev` en marcha, `curl -s localhost:5173/api/info` responde 200 y `npm run build` genera `dist/index.html` y `dist/wheel/index.html`.

## 2. Protocolo (worker-opus, skill `phone-wheel-controller` §4)

- [x] 2.1 Crear `src/shared/protocol.ts` con las firmas exactas de design D3 y añadir a `src/shared/config.ts` los bloques `net`, `race` y `wheel` (design D4, D5). Test `tests/protocol.test.ts`: scenarios de "Codificación compacta" y "Validación de lo recibido" de `specs/wheel-protocol/spec.md`, ida y vuelta `encode`→`decode` de cada tipo de mensaje, `generateRoomCode` (1 000 códigos: longitud 4, solo alfabeto permitido) e `isRoomCode`. Verificación: `npx vitest run tests/protocol.test.ts`.

## 3. Host: red, emparejamiento y control (worker-opus para 3.1–3.2, worker-sonnet para 3.3; skill `phone-wheel-controller` §2, §4)

- [x] 3.1 `src/host/net/roomClient.ts`, `src/host/net/wheelSource.ts`, `src/host/net/telemetry.ts` (design D4). Test `tests/host.wheelSource.test.ts` con reloj inyectado: scenarios "Dirección y pedales", "Corte de acelerador", "Pausa por pérdida" (estado `lost` por tiempo y por `peer`), reinicio de `seq`, eventos entregados una sola vez, y `echo()` con `holdMs` correcto. Test `tests/host.telemetry.test.ts`: `buildTel` produce los campos y rangos de la spec y omite `dbg` si no se pasa. Verificación: `npx vitest run tests/host.wheelSource.test.ts tests/host.telemetry.test.ts`.
- [x] 3.2 Integrar en `src/host/main.ts`: estados `pairing` y `countdown`, motivos de pausa, cambio de fuente de entrada (teclado ⇄ volante), envío de `tel` a `net.telHz`, `dbg` con `debug=1`, reanudación automática, RTT en `debugPanel.ts`, ampliación de `DebugSnapshot` (design D4). Verificación: `npx tsc --noEmit` y `npx vitest run` en verde.
- [x] 3.3 `src/host/pairing.ts` (`wheelUrl` + overlay con QR usando `qrcode`, código, ayuda de modo, aviso de relay no disponible, cuenta atrás, toast) y estilos en `src/host/hud.css`, con los `data-testid` de design D4. Test `tests/host.pairing.test.ts`: los tres scenarios de URL (USB, WiFi, pública). Actualizar `tests/e2e/b2_drive.py` para pulsar Enter y esperar la cuenta atrás antes de conducir. Verificación: `npx vitest run tests/host.pairing.test.ts` y `npm run build`.

## 4. Volante: lógica pura (worker-opus, skill `phone-wheel-controller` §5, §7)

- [x] 4.1 `src/wheel/steering.ts` (design D5). Test `tests/wheel.steering.test.ts`: un `it` por scenario de los requirements "Dirección por inclinación", "Curva de respuesta", "Filtrado sin temblor ni retraso" (ruido gaussiano con PRNG sembrado en el test), "Celular casi plano" y "Calibración del centro". Ajustar solo `config.wheel.oneEuro`. Verificación: `npx vitest run tests/wheel.steering.test.ts`.
- [x] 4.2 `src/wheel/haptics.ts` y `src/wheel/pedals.ts` (design D5). Test `tests/wheel.haptics.test.ts`: scenarios de "Vibración" y `pedalValue` (abajo 0, arriba 1, tres cuartos 0,75, fuera de la zona recortado). Verificación: `npx vitest run tests/wheel.haptics.test.ts`.

## 5. Volante: página (worker-sonnet, skills `phone-wheel-controller` §6, `frontend-design`)

- [x] 5.1 `wheel/index.html`, `src/wheel/main.ts`, `net.ts`, `controls.ts`, `display.ts`, `wheel.css` (design D5): estados de la página, puesta en marcha con un toque (cada API en su propio try/catch), envío de `in` a 60 Hz, pedales, levas, botones, pantalla de telemetría con 15 LEDs, RTT, avisos, `window.__wheel` con `debug=1`, todos los `data-testid`. Sin logos ni marcas. Verificación: `npx tsc --noEmit`, `npm run build`, y captura a 800×360, 915×412 y 740×360 con un script Playwright temporal guardada en `out/b3_wheel_<ancho>.png` sin solapes.

## 6. Volante simulado (worker-sonnet, skill `phone-wheel-controller` §8)

- [x] 6.1 `tools/fake_wheel.py` (design D6) con los cuatro guiones, `--room`, `--url`, `--duration`, `--timeout`, `--laps`, `--seed`. Verificación: con relay, `npm run dev` y el juego abierto por Playwright en `/?debug=1`, `.venv/bin/python tools/fake_wheel.py --room <código> --script straight --duration 5` sale 0 e imprime 4–6 líneas con 17–23 `tel` cada una (se automatiza en 7.1).

## 7. Verificación y cierre

- [x] 7.1 (worker-sonnet, skill `webapp-testing`) `tests/e2e/b3_wheel.py` (design D7), fallando ante cualquier error de consola: (a) host `/?debug=1` muestra QR y código, la URL de `pairing-hint` es de modo USB; (b) página del volante con ese código, toque en `tap-start`, el host entra en cuenta atrás y luego `wheelLink = "ok"`; (c) acelerar a fondo en la cuenta atrás no mueve el coche; (d) `devicemotion` sintético de +30° → `inputApplied.steer > 0` en el host y `d` del coche decrece; (e) acelerador + freno + leva a la vez: `thr` y `brk` simultáneos y un único evento `up`; (f) el volante muestra una velocidad > 0 y recibe 17–23 `tel` por segundo; `rttMs` del host es un número; (g) cerrar la página del volante → host en pausa con `pauseReason = "wheelLost"` en < 1,5 s; reabrirla → reanuda en < 1 s con el mismo `lap` y sin reiniciar `lapTimeS`; (h) segundo volante reemplaza al primero; (i) `tel` crudo inyectado por un WebSocket host de prueba con `gear = 7`, `leds = 12`, `drs = 2`, `ers = 0.6`, `leds = 16`, `gear = −1`: la pantalla lo refleja; (j) `fx` `shift` registra `[12]` en `__wheel.vibrations`; (k) nuevo host `/?debug=1` con viewport 640×360 y `tools/fake_wheel.py --script lap --timeout 400`: sale 0. Verificación: el script completo sale con código 0 y guarda `out/b3_host.png` y `out/b3_wheel.png`.
- [ ] 7.2 (usuario, con Android y `adb`) Validación con dispositivo real: `adb reverse tcp:5173 tcp:5173`; QR → control en < 5 s; girar a la derecha gira el coche a la derecha (si no, invertir `config.wheel.steerSign`); con el celular quieto `steer` estable en ± 0,01; RTT < 30 ms en F3; acelerar, frenar y cambiar a la vez; desenchufar pausa y reconectar reanuda. Verificación: el usuario confirma cada punto o reporta el que falla.
- [ ] 7.3 (orquestador) `npx tsc --noEmit`, `npx vitest run`, `tools/check_relay.py`, E2E de los bloques 2 y 3 en verde; revisar las capturas; revisión con `code-review-graph`; commit `feat(wheel): volante móvil con relay, QR y telemetría`.
