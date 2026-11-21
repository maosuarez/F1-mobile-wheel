## MODIFIED Requirements

### Requirement: Superficies
El agarre y la resistencia SHALL depender de la superficie: asfalto (agarre 1,00), escapatoria de asfalto (0,95), piano (0,85), hierba (0,45 y resistencia a la rodadura 6 veces mayor) y grava (0,40 y resistencia a la rodadura 14 veces mayor).

#### Scenario: Giro en hierba
- **WHEN** se mide la aceleración lateral máxima sostenida a 100 km/h en hierba y en asfalto
- **THEN** la de hierba está entre el 35 % y el 55 % de la de asfalto

#### Scenario: Hierba frena el coche
- **WHEN** se suelta el acelerador a 60 km/h en hierba y en asfalto durante 2 s
- **THEN** la pérdida de velocidad en hierba es al menos el doble que en asfalto

#### Scenario: Piano
- **WHEN** se mide la aceleración lateral máxima sostenida a 100 km/h sobre piano
- **THEN** está entre el 80 % y el 90 % de la de asfalto

#### Scenario: Grava frena más que la hierba
- **WHEN** se suelta el acelerador a 100 km/h en grava y en hierba durante 2 s
- **THEN** la pérdida de velocidad en grava es al menos 1,5 veces la de hierba

#### Scenario: La grava no atrapa
- **WHEN** el coche está parado en grava y se acelera a fondo en recta durante 4 s
- **THEN** supera 20 km/h
