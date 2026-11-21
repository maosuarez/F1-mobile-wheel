## ADDED Requirements

### Requirement: Campos opcionales de borde de pista
`track.json` MAY contener `samples.rl`, `kerbs[].type`, `runoffs`, `barriers` y `boards`. Un archivo sin ellos SHALL seguir siendo válido.

#### Scenario: Compatibilidad
- **WHEN** se valida un `track.json` sin campos opcionales
- **THEN** el esquema lo acepta y la pista usa trazada 0, pianos planos, escapatoria de hierba y guardarraíl

#### Scenario: Tramos válidos
- **WHEN** se valida `interlagos.json`
- **THEN** cada tramo de `runoffs` y `barriers` tiene `0 ≤ s0, s1 < length_m`, lado y tipo válidos, y `samples.rl` tiene longitud N
