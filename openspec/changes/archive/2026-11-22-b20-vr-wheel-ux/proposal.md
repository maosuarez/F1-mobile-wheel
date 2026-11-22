# Proposal

## Why

En VR el HUD flotante tapa la vista en primera persona y no muestra la información de carrera multijugador; el volante del celular reserva espacio para datos que con el visor nunca se ven, centrar está escondido en un menú, y los botones DRS/ERS le quitan sitio al freno. Arreglos de UX sobre el bloque 3 (volante), el bloque 4 (DRS/ERS) y b7/b9 (VR) de context.md.

## What Changes

- **BREAKING** (volante): se quitan los botones DRS y ERS. Agitar el celular en recta abre el DRS si está listo; si no, activa o desactiva el modo adelantamiento ERS (que se apaga solo al frenar). El freno ocupa el espacio liberado.
- Instrumentos en el volante 3D: en VR con cámara de casco, la pantalla del volante del habitáculo muestra velocidad, marcha, tiempo de vuelta, delta, DRS y ERS.
- El panel flotante en VR pasa a ser un panel de carrera: posición, vuelta, diferencias y torre (incluye rivales humanos online e IA). En práctica con cámara de casco no se muestra.
- Volante en modo VR: si el PC está en VR, el celular oculta la telemetría y muestra botones grandes (CÁMARA, CENTRAR, PAUSA, REINICIAR) siempre visibles.
- Calibración antes de la salida en VR: antes del semáforo o de la cuenta atrás, el celular muestra a pantalla completa "CALIBRAR"; al tocarla se centra el volante y empieza la salida. En online no bloquea la salida.

Fuera de alcance: menú, acceso al volante desde el celular y QR online (`b19-menu-phone`); controles de teclado, mando y mandos de Quest (siguen igual).

## Capabilities

### New Capabilities
- `vr-cockpit-hud`: instrumentos en el volante 3D, panel de carrera en VR y calibración antes de la salida.

### Modified Capabilities
- `wheel-ui`: controles mínimos sin DRS/ERS, gesto de agitar, modo VR del volante y pantalla de calibración.
- `drs`: el volante abre el DRS agitando en lugar de con un botón.
- `ers`: el volante alterna el adelantamiento agitando en lugar de mantener un botón.
- `vr-quest-controls`: se elimina la restricción de que el HUD de carrera en VR no cambie.

## Impact

`src/wheel/*`, `wheel/index.html`, `src/shared/protocol.ts` (campos opcionales `vr` y `cal` en `tel`), `src/shared/config.ts`, `src/host/main.ts`, `src/host/vr/*`, `src/render/car.ts` y un módulo nuevo para la pantalla del volante 3D. Tests Vitest de protocolo, volante y panel VR, más un E2E nuevo. Sin dependencias nuevas.
