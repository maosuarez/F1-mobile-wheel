# track-catalog Specification

## Purpose
TBD - created by archiving change b17-spa. Update Purpose after archive.

## Requirements

### Requirement: Selección de circuito
El juego SHALL permitir elegir el circuito en el menú y por `?track=<id>`, en práctica, carrera, pantalla dividida y online.

#### Scenario: Spa por URL
- **WHEN** se abre `/?track=spa&debug=1&autopilot=1&timescale=8`
- **THEN** se carga Spa, el piloto de referencia completa una vuelta y no hay errores en la consola

#### Scenario: Selector en el menú
- **WHEN** el jugador elige Spa en el menú
- **THEN** la página se recarga con `?track=spa`, la elección queda recordada y la siguiente apertura sin parámetro carga Spa

#### Scenario: Circuito desconocido
- **WHEN** se abre `/?track=xyz`
- **THEN** se muestra un mensaje de error legible y la opción de volver al menú

#### Scenario: Online
- **WHEN** el propietario de una sala online elige Spa
- **THEN** todos los PCs cargan Spa antes del semáforo

#### Scenario: Interlagos sin cambios
- **WHEN** se abre `/` sin parámetro ni elección recordada
- **THEN** se carga Interlagos como antes

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
