# track-world Specification

## Purpose
TBD - created by archiving change b12-real-world-env. Update Purpose after archive.

## Requirements

### Requirement: Generación del entorno real por línea de comandos
El pipeline SHALL generar `public/track/<id>.world.json` con `python tools/track/build_world.py --track <id>` a partir de OpenStreetMap y de un modelo de elevación público, reutilizando la caché si existe.

#### Scenario: Interlagos
- **WHEN** se ejecuta `python tools/track/build_world.py --track interlagos` con la caché presente y sin red
- **THEN** termina con código 0, escribe `interlagos.world.json` < 1,5 MB y `out/interlagos_world.png`

#### Scenario: Sin red ni caché
- **WHEN** no hay red ni caché
- **THEN** termina con código distinto de 0, con un mensaje en español, y no modifica `interlagos.json`

### Requirement: Alineación con el trazado
El entorno MUST estar en el mismo marco que `track.json`.

#### Scenario: Error de alineación
- **WHEN** se alinea la vía `highway=raceway` de OSM con la línea central
- **THEN** el RMS es ≤ 8 m; si es mayor, el script termina con código 2

### Requirement: Terreno real cosido a la pista
El terreno SHALL reproducir el relieve real y no cortar ni flotar respecto a la pista.

#### Scenario: Bajo la pista
- **WHEN** se evalúa la altura del terreno en puntos hasta el 95 % de la distancia al muro que pertenecen a la zona de un solo tramo
- **THEN** queda entre 0,1 y 0,6 m por debajo de la altura de pista en ese punto

#### Scenario: Zonas solapadas
- **WHEN** un punto está dentro de la zona de muros de dos tramos a distinta altura
- **THEN** el terreno queda al menos 0,1 m por debajo del tramo más bajo

#### Scenario: Relieve
- **WHEN** se comparan las alturas del terreno a más de 40 m del muro con el DEM desplazado por el offset
- **THEN** la diferencia media absoluta es < 0,5 m

### Requirement: Edificios, agua, bosque y calle de boxes
El entorno SHALL incluir edificios extruidos con huella y altura de OSM, el agua, los bosques y la calle de boxes, sin invadir la zona de carrera.

#### Scenario: Contenido de Interlagos
- **WHEN** se genera Interlagos
- **THEN** hay al menos un edificio `pit`, al menos un `grandstand`, al menos un polígono de agua y calle de boxes no nula

#### Scenario: Zona libre
- **WHEN** se mide la distancia de cada vértice de edificio a la línea central
- **THEN** es ≥ wl/wr + runoff + 6 m de la muestra más cercana, salvo en gradas, donde es ≥ wl/wr + runoff + 2 m

### Requirement: Render del entorno real dentro del presupuesto
El juego SHALL renderizar el entorno real cuando exista `world.json` y el entorno procedural cuando no.

#### Scenario: Con mundo
- **WHEN** se carga Interlagos con `interlagos.world.json`
- **THEN** la escena contiene terreno, edificios, agua y calle de boxes, no contiene `skyline`, el entorno añade ≤ 12 draw calls y no hay errores de consola

#### Scenario: Sin mundo
- **WHEN** `/track/<id>.world.json` responde 404
- **THEN** se usa el entorno procedural de b6 sin errores de consola

#### Scenario: Atribución
- **WHEN** se muestra el menú de inicio con mundo cargado
- **THEN** aparece el texto "© OpenStreetMap contributors"
