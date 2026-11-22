# Design

## Context

`ShakeDetector.update(ax, ay, az, tMs, withGravity)` (`src/wheel/shake.ts`) toma el eje de mayor módulo de cada muestra y devuelve `active` durante `freezeMs` tras cualquier pico; `src/wheel/main.ts` no actualiza `steer` mientras `active`. La dirección sale del ángulo de la gravedad en el plano X/Y de la pantalla (`tiltDeg`).

## Decisions

### D1. Solo eje Z
- Firma nueva: `update(az: number, tMs: number, gz?: number): { shake: boolean }`. `az` es `DeviceMotionEvent.acceleration.z`. Si `acceleration` es null, `main.ts` pasa `accelerationIncludingGravity.z` en `gz` y la clase estima la gravedad de Z con paso bajo α = 0,1 y la resta (en ese caso `az` se ignora). Rotar en el plano de la pantalla deja `gz` casi constante, así que el residuo no genera picos.
- Misma lógica de picos alternos, ventana y enfriamiento que antes.
- Alternativa descartada: mantener todos los ejes y subir el umbral; no distingue un giro brusco de una sacudida.

### D2. Sin congelado
- Se elimina `active` y `config.wheel.shake.freezeMs`. `main.ts` asigna `steer = r.steer` en cada muestra, como antes de b20.
- `shakeAction` no cambia.

### D3. Ganchos de debug
- `window.__wheel.injectMotion(ax, ay, az, gx, gy, tMs)` mantiene su firma (ax y ay se ignoran para la sacudida, gx y gy siguen alimentando la dirección) para no romper los E2E. Los E2E que inyectan picos en X/Y para disparar sacudidas deben pasarlos a Z.

## Risks / Trade-offs

- [El gesto cambia: hay que empujar y tirar, no agitar de lado a lado] → Más natural sujetando el celular como volante. Se valida con dispositivo real.
- [Baches fuertes en el coche real del jugador (p. ej. en un vehículo)] → No aplica: el celular se usa quieto en la mano.
