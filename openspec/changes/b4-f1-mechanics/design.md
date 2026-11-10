# Design

## Context

Tras los bloques 2 y 3: `stepCar` usa un tren motriz de potencia constante (`car.powerKw = 680`), `DriverInput.ers` y `DriverCommand` (`shiftUp | shiftDown | drs`) ya llegan a `Simulation.step` pero se ignoran, `LapTimer.invalidateLap()` existe, el host envía `tel` con valores fijos y hay un HUD mínimo. Skill `f1-car-feel` §4–§7.

## Goals / Non-Goals

**Goals:** mecánicas en módulos puros y pequeños dentro de `src/sim`; mantener en verde todas las bandas de `vehicle-dynamics`; HUD de carrera.

**Non-Goals:** audio, `fx`, temblores (bloque 5). Bloqueo del tren trasero sin asistencias (variante opcional de la skill, descartada).

## Decisions

### D1. Estado y eventos nuevos (`src/sim/types.ts`)

```ts
// CarState +=
gear: number;            // −1 R, 0 N, 1..8
rpm: number; leds: number; limiter: boolean;
shiftCutS: number;       // tiempo restante de corte
engineTemp: number; overheated: boolean;
drs: 0 | 1 | 2;
ersCharge: number; ersLapDeployedMJ: number; overtake: boolean; ersDeployKw: number;
offTrack: boolean;
// SimEvent +=
| { type: 'shift'; from: number; to: number } | { type: 'shiftRejected' } | { type: 'limiter' }
| { type: 'overheat'; on: boolean } | { type: 'drs'; open: boolean } | { type: 'limits' }
// Simulation +=
assists: { autoShift: boolean };      // por defecto true; el host lo pone a false al tomar el control el volante
```

### D2. Configuración nueva (`src/shared/config.ts`)

`car.powerKw` se sustituye por `car.icePowerKw: 560`. Se añaden:

```ts
gears: { limiterRpm: 12500, idleRpm: 4000, topSpeedKmh: [95, 130, 160, 190, 225, 260, 300, 350], reverseTopKmh: 60,
         reverseMaxEntryKmh: 5, shiftCutS: 0.04, downshiftMarginRpm: 500,
         powerCurve: [[4000, 0.45], [7000, 0.78], [9000, 1], [12000, 1], [12500, 0.88]] as [number, number][],
         engineBrakeMs2: 1.2, wheelspinRpm: 1500, neutralRevRate: 6,
         ledStartFrac: 0.75, ledFullFrac: 0.96,
         auto: { upFrac: 0.96, downFrac: 0.78 },
         overheat: { heatPerS: 0.25, coolPerS: 0.1, threshold: 1.0, recover: 0.6, max: 1.2, powerFactor: 0.8 } },
drs:   { cdaFactor: 0.86, claFactor: 0.95, brakeClose: 0.1 },
ers:   { capacityMJ: 4, baseDeployKw: 120, overtakeExtraKw: 60, overtakeDrainMult: 3, overtakeMinCharge: 0.05,
         fullThrottle: 0.95, regenMaxKw: 250, regenFraction: 0.3, lapBonus: 0.03, lapDeployLimitMJ: 3.5 },
limits: { marginM: 1.0, warnS: 3 },
hud:   { warnShiftRejectedS: 1 },
```

### D3. Módulos puros (`src/sim/`)

```ts
// gearbox.ts
export function gearTopMs(gear: number, cfg: GameConfig): number;
export function rpmFor(vLong: number, gear: number, cfg: GameConfig): number;          // sin patinaje; ralentí como mínimo
export function powerFactor(rpm: number, cfg: GameConfig): number;                     // interpolación lineal de powerCurve; 0 en el limitador
export function ledsFor(rpm: number, cfg: GameConfig): number;                         // 0..15, 16 en el limitador
export function canShiftTo(target: number, from: number, vLong: number, cfg: GameConfig): boolean;
export function autoShiftCommand(car: CarState, input: DriverInput, cfg: GameConfig): 'shiftUp' | 'shiftDown' | null;
export function stepGearbox(car: CarState, input: DriverInput, commands: readonly DriverCommand[], autoShift: boolean, cfg: GameConfig, events: SimEvent[]): void;
// ers.ts
export function stepErs(car: CarState, input: DriverInput, brakePowerW: number, cfg: GameConfig): void;   // fija ersDeployKw, overtake, carga
export function onLapStartErs(car: CarState, cfg: GameConfig): void;                                       // lapBonus y reinicio del límite
// drs.ts
export function stepDrs(car: CarState, input: DriverInput, commands: readonly DriverCommand[], track: Track, cfg: GameConfig, events: SimEvent[]): void;
export function aeroFactors(car: CarState, cfg: GameConfig): { cda: number; cla: number };
// limits.ts
export function stepLimits(car: CarState, loc: TrackLocation, timer: LapTimer, cfg: GameConfig, events: SimEvent[]): void;
```

Orden dentro de `Simulation.step`: `stepGearbox` → `stepDrs` → `stepErs` (con la potencia de frenado del paso anterior) → `stepCar` → `stepLimits` → `LapTimer.update` (y `onLapStartErs` en cada evento `lapStart`).

- **Fuerza motriz** en `stepCar`: `P = (icePowerKw·powerFactor(rpm)·(overheated ? overheat.powerFactor : 1) + ersDeployKw)·1000·throttle`; `F = min(P / max(|vLong|, 5), límite de tracción)`; 0 si `shiftCutS > 0`, `gear = 0` o `limiter`. En marcha atrás, `F` negativa y sin ERS. Freno motor con acelerador a 0: `engineBrakeMs2·rpm/limiterRpm`. Con el volante en control y batería llena, la potencia total a fondo sigue siendo 680 kW: `aero.cdA` no debería necesitar reajuste.
- **RPM mostradas:** `rpmFor` + `wheelspinRpm × slip de tracción`, recortadas al limitador. En N: relajación hacia `idle + throttle·(limiter − idle)` con tasa `neutralRevRate`.
- **Reducción:** rechazo si `rpmFor(v, gear − 1) > limiterRpm + downshiftMarginRpm`. N→R solo si `|v| < reverseMaxEntryKmh`. Una orden recibida durante el corte se guarda (máximo una) y se aplica al terminar.
- **Automático:** sube si `rpm ≥ upFrac·limiter` y acelerador > 0,2; baja si `rpmFor(v, gear − 1) < downFrac·limiter` y `gear > 1`. Nunca engrana N ni R. Las órdenes manuales siguen funcionando con la asistencia activa.
- **DRS:** `1` si `drsZoneAt(track, s) ≥ 0`; la orden `drs` alterna 1 ⇄ 2; cierre con `brake > brakeClose` (→ 1) o fuera de zona (→ 0).
- **ERS:** ritmo base `baseDeployKw/(capacityMJ·1000)` por segundo; con adelantamiento el gasto es `overtakeDrainMult ×` el base y el despliegue `base + extra`. `ersLapDeployedMJ` acumula la energía entregada; al llegar a `lapDeployLimitMJ`, sin despliegue. Recarga `min(regenMaxKw, regenFraction·potenciaDeFrenado)`.
- **Límites:** `offTrack = d > wl + marginM || d < −(wr + marginM)`; flanco de subida → `timer.invalidateLap()` (si `lap ≥ 1`) y evento `limits`; se rearma al volver dentro de los bordes (`−wr ≤ d ≤ wl`).

### D4. Piloto de referencia

`Autopilot.update` no emite órdenes de marcha (confía en `assists.autoShift`), emite `drs` cuando `car.drs === 1` y el acelerador pedido es > 0,95, y nunca pulsa adelantamiento. Añade `suggestedGear(state): number` (la marcha que engranaría el automático) para `tel.dbg.gear`, que permite a `fake_wheel.py --script lap` cambiar con las levas en modo manual.

### D5. Host

- Teclado (`keyboard.ts`): E → `shiftUp`, Q → `shiftDown`, F → `drs` (por flanco, sin repetición), Espacio → `input.ers`, M → alterna `sim.assists.autoShift`. Al cambiar la fuente de entrada: teclado y autopilot → `autoShift = true`; volante → `false`.
- `src/host/warnings.ts`: `class WarningCenter { push(e: SimEvent, tS: number): void; current(state: SimState, tS: number): string }` con la prioridad de `specs/race-hud` (puro, testeable). `buildTel` usa `current()` para `warn` (la cuenta atrás y `PAUSA` tienen prioridad sobre todo).
- HUD (`hud.ts`, `hud.css`; skill `threejs-game-ui-designer`): se reescribe conservando los `data-testid` existentes y añadiendo `hud-gear`, `hud-leds` (hijos `.led.on`, clase `.blink` en el contenedor), `hud-drs` (`data-state="0|1|2"`), `hud-ers` (`style.width` en %), `hud-ot`, `hud-auto`, `hud-warn`, `hud-sector-0..2` (`data-state="none|slower|better"`), y la clase `.invalid` (tachado) en `hud-laptime` y `hud-last`. Actualización "solo si cambia": cada campo guarda su último texto/estado. Diseño propio: no copiar la disposición ni la gráfica de retransmisiones o juegos existentes.
- `DebugSnapshot` += `gear`, `rpm`, `leds`, `drs`, `ers`, `ot`, `autoShift`, `lapValid`, `warn`, `overheated`.

## Risks / Trade-offs

- [Los tests del bloque 2 cambian de comportamiento con la caja] → se ejecutan con `assists.autoShift = true` (valor por defecto); el test de velocidad punta usa una copia de `config` con `ers.capacityMJ` y `ers.lapDeployLimitMJ` muy grandes ("toda la potencia disponible").
- [El piloto de referencia pierde ritmo o se sale al cambiar la entrega de potencia] → reajustar solo `config.autopilot.*`; la banda de 62–105 s sigue vigente.
- [Banda de DRS (+8 a +18 km/h) sensible a la relación de 8.ª y a `powerCurve`] → ajustar `drs.cdaFactor` primero; `topSpeedKmh[7]` solo si no basta.
- [La batería se agota en pocas vueltas con el despliegue automático] → intencionado (hay que administrarla levantando o frenando); `lapDeployLimitMJ` y `regenFraction` son los mandos de ajuste.
