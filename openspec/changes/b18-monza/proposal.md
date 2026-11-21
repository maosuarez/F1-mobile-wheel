# Proposal

## Why

Tercer circuito pedido por el usuario: Monza con su trazado real. Es el "templo de la velocidad": rectas largas, chicanes con pianos agresivos, el parque arbolado y el viejo anillo peraltado. Se necesita también la configuración de baja carga que llevan los coches allí para que se sienta como Monza.

## What Changes

- Generar `monza.json` (TUMFTM + FastF1; la spec ya existe en `tools/track/tracks.py`) con nombres de curvas, bbox y overrides de escapatorias, pianos (salchichas en las chicanes) y barreras.
- Entorno real (b12): bosque del parque, tribunas, boxes y el antiguo anillo de alta velocidad como pista en desuso (`landmark` `disused_track`).
- Configuración aerodinámica por circuito en el catálogo (`aero: { cdaScale, claScale }`); Monza en baja carga.
- Añadir Monza al catálogo y al selector.

Fuera de alcance: más circuitos, reglajes elegidos por el jugador, cambios de modelo de física más allá de la escala aerodinámica.

## Capabilities

### New Capabilities
(ninguna)

### Modified Capabilities
- `track-catalog`: Monza disponible y escala aerodinámica por circuito.

## Impact

- `tools/track/tracks.py`, `overrides/monza.json`, `build_world.py` (`disused_track`), nuevos `public/track/monza.json` y `monza.world.json`.
- `src/shared/tracks.ts`, `src/sim/simulation.ts` (escala aerodinámica), `src/sim/autopilot.ts`/`rival.ts` (perfil con la misma escala), `src/track/world.ts`, `src/render/world.ts`.
