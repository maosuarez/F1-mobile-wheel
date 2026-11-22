# Design

## Context

- El bucle de `src/host/main.ts` usa `requestAnimationFrame` recursivo, que no dispara durante una sesión WebXR. Hay que pasar a `renderer.setAnimationLoop` para ambos modos (en escritorio es equivalente).
- `PostFx` (`src/render/post.ts`) usa un compositor. En VR no se usa: el render llama a `renderer.render` directamente.
- `CameraRig` (`src/render/cameras/rig.ts`) escribe la pose de `camera` en espacio mundo. En WebXR la pose de la cabeza se compone con el padre de la cámara, así que el rig debe escribir un ancla.
- El HUD (`src/host/hud.ts`) y el emparejamiento (`src/host/pairing.ts`) son DOM. No se ven dentro de la sesión.
- Entrada actual: `KeyboardInput` y `WheelSource`, ambos implementan `InputSource` (`src/host/input/types.ts`).
- Túnel: `vite.config.ts` ya admite `.trycloudflare.com`. El Quest abre la URL HTTPS del túnel: contexto seguro, sin cambios de servidor ni de protocolo.

## Goals / Non-Goals

**Goals:** entrar y salir de VR sin recargar; render estéreo con perfil propio; HUD y emparejamiento visibles dentro del visor; mandos como fuente de entrada; escritorio y volante intactos.

**Non-Goals:** manos (hand tracking); multijugador; teleportación o movimiento libre del jugador; dependencias npm nuevas; cambiar `context.md` (el presupuesto de escritorio sigue igual, el VR tiene su perfil).

## Decisions

**D1. Bucle único con `setAnimationLoop`.** `renderer.setAnimationLoop(frame)` sustituye al `requestAnimationFrame` recursivo. Alternativa descartada: dos bucles, uno por modo, con más riesgo de divergencia en la pausa y el temporizador de telemetría.

**D2. Ancla de cámara `vrAnchor` (Object3D).** `CameraRig` recibe el objeto que escribe la pose (`anchor`). En escritorio el ancla es la propia `camera` (sin cambio de salida). En VR la cámara se monta como hijo del ancla y el ancla recibe la pose del rig; la cabeza se suma por WebXR. Alternativa descartada: mover la cámara en espacio mundo, que WebXR sobrescribe.

**D3. Perfil VR en módulo propio.** `src/render/vrQuality.ts` exporta `VR_QUALITY` (dpr fijo 1.0, `post: false`, sombras 1024, árboles y partículas reducidos a la mitad, `envMapSize` 128). `QUALITY` en `quality.ts` no cambia. Al entrar en VR no se usa el adaptativo de escritorio; se usa `VR_QUALITY` fijo.

**D4. Escalado del framebuffer y foveación.** `renderer.xr.setFramebufferScaleFactor(config.vr.framebufferScale)` (0,8) y `renderer.xr.setFoveation(1)`. Alternativa: resolución nativa, descartada por la GPU móvil del Quest.

**D5. Presupuesto VR.** ≤ 200 draw calls por fotograma contando ambos ojos (la pasada de sombras se hace una vez). El debug panel (F3) muestra el total VR cuando la sesión está activa.

**D6. HUD y emparejamiento en un panel de canvas.** Un `CanvasTexture` 1024×512 sobre un plano hijo de la cámara, a 1,2 m, en la esquina inferior izquierda del campo de visión (no tapa el centro). Dibuja `hudModel` (velocidad, marcha, vuelta, tiempos, aviso). Durante el emparejamiento dibuja el código de sala y copia el canvas del QR (`pairing.ts`). Se redibuja a 10 Hz, no por fotograma.

**D7. Mandos como `InputSource` (`src/host/input/vrControllers.ts`).** Nombre `'controllers'` (ampliar `InputSource.name`). Mapeo puro en `vrControllersMap.ts` (testeable sin WebXR):
- gatillo derecho → acelerador; gatillo izquierdo → freno (`gamepad.buttons[0].value`, con zona muerta `config.vr.triggerDeadzone`);
- roll del grip derecho → dirección: `steer = clamp(roll / config.vr.steerRangeRad, -1, 1)` pasando por la misma rampa que el teclado;
- botón A (derecha) → pausa; botón X → recolocar.

**D8. Prioridad de fuentes.** Volante conectado > mandos (con sesión VR activa) > teclado. El código existente de `updateWheel` no cambia; solo se añade la rama de mandos cuando no hay volante.

**D11. Espacio de referencia `local`, no `local-floor`.** El ancla ya está a la altura del casco; con `local-floor` WebXR sumaría la altura real de la cabeza (≈1,2 m sentado) y la vista quedaría por encima del coche. Con `local` el origen es la posición de la cabeza al entrar en la sesión y el ancla aporta la altura. Se mantiene `local-floor` solo como opción para una futura escena con suelo propio.

**D9. Sin cambios en `src/sim`, `protocol.ts`, `server/` y `src/wheel/`.** Los mandos producen `DriverInput`; la telemetría al volante no cambia.

**D10. Constantes en `config.ts`, grupo `vr`:** `framebufferScale: 0.8`, `foveation: 1`, `triggerDeadzone: 0.05`, `steerRangeRad: 1.05` (60°), `steerRampPerS`, `hudDistanceM: 1.2`, `hudSizeM: [0.6, 0.3]`, `hudRedrawHz: 10`.

## Risks / Trade-offs

- **[GPU del Quest insuficiente]** → perfil `VR_QUALITY` fijo y presupuesto de 200 draw calls; si no alcanza, bajar árboles y partículas antes que resolución.
- **[Rig en espacio de ancla]** → desviación de la cámara de escritorio. Mitigación: el test compara la matriz de la cámara de escritorio antes y después del cambio.
- **[Self-signed o túnel caído]** → el Quest necesita HTTPS válido; el túnel de cloudflared lo da. Sin túnel no aparece el botón (contexto no seguro).
- **[Verificación sin visor]** → no hay Quest conectado aquí. Se verifica con tests unitarios del mapeo y con el modo de escritorio; la prueba en visor queda pendiente para el usuario (ver memoria de validación con dispositivo).
- **[Dos bucles durante la transición]** → D1 elimina el `requestAnimationFrame` recursivo antes de añadir la sesión.

## Migration Plan

Cambio aditivo. Rollback: revertir el commit; el escritorio no depende de los nuevos módulos salvo el bucle de D1, que se valida con el E2E de `webapp-testing` existente.

## Open Questions

Ninguna bloqueante. Ajuste fino de `steerRangeRad` y del tamaño del panel se hace en la prueba en visor.
