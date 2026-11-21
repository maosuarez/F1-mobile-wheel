# Design

## Context

`mesh.ts` ya dibuja líneas blancas de borde y pianos planos de 3 cm; la goma es una banda oscura centrada en la línea central (`surfaces.rubberWidthM`). El muro de la simulación está a `wl/wr + runoff_m` y `query.classify` devuelve `grass` en toda la escapatoria. Hay entorno real desde b12.

## Decisions

### D1. Extensión opcional de `track.json` (compatible hacia atrás)
```ts
samples.rl?: number[]                         // d de la trazada ideal (m, + izquierda), misma longitud N
kerbs[i].type?: 'flat' | 'serrated' | 'sausage'  // por defecto 'flat'
runoffs?: { s0: number; s1: number; side: 'left'|'right'; type: 'asphalt'|'gravel'|'grass' }[]   // por defecto grass
barriers?: { s0: number; s1: number; side: 'left'|'right'; type: 'tecpro'|'armco'|'concrete' }[] // por defecto armco
boards?: { s: number; side: 'left'|'right'; m: 150|100|50 }[]
```
`schema.ts` acepta su ausencia. `Track` añade `rl: Float64Array` (0 si falta) y tablas por muestra `runoffL/R: Uint8Array` (0 grass, 1 asphalt, 2 gravel) y `barrierL/R: Uint8Array` (0 armco, 1 tecpro, 2 concrete).

### D2. Trazada ideal (`tools/track/racing_line.py`)
`racing_line(x, z, wl, wr, margin=1.2) -> rl`: minimiza Σ curvatura² de la curva desplazada `p + rl·n` con `scipy.optimize.minimize` (L-BFGS-B, cotas `−wr+margin ≤ rl ≤ wl−margin`), 3 iteraciones de relinealización, suavizado final con ventana de 5 muestras. Debe dar una vuelta más corta en curvatura total que la línea central.

### D3. Heurísticas por defecto y overrides
- Escapatoria: en el exterior de las curvas (signo de k) con frenada previa > 80 km/h (perfil de velocidad de `autopilot` replicado en Python: `v = sqrt(μ g u / |k|)` limitada a 95 m/s) → `gravel`; en el interior de esas curvas y en los 60 m posteriores al vértice en el exterior → `asphalt`; resto → `grass`.
- Barreras: exterior de curvas con `gravel` → `tecpro`; recta principal y calle de boxes → `concrete`; resto → `armco`.
- Pianos: exterior en la salida → `sausage` solo en los últimos 10 m del piano si `|k| > 0,02`; interior de curvas lentas (`|k| > 0,03`) → `serrated`; resto `flat`.
- Carteles: 150/100/50 m antes del inicio de frenada de cada curva con caída de velocidad > 80 km/h, en el lado exterior.
- `apply_overrides` existente se extiende: las claves `runoffs`, `barriers`, `kerb_types` (índice → tipo) y `boards` del override sustituyen por completo a la heurística en los tramos que solapan. Fable completa `tools/track/overrides/interlagos.json` contrastando con referencias públicas antes de cerrar.

### D4. Superficies nuevas en la simulación
`Surface = 'asphalt' | 'kerb' | 'grass' | 'gravel' | 'runoff'`. `config.surface.gravel = { mu: 0.4, rolling: 14 }`, `config.surface.runoff = { mu: 0.95, rolling: 1 }`. `classify`: fuera del asfalto y del piano, según `runoffL/R[i]`: 0 → grass, 1 → runoff, 2 → gravel. Los límites de pista no cambian (siguen dependiendo de `d`). Háptica y temblor de cámara: `gravel` se trata como `grass` (sin cambiar el protocolo); `runoff` como asfalto. Partículas: `gravel` emite polvo con `dirtColor` `#9a8c74`.

### D5. Mallas de borde (`src/render/trackside.ts`)
```ts
export function buildTrackside(track: Track, mats: TracksideMaterials, quality: QualitySettings): THREE.Group
```
- Pianos: se sustituye el quad plano de `mesh.ts` por perfil según tipo: `flat` 3 cm; `serrated` dientes de 5 cm cada 1 m; `sausage` cilindro amarillo 0,15 m de alto, 0,3 m de ancho, por fuera del piano. Colores rojo/blanco alternos cada 2 m (salchicha amarilla).
- Escapatoria: `grassChunk` usa el material de asfalto, grava o hierba según `runoffL/R` (geometría separada por material, fusionada → 3 draw calls).
- Barreras sustituyen al muro actual en la misma posición: `tecpro` (bloques rojos/azules alternos 1,2 m de alto, 1 m de ancho), `armco` (doble ola gris metálica 0,75 m sobre postes), `concrete` (muro 1,0 m con textura de hormigón). Valla de retención (2,5 m, malla con textura alfa) detrás de `tecpro` y `concrete`. Una malla fusionada por tipo.
- Carteles: placas instanciadas 1,2 × 0,9 m con "150", "100", "50" en un atlas `CanvasTexture`.
- Comisarios: caseta simple instanciada cada 250 m en el exterior alterno.
- Boxes: línea blanca de entrada y salida si hay `pitlane` en el mundo de b12.
- Marcas de frenada: franjas oscuras finas antes de cada cartel de 100 m (decal en vértices del asfalto, sin draw call extra).
Presupuesto: ≤ 15 draw calls añadidos; el muro antiguo (1 draw call por trozo) desaparece.

### D6. Goma en la trazada
En `roadChunk`, la banda oscura se centra en `rl[i]` en vez de en 0, ancho `rubberWidthM` = 2,2, y se oscurece más en zonas de frenada (`k` alto) con `rubberDarken` hasta 0,22.

### D7. Materiales CC0 y HDRI
`tools/assets/fetch_assets.py` descarga de la API de Poly Haven (`https://api.polyhaven.com/files/<id>`) el JPG de Diffuse, `nor_gl` y Rough a la resolución indicada y escribe `public/assets/manifest.json` con id, licencia CC0 y URL de origen:

| Uso | id | res |
|---|---|---|
| Asfalto de pista | `asphalt_track` | 2k |
| Calle de boxes / escapatoria de asfalto | `asphalt_pit_lane` | 1k |
| Hierba | `leafy_grass` | 1k |
| Grava | `gravel_floor` | 1k |
| Hormigón | `brushed_concrete` | 1k |
| Cielo (HDRI) | `kloofendal_48d_partly_cloudy_puresky` | 2k `.hdr` |

`trackMaterials.ts` carga con `THREE.TextureLoader` (sRGB para Diffuse, lineal para normal y rugosidad), `RepeatWrapping`, anisotropía máxima ≤ 8, tamaño de mosaico `surfaces.uvMeters`. El color por vértice actual (variación, goma) se conserva multiplicando. Respaldo: si una textura falla, se usa la procedural de b6 sin error. Perfil `software` de calidad: texturas 1k y sin normal maps. El HDRI se carga con `RGBELoader` y sustituye la cúpula como `scene.environment` (PMREM) y como fondo; el sol direccional se orienta para coincidir con el sol del HDRI (`light.sunDir` ajustado en config). La niebla toma el color del horizonte del HDRI.

### D8. Constantes nuevas
`config.trackside = { kerbStripeM: 2, serratedToothM: 1, serratedH: 0.05, sausageH: 0.15, sausageW: 0.3, tecproH: 1.2, armcoH: 0.75, concreteH: 1.0, fenceH: 2.5, marshalEveryM: 250, boardW: 1.2, boardH: 0.9 }`, `config.assets = { base: '/assets/', anisotropy: 8 }`.

## Risks / Trade-offs

- La heurística no reproduce exactamente cada escapatoria real: se corrige con overrides revisados por Fable.
- +15 MB de assets: aceptable para despliegue local o Docker; carga en paralelo con la pista.
- `gravel` cambia la sensación: los tests de física cubren que no atrapa el coche (se puede salir a ≥ 20 km/h).
