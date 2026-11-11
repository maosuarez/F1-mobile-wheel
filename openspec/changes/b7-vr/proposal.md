# Proposal

## Why

El juego se conduce en el PC con el volante del celular. Un Meta Quest (navegador con WebXR) permite verlo en inmersión y conducir con los mandos de las gafas, sin tocar el flujo de escritorio. Es un módulo opcional: se activa solo en navegadores con WebXR inmersivo.

Referencia: [context.md](../../../context.md), bloque fuera de la lista 1–6 (módulo adicional acordado con el usuario). Se sirve por el túnel de cloudflared, que ya da contexto seguro.

## What Changes

- Botón "Entrar en VR" en el host, visible solo si `navigator.xr` soporta `immersive-vr`.
- Sesión WebXR inmersiva con render estéreo y perfil de calidad VR propio (sin posproceso, resolución de framebuffer reducida, sombras baratas). Los perfiles de escritorio no cambian.
- La cámara de cabeza sigue la cámara elegida en el rig; la pose de la cabeza se suma como desplazamiento local.
- HUD en VR como panel de canvas en 3D con velocidad, marcha, vuelta y tiempos.
- Mandos WebXR como fuente de entrada alternativa: rotación del mando como volante, gatillos como acelerador y freno, mapeada a `DriverInput`.
- El volante del celular sigue funcionando igual dentro de la sesión VR.
- Sin dependencias npm nuevas: solo three.js (WebXR integrado).

## Capabilities

### New Capabilities

- `vr-mode`: entrada y render en VR (WebXR inmersivo), perfil de calidad VR, HUD en el espacio 3D y fuente de entrada por mandos.

### Modified Capabilities

Ninguna. El comportamiento de escritorio (`game-shell`, `race-hud`, `render-performance`, `visual-quality`) no cambia; el módulo lo cumple como restricción, no como modificación de requisitos.

## Impact

- `src/host/`: botón de entrada, bucle de sesión XR, fuente de entrada de mandos, integración del panel VR.
- `src/render/`: activación de `renderer.xr`, perfil VR en un módulo nuevo, integración del rig con la cabeza.
- `src/shared/config.ts`: constantes del perfil VR y de la fuente de mandos, en un grupo nuevo.
- Sin cambios en `src/sim`, `protocol.ts`, `server/` ni `src/wheel/`.
- Requiere HTTPS: el modo local usa `dev:wifi` o el túnel de cloudflared.
