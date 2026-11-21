# Design

## Context

`Simulation` es de un solo coche (estado, cronómetro, DRS, ERS). `main.ts` lleva la máquina de estados `loading → pairing → countdown → racing ↔ paused` y una única fuente de entrada. La parrilla pintada ya tiene `surfaces.gridSlots = 10`, separación 8 m y desplazamiento lateral 2,4 m. `Autopilot` tiene el perfil de velocidad y la persecución pura.

## Decisions

### D1. Un `Simulation` por coche dentro de `RaceSession`
```ts
// src/sim/race.ts
export type RacePhase = 'grid' | 'lights' | 'green' | 'finishing' | 'finished';
export interface RaceEntry { id: number; name: string; team: number; isAi: boolean; sim: Simulation }
export interface Standing { id: number; pos: number; lapsDone: number; progressM: number; gapToLeaderS: number | null;
  gapAheadS: number | null; finished: boolean; totalTimeS: number | null; bestLapS: number | null }
export class RaceSession {
  constructor(track: Track, entries: { name: string; team: number; isAi: boolean }[], cfg?: GameConfig, seed?: number);
  readonly entries: RaceEntry[]; phase: RacePhase; lightsOn: number;  // 0..5
  startLights(): void;                                               // grid → lights
  step(inputs: DriverInput[], commands: DriverCommand[][]): RaceEvent[];  // un dt para todos
  standings(): Standing[];                                            // ordenado por pos
}
```
- Cajones pintados: `mesh.ts` se corrige para que el cajón k quede centrado en la posición del coche k (`s = start − startOffsetM − k·gridSpacingM`, largo `gridBoxLenM`); hoy está desplazado y el coche no cae dentro (tarea 3.1).
- `Simulation.placeOnGrid(slot)`: `s = startS − startOffsetM − slot·gridSpacingM`, `d = slot par ? +gridOffsetM : −gridOffsetM` (mismo lado que los cajones pintados; verificarlo contra `mesh.ts`).
- Semáforo: 5 luces a 1 s; apagado tras `race.lightsHoldMinS..lightsHoldMaxS` (0,2–3,0 s) con `mulberry32(seed)`. Durante `grid`/`lights` la simulación de cada coche no avanza (igual que la cuenta atrás actual); en `green` todos avanzan. Sin salidas en falso.
- Orden de paso: entradas de todos → `sim.step` de cada coche en orden de `id` → colisiones (D2) → clasificación.
- Progreso: `lapsDone·L + s` desde la línea de meta (antes de cruzarla en la vuelta 1, s se cuenta negativo: `s − L`).
- Diferencias: cada coche registra el tiempo de paso por checkpoints cada `race.gapStepM` (50 m); `gapAhead = t_yo − t_delante` en el último checkpoint común.
- Fin: cuando el líder completa `race.laps` (5) → `finishing`; cada coche termina al cruzar la meta siguiente; `finished` cuando todos terminan o pasan `race.finishTimeoutS` (60) desde el líder (los demás se clasifican por progreso con "+N V").
- `RaceEvent = SimEvent & { car: number } | { type: 'lightsOut' } | { type: 'finish'; car: number; pos: number } | { type: 'carHit'; a: number; b: number; impulse: number }`.

### D2. Colisiones coche-coche (`src/sim/collision.ts`)
Cada coche = 2 círculos de radio `race.carRadiusM` (0,95 m) en ±`race.carHalfLenM` (1,6 m) sobre el eje longitudinal. Para cada par (i<j) y cada par de círculos solapados: separación posicional a partes iguales a lo largo de la normal, y sobre la velocidad relativa en la normal impulso con restitución `race.restitution` (0,2) + pérdida `race.hitSpeedLoss` (3 %) + giro `race.hitYawKick` (0,05 rad · impulso normalizado). Tras mover x/z se relocaliza con `locate`. Determinista.

### D3. IA (`src/sim/rival.ts`)
```ts
export interface RivalSkill { gripUse: number; brakeUse: number; reactionS: number; aggression: number; consistency: number }
export class RivalDriver {
  constructor(track: Track, skill: RivalSkill, seed: number, cfg?: GameConfig);
  read(self: SimState, others: readonly CarSnapshot[], race: { phase: RacePhase; gapAheadS: number | null }): { input: DriverInput; commands: DriverCommand[] };
}
export interface CarSnapshot { id: number; s: number; d: number; speed: number; lapsDone: number }
```
- Perfil de velocidad: `buildSpeedProfile` sobre la curvatura de la trazada `rl` (se recalcula k de la curva desplazada) con `latGripUse = skill.gripUse`, `brakeGripUse = skill.brakeUse`.
- Dirección: persecución pura hacia el punto `s + lookahead` desplazado a `d = rl + offset`.
- Tráfico: coche delante a < `ai.followM` (30 m) con solape lateral (|Δd| < 2,2 m): si la velocidad de cierre > `ai.overtakeCloseMs` (1,5) o tengo DRS, `offset` hacia el lado con más espacio en la próxima curva (interior), limitado a la pista − 1,2 m, a `ai.offsetRateMs` (1,5 m/s); si no hay hueco o en frenada, velocidad objetivo = min(perfil, velocidad del de delante − 1) para no alcanzarlo. Vuelve a `offset = 0` cuando está limpio.
- Evitar alcances en tráfico mixto: además del seguimiento, si el coche de delante está a < `ai.brakeGapS` (0,6 s) con solape lateral y no hay hueco, la velocidad objetivo se limita a la suya y la frenada se anticipa usando su velocidad actual (no la del perfil); el desplazamiento lateral para adelantar solo se inicia si el hueco lateral está libre en los próximos `ai.followM`.
- Salida: reacción `skill.reactionS` tras `lightsOut`.
- DRS: abre al entrar en zona si está habilitado; ERS: `ers=true` en rectas si la carga > 0,3; adelantamiento (overtake) con probabilidad `aggression` cuando persigue a < 0,6 s.
- Inconsistencia: cada vuelta, con `rng` sembrado, `gripUse` varía ±`(1 − consistency)·0,03`.
- Niveles (`config.ai.levels`): `easy { gripUse: 0.80, brakeUse: 0.70 }`, `medium { 0.87, 0.78 }`, `hard { 0.93, 0.85 }`; cada rival recibe ±0,015 sembrado; `reactionS` 0,15–0,35; `aggression` 0,3–0,8; `consistency` 0,85–0,98.

### D4. DRS en carrera
`stepDrs` recibe `enabled: boolean` (por defecto `true`, práctica). `RaceSession` decide en el punto `detect_s` de cada zona: `enabled = gapAheadS ≤ race.drsGapS` (1,0) y vuelta ≥ 2 (`race.drsFromLap` = 2); se mantiene hasta salir de la zona.

### D5. Escuderías y pilotos ficticios (`src/shared/teams.ts`)
5 escuderías ficticias × 2 coches, cada una con `name`, `primary`, `accent` (sRGB) y pilotos con nombre ficticio y código de 3 letras. La del jugador es la de `carVisual.colors` existente ("Escudería del jugador"). Ningún nombre real de equipo, piloto ni patrocinador.

### D6. Render de rivales (`src/render/rivals.ts`)
- Geometría: a partir de `buildCar()` se fusiona la carrocería pintada (1 geometría) y el carbono + halo (1 geometría), sin habitáculo interior ni volante; ruedas = 1 geometría de neumático.
- `InstancedMesh` × 3 (pintura con `instanceColor` primario, carbono, neumáticos ×4 por coche) + 1 para alerón/acento con color de acento → ≤ 4 draw calls (+ las de sombra).
- Matrices interpoladas entre el paso anterior y el actual como el coche del jugador; ruedas giran con la velocidad y las delanteras con `steerAngle`.
- LOD: rivales a > `race.rivalCullM` (600 m) por detrás de la cámara se ocultan (escala 0).

### D7. Host: controlador de carrera
`src/host/race/controller.ts` encapsula `RaceSession` y expone al bucle de `main.ts` la misma interfaz que hoy usa con `Simulation` para el coche del jugador (`playerSim`), más `rivals()` para render/audio/minimapa. En práctica, `RaceSession` con 1 entrada (sin cambios de comportamiento). Estados nuevos del host: `menu` (antes de `pairing`/arranque) y `results`. La cuenta atrás de 3 s se sustituye en carrera por el semáforo (`countdown` muestra las luces); en práctica se mantiene.
- Menú (`menu.ts`): Modo (Práctica | Carrera 5 vueltas), Dificultad (Fácil | Media | Difícil), Rivales (1–9, por defecto 9). Navegable con ratón, teclado (flechas + Enter) y mando; el volante (evento `up/down` existente) cambia de opción y `restart` confirma. Selección recordada con `storage.ts`. Parámetros URL: `mode=race|practice`, `rivals=N`, `ai=easy|medium|hard`.
- Parrilla del jugador: `race.playerGridSlot` (6 → P7).
- HUD (`tower.ts`): "P4/10", "V 2/5", diferencia con delante/detrás (±s.s), torre izquierda con las 10 posiciones (código, diferencia con el líder, marca del jugador), redibujo a 5 Hz. Resultados (`results.ts`): pos, piloto, escudería, tiempo total o diferencia, mejor vuelta, "+N V"; botones Reiniciar y Menú.
- Minimapa: puntos de rivales (color de escudería).
- Audio: el motor procedural existente se instancia 2 veces más para los dos rivales más cercanos (≤ 80 m), con `PannerNode` HRTF y ganancia `audio.rivalGain` (0,35).
- Protocolo: `tel` añade `pos?: number` y `laps?: number` (opcionales, compatibles); el volante muestra "P4 · V2/5" si están.
- VR: el panel muestra posición y vuelta.
- Debug API: `race: { phase, lightsOn, standings, playerPos }`.

### D8. Constantes
`config.race` añade `{ laps: 5, lightsIntervalS: 1, lightsHoldMinS: 0.2, lightsHoldMaxS: 3, gapStepM: 50, finishTimeoutS: 60, carRadiusM: 0.95, carHalfLenM: 1.6, restitution: 0.2, hitSpeedLoss: 0.03, hitYawKick: 0.05, drsGapS: 1, drsFromLap: 2, playerGridSlot: 6, rivalCullM: 600, defaultRivals: 9 }`; `config.ai = { followM: 30, overtakeCloseMs: 1.5, offsetRateMs: 1.5, edgeMarginM: 1.2, levels: {...} }`; `config.audio.rivalGain = 0.35`.

## Risks / Trade-offs

- 10 coches × 120 Hz × `locate`: medir en el test; presupuesto < 1 ms por paso en Node.
- IA simple (sin defensa ni líneas alternativas elaboradas): suficiente para carreras creíbles; se ajusta tras jugar.
- Sombras de rivales suman draw calls: con 4 instanciados son ≤ 8 en total.
