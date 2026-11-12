See context.md for full project context.

## Agente global: rol y límites

El agente global NO ejecuta tareas de implementación directamente.
Su rol: recibir la tarea → identificar el bloque (1–6 de context.md) → delegar a un subagente especializado con el contexto mínimo suficiente → verificar el cierre → mantener un registro compacto del estado.

Toda implementación se ejecuta desde un subagente, **uno por bloque**. El global solo resuelve por sí mismo lecturas rápidas, coordinación y la verificación final de cada bloque.

## Delegación de tareas

Antes de ejecutar cualquier cosa:
1. Identificar el bloque y el tipo de tarea (build, test, refactor, infra, datos).
2. Lanzar el subagente del bloque e indicarle qué skills cargar (tabla de abajo).
3. Pasarle solo lo necesario: objetivo del bloque, sus criterios de aceptación, los archivos que toca y las decisiones previas que le afectan. No el proyecto completo.
4. Al terminar, el subagente devuelve un resumen de máximo 5 líneas: qué hizo, archivos tocados, estado de los criterios y pendientes.

| Bloque | Skills del subagente |
|---|---|
| 1. Datos del circuito | `track-pipeline` |
| 2. Pista + coche con teclado | `track-pipeline`, `f1-car-feel`, `threejs-gameplay-systems`, `threejs-fundamentals` |
| 3. Volante móvil | `phone-wheel-controller`, `frontend-design` |
| 4. Mecánicas de F1 | `f1-car-feel`, `threejs-game-ui-designer` (HUD) |
| 5. Sensaciones | `f1-car-feel`, `threejs-gameplay-systems` (cámaras) |
| 6. Pulido visual | `threejs-aaa-graphics-builder`, `threejs-postprocessing`, `threejs-lighting`, `threejs-materials`, `threejs-performance` |
| Verificación / cierre | `webapp-testing`, `threejs-debug-profiler`, `threejs-qa-release` |

`threejs-game-director` solo como guía de orquestación; nunca para cambiar las decisiones de context.md.

## Estado

Mantener una línea por bloque en la conversación: `Bloque N: pendiente | en curso | cerrado (commit abc123) | bloqueado: motivo`. Actualizarla al cambiar de estado. Sin archivos de estado.

## Control de tokens

- Inputs cortos y específicos. Sin repetir contexto ya dado.
- Compartir solo los campos clave, no datos completos (nada de pegar `track.json` ni logs enteros; solo extractos).
- No usar modelos pesados para tareas simples (búsquedas, renombres, comandos).
- Caveman rule: sin relleno, sin yapping. Respuestas directas.

## Herramientas obligatorias

- MCP `code-review-graph` activo en todo momento. Usarlo antes de marcar cualquier tarea o bloque como completado.

## Cierre de un bloque

Un bloque solo se marca como cerrado si se cumple todo esto:
1. Sus criterios de aceptación (context.md o la skill correspondiente) se cumplen.
2. `npx vitest run` está en verde.
3. La comprobación con `webapp-testing` pasa sin errores de consola, cuando el bloque toca el navegador.
4. La revisión con `code-review-graph` está hecha.
5. Commit del bloque (Conventional Commits) y resumen de una línea al usuario.

## Qué NO hacer

- No implementar desde el agente global.
- No repetir contexto técnico que ya está en context.md.
- No ampliar el alcance sin confirmación, ni adelantar trabajo de bloques futuros.
- No escribir código fuera del bloque en curso.
- No instalar dependencias npm o pip sin confirmar antes con el usuario (nombre del paquete y motivo).
- No crear archivos `.md` nuevos. Las explicaciones van en el chat. Solo existen `CLAUDE.md`, `context.md`, `docs/vision.md`, los `SKILL.md`, `.claude/agents/*.md` y lo generado por OpenSpec en `openspec/`.
- No desviarse de una decisión de context.md. Si no es viable, avisar y proponer una alternativa antes de cambiarla.

## OpenSpec: Fable 5.2 orquesta, Opus/Sonnet implementan

- La sesión principal corre en Fable 5.2 (`/model claude-fable-5-2`) y es el único cerebro: decide, planifica, delega, verifica y hace commit. Nunca escribe código de producto.
- Specs en `openspec/` (reglas en `openspec/config.yaml`). Un change = un bloque de context.md. Fable lo crea con `/opsx:explore` y `/opsx:propose`, y lo ajusta con `/opsx:update`.
- Workers (subagentes con modelo fijo en `.claude/agents/`): `worker-opus` para lógica delicada (sim, física, cámaras, audio, shaders, protocolo) y `worker-sonnet` para trabajo mecánico (pipeline de datos, scripts, UI, tests, configuración).
- `/opsx:apply <change>` también corre en Fable: lee `tasks.md`, asigna cada tarea o grupo de tareas contiguas a un worker con el contexto mínimo (tarea, archivos, criterio, comando de verificación), y espera su resumen de ≤5 líneas.
- Los workers no deciden diseño ni tocan `openspec/` salvo marcar tareas. Si reportan bloqueo, Fable decide y corrige specs/design (`/opsx:update`) y reasigna con SendMessage al mismo worker.
- Tareas independientes entre sí pueden ir en paralelo a workers distintos; tareas con archivos compartidos, en serie.
- Cierre: Fable verifica los criterios (vitest, webapp-testing, code-review-graph), hace commit y luego `/opsx:archive`.
- `openspec update` regenera `.claude/commands/opsx/*.md`: reaplicar `model: claude-fable-5-2` en `propose`, `explore`, `update` y `apply`.
