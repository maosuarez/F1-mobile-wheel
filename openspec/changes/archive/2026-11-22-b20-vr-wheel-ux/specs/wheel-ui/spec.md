## MODIFIED Requirements

### Requirement: Controles de carrera mínimos
En la pantalla del volante, durante la carrera, solo SHALL estar siempre visibles: pedal de freno, pedal de acelerador y levas de marcha. MUST NOT haber botones DRS ni ERS. El pedal de freno SHALL ocupar la altura que dejaban libre esos botones en la columna izquierda. CÁMARA, CENTRAR, PAUSA, REINICIAR y VIB MUST NOT estar en la vista principal fuera del modo VR.

#### Scenario: Vista principal
- **WHEN** el volante está en estado `active` y el PC no está en VR
- **THEN** no existen `btn-drs` ni `btn-ers`, el pedal de freno mide al menos el 60 % de la altura de la ventana y `btn-cam`, `btn-center`, `btn-pause`, `btn-restart` y `btn-haptics` no son visibles hasta abrir el menú

#### Scenario: Pedales intactos
- **WHEN** se mantiene el pulgar en el acelerador y se agita el celular en recta con el DRS listo
- **THEN** el valor `thr` enviado no se interrumpe y se envía un único evento `drs`

## ADDED Requirements

### Requirement: Agitar para DRS y ERS
Una sacudida del celular (al menos 2 picos de aceleración lineal > `config.wheel.shake.peakMs2` con signo alterno en `windowMs`, con enfriamiento `cooldownMs`) en recta (`|steer| < straightSteer`) SHALL enviar `drs` si la telemetría trae `drs = 1` y, si no, alternar `ers`. El `ers` activado así MUST apagarse con freno > `ersOffBrake`, y la dirección enviada MUST quedar fija durante la sacudida.

#### Scenario: DRS en recta
- **WHEN** la telemetría trae `drs = 1`, `steer = 0,05` y llegan dos picos de 20 m/s² con signo alterno separados 150 ms
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
- **WHEN** llega un único pico de 25 m/s² sin pico opuesto en la ventana
- **THEN** no hay ningún efecto

#### Scenario: Dirección estable
- **WHEN** durante una sacudida la inclinación medida oscila ± 20°
- **THEN** el `steer` enviado no cambia más de 0,02 respecto al valor previo a la sacudida

### Requirement: Modo VR del volante
Cuando la telemetría indique que el PC está en VR, el volante SHALL ocultar la telemetría (velocidad, marcha, LEDs, DRS, ERS, vuelta, delta y RTT) y SHALL mostrar siempre visibles, en la columna central, CÁMARA, CENTRAR, PAUSA y REINICIAR (sostenido) como botones de al menos 30 % del ancho de esa columna y 64 px de alto. Al salir el PC de VR SHALL volver la vista normal.

#### Scenario: Entrar en VR
- **WHEN** llega telemetría con `vr = true`
- **THEN** `disp-speed` no es visible y `btn-cam`, `btn-center`, `btn-pause` y `btn-restart` son visibles sin abrir el menú, cada uno con al menos 64 px de alto

#### Scenario: Salir de VR
- **WHEN** llega telemetría sin `vr` tras haber estado en VR
- **THEN** `disp-speed` vuelve a ser visible y los botones vuelven al menú ☰

### Requirement: Pantalla de calibración
Cuando la telemetría traiga `cal = true`, el volante SHALL mostrar a pantalla completa un botón "CALIBRAR". Al tocarlo SHALL fijar el centro de la dirección en la posición actual, enviar el evento `recal` y ocultar la pantalla. MUST volver a mostrarse si llega de nuevo `cal = true` tras haber recibido `cal` falso o ausente.

#### Scenario: Calibrar
- **WHEN** llega `cal = true` y se toca la pantalla
- **THEN** se envía un único `ev` `recal`, el siguiente `in` trae `steer = 0` y la pantalla desaparece
