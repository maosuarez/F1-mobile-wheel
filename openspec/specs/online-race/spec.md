# online-race Specification

## Purpose
TBD - created by archiving change b16-online-race. Update Purpose after archive.

## Requirements

### Requirement: Salas de carrera en el relay
El relay SHALL ofrecer salas de carrera de hasta 6 PCs con plaza, propietario, sincronización de reloj y reenvío etiquetado, sin interpretar el contenido de juego.

#### Scenario: Plazas y propietario
- **WHEN** tres clientes se conectan a `/ws/race/ABC234`
- **THEN** reciben las plazas 0, 1 y 2, el propietario es la 0 y todos reciben la lista de jugadores

#### Scenario: Sala llena o empezada
- **WHEN** se conecta un 7.º cliente o un cliente tras `started`
- **THEN** el relay cierra con el código 4001 o 4002

#### Scenario: Cambio de propietario
- **WHEN** se desconecta la plaza 0
- **THEN** el nuevo propietario es la plaza conectada más baja y todos reciben el `lobby` actualizado

### Requirement: Salida sincronizada
Todos los PCs SHALL iniciar el semáforo y apagarlo en el mismo instante del reloj del servidor. En online, la secuencia de luces SHALL seguir el reloj del servidor (`nowSrv − atSrv`) y no el tiempo de simulación, para que un PC lento no retrase su apagado.

#### Scenario: Dos navegadores
- **WHEN** dos navegadores en la misma sala empiezan una carrera
- **THEN** ambos calculan el mismo instante objetivo de apagado (`atSrv + lightsOutAtS`) y la diferencia entre sus instantes de `lightsOut` (en reloj del servidor) es < 50 ms en local
- **AND** el E2E informa, sin umbral, del error de reloj de cada PC y del retraso del apagado respecto al objetivo, que con render por software dependen de la duración de los fotogramas

#### Scenario: PC lento
- **WHEN** un PC renderiza a pocos fotogramas por segundo y su simulación va por detrás del tiempo real
- **THEN** su semáforo se apaga igualmente en el primer fotograma con `nowSrv ≥ atSrv + lightsOutAtS`

### Requirement: Coches remotos fluidos
Los coches de otros PCs y los rivales de IA del propietario SHALL verse en su posición interpolada sin saltos visibles.

#### Scenario: Con latencia
- **WHEN** el relay añade 80 ms de retardo (`RACE_TEST_DELAY_MS=80`) y se pierde 1 de cada 10 mensajes `st` en el cliente
- **THEN** en una prueba determinista a 60 fps con reloj simulado (Vitest), el salto máximo de posición de un coche remoto entre fotogramas consecutivos, descontado lo que recorre a su velocidad media en el intervalo (`|Δp| − v̄·dt`), es < 2 m
- **AND** el E2E con navegadores informa de esa métrica sin exigir el umbral, porque con render por software los intervalos entre fotogramas son de cientos de milisegundos

### Requirement: Contactos sin conflicto
El coche local SHALL no atravesar a los coches remotos, corrigiendo solo el propio.

#### Scenario: Contacto
- **WHEN** el coche local alcanza a uno remoto
- **THEN** el local se separa y pierde velocidad, y el estado del remoto mostrado no se modifica localmente

### Requirement: Carrera completa y resultados comunes
Una carrera online SHALL terminar con la misma tabla de resultados en todos los PCs, incluidos los rivales de IA.

#### Scenario: Dos navegadores con autopiloto
- **WHEN** dos navegadores con `autopilot=1&timescale=1` corren una carrera con 4 rivales de IA (5 vueltas por defecto; el E2E usa `laps=1` por el coste del render por software)
- **THEN** ambos muestran la tabla de resultados del propietario, idéntica en orden, y no hay errores en la consola

#### Scenario: Abandono
- **WHEN** un jugador cierra su pestaña a mitad de carrera
- **THEN** los demás lo ven como retirado y la carrera continúa

### Requirement: Vestíbulo
El menú SHALL permitir crear una sala, unirse con código, ver los jugadores y, al propietario, configurar rivales y empezar. Con la sala creada, el vestíbulo SHALL mostrar un QR cuyo enlace abre el juego en el mismo circuito y se une a esa sala.

#### Scenario: Unirse
- **WHEN** un segundo PC escribe el código de 6 caracteres
- **THEN** aparece en la lista de ambos con su nombre

#### Scenario: QR para unirse
- **WHEN** un PC crea la sala `ABC123` en Spa
- **THEN** el vestíbulo muestra un QR con la URL `<origen>/?track=spa&online=join&code=ABC123`, donde `<origen>` es `public_url` del relay si existe o el origen de la página, y abrir esa URL en otro PC lo une a la sala

### Requirement: QR durante la carrera online
Durante una carrera online SHALL poder abrirse y cerrarse con la tecla O, o con un botón en pantalla, un overlay que muestre el QR y el código del volante de este PC y el QR y el código de la sala. Si la carrera ya empezó, el QR de la sala MUST marcarse como "Sala cerrada: la carrera ya empezó". El overlay MUST NOT pausar ni alterar la simulación.

#### Scenario: Mostrar y ocultar
- **WHEN** en plena carrera online se pulsa O, se esperan 2 s y se pulsa O de nuevo
- **THEN** el overlay aparece con dos QR y dos códigos, desaparece al segundo toque y la vuelta en curso no se ha pausado (el tiempo de vuelta avanzó 2 ± 0,2 s)

#### Scenario: Emparejar a mitad de carrera
- **WHEN** con el overlay abierto se conecta un volante a la sala mostrada
- **THEN** el volante toma el control del coche sin pausar la carrera

#### Scenario: Fuera de online
- **WHEN** se pulsa O en Práctica o en carrera contra la IA local
- **THEN** no aparece ningún overlay
