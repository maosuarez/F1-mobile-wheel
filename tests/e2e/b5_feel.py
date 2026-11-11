# E2E del bloque 5: audio del motor, cámaras, FOV dinámico y háptica.
# Lanzar con relay y Vite ya activos:  E2E_WEB_PORT=5173 .venv/bin/python tests/e2e/b5_feel.py
# (g) usa el volante de la página /wheel/ con toques reales: el relay admite un solo volante por sala,
# así que fake_wheel.py no puede convivir con la página que registra las vibraciones; sus cambios de
# marcha ("straight": marcha objetivo = 1 + v // 60, más subir con LEDs altos) se reproducen con la leva de la página.
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(__file__))
import b3_wheel as b3  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

WEB_PORT = os.environ.get("E2E_WEB_PORT", "5173")
BASE = f"http://localhost:{WEB_PORT}"
errors = b3.errors
checks = []
warnings = []
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:  # noqa: BLE001
        check(f"{name}: excepción", False, f"{type(e).__name__}: {str(e)[:300]}")
        traceback.print_exc()


def snap(page):
    return page.evaluate("window.__f1.snapshot()")


def watch(page, label):
    b3.watch(page, label)
    page.on("console", lambda m: warnings.append((label, m.text)) if m.type == "warning"
            and any(k in m.text.lower() for k in ("autoplay", "audiocontext")) else None)
    return page


def open_host(ctx, label, query="debug=1", state="pairing"):
    pg = watch(ctx.new_page(), label)
    pg.goto(f"{BASE}/?{query}")
    pg.wait_for_function(f"window.__f1 && window.__f1.snapshot().gameState === '{state}'", timeout=60000)
    return pg


def wait_state(pg, st, timeout=120000):
    pg.wait_for_function(f"window.__f1.snapshot().gameState === '{st}'", timeout=timeout)


def wait_sim(pg, dt, timeout=300000):
    t0 = snap(pg)["simTimeS"]
    pg.wait_for_function(f"window.__f1.snapshot().simTimeS >= {t0 + dt}", timeout=timeout)


def main():
    os.makedirs("out", exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=ARGS)

        # (a) recién cargada: audio null, sin avisos de autoplay
        def a():
            ctx = browser.new_context(viewport={"width": 1280, "height": 720})
            pg = open_host(ctx, "host-a")
            pg.wait_for_timeout(1500)
            s = snap(pg)
            check("a: audio es null antes del gesto", s["audio"] is None, str(s["audio"]))
            check("a: sin avisos de autoplay", not warnings, str(warnings)[:200])
            ctx.close()
        step("a", a)

        # (b) (c) (d) (e) teclado en una misma página
        def bcde():
            ctx = browser.new_context(viewport={"width": 1280, "height": 720})
            pg = open_host(ctx, "host-b")
            check("e: arranca en helmet", snap(pg)["camera"]["mode"] == "helmet", snap(pg)["camera"]["mode"])
            pg.keyboard.press("Enter")
            wait_state(pg, "racing")
            pg.keyboard.down("KeyW")
            wait_sim(pg, 3)
            # f0 ≈ rpm/60*3 en el mismo instante; se toman varias muestras (las rampas suavizan f0)
            best, ss = 1e9, []
            for _ in range(15):
                s = snap(pg)
                a_ = s["audio"]
                if a_ and s["rpm"] > 0:
                    err = abs(a_["f0Hz"] - s["rpm"] / 60 * 3) / (s["rpm"] / 60 * 3)
                    best = min(best, err)
                    ss.append((round(s["rpm"]), round(a_["f0Hz"], 1), round(a_["rms"], 3)))
                pg.wait_for_timeout(100)
            s = snap(pg)
            au = s["audio"]
            check("b: audio.state = running", au is not None and au["state"] == "running", str(au))
            rms_max = max((x[2] for x in ss), default=0)
            check("b: rms > 0.01", rms_max > 0.01, f"rms max={rms_max}")
            check("b: f0Hz coherente con rpm (±5 %)", best <= 0.05, f"mejor error={best:.3f} muestras={ss[:3]}")

            # (c) pausa
            pg.keyboard.up("KeyW")
            pg.keyboard.press("KeyP")
            wait_state(pg, "paused")
            pg.wait_for_timeout(300)
            r = snap(pg)["audio"]["rms"]
            check("c: pausa rms < 0.001 en 0,3 s", r < 0.001, f"rms={r}")
            pg.keyboard.press("KeyP")
            wait_state(pg, "racing")
            pg.keyboard.down("KeyW")
            pg.wait_for_function("window.__f1.snapshot().audio && window.__f1.snapshot().audio.rms > 0.01", timeout=60000)
            check("c: reanudar recupera rms > 0.01", True)
            pg.keyboard.up("KeyW")

            # (e) cámaras con capturas (la partida sigue en curso)
            order = []
            for _ in range(3):
                pg.keyboard.press("KeyC")
                pg.wait_for_function(f"window.__f1.snapshot().camera.mode !== '{order[-1] if order else 'helmet'}'", timeout=10000)
                order.append(snap(pg)["camera"]["mode"])
                pg.wait_for_timeout(1500)
                pg.screenshot(path=f"out/b5_{order[-1]}.png")
            check("e: C recorre chase, tv, helmet", order == ["chase", "tv", "helmet"], str(order))

            # (d) silencio con V
            pg.keyboard.down("KeyW")
            pg.keyboard.press("KeyV")
            pg.wait_for_timeout(600)
            r = snap(pg)["audio"]["rms"]
            check("d: V silencia (rms < 0.001)", r < 0.001, f"rms={r}")
            pg.keyboard.up("KeyW")
            pg.reload()
            pg.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'pairing'", timeout=60000)
            pg.keyboard.press("Enter")
            wait_state(pg, "racing")
            pg.keyboard.down("KeyW")
            wait_sim(pg, 2)
            pg.wait_for_timeout(500)
            r = snap(pg)["audio"]["rms"]
            check("d: tras recargar sigue silenciado", r < 0.001, f"rms={r}")
            pg.keyboard.press("KeyV")
            pg.wait_for_function("window.__f1.snapshot().audio.rms > 0.01", timeout=60000)
            check("d: V vuelve a activarlo", True)
            pg.keyboard.up("KeyW")

            # teclado: fxSent todo a 0
            fx = snap(pg)["fxSent"]
            check("g: con teclado fxSent todo a 0", all(v == 0 for v in fx.values()), str(fx))
            ctx.close()
        step("b-e", bcde)

        # (f) autopiloto a 4x durante 40 s de simulación
        def f():
            ctx = browser.new_context(viewport={"width": 640, "height": 360})
            pg = open_host(ctx, "host-f", "debug=1&autopilot=1&timescale=4", "racing")
            pg.keyboard.press("KeyC")   # gesto para arrancar el audio
            pg.keyboard.press("KeyC")
            pg.keyboard.press("KeyC")   # vuelve a helmet (3 pulsaciones = ciclo completo)
            pg.evaluate("""window.__acc = {fovMax: 0, fovMin: 1e9, peak: 0, n: 0};
              setInterval(() => { const s = window.__f1.snapshot(), a = window.__acc;
                a.n++; a.fovMax = Math.max(a.fovMax, s.camera.fovDeg);
                if (s.speedKmh > 0 && s.gameState === 'racing') a.fovMin = Math.min(a.fovMin, s.camera.fovDeg);
                if (s.audio) a.peak = Math.max(a.peak, s.audio.peak); }, 50);""")
            wait_sim(pg, 40)
            a_ = pg.evaluate("window.__acc")
            check("f: fovDeg supera 80 en recta", a_["fovMax"] > 80, f"max={a_['fovMax']:.1f}")
            check("f: fovDeg baja de 75 en curva lenta", a_["fovMin"] < 75, f"min={a_['fovMin']:.1f}")
            check("f: audio.peak <= 0.98 (y hay señal)", 0 < a_["peak"] <= 0.98, f"peak={a_['peak']:.3f}")
            ctx.close()
        step("f", f)

        # (g) volante: háptica
        def g():
            host_ctx = browser.new_context(viewport={"width": 640, "height": 360})
            wheel_ctx = browser.new_context(viewport={"width": 800, "height": 360}, has_touch=True, is_mobile=True)
            wheel_ctx.add_init_script(b3.WHEEL_INIT)
            host = open_host(host_ctx, "host-g")
            host.wait_for_function("window.__f1.snapshot().room !== null", timeout=10000)
            w = b3.open_wheel(wheel_ctx, snap(host)["room"], "wheel-g")
            t = b3.Touch(w)
            w.click('[data-testid="tap-start"]')
            wait_state(host, "racing")
            host.wait_for_function("window.__f1.snapshot().wheelLink === 'ok'", timeout=10000)
            t.down(1, *b3.pedal_point(w, "pedal-thr", 0.9))
            last = 0.0
            for _ in range(2000):
                s = snap(host)
                if s["fxSent"]["shift"] >= 3:
                    break
                # la regla de fake_wheel (1 + v // 60) se queda en el limitador en 3.ª; además se sube con los LEDs altos
                target = min(8, 1 + int(s["speedKmh"] // 60))
                if (target > s["gear"] or s["leds"] >= 12) and s["gear"] < 8 and s["simTimeS"] - last > 0.3:
                    # soltar el pedal antes (touchEnd limpia todos los puntos; con touchMove los ids se acumulan, máx. 16)
                    t.up(1)
                    t.down(2, *b3.center_of(w, "paddle-up"))
                    t.up(2)
                    t.down(1, *b3.pedal_point(w, "pedal-thr", 0.9))
                    last = s["simTimeS"]
                host.wait_for_timeout(100)
            fx = snap(host)["fxSent"]
            check("g: fxSent.shift >= 3 con volante", fx["shift"] >= 3, str(fx))
            w.wait_for_function("window.__wheel.vibrations.some(v => v.length === 1 && v[0] === 12)", timeout=20000)
            vib = w.evaluate("window.__wheel.vibrations")
            check("g: la página del volante registra [12]", [12] in vib, str(vib[:8]))
            t.up(1)
            host_ctx.close()
            wheel_ctx.close()
        step("g", g)
        browser.close()

    check("sin errores de consola ni pageerror", not errors, "; ".join(f"{l}/{k}: {m}" for l, k, m in errors)[:600])
    check("sin avisos de autoplay en toda la sesión", not warnings, str(warnings)[:200])
    failed = [c for c in checks if not c[1]]
    print(f"\n{len(checks) - len(failed)}/{len(checks)} comprobaciones OK", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
