# Design

## Context

Pipeline genérico por `TrackSpec` (b1/b12/b13), validado con Spa en b17. FastF1 sin cuenta solo entrega ≤ 2022. El catálogo `src/shared/tracks.ts` (b17) tiene `{ id, name, country }` y el selector recarga con `?track=`. La luz (sol, HDRI, niebla, bloom) vive en `config.light`/`config.sky`/`config.post`/`config.assets.hdriId` (b6, b13), iguales para todos los circuitos.

## Decisions

### D1. Spec del circuito
```py
"bahrain": TrackSpec(id="bahrain", name="Bahrain International Circuit", tumftm_csv="Sakhir.csv", fastf1_event="Bahrain",
    years=(2022, 2021), official_length_m=5412.0, direction="cw", corner_names={},
    bbox=(26.020, 50.500, 26.045, 50.525), lighting="night")
```
`TrackSpec` añade `osm_raceway_names: tuple[str, ...] = ()`; si no está vacío, `raceway_pieces` solo encadena vías `highway=raceway` con ese `name` (Bahréin: `("Grand Prix Circuit",)`, porque el bbox contiene también los trazados Outer, Endurance, Inner, Paddock y el óvalo). Vacío = comportamiento actual.

Curvatura: las horquillas de las curvas 1 y 10 dan |k| hasta 0,137 en la línea central de TUMFTM, por encima del límite del validador (0,12), con riesgo de que el borde interior se pliegue. `build_track.py` aplica un suavizado local iterativo de la línea central solo en las muestras con |k| > 0,12 (mezcla 50 % muestra / 50 % media de ±3 muestras, hasta que |k| ≤ 0,12 o 50 iteraciones; el promedio puro no converge) antes de recalcular longitudes; no actúa si no hay picos, así que Interlagos y Spa no cambian. El límite del validador no se toca.

El worker comprueba que la vía OSM `highway=raceway` del trazado GP cabe en el bbox con margen (si no, lo amplía) y que el CSV de TUMFTM corresponde al trazado GP (longitud dentro de la tolerancia del validador). Si TUMFTM no coincide, se detiene y lo reporta.

### D2. Catálogo
```ts
export interface TrackInfo { id: string; name: string; country: string;
  lighting: 'day' | 'night'; hdri: string; ground: 'grass' | 'sand' }
```
Interlagos y Spa: `day`, `kloofendal_48d_partly_cloudy_puresky`, `grass`. Bahréin: `night`, HDRI nocturno (D3), `sand`. `main.ts` pasa el `TrackInfo` a la creación de escena; sin cambios de comportamiento para circuitos `day`.

### D3. Assets
`fetch_assets.py` añade un HDRI nocturno de cielo puro (1k) y una textura de arena (1k, Diffuse/nor_gl/Rough), ambos CC0 de Poly Haven, con ids comprobados contra su API (candidatos: `qwantani_night_puresky` o `satara_night_no_lamps`; `coast_sand_01` o `aerial_beach_01`). Se respeta `MAX_BYTES` y el manifiesto.

### D4. Iluminación nocturna (`src/render/night.ts`)
`applyNight(gs, info, track)` solo si `info.lighting === 'night'`:
- HDRI nocturno como fondo y entorno con `envIntensity` 0,25; niebla `#0b1020`.
- Luz direccional única con sombras casi cenital (`[0.1, 1, 0.15]`), `#f2f4ff`, intensidad 2,0; la sombra sigue al coche como hoy.
- Hemisférica de relleno `#1d2540` / `#0a0a0a`, 0,25.
- Postes de luz instanciados cada `night.poleEveryM` (30 m) junto a la barrera, alternando lados; cabezal emisivo (`emissiveIntensity` 6) para el bloom; 2 draw calls.
- Charcos de luz: en noche `mesh.ts` multiplica el color de vértice del asfalto por `1 − night.poolDepth · (1 − cos²(π·d/poleEveryM))`, `poolDepth` 0,35, `d` = distancia en `s` al poste más cercano; sin coste en GPU.
- Edificios: `emissiveMap` con `CanvasTexture` de ventanas (rejilla 3 m × 3,2 m, 35 % encendidas, semilla fija).
- Post: `bloomStrength` 0,6, `bloomThreshold` 0,8.
Presupuesto: la noche añade ≤ 6 draw calls. Constantes en `config.night`.

### D5. Suelo de desierto
Con `ground: 'sand'`: el material de terreno y el de escapatoria de hierba usan la textura de arena; densidad de árboles 0; el color de talud (`STEEP_COLOR`) pasa a un tono roca `#a08060`. Las escapatorias del borde siguen siendo las de b13 (Bahréin: asfalto amplio; overrides revisados por Fable con los PNG).

## Risks / Trade-offs

- Una sola sombra para la noche es una aproximación; los charcos de luz dan la sensación de focos sin coste.
- Si el CSV `Sakhir.csv` no es el trazado GP, hay que buscar otra fuente: se detecta en la tarea 1.1.
