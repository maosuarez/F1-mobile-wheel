# Proposal

## Why

Hoy solo se puede rodar solo. El usuario quiere carreras de 5 vueltas contra otros, en tres formas: rivales con IA, varios jugadores en el mismo PC y online. Este change pone la base común: la sesión de carrera con varios coches y los rivales con IA. Amplía "un jugador, sin rivales" de context.md (se actualiza con la confirmación del usuario).

## What Changes

- `RaceSession` (simulación pura): varios coches en parrilla escalonada, semáforo de 5 luces, colisiones entre coches, clasificación en vivo, carrera de 5 vueltas, bandera a cuadros y resultados.
- Rivales con IA deterministas que siguen la trazada ideal de b13, adelantan, evitan alcances y usan DRS y ERS, con 3 niveles de dificultad y escuderías y pilotos ficticios.
- DRS en carrera: solo si se está a ≤ 1 s del coche de delante en el punto de detección (en práctica sigue siempre disponible).
- Presentación: menú de modo (Práctica / Carrera), dificultad y número de rivales; coches rivales instanciados (≤ 4 draw calls para todos); HUD con posición, vuelta x/5, diferencias y torre de clasificación; pantalla de resultados; rivales en el minimapa; sonido de los dos rivales más cercanos; posición en la telemetría del volante y en el panel VR.

Fuera de alcance: pantalla dividida (b15), online (b16), paradas en boxes, desgaste de neumáticos, daños, salidas en falso, banderas amarilla o de coche de seguridad.

## Capabilities

### New Capabilities
- `race-session`: carrera multicoche en la simulación.
- `rival-ai`: pilotos rivales controlados por la IA.
- `race-presentation`: menú, HUD de carrera, resultados y render de rivales.

### Modified Capabilities
- `drs`: la detección depende de la diferencia con el coche de delante en carrera.

## Impact

- Nuevos: `src/sim/race.ts`, `src/sim/collision.ts`, `src/sim/rival.ts`, `src/shared/teams.ts`, `src/render/rivals.ts`, `src/host/race/{controller,menu,tower,results}.ts`.
- Modificados: `src/sim/simulation.ts` (colocación en parrilla), `src/sim/drs.ts`, `src/host/main.ts`, `src/host/hud*.ts`, `src/host/minimap.ts`, `src/host/vr/panelModel.ts`, `src/audio/*`, `src/shared/{config,protocol}.ts`, `src/host/debugApi.ts`, `index.html`.
- Depende de `samples.rl` (b13).
