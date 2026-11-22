## MODIFIED Requirements

### Requirement: Agitar para DRS y ERS
Una sacudida del celular (al menos 2 picos de aceleración lineal en el eje perpendicular a la pantalla > `config.wheel.shake.peakMs2` con signo alterno en `windowMs`, con enfriamiento `cooldownMs`) en recta (`|steer| < straightSteer`) SHALL enviar `drs` si la telemetría trae `drs = 1` y, si no, alternar `ers`. El `ers` activado así MUST apagarse con freno > `ersOffBrake`. La aceleración en el plano de la pantalla MUST NOT contar como pico, y la dirección MUST NOT congelarse ni retrasarse por el detector.

#### Scenario: DRS en recta
- **WHEN** la telemetría trae `drs = 1`, `steer = 0,05` y llegan dos picos de 20 m/s² en el eje Z con signo alterno separados 150 ms
- **THEN** se envía exactamente un `ev` `drs` y `ers` no cambia

#### Scenario: ERS fuera de zona
- **WHEN** la telemetría trae `drs = 0` y se detecta una sacudida en recta
- **THEN** `ers` pasa a `true` en los mensajes `in`; tras otra sacudida pasada la ventana de enfriamiento vuelve a `false`

#### Scenario: Apagado al frenar
- **WHEN** `ers` está activado por sacudida y el freno sube a 0,5
- **THEN** `ers` pasa a `false` en el siguiente mensaje `in`

#### Scenario: Curva
- **WHEN** se detecta una sacudida con `steer = 0,5`
- **THEN** no se envía `drs` y `ers` no cambia

#### Scenario: Sin falsos positivos por bordillos
- **WHEN** llega un único pico de 25 m/s² en Z sin pico opuesto en la ventana
- **THEN** no hay ningún efecto

#### Scenario: Girar rápido no es sacudida
- **WHEN** llegan picos alternos de 25 m/s² en los ejes X e Y (giro brusco del volante), o se gira 60° en 200 ms con solo `accelerationIncludingGravity` disponible
- **THEN** no se detecta ninguna sacudida y el `steer` enviado sigue la inclinación sin retención (la orden de cada muestra es la del estimador)

#### Scenario: Dirección estable
- **WHEN** durante una sacudida en Z la gravedad en el plano de la pantalla no cambia
- **THEN** el `steer` enviado no cambia más de 0,02 respecto al valor previo a la sacudida, sin necesidad de congelarlo
