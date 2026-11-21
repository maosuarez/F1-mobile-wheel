# Design

## Context

`build_track.py` ya cae a FastF1 con ancho constante 14 m si falta el CSV de TUMFTM. `runoff_m` es un escalar por circuito. `main.ts` carga `'interlagos'` fijo. La iluminación (sol, cúpula/HDRI, niebla, bloom) está en `config.light`/`config.sky`/`config.post` (b6, b13).

## Decisions

### D1. Spec del circuito
```py
"singapore": TrackSpec(id="singapore", name="Marina Bay Street Circuit", tumftm_csv="", fastf1_event="Singapore",
    years=(2025, 2024, 2023), official_length_m=4940.0, direction="ccw", corner_names={},
    bbox=(1.2830, 103.8520, 1.2990, 103.8680), lighting="night")
```
`years` excluye 2022 y anteriores (trazado antiguo). La dirección se verifica contra el sentido de avance de FastF1; si no coincide, el script falla con mensaje.

### D2. Línea central de FastF1 de mayor fidelidad
Cuando no hay CSV: se toman las `ff.centerline_laps` (10) vueltas más rápidas limpias de la sesión de carrera y clasificación, se remuestrean por fracción de distancia, se promedian punto a punto y se suaviza con el spline existente (`SMOOTH_RMS_M`). Se exige longitud dentro de ±1,5 % de `official_length_m`.

### D3. Anchos y muros por tramo
- Anchos: si OSM trae `width` en las vías `highway=raceway` del circuito, se proyecta por tramo; si no, `default_width_m` (12 m en Singapur). Overrides: `widths: [{s0, s1, w}]` en `overrides/<id>.json`, prevalecen.
- Muros: nuevo campo opcional en `track.json`: `walls?: { s0: number; s1: number; side: 'left'|'right'; m: number }[]` (distancia del borde de asfalto al muro). Por defecto `runoff_m`. Singapur: `runoff_m = 3`, y escapatorias amplias solo donde existan, declaradas en overrides.
- `Track` añade `wallOffL/R: Float32Array` por muestra; `query.ts` calcula `wallL/R = wl/wr + wallOff[i]`; `mesh.ts`/`trackside.ts` y la colisión de `car.ts` usan esos valores en lugar de `runoff`.

### D4. Catálogo de circuitos (`src/shared/tracks.ts`)
```ts
export interface TrackInfo { id: string; name: string; country: string; lighting: 'day' | 'night'; hdri: string; sunDir: [number, number, number]; laps: number }
export const TRACKS: TrackInfo[] = [ { id: 'interlagos', ... lighting: 'day', hdri: 'kloofendal_48d_partly_cloudy_puresky' }, { id: 'singapore', ... lighting: 'night', hdri: 'qwantani_night_puresky' } ];
```
El menú añade "Circuito" (recordado); `?track=<id>`; en online va en `cfg.track` y los clientes cargan ese circuito antes de la salida. `loadTrack`/`loadWorld` con el id elegido. Al cambiar de circuito se recarga la página con el parámetro (evita liberar recursos a mano).

### D5. Iluminación nocturna (`src/render/night.ts`)
`applyLighting(gs, info, track, world)`:
- HDRI de noche como fondo y entorno con `envIntensity` 0,25; niebla de color oscuro azulado `#0b1020`.
- Luz direccional única con sombras casi cenital (`[0.1, 1, 0.15]`), color `#f2f4ff`, intensidad 2,0: imita el conjunto de focos; la sombra sigue al coche como hoy.
- Hemisférica de relleno baja (`#1d2540` / `#0a0a0a`, 0,25).
- Postes de luz: instanciados cada `night.poleEveryM` (30 m) sobre el muro alternando lados, cabezal emisivo (`emissiveIntensity` 6) para el bloom; 2 draw calls.
- Charcos de luz: en modo noche `mesh.ts` multiplica el color de vértice del asfalto por `1 − night.poolDepth · (1 − cos²(π·dist_al_poste/poleEveryM))` (0,35), sin coste en GPU.
- Edificios: material con textura `CanvasTexture` de ventanas (rejilla 3 m × 3,2 m, 35 % encendidas, semilla fija) como `emissiveMap`.
- Noria: si OSM tiene `attraction=big_wheel`, se genera en `world.ts` (aro + radios + cabinas, diámetro `height` de OSM o 165 m) con aro emisivo; ≤ 2 draw calls.
- Post: `bloomStrength` 0,6 y `bloomThreshold` 0,8 en noche.
Presupuesto: la noche añade ≤ 6 draw calls.

### D6. Pipeline del entorno para ciudad
`build_world.py`: `marginM` por circuito (1200 en Singapur para el skyline), límite `maxBuildings` (2500) priorizando por altura × área y cercanía; simplificación de anillos (Douglas–Peucker 0,5 m); `world.json` < 3 MB. Escribe `landmarks: [{ kind: 'big_wheel'; x; y; z; diameter; yaw }]` (campo opcional nuevo en `WorldJson`, versión 1 compatible).

### D7. Kit de borde urbano
Heurísticas de b13 con `lighting`/tipo `street`: barreras por defecto `concrete` con valla, `tecpro` en el exterior de frenadas fuertes; escapatoria por defecto `asphalt` donde existe muro lejano, si no ninguna; pianos `flat`/`serrated`. Overrides de Singapur revisados por Fable con referencias públicas.

## Risks / Trade-offs

- La media de vueltas de FastF1 tiene error de ±1–2 m: aceptable con validación de longitud y PNG de control.
- OSM del centro de Singapur es denso: se limita y simplifica.
- La luz nocturna con una sola sombra es una aproximación; los charcos de luz dan la sensación de focos sin coste.
