## Context

`Simulation.reset()` ya coloca el coche en parrilla y reinicia el cronómetro. `startCountdown`, `pause/resume`, `bestSectors` y `updateWheel/updateControllers` están en `src/host/main.ts`. Los botones VR A/X se sondean en `VrControllersSource.pollButtons()` (`buttons[4]`).

## Decisions

- **D1**: `config.race.restartHoldMs = 1000` en `src/shared/config.ts`.
- **D2**: función pura `holdDetector(thresholdMs)` en `src/shared/hold.ts`: `update(pressed: boolean, dtMs: number): boolean` devuelve `true` una sola vez al cruzar el umbral y se rearma al soltar. Reutilizada por VR y volante. Tests en `tests/hold.test.ts`.
- **D3**: `restartRace()` en `main.ts`: si `state` es `racing`, o `paused` con `pauseReason === 'user'`: `sim.reset()`, `bestSectors.fill(null)`, `syncPrev()`, `controllersSource.reset()`, `pauseReason = null`, `startCountdown()`. Sin cambios en `Simulation`.
- **D4**: VR: `VrButtonEvent` añade `'restart'`; `pollButtons(dtMs)` mantiene un `holdDetector` por mando sobre `buttons[5]`; `buttonEdges` no cambia. Se despacha en `updateControllers`.
- **D5**: protocolo: añadir `'restart'` a `EvKey` y `EV_KEYS` en `src/shared/protocol.ts` (actualizar la tabla del comentario y el test de protocolo). Relay: comprobar en `server/main.py` que reenvía `ev` sin filtrar por clave; si filtra, añadir `restart`.
- **D6**: volante: botón `data-testid="btn-restart"` "REINICIAR" en `wheel/index.html`, con `holdDetector` en `src/wheel/controls.ts` (progreso visual opcional vía CSS, sin lógica extra) que llama `cb.onEv('restart')`.
- **D7**: host: en `updateWheel`, `k === 'restart' && source === wheel` → `restartRace()`.
