# vr-quest-controls Specification

## Purpose
Permitir jugar en Meta Quest solo con los mandos, sin celular, con todas las acciones de carrera y una leyenda visible del mapeo.

## Requirements

### Requirement: Arranque con los mandos
En sesión VR y estado `pairing`, el flanco de subida del botón A (derecho) SHALL fijar los mandos como fuente y comenzar la cuenta atrás. El emparejamiento con el celular MUST NOT ser obligatorio.

#### Scenario: Sin celular
- **WHEN** se entra en VR sin volante conectado y se pulsa A en `pairing`
- **THEN** el estado pasa a `countdown` y, al terminar, a `racing` con `source.name === 'controllers'`

#### Scenario: Con celular
- **WHEN** el volante se conecta durante `pairing` en VR
- **THEN** el comportamiento existente no cambia (el volante toma el control)

### Requirement: Acciones completas en los mandos
Durante la carrera con los mandos como fuente SHALL cumplirse: agarre izquierdo (`buttons[1]`) = orden `drs` por flanco; agarre derecho (`buttons[1]`) = `ers: true` mientras se mantiene; clic de palanca izquierda (`buttons[3]`) = cámara siguiente por flanco, activo también con el volante conectado. Se mantienen sin cambios: gatillos, roll del mando derecho, palanca = marcha, A = pausa, X = recolocar, B/Y sostenido = reinicio.

#### Scenario: DRS
- **WHEN** `buttons[1].pressed` del mando izquierdo pasa de false a true
- **THEN** `takeCommands()` devuelve `['drs']` una sola vez aunque se mantenga pulsado

#### Scenario: ERS
- **WHEN** el agarre derecho está pulsado
- **THEN** `read()` devuelve `ers: true`; al soltarlo, `false`

#### Scenario: Cámara
- **WHEN** `buttons[3].pressed` del mando izquierdo hace flanco de subida en cualquier estado
- **THEN** se emite un único evento `camera`

### Requirement: Leyenda y código en el panel VR
La pantalla `pairing` del panel VR SHALL mostrar el código de sala con tamaño de fuente ≥ 150 px de lienzo, el texto "A = EMPEZAR" y una leyenda del mapeo. La pantalla `paused` SHALL mostrar la misma leyenda. El HUD de carrera MUST NOT cambiar.

#### Scenario: Leyenda
- **WHEN** `drawScreen({kind:'pairing', ...})`
- **THEN** los ops incluyen textos con ids `legendStart` y `legendDrs`, y el texto `room` tiene `size >= 150`

#### Scenario: Pausa
- **WHEN** `drawScreen({kind:'paused'})`
- **THEN** los ops incluyen el id `legendDrs`
