# E2E del bloque 10: mando USB simulado (navigator.getGamepads). E2E_WEB_PORT=<puerto> .venv/bin/python tests/e2e/b10_gamepad.py
import os
import sys
import traceback

from playwright.sync_api import sync_playwright

WEB_PORT = os.environ.get("E2E_WEB_PORT", "5173")
BASE = f"http://localhost:{WEB_PORT}"
errors, checks = [], []

# Mando estándar mutable desde window.__pad; getGamepads devuelve siempre un objeto nuevo
PAD_INIT = """
window.__pad = {
  on: true, axes: [0, 0, 0, 0],
  buttons: Array.from({length: 17}, () => ({pressed: false, value: 0})),
};
window.__press = (i, v = 1) => { window.__pad.buttons[i] = {pressed: v > 0, value: v}; };
window.__rumbles = 0;
navigator.getGamepads = () => window.__pad.on ? [{
  mapping: 'standard', connected: true, id: 'fake', index: 0, axes: window.__pad.axes.slice(),
  buttons: window.__pad.buttons.map(b => ({...b})),
  vibrationActuator: {playEffect: () => { window.__rumbles++; return Promise.resolve('complete'); }},
}] : [null, null, null, null];
"""
CROSS, SQUARE, L1, R1, L2, R2, SHARE, OPTIONS = 0, 2, 4, 5, 6, 7, 8, 9


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def snap(page):
    return page.evaluate("window.__f1.snapshot()")


def tap(page, i, ms=200):
    page.evaluate(f"window.__press({i})")
    page.wait_for_timeout(ms)
    page.evaluate(f"window.__press({i}, 0)")
    page.wait_for_timeout(ms)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        ctx.add_init_script(PAD_INIT)
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(("console", m.text)) if m.type == "error"
                and "favicon" not in (m.text + str(m.location)).lower() else None)
        page.on("pageerror", lambda e: errors.append(("pageerror", str(e))))
        try:
            page.goto(BASE + "/?debug=1")
            page.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'pairing'", timeout=60000)
            tap(page, CROSS)
            page.wait_for_function("window.__f1.snapshot().gameState === 'countdown'", timeout=20000)
            check("pairing + Cruz: empieza la cuenta atrás", True)
            page.wait_for_function("window.__f1.snapshot().gameState === 'racing'", timeout=90000)
            page.wait_for_function("window.__f1.snapshot().simTimeS > 0.5", timeout=120000)

            # conducción: R2 acelera, stick izquierdo gira
            page.evaluate("window.__press(7, 1); window.__pad.axes[0] = 0.8")
            page.wait_for_function("window.__f1.snapshot().speedKmh > 15", timeout=120000)
            s = snap(page)
            check("R2 acelera", s["speedKmh"] > 15, f"{s['speedKmh']:.1f}")
            check("el stick gira (steer > 0)", s["input"]["steer"] > 0.3, f"{s['input']['steer']:.2f}")
            check("fuente gamepad con acelerador", s["input"]["throttle"] > 0.9, f"{s['input']['throttle']:.2f}")
            page.evaluate("window.__pad.axes[0] = 0; window.__press(7, 0); window.__press(6, 1)")
            page.wait_for_function("window.__f1.snapshot().speedKmh < 1", timeout=120000)
            page.evaluate("window.__press(6, 0)")
            check("L2 frena hasta parar", True)

            # L1 x2 parado: 1 -> 0 -> -1
            g0 = snap(page)["gear"]
            tap(page, L1, 400)
            page.wait_for_function("window.__f1.snapshot().gear === 0", timeout=20000)
            tap(page, L1, 600)
            page.wait_for_function("window.__f1.snapshot().gear === -1", timeout=20000)
            check("L1 x2 parado: marcha 1 -> 0 -> -1", g0 == 1 and snap(page)["gear"] == -1, f"g0={g0}")

            # reinicio con Share mantenido
            t0 = snap(page)["simTimeS"]
            tap(page, SHARE, 200)
            page.wait_for_timeout(500)
            check("Share corto: sin reinicio", snap(page)["gameState"] == "racing" and snap(page)["simTimeS"] > t0)
            page.evaluate("window.__press(8)")
            page.wait_for_function("window.__f1.snapshot().gameState === 'countdown'", timeout=30000)
            page.evaluate("window.__press(8, 0)")
            s = snap(page)
            check("Share mantenido: reinicio a countdown con simTimeS 0", s["simTimeS"] == 0, f"{s['simTimeS']}")
            page.wait_for_function("window.__f1.snapshot().gameState === 'racing'", timeout=60000)
            check("vuelve a racing", True)
        except Exception as e:  # noqa: BLE001
            check("excepción", False, f"{type(e).__name__}: {str(e)[:300]}")
            traceback.print_exc()
        browser.close()
    check("sin errores de consola", not errors, str(errors[:3]))
    sys.exit(0 if all(c[1] for c in checks) else 1)


main()
