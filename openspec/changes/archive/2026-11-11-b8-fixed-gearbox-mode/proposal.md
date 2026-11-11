## Why

El cambio automático/manual se puede alternar en carrera (tecla M). El usuario quiere quitar esa opción: el modo debe venir fijo según el dispositivo de conducción, sin que el jugador lo conmute. Pertenece al bloque 4 (mecánicas de F1), retoque de `gearbox`.

## What Changes

- Eliminar la alternancia de modo: quitar `onToggleAuto` de `KeyboardAdapter` y de `src/host/main.ts`, y la tecla M.
- El modo queda fijo por fuente de entrada (ya lo fija `setSource`): volante celular = manual; teclado y mandos VR = automático.
- Los mandos VR no tenían órdenes de marcha: añadir `shiftUp`/`shiftDown` con la palanca analógica para poder engranar neutro y marcha atrás a mano (el automático nunca los engrana). Teclado y volante ya los tienen (E/Q, levas).
- Mantener el indicador AUTO/MANUAL del HUD como solo lectura.
- Actualizar el E2E `tests/e2e/b4_mechanics.py` (caso (a) usaba M).

Supuesto: "el mando" se interpreta como cualquier dispositivo de conducción; el único toggle existente era la tecla M (ni el volante celular ni los mandos VR tenían uno).

## Capabilities

### New Capabilities
Ninguna.

### Modified Capabilities
- `gearbox`: el requirement "Controles de marchas" deja de incluir M como alternador del automático.

## Impact

`src/host/input/keyboard.ts`, `src/host/main.ts`, `tests/e2e/b4_mechanics.py`, `openspec/specs/gearbox`. Sin dependencias nuevas.

Fuera de alcance: cambiar qué modo usa cada fuente, reinicio desde el mando, mando PlayStation.
