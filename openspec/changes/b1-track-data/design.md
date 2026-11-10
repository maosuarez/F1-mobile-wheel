# Design

## Context

Repositorio sin código. La skill `track-pipeline` (§1–§3, §6) describe fuentes, procesado y formato; este documento solo fija lo que la skill deja abierto. Comprobado el 2026-11-10: `tracks/SaoPaulo.csv` existe en TUMFTM/racetrack-database (rama `master`).

## Goals / Non-Goals

**Goals:** JSON de Interlagos versionado y validado por máquina; contrato TypeScript del formato; andamiaje npm/Python para todos los bloques.

**Non-Goals:** cargar el JSON en tiempo de ejecución, `query.ts`, mallas (bloque 2). No se usa pytest: la validación Python es un script con código de salida.

## Decisions

### D1. Entorno y layout

```
requirements.txt                 # fastf1 numpy scipy pandas matplotlib (sin versiones fijadas)
.venv/                           # uv venv .venv --python 3.12 && uv pip install -r requirements.txt
tools/track/build_track.py       # CLI y orquestación de pasos
tools/track/tracks.py            # TRACKS: dict[str, TrackSpec] (tabla por circuito)
tools/track/validate_track.py    # criterios → OK/FAIL, exit code
tools/track/overrides/<id>.json  # opcional, versionado
tools/track/.cache/              # caché FastF1 + clon TUMFTM (gitignored)
out/                             # PNG de control (gitignored)
public/track/<id>.json           # versionado
package.json  tsconfig.json  vitest.config.ts  .gitignore
src/track/types.ts  src/track/schema.ts  tests/track.data.test.ts
```

Todos los comandos Python se ejecutan como `.venv/bin/python …`. `.gitignore`: `node_modules/ dist/ .venv/ out/ tools/track/.cache/ __pycache__/ .env *.log`.

`package.json`: `"type": "module"`, scripts `dev: "vite --host --port 5173"`, `build: "tsc --noEmit && vite build"`, `test: "vitest run"`, `typecheck: "tsc --noEmit"`. `tsconfig.json`: `strict`, `noUncheckedIndexedAccess: false`, `target/module ES2022`, `moduleResolution: "bundler"`, `resolveJsonModule`, `types: ["vite/client"]`, `include: ["src", "tests"]`. `vitest.config.ts`: `environment: "node"`, `include: ["tests/**/*.test.ts"]`.

### D2. `TrackSpec` (tools/track/tracks.py)

```python
@dataclass(frozen=True)
class TrackSpec:
    id: str; name: str; tumftm_csv: str; fastf1_event: str
    years: tuple[int, ...]           # orden de intento, p. ej. (2026, 2025, 2024, 2023, 2022, 2021); FastF1 3.9 exige cuenta para 2023+, así que hoy carga 2022
    official_length_m: float; direction: str   # "ccw" | "cw"
    corner_names: dict[int, str]     # nº de curva → nombre; el resto "Curva N"
```

Interlagos: `tumftm_csv="SaoPaulo.csv"`, `fastf1_event="São Paulo"`, 4309.0, `"ccw"`, nombres `{1:"S do Senna", 2:"S do Senna", 3:"Curva do Sol", 4:"Descida do Lago", 5:"Descida do Lago", 6:"Ferradura", 7:"Ferradura", 8:"Laranjinha", 9:"Pinheirinho", 10:"Bico de Pato", 11:"Mergulho", 12:"Junção", 13:"Subida dos Boxes", 14:"Arquibancadas"}`. Monza: `"Monza.csv"`, `"Italian"`, 5793.0, `"cw"`, sin nombres. Sesión FastF1: `'Q'`; se recorre `years` hasta la primera que cargue con telemetría.

### D3. Pasos y firmas (build_track.py)

Funciones puras, una por paso, para que cada tarea toque una sola:

```python
load_centerline(spec) -> ndarray (M,4)             # x_m, y_m, w_right, w_left; None si falta el CSV
load_fastf1(spec) -> FastF1Data                    # .xyz (K,3) en metros, .corners [(n, x, y)], .sector_fracs (f1, f2)
resample_closed(xy, widths, step=2.0) -> Centerline  # splprep per=1; N = round(L/2); step_m = L/N exacto
align_2d(src_xy, dst_xy) -> (transform, residual_m)
transfer_elevation(cl, ff_xyz_aligned) -> y (N,)
derive(cl, y) -> columnas nx, nz, k, pitch, bank
propose_metadata(cl, ff, spec) -> dict             # start, sectores, DRS, curvas, pianos
apply_overrides(meta, path) -> meta
write_json(...); plot_plan(...); plot_elev(...)
```

- **Unidades FastF1:** X/Y/Z en décimas de metro → multiplicar por 0,1. Verificación obligatoria: la longitud de la polilínea de una vuelta debe quedar a ±5 % de `official_length_m`; si no, abortar con error.
- **Vueltas:** las 3–5 vueltas más rápidas de la sesión (de cualquier piloto) con `pos_data` completo; se remuestrea cada una a 2 m por distancia recorrida y se promedia Z.
- **Alineación (D4)** solo se usa para transferir Z, la posición de la meta, las curvas y los sectores. XY final = TUMFTM.
- **Sentido:** tras alinear, si el orden de marcha de FastF1 recorre la línea central en `s` decreciente, se invierte la línea central y se intercambian `w_left`/`w_right`. Después se comprueba el área con signo contra `spec.direction`; si no coincide, abortar.
- **Meta:** la proyección del primer punto de telemetría de la vuelta sobre la línea central define `s = 0`; se rota el array para que sea la muestra 0 y se traslada el origen XY ahí. `start_shift_m` del override desplaza ese punto.
- **Elevación:** Z del vecino FastF1 más cercano (media de los 3 más cercanos por KD-tree), `savgol_filter(window=31, polyorder=3, mode="wrap")`, luego `y -= y[0]`.
- **Derivadas:** tangente y curvatura analíticas del spline (`splev der=1,2`); `k > 0` = giro a la izquierda; normal izquierda en mundo `(nx, nz) = (tz, −tx)` con `(tx, tz)` la tangente en mundo; `pitch` por diferencias centradas periódicas de `y`; `bank = 0`.
- **Mundo:** `x = x_m`, `z = −y_m`, `y = elevación`. Redondeo al escribir: 3 decimales; `k`, `nx`, `nz`, `pitch` 6 decimales. `json.dump(..., separators=(",", ":"))`, claves en el orden de la skill.

### D4. Alineación 2D sin correspondencias

FastF1 es la trazada de carrera, no la línea central (difieren hasta ~7 m), y no hay correspondencia punto a punto. Algoritmo: centrar ambas nubes; escala inicial = cociente de longitudes; búsqueda gruesa de rotación 0–358° en pasos de 2° × {sin reflejar, reflejada}, puntuando con la distancia media al vecino más cercano (`scipy.spatial.cKDTree`); refinar la mejor con 30 iteraciones de ICP de similitud (Umeyama). Devuelve el residuo medio. *Alternativa descartada:* Procrustes por fracción de arco, que exige conocer el punto de inicio común.

### D5. Metadatos propuestos

- **Sectores:** fracción de distancia de la vuelta rápida en `Sector1SessionTime` y `Sector2SessionTime` × `length_m`. Respaldo: L/3 y 2L/3.
- **Curvas:** `circuit_info.corners` (X, Y, Number) × 0,1 → alineación → proyección a `s`. Se conserva una entrada por número; nombre de `corner_names` o `"Curva N"`.
- **Rectas:** tramos contiguos (con envoltura en `s = 0`) con `|k| < 1/500`. **Zonas DRS:** las dos rectas más largas; `start_s = inicio + 80`, `end_s = fin de la recta`, `detect_s = inicio − 150` (módulo L).
- **Pianos:** regla de la skill §2.9 (`|k| > 1/150`; interior durante la curva con 30 m de entrada; exterior en los 40 m de salida; fusionar < 15 m). Interior = lado hacia el que gira (`k > 0` → `"left"`).
- `runoff_m = 18`.

### D6. Contrato TypeScript

```ts
// src/track/types.ts
export type TrackSide = 'left' | 'right';
export interface TrackSamplesJson { s:number[]; x:number[]; y:number[]; z:number[]; wl:number[]; wr:number[]; nx:number[]; nz:number[]; k:number[]; pitch:number[]; bank:number[] }
export interface DrsZone { detect_s:number; start_s:number; end_s:number }
export interface Corner { n:number; name:string; s:number }
export interface Kerb { s0:number; s1:number; side:TrackSide }
export interface TrackJson { id:string; name:string; length_m:number; direction:'ccw'|'cw'; step_m:number; samples:TrackSamplesJson; start_s:number; sectors_s:[number,number]; drs_zones:DrsZone[]; corners:Corner[]; kerbs:Kerb[]; runoff_m:number }
// src/track/schema.ts
export const SAMPLE_COLUMNS: readonly (keyof TrackSamplesJson)[];
export function parseTrackJson(raw: unknown): TrackJson;   // lanza Error con la ruta del campo inválido
```

`parseTrackJson` valida estructura y homogeneidad (tipos, longitudes iguales, finitos, lados válidos), no la fidelidad; la fidelidad vive en `tests/track.data.test.ts` y en `validate_track.py`, que implementan los mismos umbrales de `specs/track-data/spec.md`.

## Risks / Trade-offs

- [FastF1 sin datos de la temporada más reciente o API caída] → lista `years` descendente; error explícito si ninguna carga. Sin elevación el bloque no cierra.
- [Umbrales de elevación de la spec (10 m y 15 m) estimados sin ver los datos] → si los datos reales los incumplen pero el PNG es coherente con el circuito, el worker se detiene y lo reporta; el orquestador ajusta la spec, no el worker.
- [Zonas DRS/pianos heurísticos poco realistas] → se revisan sobre el PNG y se corrigen en `overrides/interlagos.json`.
- [Licencia de TUMFTM (LGPL-3.0) y términos de FastF1] → el clon no se versiona; solo el JSON derivado, para uso personal.
