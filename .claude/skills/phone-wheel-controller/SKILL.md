---
name: phone-wheel-controller
description: Convierte un celular Android en el volante del juego vía navegador. Úsala para todo lo relacionado con la página /wheel/, los sensores de inclinación (devicemotion), el filtrado de la dirección, la interfaz táctil del volante (pedales, levas, DRS, ERS), la pantalla de telemetría del celular, el emparejamiento por QR, el relay WebSocket en FastAPI, el protocolo de mensajes PC-celular, la vibración háptica, adb reverse y el volante simulado fake_wheel.py.
---

# Volante móvil (Android, web)

El celular abre `/wheel/?room=CODE`, lee la inclinación y los toques, y envía la entrada al PC por WebSocket a través de un relay FastAPI. El PC devuelve telemetría para la pantalla del volante. Solo Android con Chrome; iOS no es objetivo.

## 1. Conectividad y contexto seguro

Los sensores de movimiento exigen **contexto seguro**.

- **Modo USB (principal):** `adb reverse tcp:5173 tcp:5173`. El celular abre `http://localhost:5173/wheel/?room=CODE`; `localhost` cuenta como seguro, así que no hace falta HTTPS. Para abrir la URL desde el PC: `adb shell am start -a android.intent.action.VIEW -d "http://localhost:5173/wheel/?room=CODE"`.
- **Modo WiFi (secundario):** Vite con HTTPS (`@vitejs/plugin-basic-ssl`). El celular abre `https://<IP-LAN>:5173/wheel/?room=CODE` y acepta el certificado una vez.
- **Un solo origen:** Vite hace de proxy de `/ws` y `/api` hacia uvicorn (`:8000`, con `ws: true`). El celular solo habla con `:5173`, así que basta un `adb reverse`.

## 2. Emparejamiento

1. El PC genera un código de sala de 4 caracteres (sin caracteres ambiguos como 0/O, 1/I) y se conecta a `/ws/CODE?role=host`.
2. El PC pide `/api/info`, donde el servidor devuelve sus IP de LAN y, si existe, la variable `PUBLIC_URL`.
3. El PC muestra un QR (librería `qrcode`) con la URL del modo activo, el código en grande y una indicación: "USB: localhost" o "WiFi: https://IP".
4. El celular se conecta a `/ws/CODE?role=wheel`. El servidor admite un host y un volante por sala; un volante nuevo reemplaza al anterior.
5. Al conectarse el volante, el PC oculta el QR y arranca la cuenta atrás.

## 3. Relay en FastAPI (`server/main.py`)

- Salas en memoria: `dict[code] -> {host, wheel}`.
- Reenvía mensajes tal cual: volante → host y host → volante. **No contiene lógica de juego.**
- Avisa a la otra parte con `{t:"peer", role, connected}` cuando alguien entra o sale.
- Ping cada 2 s; si una conexión no responde en 6 s, se cierra.
- `GET /api/info` → `{lan_ips: [...], public_url}`.

## 4. Protocolo (`src/shared/protocol.ts`, JSON)

| Mensaje | Dirección | Frecuencia | Campos |
|---|---|---|---|
| `in` | volante → PC | 60 Hz | `seq`, `ts` (ms del celular), `steer` [-1,1], `thr` [0,1], `brk` [0,1], `ers` (bool, mantenido) |
| `ev` | volante → PC | al ocurrir | `k`: `"up"`, `"down"`, `"drs"`, `"cam"`, `"pause"`, `"recal"` |
| `tel` | PC → volante | 20 Hz | `spd` (km/h), `gear` (−1 = R, 0 = N, 1–8), `rpm`, `leds` (0–15, 16 = parpadeo de limitador), `drs` (0 no disponible, 1 disponible, 2 abierto), `ers` [0,1], `ot` (bool, adelantamiento activo), `lap`, `delta`, `warn` (texto corto o vacío), `echo` (último `ts` recibido) |
| `fx` | PC → volante | al ocurrir | `k`: `"kerb"`, `"grass"`, `"limits"`, `"shift"`, `"limiter"` (para la vibración) |

- Redondea los números a 3 decimales.
- Los cambios de marcha van como **eventos discretos** (WebSocket es fiable y ordenado), nunca como un estado mantenido.
- **RTT:** el volante calcula `ahora − tel.echo` y lo muestra; el PC lo enseña en el panel `F3`.
- **Volante perdido:** si el PC no recibe `in` durante más de 250 ms, el coche suelta el acelerador; a los 1 000 ms, el juego se pausa y avisa "Volante desconectado".

## 5. Dirección por inclinación

El jugador sostiene el celular en horizontal, con la pantalla hacia él, y lo gira como un volante: eso es una rotación alrededor del eje perpendicular a la pantalla.

- **Fuente:** `devicemotion` → `accelerationIncludingGravity` (vector de gravedad en coordenadas del dispositivo). **No uses `deviceorientation` alpha/beta/gamma**: en horizontal mezcla ejes y depende de la brújula.
- **Ángulo bruto:** `θ = atan2(ax, ay)` en el plano de la pantalla. Corrígelo con `screen.orientation.angle` (90 o 270) y envuélvelo a [−180°, 180°]. El signo se valida empíricamente: girar a la derecha debe dar `steer > 0`.
- **Celular casi plano:** si `sqrt(ax² + ay²) < 3 m/s²`, el ángulo no es fiable. Mantén el último valor y muestra "Levanta el volante".
- **Calibración:** al empezar y con el botón "Centrar", `θ0 = θ` actual. Ángulo relativo: `φ = θ − θ0`.
- **Filtro One Euro** sobre `φ` (en grados). Valores iniciales: `minCutoff 1.0`, `beta 0.02`, `dCutoff 1.0`. Ajusta para que no haya temblor parado ni retraso al girar rápido.
- **Zona muerta:** 1,5°. **Recorrido completo:** ±60° → `steer` ±1, recortado.
- **Curva de respuesta:** `out = (1 − k)·x + k·x³` con `k = 0.35`, para precisión cerca del centro.
- Todos estos valores van en `config.ts`, en el bloque `wheel`.

## 6. Interfaz del volante (usa `frontend-design`)

En horizontal y a pantalla completa, inspirada en un volante de F1 real, **sin logos ni marcas**.

```
┌─────────────────────────────────────────────┐
│ [− LEVA]     ●●●●●○○○○○○○○○○      [LEVA +]  │
│              ┌───────────────┐               │
│  ▓ FRENO ▓   │  287 km/h  7  │   ▓ ACELERA ▓ │
│  ▓       ▓   │ DRS ▣  ERS ███▒│   ▓        ▓ │
│  ▓       ▓   └───────────────┘   ▓        ▓ │
│          [DRS]  [CAM] [CENTRAR]  [ERS]       │
└─────────────────────────────────────────────┘
```

- **Pedales analógicos:** el valor depende de la posición vertical del dedo dentro de la zona (abajo 0, arriba 1). Alternativa en `config.ts`: modo digital con rampa de 120 ms.
- **Multitáctil** con Pointer Events, `touch-action: none`, sin selección de texto ni menú contextual. Pedales, levas y botones deben poder usarse a la vez.
- **15 LEDs de RPM:** 5 verdes, 5 rojos y 5 azul-violeta; todos parpadean en el limitador.
- La marcha se muestra enorme. "N" y "R" en otro color.
- Feedback visual inmediato al tocar, sin esperar al PC.
- **Primer toque** ("Toca para empezar"): llama a `requestFullscreen()` y luego a `screen.orientation.lock("landscape")`, activa `navigator.wakeLock.request("screen")` y empieza a escuchar `devicemotion`. Captura los errores de cada llamada sin romper la página.

## 7. Vibración háptica

- `navigator.vibrate` con límite de una llamada cada 80 ms.
- Patrones de inicio: `shift` 12 ms, `kerb` 25 ms repetido mientras dure, `grass` [40, 30, 40], `limits` 120 ms, `limiter` 8 ms cada 100 ms.
- Interruptor en el volante para apagarla.

## 8. Volante simulado (`tools/fake_wheel.py`)

- Usa la librería `websockets`. Argumentos: `--room`, `--url` (por defecto `ws://localhost:5173/ws`) y `--script` con alguno de estos:
  - `straight`: acelera y sube marchas.
  - `circle`: dirección fija.
  - `lap`: dirección sinusoidal con pulsos de freno.
  - `random`: entrada aleatoria suave.
- Imprime la telemetría recibida, una línea por segundo.
- Lo usan los tests de `webapp-testing` y sirve para depurar sin celular.

## 9. Criterios de aceptación

- [ ] QR → el celular toma el control en menos de 5 s por USB.
- [ ] Con el celular quieto sobre la mesa en horizontal, `steer` se mantiene estable en ±0,01.
- [ ] Al girar a la derecha, el coche gira a la derecha.
- [ ] RTT por USB menor de 30 ms, visible en `F3`.
- [ ] Acelerar, frenar y cambiar de marcha a la vez funciona.
- [ ] La pantalla del volante actualiza velocidad, marcha y LEDs a 20 Hz sin saltos.
- [ ] Desenchufar o cerrar la pestaña del volante pausa el juego con aviso, y al reconectar se reanuda.
- [ ] `fake_wheel.py --script lap` completa una vuelta sin intervención.
