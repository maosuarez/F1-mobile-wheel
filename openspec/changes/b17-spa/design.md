# Design

## Context

El pipeline (`build_track.py`, `build_world.py`, `validate_track.py`) es genérico por `TrackSpec`: TUMFTM para línea central y anchos, FastF1 para alineación, sectores, DRS y curvas, OSM + DEM para el entorno (b12), heurísticas y overrides para el borde (b13). FastF1 sin cuenta de F1 solo entrega sesiones ≤ 2022 (verificado). `main.ts` carga `'interlagos'` fijo.

## Decisions

### D1. Spec del circuito
```py
"spa": TrackSpec(id="spa", name="Circuit de Spa-Francorchamps", tumftm_csv="Spa.csv", fastf1_event="Belgian",
    years=(2022, 2021), official_length_m=7004.0, direction="cw",
    corner_names={1: "La Source", 2: "Eau Rouge", 3: "Raidillon", 4: "Raidillon", 5: "Les Combes",
                  6: "Les Combes", 7: "Malmedy", 8: "Bruxelles", 10: "Pouhon", 11: "Pouhon",
                  12: "Fagnes", 13: "Fagnes", 15: "Stavelot", 17: "Blanchimont", 18: "Chicane", 19: "Chicane"},
    bbox=(50.420, 5.935, 50.450, 5.985))
```
`years` solo incluye temporadas accesibles sin cuenta. El bbox es aproximado: el worker comprueba que la vía OSM `highway=raceway` del circuito queda dentro con margen y, si no, lo amplía (el valor final queda en `tracks.py`). Si la numeración de FastF1 no coincide con los nombres, prevalece la numeración de FastF1 y los nombres se ajustan tras revisar el PNG de control.

### D2. Relieve
Spa tiene ≈ 100 m de desnivel. La elevación sale del pipeline actual (FastF1 Z / DEM de b12, según ya esté implementado). Se valida que el desnivel total de la línea central esté entre 70 y 130 m y que la pendiente máxima suavizada sea ≤ 20 %; si no, el pipeline falla con mensaje.

### D3. Entorno y borde
Sin cambios de código previstos: bosque, tribunas y boxes desde OSM; `marginM` por defecto. Overrides en `overrides/spa.json` (escapatorias de asfalto en La Source, Les Combes, Bruxelles, Stavelot y la chicane; grava en Pouhon y Blanchimont) revisados por Fable con los PNG de control. Si el entorno supera 3 MB o el presupuesto de draw calls, se reduce densidad con las constantes existentes, no con código nuevo.

### D4. Catálogo de circuitos (`src/shared/tracks.ts`)
```ts
export interface TrackInfo { id: string; name: string; country: string }
export const TRACKS: TrackInfo[] = [
  { id: 'interlagos', name: 'Interlagos', country: 'Brasil' },
  { id: 'spa', name: 'Spa-Francorchamps', country: 'Bélgica' },
];
export function trackById(id: string): TrackInfo | undefined;
```
El menú añade "Circuito" (recordado en `localStorage` con try/catch); `?track=<id>` prevalece. Al cambiar de circuito se recarga la página con el parámetro (evita liberar recursos a mano). Id desconocido: mensaje de error legible con botón para volver al menú (sin `?track`). En online el propietario elige el circuito, viaja en `cfg.track` y cada cliente, si su circuito cargado no coincide, recarga con `?track=` y vuelve a la sala antes del semáforo. Mismo HDRI y luz de día para ambos circuitos.

## Risks / Trade-offs

- 7 km de pista: más triángulos y más entorno; se vigila draw calls ≤ 200 y tamaño de `spa.world.json` < 3 MB.
- Datos de 2021 en mojado: se usa 2022 primero.
- Las pendientes de Eau Rouge ponen a prueba la física de pendientes de b4; si el piloto de referencia no sube, se reporta antes de tocar física (fuera de alcance).
