# Proposal

## Why

Bloque 3 de `context.md`: el rasgo distintivo del juego es conducir con el celular como volante. Hace falta el canal PC↔celular, el emparejamiento por QR y la página del volante, verificables sin dispositivo físico.

## What Changes

- Relay WebSocket en FastAPI (`server/main.py`): salas host/volante, reenvío sin lógica de juego, avisos de presencia, latido y `/api/info`.
- Protocolo tipado y validado en `src/shared/protocol.ts`, con extensiones respecto a la skill: `in.rtt` y `tel.hold` (RTT real) y `tel.dbg` (sugerencia del piloto de referencia, solo en depuración).
- PC: sala, QR, cuenta atrás, volante como fuente de entrada, telemetría a 20 Hz, pausa y reanudación al perder y recuperar el volante. Teclado disponible con Enter.
- Celular (`/wheel/`): dirección por gravedad con filtro One Euro, pedales multitáctiles, levas, botones, pantalla de telemetría y vibración.
- `tools/fake_wheel.py` con cuatro guiones; `lap` sigue en lazo cerrado `tel.dbg`.
- Proxy de Vite, entrada `wheel/index.html`, modo WiFi opcional con HTTPS.

## Capabilities

### New Capabilities
- `wheel-relay`: servidor de salas y reenvío de mensajes.
- `wheel-protocol`: mensajes PC↔celular, validación, frecuencias y medida de latencia.
- `wheel-pairing`: sala, QR, cuenta atrás, toma de control y gestión de la pérdida del volante en el PC.
- `wheel-controller`: página del volante en el celular (dirección, controles, pantalla, vibración).
- `wheel-simulator`: volante simulado por línea de comandos para pruebas sin celular.

### Modified Capabilities

Ninguna.

## Impact

- Dependencias nuevas (requieren confirmación): pip `fastapi uvicorn[standard] websockets`; npm `qrcode @types/qrcode @vitejs/plugin-basic-ssl`.
- La validación con dispositivo real exige `adb` (hoy no instalado) y un Android: la hace el usuario.

**Fuera de alcance:** marchas, DRS y ERS reales (los eventos `up/down/drs` y `ers` se transportan pero no tienen efecto hasta el bloque 4); emisión de `fx` desde la simulación y cambio de cámara (bloque 5); iOS.
