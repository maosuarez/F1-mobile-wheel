---
name: f1-car-feel
description: Física arcade y sensaciones de un monoplaza de F1 en src/sim (TypeScript puro). Úsala para el modelo de vehículo, aerodinámica y carga, agarre y deslizamiento, dirección sensible a la velocidad, caja secuencial de 8 marchas, limitador y LEDs de RPM, DRS, ERS y modo adelantamiento, superficies (asfalto, pianos, hierba, muros), límites de pista, pendientes, cronometraje de vueltas, audio procedural del motor con Web Audio, cámaras y tests de física con Vitest.
---

# Sensaciones de F1 (física arcade)

Objetivo: que se **sienta** como un F1 (frenadas brutales, más agarre cuanto más rápido, cambios secos), sin ser un simulador. Todo en `src/sim/` sin three ni DOM, con paso fijo de 1/120 s. **Todos los números de este documento son valores iniciales para ajustar**, y van en `config.ts`.

## 1. Pista en coordenadas de pista (sin motor de física)

Usa la API de `src/track/` (ver `track-pipeline`):

- Para la posición (x, z) del coche, busca la muestra más cercana partiendo del último índice conocido (ventana de ±20 muestras) y obtén `s` (distancia recorrida) y `d` (desplazamiento lateral; positivo a la izquierda).
- **Altura y orientación:** interpola `y`, la pendiente y el peralte de la pista en `s`. Altura del coche = `y(s) + bank(s)·d`. El coche se apoya en la superficie: no hay suspensión simulada, solo un suavizado visual del cabeceo y el balanceo.
- **Superficie según `d`:** asfalto si `−wr ≤ d ≤ wl`; piano si cae dentro de un tramo `kerbs` de ese lado y hasta 1,2 m fuera del borde; hierba más allá; muro a `edge + runoff`.
- **Muro:** recorta `d`, elimina la componente de velocidad hacia el muro con restitución de 0,3, quita un 15 % de la velocidad y aplica un pequeño giro alejándose del muro.

## 2. Estado y fuerzas

Constantes iniciales: masa 800 kg; batalla 3,6 m; potencia de combustión ≈ 560 kW más ERS (ver §5); ρ = 1,2.

- **Aero:** arrastre `Fd = ½ρ·CdA·v²` y carga `Fl = ½ρ·ClA·v²`. Inicial: `CdA = 1.4`, `ClA = 4.0`. Ajusta `CdA` para que la velocidad punta en llano sin DRS sea ≈ 325 km/h.
- **Agarre disponible:** `aMax = μ·(m·g + Fl)/m · μSurface`. Inicial: `μ = 1.7`. Así resultan ≈ 2 g laterales a 100 km/h y ≈ 4 g a 250 km/h: **esta es la sensación clave de un F1**.
- **Círculo de fricción:** `(ax/aMax)² + (ay/aMax)² ≤ 1`. Si la demanda lo excede, el excedente se convierte en deslizamiento (§3).
- **Rodadura:** 0,015·m·g en asfalto; mucho mayor en hierba.
- **Pendiente:** `a −= g·sin(pitch)` a lo largo del eje del coche. Cuesta abajo, en la S de Senna, la frenada se alarga.
- **Frenada:** la deceleración máxima sale del mismo `aMax` (por eso es mucho más fuerte a alta velocidad) más el arrastre. Con freno al 100 % y por encima de ~200 km/h deben sentirse ~4–5 g.

## 3. Dirección y deslizamiento (modelo arcade)

- **Ángulo máximo según la velocidad:** `δmax = lerp(16°, 3.5°, clamp(v/85, 0, 1))`. Imprescindible para que el volante del celular sea manejable a 300 km/h.
- **Giro deseado:** `r = v·tan(δ)/batalla`, con aceleración lateral `ay = v·r`.
- **Subviraje:** si `ay` supera el agarre lateral disponible, `r` se recorta a `ayMax/v` y el coche abre la trazada.
- **Sobreviraje:** el agarre trasero baja con exceso de tracción en marchas cortas, reducciones bruscas o pianos mal pisados. Entonces se añade un giro extra proporcional al déficit y el vector de velocidad se separa del rumbo.
- **Rumbo frente a velocidad:** el vector de velocidad se alinea con el rumbo a una tasa proporcional al agarre (relajación exponencial). Con poco agarre (hierba), el coche patina.
- Suaviza la entrada de dirección en la simulación (constante de tiempo ≈ 60 ms), además del filtro del volante.

## 4. Caja secuencial de 8 marchas

- Marchas R, N y 1–8. **Limitador de juego: 12 500 rpm.** Ralentí: 4 000 rpm.
- **Relaciones:** calcula la desmultiplicación de cada marcha para que llegue al limitador a ≈ 95, 130, 160, 190, 225, 260, 295 y 335 km/h.
- **Curva de par:** meseta entre 9 000 y 12 000 rpm, caída suave por debajo y corte en el limitador.
- **Cambio:** 40 ms de corte de par, acompañado de un sonido seco y una vibración háptica.
- **Tracción:** la fuerza motriz se limita a `μ·cargaTrasera` (carga trasera ≈ 55 % del total). Si se supera, hay patinaje: suben las RPM, baja la tracción y aparece la señal de sobreviraje.
- **Protección de reducción:** si las RPM tras reducir superan el limitador + 500, la reducción **se rechaza** con aviso y vibración. Opcionalmente (asistencias desactivadas), se acepta y se bloquea el tren trasero durante 300 ms.
- **Sobrecalentamiento:** cada segundo en el limitador suma temperatura; por encima del umbral, la potencia baja un 20 % hasta que se enfríe, con aviso "MOTOR".
- **Reversa:** solo por debajo de 5 km/h, desde N.
- **LEDs (0–15):** se encienden progresivamente desde el 75 % hasta el punto óptimo de cambio (≈ 96 % del limitador). En el limitador, valor 16 (parpadeo).

## 5. ERS y modo adelantamiento

- **Batería normalizada 0–1**, que empieza la vuelta en 1.
- **Despliegue base automático:** +120 kW mientras haya acelerador a fondo y batería disponible, con un gasto proporcional.
- **Botón de adelantamiento:** mientras se mantiene, el despliegue extra es de +60 kW y el gasto se triplica. Se corta si la batería baja de 0,05.
- **Recuperación:** la frenada recarga en proporción a la fuerza de freno; además hay una recarga pequeña y fija por vuelta al cruzar la meta.
- **Límite de despliegue por vuelta** en `config.ts`, para que haya que administrarlo.

## 6. DRS

- **Zonas** desde `track.json` (`drs_zones`: `detect_s`, `start_s`, `end_s`). Interlagos tiene dos: la recta principal y la Reta Oposta.
- **Disponible** cuando el coche está entre `start_s` y `end_s`. En el MVP, sin rivales, la detección siempre habilita.
- **Abierto:** `CdA` −18 % y `ClA` trasero −10 %, lo que da ≈ +10–15 km/h de punta.
- **Se cierra** al pisar el freno (más del 10 %) o al salir de la zona.

## 7. Superficies y límites de pista

| Superficie | μSurface | Extra |
|---|---|---|
| Asfalto | 1.00 | |
| Piano | 0.85 | Ruido de giro pequeño; temblor de cámara y vibración `kerb` |
| Hierba | 0.45 | Rodadura ×6, vibración `grass`, tierra visual |

- **Límites de pista:** si el centro del coche supera el borde más la mitad del ancho del coche (≈ 1 m), la vuelta queda **invalidada** (el tiempo se muestra tachado), con aviso `limits` y vibración.

## 8. Cronometraje

- Vuelta al cruzar `start_s` hacia delante. Hay tres sectores.
- **Delta en vivo** frente a la mejor vuelta válida, comparando el tiempo en cada `s`.
- La mejor vuelta se guarda en `localStorage` (con try/catch).

## 9. Audio del motor (Web Audio, procedural)

- **Frecuencia base:** frecuencia de encendido de un V6, `f = rpm/60 · 3`.
- **Capas:** dos osciladores (sierra en `f`, cuadrada en `2f`) → waveshaper → paso bajo, cuyo corte sube con el acelerador. Encima, ruido filtrado de turbo y viento proporcional a la velocidad.
- **Volumen** según el acelerador; en vacío suena más suave y áspero.
- **Cambio:** caída de 40 ms y un "crack" corto. **Limitador:** modulación de volumen a ~15 Hz.
- El `AudioContext` se crea en el primer gesto del usuario.

## 10. Cámaras y sensación de velocidad

- **Persecución:** resorte crítico, mirando hacia delante en la dirección de la velocidad.
- **Casco:** interior, con un leve balanceo lateral según las g.
- **TV:** cámaras fijas elevadas cada ~300 m de `s`; cambia a la siguiente cuando el coche la pasa.
- **FOV** 70° → 84° entre 0 y 320 km/h. Temblor de cámara en pianos y hierba, y una vibración leve permanente por encima de 250 km/h.

## 11. Tests de física (Vitest, `tests/sim.*.test.ts`)

Simulan sobre una pista recta y plana sintética, salvo indicación contraria.

- [ ] Velocidad punta sin DRS: 315–335 km/h. Con DRS: +8 a +18 km/h.
- [ ] De 0 a 100 km/h en 2,4–3,2 s, con cambio automático en el test.
- [ ] De 0 a 200 km/h en menos de 6,5 s.
- [ ] Frenada de 300 a 80 km/h en 90–140 m.
- [ ] Aceleración lateral máxima a 250 km/h: 3,5–4,8 g.
- [ ] Una reducción que pasaría del limitador se rechaza.
- [ ] El DRS se cierra al frenar.
- [ ] La batería ERS baja con el botón y sube en frenada.
- [ ] En hierba, la velocidad máxima de giro es menor que en asfalto.
- [ ] La simulación es determinista: misma entrada, mismo resultado.
