## ADDED Requirements

### Requirement: Detección y selección del mando
El host SHALL detectar un `Gamepad` con `mapping === 'standard'` conectado por USB (eventos `gamepadconnected`/`gamepaddisconnected`, sondeo con `navigator.getGamepads()` cada fotograma). Con un mando conectado y sin volante celular ni mandos VR conduciendo, la fuente activa SHALL ser el gamepad; al desconectarlo SHALL volver al teclado sin perder el estado de la carrera.

#### Scenario: Conexión
- **WHEN** se conecta un DualSense por USB y se pulsa cualquier botón
- **THEN** la fuente activa pasa a `gamepad` y aparece un aviso "Mando conectado"

#### Scenario: Prioridad
- **WHEN** hay mando conectado y el volante celular está en estado `ok`
- **THEN** la fuente activa es el volante

#### Scenario: Desconexión
- **WHEN** se desenchufa el mando en carrera
- **THEN** la fuente vuelve al teclado, el coche conserva su estado y el cambio sigue en automático

### Requirement: Mapeo de controles
El mapeo SHALL ser una función pura y testeable: stick izquierdo X = dirección con zona muerta `config.gamepad.stickDeadzone`; R2 (`buttons[7].value`) = acelerador y L2 (`buttons[6].value`) = freno, ambos con zona muerta de gatillo; R1/L1 = `shiftUp`/`shiftDown` por flanco; Cuadrado = `drs` por flanco; Círculo mantenido = ERS; Triángulo = cámara siguiente; Options = pausa; Cruz = recolocar; Share mantenido `config.race.restartHoldMs` = reiniciar.

#### Scenario: Dirección y pedales
- **WHEN** el stick izquierdo está a −1 en X, R2 = 0.5 y L2 = 0
- **THEN** `steer` es −1, `throttle` es 0.5 (tras zona muerta) y `brake` es 0

#### Scenario: Zona muerta
- **WHEN** el stick está a 0.05 en X con zona muerta 0.08
- **THEN** `steer` es 0

#### Scenario: Cambio por flanco
- **WHEN** se mantiene R1 pulsado durante 10 fotogramas
- **THEN** se emite un único `shiftUp`

#### Scenario: Neutro y marcha atrás
- **WHEN** parado en 1.ª, en automático, se pulsa L1 dos veces (con el corte de cambio entre ellas)
- **THEN** la marcha pasa a 0 y luego a −1; R1 dos veces la devuelve a 1.ª

### Requirement: Vibración
Si el mando expone `vibrationActuator`, el host SHALL reproducir pulsos de vibración con los mismos eventos de `fx` que la háptica del celular (pianos, hierba, límites, limitador). Si no la expone, MUST ignorarse sin error.

#### Scenario: Mando sin vibración
- **WHEN** el mando no tiene `vibrationActuator`
- **THEN** no se lanza ninguna excepción ni error de consola
