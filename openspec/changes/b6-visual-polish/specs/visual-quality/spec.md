# Spec Delta

## Purpose

Define el aspecto del juego: un monoplaza y un circuito con iluminación, materiales, entorno y efectos que recuerden a una retransmisión de carreras, con identidad propia y sin marcas registradas.

## ADDED Requirements

### Requirement: Iluminación y cielo
La escena SHALL iluminarse con un sol direccional que proyecta sombras, luz ambiental de entorno coherente con el cielo, un cielo con degradado, niebla de horizonte y mapeo de tonos cinematográfico. El coche SHALL proyectar sombra sobre la pista en todo el circuito.

#### Scenario: Sombra del coche
- **WHEN** se captura la cámara de persecución en la parrilla y en otros tres puntos del circuito
- **THEN** en todas las capturas la luminancia media del asfalto bajo el coche es al menos un 20 % menor que la del asfalto iluminado contiguo

#### Scenario: Exposición correcta
- **WHEN** se analizan las capturas de referencia
- **THEN** la luminancia media está entre 0,25 y 0,65, menos del 1 % de los píxeles está quemado (blanco puro) y menos del 5 % es negro puro

#### Scenario: Horizonte
- **WHEN** se mira hacia el horizonte desde la recta principal
- **THEN** no se ve el borde del suelo ni el fondo plano: la geometría lejana se funde con el cielo

### Requirement: Monoplaza detallado de escudería ficticia
El coche SHALL reconocerse como un monoplaza moderno: morro, alerón delantero y trasero con derivas, pontones, toma de aire, halo, fondo y cuatro ruedas con neumático y llanta diferenciados, con una decoración original de una escudería ficticia. MUST NOT incluir logotipos, nombres ni decoraciones de equipos, pilotos o patrocinadores reales.

#### Scenario: Partes presentes
- **WHEN** se inspecciona el modelo del coche
- **THEN** existen los elementos con nombre `nose`, `front-wing`, `rear-wing`, `rear-wing-flap`, `sidepods`, `airbox`, `halo`, `floor` y cuatro ruedas `wheel-fl`, `wheel-fr`, `wheel-rl`, `wheel-rr`

#### Scenario: Proporciones
- **WHEN** se mide la caja envolvente del coche
- **THEN** mide entre 5,2 y 5,8 m de largo, entre 1,9 y 2,05 m de ancho y entre 0,9 y 1,1 m de alto

#### Scenario: Reflejos
- **WHEN** se captura el coche al sol
- **THEN** la carrocería muestra reflejos del entorno y un brillo especular visible, y los neumáticos se ven mates

### Requirement: Coche animado según la simulación
Las ruedas SHALL girar según la velocidad, las delanteras SHALL virar según el ángulo de dirección, la carrocería SHALL cabecear y balancear levemente con las fuerzas g, y el plano móvil del alerón trasero SHALL abrirse cuando el DRS está abierto.

#### Scenario: Ruedas delanteras
- **WHEN** el ángulo de dirección de la simulación es de 10° a la izquierda
- **THEN** las dos ruedas delanteras están viradas 10° ± 1° a la izquierda y las traseras 0°

#### Scenario: Giro de las ruedas
- **WHEN** el coche avanza a 100 km/h
- **THEN** las ruedas giran a `velocidad / radio` ± 5 %

#### Scenario: DRS visible
- **WHEN** el estado del DRS pasa a abierto
- **THEN** el plano móvil del alerón trasero alcanza su posición abierta en menos de 0,3 s y vuelve al cerrarse

### Requirement: Superficies de pista creíbles
El asfalto SHALL tener textura de grano y una banda más oscura de goma en la zona de paso, la hierba SHALL tener variación de tono, y los pianos, las líneas y los muros SHALL distinguirse con claridad. La parrilla SHALL mostrar cajones de salida y la línea de meta ajedrezada.

#### Scenario: Sin repetición evidente
- **WHEN** se captura la recta principal desde la cámara de persecución
- **THEN** no se aprecia un patrón de textura repetido a simple vista en los primeros 100 m

#### Scenario: Superficies distinguibles
- **WHEN** se captura una curva con piano
- **THEN** asfalto, línea blanca, piano rojo y blanco, hierba y muro se distinguen por color y brillo

### Requirement: Entorno
El circuito SHALL estar rodeado de gradas en la recta principal, vegetación repartida por el exterior y una silueta lejana, sin invadir la pista ni las escapatorias.

#### Scenario: Elementos fuera de la pista
- **WHEN** se generan gradas y árboles
- **THEN** ninguno queda a menos de 3 m por fuera del muro ni dentro de la pista, y hay al menos 300 árboles y gradas a lo largo de al menos 300 m de la recta principal

### Requirement: Efectos de pista
Rodar sobre la hierba SHALL levantar partículas de tierra y deslizar con fuerza SHALL generar humo en las ruedas, proporcionales a la velocidad y al deslizamiento, sin afectar a la simulación.

#### Scenario: Tierra en la hierba
- **WHEN** el coche circula a 100 km/h por la hierba
- **THEN** hay partículas activas detrás de las ruedas, y dejan de emitirse en menos de 0,2 s al volver al asfalto

#### Scenario: Humo al deslizar
- **WHEN** el deslizamiento de la simulación supera 0,6 a más de 60 km/h
- **THEN** se emiten partículas de humo desde las ruedas traseras

#### Scenario: Sin efectos en reposo
- **WHEN** el coche está parado
- **THEN** no hay ninguna partícula activa

### Requirement: Posproceso ligero
La imagen SHALL pasar por un posproceso ligero con resplandor en las zonas muy brillantes y una viñeta sutil, desactivable con `?post=0`.

#### Scenario: Posproceso activo
- **WHEN** se compara una captura por defecto con otra con `?post=0` en el mismo instante de simulación
- **THEN** las imágenes difieren, y la de posproceso tiene las esquinas entre un 5 % y un 30 % más oscuras

### Requirement: Revisión visual con rúbrica
El resultado SHALL revisarse sobre capturas de referencia (parrilla, S do Senna, Curva do Sol, Bico de Pato, Junção, recta principal, casco y TV) con la rúbrica de 10 categorías de la skill `threejs-aaa-graphics-builder`.

#### Scenario: Nota mínima
- **WHEN** el orquestador puntúa las 8 capturas de referencia
- **THEN** la nota media es ≥ 7 sobre 10 y ninguna categoría queda por debajo de 5
