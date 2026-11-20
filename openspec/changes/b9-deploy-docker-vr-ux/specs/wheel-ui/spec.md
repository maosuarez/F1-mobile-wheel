# Spec Delta

## ADDED Requirements

### Requirement: Entrada manual del código de sala
Cuando el volante no tiene sala válida (`room` ausente o inválida en la URL), la pantalla `cover-noroom` SHALL mostrar, además del mensaje de QR, un campo de texto y un botón "Unirse". El campo SHALL admitir 4 caracteres, convertir a mayúsculas y filtrar los que no estén en `ROOM_ALPHABET`. Con un código válido, "Unirse" SHALL navegar a `/wheel/?room=<CÓDIGO>` y seguir el flujo normal.

#### Scenario: Código válido
- **WHEN** se abre `/wheel/` sin `room`, se escribe `abcd` y se pulsa Unirse
- **THEN** la URL pasa a `?room=ABCD` y el estado sale de `no-room`

#### Scenario: Código inválido
- **WHEN** se escribe `AB1` (3 caracteres, con `1` fuera del alfabeto)
- **THEN** el botón Unirse está deshabilitado y no hay navegación

#### Scenario: Sala inválida en la URL
- **WHEN** se abre `/wheel/?room=ZZZ0`
- **THEN** se muestra el formulario de código en lugar de quedarse en blanco
