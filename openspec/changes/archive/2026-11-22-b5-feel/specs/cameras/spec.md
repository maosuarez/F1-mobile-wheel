# Spec Delta

## Purpose

Cámaras que transmiten velocidad y fuerzas: persecución, casco y televisión, con campo de visión dinámico y temblor según la superficie.

## ADDED Requirements

### Requirement: Cambio de cámara
El juego SHALL arrancar en primera persona (cámara de casco) y el jugador SHALL poder alternar entre casco, persecución y TV, en ese orden cíclico, con la tecla C o con el evento `cam` del volante. El cambio es un corte inmediato, sin barrido.

#### Scenario: Primera persona por defecto
- **WHEN** se abre el juego y empieza la carrera
- **THEN** el modo de cámara es casco

#### Scenario: Ciclo completo
- **WHEN** se pulsa C tres veces desde la cámara de casco
- **THEN** el modo pasa por persecución, TV y vuelve a casco

#### Scenario: Desde el volante
- **WHEN** el volante envía `ev` con `k = "cam"`
- **THEN** el modo de cámara avanza una posición

#### Scenario: Corte limpio
- **WHEN** se cambia de TV a persecución
- **THEN** en el primer fotograma la cámara ya está en su posición de persecución (error < 0,5 m)

### Requirement: Cámara de persecución
La cámara de persecución SHALL seguir al coche por detrás con un resorte críticamente amortiguado y mirar hacia delante en la dirección de la velocidad, de modo que en un derrape se vea hacia dónde va el coche.

#### Scenario: Sin sobreoscilación
- **WHEN** el objetivo del resorte salta 5 m de golpe
- **THEN** la cámara converge sin sobrepasar el objetivo en más de un 1 % y recorre el 95 % del salto en menos de 0,8 s

#### Scenario: Velocidad constante
- **WHEN** el coche circula en recta a 300 km/h durante 3 s
- **THEN** la distancia cámara-coche se mantiene estable (variación < 0,1 m) y el coche permanece centrado horizontalmente

#### Scenario: Derrape
- **WHEN** el vector de velocidad forma 15° con el rumbo del coche
- **THEN** la dirección de la mirada está más cerca de la velocidad que del rumbo

#### Scenario: Independencia de los fps
- **WHEN** se simula la misma maniobra a 30 y a 144 fotogramas por segundo
- **THEN** la posición de la cámara tras 2 s difiere en menos de 0,05 m

### Requirement: Cámara de casco
La cámara de casco SHALL situarse en la posición del piloto, girar con el coche y balancearse levemente según las fuerzas g laterales y longitudinales.

#### Scenario: Vista desde el habitáculo
- **WHEN** el coche está en la parrilla con la cámara de casco
- **THEN** en la mitad inferior de la imagen se ven el morro y las dos ruedas delanteras, la pista ocupa el centro, y ninguna pieza del coche atraviesa el plano cercano de la cámara

#### Scenario: Balanceo en curva
- **WHEN** el coche sostiene 4 g laterales hacia la izquierda
- **THEN** la cámara se inclina entre 2° y 6° y vuelve a 0° ± 0,2° en recta

#### Scenario: Frenada
- **WHEN** el coche frena a 4 g
- **THEN** la cámara cabecea hacia delante entre 1° y 4°

### Requirement: Cámaras de TV
El modo TV SHALL usar cámaras fijas elevadas repartidas cada 300 m aproximadamente a lo largo del circuito, fuera de la pista, que siguen al coche con la mirada y con zoom, cambiando a la siguiente cuando el coche las pasa.

#### Scenario: Reparto
- **WHEN** se generan las cámaras de Interlagos
- **THEN** hay entre 12 y 18, todas a más de 3 m por encima de la pista y a más de 5 m fuera del borde

#### Scenario: Cambio al pasar
- **WHEN** el coche supera el `s` de la cámara activa
- **THEN** la cámara activa pasa a ser la siguiente en menos de un fotograma

#### Scenario: Encuadre
- **WHEN** el coche está a 40 m y a 250 m de la cámara activa
- **THEN** el ancho de escena visible a la distancia del coche está entre 12 y 60 m en ambos casos

### Requirement: Campo de visión dinámico
En persecución y casco, el campo de visión vertical SHALL crecer linealmente de 70° a 0 km/h hasta 84° a 320 km/h.

#### Scenario: Valores extremos e intermedios
- **WHEN** la velocidad es 0, 160 y 320 km/h
- **THEN** el FOV es 70°, 77° y 84° (± 0,2°), y por encima de 320 km/h se mantiene en 84°

### Requirement: Temblor de cámara
La cámara SHALL temblar al pisar pianos y hierba, y vibrar levemente de forma permanente por encima de 250 km/h. En asfalto por debajo de 250 km/h MUST NOT haber temblor. El temblor es determinista y no afecta a la simulación.

#### Scenario: Asfalto a velocidad media
- **WHEN** el coche circula por asfalto a 200 km/h
- **THEN** el desplazamiento por temblor es 0

#### Scenario: Piano y hierba
- **WHEN** el coche circula a 150 km/h sobre un piano y luego sobre hierba
- **THEN** la amplitud del temblor es > 0 en ambos casos, mayor en hierba, y menor de 0,1 m

#### Scenario: Alta velocidad
- **WHEN** el coche circula por asfalto a 300 km/h
- **THEN** la amplitud del temblor está entre 0,001 y 0,02 m

#### Scenario: Sin efecto en la física
- **WHEN** se ejecuta la misma secuencia de entradas con cualquier modo de cámara
- **THEN** el estado de la simulación es idéntico
