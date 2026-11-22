# Proposal

## Why

El usuario cambia Monza por un circuito nocturno. Bahréin (Sakhir) es carrera nocturna real, tiene CSV de TUMFTM y telemetría FastF1 2021–2022 accesible sin cuenta (verificado), así que reutiliza el pipeline de Spa sin riesgo de datos. Aporta lo que falta: noche con focos y un entorno de desierto.

## What Changes

- `TrackSpec` de Bahréin (TUMFTM `Sakhir.csv`, FastF1 "Bahrain" 2022/2021, trazado GP 5412 m, horario) y generación de `bahrain.json` / `bahrain.world.json`.
- Catálogo: `TrackInfo` añade `lighting` (`day`|`night`), `hdri` y `ground` (`grass`|`sand`); Bahréin en el selector.
- Iluminación nocturna: HDRI de noche, luz principal cenital que imita los focos, postes de luz emisivos con bloom, charcos de luz en el asfalto, ventanas encendidas en edificios.
- Suelo de desierto: terreno y escapatorias de hierba con textura de arena CC0 y sin árboles cuando `ground: 'sand'`.

Fuera de alcance: Monza, escala aerodinámica por circuito, anillo en desuso, lluvia, muros por tramo, cambios de física.

## Capabilities

### New Capabilities
- `night-lighting`: iluminación nocturna de circuitos.

### Modified Capabilities
- `track-data`: Bahréin con su trazado real.
- `track-catalog`: iluminación y suelo por circuito; Bahréin disponible.

## Impact

- Pipeline: `tools/track/tracks.py`, `overrides/bahrain.json`, `tools/assets/fetch_assets.py` (HDRI nocturno y arena); nuevos `public/track/bahrain.json`, `bahrain.world.json`, assets en `public/assets/`.
- Runtime: `src/shared/tracks.ts`, `src/render/night.ts` (nuevo), `src/render/{scene,world,mesh,post}.ts`, `src/host/main.ts`.
