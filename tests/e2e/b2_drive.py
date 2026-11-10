# E2E del bloque 2: arranque, teclado, pausa, vuelta con piloto de referencia, persistencia y consola limpia.
import re
import sys
import time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173"
errors = []
checks = []


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def snap(page):
    return page.evaluate("window.__f1.snapshot()")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        ctx = browser.new_context(viewport={"width": 1920, "height": 1080})
        page = ctx.new_page()

        def on_console(msg):
            if msg.type == "error":
                if "favicon" in (msg.text + str(msg.location)).lower():
                    return
                errors.append(("console", msg.text))
        page.on("console", on_console)
        page.on("pageerror", lambda e: errors.append(("pageerror", str(e))))

        # (a) primer fotograma
        page.goto(BASE + "/?debug=1")
        page.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'ready'", timeout=30000)
        page.wait_for_timeout(500)
        s = snap(page)
        track_len = page.evaluate("fetch('/track/interlagos.json').then(r=>r.json()).then(j=>j.length_m)")
        check("a: velocidad 0", s["speedKmh"] == 0, str(s["speedKmh"]))
        check("a: s = length-20", abs(s["s"] - (track_len - 20)) <= 1, f"s={s['s']:.2f} len={track_len}")
        check("a: aviso de inicio visible", page.locator('[data-testid="overlay-start"]').is_visible()
              and "Pulsa una tecla para empezar" in page.locator('[data-testid="overlay-start"]').inner_text())
        page.screenshot(path="out/b2_grid.png")

        # (b) acelerar 3 s
        page.keyboard.down("ArrowUp")
        # SwiftShader va lento: se espera a 3 s de tiempo de simulación, no de reloj
        page.wait_for_function("window.__f1.snapshot().simTimeS >= 3", timeout=120000)
        s = snap(page)
        check("b: velocidad > 80 km/h tras 3 s", s["speedKmh"] > 80, f"{s['speedKmh']:.1f} km/h, simT={s['simTimeS']:.2f}")
        page.keyboard.up("ArrowUp")

        # (c) pausa
        page.keyboard.press("p")
        page.wait_for_timeout(200)
        s0 = snap(page)
        check("c: estado paused", s0["gameState"] == "paused", s0["gameState"])
        check("c: overlay de pausa", page.locator('[data-testid="overlay-pause"]').is_visible())
        page.wait_for_timeout(3000)
        s1 = snap(page)
        check("c: tiempo de vuelta no avanza en pausa", abs(s1["simTimeS"] - s0["simTimeS"]) <= 0.02 and abs(s1["lapTimeS"] - s0["lapTimeS"]) <= 0.02,
              f"simT {s0['simTimeS']:.3f} -> {s1['simTimeS']:.3f}")
        page.keyboard.press("p")
        page.wait_for_timeout(50)
        s2 = snap(page)
        check("c: reanuda en racing", s2["gameState"] == "racing", s2["gameState"])
        check("c: tiempo tras reanudar ~ tiempo al pausar", s2["simTimeS"] - s0["simTimeS"] < 0.5,
              f"simT {s0['simTimeS']:.3f} -> {s2['simTimeS']:.3f}")

        # (d) vuelta con piloto de referencia
        page.goto(BASE + "/?debug=1&autopilot=1&timescale=8")
        page.wait_for_function("window.__f1", timeout=30000)
        t0 = time.time()
        shot = False
        done = False
        while time.time() - t0 < 180:
            s = snap(page)
            if not shot and s["s"] > 1200 and s["lap"] == 1:
                page.screenshot(path="out/b2_lap.png")
                shot = True
            if s["lap"] >= 2:
                done = True
                break
            page.wait_for_timeout(500)
        check("d: lap >= 2 en 180 s", done, f"{time.time() - t0:.1f} s reales")
        page.wait_for_timeout(300)
        page.screenshot(path="out/b2_finish.png")
        if not shot:
            page.screenshot(path="out/b2_lap.png")
        s = snap(page)
        print("snapshot:", {k: s[k] for k in ("lap", "lastLapS", "wallHits", "maxDrawCalls", "maxTriangles", "dpr", "fps")}, flush=True)
        check("d: lastLapS entre 62 y 105", s["lastLapS"] is not None and 62 <= s["lastLapS"] <= 105, str(s["lastLapS"]))
        check("d: wallHits = 0", s["wallHits"] == 0, str(s["wallHits"]))
        check("d: maxDrawCalls < 200", s["maxDrawCalls"] < 200, str(s["maxDrawCalls"]))
        check("d: maxTriangles < 600000", s["maxTriangles"] < 600000, str(s["maxTriangles"]))
        check("d: dpr <= 1.5", s["dpr"] <= 1.5, str(s["dpr"]))
        check("d: HUD muestra la última vuelta",
              re.match(r"^\d:\d\d\.\d{3}$", page.locator('[data-testid="hud-last"]').inner_text()) is not None)
        last = s["lastLapS"]

        # (e) persistencia
        page.goto(BASE + "/?debug=1")
        page.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'ready'", timeout=30000)
        txt = page.locator('[data-testid="hud-best"]').inner_text()
        s = snap(page)
        check("e: hud-best muestra la mejor vuelta", re.match(r"^\d:\d\d\.\d{3}$", txt) is not None, txt)
        check("e: bestLapS = vuelta guardada", s["bestLapS"] is not None and last is not None
              and abs(s["bestLapS"] - last) < 0.002, f"{s['bestLapS']} vs {last}")

        # (f) sin debug
        page.goto(BASE + "/")
        page.wait_for_selector('[data-testid="overlay-start"]:not([hidden])', timeout=30000)
        check("f: window.__f1 indefinido sin debug", page.evaluate("typeof window.__f1") == "undefined")

        browser.close()

    # (g) consola limpia
    check("g: sin errores de consola ni pageerror", not errors, "; ".join(f"{k}: {m}" for k, m in errors)[:500])
    failed = [c for c in checks if not c[1]]
    print(f"\n{len(checks) - len(failed)}/{len(checks)} comprobaciones OK")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
