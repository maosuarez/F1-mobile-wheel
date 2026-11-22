# Design

## Context

El relay actual empareja 1 host y 1 volante por sala y reenvía texto sin interpretarlo. `RaceSession` simula todos los coches localmente y de forma determinista. El juego se despliega en Docker con `PUBLIC_URL` (túnel opcional).

## Decisions

### D1. Endpoint de carrera en el relay
`/ws/race/{code}?name=<≤16>`; `code` de 6 caracteres del `ROOM_ALPHABET`. Estado por sala: plazas 0..`RACE_MAX` − 1 (6), nombres, propietario (la plaza conectada más baja), `started: bool`.
- Al conectar: si la sala está llena o `started`, cierra con 4001/4002. Si no, asigna la plaza libre más baja y difunde `{"t":"lobby","you":n,"owner":o,"players":[{"slot":..,"name":..}]}`.
- Reenvío: todo texto recibido (≤ 4 KB) se difunde a los demás envuelto con concatenación de cadenas, sin parsear el contenido: `'{"t":"r","f":%d,"m":%s}' % (slot, text)`. Antes, el relay comprueba solo que el texto empieza por `{` para que el JSON envuelto sea válido.
- Mensajes que el relay sí entiende (prefijo literal): `{"t":"time"` → responde `{"t":"time","srv":<ms epoch>}`; `{"t":"started"` del propietario → marca `started`.
- Al desconectar: libera plaza, recalcula propietario y difunde `lobby`.
- `RACE_TEST_DELAY_MS` (entorno, por defecto 0): retardo artificial de reenvío solo para pruebas.

### D2. Mensajes de juego (dentro de `m`)
```ts
interface NetHello { t: 'hello'; name: string; team: number }
interface NetCfg   { t: 'cfg'; track: string; laps: number; rivals: number; ai: 'easy'|'medium'|'hard'; seed: number; grid: number[] }  // grid: orden de plazas humanas; IA detrás
interface NetStart { t: 'start'; atSrv: number }            // instante del inicio del semáforo (ms reloj servidor)
interface NetCar   { t: 'st'; ts: number; x: number; y: number; z: number; yaw: number; pitch: number; roll: number; v: number; steer: number;
                     s: number; d: number; laps: number; prog: number; drs: 0|1|2; fin: boolean; tt: number | null; best: number | null }
interface NetAi    { t: 'ai'; ts: number; cars: [x,y,z,yaw,v,steer,s,d,laps,prog,fin,tt,best][] }   // en orden de id de IA
interface NetRes   { t: 'res'; rows: { id: number; tt: number | null; laps: number; best: number | null; dnf: boolean }[] }
```
Decodificadores con validación como el resto de `protocol.ts`; números a 3 decimales.

### D3. Reloj común
`clock.ts`: 5 pings `time` al entrar al vestíbulo; offset = mediana de `srv − (t0 + t1)/2`; re-sincroniza cada 10 s con media móvil. Tiempos de red en ms del servidor.

### D4. Autoridad e interpolación
- Coche propio: simulado localmente (como hoy); se envía `st` a 20 Hz.
- IA: la simula solo el propietario dentro de su `RaceSession` y envía `ai` a 20 Hz.
- `RaceSession` admite entradas `kind: 'local' | 'ai' | 'remote'`. Las `remote` no se integran: cada paso toman la pose de `RemoteCar.sample(nowSrv − net.interpDelayMs)` (100 ms), con interpolación lineal (ángulos por el camino corto) y extrapolación ≤ `net.maxExtrapMs` (250 ms); más allá, quieto.
- Colisiones: local/IA contra remoto = unilateral: se calcula la separación y el impulso como entre dos coches de igual masa (D2 de b14), usando la velocidad estimada del remoto, pero solo se aplica la parte del coche no remoto (`net.remoteMassFactor` = 1 escala esa parte). Remoto contra remoto: no se resuelve localmente.
- Clasificación local: por `laps`/`prog` de todos. Resultado oficial: el propietario reúne los `fin` y envía `res`; los demás muestran `res` cuando llega (si no llega en 10 s, muestran su clasificación local).

### D5. Salida sincronizada
El propietario envía `cfg` y luego `start { atSrv: ahora + 3000 }` y `started`. Todos crean la `RaceSession` con la misma semilla y parrilla; el semáforo arranca cuando `nowSrv ≥ atSrv`; el apagado aleatorio sale de la semilla, así que es el mismo instante en todos (± error de reloj). En online la fase de luces no avanza por pasos de simulación: cada fotograma se calcula `elapsed = (nowSrv − atSrv)/1000` y `RaceSession.syncLights(elapsed)` fija las luces encendidas y pasa a verde cuando `elapsed ≥ lightsOutAtS` (si no, un PC lento, cuya simulación va por detrás del tiempo real, apagaría más tarde). Offline sigue igual.

### D6. Abandonos
Un jugador que cierra: su coche queda como retirado (DNF), se quita de la escena 2 s después. El propietario que se va: los demás marcan la IA como retirada; el nuevo propietario solo asume compilar `res`.

### D7. Vestíbulo y menú
Menú "Online" con: Nombre (guardado), "Crear sala" (genera código de 6) o "Unirse" (campo de código), lista de jugadores con plaza y nombre, y para el propietario: rivales de IA (0–9 − humanos), dificultad, "Empezar" (≥ 1 jugador). Cada PC sigue emparejando su volante con su sala normal (sin cambios). Circuito: el actual del juego (la selección de circuito llega en b17 y se añadirá a `cfg.track`).

### D8. Constantes
`config.net` añade `{ raceHz: 20, interpDelayMs: 100, maxExtrapMs: 250, remoteMassFactor: 1, raceMax: 6, resultsWaitS: 10, clockPings: 5, clockResyncS: 10 }`.

## Risks / Trade-offs

- Autoridad del cliente: trampas posibles; aceptable en un proyecto personal.
- Con RTT > 200 ms los contactos se ven desfasados; la colisión unilateral evita que dos clientes "se peleen", a costa de asimetría.
- Coste de red: 6 coches × 20 Hz × ~200 B ≈ 24 KB/s por cliente, más la IA: aceptable.
