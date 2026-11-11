## ADDED Requirements

### Requirement: Controles de carrera mínimos
En la pantalla del volante, durante la carrera, solo SHALL estar siempre visibles: pedal de freno, pedal de acelerador, levas de marcha, ERS (mantener) y DRS. ERS y DRS SHALL ser botones de al menos 56×56 px situados en la columna izquierda entre la leva y el pedal de freno. CÁMARA, CENTRAR, PAUSA, REINICIAR y VIB MUST NOT estar en la vista principal.

#### Scenario: Vista principal
- **WHEN** el volante está en estado `active`
- **THEN** los elementos `btn-drs` y `btn-ers` son visibles con tamaño mínimo 56×56 px y `btn-cam`, `btn-center`, `btn-pause`, `btn-restart` y `btn-haptics` no son visibles hasta abrir el menú

#### Scenario: Pedales intactos
- **WHEN** se mantiene el pulgar en el pedal de acelerador y se toca DRS con el otro pulgar
- **THEN** el valor `thr` enviado no se interrumpe y se envía un único evento `drs`

### Requirement: Menú secundario
Un botón ☰ en la franja superior SHALL abrir un panel con CÁMARA, CENTRAR, PAUSA, REINICIAR (pulsación sostenida, como en b9) y VIB. El panel SHALL cerrarse con un segundo toque en ☰ o tras ejecutar CÁMARA, CENTRAR o PAUSA. Abrir el menú MUST NOT enviar ningún evento ni afectar al valor de los pedales.

#### Scenario: Abrir y usar
- **WHEN** se toca ☰ y luego CÁMARA
- **THEN** se envía un único `ev` `cam` y el panel se cierra

#### Scenario: Abrir sin efecto
- **WHEN** se toca ☰
- **THEN** no se envía ningún `ev` y la telemetría y los pedales siguen igual

### Requirement: Estado de la vibración
El botón VIB SHALL mostrar "VIB: SÍ" o "VIB: NO" según la preferencia, que se recuerda en `localStorage` (con try/catch). Si `navigator.vibrate` no existe, SHALL mostrar "VIB: N/D" y no poder activarse.

#### Scenario: Sin soporte
- **WHEN** el navegador no tiene `navigator.vibrate`
- **THEN** el botón muestra "VIB: N/D" y `aria-disabled="true"`

#### Scenario: Preferencia recordada
- **WHEN** se apaga la vibración y se recarga la página del volante
- **THEN** el botón muestra "VIB: NO" y `Haptics.enabled` es `false`
