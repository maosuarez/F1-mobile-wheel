# Tasks

> Orden: 1 → 2 → 3 → 4 → 5 → 6. Todo en serie porque los pasos comparten `src/host/main.ts` y `src/render/scene.ts`. Cada worker lee antes `design.md` y `specs/vr-mode/spec.md`. Sin dependencias npm nuevas.

## 1. Configuración y perfil VR (worker-sonnet)

- [x] 1.1 Añadir a `src/shared/config.ts` el grupo `vr` de design D10 (`framebufferScale`, `foveation`, `triggerDeadzone`, `steerRangeRad`, `steerRampPerS`, `hudDistanceM`, `hudSizeM`, `hudRedrawHz`). Verificación: `npx tsc --noEmit` y `npx vitest run` en verde.
- [x] 1.2 Crear `src/render/vrQuality.ts` con `VR_QUALITY` (design D3) y un test `tests/render.vrQuality.test.ts` que compruebe: `post === false`, `dpr === 1`, `shadowMapSize <= 1024`, y que `QUALITY.high/medium/low` de `src/render/quality.ts` siguen siendo idénticos a sus valores actuales (snapshot). Verificación: `npx vitest run tests/render.vrQuality.test.ts`.

## 2. Ancla de cámara y bucle (worker-opus)

- [x] 2.1 `src/render/cameras/rig.ts`: el rig escribe la pose en un ancla `Object3D` pasada al constructor; en escritorio el ancla es la propia cámara (design D2). Test: extender `tests/cameras.rig.test.ts` con el caso ancla = cámara, comprobando que las poses de todos los scenarios existentes no cambian. Verificación: `npx vitest run tests/cameras.rig.test.ts` en verde sin editar expectativas previas.
- [x] 2.2 `src/host/main.ts`: sustituir el `requestAnimationFrame` recursivo por `renderer.setAnimationLoop(frame)` (design D1). Sin cambios de comportamiento en escritorio. Verificación: `npx tsc --noEmit`, `npx vitest run` y `npx playwright` del E2E existente de `game-shell` en verde.

## 3. Sesión VR y render estéreo (worker-opus)

- [x] 3.1 `src/host/vr/session.ts`: detección de soporte `immersive-vr` y contexto seguro, botón "Entrar en VR" oculto si no hay soporte (spec "Disponibilidad"), `requestSession('immersive-vr', { optionalFeatures: ['local-floor'] })` con el gesto, `renderer.xr.enabled`, `setFramebufferScaleFactor` y `setFoveation` de `config.vr`, y salida sin recargar (spec "Sesión inmersiva"). Verificación: `npx tsc --noEmit`; test `tests/host.vrAvailability.test.ts` con `navigator.xr` simulado (sin soporte → botón oculto; con soporte → visible).
- [x] 3.2 Integrar en el bucle: en sesión, `VR_QUALITY` fijo sin adaptativo; `PostFx` se omite y se llama `renderer.render`; la cámara se monta bajo el ancla (design D2); en escritorio no cambia nada. Verificación: `npx tsc --noEmit` y `npx vitest run` en verde; en el navegador de escritorio, `?debug=1` sigue reportando la misma calidad y draw calls que antes del cambio (comparar snapshot).

## 4. HUD y emparejamiento en el visor (worker-sonnet)

- [x] 4.1 `src/host/vr/panel.ts`: `CanvasTexture` 1024×512 sobre un plano hijo de la cámara (design D6). Función pura `drawPanelModel(model) -> lista de instrucciones` en `src/host/vr/panelModel.ts` que reutiliza `hudModel`. Test `tests/host.vrPanel.test.ts`: formato `m:ss.mmm`, marcha `R/N/1–8`, aviso prioritario único (scenario "Avisos" de race-hud). Verificación: `npx vitest run tests/host.vrPanel.test.ts`.
- [x] 4.2 Panel de emparejamiento y pausa en VR: código de sala y QR copiado desde el canvas de `pairing.ts`, mensajes de cuenta atrás y pausa. Verificación: `npx tsc --noEmit`; el texto de la sala del panel coincide con el DOM en la prueba del punto 4.1.

## 5. Mandos como fuente de entrada (worker-opus)

- [x] 5.1 `src/host/input/vrControllersMap.ts`: función pura `mapControllers(state, dt, config.vr) -> DriverInput` (gatillo derecho acelerador, izquierdo freno, roll del grip derecho → dirección con rampa, zona muerta). Test `tests/host.vrControllers.test.ts` con los scenarios "Conducción con mandos" y "Prioridad del volante" (la prioridad se prueba en 5.2). Verificación: `npx vitest run tests/host.vrControllers.test.ts`.
- [x] 5.2 `src/host/input/vrControllers.ts` (`InputSource` con `name: 'controllers'`, ampliar el tipo en `input/types.ts`) conectado a `renderer.xr` y a `updateWheel` en `main.ts` (design D8): solo activo en sesión VR y sin volante conectado. Verificación: `npx vitest run` en verde; test de prioridad en `tests/host.vrControllers.test.ts` (volante conectado → el coche ignora los mandos).

- [x] 5.3 Botones de los mandos (design D7, no cubiertos por 5.1/5.2): botón A del mando derecho → pausa (`togglePause`), botón X del mando izquierdo → recolocar (`sim.recenter()` cuando `state === 'racing'`), mismos efectos que P y R del teclado. Evento por flanco de subida, no por nivel. Verificación: test `tests/host.vrControllers.test.ts` con scenario de flanco (mantener A no alterna la pausa en cada fotograma); `npx tsc --noEmit` y `npx vitest run` en verde.

## 6. Verificación y cierre

- [x] 6.1 (worker-sonnet, skill `webapp-testing`) Escritorio sin cambios: `tests/e2e/b7_desktop.py` sin errores de consola en `/?debug=1`, botón "Entrar en VR" oculto, `?quality=high` con la misma calidad y draw calls que antes del cambio. Verificación: el script sale con código 0 y deja capturas en `out/`.
- [x] 6.2 (worker-sonnet, skill `threejs-qa-release`) Revisión de presupuesto VR: con `navigator.xr` simulado en Playwright (sin visor), comprobar que el perfil `VR_QUALITY` se aplica al entrar y que el F3 muestra el total de draw calls. Verificación: script de 6.1 en verde y `npx vitest run` en verde.
- [ ] 6.3 Revisión con `code-review-graph` (`detect_changes` y `get_review_context` sobre los archivos de este change) y commit Conventional Commits del bloque. Verificación: `git log -1` muestra `feat(vr): ...`.

## Workflow follow-up

- Prueba en visor (usuario): túnel de cloudflared (`cloudflared tunnel --url http://localhost:5173`), abrir la URL HTTPS en el Meta Quest, entrar en VR, conducir con mandos y con el celular como volante. Ajustar `steerRangeRad`, tamaño del panel y perfil VR según lo que se sienta.
- Archivar el change tras la prueba en visor.
