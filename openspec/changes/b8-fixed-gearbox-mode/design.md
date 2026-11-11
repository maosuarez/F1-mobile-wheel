## Context

`setSource` en `src/host/main.ts` ya asigna `sim.assists.autoShift = s.name !== 'wheel'`. El único alternador es `onToggleAuto` (tecla M, `src/host/input/keyboard.ts:64`).

## Decisions

- **D1**: eliminar `onToggleAuto` del tipo del callback de `KeyboardAdapter`, la rama `KeyM` y el callback en `main.ts:118`. No tocar `sim.assists.autoShift` ni `setSource`.
- **D2**: el HUD conserva `auto`/`autoTxt` (indicador informativo); no se toca `hudModel.ts` ni `hud.ts`.
- **D3**: el spec `gearbox` se modifica solo en "Controles de marchas".
- **D4**: E2E `tests/e2e/b4_mechanics.py` caso (a): sustituir "M desactiva el automático" por "M no cambia `autoShift`" (sigue `true`) y adaptar los pasos siguientes que dependían de estar en manual (pasar a manual solo por `window.__f1`/debug API si existe un setter; si no, usar la fuente volante simulado como en el caso (d)).
- **D5**: neutro y marcha atrás ya existen en la sim (`canShiftTo`: R solo desde N y < `reverseMaxEntryKmh`); `autoShiftCommand` devuelve null con `gear < 1`, así que solo se llega a N/R con órdenes manuales. No se toca `src/sim`.
- **D6**: mandos VR: función pura `stickShiftEdges(prev: StickShiftState, y: number): { state: StickShiftState; cmd: DriverCommand | null }` en `src/host/input/vrControllersMap.ts`, con histéresis (`config.vr.stickShiftOn = 0.7`, `stickShiftOff = 0.3`). El eje es `gamepad.axes[3]` (palanca del mando xr-standard; negativo = hacia delante); se usa la palanca de cualquier mando, la de mayor |y|. `VrControllersSource.takeCommands()` devuelve las órdenes acumuladas en `read()` (hoy devuelve `[]`). `main.ts` ya consume `source.takeCommands()` en el paso.
