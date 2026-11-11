## Why

Prueba real con el celular: hay demasiados botones (7) para pulsar en carrera, no hay forma de pasar a cambio automático con el volante (b8 lo dejó fijo en manual) y la vibración aparecía apagada ("VIB: NO") sin que el jugador supiera por qué. Retoque del bloque 3 (volante móvil).

## What Changes

- **Cambio automático también con el volante**: `autoShift` pasa a `true` con todas las fuentes. Las levas siguen funcionando como órdenes manuales, necesarias para punto muerto y marcha atrás. Sin conmutador, coherente con b8.
- **Interfaz compacta**: en carrera solo quedan visibles ERS (mantener) y DRS, grandes, en la columna izquierda entre la leva y el pedal de freno (el pulgar izquierdo queda libre al acelerar). El resto (CÁMARA, CENTRAR, PAUSA, REINICIAR, VIB) pasa a un panel de menú que se abre con un botón ☰ pequeño en la franja superior.
- **Vibración**: el botón VIB vive en el menú, y si el navegador no tiene `navigator.vibrate` se muestra "VIB: N/D" y el botón queda inactivo, para distinguir "apagada" de "no soportada". La preferencia se recuerda en `localStorage`.

Supuesto: se pretende automático siempre salvo N/R manuales (lo que se dijo al pedir quitar la opción y conservar neutro y reversa).

## Capabilities

### New Capabilities
- `wheel-ui`: distribución de controles del volante celular y menú secundario.

### Modified Capabilities
- `gearbox`: "Controles de marchas" (el volante pasa a automático).

## Impact

`src/host/main.ts` (`setSource`), `wheel/index.html`, `src/wheel/{controls.ts,main.ts,wheel.css,haptics.ts}`, `tests/e2e/b4_mechanics.py`, tests de wheel/haptics.

Fuera de alcance: rediseño visual del HUD de pantalla, cambiar el protocolo, mando PlayStation, validación con celular real aparte de lo ya aplazado.
