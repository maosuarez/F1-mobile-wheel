## MODIFIED Requirements

### Requirement: Controles de DRS
Con teclado, la tecla F SHALL dar la orden de DRS; con volante, una sacudida en recta con el DRS listo SHALL enviar el evento `drs`.

#### Scenario: Tecla F
- **WHEN** se pulsa F con el DRS disponible
- **THEN** el DRS se abre una sola vez aunque la tecla se mantenga pulsada

#### Scenario: Sacudida con DRS listo
- **WHEN** el volante detecta una sacudida en recta con la telemetría `drs = 1`
- **THEN** el DRS se abre una sola vez
