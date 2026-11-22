# Spec Delta

## Purpose

Volante simulado por línea de comandos que habla el mismo protocolo que el celular, para depurar y verificar el juego de extremo a extremo sin dispositivo físico.

## ADDED Requirements

### Requirement: Guiones de entrada
`tools/fake_wheel.py` SHALL conectarse a una sala como volante y enviar `in` a 60 Hz según el guion elegido con `--script`: `straight` (acelera a fondo y sube marchas), `circle` (dirección fija con acelerador parcial), `random` (entrada aleatoria suave con semilla) y `lap` (sigue la sugerencia `tel.dbg`). Acepta `--room`, `--url` (por defecto `ws://localhost:5173/ws`), `--duration` y `--timeout`.

#### Scenario: Recta
- **WHEN** se ejecuta `--script straight --duration 5` contra un juego esperando volante
- **THEN** el coche supera 100 km/h y el proceso sale con código 0

#### Scenario: Sala inexistente o relay caído
- **WHEN** no puede conectarse en 5 s
- **THEN** el proceso sale con código ≠ 0 y un mensaje claro

### Requirement: Telemetría por consola
El simulador SHALL imprimir una línea por segundo con la telemetría recibida (velocidad, marcha, vuelta, delta, aviso) y el número de `tel` recibidos en ese segundo.

#### Scenario: Salida periódica
- **WHEN** se ejecuta 5 s con el juego en marcha
- **THEN** imprime entre 4 y 6 líneas, cada una con un recuento de `tel` entre 17 y 23

### Requirement: Vuelta completa en lazo cerrado
Con `--script lap`, el simulador SHALL reenviar como entrada la sugerencia `tel.dbg` más reciente y enviar eventos `up`/`down` para igualar la marcha sugerida, hasta completar el número de vueltas pedido con `--laps` (por defecto 1), y salir con código 0. Si no llega `dbg`, MUST salir con código ≠ 0 indicando que el juego debe abrirse con `?debug=1`.

#### Scenario: Vuelta de extremo a extremo
- **WHEN** el juego está abierto con `?debug=1` y se ejecuta `--script lap`
- **THEN** el coche completa una vuelta cronometrada sin intervención y el proceso sale con código 0 imprimiendo el tiempo de vuelta

#### Scenario: Juego sin depuración
- **WHEN** el juego está abierto sin `debug` y se ejecuta `--script lap`
- **THEN** el proceso sale con código ≠ 0 en menos de 5 s tras conectar, con el mensaje indicado

### Requirement: Comportamiento de latido
El simulador SHALL responder a los `ping` del relay para mantener viva la conexión.

#### Scenario: Sesión larga
- **WHEN** se ejecuta `--script circle --duration 20`
- **THEN** la conexión no se cierra por inactividad
