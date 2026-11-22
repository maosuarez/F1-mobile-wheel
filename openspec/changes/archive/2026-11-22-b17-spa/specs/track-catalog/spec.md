## ADDED Requirements

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
