## MODIFIED Requirements

### Requirement: Disponibilidad por zonas
El DRS SHALL estar disponible únicamente mientras el coche está entre `start_s` y `end_s` de una zona del circuito. En práctica, la detección siempre lo habilita. En carrera, SHALL habilitarse solo si en el punto `detect_s` de esa zona el coche está a ≤ 1,0 s del coche de delante y a partir de la vuelta 2. El estado expuesto es 0 (no disponible), 1 (disponible) o 2 (abierto).

#### Scenario: Dentro de la zona
- **WHEN** el coche entra en una zona DRS en práctica
- **THEN** el estado pasa de 0 a 1

#### Scenario: Fuera de la zona
- **WHEN** se pulsa el botón de DRS fuera de toda zona
- **THEN** el estado sigue en 0 y la aerodinámica no cambia

#### Scenario: Detección en carrera
- **WHEN** en carrera, vuelta 3, el coche pasa por `detect_s` a 0,8 s del de delante
- **THEN** el estado pasa a 1 al entrar en la zona

#### Scenario: Sin detección en carrera
- **WHEN** en carrera pasa por `detect_s` a 1,4 s del de delante, o en la vuelta 1
- **THEN** el estado sigue en 0 dentro de la zona
