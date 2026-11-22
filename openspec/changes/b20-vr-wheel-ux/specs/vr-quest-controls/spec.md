## MODIFIED Requirements

### Requirement: Leyenda y código en el panel VR
La pantalla `pairing` del panel VR SHALL mostrar el código de sala con tamaño de fuente ≥ 150 px de lienzo, el texto "A = EMPEZAR" y una leyenda del mapeo. La pantalla `paused` SHALL mostrar la misma leyenda.

#### Scenario: Leyenda
- **WHEN** `drawScreen({kind:'pairing', ...})`
- **THEN** los ops incluyen textos con ids `legendStart` y `legendDrs`, y el texto `room` tiene `size >= 150`

#### Scenario: Pausa
- **WHEN** `drawScreen({kind:'paused'})`
- **THEN** los ops incluyen el id `legendDrs`
