## Why

Hoy no se puede reiniciar la carrera sin recargar la página; con el volante celular o los mandos VR el jugador no tiene el teclado a mano. Pertenece al bloque 4 (mecánicas) / 3 (volante) como retoque de control.

## What Changes

- Acción "reiniciar": `sim.reset()` (parrilla), se borran mejores sectores y se vuelve a la cuenta atrás (`startCountdown`), conservando sala, fuente de entrada y cámara.
- Volante celular: botón REINICIAR con pulsación sostenida (≈1 s) que envía `ev` `restart`; el protocolo añade `restart` a `EvKey`.
- Mandos VR: botón B (derecho) o Y (izquierdo), `buttons[5]`, con pulsación sostenida (≈1 s).
- Válido en `racing` y `paused` (pausa de usuario); ignorado en `pairing`, `loading`, `countdown` y `error`.

Supuesto: "el mando" = volante celular y mandos VR. Sin atajo de teclado (no pedido).

## Capabilities

### New Capabilities
- `game-restart`: reinicio de la carrera desde volante celular y mandos VR.

### Modified Capabilities
Ninguna (los changes b3 y b7 siguen sin archivar; se evita editar sus deltas).

## Impact

`src/shared/protocol.ts`, `src/shared/config.ts`, `src/host/main.ts`, `src/host/input/vrControllers.ts`, `wheel/index.html`, `src/wheel/controls.ts` y `main.ts`, `server/` (relay solo reenvía; verificar), tests unitarios y E2E.

Fuera de alcance: mando PlayStation (change aparte), confirmaciones en pantalla complejas, atajo de teclado.
