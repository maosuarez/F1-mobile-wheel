# race-hud Specification

## Purpose
Pantalla de información de carrera en el PC: todo lo que el piloto necesita de un vistazo (marcha, revoluciones, DRS, ERS, tiempos, avisos), legible a alta velocidad y coherente con lo que muestra el volante.

## Requirements

### Requirement: Instrumentos de conducción
El HUD SHALL mostrar la velocidad, la marcha en grande (`R`, `N`, `1`–`8`), una barra de 15 LEDs de RPM (5 verdes, 5 rojos, 5 azul-violeta; todos parpadean en el limitador) y el indicador de cambio automático cuando la asistencia está activa.

#### Scenario: Marcha y LEDs
- **WHEN** el coche va en 5.ª con valor de LEDs 9
- **THEN** el HUD muestra `5` y 9 LEDs encendidos (5 verdes y 4 rojos)

#### Scenario: Limitador
- **WHEN** el valor de LEDs es 16
- **THEN** los 15 LEDs parpadean a la vez

### Requirement: Indicadores de DRS y ERS
El HUD SHALL distinguir visualmente DRS no disponible, disponible y abierto, y SHALL mostrar la batería del ERS como una barra con su porcentaje y un indicador cuando el adelantamiento está activo.

#### Scenario: DRS disponible
- **WHEN** el coche entra en una zona DRS
- **THEN** el indicador de DRS cambia al estado "disponible" en menos de 0,2 s

#### Scenario: Batería
- **WHEN** la batería vale 0,42 con el adelantamiento activo
- **THEN** la barra está al 42 % ± 2 y el indicador de adelantamiento está encendido

### Requirement: Tiempos y sectores
El HUD SHALL mostrar número de vuelta, tiempo en curso, última vuelta, mejor vuelta, delta con signo y color (verde si es negativo, rojo si es positivo) y los tres sectores de la vuelta, marcando cada sector completado como mejora o no respecto al mejor sector propio. Una vuelta inválida SHALL mostrarse tachada.

#### Scenario: Delta
- **WHEN** el delta es −0,234 s
- **THEN** se muestra `−0.234` en verde

#### Scenario: Sector mejorado
- **WHEN** se completa el sector 1 más rápido que el mejor sector 1 de la sesión
- **THEN** su indicador se marca como mejora

#### Scenario: Vuelta inválida
- **WHEN** la vuelta en curso queda invalidada
- **THEN** el tiempo en curso se muestra tachado hasta cruzar la meta, y después la última vuelta aparece tachada

### Requirement: Avisos
El HUD SHALL mostrar un único aviso prioritario a la vez: `MOTOR` (mientras dure el sobrecalentamiento), `LÍMITES` (3 s) y `REDUCCIÓN` (1 s), en ese orden de prioridad.

#### Scenario: Reducción rechazada
- **WHEN** se rechaza una reducción
- **THEN** aparece `REDUCCIÓN` durante 1 ± 0,2 s

#### Scenario: Prioridad
- **WHEN** hay sobrecalentamiento y se sale de los límites
- **THEN** el aviso visible es `MOTOR`

### Requirement: Telemetría del volante coherente
Los mensajes `tel` enviados al volante SHALL reflejar los mismos valores que el HUD: `gear`, `rpm`, `leds`, `drs`, `ers`, `ot` y `warn`.

#### Scenario: Valores reales
- **WHEN** el coche va en 6.ª a 11 000 rpm con el DRS abierto, batería 0,7 y adelantamiento activo
- **THEN** el `tel` siguiente lleva `gear = 6`, `rpm` = 11 000 ± 50, `drs = 2`, `ers` = 0,7 ± 0,01 y `ot = true`

#### Scenario: Aviso en el volante
- **WHEN** el HUD muestra `LÍMITES`
- **THEN** `tel.warn` vale `LÍMITES`

### Requirement: Legibilidad y rendimiento del HUD
El HUD SHALL ser legible a 1920×1080 y 1280×720 sin solapes ni desbordes, no tapar la zona central de la pista, no usar marcas registradas y no degradar el rendimiento.

#### Scenario: Resoluciones
- **WHEN** se muestra a 1920×1080 y a 1280×720
- **THEN** ningún elemento del HUD se solapa con otro ni sale de la ventana, y el tercio central de la pantalla queda libre salvo avisos

#### Scenario: Coste por fotograma
- **WHEN** el coche rueda durante 10 s
- **THEN** el HUD solo modifica el DOM de los elementos cuyo valor mostrado cambia
