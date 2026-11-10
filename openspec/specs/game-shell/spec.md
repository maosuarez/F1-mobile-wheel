# game-shell Specification

## Purpose
Armazón del juego en el PC: arranque, bucle de simulación y render, control por teclado, HUD mínimo, pausa, herramientas de depuración y presupuesto de render que todos los bloques posteriores deben respetar.

## Requirements

### Requirement: Arranque en parrilla
Al abrir el juego SHALL cargarse Interlagos y mostrarse el monoplaza detenido en la parrilla, 20 m antes de la línea de meta, orientado en el sentido de marcha, con un aviso para empezar. Un fallo de carga MUST mostrarse en pantalla con un mensaje legible.

#### Scenario: Primer fotograma
- **WHEN** se abre `/` y termina la carga
- **THEN** se ven la pista y el coche, la velocidad es 0, `s` del coche es `length − 20 ± 1` m y hay un aviso "Pulsa una tecla para empezar"

#### Scenario: Pista no disponible
- **WHEN** la petición del archivo de pista devuelve 404
- **THEN** se muestra un mensaje de error en pantalla y no hay excepciones sin capturar

### Requirement: Bucle a paso fijo con interpolación
La simulación SHALL avanzar en tiempo real con pasos fijos independientemente de los fps, y el render SHALL interpolar la pose del coche entre los dos últimos pasos. Tras un fotograma muy largo MUST limitarse el número de pasos para no bloquear el juego.

#### Scenario: Independencia de los fps
- **WHEN** el bucle recibe 10 s de fotogramas a 30 fps y, en otra ejecución, a 144 fps
- **THEN** en ambos casos se ejecutan 1 200 ± 1 pasos de simulación

#### Scenario: Fotograma largo
- **WHEN** un fotograma dura 2 s
- **THEN** se ejecutan como máximo 8 pasos y el tiempo restante se descarta

#### Scenario: Movimiento suave
- **WHEN** el coche avanza a velocidad constante con fotogramas a 60 fps
- **THEN** el desplazamiento del coche renderizado entre fotogramas consecutivos varía menos de un 5 %

### Requirement: Control por teclado
El jugador SHALL poder conducir con el teclado: izquierda/derecha o A/D para la dirección, arriba o W para acelerar, abajo o S para frenar, R para recolocar el coche en el centro de la pista y P o Escape para pausar. La dirección por teclado SHALL aplicarse con rampas en lugar de saltos.

#### Scenario: Acelerar
- **WHEN** se mantiene pulsada la flecha arriba 3 s desde parado
- **THEN** la velocidad supera 80 km/h

#### Scenario: Rampa de dirección
- **WHEN** se pulsa la flecha derecha
- **THEN** la orden de dirección sube de 0 a 1 en un tiempo entre 0,1 y 0,3 s y vuelve a 0 al soltar en menos de 0,2 s

#### Scenario: Recolocar
- **WHEN** el coche está en la hierba y se pulsa R
- **THEN** el coche queda detenido sobre la línea central en el `s` actual, orientado en el sentido de marcha

#### Scenario: Teclas del navegador
- **WHEN** se pulsan las flechas o la barra espaciadora durante el juego
- **THEN** la página no se desplaza

### Requirement: Pausa
El juego SHALL poder pausarse y reanudarse; en pausa la simulación y el cronómetro no avanzan y se muestra un aviso.

#### Scenario: Pausar y reanudar
- **WHEN** se pulsa P, se esperan 3 s y se pulsa P de nuevo
- **THEN** el tiempo de vuelta tras reanudar es el mismo que al pausar (± 0,02 s)

#### Scenario: Pestaña oculta
- **WHEN** la pestaña pasa a segundo plano mientras se rueda
- **THEN** el juego se pausa automáticamente

### Requirement: HUD mínimo
Durante la conducción SHALL mostrarse la velocidad en km/h, el número de vuelta, el tiempo de la vuelta en curso, la última vuelta, la mejor vuelta y el delta cuando exista, con formato `m:ss.mmm`.

#### Scenario: Lectura en marcha
- **WHEN** el coche rueda a 200 km/h en la vuelta 2
- **THEN** el HUD muestra `200` ± 2 y el tiempo de vuelta se actualiza al menos 10 veces por segundo

#### Scenario: Formato de tiempos
- **WHEN** la última vuelta es de 78,4567 s
- **THEN** el HUD muestra `1:18.457`

### Requirement: Panel de depuración
Con F3 SHALL alternarse un panel con fps, draw calls, triángulos, y telemetría física (velocidad, `s`, `d`, superficie, g longitudinal y lateral).

#### Scenario: Alternar
- **WHEN** se pulsa F3 dos veces
- **THEN** el panel aparece y desaparece, y mientras es visible sus valores se actualizan al menos 4 veces por segundo

### Requirement: API de depuración para pruebas automáticas
Con el parámetro `?debug=1` el juego SHALL exponer un objeto global de solo lectura con una instantánea del estado (estado del juego, velocidad, `s`, `d`, superficie, vuelta, tiempos, fps, draw calls, triángulos, DPR efectivo) y SHALL aceptar `autopilot=1` y `timescale=N` (1–16). Sin `debug=1` el objeto MUST NOT existir.

#### Scenario: Instantánea
- **WHEN** se abre `/?debug=1` y se evalúa la instantánea
- **THEN** devuelve un objeto serializable a JSON con todos los campos enumerados

#### Scenario: Sin depuración
- **WHEN** se abre `/`
- **THEN** el objeto global de depuración no está definido y `timescale` no tiene efecto

### Requirement: Presupuesto de render
El juego SHALL limitar la relación de píxeles a 1,5, ajustarse al tamaño de la ventana y mantenerse por debajo de 200 draw calls y 600 000 triángulos por fotograma.

#### Scenario: Presupuesto durante una vuelta
- **WHEN** el piloto de referencia completa una vuelta con la ventana a 1920×1080
- **THEN** el máximo de draw calls observado es < 200, el de triángulos < 600 000 y el DPR efectivo ≤ 1,5

#### Scenario: Cambio de tamaño
- **WHEN** la ventana cambia de 1920×1080 a 1280×720
- **THEN** el lienzo ocupa toda la ventana y la imagen no se deforma

### Requirement: Sin errores de consola
El juego MUST ejecutarse sin errores ni excepciones no capturadas en la consola del navegador.

#### Scenario: Sesión de prueba
- **WHEN** se arranca el juego, se conduce una vuelta con el piloto de referencia, se pausa y se reanuda
- **THEN** la consola no contiene mensajes de nivel `error`
