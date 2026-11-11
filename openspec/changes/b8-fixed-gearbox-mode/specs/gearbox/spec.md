## MODIFIED Requirements

### Requirement: Controles de marchas
Con teclado, E SHALL subir marcha y Q SHALL bajar marcha. El jugador MUST NOT poder alternar entre cambio automático y manual en carrera: el modo SHALL quedar fijo según la fuente de entrada activa (volante celular = manual; teclado y mandos VR = automático). Con volante, las levas SHALL enviar las mismas órdenes que E y Q. Con los mandos VR, empujar la palanca analógica (derecha o izquierda) hacia delante SHALL emitir `shiftUp` y hacia atrás `shiftDown`, una vez por gesto. Con cualquier fuente, incluso en automático, las órdenes manuales SHALL permitir llegar a punto muerto y marcha atrás (de 1.ª: bajar → N → R) y volver a 1.ª (R → N → 1.ª); el automático nunca engrana N ni R por sí solo.

#### Scenario: Teclado
- **WHEN** con la asistencia desactivada se pulsa E una vez a 80 km/h en 1.ª
- **THEN** la marcha pasa a 2.ª una sola vez aunque la tecla se mantenga pulsada

#### Scenario: Sin alternancia con teclado
- **WHEN** se conduce con teclado y se pulsa M
- **THEN** `autoShift` sigue en `true` y no cambia ningún estado de la simulación

#### Scenario: Modo fijo con volante
- **WHEN** el volante celular pasa a ser la fuente activa
- **THEN** `autoShift` es `false` mientras sea la fuente y ninguna entrada lo cambia

#### Scenario: Leva del volante
- **WHEN** el volante envía un evento `up`
- **THEN** la marcha sube una posición

#### Scenario: Mandos VR llegan a neutro y marcha atrás
- **WHEN** en sesión VR, parado en 1.ª, se empuja la palanca hacia atrás dos veces con un gesto cada una
- **THEN** la marcha pasa a 0 y luego a −1, y al empujar hacia delante dos veces vuelve a 0 y a 1.ª

#### Scenario: Gesto único de palanca
- **WHEN** la palanca se mantiene hacia delante más allá del umbral durante 20 fotogramas
- **THEN** se emite un único `shiftUp` y no se rearma hasta que la palanca vuelve por debajo de 0.3

#### Scenario: Teclado llega a marcha atrás en automático
- **WHEN** con teclado en automático, parado en 1.ª, se pulsa Q dos veces
- **THEN** la marcha es −1
