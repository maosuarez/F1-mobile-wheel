# vehicle-dynamics Specification

## Purpose
Describe cómo se comporta físicamente el monoplaza: debe sentirse como un F1 (más agarre cuanto más rápido, frenadas brutales) con un modelo arcade determinista. Los escenarios se miden sobre pista sintética recta y llana salvo que indiquen otra cosa.

## Requirements

### Requirement: Simulación determinista a paso fijo
La simulación SHALL avanzar exactamente 1/120 s por paso y MUST producir el mismo estado, bit a bit, para la misma secuencia de entradas, sin depender del reloj, de números aleatorios no sembrados ni del render.

#### Scenario: Repetición idéntica
- **WHEN** se ejecutan dos simulaciones de 6 000 pasos con la misma secuencia de entradas variadas (aceleración, frenada y dirección)
- **THEN** los estados finales son iguales con comparación estricta de todos los campos numéricos

#### Scenario: Estado siempre finito
- **WHEN** se simulan 20 000 pasos con entradas aleatorias sembradas en Interlagos, incluyendo salidas de pista y choques con el muro
- **THEN** ningún campo del estado es `NaN` ni infinito

### Requirement: Velocidad punta
Con acelerador a fondo en llano y toda la potencia disponible, el coche SHALL estabilizarse entre 315 y 335 km/h.

#### Scenario: Recta larga
- **WHEN** se acelera a fondo durante 60 s desde parado con toda la potencia disponible
- **THEN** la velocidad final está entre 315 y 335 km/h y varía menos de 0,5 km/h en el último segundo

### Requirement: Aceleración
La aceleración SHALL estar limitada por tracción a baja velocidad y por potencia a alta velocidad.

#### Scenario: De 0 a 100 km/h
- **WHEN** se acelera a fondo desde parado
- **THEN** se alcanzan 100 km/h en un tiempo entre 2,2 y 3,2 s

#### Scenario: De 0 a 200 km/h
- **WHEN** se acelera a fondo desde parado
- **THEN** se alcanzan 200 km/h en menos de 6,5 s

#### Scenario: Aceleración limitada por tracción
- **WHEN** se acelera a fondo a menos de 60 km/h
- **THEN** la aceleración longitudinal no supera 1,4 g

### Requirement: Frenada dependiente de la carga
La deceleración máxima SHALL crecer con la velocidad gracias a la carga aerodinámica y al arrastre.

#### Scenario: Distancia de 300 a 80 km/h
- **WHEN** se frena al 100 % desde 300 km/h
- **THEN** la distancia recorrida hasta 80 km/h está entre 90 y 140 m

#### Scenario: Pico de deceleración
- **WHEN** se frena al 100 % a 280 km/h
- **THEN** la deceleración está entre 4,0 y 5,8 g

#### Scenario: Frenada a baja velocidad
- **WHEN** se frena al 100 % a 80 km/h
- **THEN** la deceleración está entre 1,2 y 2,2 g

#### Scenario: Parada completa
- **WHEN** se mantiene el freno hasta detener el coche
- **THEN** la velocidad queda en 0 y el coche no retrocede ni oscila

### Requirement: Agarre lateral dependiente de la velocidad
La aceleración lateral máxima sostenible SHALL aumentar con la velocidad por la carga aerodinámica.

#### Scenario: Agarre a 250 km/h
- **WHEN** se mantiene 250 km/h en una explanada llana y se gira al máximo
- **THEN** la aceleración lateral sostenida está entre 3,5 y 4,8 g

#### Scenario: Agarre a 100 km/h
- **WHEN** se mantiene 100 km/h y se gira al máximo
- **THEN** la aceleración lateral sostenida está entre 1,7 y 2,5 g

### Requirement: Círculo de fricción
La aceleración combinada longitudinal y lateral MUST quedar limitada por el agarre disponible; frenar y girar a la vez reduce lo que se puede hacer de cada cosa.

#### Scenario: Frenada en apoyo
- **WHEN** a 200 km/h se aplican freno al 100 % y dirección al máximo durante 0,5 s
- **THEN** el módulo de la aceleración debida a los neumáticos no supera en más de un 5 % el agarre disponible en cada paso, y la aceleración lateral es menor que girando sin frenar

### Requirement: Dirección sensible a la velocidad
El ángulo máximo de las ruedas SHALL reducirse con la velocidad (de 16° en parado a 3,5° a partir de 306 km/h) y la entrada de dirección SHALL suavizarse con una constante de tiempo de unos 60 ms, para que el coche sea controlable a alta velocidad.

#### Scenario: Volantazo a 300 km/h
- **WHEN** a 300 km/h se pasa la dirección de 0 a 1 de golpe y se mantiene 2 s sin acelerar
- **THEN** el ángulo entre el rumbo y la velocidad no supera 8° y el coche no hace un trompo

#### Scenario: Suavizado de la entrada
- **WHEN** la dirección pasa de 0 a 1 de golpe
- **THEN** el ángulo de rueda alcanza el 63 % de su valor final entre 40 y 90 ms después

#### Scenario: Giro cerrado a baja velocidad
- **WHEN** se circula a 40 km/h con la dirección al máximo
- **THEN** el radio de giro está entre 10 y 20 m

#### Scenario: Signo de la dirección
- **WHEN** se avanza hacia +X con dirección positiva
- **THEN** el coche se desvía hacia su derecha (`d` decrece en una recta sintética)

### Requirement: Subviraje al exceder el agarre
Si el giro pedido exige más aceleración lateral que la disponible, el coche SHALL abrir la trazada en vez de girar más.

#### Scenario: Exceso de velocidad en curva
- **WHEN** se entra a 200 km/h en la curva de 60 m de radio de un óvalo sintético con la dirección al máximo
- **THEN** el coche no sigue la curva y sale por el exterior

### Requirement: Superficies
El agarre y la resistencia SHALL depender de la superficie: asfalto (agarre 1,00), piano (0,85) y hierba (0,45 y resistencia a la rodadura 6 veces mayor).

#### Scenario: Giro en hierba
- **WHEN** se mide la aceleración lateral máxima sostenida a 100 km/h en hierba y en asfalto
- **THEN** la de hierba está entre el 35 % y el 55 % de la de asfalto

#### Scenario: Hierba frena el coche
- **WHEN** se suelta el acelerador a 60 km/h en hierba y en asfalto durante 2 s
- **THEN** la pérdida de velocidad en hierba es al menos el doble que en asfalto

#### Scenario: Piano
- **WHEN** se mide la aceleración lateral máxima sostenida a 100 km/h sobre piano
- **THEN** está entre el 80 % y el 90 % de la de asfalto

### Requirement: Pendientes
La gravedad SHALL actuar a lo largo de la pendiente de la pista, y la altura del coche SHALL seguir la superficie.

#### Scenario: Frenada cuesta abajo
- **WHEN** se frena de 200 a 80 km/h en una recta con pendiente −0,08 y en una llana
- **THEN** la distancia cuesta abajo es entre un 2 % y un 20 % mayor

#### Scenario: Rodar cuesta arriba
- **WHEN** se suelta el acelerador a 100 km/h en una recta con pendiente +0,08
- **THEN** el coche pierde velocidad más rápido que en llano

#### Scenario: Altura sobre la pista
- **WHEN** el coche circula por Interlagos
- **THEN** su altura coincide con la de la pista en su `s` con error < 0,05 m en todo paso

### Requirement: Muros
El coche MUST permanecer dentro de los muros (borde + `runoff_m`). Un impacto SHALL eliminar la velocidad hacia el muro con restitución 0,3, restar al menos un 15 % de la velocidad y girar levemente el coche alejándolo del muro.

#### Scenario: Impacto lateral
- **WHEN** el coche llega al muro a 150 km/h con un ángulo de 20°
- **THEN** `|d|` nunca supera la distancia al muro en más de 0,05 m, la velocidad tras el impacto es al menos un 15 % menor, y se notifica un evento de impacto

#### Scenario: Recuperación
- **WHEN** tras el impacto se acelera con la dirección hacia la pista
- **THEN** el coche se separa del muro y vuelve al asfalto

### Requirement: Estado observable para otros sistemas
La simulación SHALL exponer en cada paso posición, rumbo, velocidad, aceleraciones longitudinal y lateral, ángulo de rueda, `s`, `d`, superficie y deslizamiento, y SHALL notificar eventos discretos (impacto, cambio de superficie).

#### Scenario: Fuerzas g coherentes
- **WHEN** el coche frena en recta a 4 g
- **THEN** la aceleración longitudinal expuesta es −4 g ± 5 % y la lateral es 0 ± 0,05 g

#### Scenario: Evento de superficie
- **WHEN** el coche pasa de asfalto a hierba
- **THEN** se notifica un único evento de cambio de superficie con valor `grass`
