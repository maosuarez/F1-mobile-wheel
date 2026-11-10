# Spec Delta

## Purpose

Servidor mínimo que une un PC y un celular en una sala y reenvía sus mensajes en tiempo real, sin conocer nada del juego.

## ADDED Requirements

### Requirement: Salas con un host y un volante
El servidor SHALL aceptar conexiones WebSocket en `/ws/{room}?role=host|wheel`, con una sala por código y como máximo un host y un volante por sala. Una conexión nueva con un rol ya ocupado SHALL reemplazar a la anterior, que se cierra.

#### Scenario: Emparejamiento
- **WHEN** un host y un volante se conectan a la sala `ABCD`
- **THEN** ambas conexiones quedan abiertas y asociadas a la misma sala

#### Scenario: Volante de reemplazo
- **WHEN** un segundo volante se conecta a la sala `ABCD`
- **THEN** la conexión del primer volante se cierra con código 4001 y el host recibe mensajes solo del segundo

#### Scenario: Petición inválida
- **WHEN** se conecta con `role=spectator` o con un código de sala que no tenga 4 caracteres del alfabeto permitido
- **THEN** el servidor cierra la conexión con código 4400 sin crear la sala

#### Scenario: Limpieza de salas
- **WHEN** host y volante se desconectan de una sala
- **THEN** la sala deja de existir en memoria

### Requirement: Reenvío sin lógica de juego
El servidor SHALL reenviar cada mensaje de texto tal cual al otro participante de la sala, en orden, y descartar los mensajes cuando no hay destinatario. MUST NOT interpretar ni modificar los mensajes de juego.

#### Scenario: Volante hacia host
- **WHEN** el volante envía `{"t":"in","seq":1,"ts":5,"steer":0.5,"thr":1,"brk":0,"ers":false}`
- **THEN** el host recibe exactamente la misma cadena

#### Scenario: Host hacia volante
- **WHEN** el host envía 100 mensajes numerados seguidos
- **THEN** el volante recibe los 100 en el mismo orden

#### Scenario: Sin destinatario
- **WHEN** el host envía un mensaje sin volante conectado
- **THEN** el servidor lo descarta y la conexión del host sigue abierta

#### Scenario: Mensaje demasiado grande
- **WHEN** un participante envía un mensaje de más de 4 096 bytes
- **THEN** el mensaje no se reenvía

### Requirement: Avisos de presencia
El servidor SHALL avisar a cada participante cuando el otro entra o sale, con `{"t":"peer","role":<rol del otro>,"connected":<bool>}`, y SHALL informar al recién llegado de si el otro ya está presente.

#### Scenario: Llegada del volante
- **WHEN** el volante se conecta a una sala con host
- **THEN** el host recibe `{"t":"peer","role":"wheel","connected":true}` y el volante recibe `{"t":"peer","role":"host","connected":true}`

#### Scenario: Salida del volante
- **WHEN** el volante cierra su conexión
- **THEN** el host recibe `{"t":"peer","role":"wheel","connected":false}` en menos de 1 s

### Requirement: Latido y detección de conexiones muertas
El servidor SHALL enviar `{"t":"ping"}` a cada conexión cada 2 s y cerrar con código 4002 la que no envíe ningún mensaje durante 6 s, notificando al otro participante. Los mensajes `ping` y `pong` MUST NOT reenviarse.

#### Scenario: Conexión silenciosa
- **WHEN** un volante conectado deja de enviar mensajes (sin cerrar el socket) durante el tiempo límite
- **THEN** el servidor cierra su conexión con código 4002 y el host recibe el aviso de desconexión

#### Scenario: Pong no reenviado
- **WHEN** el volante responde `{"t":"pong"}`
- **THEN** el host no recibe ese mensaje

### Requirement: Información de red
`GET /api/info` SHALL devolver `{"lan_ips": [...], "public_url": <cadena o null>}` con las direcciones IPv4 de la red local del servidor y el valor de la variable de entorno `PUBLIC_URL` si existe.

#### Scenario: Consulta
- **WHEN** se pide `GET /api/info` sin `PUBLIC_URL` definida
- **THEN** la respuesta es 200 con `lan_ips` como lista de cadenas IPv4 (sin `127.0.0.1`) y `public_url` igual a `null`

#### Scenario: URL pública
- **WHEN** el servidor se arranca con `PUBLIC_URL=https://ejemplo.test`
- **THEN** `public_url` vale `https://ejemplo.test`

### Requirement: Un solo origen
El juego y el volante SHALL alcanzar el servidor a través del mismo origen que sirve las páginas (`/ws` y `/api`), de modo que baste redirigir un único puerto al celular.

#### Scenario: Proxy de desarrollo
- **WHEN** corren `npm run dev` y el servidor en el puerto 8000
- **THEN** `GET http://localhost:5173/api/info` responde 200 y un WebSocket a `ws://localhost:5173/ws/ABCD?role=host` se abre
