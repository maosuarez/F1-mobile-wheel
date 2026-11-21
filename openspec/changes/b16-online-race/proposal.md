# Proposal

## Why

Tercera forma de competir pedida por el usuario: varias personas, cada una en su PC y con su volante, en la misma carrera por internet o por LAN. Se apoya en `RaceSession` (b14) y en el relay FastAPI y el despliegue Docker existentes (b9).

## What Changes

- Relay: nuevo endpoint `/ws/race/{code}` para salas de carrera de hasta 6 PCs, con asignación de plaza, propietario de sala, sincronización de reloj y reenvío etiquetado con la plaza del emisor. Sigue sin lógica de juego.
- Protocolo de carrera online en `src/shared/protocol.ts`: vestíbulo, configuración, salida sincronizada, estado de coche a 20 Hz, llegada y resultados.
- Modelo de red: cada PC es autoritativo de su coche; el propietario simula y difunde los rivales de IA; los coches remotos se interpolan 100 ms en el pasado y chocan de forma unilateral con el coche local.
- Semáforo sincronizado por reloj del servidor y semilla común.
- Menú "Online": crear sala o unirse con código, nombre, lista de jugadores; el propietario elige rivales de IA y dificultad y pulsa Empezar.
- Abandono: un jugador que se va queda como retirado; si se va el propietario, los rivales de IA se retiran y la carrera sigue.

Fuera de alcance: antitrampas, servidor autoritativo, reconexión a una carrera empezada, chat, emparejamiento público, combinar online con pantalla dividida, más de una sala por proceso con balanceo.

## Capabilities

### New Capabilities
- `online-race`: carrera entre varios PCs a través del relay.

### Modified Capabilities
(ninguna)

## Impact

- `server/main.py` (endpoint de carrera; el comentario del protocolo se actualiza), `src/shared/protocol.ts`, `src/sim/race.ts` (entradas remotas), `src/host/online/{client,lobby,remoteCars,clock}.ts` (nuevos), `src/host/race/{controller,menu,results}.ts`, `src/host/main.ts`, `index.html`, `hud.css`, `tests/e2e/b16_online.py`, `tools/fake_racer.py` (nuevo).
