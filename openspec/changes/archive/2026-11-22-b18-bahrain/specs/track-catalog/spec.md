## ADDED Requirements

### Requirement: Iluminación y suelo por circuito
El catálogo SHALL declarar por circuito la iluminación (`day`|`night`), el HDRI y el suelo (`grass`|`sand`), y la escena SHALL aplicarlos.

#### Scenario: Bahréin por URL
- **WHEN** se abre `/?track=bahrain&debug=1&autopilot=1&timescale=8`
- **THEN** se carga Bahréin de noche con suelo de arena, el piloto de referencia completa una vuelta y no hay errores en la consola

#### Scenario: Selector
- **WHEN** el jugador abre el menú
- **THEN** la fila "Circuito" ofrece Interlagos, Spa-Francorchamps y Bahréin

#### Scenario: Desierto sin árboles
- **WHEN** se construye la escena de un circuito con `ground: 'sand'`
- **THEN** no se instancian árboles y el terreno usa la textura de arena
