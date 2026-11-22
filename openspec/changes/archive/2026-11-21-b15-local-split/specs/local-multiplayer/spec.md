## ADDED Requirements

### Requirement: Dos jugadores en el mismo PC
El juego SHALL permitir 2 jugadores humanos locales en práctica y en carrera, con o sin rivales de IA.

#### Scenario: Por URL
- **WHEN** se abre `/?players=2&mode=race&rivals=8`
- **THEN** la carrera tiene 10 coches, 2 de ellos humanos, en cajones distintos

### Requirement: Emparejamiento de un volante por jugador
Cada jugador SHALL poder emparejar su propio celular con un código y un QR propios, sin cambios en el relay.

#### Scenario: Dos volantes
- **WHEN** dos volantes simulados (`tools/fake_wheel.py`) se conectan a las dos salas mostradas
- **THEN** cada uno controla solo su coche y la pantalla de emparejamiento marca J1 y J2 como conectados

#### Scenario: Desconexión
- **WHEN** el volante de J2 se desconecta en carrera
- **THEN** el juego se pausa para ambos con el aviso "Volante J2 desconectado"

### Requirement: Controles separados
Sin celular, J1 SHALL usar WASD + Q/E/F y J2 flechas + `,`/`.`/`/` (ERS `ShiftDerecho`), o el mando de su índice.

#### Scenario: Teclas independientes
- **WHEN** se pulsa `ArrowUp` en modo de 2 jugadores
- **THEN** solo acelera J2

#### Scenario: Un jugador sin cambios
- **WHEN** hay 1 jugador
- **THEN** WASD y flechas controlan el mismo coche como antes

### Requirement: Pantalla dividida con HUD propio
La pantalla SHALL dividirse arriba (J1) y abajo (J2), cada mitad con su cámara, HUD, minimapa y avisos, y una torre compartida.

#### Scenario: Vistas independientes
- **WHEN** J1 cambia de cámara con su control
- **THEN** solo cambia la mitad superior

#### Scenario: Rendimiento
- **WHEN** se corre con 2 jugadores y 8 rivales a 1920×1080
- **THEN** el total de draw calls por fotograma es ≤ 320 y la calidad es como máximo `medium`

### Requirement: Resultados con ambos jugadores
La tabla de resultados SHALL identificar a cada jugador local.
#### Scenario: Tabla final
- **WHEN** termina una carrera de 2 jugadores
- **THEN** la tabla de resultados resalta las filas de J1 y J2 con sus colores
