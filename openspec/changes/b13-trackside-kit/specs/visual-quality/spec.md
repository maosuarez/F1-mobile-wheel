## MODIFIED Requirements

### Requirement: Superficies de pista creíbles
El asfalto SHALL usar textura fotoescaneada con una banda más oscura de goma que sigue la trazada ideal, la hierba, la grava y el hormigón SHALL usar texturas fotoescaneadas, y los pianos, las líneas y las barreras SHALL distinguirse con claridad. La parrilla SHALL mostrar cajones de salida y la línea de meta ajedrezada.

#### Scenario: Sin repetición evidente
- **WHEN** se captura la recta principal desde la cámara de persecución
- **THEN** no se aprecia un patrón de textura repetido a simple vista en los primeros 100 m

#### Scenario: Superficies distinguibles
- **WHEN** se captura una curva con piano y escapatoria de grava
- **THEN** asfalto, línea blanca, piano rojo y blanco, grava, hierba y barrera se distinguen por color y brillo

#### Scenario: Goma en la trazada
- **WHEN** se captura desde arriba la salida de una curva
- **THEN** la banda oscura cruza de exterior a interior siguiendo `rl`, no la línea central
