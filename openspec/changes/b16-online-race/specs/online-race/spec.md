## ADDED Requirements

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
Todos los PCs SHALL iniciar el semáforo y apagarlo en el mismo instante del reloj del servidor.

#### Scenario: Dos navegadores
- **WHEN** dos navegadores en la misma sala empiezan una carrera
- **THEN** la diferencia entre sus instantes de `lightsOut` (en reloj del servidor) es < 50 ms en local

### Requirement: Coches remotos fluidos
Los coches de otros PCs y los rivales de IA del propietario SHALL verse en su posición interpolada sin saltos visibles.

#### Scenario: Con latencia
- **WHEN** el relay añade 80 ms de retardo (`RACE_TEST_DELAY_MS=80`) y se pierde 1 de cada 10 mensajes `st` en el cliente
- **THEN** el salto máximo de posición de un coche remoto entre fotogramas consecutivos es < 2 m a 300 km/h

### Requirement: Contactos sin conflicto
El coche local SHALL no atravesar a los coches remotos, corrigiendo solo el propio.

#### Scenario: Contacto
- **WHEN** el coche local alcanza a uno remoto
- **THEN** el local se separa y pierde velocidad, y el estado del remoto mostrado no se modifica localmente

### Requirement: Carrera completa y resultados comunes
Una carrera online SHALL terminar con la misma tabla de resultados en todos los PCs, incluidos los rivales de IA.

#### Scenario: Dos navegadores con autopiloto
- **WHEN** dos navegadores con `autopilot=1&timescale=1` corren 5 vueltas con 4 rivales de IA
- **THEN** ambos muestran la tabla de resultados del propietario, idéntica en orden, y no hay errores en la consola

#### Scenario: Abandono
- **WHEN** un jugador cierra su pestaña a mitad de carrera
- **THEN** los demás lo ven como retirado y la carrera continúa

### Requirement: Vestíbulo
El menú SHALL permitir crear una sala, unirse con código, ver los jugadores y, al propietario, configurar rivales y empezar.

#### Scenario: Unirse
- **WHEN** un segundo PC escribe el código de 6 caracteres
- **THEN** aparece en la lista de ambos con su nombre
