## MODIFIED Requirements

### Requirement: Vestíbulo
El menú SHALL permitir crear una sala, unirse con código, ver los jugadores y, al propietario, configurar rivales y empezar. Con la sala creada, el vestíbulo SHALL mostrar un QR cuyo enlace abre el juego en el mismo circuito y se une a esa sala.

#### Scenario: Unirse
- **WHEN** un segundo PC escribe el código de 6 caracteres
- **THEN** aparece en la lista de ambos con su nombre

#### Scenario: QR para unirse
- **WHEN** un PC crea la sala `ABC123` en Spa
- **THEN** el vestíbulo muestra un QR con la URL `<origen>/?track=spa&online=join&code=ABC123`, donde `<origen>` es `public_url` del relay si existe o el origen de la página, y abrir esa URL en otro PC lo une a la sala

## ADDED Requirements

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
