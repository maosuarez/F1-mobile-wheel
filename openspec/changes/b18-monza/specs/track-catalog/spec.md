## ADDED Requirements

### Requirement: Monza con su trazado real
El juego SHALL incluir Monza en el catálogo con su trazado real, nombres de curvas y entorno.

#### Scenario: Datos
- **WHEN** se ejecutan `build_track.py --track monza` y `build_world.py --track monza`
- **THEN** la longitud está a ±1 % de 5793 m, el sentido es horario, las curvas 1, 4, 6, 8 y 11 tienen los nombres del design y el mundo contiene bosque y al menos un `disused_track`

#### Scenario: Vuelta de referencia
- **WHEN** el piloto de referencia da 2 vueltas en Monza en un test de Node
- **THEN** no toca el muro y la vuelta lanzada dura entre 75 y 110 s

#### Scenario: En el navegador
- **WHEN** se abre `/?track=monza&debug=1&mode=race&rivals=9&autopilot=1&timescale=8`
- **THEN** la carrera termina con resultados, draw calls ≤ 200 y sin errores de consola

### Requirement: Escala aerodinámica por circuito
Cada circuito MAY declarar una escala de resistencia y carga aerodinámica; la simulación, el piloto de referencia y los rivales SHALL usar la misma escala.

#### Scenario: Baja carga en Monza
- **WHEN** se mide la velocidad punta en la recta principal con el piloto de referencia en Monza y con escala 1/1
- **THEN** con la escala de Monza es al menos 8 km/h mayor

#### Scenario: Sin escala
- **WHEN** un circuito no declara `aero`
- **THEN** los resultados de física son idénticos a los anteriores (tests existentes en verde)
