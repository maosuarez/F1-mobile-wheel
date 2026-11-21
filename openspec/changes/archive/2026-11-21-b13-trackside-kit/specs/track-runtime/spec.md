## MODIFIED Requirements

### Requirement: Clasificación de superficie
La consulta SHALL clasificar la superficie según `d`: asfalto dentro de los bordes; piano hasta 1,2 m fuera del borde en el lado y tramo de un piano; en el resto hasta el muro, la superficie de la escapatoria de ese tramo y lado (`grass`, `gravel` o `runoff` para asfalto), con `grass` por defecto. También SHALL informar de la distancia lateral al muro de cada lado (borde + `runoff_m`).

#### Scenario: Asfalto
- **WHEN** `−wr ≤ d ≤ wl`
- **THEN** la superficie es `asphalt`

#### Scenario: Piano
- **WHEN** `d = wl + 0,6` en un `s` cubierto por un piano del lado izquierdo
- **THEN** la superficie es `kerb` y el lado informado es `left`

#### Scenario: Hierba junto a un piano
- **WHEN** `d = wl + 1,5` en ese mismo `s` sin tramo de escapatoria declarado
- **THEN** la superficie es `grass`

#### Scenario: Hierba sin piano
- **WHEN** `d = −(wr + 0,6)` en un `s` sin piano ni escapatoria declarada del lado derecho
- **THEN** la superficie es `grass`

#### Scenario: Grava
- **WHEN** `d = wl + 3` en un `s` con tramo `runoffs` de tipo `gravel` en el lado izquierdo
- **THEN** la superficie es `gravel`

#### Scenario: Escapatoria de asfalto
- **WHEN** `d = −(wr + 3)` en un `s` con tramo `runoffs` de tipo `asphalt` en el lado derecho
- **THEN** la superficie es `runoff`
