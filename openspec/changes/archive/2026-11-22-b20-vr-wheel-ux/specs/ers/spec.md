## MODIFIED Requirements

### Requirement: Controles de adelantamiento
Con teclado, mantener Espacio SHALL activar el adelantamiento; con volante, una sacudida en recta sin DRS listo SHALL alternar el adelantamiento, que se apaga al frenar.

#### Scenario: Espacio mantenido
- **WHEN** se mantiene Espacio a fondo con batería a 0,8
- **THEN** el indicador de adelantamiento está activo mientras dura la pulsación y se desactiva al soltar

#### Scenario: Sacudida en el volante
- **WHEN** con batería a 0,8 y sin DRS listo el volante detecta una sacudida en recta y se acelera a fondo
- **THEN** el indicador de adelantamiento se activa y se desactiva al pisar el freno por encima de `config.wheel.shake.ersOffBrake`
