# race-presentation Specification

## Purpose
TBD - created by archiving change b14-race-ai. Update Purpose after archive.

## Requirements

### Requirement: Menú de modo
Antes de empezar SHALL poder elegirse Práctica o Carrera de 5 vueltas, la dificultad y el número de rivales (1–9), con ratón, teclado, mando o volante, recordando la última elección. El menú SHALL presentarse con estética de retransmisión de F1: el modo como tarjetas grandes seleccionables, el circuito como tarjeta con nombre, país e indicador día/noche, y un botón de salida destacado. MUST NOT usar logos, tipografías ni nombres de marcas registradas. El menú MUST ser usable sin desplazamiento horizontal desde 360 px de ancho.

#### Scenario: Por URL
- **WHEN** se abre `/?mode=race&rivals=5&ai=hard`
- **THEN** la carrera empieza con 6 coches y rivales de nivel difícil

#### Scenario: Práctica sin cambios
- **WHEN** se elige Práctica
- **THEN** el comportamiento es el anterior a este change (un coche, cuenta atrás de 3 s, DRS siempre disponible en zona)

#### Scenario: Mismas entradas tras el rediseño
- **WHEN** en el menú se pulsa Carrera con el ratón, flecha izquierda en la fila Dificultad y Enter
- **THEN** la dificultad baja un nivel, la elección queda marcada con `aria-pressed="true"` y la carrera arranca con esa elección

#### Scenario: Pantalla estrecha
- **WHEN** el menú se muestra en una ventana de 360×740 px
- **THEN** `document.documentElement.scrollWidth` ≤ 360 y el botón Empezar es visible sin desplazamiento horizontal

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

### Requirement: Acceso al volante desde el celular
En un dispositivo táctil sin hover que no sea el navegador de un visor VR SHALL mostrarse el botón fijo "Usar este celular como volante" y una tarjeta equivalente dentro del menú, ambos enlazando a `/wheel/`. La detección MUST NOT depender de que el navegador declare soporte `immersive-vr`. En escritorio y en visores VR MUST NOT mostrarse ninguno de los dos.

#### Scenario: Android con WebXR
- **WHEN** se abre `/` en un celular Android táctil cuyo navegador declara soporte `immersive-vr`
- **THEN** el botón fijo y la tarjeta del menú son visibles y enlazan a `/wheel/`

#### Scenario: Visor VR
- **WHEN** se abre `/` en un navegador cuyo user agent contiene `OculusBrowser` o `Pico`
- **THEN** ni el botón fijo ni la tarjeta del menú son visibles

#### Scenario: Escritorio
- **WHEN** se abre `/` con puntero fino y hover
- **THEN** ni el botón fijo ni la tarjeta del menú son visibles
