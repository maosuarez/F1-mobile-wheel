## ADDED Requirements

### Requirement: Parrilla escalonada
La carrera SHALL colocar los coches en los cajones de la parrilla pintada, escalonados a izquierda y derecha, parados y orientados en el sentido de marcha.

#### Scenario: Diez coches
- **WHEN** se crea una carrera de 10 coches
- **THEN** el coche del cajón k está en `s = start − 20 − 8k` ± 0,5 m y `|d| = 2,4` ± 0,2 m con lado alterno, y ningún par de coches se solapa

### Requirement: Semáforo de salida
La salida SHALL usar 5 luces encendidas una por segundo y apagadas tras un retardo aleatorio sembrado de 0,2 a 3,0 s; ningún coche se mueve antes del apagado.

#### Scenario: Secuencia
- **WHEN** se inicia el semáforo
- **THEN** `lightsOn` vale 1..5 en t = 0..4 s, se apagan entre 4,2 y 7,0 s y la posición de todos los coches no cambia hasta `lightsOut`

#### Scenario: Determinismo
- **WHEN** se repite con la misma semilla
- **THEN** el instante del apagado es idéntico

### Requirement: Colisiones entre coches
Los coches MUST no atravesarse: los contactos los separan y transfieren velocidad de forma determinista.

#### Scenario: Alcance por detrás
- **WHEN** un coche a 200 km/h alcanza a otro a 100 km/h en la misma `d`
- **THEN** en ningún paso la distancia entre centros de círculos es < 1,7 m tras resolver, el de delante gana velocidad, el de detrás la pierde y se emite `carHit`

#### Scenario: Estados finitos
- **WHEN** 10 coches de IA corren 5 vueltas
- **THEN** todos los estados son finitos y ningún coche queda dentro de otro más de 1 paso

### Requirement: Carrera de 5 vueltas y clasificación
La carrera SHALL durar 5 vueltas para el líder, clasificar en vivo por vueltas y distancia, terminar a cada coche al cruzar la meta tras la bandera y dar resultados con tiempos y diferencias.

#### Scenario: Final
- **WHEN** el líder completa la vuelta 5
- **THEN** la fase pasa a `finishing`, cada coche termina al cruzar la meta siguiente y la fase es `finished` cuando todos terminan o tras 60 s

#### Scenario: Clasificación coherente
- **WHEN** se consulta `standings()` en cualquier paso de la carrera
- **THEN** las posiciones son 1..N sin repetir y ordenadas por (vueltas, progreso) salvo coches ya terminados, que mantienen su orden de llegada

### Requirement: Rendimiento de la simulación multicoche
La simulación de 10 coches SHALL caber holgadamente en el paso fijo.

#### Scenario: Coste por paso
- **WHEN** se simulan 10 coches durante 60 s simulados en Node
- **THEN** el coste medio por paso de `RaceSession.step` es < 1 ms
