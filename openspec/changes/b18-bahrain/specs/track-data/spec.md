## ADDED Requirements

### Requirement: Bahréin con su trazado real
El pipeline SHALL generar `bahrain.json` y `bahrain.world.json` (trazado GP) a partir de TUMFTM `Sakhir.csv`, FastF1 (≤ 2022) y OSM/DEM.

#### Scenario: Longitud y sentido
- **WHEN** se ejecuta `python tools/track/build_track.py --track bahrain`
- **THEN** termina con código 0, la longitud está dentro de la tolerancia del validador respecto a 5412 m, el sentido es horario y hay ≥ 15 curvas detectadas o declaradas

#### Scenario: Entorno
- **WHEN** se ejecuta `python tools/track/build_world.py --track bahrain`
- **THEN** termina con código 0 y `bahrain.world.json` pesa < 3 MB

#### Scenario: Vuelta de referencia
- **WHEN** el piloto de referencia da 2 vueltas en Bahréin en un test de Node
- **THEN** la vuelta lanzada dura entre 75 y 125 s y abre DRS al menos una vez

#### Scenario: Rivales
- **WHEN** 10 rivales de IA `medium` corren 5 vueltas en Bahréin
- **THEN** todos terminan
