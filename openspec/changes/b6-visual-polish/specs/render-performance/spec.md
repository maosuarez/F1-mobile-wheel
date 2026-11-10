# Spec Delta

## Purpose

Garantiza que la mejora visual no rompe la fluidez: fija el presupuesto de render con todo activado, los niveles de calidad y la adaptación automática para sostener 60 fps a 1080p en GPU integrada.

## ADDED Requirements

### Requirement: Presupuesto con todo activado
Con la calidad alta, el juego SHALL mantenerse por debajo de 200 draw calls y 600 000 triángulos por fotograma (incluida la pasada de sombras), con una sola luz con sombras de mapa ≤ 2048, DPR ≤ 1,5 y texturas generadas de 2048 px de lado como máximo.

#### Scenario: Vuelta completa en calidad alta
- **WHEN** el piloto de referencia completa una vuelta en calidad alta a 1920×1080 en cada modo de cámara
- **THEN** el máximo de draw calls es < 200, el de triángulos < 600 000, hay exactamente una luz con sombras con mapa ≤ 2048 y el DPR efectivo es ≤ 1,5

#### Scenario: Coste del coche
- **WHEN** se inspecciona el modelo del coche
- **THEN** usa como máximo 14 draw calls y 60 000 triángulos

#### Scenario: Coste del entorno
- **WHEN** se inspeccionan gradas, árboles y silueta lejana
- **THEN** suman como máximo 8 draw calls

### Requirement: Fluidez en GPU integrada
En una GPU integrada a 1920×1080, el juego SHALL mantener una media de al menos 55 fps y un percentil 5 de al menos 45 fps durante una vuelta.

#### Scenario: Medición con GPU real
- **WHEN** se ejecuta la medición de rendimiento con aceleración por hardware y calidad adaptativa durante una vuelta del piloto de referencia
- **THEN** la media es ≥ 55 fps, el percentil 5 es ≥ 45 fps y se informa del nivel de calidad con el que terminó la vuelta

#### Scenario: Entorno sin GPU
- **WHEN** la medición detecta un renderizador por software
- **THEN** no da el criterio por cumplido: lo indica y sale con un código distinto para que se valide a mano con el panel F3

### Requirement: Niveles de calidad
SHALL existir tres niveles (`high`, `medium`, `low`) seleccionables con `?quality=`, que reducen de forma progresiva posproceso, resolución de sombras, DPR y densidad de entorno. En `low` el juego funciona sin posproceso ni sombras.

#### Scenario: Selección manual
- **WHEN** se abre con `?quality=low`
- **THEN** el posproceso y las sombras están desactivados, el DPR es 1 y el juego es jugable

#### Scenario: Diferencias medibles
- **WHEN** se comparan `high` y `low` en el mismo punto del circuito
- **THEN** `low` usa menos draw calls y menos triángulos que `high`

### Requirement: Calidad adaptativa
Sin `?quality=`, el juego SHALL empezar en `high` y bajar un nivel cuando la media de fps esté por debajo de 50 durante 3 s seguidos, sin volver a subir en la misma sesión y avisando de forma discreta.

#### Scenario: Bajada automática
- **WHEN** el medidor recibe 3 s de fotogramas a 40 fps
- **THEN** el nivel pasa de `high` a `medium` una sola vez y, si continúan otros 3 s, a `low`

#### Scenario: Sin oscilación
- **WHEN** tras bajar a `medium` los fps suben a 60
- **THEN** el nivel permanece en `medium`

#### Scenario: Pausa o pestaña oculta
- **WHEN** el juego está en pausa o la pestaña en segundo plano
- **THEN** esos fotogramas no cuentan para la adaptación

### Requirement: Sin regresiones funcionales
Las mejoras visuales MUST NOT alterar la simulación, el protocolo ni los resultados de los tests y verificaciones de los bloques anteriores.

#### Scenario: Regresión completa
- **WHEN** se ejecutan los tests de Vitest y las verificaciones de extremo a extremo de los bloques 2 a 5
- **THEN** todos pasan sin modificar sus umbrales

#### Scenario: Carga
- **WHEN** se abre el juego con caché vacía en local
- **THEN** la parrilla es visible en menos de 5 s y la consola no muestra errores ni avisos de WebGL
