## ADDED Requirements

### Requirement: Selección de circuito
El juego SHALL permitir elegir el circuito en el menú y por `?track=<id>`, en práctica, carrera, pantalla dividida y online.

#### Scenario: Singapur por URL
- **WHEN** se abre `/?track=singapore&debug=1&autopilot=1&timescale=8`
- **THEN** se carga Marina Bay, el piloto de referencia completa una vuelta y no hay errores en la consola

#### Scenario: Circuito desconocido
- **WHEN** se abre `/?track=xyz`
- **THEN** se muestra un mensaje de error legible y la opción de volver al menú

#### Scenario: Online
- **WHEN** el propietario de una sala online elige Singapur
- **THEN** todos los PCs cargan Singapur antes del semáforo

### Requirement: Singapur con su trazado real
El pipeline SHALL generar `singapore.json` con el trazado de 2023 en adelante.

#### Scenario: Longitud y sentido
- **WHEN** se ejecuta `python tools/track/build_track.py --track singapore`
- **THEN** la longitud está a ±1,5 % de 4940 m, el sentido es antihorario y hay ≥ 19 curvas detectadas o declaradas

#### Scenario: Vuelta de referencia
- **WHEN** el piloto de referencia da 2 vueltas en un test de Node
- **THEN** no toca el muro y la vuelta lanzada dura entre 85 y 130 s

#### Scenario: Rivales
- **WHEN** 10 rivales de IA `medium` corren 5 vueltas en Singapur
- **THEN** todos terminan y cada uno suma ≤ 3 impactos con el muro
