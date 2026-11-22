# Proposal

## Why

Tras la fase 2 el menú de inicio quedó como una lista de botones genérica, el celular ya no ofrece entrar como volante (regresión) y en la carrera online no hay forma de volver a mostrar el QR del volante ni de invitar a otro PC con un QR. Arreglos de UX sobre el bloque 3 (volante) y la fase 2 (b14 menú, b16 online) de context.md.

## What Changes

- Menú de modo rediseñado con estética de retransmisión de F1 (tarjetas de modo, tarjeta de circuito con país y luz día/noche, tipografía condensada en cursiva, acentos rojo/blanco, motivo de cuadros). Sin logos, tipografías ni marcas oficiales. Misma lógica, mismas entradas (ratón, teclado, mando, volante) y mismos `data-testid`.
- Acceso al volante en el celular: el botón "Usar este celular como volante" vuelve a aparecer en cualquier pantalla táctil salvo en los navegadores de visores VR (Quest, Pico), y además hay una tarjeta destacada dentro del menú.
- Vestíbulo online: QR para que otro PC se una a la sala.
- Carrera online: tecla O (y botón en pantalla) que abre un overlay con el QR del volante y el QR de la sala; si la sala ya empezó, ese QR se marca como cerrado (el relay rechaza entradas tras el semáforo, sin cambios en el relay).

Fuera de alcance: entrar a una carrera ya empezada, cambios en el relay o el protocolo, cambios en VR y en el volante del celular (van en `b20-vr-wheel-ux`).

## Capabilities

### New Capabilities

### Modified Capabilities
- `race-presentation`: el menú de modo gana requisitos de presentación y el acceso al volante desde el celular.
- `online-race`: el vestíbulo muestra un QR para unirse y la carrera online permite mostrar los QR del volante y de la sala.

## Impact

`src/host/race/menu.ts`, `src/host/hud.css`, `index.html`, `src/host/pairing.ts`, `src/host/main.ts`, `src/host/online/lobby.ts`, tests `tests/host.menu.test.ts`, `tests/host.pairing.test.ts`, `tests/host.lobby.test.ts` y un E2E nuevo `tests/e2e/b19_menu_phone.py`. Sin dependencias nuevas (`qrcode` ya está).
