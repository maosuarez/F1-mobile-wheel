# Spec Delta

## Purpose

Sistema de reducción de arrastre: en las rectas designadas el piloto puede abrir el alerón para ganar velocidad punta, a costa de carga, y debe cerrarlo antes de frenar.

## ADDED Requirements

### Requirement: Disponibilidad por zonas
El DRS SHALL estar disponible únicamente mientras el coche está entre `start_s` y `end_s` de una zona del circuito. Sin rivales, la detección siempre lo habilita. El estado expuesto es 0 (no disponible), 1 (disponible) o 2 (abierto).

#### Scenario: Dentro de la zona
- **WHEN** el coche entra en una zona DRS
- **THEN** el estado pasa de 0 a 1

#### Scenario: Fuera de la zona
- **WHEN** se pulsa el botón de DRS fuera de toda zona
- **THEN** el estado sigue en 0 y la aerodinámica no cambia

### Requirement: Apertura manual
Con el DRS disponible, la orden de DRS SHALL abrirlo; una segunda orden lo cierra.

#### Scenario: Abrir
- **WHEN** el estado es 1 y se da la orden de DRS
- **THEN** el estado pasa a 2 y se notifica un evento de apertura

#### Scenario: Cerrar a mano
- **WHEN** el estado es 2 y se da la orden de DRS
- **THEN** el estado pasa a 1

### Requirement: Efecto aerodinámico
Con el DRS abierto SHALL reducirse el arrastre y, en menor medida, la carga, de modo que la velocidad punta aumente entre 8 y 18 km/h.

#### Scenario: Velocidad punta con DRS
- **WHEN** se mide la velocidad estabilizada a fondo con toda la potencia disponible, con DRS cerrado y con DRS abierto en una recta sintética que es toda zona DRS
- **THEN** la diferencia está entre 8 y 18 km/h

#### Scenario: Menos carga
- **WHEN** se mide la aceleración lateral máxima a 250 km/h con DRS abierto y cerrado
- **THEN** con DRS abierto es entre un 2 % y un 10 % menor

### Requirement: Cierre automático
El DRS MUST cerrarse al pisar el freno más de un 10 % y al salir de la zona.

#### Scenario: Cierre al frenar
- **WHEN** el DRS está abierto y el freno pasa al 30 %
- **THEN** en el siguiente paso el estado ya no es 2 y se notifica un evento de cierre

#### Scenario: Cierre al salir
- **WHEN** el coche cruza `end_s` con el DRS abierto
- **THEN** el estado pasa a 0

#### Scenario: Reapertura en la misma zona
- **WHEN** tras cerrarse por freno se suelta el freno dentro de la zona y se da la orden de DRS
- **THEN** el DRS vuelve a abrirse

### Requirement: Controles de DRS
Con teclado, la tecla F SHALL dar la orden de DRS; con volante, el botón DRS SHALL enviar el evento `drs`.

#### Scenario: Tecla F
- **WHEN** se pulsa F con el DRS disponible
- **THEN** el DRS se abre una sola vez aunque la tecla se mantenga pulsada
