# Spec Delta

## Purpose

Piloto automático determinista que conduce el coche usando solo el estado de la simulación y los datos de pista. Sirve como prueba automática de que el circuito es completable y como guía de entrada para pruebas de extremo a extremo.

## ADDED Requirements

### Requirement: Vuelta completa sin intervención
El piloto de referencia SHALL completar vueltas de Interlagos desde la parrilla sin tocar los muros y sin salir del asfalto y los pianos.

#### Scenario: Dos vueltas en simulación sin render
- **WHEN** el piloto de referencia conduce desde la parrilla durante 2 vueltas completas en un test de Node
- **THEN** no se produce ningún impacto con el muro, la superficie nunca es `grass`, y ambas vueltas se registran como completadas

#### Scenario: Tiempo de vuelta plausible
- **WHEN** se mide la segunda vuelta (lanzada)
- **THEN** su tiempo está entre 62 y 105 s

### Requirement: Robustez ante latencia
El piloto de referencia MUST seguir completando la vuelta cuando sus órdenes llegan a la simulación con 100 ms de retraso, que es el peor caso previsto al usarlo a través de la red.

#### Scenario: Entrada retrasada
- **WHEN** las órdenes del piloto se aplican con 12 pasos de retraso (100 ms) durante 2 vueltas
- **THEN** no hay impactos con el muro y ambas vueltas se completan

### Requirement: Determinismo del piloto
Las órdenes del piloto SHALL depender únicamente del estado de la simulación y de la pista.

#### Scenario: Repetición
- **WHEN** se ejecuta dos veces la misma prueba de 2 vueltas
- **THEN** los tiempos de vuelta son idénticos

### Requirement: Uso en el juego para pruebas
El juego SHALL poder arrancar con el piloto de referencia como fuente de entrada mediante un parámetro de URL, para verificar el juego completo sin intervención humana.

#### Scenario: Vuelta en el navegador
- **WHEN** se abre el juego con `?debug=1&autopilot=1&timescale=8`
- **THEN** el coche completa una vuelta cronometrada sin intervención, el HUD muestra la última vuelta y no hay errores en la consola
