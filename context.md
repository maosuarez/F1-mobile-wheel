# F1 Mobile Wheel

## Descripción
Juego de carreras de Fórmula 1 en el navegador: el PC muestra la carrera en 3D y un celular Android hace de volante (inclinación + controles táctiles), emparejado por QR. Circuito: Interlagos, a partir de datos públicos reales. Visión completa en `docs/vision.md`.

## Stack
- Juego (PC): Vite + TypeScript + Three.js vanilla. npm.
- Física: modelo arcade propio en TypeScript puro, sin motor de física.
- Volante: web móvil servida por el mismo Vite en `/wheel/` (Chrome Android).
- Tiempo real: WebSocket con relay FastAPI (Python 3.12, uvicorn), detrás del proxy de Vite.
- Datos de pista: Python (fastf1, numpy, scipy, pandas, matplotlib) → `public/track/<id>.json`.
- Tests: Vitest (física) y Playwright vía skill `webapp-testing` (navegador).

## Arquitectura
```
index.html / wheel/index.html   # dos entradas Vite: juego y volante
src/shared/  protocol.ts (mensajes PC↔celular), config.ts (constantes ajustables)
src/sim/     física pura: sin three ni DOM, paso fijo 1/120 s
src/track/   carga de track.json, consultas (s, d), mallas
src/render/  escena, cámaras, materiales, posproceso
src/audio/   motor procedural (Web Audio)
src/host/    arranque, HUD, QR, WS     src/wheel/  interfaz, sensores, WS
server/main.py              # relay WS (/ws/{room}?role=host|wheel) + /api/info
tools/track/build_track.py  # pipeline de circuito    tools/fake_wheel.py  # volante simulado
public/track/   tests/
```
- Flujo: el volante envía la entrada a 60 Hz → relay → el PC simula y devuelve telemetría a 20 Hz.
- El render interpola entre pasos de física.

Comandos:
```bash
npm run dev                                   # vite --host :5173 (proxy /ws y /api → :8000)
uvicorn server.main:app --reload --port 8000
npm run dev:wifi                              # modo principal: HTTPS en LAN → https://<IP>:5173/wheel/?room=XXXX
adb reverse tcp:5173 tcp:5173                 # alternativa USB → http://localhost:5173/wheel/?room=XXXX
python tools/fake_wheel.py --room XXXX --script lap
python tools/track/build_track.py --track interlagos
npx vitest run
```

## Convenciones
- Código y nombres en inglés; comentarios y mensajes de interfaz en español.
- Constantes ajustables solo en `src/shared/config.ts`, agrupadas por dominio (`car`, `aero`, `gears`, `ers`, `drs`, `wheel`).
- El protocolo vive solo en `src/shared/protocol.ts`; el servidor lo replica en un comentario y no tiene lógica de juego.
- Un commit por bloque cerrado, con mensaje descriptivo (Conventional Commits).
- Panel de depuración con `F3`: fps, draw calls, RTT y telemetría física.

## Restricciones técnicas
- Prohibido: React / React Three Fiber, Babylon.js, Rapier o Cannon para el coche, WebRTC, app nativa, service workers.
- Modo principal: WiFi con HTTPS (`npm run dev:wifi`, certificado autofirmado que el celular acepta una vez); los sensores exigen contexto seguro, así que HTTP plano en LAN no sirve. Alternativas: URL pública (`PUBLIC_URL`) y USB con `adb reverse` (`localhost` es contexto seguro).
- Dirección del volante: `devicemotion` (gravedad), no `deviceorientation`.
- Rendimiento (GPU integrada): 60 fps a 1080p, DPR ≤ 1.5, < ~200 draw calls, una luz con sombras (≤ 2048), posproceso ligero.
- Sin marcas registradas (F1, equipos, pilotos, patrocinadores): escudería ficticia. Los nombres de lugares sí se permiten.
- Generadores con Gemini (`threejs-3d-generator`, `threejs-image-generator`): solo si existe `GEMINI_API_KEY` en `.env`; si no, todo procedural.
- Datos de FastF1: uso personal, no comercial.

## Contexto de negocio
Proyecto personal y demostrativo. Un jugador, sin rivales en el MVP. Meta: MVP jugable en ~1 día. Prioridad: jugable > se siente como un F1 > se ve espectacular.

Alcance por bloques (cada uno se cierra cuando cumple sus criterios):
1. Datos del circuito → `interlagos.json` + PNG de control (criterios en la skill `track-pipeline`).
2. Pista + coche jugables con teclado; una vuelta completa con cronómetro; tests de física en verde.
3. Volante móvil completo (criterios en `phone-wheel-controller`).
4. Mecánicas de F1: marchas, DRS, ERS, límites de pista (criterios en `f1-car-feel`).
5. Sensaciones: audio del motor, cámaras de persecución, casco y TV, FOV dinámico, háptica.
6. Pulido visual, solo si 1–5 están cerrados y sin romper el presupuesto de rendimiento.
