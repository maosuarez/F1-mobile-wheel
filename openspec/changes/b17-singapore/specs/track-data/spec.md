## ADDED Requirements

### Requirement: Anchos y muros por tramo
`track.json` MAY contener `walls` (distancia del borde al muro por tramo y lado). Sin CSV de TUMFTM, los anchos SHALL provenir de OSM, de overrides por tramo o del ancho por defecto del circuito.

#### Scenario: Muros
- **WHEN** se valida `singapore.json`
- **THEN** cada tramo de `walls` tiene `0 ≤ s0, s1 < length_m`, lado válido y `0,5 ≤ m ≤ 60`

#### Scenario: Anchos de override
- **WHEN** `overrides/singapore.json` declara `widths` de 10 m en un tramo
- **THEN** en ese tramo `wl + wr = 10` ± 0,1

### Requirement: Línea central promediada de FastF1
Sin CSV de TUMFTM, el pipeline SHALL promediar al menos 5 vueltas rápidas limpias para la línea central y validar la longitud.

#### Scenario: Longitud fuera de tolerancia
- **WHEN** la línea central promediada difiere más de 1,5 % de la longitud oficial
- **THEN** el pipeline termina con código ≠ 0 sin escribir el JSON
