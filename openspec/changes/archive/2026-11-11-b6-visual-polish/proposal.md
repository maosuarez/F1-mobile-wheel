# Proposal

## Why

Bloque 6 de `context.md`: con los bloques 1–5 cerrados el juego es jugable y se siente como un F1, pero se ve como un prototipo. Este bloque lo acerca a la referencia visual de `docs/vision.md` (retransmisión de televisión) sin romper el presupuesto de rendimiento en GPU integrada.

## What Changes

- Iluminación: sol direccional con una única sombra (≤ 2048) que sigue al coche, luz ambiental de entorno, cielo con degradado y niebla de horizonte, mapeo de tonos ACES.
- Monoplaza procedural detallado de una escudería ficticia: alerones, pontones, halo, ruedas que giran y viran, alerón trasero que se abre con el DRS, materiales PBR con reflejos.
- Superficies: asfalto con textura y goma en la trazada, hierba con franjas, pianos y muros con mejor material, cajones de parrilla.
- Entorno: gradas, árboles y silueta lejana con instancias.
- Efectos: partículas de tierra en la hierba y humo al deslizar; posproceso ligero (bloom y viñeta).
- Calidad adaptativa por niveles y medición de fps, para garantizar 60 fps a 1080p.

## Capabilities

### New Capabilities
- `visual-quality`: aspecto del coche, la pista, el entorno, la iluminación, los efectos y el posproceso.
- `render-performance`: presupuesto de render ampliado, niveles de calidad, adaptación automática y medición de fps.

### Modified Capabilities

Ninguna: el presupuesto de `game-shell` (DPR ≤ 1,5, < 200 draw calls, < 600 000 triángulos) sigue vigente y se refuerza aquí.

## Impact

- Cambios en `src/render/`, `src/track/mesh.ts`, `config.ts` y `DebugSnapshot`.
- Sin dependencias nuevas: se usan los módulos de posproceso incluidos en `three`. Todo es procedural; los generadores con Gemini no se usan en este change.

**Fuera de alcance:** rivales, clima, noche, daños, repeticiones, menús, modelos o texturas externos, cualquier logotipo o marca. No se toca la física ni el protocolo.
