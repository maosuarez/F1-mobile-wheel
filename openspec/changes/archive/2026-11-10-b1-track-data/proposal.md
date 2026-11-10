# Proposal

## Why

Bloque 1 de `context.md`: sin `public/track/interlagos.json` no hay pista ni física que probar. Además el repositorio está vacío: hace falta el andamiaje mínimo de npm/Vitest para que el contrato de datos sea verificable por máquina desde el primer bloque.

## What Changes

- Pipeline Python `tools/track/build_track.py --track interlagos|monza`: TUMFTM (línea central y anchos) + FastF1 (elevación, sentido, curvas, sectores) → `public/track/<id>.json` y dos PNG de control en `out/`.
- Validador `tools/track/validate_track.py` que comprueba los criterios de aceptación y sale con código ≠ 0 si alguno falla.
- Archivo opcional de ajustes manuales `tools/track/overrides/<id>.json` (meta, sectores, DRS, nombres) para que regenerar no pise las correcciones humanas.
- Andamiaje del repo: `package.json`, TypeScript estricto, Vitest, `.gitignore`, `requirements.txt` + `.venv`.
- Contrato TypeScript del formato (`src/track/types.ts`, `src/track/schema.ts`) y test de datos `tests/track.data.test.ts` sobre el JSON real.

## Capabilities

### New Capabilities
- `track-data`: generación reproducible de datos de circuito a partir de fuentes públicas, formato `track.json` y sus garantías de calidad (longitud, cierre, sentido, elevación, anchos, metadatos).

### Modified Capabilities

Ninguna.

## Impact

- Dependencias nuevas (requieren confirmación del usuario antes de instalar): pip `fastf1 numpy scipy pandas matplotlib`; npm `typescript vite vitest three @types/three`.
- Requiere red durante la generación (clon de TUMFTM y descarga de FastF1). El JSON resultante se versiona, así que el juego no depende de Python.
- Datos de FastF1: uso personal, no comercial.

**Fuera de alcance:** carga del JSON en el juego, consultas `(s, d)`, mallas y cualquier render (bloque 2); servidor y volante (bloque 3). Monza queda soportado por el script pero no se exige generarlo.
