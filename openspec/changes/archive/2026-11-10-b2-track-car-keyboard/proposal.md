# Proposal

## Why

Bloque 2 de `context.md`: convertir `interlagos.json` en un juego jugable con teclado, con una vuelta completa cronometrada y la física verificada por tests. 

## What Changes

- `src/track/`: carga del JSON a arrays tipados, consultas `(s, d)` puras, pistas sintéticas para tests y mallas (asfalto, líneas, pianos, hierba, muros, meta).
- `src/sim/`: simulación determinista a paso fijo de 1/120 s con aerodinámica, agarre dependiente de la carga, círculo de fricción, dirección sensible a la velocidad, superficies, pendientes y muros. Tren motriz provisional de potencia constante (sin marchas).
- Cronometraje: vueltas, tres sectores, mejor vuelta y delta en vivo.
- Piloto de referencia determinista (`autopilot`) para demostrar por máquina que la vuelta es completable.
- `src/host/` y `src/render/`: arranque, bucle con interpolación, teclado, HUD mínimo, cámara de seguimiento básica, coche procedural provisional, panel `F3`, pausa y API de depuración para pruebas automáticas.
- `src/shared/config.ts` con todas las constantes ajustables.

## Capabilities

### New Capabilities
- `track-runtime`: carga del circuito, consultas de posición/superficie/zonas y mallas de pista.
- `vehicle-dynamics`: comportamiento físico del coche (aceleración, frenada, giro, superficies, pendientes, muros, determinismo).
- `lap-timing`: vueltas, sectores, mejor vuelta, delta y persistencia.
- `reference-driver`: piloto automático de referencia usado como prueba de completabilidad y como guía para el volante simulado.
- `game-shell`: arranque, bucle, entrada por teclado, HUD mínimo, pausa, depuración y presupuesto de render.

### Modified Capabilities

Ninguna.

## Impact

- Dependencia pip nueva (requiere confirmación): `playwright` (comprobación `webapp-testing`).
- Código nuevo en `src/shared`, `src/track`, `src/sim`, `src/render`, `src/host`, `tests/`, `index.html`, `vite.config.ts`.

**Fuera de alcance:** volante, relay y QR (bloque 3); marchas, RPM, DRS, ERS, invalidación por límites y HUD completo (bloque 4); audio, cámaras de casco/TV, FOV dinámico, háptica (bloque 5); sombras, posproceso, entorno y coche detallado (bloque 6).
