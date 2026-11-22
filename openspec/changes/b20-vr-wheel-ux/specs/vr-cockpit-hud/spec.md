## Purpose

Información de conducción y de carrera dentro del visor VR: instrumentos en la pantalla del volante del habitáculo, panel flotante de carrera y calibración del volante del celular antes de la salida.

## ADDED Requirements

### Requirement: Instrumentos en el volante 3D
En una sesión VR con la cámara de casco, la pantalla del volante del coche del jugador SHALL mostrar velocidad (km/h), marcha, tiempo de vuelta en curso, delta y el estado de DRS y ERS, redibujada a `config.vr.hudRedrawHz`. Fuera de VR o con otra cámara, la pantalla del volante MUST seguir como antes (emisiva sin texto). El dibujo MUST NOT añadir más de 1 draw call ni más de 1 textura.

#### Scenario: Lectura en primera persona
- **WHEN** en VR con cámara de casco el coche rueda a 200 km/h en 6.ª
- **THEN** las instrucciones de dibujo de la pantalla del volante incluyen `200` y `6`, y el tiempo de vuelta con formato `m:ss.mmm`

#### Scenario: Fuera de VR
- **WHEN** se juega en escritorio
- **THEN** la pantalla del volante no tiene textura de instrumentos y los draw calls no cambian respecto a antes del change (± 0)

### Requirement: Panel de carrera en VR
En VR y en modos de carrera (IA u online), el panel flotante SHALL mostrar posición/total, vuelta, diferencias delante/detrás y una torre de hasta 6 filas centrada en el jugador (humanos online con las 3 primeras letras de su nombre). Con cámara de casco MUST NOT mostrar velocidad ni tiempos, y en práctica con casco MUST NOT mostrarse.

#### Scenario: Online en VR
- **WHEN** en una carrera online de 3 humanos y 3 rivales IA el jugador va 4.º con cámara de casco
- **THEN** el panel muestra `P4/6`, la vuelta, las dos diferencias y 6 filas en la torre con los códigos de los humanos derivados de sus nombres, y no muestra la velocidad

#### Scenario: Práctica en primera persona
- **WHEN** en VR se rueda en Práctica con cámara de casco
- **THEN** el panel flotante no es visible

### Requirement: Calibración antes de la salida en VR
En VR con el volante del celular controlando al jugador y fuera de online, antes de cada cuenta atrás o semáforo el juego SHALL esperar la calibración: la telemetría lleva `cal = true`, el panel VR muestra "CALIBRA EL VOLANTE EN EL CELULAR" y la salida empieza al recibir el evento `recal`. Enter o el botón A del mando de Quest SHALL saltarse la espera. En online la telemetría SHALL llevar `cal = true` durante el vestíbulo y la cuenta atrás sin bloquear la salida. Sin VR MUST NOT haber espera.

#### Scenario: Calibrar y salir
- **WHEN** en VR con volante conectado se elige Carrera
- **THEN** la cuenta atrás no empieza hasta llegar `ev` `recal`, y empieza en menos de 200 ms después

#### Scenario: Reinicio
- **WHEN** en VR se reinicia la carrera desde el volante
- **THEN** se vuelve a pedir la calibración antes del semáforo

#### Scenario: Escritorio
- **WHEN** se juega sin VR con volante
- **THEN** la cuenta atrás empieza como antes y la telemetría no trae `cal`
