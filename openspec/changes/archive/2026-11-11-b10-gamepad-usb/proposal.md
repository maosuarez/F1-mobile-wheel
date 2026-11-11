## Why

Permitir conducir con un mando PlayStation (DualShock 4 / DualSense) conectado por cable USB, sin celular ni visor. Es opcional y va después de b8 y b9. Bloque 3/4 (entradas).

## What Changes

- Nueva fuente de entrada `gamepad` basada en la Gamepad API del navegador (mapeo `standard`, sin dependencias).
- Mapeo: stick izquierdo X = dirección; R2 = acelerador; L2 = freno; R1/L1 = subir/bajar marcha; Cuadrado = DRS; Círculo = ERS (mantener); Triángulo = cámara; Options = pausa; Share (mantener 1 s) = reiniciar (usa `holdDetector` de b9); Cruz = recolocar.
- Modo de cambio fijo: automático (como teclado y VR).
- Prioridad de fuentes: volante celular > mandos VR > gamepad > teclado.
- Vibración opcional por `vibrationActuator` en pianos/hierba/limitador, si el navegador la soporta.

## Capabilities

### New Capabilities
- `gamepad-input`: conducción con mando PlayStation por USB.

### Modified Capabilities
Ninguna.

## Impact

`src/host/input/gamepad.ts`, `src/host/input/gamepadMap.ts` (mapeo puro), `src/host/input/types.ts` (nombre `gamepad`), `src/host/main.ts`, `src/shared/config.ts` (grupo `gamepad`), tests. Depende de b9 (`holdDetector`, `restartRace`).

Fuera de alcance: conexión Bluetooth garantizada, giroscopio, luces del DualSense, rebind de botones, adaptive triggers.
