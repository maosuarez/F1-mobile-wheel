# track-runtime Specification

## Purpose
Convierte el archivo de circuito en una pista utilizable en tiempo de ejecución: consultas rápidas y puras de posición, superficie y zonas para la simulación, y mallas continuas para el render.

## Requirements

### Requirement: Carga validada del circuito
El juego SHALL cargar `/track/<id>.json`, validarlo y exponerlo como arrays tipados. Un archivo ausente o inválido MUST producir un error con mensaje legible en lugar de una pista corrupta.

#### Scenario: Carga correcta
- **WHEN** se carga `interlagos`
- **THEN** la pista expone N muestras, `length` igual a `length_m` del archivo y tangentes unitarias por muestra

#### Scenario: Archivo inválido
- **WHEN** el JSON carece de la columna `samples.wl`
- **THEN** la carga falla con un error cuyo mensaje contiene `samples.wl`

### Requirement: Localización en coordenadas de pista
Dada una posición de mundo `(x, z)` y un índice de pista previo, la consulta SHALL devolver la distancia recorrida `s`, el desplazamiento lateral `d` (positivo a la izquierda), la altura, la pendiente, el peralte, la curvatura y el rumbo de la pista en ese punto, con continuidad al cruzar `s = 0`.

#### Scenario: Puntos conocidos en Interlagos
- **WHEN** se construye un punto a partir de la muestra i con desplazamiento lateral `d0` ∈ {−5, 0, 4} m y se localiza con pista previa i
- **THEN** el `s` devuelto difiere de `s[i]` en menos de 0,25 m y `d` difiere de `d0` en menos de 0,25 m, para 200 muestras repartidas por toda la vuelta

#### Scenario: Seguimiento continuo en la costura
- **WHEN** un punto avanza 1 m por consulta sobre la línea central desde `s = length − 30` hasta `s = 30`
- **THEN** `s` crece de forma monótona módulo `length`, sin saltos mayores de 1,5 m

#### Scenario: Recuperación tras teletransporte
- **WHEN** la pista previa está a más de 200 m del punto consultado
- **THEN** la consulta devuelve la misma localización que una búsqueda global

#### Scenario: Altura interpolada
- **WHEN** se localiza un punto a mitad de dos muestras consecutivas
- **THEN** la altura devuelta está entre las alturas de ambas muestras y difiere de su media en menos de 0,01 m

### Requirement: Clasificación de superficie
La consulta SHALL clasificar la superficie según `d`: asfalto dentro de los bordes; piano hasta 1,2 m fuera del borde en el lado y tramo de un piano; hierba en el resto hasta el muro. También SHALL informar de la distancia lateral al muro de cada lado (borde + `runoff_m`).

#### Scenario: Asfalto
- **WHEN** `−wr ≤ d ≤ wl`
- **THEN** la superficie es `asphalt`

#### Scenario: Piano
- **WHEN** `d = wl + 0,6` en un `s` cubierto por un piano del lado izquierdo
- **THEN** la superficie es `kerb` y el lado informado es `left`

#### Scenario: Hierba junto a un piano
- **WHEN** `d = wl + 1,5` en ese mismo `s`
- **THEN** la superficie es `grass`

#### Scenario: Hierba sin piano
- **WHEN** `d = −(wr + 0,6)` en un `s` sin piano del lado derecho
- **THEN** la superficie es `grass`

### Requirement: Consultas de zonas y de meta
El módulo SHALL ofrecer muestreo interpolado por `s`, sector de un `s`, pertenencia a zona DRS y detección de cruce de meta hacia delante, tratando correctamente los tramos que cruzan `s = 0`.

#### Scenario: Zona DRS que cruza la meta
- **WHEN** una zona tiene `start_s = 3900` y `end_s = 250` en una pista de 4 309 m
- **THEN** `s = 4200` y `s = 100` están en la zona y `s = 300` no

#### Scenario: Sectores
- **WHEN** `sectors_s = [1400, 2900]`
- **THEN** `s = 10` es el sector 0, `s = 1400` es el sector 1 y `s = 4000` es el sector 2

#### Scenario: Cruce hacia delante
- **WHEN** `sPrev = length − 0,4` y `s = 0,3`
- **THEN** se detecta cruce de meta

#### Scenario: Cruce hacia atrás
- **WHEN** `sPrev = 0,3` y `s = length − 0,4`
- **THEN** no se detecta cruce de meta

### Requirement: Consultas puras
Las consultas y los tipos de pista MUST poder ejecutarse sin navegador ni librería gráfica, para usarse en tests de Node y dentro de la simulación.

#### Scenario: Ejecución en Node
- **WHEN** los tests de consultas se ejecutan en Vitest con entorno `node`
- **THEN** pasan sin importar `three` ni acceder a `window` o `document`

### Requirement: Pistas sintéticas
SHALL existir generadores de pistas sintéticas (recta abierta con ancho y pendiente configurables; óvalo cerrado antihorario con pianos opcionales) con el mismo formato en memoria que una pista real.

#### Scenario: Recta con pendiente
- **WHEN** se genera una recta de 5 000 m con pendiente −0,05
- **THEN** la altura en `s = 1000` es −50 ± 0,1 m y la curvatura es 0 en toda muestra

#### Scenario: Óvalo cerrado
- **WHEN** se genera un óvalo con rectas de 1 000 m y radio 150 m
- **THEN** su longitud es `2·1000 + 2π·150` ± 1 % y la curvatura en las curvas es 1/150 ± 5 %

### Requirement: Mallas de pista continuas
El juego SHALL generar, a partir de las muestras, asfalto entre bordes, franjas blancas de 0,3 m en los bordes, pianos de 1,2 m de ancho y 3 cm de alto con bandas alternas rojas y blancas en sus tramos, hierba hasta `runoff_m`, muros de 1 m de alto y una línea de meta, sin huecos ni costuras en ningún punto, incluido `s = 0`.

#### Scenario: Continuidad entre trozos
- **WHEN** se comparan los vértices del último anillo de cada trozo con el primero del siguiente, incluido del último trozo al primero
- **THEN** coinciden con error < 0,001 m

#### Scenario: Geometría válida
- **WHEN** se generan las mallas de Interlagos
- **THEN** ningún vértice es `NaN`, todas las normales de asfalto tienen componente Y > 0,9 y los vértices de piano están entre 0,02 y 0,04 m por encima del asfalto contiguo

#### Scenario: Pianos solo en sus tramos
- **WHEN** se inspecciona la malla en un `s` sin piano
- **THEN** no hay geometría de piano en ese anillo

### Requirement: Mallas dentro del presupuesto
Las mallas de pista SHALL dividirse en unos 20 trozos con caja envolvente propia para el descarte por frustum, con como máximo 3 mallas por trozo y materiales compartidos.

#### Scenario: Presupuesto de Interlagos
- **WHEN** se generan las mallas de Interlagos
- **THEN** hay entre 16 y 24 trozos, no más de 70 mallas en total, no más de 4 materiales distintos y menos de 150 000 triángulos
