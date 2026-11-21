## ADDED Requirements

### Requirement: Trazada ideal
El pipeline SHALL calcular la trazada ideal y guardarla en `samples.rl`.

#### Scenario: Dentro de la pista y más suave
- **WHEN** se lee `samples.rl` de `interlagos.json`
- **THEN** todas las muestras cumplen `−wr + 1,2 ≤ rl ≤ wl − 1,2` y la suma de curvatura² de la trazada es al menos un 20 % menor que la de la línea central

### Requirement: Escapatorias, barreras, pianos y carteles por tramo
El pipeline SHALL clasificar cada tramo de escapatoria (asfalto, grava o hierba), cada barrera (Tecpro, guardarraíl, hormigón), cada piano (plano, dentado o salchicha) y colocar carteles de 150/100/50 m antes de las frenadas fuertes, con overrides manuales que prevalecen.

#### Scenario: Cobertura
- **WHEN** se genera Interlagos
- **THEN** hay al menos un tramo de cada tipo de escapatoria y de barrera, y al menos 3 juegos de carteles

#### Scenario: Override prevalece
- **WHEN** `overrides/interlagos.json` declara un tramo `runoffs` de grava que solapa uno heurístico de asfalto
- **THEN** el `track.json` resultante contiene solo el tramo de grava en ese intervalo

### Requirement: Elementos de borde visibles
El juego SHALL dibujar los pianos con su perfil, las barreras por tipo en la posición del muro de la simulación, la valla de retención, los carteles, los puestos de comisarios y las líneas de boxes.

#### Scenario: Barrera alineada con el muro físico
- **WHEN** se mide la distancia lateral de la cara interna de cada barrera a la línea central
- **THEN** coincide con `wl/wr + runoff_m` con error < 0,1 m

#### Scenario: Presupuesto
- **WHEN** se carga Interlagos con calidad alta
- **THEN** el borde de pista añade ≤ 15 draw calls y el total de la escena es ≤ 200

### Requirement: Materiales fotoescaneados con respaldo
Asfalto, calle de boxes, hierba, grava y hormigón SHALL usar texturas CC0 fotoescaneadas, y el cielo y los reflejos un HDRI real. Si un archivo falla, SHALL usarse la versión procedural sin errores.

#### Scenario: Manifiesto de licencias
- **WHEN** se lee `public/assets/manifest.json`
- **THEN** cada asset tiene id, licencia `CC0` y URL de origen

#### Scenario: Fallo de carga
- **WHEN** se bloquea la petición de `asphalt_track`
- **THEN** la pista se dibuja con la textura procedural y no hay errores en la consola (solo un aviso)
