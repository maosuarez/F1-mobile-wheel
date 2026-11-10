# Spec Delta

## Purpose

Cronometra las vueltas del jugador: tiempos de vuelta y de sector, mejor vuelta, delta en vivo y persistencia, con precisión mejor que un paso de simulación.

## ADDED Requirements

### Requirement: Inicio y fin de vuelta
El cronómetro SHALL empezar la vuelta 1 en el primer cruce de meta hacia delante y cerrar cada vuelta en el siguiente cruce hacia delante, interpolando el instante de cruce dentro del paso de simulación.

#### Scenario: Antes del primer cruce
- **WHEN** el coche sale de la parrilla, situada antes de la meta
- **THEN** el número de vuelta es 0 y el tiempo de vuelta es 0 hasta cruzar la meta

#### Scenario: Precisión del tiempo de vuelta
- **WHEN** un coche recorre un óvalo sintético a velocidad constante `v` conocida
- **THEN** el tiempo de vuelta difiere de `longitud / v` en menos de 0,005 s

#### Scenario: Evento de fin de vuelta
- **WHEN** se completa una vuelta
- **THEN** se notifica un evento con el número de vuelta, su tiempo, si es válida y si es la mejor

### Requirement: Vueltas completas únicamente
Un cruce de meta MUST contar como fin de vuelta solo si el coche ha pasado por los tres sectores en orden desde el cruce anterior. Los cruces hacia atrás no cuentan.

#### Scenario: Marcha atrás sobre la meta
- **WHEN** el coche cruza la meta, retrocede cruzándola hacia atrás y vuelve a cruzarla hacia delante
- **THEN** no se registra ninguna vuelta completada y el cronómetro de la vuelta en curso no se reinicia

#### Scenario: Atajo
- **WHEN** el coche se teletransporta del sector 0 al sector 2 y cruza la meta
- **THEN** no se registra una vuelta completada

### Requirement: Sectores
Cada vuelta SHALL dividirse en tres sectores según `sectors_s`, notificando el tiempo de cada uno al terminarlo.

#### Scenario: Suma de sectores
- **WHEN** se completa una vuelta
- **THEN** la suma de los tres tiempos de sector coincide con el tiempo de vuelta con error < 0,001 s

#### Scenario: Evento de sector
- **WHEN** el coche cruza `sectors_s[0]`
- **THEN** se notifica el tiempo del sector 0 y el sector actual pasa a ser 1

### Requirement: Mejor vuelta y validez
El cronómetro SHALL mantener la mejor vuelta válida. Una vuelta marcada como inválida por otro sistema MUST conservar su tiempo pero no puede convertirse en mejor vuelta; la validez se restablece al empezar la vuelta siguiente.

#### Scenario: Mejora
- **WHEN** se completan vueltas válidas de 80,0 s y 78,5 s
- **THEN** la mejor vuelta es 78,5 s

#### Scenario: Vuelta inválida más rápida
- **WHEN** la mejor es 78,5 s y se completa una vuelta de 70,0 s marcada como inválida
- **THEN** la mejor sigue siendo 78,5 s, la última vuelta es 70,0 s inválida y la vuelta siguiente empieza válida

### Requirement: Delta en vivo
Mientras exista una mejor vuelta válida de la sesión, el cronómetro SHALL exponer la diferencia entre el tiempo transcurrido de la vuelta en curso y el tiempo que llevaba la mejor vuelta en el mismo `s`.

#### Scenario: Sin referencia
- **WHEN** no hay ninguna vuelta válida completada en la sesión
- **THEN** el delta no está disponible

#### Scenario: Vuelta idéntica
- **WHEN** se repite exactamente la misma vuelta que la de referencia
- **THEN** el delta se mantiene entre −0,05 y +0,05 s durante toda la vuelta

#### Scenario: Vuelta más lenta
- **WHEN** en la vuelta en curso el coche va un 10 % más lento que en la de referencia durante el primer sector
- **THEN** el delta al final del sector 0 es positivo y aproximadamente el 10 % del tiempo de ese sector (± 20 % relativo)

### Requirement: Persistencia de la mejor vuelta
El juego SHALL guardar la mejor vuelta por circuito en el almacenamiento local del navegador y recuperarla al arrancar. Un fallo del almacenamiento MUST NOT interrumpir el juego.

#### Scenario: Recarga
- **WHEN** se completa una mejor vuelta y se recarga la página
- **THEN** el HUD muestra esa mejor vuelta antes de empezar a rodar

#### Scenario: Almacenamiento no disponible
- **WHEN** el acceso al almacenamiento local lanza una excepción
- **THEN** el juego arranca y cronometra con normalidad, sin errores en consola
