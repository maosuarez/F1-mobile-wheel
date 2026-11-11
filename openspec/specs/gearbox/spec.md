# gearbox Specification

## Purpose
Caja de cambios secuencial de un monoplaza: el piloto sube y baja marchas en el momento justo, con RPM, limitador y protecciones que hacen que cambiar bien importe.

## Requirements

### Requirement: Marchas secuenciales
El coche SHALL tener marcha atrás (−1), punto muerto (0) y 8 marchas hacia delante, que se recorren de una en una con las órdenes de subir y bajar. Las marchas alcanzan el limitador a unos 95, 130, 160, 190, 225, 260, 300 y 350 km/h. El coche sale de la parrilla en 1.ª.

#### Scenario: Subir marcha
- **WHEN** se ordena subir en 3.ª a 150 km/h
- **THEN** la marcha pasa a 4.ª y las RPM bajan en proporción a las relaciones (± 3 %)

#### Scenario: Tope superior
- **WHEN** se ordena subir en 8.ª
- **THEN** la marcha sigue siendo 8.ª

#### Scenario: Velocidad máxima por marcha
- **WHEN** se acelera a fondo en 2.ª sin cambiar
- **THEN** la velocidad se estabiliza entre 124 y 132 km/h con las RPM en el limitador

### Requirement: RPM y limitador
Las RPM SHALL ser proporcionales a la velocidad en la marcha engranada, entre el ralentí (4 000) y el limitador (12 500). En el limitador se corta la potencia.

#### Scenario: Ralentí
- **WHEN** el coche está parado en 1.ª
- **THEN** las RPM son 4 000 ± 100

#### Scenario: Limitador
- **WHEN** las RPM alcanzan 12 500 con acelerador a fondo
- **THEN** las RPM no superan 12 500, la aceleración deja de ser positiva y se notifica un evento de limitador una sola vez por entrada en el limitador

#### Scenario: Punto muerto
- **WHEN** se acelera a fondo en punto muerto
- **THEN** las RPM suben hacia el limitador y el coche no gana velocidad

### Requirement: Entrega de potencia según las RPM
La potencia SHALL ser máxima entre 9 000 y 12 000 rpm y menor por debajo, de modo que ir en una marcha demasiado larga penaliza la aceleración.

#### Scenario: Marcha demasiado larga
- **WHEN** se acelera a fondo de 150 a 200 km/h en 8.ª y, en otra prueba, en 5.ª
- **THEN** en 8.ª se tarda al menos un 25 % más

#### Scenario: Aceleración con cambios correctos
- **WHEN** se acelera a fondo desde parado con cambio automático
- **THEN** se alcanzan 100 km/h entre 2,4 y 3,2 s y 200 km/h en menos de 6,5 s

### Requirement: Corte de potencia al cambiar
Cada cambio de marcha SHALL interrumpir la potencia durante 40 ms y notificar un evento de cambio.

#### Scenario: Corte
- **WHEN** se sube de marcha con acelerador a fondo a 150 km/h
- **THEN** la fuerza motriz es 0 durante 40 ± 9 ms y se notifica un evento de cambio con la marcha de origen y la de destino

### Requirement: Protección de reducción
Una reducción que llevaría las RPM por encima del limitador + 500 MUST rechazarse: la marcha no cambia y se notifica el rechazo.

#### Scenario: Reducción rechazada
- **WHEN** se ordena bajar de 8.ª a 7.ª a 320 km/h
- **THEN** la marcha sigue siendo 8.ª y se notifica un evento de reducción rechazada

#### Scenario: Reducción aceptada
- **WHEN** se ordena bajar de 8.ª a 7.ª a 250 km/h
- **THEN** la marcha pasa a 7.ª

### Requirement: Marcha atrás y punto muerto
La marcha atrás SHALL engranarse solo desde punto muerto y por debajo de 5 km/h. En marcha atrás el coche retrocede con velocidad limitada.

#### Scenario: Engranar marcha atrás parado
- **WHEN** el coche está parado en 1.ª y se ordena bajar dos veces
- **THEN** la marcha pasa a punto muerto y luego a marcha atrás, y al acelerar el coche retrocede sin superar 60 km/h

#### Scenario: Marcha atrás rechazada en movimiento
- **WHEN** en punto muerto a 40 km/h se ordena bajar
- **THEN** la marcha sigue en punto muerto y se notifica el rechazo

### Requirement: Sobrecalentamiento
Permanecer en el limitador SHALL acumular temperatura; al superar el umbral la potencia baja un 20 % hasta que el motor se enfríe, con un aviso.

#### Scenario: Abuso del limitador
- **WHEN** se mantiene el motor en el limitador durante 6 s
- **THEN** se activa el sobrecalentamiento, la potencia disponible es un 20 % menor y el aviso activo es `MOTOR`

#### Scenario: Enfriamiento
- **WHEN** tras sobrecalentar se circula 10 s por debajo de 11 000 rpm
- **THEN** el sobrecalentamiento se desactiva y la potencia vuelve al 100 %

### Requirement: Luces de cambio
El coche SHALL exponer un valor de LEDs de 0 a 15 que crece de forma progresiva entre el 75 % y el 96 % del limitador, y 16 en el limitador.

#### Scenario: Progresión
- **WHEN** las RPM son 9 000, 10 700, 12 000 y 12 500
- **THEN** los LEDs valen 0, entre 6 y 8, 15 y 16 respectivamente

### Requirement: Cambio automático como asistencia
SHALL existir una asistencia de cambio automático, activable en marcha, que sube cerca del punto óptimo y reduce al perder velocidad sin provocar rechazos ni oscilaciones. Por defecto está activada con teclado y desactivada con volante.

#### Scenario: Subida automática
- **WHEN** se acelera a fondo desde parado con la asistencia activada
- **THEN** el coche llega a 8.ª sin tocar el limitador más de 0,1 s seguidos

#### Scenario: Sin oscilaciones
- **WHEN** se mantiene una velocidad constante de 185 km/h durante 10 s con la asistencia activada
- **THEN** la marcha cambia como máximo una vez

#### Scenario: Modo manual
- **WHEN** la asistencia está desactivada y se acelera a fondo sin ordenar cambios
- **THEN** el coche permanece en 1.ª en el limitador

### Requirement: Controles de marchas
Con teclado, E SHALL subir marcha, Q SHALL bajar marcha y M SHALL alternar el cambio automático. Con volante, las levas SHALL enviar las mismas órdenes.

#### Scenario: Teclado
- **WHEN** con la asistencia desactivada se pulsa E una vez a 80 km/h en 1.ª
- **THEN** la marcha pasa a 2.ª una sola vez aunque la tecla se mantenga pulsada

#### Scenario: Leva del volante
- **WHEN** el volante envía un evento `up`
- **THEN** la marcha sube una posición
