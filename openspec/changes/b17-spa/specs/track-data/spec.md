## ADDED Requirements

### Requirement: Spa-Francorchamps con su trazado real
El pipeline SHALL generar `spa.json` y `spa.world.json` a partir de TUMFTM `Spa.csv`, FastF1 (≤ 2022) y OSM/DEM.

#### Scenario: Longitud y sentido
- **WHEN** se ejecuta `python tools/track/build_track.py --track spa`
- **THEN** termina con código 0, la longitud está dentro de la tolerancia del validador respecto a 7004 m, el sentido es horario y hay ≥ 19 curvas detectadas o declaradas

#### Scenario: Relieve
- **WHEN** se valida `spa.json`
- **THEN** el desnivel total de la línea central está entre 70 y 130 m y la pendiente máxima suavizada es ≤ 20 %

#### Scenario: Entorno
- **WHEN** se ejecuta `python tools/track/build_world.py --track spa`
- **THEN** termina con código 0, `spa.world.json` pesa < 3 MB e incluye bosque

#### Scenario: Vuelta de referencia
- **WHEN** el piloto de referencia da 2 vueltas en Spa en un test de Node
- **THEN** la vuelta lanzada dura entre 95 y 150 s y abre DRS al menos una vez

#### Scenario: Rivales
- **WHEN** 10 rivales de IA `medium` corren 5 vueltas en Spa
- **THEN** todos terminan
