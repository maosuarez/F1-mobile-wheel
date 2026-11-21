# Proposal

## Why

La pista tiene trazado, anchos y elevación reales, pero el entorno es genérico (gradas en fila, árboles al azar, skyline de cilindros). Para que Interlagos sea creíble, el mundo que rodea al asfalto (terreno del "bowl", lago, boxes, gradas, bosques y barrio) debe estar donde está en la realidad. Fuera de los bloques 1–6 de context.md: primer change de la fase de realismo (opción A acordada con el usuario).

## What Changes

- Nuevo paso del pipeline `tools/track/build_world.py`: descarga OSM (Overpass) y terreno (teselas Terrarium PNG de AWS Open Data), los proyecta a metros locales, los alinea al `track.json` con la misma transformación que la línea central y escribe `public/track/<id>.world.json`.
- Terreno real alrededor del circuito, cosido a la altura de la pista en los bordes.
- Edificios (boxes, gradas, torres, barrio) extruidos con su huella y altura de OSM; lago y bosques como polígonos; calle de boxes como cinta de asfalto.
- Render: `src/track/world.ts` (carga/validación) y `src/render/world.ts` (mallas fusionadas por material); `environment.ts` usa el mundo real cuando existe y conserva el entorno procedural como respaldo.
- Imagen de control `out/<id>_world.png`.
- Sin dependencias nuevas (usa `requests`, `numpy`, `scipy`, `Pillow` ya instalados). Atribución ODbL de OpenStreetMap visible en el juego.

Fuera de alcance: barreras, pianos, líneas, grava y materiales fotoescaneados (b13); física (el muro de la simulación no cambia); Singapur y Monza (b17, b18), aunque el pipeline queda genérico por `--track`.

## Capabilities

### New Capabilities
- `track-world`: datos del entorno real del circuito (terreno, edificios, agua, bosque, calle de boxes) y su render.

### Modified Capabilities
- `visual-quality`: el requisito "Entorno" pasa a usar el mundo real cuando hay `world.json`.

## Impact

- Nuevos: `tools/track/build_world.py`, `tools/track/osm.py`, `tools/track/terrain.py`, `public/track/interlagos.world.json`, `src/track/world.ts`, `src/render/world.ts`, tests.
- Modificados: `src/render/environment.ts`, `src/render/scene.ts`, `src/host/main.ts` (carga), `src/shared/config.ts` (`world`), `tools/track/tracks.py` (bbox/OSM id), `index.html` (atribución).
- Red solo en el pipeline (caché en `tools/track/.cache/`); el juego no hace peticiones externas.
