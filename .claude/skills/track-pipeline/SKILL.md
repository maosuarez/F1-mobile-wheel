---
name: track-pipeline
description: Pipeline de datos reales de circuitos (Interlagos, con Monza como respaldo) a track.json y su malla 3D en Three.js. Úsala para tools/track/build_track.py, TUMFTM racetrack-database, telemetría de posición y CircuitInfo de FastF1, alineación de trazados, perfil de elevación, remuestreo con splines, zonas DRS, sectores, curvas, pianos, el formato track.json, la generación de mallas de asfalto, pianos, hierba y muros, y las consultas (s, d) desde src/track.
---

# Pipeline de pista

Datos públicos → `public/track/<id>.json` → mallas Three.js. El mismo pipeline sirve para cualquier circuito; Monza es el respaldo plano.

## 1. Fuentes

| Fuente | Uso | Notas |
|---|---|---|
| TUMFTM/racetrack-database: `tracks/SaoPaulo.csv` (`x_m, y_m, w_tr_right_m, w_tr_left_m`) | Línea central y anchos | **Comprueba primero que exista el archivo.** Coordenadas locales en metros. Revisa la licencia del repo. Descárgalo con `git clone --depth 1`. |
| FastF1: vuelta rápida de clasificación del GP de São Paulo más reciente disponible | Elevación (Z) y sentido de marcha | `lap.get_pos_data()` / `get_telemetry()` → X, Y, Z. **Las unidades probablemente son décimas de metro: verifícalo** comparando la longitud con 4 309 m. Activa la caché de FastF1 en `tools/track/.cache/` (añádela a `.gitignore`). |
| FastF1: `session.get_circuit_info()` | Números y posiciones de las curvas | Para nombrar las curvas y ubicar las zonas a mano. |
| Respaldo si falta el CSV de TUMFTM | Usar X/Y de FastF1 como línea central, con ancho constante de 14 m | Avisa en consola de que la fidelidad es menor. |

Datos de FastF1: solo para uso personal y no comercial.

## 2. Procesado (`tools/track/build_track.py --track interlagos|monza`)

1. **Cargar la línea central** de TUMFTM y cerrar el bucle.
2. **Remuestrear** con un spline periódico (`scipy.interpolate.splprep`, `per=1`, con suavizado leve) **cada 2 m**.
3. **Telemetría de FastF1:** promediar 3–5 vueltas rápidas para reducir el ruido de Z, convertir a metros y remuestrear también cada 2 m.
4. **Alinear** FastF1 con TUMFTM: Procrustes o ICP en 2D con rotación, traslación y escala, comprobando también la reflexión. Usa la alineación solo para transferir Z por distancia recorrida; **la geometría XY final es la de TUMFTM**.
5. **Sentido:** fíjalo con el orden de marcha de FastF1. Interlagos es **antihorario**; verifícalo con el área con signo (fórmula del cordón de zapatos > 0).
6. **Elevación:** Z según `s`, suavizada con Savitzky-Golay (ventana ~60 m). Para cerrar el bucle, reparte linealmente el desfase entre el principio y el final.
7. **Derivadas por muestra:** tangente, normal izquierda, curvatura `k`, pendiente `dz/ds` y peralte (0 por defecto, porque no hay datos públicos fiables).
8. **Metadatos** (ver §3): `start_s` en la línea de meta (la primera muestra de la telemetría de la vuelta, ajustable a mano), tres sectores, zonas DRS, curvas y pianos.
9. **Pianos procedurales:** donde `|k| > 1/150 m⁻¹`, se colocan en el **interior** de la curva y en el **exterior a la salida**, con 30 m de entrada y 40 m de salida. Fusiona los tramos que estén a menos de 15 m.
10. **Control de calidad:** genera con matplotlib `out/<id>_plan.png` (planta con curvas, pianos y zonas DRS) y `out/<id>_elev.png` (perfil de elevación), e imprime un resumen.

## 3. Formato de `track.json`

**Convención:** mundo Three.js con Y hacia arriba. `(x_m, y_m, z)` de los datos → `(x, z, −y)` en el mundo, con el origen en la línea de meta.

```json
{
  "id": "interlagos",
  "name": "Autódromo José Carlos Pace",
  "length_m": 4309.0,
  "direction": "ccw",
  "step_m": 2.0,
  "samples": {
    "s": [], "x": [], "y": [], "z": [],
    "wl": [], "wr": [], "nx": [], "nz": [],
    "k": [], "pitch": [], "bank": []
  },
  "start_s": 0.0,
  "sectors_s": [0.0, 0.0],
  "drs_zones": [{ "detect_s": 0.0, "start_s": 0.0, "end_s": 0.0 }],
  "corners": [{ "n": 1, "name": "S do Senna", "s": 0.0 }],
  "kerbs": [{ "s0": 0.0, "s1": 0.0, "side": "left" }],
  "runoff_m": 18.0
}
```

- **Columnas separadas** en `samples`: el JSON pesa menos y se carga en `Float32Array`.
- **Interlagos, a revisar sobre el PNG:**
  - Dos zonas DRS: la recta principal (detección antes de la Junção) y la Reta Oposta (detección en la Curva do Sol).
  - Curvas destacadas: S do Senna (1–2), Curva do Sol (3), Bico de Pato (10), Junção y Subida dos Boxes (12 a meta).
  - El script propone valores iniciales y el humano los ajusta en el mismo JSON.

## 4. Mallas en el juego (`src/track/mesh.ts`)

- **Cintas por muestra:**
  - asfalto de `−wr` a `wl`;
  - pianos sobre los tramos `kerbs` (1,2 m de ancho, 3 cm de alto, textura roja y blanca generada en canvas);
  - franja blanca de 0,3 m en los bordes;
  - hierba hasta `runoff_m`;
  - muros de 1 m de alto al final.
- **UV:** `u` según la posición lateral, `v = s / 10` para repetir la textura. Normales suavizadas.
- **Rendimiento:** divide la pista en ~20 trozos (un `BufferGeometry` por trozo y superficie) para el frustum culling. Reutiliza materiales; haz merge por material dentro de cada trozo.
- **Entorno:** el plano del suelo sigue la altura media; gradas y árboles con `InstancedMesh` en el exterior de las rectas.
- **Línea de meta** y parrilla (posiciones de salida) a partir de `start_s`.

## 5. Consultas (`src/track/query.ts`)

- `locate(x, z, hintIndex) → { i, s, d, y, pitch, bank, surface, kerbSide }`, con búsqueda en ventana (§1 de `f1-car-feel`).
- `sampleAt(s) → { x, y, z, tangent, normal, wl, wr }`, interpolado.
- `inDrsZone(s)`, `sectorAt(s)`, `crossedStart(sPrev, s)`.
- Sin dependencias de three, para poder usarlas en Vitest.

## 6. Criterios de aceptación

- [ ] `python tools/track/build_track.py --track interlagos` termina sin errores y escribe el JSON y los dos PNG.
- [ ] `length_m` dentro de ±1 % de 4 309 m (Monza: ±1 % de 5 793 m).
- [ ] El bucle cierra con un salto < 0,5 m en XY y Z.
- [ ] `direction` es `ccw` en Interlagos.
- [ ] El perfil de elevación muestra la bajada a la S do Senna y la subida de los boxes.
- [ ] Los anchos están entre 8 y 25 m, sin valores atípicos.
- [ ] En el juego, la pista se ve continua, sin huecos ni costuras en `s = 0`.
- [ ] `locate()` devuelve el `s` correcto en un test con puntos conocidos.
