## Context

`setSource` (`src/host/main.ts:122`) fija `autoShift = s.name !== 'wheel'`. El volante (`wheel/index.html`, `src/wheel/*`) tiene una fila de 7 botones bajo la pantalla. `Haptics.enabled` arranca en `true`; el botón VIB lo alterna y no distingue falta de soporte.

## Decisions

- **D1**: `setSource` pasa a `sim.assists.autoShift = true` (sin condición). Las órdenes manuales ya anulan el automático en ese paso (`stepGearbox`). No tocar `src/sim`.
- **D2**: layout. Columna izquierda: `paddle-down`, nueva fila `.actions` con `btn-ers` y `btn-drs` lado a lado (cada uno ≥56×56 px; si la columna es estrecha, columna `minmax(112px, 148px)`), y `pedal-brk`. Se elimina `.buttons` de la columna central, que cede esa altura a la pantalla. `data-testid` existentes se conservan.
- **D3**: menú: botón `data-testid="btn-menu"` (☰, ≥44×44 px) a la derecha de `.strip` superior; panel `data-testid="menu-panel"` (`hidden` por defecto, posicionado sobre `.center`) con `btn-cam`, `btn-center`, `btn-pause`, `btn-restart` (holdButton de b9) y `btn-haptics`. Cierra con el segundo toque en ☰ y tras CÁMARA/CENTRAR/PAUSA. El panel no cubre los pedales ni las levas.
- **D4**: vibración. `src/wheel/haptics.ts`: `Haptics` gana `supported: boolean` (inyectado) y no dispara si `!supported`. Preferencia en `localStorage['f1.wheel.haptics']` ('0'/'1'), leída/escrita con try/catch en `src/wheel/main.ts`. Etiqueta "VIB: N/D" + `aria-disabled="true"` si `!supported`.
- **D5**: spec principal `gearbox` pasa a "automático con todas las fuentes".
- **D6**: tests: `tests/host.wheel*`/`haptics` existentes se adaptan; E2E `b4_mechanics.py` caso (d): `autoShift` del volante es `true` y `fake_wheel --script lap` sigue completando la vuelta; E2E b3/b5/b9/b10 que usen `btn-cam`, `btn-pause`, `btn-center`, `btn-restart` o `btn-haptics` deben abrir antes el menú (`btn-menu`).
