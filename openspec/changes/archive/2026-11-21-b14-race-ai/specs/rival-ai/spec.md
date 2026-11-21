## ADDED Requirements

### Requirement: Rivales completan la carrera limpiamente
Los rivales SHALL completar una carrera de 5 vueltas en Interlagos sin intervención y sin salirse de forma habitual.

#### Scenario: Nueve rivales, dificultad media
- **WHEN** 10 coches de IA corren 5 vueltas en un test de Node
- **THEN** todos terminan, cada coche suma ≤ 2 impactos con el muro y ≤ 3 s totales sobre hierba o grava

### Requirement: Niveles de dificultad
La dificultad SHALL ordenar el ritmo de los rivales.

#### Scenario: Ritmo por nivel
- **WHEN** un rival en solitario da 3 vueltas en cada nivel
- **THEN** la mejor vuelta en `hard` es al menos 1 s más rápida que en `medium`, y la de `medium` al menos 1 s más rápida que en `easy`, y la de `hard` está entre 66 y 80 s

### Requirement: Tráfico y adelantamientos
Los rivales SHALL evitar alcances y adelantar cuando son más rápidos.

#### Scenario: Adelantamiento
- **WHEN** un rival `hard` sale 1 s detrás de uno `easy`
- **THEN** antes de 5 vueltas lo ha adelantado al menos una vez y la suma de `carHit` entre ambos es ≤ 2

#### Scenario: Tráfico mixto
- **WHEN** 10 coches de IA con niveles mezclados (3 easy, 4 medium, 3 hard, en parrilla intercalada) corren 5 vueltas, con 5 semillas distintas
- **THEN** en cada carrera el total de `carHit` es ≤ 15 y ningún coche suma más de 2 impactos con el muro ni más de 3 s fuera

#### Scenario: Determinismo
- **WHEN** se repite la misma carrera con la misma semilla y sin jugador humano
- **THEN** la clasificación y los tiempos son idénticos

### Requirement: Identidad ficticia
Los rivales SHALL usar escuderías y pilotos ficticios.

#### Scenario: Sin marcas
- **WHEN** se listan los nombres de `src/shared/teams.ts`
- **THEN** ninguno coincide con un equipo, piloto o patrocinador real de F1 (lista de comprobación en el test)
