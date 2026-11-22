# Design

## Context

`TRACKS["monza"]` ya existe (TUMFTM `Monza.csv`, FastF1 "Italian", 5793 m, horario) sin nombres de curvas. El catálogo de circuitos y el selector llegan en b17; el entorno real en b12; el kit de borde en b13.

## Decisions

### D1. Datos
`corner_names = {1: "Variante del Rettifilo", 2: "Variante del Rettifilo", 3: "Curva Biassono", 4: "Variante della Roggia", 5: "Variante della Roggia", 6: "Curva di Lesmo 1", 7: "Curva di Lesmo 2", 8: "Variante Ascari", 9: "Variante Ascari", 10: "Variante Ascari", 11: "Curva Alboreto"}`; `bbox = (45.6080, 9.2720, 45.6330, 9.2950)`; `lighting = "day"`. Overrides revisados por Fable con referencias públicas: salchichas a la salida de Rettifilo y Roggia, grava en Lesmo y Ascari, escapatoria de asfalto en Curva Alboreto (verificar), Tecpro en el exterior de frenadas.

### D2. Escala aerodinámica por circuito
`TrackInfo.aero?: { cdaScale: number; claScale: number }` (por defecto 1/1). Monza: `{ cdaScale: 0.82, claScale: 0.78 }`. `Simulation` recibe `GameConfig` ya escalado: `scaledConfig(cfg, info.aero)` clona y multiplica `aero.cdA`/`aero.clA`; lo usan la sesión de carrera, el piloto de referencia y los rivales (mismo `cfg`), así que el perfil de velocidad es coherente. Online: el circuito determina la escala, igual en todos los PCs.

### D3. Anillo antiguo
`build_world.py`: vías `highway=raceway` del bbox que no son el circuito principal (no alineadas con la línea central a < 15 m en > 50 % de su longitud) ni la calle de boxes → `landmarks: [{ kind: 'disused_track', pts: [x,y,z,...], w }]` (campo opcional nuevo de `WorldJson`, introducido aquí; versión 1 compatible) con `y` del terreno, ancho `width` de OSM o 12 m. `render/world.ts`: cinta de hormigón con el material de b13, oscurecida 20 % (en desuso), 1 draw call. Donde cruza por encima/debajo del circuito, se omite el tramo a < 20 m de la pista para no tapar la vista (sin puentes).

### D4. Bosque denso
Monza es un parque: `world.treesPerHa` se mantiene, pero el límite de calidad (`settings.trees`) recorta; las posiciones se priorizan por cercanía a la pista para que el corredor visual sea denso.

## Risks / Trade-offs

- Con baja carga, las chicanes exigen frenar mucho más: se valida con el piloto de referencia y la IA.
- Los tramos del anillo cerca de la pista se omiten: se pierde un detalle a cambio de no inventar puentes.
