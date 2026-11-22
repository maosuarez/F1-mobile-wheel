# Proposal

## Why

Segunda forma de competir pedida por el usuario: dos personas en el mismo PC, cada una con su celular como volante (o mando o teclado), en pantalla dividida, solas o con rivales de IA. Se apoya en `RaceSession` de b14.

## What Changes

- Opción "Jugadores: 1 | 2" en el menú (práctica y carrera).
- Pantalla dividida arriba/abajo, cada mitad con su cámara, su HUD, su minimapa y sus avisos; una torre de clasificación compartida.
- Emparejamiento de dos volantes: el PC abre una sala por jugador (dos códigos y dos QR), sin cambios en el relay.
- Asignación de controles por jugador: celular de su sala, mando 1/2 o teclado (J1: WASD + Q/E/F; J2: flechas + `,`/`.`/`-`).
- Calidad limitada a `medium` y sin bloom en modo dividido para mantener 60 fps.
- Resultados con los dos jugadores resaltados.

Fuera de alcance: más de 2 jugadores locales (queda parametrizado en `config.split.maxPlayers`, pero solo se valida 2), VR en modo dividido, online (b16).

## Capabilities

### New Capabilities
- `local-multiplayer`: varios jugadores humanos en un mismo PC.

### Modified Capabilities
(ninguna: los requisitos de un jugador no cambian)

## Impact

- Nuevos: `src/host/split/{layout,players}.ts`.
- Modificados: `src/host/main.ts`, `src/host/race/{controller,menu,tower,results}.ts`, `src/host/pairing.ts`, `src/host/input/keyboard.ts`, `src/host/input/gamepad.ts`, `src/host/hud.ts`, `src/host/minimap.ts`, `src/render/scene.ts`, `src/render/post.ts`, `src/render/cameras/*`, `src/audio/*`, `src/shared/config.ts`, `index.html`, `hud.css`.
