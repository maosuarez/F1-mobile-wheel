# Spec Delta

## Purpose

Sonido procedural del motor híbrido: el jugador oye las revoluciones, el acelerador, los cambios y el limitador sin archivos de audio, con un ciclo de vida respetuoso con el navegador.

## ADDED Requirements

### Requirement: Tono ligado a las RPM
La frecuencia fundamental del motor SHALL ser la de encendido de un V6, `rpm / 60 × 3`, siguiendo las RPM sin saltos audibles.

#### Scenario: Frecuencias de referencia
- **WHEN** las RPM son 4 000 y 12 000
- **THEN** la frecuencia fundamental es 200 Hz y 600 Hz respectivamente (± 1 %)

#### Scenario: Seguimiento suave
- **WHEN** las RPM caen 3 000 rpm de un paso al siguiente por un cambio de marcha
- **THEN** la frecuencia aplicada alcanza el nuevo valor en menos de 80 ms sin discontinuidad de fase audible (rampa, no salto)

### Requirement: Timbre y volumen según el acelerador
Con más acelerador el sonido SHALL ser más brillante y más fuerte; en vacío, más suave y áspero. El ruido de viento SHALL crecer con la velocidad.

#### Scenario: Brillo
- **WHEN** el acelerador pasa de 0 a 1 a RPM constantes
- **THEN** la frecuencia de corte del filtro crece de forma monótona y al final es al menos el triple que al principio

#### Scenario: Volumen
- **WHEN** se comparan acelerador 0 y acelerador 1 a 10 000 rpm
- **THEN** la ganancia del motor a fondo es al menos el doble que en vacío y nunca supera 1

#### Scenario: Viento
- **WHEN** la velocidad pasa de 50 a 300 km/h
- **THEN** la ganancia del viento crece de forma monótona y a 50 km/h es menor del 10 % de la de 300 km/h

### Requirement: Cambio y limitador
Cada cambio de marcha SHALL producir una caída breve del volumen del motor y un chasquido corto. En el limitador el volumen SHALL modularse a unos 15 Hz.

#### Scenario: Cambio
- **WHEN** llega un evento de cambio de marcha
- **THEN** la ganancia del motor baja al menos un 50 % durante 40 ± 15 ms y se dispara un chasquido de menos de 80 ms

#### Scenario: Limitador
- **WHEN** el coche permanece en el limitador
- **THEN** la ganancia se modula con una frecuencia entre 12 y 18 Hz mientras dure

### Requirement: Ciclo de vida del audio
El contexto de audio MUST crearse solo tras el primer gesto del usuario. El sonido SHALL silenciarse en pausa, reanudarse al continuar, y poder silenciarse con la tecla V, recordando la preferencia.

#### Scenario: Antes del primer gesto
- **WHEN** se carga la página sin interactuar
- **THEN** no existe contexto de audio y la consola no muestra avisos de reproducción automática

#### Scenario: Tras empezar
- **WHEN** se pulsa una tecla para empezar y se acelera
- **THEN** el contexto está en estado `running` y el nivel RMS medido de la salida es > 0,01

#### Scenario: Pausa
- **WHEN** el juego se pausa
- **THEN** el nivel RMS de la salida cae por debajo de 0,001 en menos de 0,3 s y se recupera al reanudar

#### Scenario: Silencio recordado
- **WHEN** se pulsa V y se recarga la página
- **THEN** el juego arranca silenciado y una nueva pulsación de V devuelve el sonido

### Requirement: Sonido sin artefactos
Los cambios de parámetros SHALL aplicarse con rampas para evitar chasquidos, y la salida MUST NOT saturar.

#### Scenario: Sin saturación
- **WHEN** se rueda una vuelta completa con el piloto de referencia
- **THEN** el pico absoluto de la señal de salida medida no supera 0,98
