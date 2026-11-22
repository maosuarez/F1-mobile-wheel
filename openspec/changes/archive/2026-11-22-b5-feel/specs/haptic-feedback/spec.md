# Spec Delta

## Purpose

Traduce lo que le pasa al coche en vibraciones del volante: el PC decide qué efecto enviar y cuándo, a partir de los eventos y el estado de la simulación.

## ADDED Requirements

### Requirement: Efectos por evento
El PC SHALL enviar al volante un `fx` `shift` en cada cambio de marcha y un `fx` `limits` al invalidarse la vuelta, al rechazarse una reducción y al chocar con un muro.

#### Scenario: Cambio de marcha
- **WHEN** la simulación notifica un cambio de marcha con volante conectado
- **THEN** se envía exactamente un `{"t":"fx","k":"shift"}`

#### Scenario: Reducción rechazada
- **WHEN** la simulación rechaza una reducción
- **THEN** se envía un `fx` `limits`

### Requirement: Efectos continuos
Mientras el coche circule a más de 20 km/h sobre un piano, sobre hierba o en el limitador, el PC SHALL repetir el `fx` correspondiente (`kerb` cada 120 ms, `grass` cada 300 ms, `limiter` cada 100 ms) y dejar de enviarlo al cesar la condición.

#### Scenario: Piano
- **WHEN** el coche circula 1 s sobre un piano a 100 km/h
- **THEN** se envían entre 7 y 9 `fx` `kerb`, y ninguno más tras volver al asfalto

#### Scenario: Parado en la hierba
- **WHEN** el coche está detenido sobre la hierba
- **THEN** no se envía ningún `fx`

#### Scenario: Limitador
- **WHEN** el coche permanece 1 s en el limitador
- **THEN** se envían entre 8 y 11 `fx` `limiter`

### Requirement: Caudal acotado y solo con volante
El PC MUST enviar como máximo un `fx` cada 80 ms, dando prioridad a `limits` sobre `shift` y a estos sobre los continuos, y no enviar ninguno sin volante conectado ni en pausa.

#### Scenario: Coincidencia de efectos
- **WHEN** en el mismo paso se produce un cambio de marcha estando sobre un piano
- **THEN** se envía `shift` y el `kerb` se retrasa al siguiente hueco

#### Scenario: Sin volante
- **WHEN** se juega con teclado
- **THEN** no se envía ningún `fx`
