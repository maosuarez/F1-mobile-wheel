# Proposal

## Why

Tras b20 la dirección del volante se nota menos fluida al girar y la conducción, más confusa. Causa: el detector de sacudidas cuenta picos en cualquier eje y congela la dirección 350 ms con un solo pico. Al girar rápido el celular aparecen picos en el plano de la pantalla, sobre todo si el navegador no da aceleración lineal y se resta una gravedad estimada con retraso. Eso provoca tirones y activaciones de ERS/DRS que nadie pidió. Corrige el bloque 3 (volante) tal como lo dejó `b20-vr-wheel-ux`.

## What Changes

- La sacudida solo cuenta en el eje perpendicular a la pantalla (empujar y tirar del celular, hacia delante y atrás). Girar el volante rota el celular en el plano de la pantalla y no genera picos en ese eje.
- Se elimina el congelado de la dirección: empujar el celular no cambia el ángulo de inclinación, así que no hace falta.
- La gravedad del eje Z se estima con el mismo paso bajo, pero solo para ese eje.

Fuera de alcance: umbrales nuevos (siguen en `config.wheel.shake`), cambios en el host, VR o protocolo.

## Capabilities

### New Capabilities

### Modified Capabilities
- `wheel-ui`: la sacudida se mide solo en el eje perpendicular a la pantalla y la dirección no se congela.

## Impact

`src/wheel/shake.ts`, `src/wheel/main.ts`, `src/shared/config.ts` (se quita `freezeMs`), `tests/wheel.shake.test.ts`, `tests/e2e/b20_vr_wheel.py`, `tests/e2e/b11_wheel_ui.py`.
