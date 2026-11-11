# ers Specification

## Purpose
Sistema de recuperación de energía: una batería que da potencia extra a fondo, un modo de adelantamiento que la gasta rápido y una recarga en frenada, de modo que el piloto tenga que administrarla.

## Requirements

### Requirement: Batería y despliegue base
La batería SHALL ser un valor entre 0 y 1 que empieza en 1. Con el acelerador a fondo y batería disponible, el coche SHALL desplegar automáticamente 120 kW adicionales, gastando batería en proporción.

#### Scenario: Gasto base
- **WHEN** se acelera a fondo durante 10 s con batería llena y sin pulsar adelantamiento
- **THEN** la batería baja entre 0,25 y 0,35

#### Scenario: Sin despliegue a medio gas
- **WHEN** se circula 10 s con el acelerador al 50 %
- **THEN** la batería no baja

#### Scenario: Batería agotada
- **WHEN** la batería es 0 y se acelera a fondo hasta estabilizar la velocidad
- **THEN** la velocidad punta está entre 295 y 315 km/h

### Requirement: Modo adelantamiento
Mientras se mantiene el botón de adelantamiento a fondo, el coche SHALL desplegar 60 kW más y gastar batería al triple del ritmo base. El modo MUST cortarse si la batería baja de 0,05.

#### Scenario: Gasto triple
- **WHEN** se acelera a fondo 5 s con el botón mantenido y batería llena
- **THEN** la batería baja entre 0,40 y 0,50 y el indicador de adelantamiento está activo

#### Scenario: Más aceleración
- **WHEN** se mide el tiempo de 200 a 280 km/h a fondo con y sin el botón
- **THEN** con el botón es al menos un 4 % menor

#### Scenario: Corte por batería baja
- **WHEN** la batería baja de 0,05 con el botón mantenido
- **THEN** el indicador de adelantamiento se desactiva y la potencia extra de adelantamiento desaparece

### Requirement: Recuperación
La frenada SHALL recargar la batería en proporción a la potencia de frenado, con un máximo, y cruzar la meta SHALL añadir una recarga fija pequeña. La batería nunca supera 1.

#### Scenario: Recarga en frenada
- **WHEN** con la batería a 0,5 se frena de 300 a 100 km/h
- **THEN** la batería sube entre 0,02 y 0,20

#### Scenario: Recarga por vuelta
- **WHEN** el coche cruza la meta con la batería a 0,5 sin frenar
- **THEN** la batería sube entre 0,01 y 0,06

#### Scenario: Tope
- **WHEN** se frena con la batería a 1
- **THEN** la batería sigue en 1

### Requirement: Límite de despliegue por vuelta
La energía desplegada en cada vuelta SHALL tener un máximo configurable; al alcanzarlo no hay más despliegue hasta cruzar la meta.

#### Scenario: Límite alcanzado
- **WHEN** en una vuelta se ha desplegado el máximo y se sigue a fondo con batería disponible
- **THEN** la batería deja de bajar y la potencia es solo la de combustión

#### Scenario: Reinicio en meta
- **WHEN** el coche cruza la meta tras alcanzar el límite
- **THEN** el despliegue vuelve a estar disponible

### Requirement: Controles de adelantamiento
Con teclado, mantener Espacio SHALL activar el adelantamiento; con volante, SHALL activarlo mantener el botón ERS.

#### Scenario: Espacio mantenido
- **WHEN** se mantiene Espacio a fondo con batería a 0,8
- **THEN** el indicador de adelantamiento está activo mientras dura la pulsación y se desactiva al soltar
