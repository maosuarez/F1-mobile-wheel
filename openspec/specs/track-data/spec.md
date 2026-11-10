# track-data Specification

## Purpose
Define cómo se generan los datos de un circuito real a partir de fuentes públicas y qué garantías de formato y calidad cumple el archivo `public/track/<id>.json` que consume el juego.

## Requirements

### Requirement: Generación reproducible por línea de comandos
El pipeline SHALL generar `public/track/<id>.json`, `out/<id>_plan.png` y `out/<id>_elev.png` con un único comando `build_track.py --track <id>`, imprimiendo un resumen (longitud, muestras, sentido, residuo de alineación, rango de elevación, número de curvas, pianos y zonas DRS). Ejecutarlo dos veces con las mismas fuentes en caché MUST producir un JSON idéntico byte a byte.

#### Scenario: Generación de Interlagos
- **WHEN** se ejecuta `.venv/bin/python tools/track/build_track.py --track interlagos` con red disponible
- **THEN** el proceso termina con código 0 y existen `public/track/interlagos.json`, `out/interlagos_plan.png` y `out/interlagos_elev.png`

#### Scenario: Determinismo
- **WHEN** se ejecuta el comando dos veces seguidas con la caché ya poblada
- **THEN** el hash SHA-256 de `public/track/interlagos.json` es el mismo en ambas ejecuciones

#### Scenario: Circuito desconocido
- **WHEN** se ejecuta con `--track foo`
- **THEN** el proceso termina con código ≠ 0 y lista los circuitos soportados, sin escribir archivos

### Requirement: Degradación ante fuentes ausentes
Si el CSV de TUMFTM no existe, el pipeline SHALL usar el trazado XY de FastF1 como línea central con ancho constante de 14 m y avisar en consola de la menor fidelidad. Si FastF1 no entrega telemetría de ninguna de las temporadas candidatas, el pipeline MUST terminar con código ≠ 0 y un mensaje que nombre la fuente que falló, sin escribir un JSON parcial.

#### Scenario: Sin telemetría de elevación
- **WHEN** FastF1 falla para todas las temporadas candidatas
- **THEN** el proceso termina con código ≠ 0, el mensaje menciona FastF1 y no se modifica `public/track/<id>.json`

#### Scenario: Sin CSV de TUMFTM
- **WHEN** el CSV del circuito no está en el repositorio clonado
- **THEN** el JSON se genera con `wl + wr = 14` en todas las muestras y la consola muestra un aviso de fidelidad reducida

### Requirement: Formato track.json
El archivo SHALL contener `id`, `name`, `length_m`, `direction`, `step_m`, `samples`, `start_s`, `sectors_s`, `drs_zones`, `corners`, `kerbs` y `runoff_m`. `samples` SHALL tener las columnas `s, x, y, z, wl, wr, nx, nz, k, pitch, bank`, todas de la misma longitud N, en coordenadas de mundo con Y hacia arriba (`x = x_m`, `y = elevación`, `z = −y_m`) y origen en la línea de meta.

#### Scenario: Columnas completas y homogéneas
- **WHEN** se lee `interlagos.json`
- **THEN** las 11 columnas existen, tienen la misma longitud N ≥ 2000 y ningún valor es `NaN` ni infinito

#### Scenario: Muestreo uniforme
- **WHEN** se inspecciona `samples.s`
- **THEN** `s[0] = 0`, `s[i] = i · step_m` con error < 0,002 m, `step_m` está entre 1,9 y 2,1 y `N · step_m` coincide con `length_m` con error < 0,01 m

#### Scenario: Origen en la meta
- **WHEN** se lee la primera muestra
- **THEN** `|x[0]| < 0,01`, `|y[0]| < 0,01`, `|z[0]| < 0,01` y `start_s = 0` salvo ajuste manual

#### Scenario: Normal izquierda unitaria
- **WHEN** se toma cualquier muestra i con tangente `(tx, tz)` por diferencias centradas entre la muestra anterior y la siguiente (con envoltura)
- **THEN** `nx² + nz²` está entre 0,999 y 1,001 y `(nx, nz)` coincide con `(tz, −tx)` normalizado con error angular < 3°

### Requirement: Fidelidad geométrica
La longitud SHALL estar dentro de ±1 % de la longitud oficial (Interlagos 4 309 m; Monza 5 793 m), el bucle SHALL cerrar sin salto y el sentido SHALL coincidir con el de marcha real.

#### Scenario: Longitud de Interlagos
- **WHEN** se lee `length_m` de `interlagos.json`
- **THEN** el valor está entre 4 266 y 4 352

#### Scenario: Cierre del bucle
- **WHEN** se mide la distancia entre la última muestra y la primera
- **THEN** la distancia en XZ está entre 1,5 y 2,5 m (un paso) y `|y[N−1] − y[0]|` < 0,5 m

#### Scenario: Sentido antihorario
- **WHEN** se calcula el área con signo del polígono `(x, −z)` en orden de `s`
- **THEN** el área es positiva y `direction` es `"ccw"`

#### Scenario: Curvatura sin picos
- **WHEN** se inspecciona `samples.k`
- **THEN** `max |k|` < 0,12 m⁻¹ y hay muestras con `k` de ambos signos

#### Scenario: Alineación con FastF1
- **WHEN** termina la alineación 2D del trazado de FastF1 con la línea central
- **THEN** el residuo medio impreso es < 10 m

### Requirement: Anchos plausibles
Los anchos `wl` y `wr` SHALL ser positivos y el ancho total de pista SHALL estar entre 8 y 25 m en todas las muestras.

#### Scenario: Rango de anchos
- **WHEN** se calcula `wl[i] + wr[i]` para toda muestra
- **THEN** el mínimo es ≥ 8 y el máximo es ≤ 25, con `wl[i] ≥ 3` y `wr[i] ≥ 3`

### Requirement: Perfil de elevación real
`samples.y` SHALL reflejar la elevación real suavizada respecto a la meta, y `samples.pitch` SHALL ser la pendiente `dy/ds` coherente con `y`. `bank` SHALL ser 0 mientras no existan datos fiables.

#### Scenario: Desnivel total de Interlagos
- **WHEN** se calcula `max(y) − min(y)`
- **THEN** el resultado está entre 25 y 60 m

#### Scenario: Bajada tras la S do Senna
- **WHEN** se toma el mínimo de `y` para `s` entre 200 y 1 500 m
- **THEN** ese mínimo es al menos 10 m inferior a `y[0]`

#### Scenario: Subida de boxes
- **WHEN** se toma el mínimo de `y` para `s` entre 2 800 y 3 600 m
- **THEN** ese mínimo es al menos 15 m inferior a `y[0]` y la media de `pitch` entre `s = 3 200` y `s = 3 800` es mayor de 0,02

#### Scenario: Pendiente coherente y suave
- **WHEN** se compara `pitch[i]` con `(y[i+1] − y[i−1]) / (2 · step_m)`
- **THEN** la diferencia es < 0,01 en toda muestra y `max |pitch|` < 0,15

### Requirement: Metadatos de carrera
El archivo SHALL incluir dos límites de sector crecientes, las curvas numeradas con su `s`, las zonas DRS y los pianos. Una zona DRS o un piano cuyo inicio sea mayor que su final SHALL interpretarse como un tramo que cruza `s = 0`.

#### Scenario: Sectores
- **WHEN** se lee `sectors_s`
- **THEN** contiene dos valores con `0 < sectors_s[0] < sectors_s[1] < length_m`, cada sector mide al menos el 15 % de la vuelta

#### Scenario: Zonas DRS de Interlagos
- **WHEN** se lee `drs_zones`
- **THEN** hay exactamente 2 zonas, cada una con `detect_s`, `start_s` y `end_s` en `[0, length_m)`, longitud entre 300 y 1 300 m, y `|k|` < 1/150 en al menos el 80 % de sus muestras; una de ellas contiene `s = 0`

#### Scenario: Curvas de Interlagos
- **WHEN** se lee `corners`
- **THEN** hay entre 12 y 16 curvas con `n` consecutivos desde 1, `s` estrictamente creciente, y aparecen los nombres "S do Senna", "Curva do Sol", "Bico de Pato" y "Junção"

#### Scenario: Pianos procedurales
- **WHEN** se lee `kerbs`
- **THEN** hay al menos 8 tramos con `side` igual a `"left"` o `"right"`, longitud entre 20 y 400 m cada uno, y dos tramos del mismo lado nunca están separados menos de 15 m

### Requirement: Ajustes manuales persistentes
El pipeline SHALL aplicar, si existe, `tools/track/overrides/<id>.json` sobre los valores propuestos (`start_shift_m`, `sectors_s`, `drs_zones`, `corner_names`, `kerbs_add`, `kerbs_remove`), de modo que regenerar el circuito conserve las correcciones humanas.

#### Scenario: Override de zonas DRS
- **WHEN** el archivo de overrides define `drs_zones` y se regenera el circuito
- **THEN** el JSON resultante contiene exactamente esas zonas y el resumen indica que proceden del override

#### Scenario: Sin overrides
- **WHEN** no existe archivo de overrides
- **THEN** el pipeline usa los valores propuestos automáticamente y termina con código 0

### Requirement: Validación automática del resultado
SHALL existir un validador ejecutable que compruebe todos los criterios numéricos de esta especificación sobre un JSON dado, y un test de Vitest que haga lo mismo sobre el JSON versionado. Ambos MUST fallar ante un archivo que incumpla cualquier criterio.

#### Scenario: Validador sobre el JSON bueno
- **WHEN** se ejecuta `.venv/bin/python tools/track/validate_track.py public/track/interlagos.json`
- **THEN** imprime una línea `OK`/`FAIL` por criterio, todas `OK`, y sale con código 0

#### Scenario: Validador sobre un JSON corrupto
- **WHEN** se valida una copia en la que se ha invertido el orden de las muestras o se ha puesto `length_m = 5000`
- **THEN** sale con código ≠ 0 e indica el criterio incumplido

#### Scenario: Test de datos en Vitest
- **WHEN** se ejecuta `npx vitest run tests/track.data.test.ts`
- **THEN** todos los tests pasan sobre `public/track/interlagos.json`

### Requirement: Imágenes de control
Las imágenes SHALL permitir a una persona revisar el resultado: la planta con curvas numeradas, pianos, zonas DRS, sectores, meta y flecha de sentido; y el perfil de elevación frente a `s` con las curvas marcadas.

#### Scenario: Planta legible
- **WHEN** se abre `out/interlagos_plan.png`
- **THEN** se ve el trazado cerrado con ejes a igual escala, la meta, los números de curva, los pianos por lado, las dos zonas DRS y el sentido de marcha

#### Scenario: Perfil de elevación
- **WHEN** se abre `out/interlagos_elev.png`
- **THEN** se ve `y` (m) frente a `s` (m) con líneas verticales en cada curva y en los límites de sector
