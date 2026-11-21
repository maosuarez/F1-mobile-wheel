## ADDED Requirements

### Requirement: Circuito nocturno iluminado
Los circuitos con `lighting: 'night'` SHALL mostrarse de noche con cielo nocturno, asfalto iluminado por focos, postes de luz con brillo, ventanas encendidas y los monumentos de OSM disponibles.

#### Scenario: Legibilidad de la pista
- **WHEN** se captura la cámara de casco en una recta de Singapur
- **THEN** la luminancia media de la franja de asfalto es ≥ 0,25 y la del cielo ≤ 0,15 (lectura con la API de píxeles de depuración)

#### Scenario: Presupuesto nocturno
- **WHEN** se carga Singapur con calidad alta y 9 rivales
- **THEN** la noche añade ≤ 6 draw calls y el total es ≤ 200

#### Scenario: Noria
- **WHEN** el OSM de Singapur contiene la noria
- **THEN** `singapore.world.json` incluye un `landmark` `big_wheel` y la escena la dibuja
