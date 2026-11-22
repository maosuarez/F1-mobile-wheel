## ADDED Requirements

### Requirement: Circuito nocturno iluminado
Los circuitos con `lighting: 'night'` SHALL mostrarse de noche con cielo nocturno, asfalto iluminado por focos, postes de luz con brillo y ventanas encendidas; los circuitos `day` SHALL verse como antes.

#### Scenario: Legibilidad de la pista
- **WHEN** se captura la cámara de casco en una recta de Bahréin
- **THEN** la luminancia media de la franja de asfalto es ≥ 0,25 y la del cielo ≤ 0,15 (lectura de píxeles de la captura)

#### Scenario: Presupuesto nocturno
- **WHEN** se carga Bahréin con calidad alta y 9 rivales
- **THEN** la noche añade ≤ 6 draw calls y el total es ≤ 200

#### Scenario: Solo de noche
- **WHEN** se carga Interlagos o Spa
- **THEN** no se crean postes de luz ni se cambian luces, HDRI ni bloom
