# E2E del change b20-vr-wheel-ux: volante (sacudida DRS/ERS, modo VR, calibración) con los ganchos __wheel.
# Relay: .venv/bin/uvicorn server.main:app --port 8112 ; Vite (proxy /ws y /api a 8112) en E2E_WEB_PORT.
#   E2E_WEB_PORT=5212 .venv/bin/python tests/e2e/b20_vr_wheel.py
import math
import os
import sys
import traceback

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
import b3_wheel as b3  # noqa: E402

BTNS = ["btn-cam", "btn-center", "btn-pause", "btn-restart"]
TEL = ("{t: 'tel', spd: 200, gear: 6, rpm: 0, leds: 0, drs: %d, ers: 0.5, ot: false, lap: 1, delta: null, "
       "warn: '', echo: 0, hold: 0%s}")


def tel(w, drs=0, extra=""):
    w.evaluate("window.__wheel.injectTel(" + TEL % (drs, extra) + ")")


def shake(w, g=(9.81, 0)):
    # dos picos alternos de 20 m/s² en Z separados 150 ms reales, en recta; luego deja pasar el enfriamiento
    w.evaluate(f"window.__wheel.injectMotion(0, 0, 20, {g[0]}, {g[1]}, performance.now())")
    w.wait_for_timeout(150)
    w.evaluate(f"window.__wheel.injectMotion(0, 0, -20, {g[0]}, {g[1]}, performance.now())")
    w.wait_for_timeout(1000)


def evs(w, k):
    return w.evaluate(f"window.__wheel.evs.filter(k => k === '{k}').length")


def ers(w):
    return w.evaluate("window.__wheel.lastIn().ers")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        wheel_ctx = browser.new_context(viewport={"width": 800, "height": 360}, has_touch=True, is_mobile=True)
        wheel_ctx.add_init_script(b3.WHEEL_INIT)
        try:
            # --- volante solo (sin host): ganchos de depuración ---
            w = b3.open_wheel(wheel_ctx, "ABCD", "wheel")
            t = b3.Touch(w)
            w.click('[data-testid="tap-start"]')
            w.wait_for_function("window.__wheel.lastIn() !== null", timeout=20000)

            # (a) sin DRS/ERS y freno grande
            for k in ("btn-drs", "btn-ers"):
                b3.check(f"(a) {k} no existe", w.locator(f'[data-testid="{k}"]').count() == 0)
            bh = b3.box(w, "pedal-brk")["height"]
            b3.check("(a) freno >= 60 % del alto", bh >= 0.6 * 360, f"{bh:.0f}")

            # (b) agitar: DRS listo -> ev drs; drs=0 -> ers on / off; apagado al frenar; curva y pico único sin efecto
            tel(w, 1)
            shake(w)
            w.wait_for_function("window.__wheel.evs.includes('drs')", timeout=5000)
            w.wait_for_timeout(300)
            b3.check("(b) DRS: un único ev drs", evs(w, "drs") == 1)
            b3.check("(b) DRS: ers no cambia", ers(w) is False)
            tel(w, 0)
            shake(w)
            w.wait_for_function("window.__wheel.lastIn().ers === true", timeout=5000)
            b3.check("(b) drs=0: ers true", True)
            shake(w)
            w.wait_for_function("window.__wheel.lastIn().ers === false", timeout=5000)
            b3.check("(b) segunda sacudida: ers false", True)
            shake(w)
            w.wait_for_function("window.__wheel.lastIn().ers === true", timeout=5000)
            t.down(1, *b3.pedal_point(w, "pedal-brk", 0.9))
            w.wait_for_function("window.__wheel.lastIn().ers === false", timeout=5000)
            b3.check("(b) freno > 0,3: ers false", True)
            t.up(1)
            n = evs(w, "drs")
            w.evaluate("(() => { const t = performance.now(); window.__wheel.injectMotion(0, 0, 25, 9.81, 0, t); })()")
            w.wait_for_timeout(300)
            b3.check("(b) pico único: sin efecto", evs(w, "drs") == n and ers(w) is False)
            b3.tilt(w, 35)
            w.wait_for_timeout(500)
            tel(w, 1)
            r = math.radians(90 - 35)
            shake(w, (9.81 * math.sin(r), 9.81 * math.cos(r)))
            w.wait_for_timeout(500)
            b3.check("(b) curva: no envía drs", evs(w, "drs") == n)
            b3.tilt(w, 0)

            # (b2) b21: picos alternos en X (giro brusco) sin efecto; steer sigue a la gravedad sin retención
            w.wait_for_timeout(1000)
            tel(w, 1)
            for i in range(4):
                a = 25 if i % 2 == 0 else -25
                w.evaluate(f"window.__wheel.injectMotion({a}, 0, 0, 9.81, 0, performance.now())")
                w.wait_for_timeout(120)
            w.wait_for_timeout(300)
            b3.check("(b2) picos alternos en X: sin drs", evs(w, "drs") == n)
            b3.check("(b2) picos alternos en X: ers no cambia", ers(w) is False)
            b3.tilt(w, 35)
            w.wait_for_timeout(500)
            s35 = w.evaluate("window.__wheel.lastIn().steer")
            g35 = (9.81 * math.sin(r), 9.81 * math.cos(r))
            for i in range(3):
                a = 25 if i % 2 == 0 else -25
                w.evaluate(f"window.__wheel.injectMotion({a}, 0, 0, {g35[0]}, {g35[1]}, performance.now())")
                w.wait_for_timeout(100)
            s35b = w.evaluate("window.__wheel.lastIn().steer")
            b3.check("(b2) steer estable con picos en X", abs(s35b - s35) <= 0.02 and abs(s35) > 0.2, f"{s35:.3f} -> {s35b:.3f}")
            b3.tilt(w, 0)
            w.wait_for_timeout(200)
            s0 = w.evaluate("window.__wheel.lastIn().steer")
            b3.check("(b2) steer sigue a la gravedad sin retención", abs(s0) < 0.1, f"{s0:.3f}")

            # (c) modo VR
            tel(w, 0, ", vr: true")
            w.wait_for_selector('[data-testid="disp-speed"]', state="hidden", timeout=5000)
            b3.check("(c) VR: disp-speed oculto", True)
            for k in BTNS:
                bb = w.locator(f'[data-testid="{k}"]').bounding_box()
                b3.check(f"(c) VR: {k} visible >= 64 px", w.locator(f'[data-testid="{k}"]').is_visible() and bb["height"] >= 64,
                         str(bb and bb["height"]))
            tel(w, 0)
            w.wait_for_selector('[data-testid="disp-speed"]', state="visible", timeout=5000)
            b3.check("(c) salir de VR: disp-speed visible", True)
            b3.check("(c) salir de VR: menú cerrado", not w.locator('[data-testid="btn-cam"]').is_visible())

            # (d) calibración
            cover = '[data-testid="cal-start"]'
            tel(w, 0, ", cal: true")
            w.wait_for_selector(cover, state="visible", timeout=5000)
            b3.check("(d) cal-start visible", True)
            w.evaluate("window.__wheel.evs.length = 0")
            t.down(2, *b3.center_of(w, "cal-start")); t.up(2)
            w.wait_for_selector(cover, state="hidden", timeout=5000)
            b3.check("(d) un único ev recal y se oculta", evs(w, "recal") == 1)
            w.wait_for_function("window.__wheel.lastIn().steer === 0", timeout=5000)
            tel(w, 0, ", cal: true")
            b3.check("(d) cal repetido sin soltar: sigue oculta", not w.locator(cover).is_visible())
            tel(w, 0)
            tel(w, 0, ", cal: true")
            w.wait_for_selector(cover, state="visible", timeout=5000)
            b3.check("(d) vuelve a mostrarse tras cal ausente", True)
            w.close()

            # --- host en escritorio: no VR, sin cal en la telemetría ---
            host_ctx = browser.new_context(viewport={"width": 1280, "height": 720})
            host = b3.watch(host_ctx.new_page(), "host")
            host.goto(b3.BASE + "/?debug=1")
            host.wait_for_function("window.__f1 && window.__f1.snapshot().room !== null", timeout=60000)
            room = b3.snap(host)["room"]
            w2 = b3.open_wheel(wheel_ctx, room, "wheel2")
            w2.click('[data-testid="tap-start"]')
            host.wait_for_function("window.__f1.snapshot().wheelLink === 'ok'", timeout=60000)
            w2.wait_for_function("window.__telCount > 3", timeout=20000)
            s = b3.snap(host)
            b3.check("host escritorio: inVr false", s["inVr"] is False)
            b3.check("host escritorio: wheelScreenVisible false", s["wheelScreenVisible"] is False)
            b3.check("host escritorio: tel sin cal (volante sin cover-cal)", not w2.locator(cover).is_visible()
                     and w2.evaluate("document.body.dataset.vr") == "0")
        except Exception as e:  # noqa: BLE001
            b3.check("excepción", False, f"{type(e).__name__}: {str(e)[:300]}")
            traceback.print_exc()
        browser.close()
    b3.check("sin errores de consola", not b3.errors, str(b3.errors[:3]))
    sys.exit(0 if all(c[1] for c in b3.checks) else 1)


main()
