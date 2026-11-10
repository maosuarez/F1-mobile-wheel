# Spec Delta

## Purpose

Página web que convierte un celular Android en el volante del juego: lee la inclinación y los toques, los envía al PC y muestra la telemetría como la pantalla de un volante de competición.

## ADDED Requirements

### Requirement: Puesta en marcha con un toque
La página `/wheel/?room=<código>` SHALL mostrar "Toca para empezar" y, con el primer toque, pedir pantalla completa, bloquear la orientación en horizontal, impedir que la pantalla se apague, empezar a leer el sensor de movimiento y conectarse a la sala. El fallo de cualquiera de esas peticiones MUST NOT impedir que el volante funcione.

#### Scenario: Arranque normal
- **WHEN** se abre la página con un código válido y se toca la pantalla
- **THEN** la interfaz del volante aparece y la página se conecta a la sala como volante

#### Scenario: APIs no disponibles
- **WHEN** el bloqueo de orientación y el bloqueo de reposo lanzan excepciones
- **THEN** el volante funciona igualmente y no hay errores sin capturar

#### Scenario: Código ausente o inválido
- **WHEN** se abre `/wheel/` sin `room` o con un código inválido
- **THEN** se muestra un mensaje pidiendo escanear el QR del juego y no se intenta conectar

### Requirement: Dirección por inclinación
La dirección SHALL calcularse a partir del vector de gravedad en el plano de la pantalla (no de la orientación con brújula), corregido por la orientación de pantalla, relativo a un centro calibrado. Girar el celular en sentido horario, como un volante hacia la derecha, SHALL dar valores positivos; ±60° corresponde a ±1.

#### Scenario: Giro a la derecha
- **WHEN** con orientación de pantalla 90 y centro calibrado en `(ax, ay) = (9.81, 0)` llega la gravedad `(8.50, 4.905)`
- **THEN** el ángulo relativo es +30° ± 0,5° y `steer` es positivo

#### Scenario: Misma respuesta en la otra orientación
- **WHEN** con orientación de pantalla 270 y centro en `(−9.81, 0)` llega `(−8.50, −4.905)`
- **THEN** el ángulo relativo es +30° ± 0,5°

#### Scenario: Recorrido completo
- **WHEN** el ángulo relativo es +75°
- **THEN** `steer` vale exactamente 1

#### Scenario: Zona muerta
- **WHEN** el ángulo relativo estable es 1°
- **THEN** `steer` vale 0

### Requirement: Curva de respuesta
Fuera de la zona muerta, la respuesta SHALL ser `(1 − k)·x + k·x³` con `k = 0,35` sobre el recorrido normalizado, continua y monótona, para dar precisión cerca del centro.

#### Scenario: Mitad del recorrido
- **WHEN** el recorrido normalizado tras la zona muerta es 0,5
- **THEN** `steer` vale 0,369 ± 0,005

#### Scenario: Monotonía
- **WHEN** el ángulo relativo crece de −60° a +60° en pasos de 0,5°
- **THEN** `steer` nunca decrece

### Requirement: Filtrado sin temblor ni retraso
La dirección SHALL filtrarse de forma adaptativa: estable con el celular quieto y rápida al girar.

#### Scenario: Celular quieto
- **WHEN** llegan 5 s de muestras a 60 Hz de un ángulo fijo de 20° con ruido gaussiano de 0,05 m/s² en cada eje
- **THEN** la diferencia entre el máximo y el mínimo de `steer` en los últimos 4 s es < 0,02

#### Scenario: Giro rápido
- **WHEN** el ángulo pasa de 0° a 30° de golpe
- **THEN** la salida alcanza el 90 % del valor final en menos de 200 ms

### Requirement: Celular casi plano
Si la gravedad en el plano de la pantalla es menor de 3 m/s², el ángulo no es fiable: la dirección SHALL mantener el último valor válido y la página SHALL mostrar "Levanta el volante".

#### Scenario: Celular sobre la mesa
- **WHEN** llega la gravedad `(0.3, 0.2, 9.8)`
- **THEN** `steer` conserva su último valor y aparece el aviso

### Requirement: Calibración del centro
El centro SHALL fijarse en la posición del celular al empezar y cada vez que se pulse "Centrar".

#### Scenario: Recentrar
- **WHEN** el celular está inclinado 12° y se pulsa "Centrar"
- **THEN** `steer` pasa a 0 en esa posición y se envía el evento `recal`

### Requirement: Pedales analógicos multitáctiles
El acelerador (derecha) y el freno (izquierda) SHALL ser zonas táctiles cuyo valor depende de la altura del dedo (0 abajo, 1 arriba), utilizables a la vez entre sí y con cualquier otro control. Al levantar el dedo el valor vuelve a 0.

#### Scenario: Posición del dedo
- **WHEN** el dedo toca el acelerador a tres cuartos de su altura
- **THEN** `thr` vale 0,75 ± 0,05

#### Scenario: Tres controles a la vez
- **WHEN** se mantienen pulsados acelerador y freno y se toca la leva derecha
- **THEN** `thr` y `brk` conservan sus valores y se envía un evento `up`

#### Scenario: Sin gestos del navegador
- **WHEN** se arrastra, se mantiene pulsado o se hace doble toque sobre la interfaz
- **THEN** no hay desplazamiento, zoom, selección de texto ni menú contextual

### Requirement: Levas y botones
La interfaz SHALL ofrecer leva izquierda (bajar marcha), leva derecha (subir marcha), DRS, cámara, "Centrar", pausa, ERS (mantenido) e interruptor de vibración, con respuesta visual inmediata al toque.

#### Scenario: ERS mantenido
- **WHEN** se mantiene pulsado ERS 1 s
- **THEN** los `in` de ese intervalo llevan `ers = true` y, al soltar, `false`

#### Scenario: Respuesta visual
- **WHEN** se toca cualquier botón
- **THEN** su aspecto cambia en el mismo fotograma, sin esperar respuesta del PC

### Requirement: Pantalla de telemetría
El centro del volante SHALL mostrar, a partir de `tel`: velocidad, marcha en grande (N y R en otro color), 15 LEDs de RPM (5 verdes, 5 rojos, 5 azul-violeta, todos parpadeando con `leds = 16`), estado del DRS, barra de ERS, indicador de adelantamiento, vuelta, delta, aviso y RTT.

#### Scenario: Valores mostrados
- **WHEN** llega un `tel` con `spd = 287`, `gear = 7`, `leds = 12`, `drs = 2`, `ers = 0.6`
- **THEN** se ven `287`, `7`, 12 LEDs encendidos (5 verdes, 5 rojos, 2 azul-violeta), el DRS como abierto y la barra de ERS al 60 %

#### Scenario: Limitador
- **WHEN** llega `leds = 16`
- **THEN** los 15 LEDs parpadean a la vez

#### Scenario: Marcha atrás y punto muerto
- **WHEN** llega `gear = −1` y luego `gear = 0`
- **THEN** se muestran `R` y `N` con un color distinto al de las marchas 1–8

### Requirement: Vibración
Al recibir `fx`, el celular SHALL vibrar con un patrón propio de cada efecto (`shift`, `kerb`, `grass`, `limits`, `limiter`), con no más de una llamada de vibración cada 80 ms, y el jugador SHALL poder desactivarla.

#### Scenario: Cambio de marcha
- **WHEN** llega `fx` con `k = "shift"`
- **THEN** se solicita una vibración de 12 ms

#### Scenario: Límite de frecuencia
- **WHEN** llegan 10 `fx` en 100 ms
- **THEN** se realizan como máximo 2 llamadas de vibración

#### Scenario: Vibración desactivada
- **WHEN** el interruptor de vibración está apagado y llega un `fx`
- **THEN** no se solicita ninguna vibración

### Requirement: Estado de la conexión
La página SHALL indicar si está conectando, esperando al PC, activa o sin PC, y SHALL reconectar automáticamente si la conexión se corta.

#### Scenario: PC ausente
- **WHEN** el volante se conecta a una sala sin host
- **THEN** muestra "Esperando al PC"

#### Scenario: Reconexión automática
- **WHEN** la conexión se corta y el relay vuelve a estar disponible
- **THEN** el volante se reconecta a la misma sala en menos de 5 s sin recargar la página

### Requirement: Interfaz horizontal sin marcas
La interfaz SHALL diseñarse para uso horizontal a pantalla completa, respetar las zonas seguras de la pantalla y no mostrar logotipos ni marcas registradas.

#### Scenario: Pantallas habituales
- **WHEN** se muestra en 800×360, 915×412 y 740×360 píxeles CSS
- **THEN** ningún control se solapa ni queda fuera de la pantalla, y pedales y levas miden al menos 64 px de ancho
