# Spec Delta

## Purpose

Hace cumplir los límites de pista: salirse del asfalto y los pianos invalida la vuelta, además de la pérdida de agarre que ya impone la superficie.

## ADDED Requirements

### Requirement: Invalidación por salida de pista
Si el centro del coche supera el borde de la pista en más de 1 m (la mitad del ancho del coche), la vuelta en curso SHALL quedar invalidada, notificando un evento y mostrando el aviso `LÍMITES` durante 3 s.

#### Scenario: Salida por el exterior
- **WHEN** durante una vuelta cronometrada el coche alcanza `d = wl + 1,2`
- **THEN** la vuelta pasa a inválida y se notifica un evento de límites

#### Scenario: Sobre el piano
- **WHEN** el coche circula con `d = wl + 0,8`
- **THEN** la vuelta sigue siendo válida

#### Scenario: Un evento por excursión
- **WHEN** el coche permanece 2 s fuera de los límites
- **THEN** se notifica un único evento, y solo se notifica otro si vuelve dentro de los bordes y sale de nuevo

### Requirement: Consecuencias de la vuelta inválida
Una vuelta inválida SHALL conservar su tiempo, mostrarse tachada, no contar como mejor vuelta ni como referencia del delta, y la vuelta siguiente SHALL empezar válida.

#### Scenario: Vuelta inválida completada
- **WHEN** se completa una vuelta invalidada más rápida que la mejor
- **THEN** la mejor vuelta no cambia y la última vuelta se muestra tachada

#### Scenario: Nueva vuelta
- **WHEN** se cruza la meta tras una vuelta inválida
- **THEN** la vuelta nueva es válida

#### Scenario: Antes de la primera vuelta
- **WHEN** el coche sale de los límites antes de cruzar la meta por primera vez
- **THEN** no se invalida ninguna vuelta y la vuelta 1 empieza válida
