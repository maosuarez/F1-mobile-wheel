# Proposal

## Why

El usuario quiere más circuitos con su trazado real; Singapur (Marina Bay) sustituye a Jeddah. Es un circuito urbano y nocturno: muros cerca, rascacielos y luz artificial. Pone a prueba el pipeline genérico de b1/b12/b13 y requiere selección de circuito e iluminación nocturna.

## What Changes

- `TrackSpec` de Singapur con el trazado de 2023 en adelante (4,94 km, 19 curvas, sin la sección del Bay Grandstand), sentido antihorario.
- Línea central desde FastF1 (no hay CSV de TUMFTM): media de varias vueltas rápidas, suavizada; anchos desde la etiqueta `width` de OSM o ajustes manuales por tramo.
- Distancia al muro por tramo (`walls`), necesaria en un circuito urbano; la constante `runoff_m` queda como valor por defecto.
- Catálogo de circuitos (`src/shared/tracks.ts`) y selector de circuito en el menú (y `?track=`), también para la carrera online.
- Iluminación nocturna: HDRI de noche, luz principal cenital que imita los focos, postes de luz emisivos con bloom, zonas de luz en el asfalto, ventanas iluminadas en los edificios y la noria de Marina Bay generada a partir de OSM.
- Entorno real (b12) con los rascacielos y el agua de la bahía, y kit de borde (b13) con muros de hormigón, vallas y escapatorias casi nulas.

Fuera de alcance: lluvia, coche de seguridad, Monza (b18), cambios de física.

## Capabilities

### New Capabilities
- `track-catalog`: catálogo y selección de circuitos.
- `night-lighting`: iluminación nocturna de circuitos.

### Modified Capabilities
- `track-data`: anchos y muros por tramo, línea central desde FastF1 de mayor fidelidad.
- `track-runtime`: distancia al muro por muestra.

## Impact

- Pipeline: `tools/track/tracks.py`, `build_track.py`, `build_world.py` (noria, alturas de edificios, límite de número), `overrides/singapore.json`; nuevos `public/track/singapore.json`, `singapore.world.json`, `public/assets/qwantani_night_puresky/`.
- Runtime: `src/shared/tracks.ts`, `src/track/{types,schema,track,query}.ts`, `src/render/{scene,world,trackside,post}.ts`, `src/render/night.ts` (nuevo), `src/host/race/menu.ts`, `src/host/online/*`, `src/host/main.ts`.
