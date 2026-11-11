# Proposal

## Why

Bloque 4 de `context.md`: el coche ya se conduce, pero faltan las mecánicas que gestiona un piloto (marchas, DRS, ERS, límites de pista) y un HUD que las muestre.

## What Changes

- Caja secuencial R/N/1–8 con RPM, limitador, curva de potencia, corte al cambiar, protección de reducción, sobrecalentamiento y cambio automático como asistencia. Sustituye al tren motriz provisional.
- DRS por zonas de `track.json`: apertura manual, menos arrastre y carga, cierre al frenar o salir.
- ERS: batería, despliegue base a fondo, adelantamiento con gasto triple, recuperación en frenada, límite por vuelta.
- Límites de pista: la vuelta se invalida al sacar el coche más de 1 m del borde.
- HUD de carrera completo y telemetría real hacia el volante.
- Teclas nuevas: E/Q marchas, F DRS, Espacio adelantamiento, M cambio automático.
- El piloto de referencia cambia de marcha y usa el DRS.

## Capabilities

### New Capabilities
- `gearbox`: marchas, RPM, limitador, protección, sobrecalentamiento y cambio automático.
- `drs`: disponibilidad por zonas, apertura, efecto aerodinámico y cierre.
- `ers`: batería, despliegue, modo adelantamiento, recuperación y límite por vuelta.
- `track-limits`: detección de salida de pista e invalidación de la vuelta.
- `race-hud`: HUD de carrera en el PC y coherencia con la telemetría del volante.

### Modified Capabilities

Ninguna a nivel de requisitos: las bandas de `vehicle-dynamics` siguen vigentes y deben seguir cumpliéndose con la caja real.

## Impact

- `src/sim/` (módulos nuevos y cambios en `car.ts`, `simulation.ts`, `autopilot.ts`), `config.ts`, `src/host/` (HUD, teclado, telemetría), tests.
- Sin dependencias nuevas.

**Fuera de alcance:** sonido del cambio y del limitador, vibración (`fx`), temblor de cámara y cámaras nuevas (bloque 5); efectos visuales de DRS abierto, tierra o humo (bloque 6); rivales y detección real de DRS.
