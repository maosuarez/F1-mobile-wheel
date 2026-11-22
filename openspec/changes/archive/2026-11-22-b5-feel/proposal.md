# Proposal

## Why

Bloque 5 de `context.md`: con las mecánicas completas, falta que el juego transmita velocidad. El sonido del motor, las cámaras y la vibración del volante son lo que convierte los números de la simulación en sensaciones.

## What Changes

- Audio procedural del motor con Web Audio: tono ligado a las RPM (V6), timbre y volumen según el acelerador, turbo y viento, golpe seco al cambiar, modulación en el limitador. Arranca con el primer gesto, se silencia en pausa y con la tecla V.
- Tres cámaras conmutables con C o con el botón CAM del volante: persecución con resorte crítico, casco con balanceo por fuerzas g, y TV con cámaras fijas a lo largo del circuito.
- FOV dinámico de 70° a 84° con la velocidad y temblor de cámara en pianos, hierba y por encima de 250 km/h.
- Háptica: el PC emite eventos `fx` (cambio, piano, hierba, límites, limitador) hacia el volante a partir de los eventos de la simulación.

## Capabilities

### New Capabilities
- `engine-audio`: sonido procedural del motor y su ciclo de vida.
- `cameras`: modos de cámara, FOV dinámico y temblor.
- `haptic-feedback`: emisión de efectos de vibración desde el PC hacia el volante.

### Modified Capabilities

Ninguna.

## Impact

- Código nuevo en `src/audio/`, `src/render/cameras/` (sustituye a `src/render/chaseCamera.ts`), `src/host/net/fx.ts`; cambios en `src/host/main.ts`, teclado, `config.ts` y `DebugSnapshot`.
- Sin dependencias nuevas ni archivos de audio: todo se sintetiza.

**Fuera de alcance:** música, sonido ambiente, derrapes y golpes como muestras grabadas; repeticiones; sombras, posproceso, partículas y modelo detallado del coche (bloque 6).
