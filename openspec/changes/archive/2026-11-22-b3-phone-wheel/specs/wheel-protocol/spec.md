# Spec Delta

## Purpose

Define los mensajes que intercambian el PC y el celular, sus rangos, frecuencias y la medida de latencia, de forma que ambas partes validen lo que reciben.

## ADDED Requirements

### Requirement: Mensajes de entrada del volante
El volante SHALL enviar `in` a 60 Hz con `seq` creciente, `ts` (ms del reloj del celular), `steer` en [−1, 1], `thr` y `brk` en [0, 1], `ers` booleano y `rtt` (ms, última latencia medida o `null`). Los cambios de marcha y demás pulsaciones SHALL enviarse como eventos discretos `ev` con `k` ∈ {`up`, `down`, `drs`, `cam`, `pause`, `recal`}, nunca como estado mantenido.

#### Scenario: Frecuencia de envío
- **WHEN** el volante está activo durante 5 s
- **THEN** el host recibe entre 270 y 330 mensajes `in` con `seq` estrictamente creciente

#### Scenario: Evento de cambio
- **WHEN** el jugador toca la leva derecha una vez
- **THEN** se envía exactamente un `{"t":"ev","k":"up"}`

### Requirement: Telemetría hacia el volante
El PC SHALL enviar `tel` a 20 Hz mientras haya volante conectado, con `spd` (km/h), `gear` (−1 a 8), `rpm`, `leds` (0–16), `drs` (0, 1 o 2), `ers` [0, 1], `ot`, `lap`, `delta` (s o `null`), `warn` (texto de hasta 24 caracteres), `echo` (último `ts` recibido) y `hold` (ms transcurridos en el PC desde que recibió ese `ts`). Los efectos de vibración SHALL enviarse como eventos `fx` con `k` ∈ {`kerb`, `grass`, `limits`, `shift`, `limiter`}.

#### Scenario: Frecuencia de telemetría
- **WHEN** el volante está conectado durante 5 s de carrera
- **THEN** recibe entre 90 y 110 mensajes `tel`

#### Scenario: Sin volante
- **WHEN** no hay volante conectado
- **THEN** el PC no envía `tel`

### Requirement: Codificación compacta
Los mensajes SHALL ser JSON con los números redondeados a 3 decimales como máximo.

#### Scenario: Redondeo
- **WHEN** se codifica un `in` con `steer = 0.123456789`
- **THEN** el texto contiene `"steer":0.123`

#### Scenario: Tamaño
- **WHEN** se codifica cualquier `in` o `tel` válido
- **THEN** ocupa menos de 300 bytes

### Requirement: Validación de lo recibido
Cada extremo MUST validar los mensajes entrantes: los que no sean JSON, carezcan de un tipo conocido o tengan campos de tipo incorrecto se descartan sin lanzar excepciones, y los valores numéricos fuera de rango se recortan al rango.

#### Scenario: Basura
- **WHEN** llega el texto `hola` o `{"t":"in","steer":"x"}`
- **THEN** el mensaje se descarta y no se lanza ninguna excepción

#### Scenario: Valores fuera de rango
- **WHEN** llega un `in` con `steer = 7` y `thr = −2`
- **THEN** se interpreta como `steer = 1` y `thr = 0`

#### Scenario: Evento desconocido
- **WHEN** llega `{"t":"ev","k":"nitro"}`
- **THEN** se descarta

### Requirement: Medida de latencia
El volante SHALL calcular el RTT como `ahora − tel.echo − tel.hold`, mostrarlo y devolverlo al PC en `in.rtt`, y el PC SHALL mostrarlo en el panel de depuración.

#### Scenario: RTT descontando la espera del PC
- **WHEN** el PC tarda 40 ms en incluir un `ts` en el siguiente `tel` y la red añade 6 ms en total
- **THEN** el RTT calculado está entre 4 y 12 ms, no alrededor de 46 ms

#### Scenario: RTT en el panel
- **WHEN** el volante está conectado y se abre el panel F3 en el PC
- **THEN** el panel muestra el RTT en milisegundos

### Requirement: Sugerencia de conducción en depuración
Solo cuando el juego se abre con `?debug=1`, `tel` SHALL incluir `dbg` con la orden que daría en ese instante el piloto de referencia (`steer`, `thr`, `brk`, `gear`). Sin depuración, `dbg` MUST NOT enviarse.

#### Scenario: Con depuración
- **WHEN** el host está abierto con `?debug=1` y hay volante conectado
- **THEN** cada `tel` incluye `dbg` con `steer` en [−1, 1] y `thr`, `brk` en [0, 1]

#### Scenario: Sin depuración
- **WHEN** el host está abierto sin `debug`
- **THEN** ningún `tel` contiene `dbg`
