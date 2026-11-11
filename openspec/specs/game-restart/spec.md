# game-restart Specification

## Purpose
TBD - created by archiving change b9-restart-from-controller. Update Purpose after archive.

## Requirements

### Requirement: Reinicio de la carrera
El host SHALL ofrecer una acción de reinicio que devuelve el coche a la parrilla con la simulación a cero (`sim.reset()`), borra los mejores sectores de la sesión y reinicia la cuenta atrás de salida. La sala del volante, la fuente de entrada activa y la cámara elegida MUST NOT cambiar. La acción SHALL aceptarse solo en los estados `racing` y `paused` por pausa de usuario; en cualquier otro estado MUST ignorarse.

#### Scenario: Reinicio en carrera
- **WHEN** hay una vuelta en curso con `simTimeS` > 30 y se activa el reinicio
- **THEN** el estado pasa a `countdown`, `simTimeS` es 0, el coche está parado en la parrilla y la vuelta actual es 1

#### Scenario: Reinicio ignorado en cuenta atrás
- **WHEN** el estado es `countdown` y llega la orden de reinicio
- **THEN** el estado y la cuenta atrás no cambian

### Requirement: Reinicio desde el volante celular
El volante SHALL mostrar un botón REINICIAR que solo dispara con pulsación sostenida de `config.race.restartHoldMs` (1000 ms) y envía el evento `ev` con `k: 'restart'`. El host SHALL ejecutar el reinicio al recibirlo si el volante es la fuente activa.

#### Scenario: Pulsación corta
- **WHEN** se toca REINICIAR durante 200 ms
- **THEN** no se envía ningún evento `restart`

#### Scenario: Pulsación sostenida
- **WHEN** se mantiene REINICIAR 1000 ms
- **THEN** se envía un único `{t:'ev', k:'restart'}` y el host reinicia la carrera

### Requirement: Reinicio desde los mandos VR
En sesión VR, mantener el botón B (mando derecho) o Y (izquierdo) durante `config.race.restartHoldMs` SHALL ejecutar el reinicio. Un toque corto MUST NOT reiniciar.

#### Scenario: Botón sostenido
- **WHEN** en sesión VR se mantiene B 1000 ms en `racing`
- **THEN** se produce un único reinicio aunque el botón siga pulsado

#### Scenario: Toque corto
- **WHEN** se pulsa B 300 ms
- **THEN** no hay reinicio
