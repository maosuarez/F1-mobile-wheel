# Proposal

## Why

El usuario quiere más circuitos con su trazado real. Singapur se descartó: FastF1 exige cuenta de F1 para la telemetría de 2023 en adelante y TUMFTM no lo incluye. Spa-Francorchamps sí tiene CSV de TUMFTM y telemetría de FastF1 2021–2022 accesible sin cuenta. Es el circuito más largo (≈ 7 km), con mucho desnivel (Eau Rouge/Raidillon) y bosque: pone a prueba el pipeline genérico de b1/b12/b13, el relieve y el presupuesto de rendimiento, y exige un selector de circuito.

## What Changes

- `TrackSpec` de Spa (TUMFTM `Spa.csv`, FastF1 "Belgian" 2022/2021, 7004 m, sentido horario, nombres de curvas).
- Generación de `spa.json` y `spa.world.json` con el pipeline existente (entorno real b12 con DEM y bosque; kit de borde b13 con grava y escapatorias de asfalto).
- Catálogo de circuitos (`src/shared/tracks.ts`) y selector de circuito en el menú (y `?track=`), en práctica, carrera, pantalla dividida y online.

Fuera de alcance: iluminación nocturna, muros por tramo, lluvia, coche de seguridad, Monza (b18), cambios de física.

## Capabilities

### New Capabilities
- `track-catalog`: catálogo y selección de circuitos.

### Modified Capabilities
- `track-data`: Spa-Francorchamps con su trazado real.

## Impact

- Pipeline: `tools/track/tracks.py`, `overrides/spa.json`; nuevos `public/track/spa.json`, `public/track/spa.world.json` (y terreno si el pipeline lo genera aparte).
- Runtime: `src/shared/tracks.ts` (nuevo), `src/host/race/menu.ts`, `src/host/online/*`, `src/host/main.ts`.
