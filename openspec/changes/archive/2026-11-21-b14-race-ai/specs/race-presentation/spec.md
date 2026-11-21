## ADDED Requirements

### Requirement: Menú de modo
Antes de empezar SHALL poder elegirse Práctica o Carrera de 5 vueltas, la dificultad y el número de rivales (1–9), con ratón, teclado, mando o volante, recordando la última elección.

#### Scenario: Por URL
- **WHEN** se abre `/?mode=race&rivals=5&ai=hard`
- **THEN** la carrera empieza con 6 coches y rivales de nivel difícil

#### Scenario: Práctica sin cambios
- **WHEN** se elige Práctica
- **THEN** el comportamiento es el anterior a este change (un coche, cuenta atrás de 3 s, DRS siempre disponible en zona)

### Requirement: Rivales visibles dentro del presupuesto
Los rivales SHALL dibujarse con su librea y ruedas animadas usando instanciado.

#### Scenario: Draw calls
- **WHEN** hay 9 rivales en pantalla en la parrilla
- **THEN** los rivales suman ≤ 4 draw calls (sin contar sombras) y el total de la escena es ≤ 200

### Requirement: HUD de carrera y resultados
El HUD SHALL mostrar posición, vuelta x/5, diferencias con delante y detrás y la torre de clasificación; al terminar SHALL mostrarse la tabla de resultados.

#### Scenario: Carrera automática en el navegador
- **WHEN** se abre `/?debug=1&mode=race&rivals=9&autopilot=1&timescale=8`
- **THEN** se ven las 5 luces, el HUD muestra "P" y "V 1/5", la carrera termina con la pantalla de resultados de 10 filas y no hay errores en la consola

### Requirement: Información de carrera en el volante, minimapa, audio y VR
La posición y los rivales SHALL reflejarse en el volante, el minimapa, el audio y el panel VR.

#### Scenario: Volante
- **WHEN** hay una carrera en curso con el volante conectado
- **THEN** la telemetría incluye `pos` y `laps` y el volante muestra "P<n> · V<x>/5"

#### Scenario: Minimapa
- **WHEN** un rival está dentro del recorte del minimapa
- **THEN** aparece como un punto del color de su escudería

#### Scenario: Sonido de rivales
- **WHEN** un rival está a menos de 80 m
- **THEN** su motor suena posicionado (como máximo 2 rivales a la vez)
