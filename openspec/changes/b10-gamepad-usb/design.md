## Context

Las fuentes implementan `InputSource` (`src/host/input/types.ts`); la elección la hace `setSource` y `nextVrSource` en `main.ts`. La Gamepad API funciona por USB en Chromium/Firefox con mapeo `standard` para DualShock 4 y DualSense. No requiere HTTPS ni dependencias.

## Decisions

- **D1**: `src/host/input/gamepadMap.ts`: `mapGamepad(state: GamepadState, prev: GamepadState, cfg): { input: DriverInput; commands: DriverCommand[]; ui: ('pause'|'camera'|'recenter')[]; ers: boolean }` pura, con `GamepadState` plano (`axes`, `buttons` pressed/value). Reutiliza `applyDeadzone` de `vrControllersMap.ts`.
- **D2**: `src/host/input/gamepad.ts`: clase `GamepadSource implements InputSource` (`name: 'gamepad'`), toma un `GamepadProvider = () => (Gamepad|null)[]` inyectable (`navigator.getGamepads`) para testear en Node. Mantiene `prev` y un `holdDetector` (de b9) para Share. Expone `pollUi(dtMs)` para pausa/cámara/recolocar/reiniciar, también en pausa.
- **D3**: `config.gamepad = { stickDeadzone: 0.08, triggerDeadzone: 0.05, steerExpo: 1.4 }` en `src/shared/config.ts`; `steer = sign(x)·|x|^steerExpo`.
- **D4**: selección: `nextGamepadSource(current, keyboard, gamepad, hasPad, wheelLink, inVr)`, pura y testeada, análoga a `nextVrSource`; prioridad volante > VR > gamepad > teclado. `setSource` ya deja `autoShift = true` para esta fuente.
- **D5**: vibración: `GamepadSource.rumble(kind: FxKey)` con `vibrationActuator?.playEffect('dual-rumble', …)`, protegido con try/catch; se invoca desde el mismo punto donde `FxPlanner` genera los `fx` del volante.
- **D6**: `InputSource.name` incluye `'gamepad'`. El HUD/teclas existentes no cambian.
