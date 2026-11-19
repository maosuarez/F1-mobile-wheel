# Tasks

> Orden: 1 → 2 → 3 → 4 → 5. Las tareas 3 y 4 dependen de 1 y 2; no hay paralelismo útil (archivos compartidos). Cada worker lee antes `design.md` y `specs/minimap/spec.md`.

## 1. Configuración (worker-sonnet)

- [x] 1.1 Añadir a `src/shared/config.ts` el bloque `minimap` de design D1. Verificación: `npx tsc --noEmit` y `npx vitest run` en verde.

## 2. Cálculo puro (worker-opus)

- [x] 2.1 Crear `src/track/minimap.ts` con `MinimapPath`, `createMinimapPath` y `buildMinimapPath` (design D2), sin asignaciones en `buildMinimapPath`. Criterio: respeta la convención de ejes del sim y el cruce de meta. Verificación: `npx tsc --noEmit`.
- [x] 2.2 Crear `tests/minimap.path.test.ts` con `makeStraightTrack`/`makeOvalTrack` (`src/track/synthetic.ts`): scenarios "Recta alineada", "Rumbo desalineado", "Cruce de meta", "Curva a izquierda" (usar el sentido de la óvalo para elegir el signo esperado), "Recta sin marcas", y 1000 llamadas con media ≤ 0,3 ms. Verificación: `npx vitest run tests/minimap.path.test.ts`.

## 3. Dibujo y DOM (worker-sonnet)

- [x] 3.1 Crear `src/host/minimap.ts` (`Minimap`, design D3) y añadir el `<canvas data-testid="hud-minimap">` a `index.html` y el CSS a `src/host/hud.css` (design D4). Criterio: sin asignaciones por fotograma, limitado a `redrawHz`. Verificación: `npx tsc --noEmit` y `npx vitest run`.

## 4. Integración y prueba en navegador (worker-sonnet)

- [x] 4.1 Integrar en `src/host/main.ts` (design D5) y ajustar el desplazamiento CSS. Verificación: `npx tsc --noEmit` y `npx vitest run`.
- [x] 4.2 Crear `tests/e2e/b8_minimap.py` siguiendo el patrón de `tests/e2e/b5_feel.py` (puertos limpios): arrancar en carrera con el piloto automático, comprobar que `[data-testid="hud-minimap"]` existe, que su rectángulo no se interseca con `.hud-energy` ni `hud-warn` a 1920×1080 y 1280×720, que el canvas tiene píxeles no vacíos y que no hay errores de consola tras una vuelta. Verificación: ejecutar el script.

## 5. VR (worker-sonnet)

- [x] 5.1 Añadir `minimapSizeM: 0.22` a `config.vr`; exponer `canvas`, `version` y el tamaño de respaldo de 256 px en `src/host/minimap.ts`; crear `src/host/vr/minimap.ts` (`VrMinimap`, design D6) e integrarlo en `src/host/main.ts` junto al `VrPanel`. Test `tests/vr.minimap.test.ts` (three en Node, canvas falso como en los tests del panel de VR si existen): scenarios "Posición en VR" y "Refresco en VR". Verificación: `npx tsc --noEmit`, `npx vitest run` y `.venv/bin/python tests/e2e/b8_minimap.py` en verde.

## 6. Cierre (Fable)

- [x] 6.1 `npx vitest run` en verde, `webapp-testing` sin errores de consola, revisión con `code-review-graph` y commit Conventional Commits vía `commit-orchestrator` (`feat(hud): añadir minimapa de anticipación`).
