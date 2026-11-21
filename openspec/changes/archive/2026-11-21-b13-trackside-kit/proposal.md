# Proposal

## Why

Desde la cámara de casco, la credibilidad depende de lo que hay a ras de suelo: pianos con su relieve, escapatorias de asfalto o grava, barreras de verdad, carteles de frenada, la goma en la trazada y materiales fotoescaneados con un cielo real. Hoy hay un muro gris continuo, hierba en toda la escapatoria y texturas de ruido. Fase de realismo, parte 2 (opciones B + C acordadas); fuera de los bloques 1–6 de context.md.

## What Changes

- Pipeline: línea de trazada ideal (curvatura mínima) como columna opcional `rl` en `samples`; tramos de escapatoria (`runoffs`), tipos de barrera (`barriers`) y tipo de piano (`kerbs[].type`), generados por heurística y corregibles en `tools/track/overrides/<id>.json`.
- Simulación: superficies nuevas `gravel` (frena mucho y agarra poco) y `runoff` (escapatoria de asfalto).
- Render: perfil real de pianos (plano, dentado, salchicha), barreras por tipo (Tecpro, guardarraíl, hormigón) en la posición del muro de la simulación, valla de retención, carteles de 150/100/50 m, puestos de comisarios, líneas de boxes, goma que sigue la trazada ideal y marcas de frenada.
- Materiales CC0 de Poly Haven (asfalto de circuito, calle de boxes, hierba, grava, hormigón) y cielo HDRI real, descargados por script y versionados en `public/assets/`.

Fuera de alcance: rivales y uso de la trazada por la IA (b14), Singapur y Monza (b17, b18), iluminación nocturna.

## Capabilities

### New Capabilities
- `trackside`: elementos de borde de pista y materiales fotoescaneados.

### Modified Capabilities
- `track-data`: columnas y campos opcionales nuevos en `track.json`.
- `track-runtime`: clasificación de superficie con grava y escapatoria de asfalto.
- `vehicle-dynamics`: parámetros de las superficies nuevas.
- `visual-quality`: superficies de pista con materiales fotoescaneados y goma en la trazada.

## Impact

- Pipeline: `tools/track/build_track.py`, `tools/track/racing_line.py` (nuevo), `tools/track/overrides/interlagos.json`, `tools/assets/fetch_assets.py` (nuevo).
- Runtime: `src/track/{types,schema,track,query,mesh}.ts`, `src/sim/car.ts`, `src/render/{trackMaterials,scene,particles}.ts`, `src/render/trackside.ts` (nuevo), `src/host/net/fx.ts`, `src/render/cameras/math.ts`, `src/shared/config.ts`.
- Repositorio: ~15 MB de texturas y HDRI CC0. Sin dependencias npm ni pip nuevas (`RGBELoader` viene con three).
