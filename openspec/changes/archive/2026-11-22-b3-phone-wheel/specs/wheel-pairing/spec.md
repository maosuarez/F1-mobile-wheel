# Spec Delta

## Purpose

Describe cómo el PC empareja un celular como volante mediante un código QR, le cede el control del coche y reacciona cuando el volante se pierde o vuelve.

## ADDED Requirements

### Requirement: Sala y código QR
Al arrancar, el PC SHALL generar un código de sala de 4 caracteres sin caracteres ambiguos (sin `0`, `O`, `1`, `I`), conectarse como host y mostrar un QR con la URL del volante, el código en grande y una indicación del modo de conexión.

#### Scenario: Pantalla de emparejamiento
- **WHEN** se abre `/` con el relay en marcha
- **THEN** se muestra un QR, un código de 4 caracteres del alfabeto permitido y el texto de ayuda del modo activo

#### Scenario: URL en modo USB
- **WHEN** el juego se abre en `http://localhost:5173`
- **THEN** el QR codifica `http://localhost:5173/wheel/?room=<código>` y la ayuda menciona `adb reverse tcp:5173 tcp:5173`

#### Scenario: URL en modo WiFi
- **WHEN** el juego se abre por HTTPS desde una IP de la red local
- **THEN** el QR codifica `https://<IP>:<puerto>/wheel/?room=<código>`

#### Scenario: URL pública configurada
- **WHEN** `/api/info` devuelve `public_url`
- **THEN** el QR codifica `<public_url>/wheel/?room=<código>`

### Requirement: Toma de control y cuenta atrás
Cuando el volante se conecta, el PC SHALL ocultar el QR, iniciar una cuenta atrás de 3 s con el coche retenido y, al terminar, dar el control del coche al volante.

#### Scenario: Conexión del volante
- **WHEN** un volante se une a la sala
- **THEN** el QR desaparece en menos de 0,5 s, empieza la cuenta atrás y, 3 s después, las entradas del volante mueven el coche

#### Scenario: Coche retenido
- **WHEN** el volante acelera a fondo durante la cuenta atrás
- **THEN** la velocidad del coche permanece en 0

### Requirement: Teclado como alternativa
Desde la pantalla de emparejamiento, el jugador SHALL poder empezar con el teclado pulsando Enter. Si más tarde se conecta un volante, este SHALL tomar el control con un aviso.

#### Scenario: Empezar con teclado
- **WHEN** se pulsa Enter en la pantalla de emparejamiento
- **THEN** empieza la cuenta atrás y el coche se controla con el teclado

#### Scenario: Relay no disponible
- **WHEN** el relay no está en marcha al abrir el juego
- **THEN** la pantalla indica que el volante no está disponible y que puede jugarse con Enter, y el juego es jugable con teclado

#### Scenario: Volante durante una sesión de teclado
- **WHEN** se rueda con teclado y se conecta un volante
- **THEN** el control pasa al volante y se muestra "Volante conectado"

### Requirement: Entrada del volante aplicada a la simulación
Con el volante en control, la simulación SHALL usar el último `in` recibido, y los eventos `ev` SHALL aplicarse una sola vez: `pause` alterna la pausa y `up`, `down`, `drs` se entregan a la simulación como órdenes.

#### Scenario: Dirección y pedales
- **WHEN** el volante envía `steer = 0.5`, `thr = 1`, `brk = 0`
- **THEN** la entrada aplicada en el siguiente paso de simulación es exactamente esa

#### Scenario: Pausa desde el volante
- **WHEN** el volante envía `ev` con `k = "pause"` dos veces separadas 1 s
- **THEN** el juego se pausa y luego se reanuda

### Requirement: Volante perdido
Si el PC no recibe `in` durante más de 250 ms, el coche SHALL soltar el acelerador y el ERS manteniendo dirección y freno. A los 1 000 ms, el juego SHALL pausarse con el aviso "Volante desconectado". Al volver a recibir `in`, el juego SHALL reanudarse automáticamente.

#### Scenario: Corte de acelerador
- **WHEN** el último `in` tenía `thr = 1` y pasan 300 ms sin recibir otro
- **THEN** el acelerador aplicado es 0 y el juego sigue en marcha

#### Scenario: Pausa por pérdida
- **WHEN** pasan 1 000 ms sin `in`, o llega el aviso de que el volante se ha desconectado
- **THEN** el juego se pausa y muestra "Volante desconectado" junto al QR de la misma sala

#### Scenario: Reconexión
- **WHEN** el volante vuelve a conectarse a la misma sala y envía `in`
- **THEN** el juego se reanuda en menos de 1 s sin reiniciar la vuelta ni el cronómetro

#### Scenario: Pausa manual no se reanuda sola
- **WHEN** el juego está en pausa manual y el volante sigue enviando `in`
- **THEN** el juego permanece en pausa

### Requirement: Reconexión del host
Si el PC pierde la conexión con el relay, SHALL reintentar automáticamente con la misma sala.

#### Scenario: Reinicio del relay
- **WHEN** el relay se detiene y vuelve a arrancar a los 3 s
- **THEN** el PC vuelve a estar conectado como host de la misma sala en menos de 5 s tras el arranque
