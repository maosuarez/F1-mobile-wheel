## MODIFIED Requirements

### Requirement: Entorno
El circuito SHALL estar rodeado de su entorno real (capability `track-world`) cuando exista `world.json`; si no existe, SHALL estar rodeado de gradas en la recta principal, vegetación repartida por el exterior y una silueta lejana. En ambos casos sin invadir la pista ni las escapatorias.

#### Scenario: Elementos fuera de la pista
- **WHEN** se generan gradas y árboles procedurales (sin `world.json`)
- **THEN** ninguno queda a menos de 3 m por fuera del muro ni dentro de la pista, y hay al menos 300 árboles y gradas a lo largo de al menos 300 m de la recta principal

#### Scenario: Entorno real
- **WHEN** existe `world.json`
- **THEN** los árboles están dentro de los polígonos de bosque de OSM, no hay silueta procedural y ningún elemento queda a menos de 3 m por fuera del muro
