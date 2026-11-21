# Design

## Context

`build_track.py` alinea TUMFTM ↔ FastF1 con `align_2d` (Umeyama) y escribe coordenadas locales (x, z, y) en metros. No hay georreferencia guardada. El render construye `environment.ts` (gradas instanciadas, árboles, skyline) a partir solo de la línea central.

## Goals / Non-Goals

Goals: entorno en posiciones reales, coherente con la pista, dentro del presupuesto (< 200 draw calls totales, 60 fps). Non-Goals: colisión con el entorno, fotogrametría, detalles de borde de pista (b13).

## Decisions

### D1. Archivo aparte `public/track/<id>.world.json`
`track.json` y su esquema no cambian. Formato (todas las coordenadas ya en el marco de la pista, metros, y = altura en el mismo origen que `samples.y`):
```ts
interface WorldJson {
  id: string; version: 1;
  attribution: string;                          // "© OpenStreetMap contributors (ODbL)"
  terrain: { x0: number; z0: number; cell: number; nx: number; nz: number; h: number[] };  // h fila mayor (z), nx*nz, dm enteros → h/10 m
  buildings: { kind: 'pit'|'grandstand'|'tower'|'generic'; h: number; y: number; ring: number[] }[];  // ring = [x0,z0,x1,z1,...] CCW, sin repetir el primero; y = base
  water: { ring: number[]; y: number }[];
  forest: { ring: number[] }[];
  pitlane: { pts: number[]; w: number } | null;  // polilínea [x,y,z,...] y ancho m
}
```
Tamaño objetivo < 1,5 MB.

### D2. Fuentes sin dependencias nuevas
- OSM: Overpass `https://overpass-api.de/api/interpreter`, una consulta por bbox (circuito + `world.marginM`), con `requests`, User-Agent genérico `f1-game-track-pipeline`. Respuesta cacheada en `tools/track/.cache/osm/<id>.json`.
- Terreno: teselas Terrarium `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, zoom 14, decodificadas con Pillow: `h = R*256 + G + B/256 − 32768`. Caché en `tools/track/.cache/terrain/`.
- Proyección: equirectangular local centrada en el centroide del bbox (`x = R·Δλ·cos φ0`, `z = −R·Δφ`); error < 0,1 % en 3 km, suficiente.

### D3. Alineación con la pista
Se toman las vías OSM `highway=raceway` del circuito principal (la más larga cerrada, o la unión de segmentos que mejor cubre el trazado), se remuestrean y se alinean con `align_2d` contra la línea central de `track.json` (x, z). Se exige RMS ≤ `world.alignMaxRmsM` (8 m); si no, el script termina con código 2 y mensaje claro. La transformación resultante (escala, rotación, traslación) se aplica a todo lo demás.

### D4. Altura del terreno coherente con la pista
`offset = mediana(track.y − dem(x,z))` en la línea central. Luego, para cada celda a distancia `dist` del borde (wl/wr + runoff) de la muestra más cercana: `dist ≤ 0` → altura de pista − `world.terrainSinkM` (0,3, queda bajo la hierba de la pista); `0 < dist < blendM` (40) → mezcla suavizada (smoothstep) entre pista y DEM; si no, DEM. Celda `world.cellM` = 10 m. La mezcla va de `cellM` a `blendM` para que a más de 40 m el relieve sea exactamente el DEM. Donde se solapan las zonas de muros de dos tramos a distinta altura (cruces cercanos), la celda toma la altura del tramo más bajo − `terrainSinkM`: el terreno nunca asoma por encima de una pista; bajo el tramo alto puede quedar más hundido (lo tapan su hierba y sus barreras).

### D5. Clasificación OSM
- `building=grandstand` o `leisure=stadium`+`building` → `grandstand`; `building` dentro de 60 m de la calle de boxes → `pit`; `building` con altura ≥ 25 m → `tower`; resto → `generic`.
- Altura: `height` > `building:levels`·3,2 > por defecto (`pit` 9, `grandstand` 14, `generic` 7).
- `natural=water`/`water=*` → water; `landuse=forest`/`natural=wood` → forest; `highway=raceway` + `service=pit_lane` o `name~pit` → pitlane.
- Se descartan edificios a < `world.clearM` (6 m) del borde del muro de la simulación, polígonos degenerados y `generic` < 40 m². Excepción: las gradas (`grandstand`) que invaden esa franja se trasladan hacia fuera, a lo largo de la normal exterior de la muestra más cercana, la penetración máxima + `world.grandstandClearM` (2 m); así se conservan (el `runoff_m` global de 18 m sobrestima la escapatoria de la recta, se afinará con muros por tramo en b17).

### D6. Render y presupuesto
`src/render/world.ts`:
```ts
export function buildWorld(world: World, track: Track, mats: WorldMaterials, settings: Pick<QualitySettings,'trees'>): THREE.Group
```
- Terreno: 1 malla (o `world.terrainChunks` = 4 trozos para frustum culling), material de hierba existente con color por vértice según pendiente.
- Edificios: extrusión propia (paredes + tapa triangulada con `THREE.ShapeUtils.triangulateShape`), fusionados por tipo → ≤ 4 draw calls. Gradas con la textura de público existente en la cara que mira a la pista.
- Agua: 1 malla, material oscuro y liso (roughness 0.1).
- Bosque: árboles instanciados existentes, posiciones muestreadas dentro de los polígonos y a ≥ 3 m por fuera del muro (semilla fija, densidad `world.treesPerHa`), recortadas al límite `settings.trees`.
- Calle de boxes: cinta con el material de asfalto.
Total añadido ≤ 12 draw calls. `environment.ts`: si hay mundo, no construye `skyline` ni `stands` procedurales.

### D7. Carga en el juego
`loadWorld(id): Promise<World | null>` en `src/track/world.ts`: 404 → `null` (respaldo procedural), JSON inválido → error en consola y `null`. Validación ligera (tipos, longitudes de `h` = nx·nz, anillos pares ≥ 6). Atribución en una línea pequeña del menú de inicio.

### D8. Constantes (`src/shared/config.ts`, grupo `world`)
`{ treesPerHa: 120, terrainChunks: 4, waterColor: '#26404a', buildingColors: { pit: '#d9d9d4', grandstand: '#8c9096', tower: '#b7b2a8', generic: '#c9bfae' } }`. Las del pipeline (`marginM: 600`, `cellM: 10`, `blendM: 40`, `terrainSinkM: 0.3`, `clearM: 6`, `grandstandClearM: 2`, `alignMaxRmsM: 8`, `tileZoom: 14`) viven en `tools/track/tracks.py` como `WORLD_DEFAULTS`.

### D9. Cámaras y relieve
El relieve real (el "bowl" de Interlagos) puede tapar la cámara de TV de b5, que solo conoce la pista. Las cámaras exteriores consultan `terrainHeight` y se elevan o saltan a la siguiente cámara de TV si el terreno corta la línea de visión (tarea 2.4). `config.world.cameraClearM = 2`.

## Risks / Trade-offs

- OSM de Interlagos incompleto o con alturas ausentes → valores por defecto; aceptable.
- Overpass caído → se usa la caché; si no existe, error claro (no se rompe `track.json`).
- Terrarium a z14 (~9 m/px) suaviza taludes; la mezcla con la pista evita escalones.
