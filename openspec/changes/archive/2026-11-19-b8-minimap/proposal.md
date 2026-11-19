# Proposal

## Why

En una vuelta a 300 km/h no se ve la siguiente curva a tiempo. Un minimapa de anticipación, como el de Mario Kart, muestra dónde está el coche y qué forma tiene la pista inmediatamente por delante, para frenar y girar con margen.

## What Changes

- Minimapa circular en el HUD del host (PC), a la derecha, encima del panel de energía.
- Muestra solo un recorte de la pista por delante (≈350 m) y un poco por detrás (≈60 m), no el circuito completo.
- El mapa rota con el rumbo del coche: el coche es un punto fijo y su rumbo apunta siempre arriba.
- El tramo ya recorrido se dibuja tenue; las curvas fuertes se resaltan en otro color.
- En VR, el mismo minimapa en un plano pegado a la cámara, abajo a la derecha (simétrico al panel de VR).
- Cálculo puro de la polilínea local en `src/track` (con tests Vitest) y dibujo en canvas 2D en `src/host`.

Pertenece al HUD del bloque 4 de `context.md`, pero es una ampliación fuera de los bloques 1–6 originales, confirmada por el usuario.

## Capabilities

### New Capabilities
- `minimap`: minimapa de anticipación en el HUD del host, con la proyección local de la pista centrada en el coche.

### Modified Capabilities
<!-- Ninguna: race-hud no cambia sus requisitos. -->

## Impact

- Nuevos: `src/track/minimap.ts`, `src/host/minimap.ts`, `tests/minimap.path.test.ts`, `tests/e2e/b8_minimap.py`.
- Editados: `src/shared/config.ts` (bloque `minimap`), `index.html` (canvas), `src/host/hud.css`, `src/host/main.ts` (una llamada por fotograma); nuevo `src/host/vr/minimap.ts`.
- Sin cambios en el protocolo WS, el celular, el contenido del panel de VR, `src/sim` ni dependencias.

## Fuera de alcance

- Pantalla del celular y protocolo WS.
- Pista completa o vista cenital del circuito.
- Rivales, zoom dinámico con la velocidad y marcadores de frenada.
