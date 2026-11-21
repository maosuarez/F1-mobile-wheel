## ADDED Requirements

### Requirement: Distancia al muro por muestra
La pista en memoria SHALL calcular la distancia al muro de cada lado por muestra a partir de `walls`, con `runoff_m` por defecto, y la colisión, las mallas y las barreras SHALL usarla.

#### Scenario: Muro cercano
- **WHEN** un tramo declara `walls` de 2 m en el lado izquierdo
- **THEN** en ese tramo `locate(...).wallL = wl + 2` y la barrera dibujada está a esa distancia ± 0,1 m

#### Scenario: Sin walls
- **WHEN** `track.json` no tiene `walls`
- **THEN** `wallL = wl + runoff_m` y `wallR = wr + runoff_m` como antes
