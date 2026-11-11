# E2E del bloque 9: reinicio desde el volante (pulsación sostenida de REINICIAR).
# Lanzar con relay y Vite en puertos libres: E2E_WEB_PORT=<puerto> .venv/bin/python tests/e2e/b9_restart.py
import os
import sys
import traceback

from playwright.sync_api import sync_playwright

WEB_PORT = os.environ.get("E2E_WEB_PORT", "5173")
BASE = f"http://localhost:{WEB_PORT}"
errors, checks = [], []

WHEEL_INIT = """
window.__g = {x: 9.81, y: 0, z: 0};
try { Object.defineProperty(screen.orientation, 'angle', {get: () => 90, configurable: true}); } catch (e) {}
window.__sent = [];
(() => {
  const Native = window.WebSocket;
  window.WebSocket = class extends Native {
    send(d) { if (typeof d === 'string' && d.includes('"t":"ev"')) window.__sent.push(JSON.parse(d)); return super.send(d); }
  };
})();
setInterval(() => typeof DeviceMotionEvent !== 'undefined' && window.dispatchEvent(new DeviceMotionEvent('devicemotion',
  {accelerationIncludingGravity: {x: window.__g.x, y: window.__g.y, z: window.__g.z}})), 16);
"""


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def watch(page, label):
    def on_console(msg):
        if msg.type == "error" and "favicon" not in (msg.text + str(msg.location)).lower():
            errors.append((label, "console", msg.text))
    page.on("console", on_console)
    page.on("pageerror", lambda e: errors.append((label, "pageerror", str(e))))
    return page


def snap(page):
    return page.evaluate("window.__f1.snapshot()")


def hold(page, tid, ms):
    """Pulsación real por CDP (touch) durante ms milisegundos."""
    b = page.locator(f'[data-testid="{tid}"]').bounding_box()
    x, y = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
    cdp = page.context.new_cdp_session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y, "id": 1}]})
    page.wait_for_timeout(ms)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def restarts(w):
    return w.evaluate("window.__sent.filter(m => m.k === 'restart').length")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        host_ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        wheel_ctx = browser.new_context(viewport={"width": 800, "height": 360}, has_touch=True, is_mobile=True)
        wheel_ctx.add_init_script(WHEEL_INIT)
        host = watch(host_ctx.new_page(), "host")
        try:
            host.goto(BASE + "/?debug=1")
            host.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'pairing'", timeout=60000)
            host.wait_for_function("(document.querySelector('[data-testid=pairing-code]').textContent||'').trim().length === 4", timeout=10000)
            room = host.locator('[data-testid="pairing-code"]').inner_text().strip()
            w = watch(wheel_ctx.new_page(), "wheel")
            w.goto(f"{BASE}/wheel/?room={room}&debug=1")
            w.wait_for_selector('[data-testid="tap-start"]', state="visible")
            w.click('[data-testid="tap-start"]')
            host.wait_for_function("window.__f1.snapshot().gameState === 'racing'", timeout=90000)
            host.wait_for_function("window.__f1.snapshot().simTimeS > 1.5", timeout=120000)
            t0 = snap(host)["simTimeS"]
            check("racing con simTimeS > 0", t0 > 1.5, f"{t0:.2f}")

            # toque corto: nada
            hold(w, "btn-restart", 200)
            w.wait_for_timeout(600)
            s = snap(host)
            check("toque corto: sin evento restart", restarts(w) == 0, str(restarts(w)))
            check("toque corto: el host sigue en racing", s["gameState"] == "racing" and s["simTimeS"] > t0, s["gameState"])

            # pulsación sostenida: un único restart y cuenta atrás
            hold(w, "btn-restart", 1500)
            host.wait_for_function("window.__f1.snapshot().gameState === 'countdown'", timeout=20000)
            s = snap(host)
            check("sostenida: un único restart enviado", restarts(w) == 1, str(restarts(w)))
            check("sostenida: countdown con simTimeS 0", s["simTimeS"] == 0, f"{s['simTimeS']}")
            check("sostenida: coche parado en parrilla", s["speedKmh"] == 0, f"{s['speedKmh']:.2f}")
            host.wait_for_function("window.__f1.snapshot().gameState === 'racing'", timeout=60000)
            check("tras la cuenta atrás vuelve a racing", True)
        except Exception as e:  # noqa: BLE001
            check("excepción", False, f"{type(e).__name__}: {str(e)[:300]}")
            traceback.print_exc()
        browser.close()
    check("sin errores de consola", not errors, str(errors[:3]))
    sys.exit(0 if all(c[1] for c in checks) else 1)


main()
