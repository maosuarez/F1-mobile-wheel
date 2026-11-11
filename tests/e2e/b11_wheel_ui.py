# E2E del bloque 11: interfaz compacta del volante (menú ☰, DRS/ERS grandes, pedal intacto).
# Lanzar con relay y Vite en puertos libres: E2E_WEB_PORT=<puerto> .venv/bin/python tests/e2e/b11_wheel_ui.py
import os
import sys
import traceback

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
import b3_wheel as b3  # noqa: E402

SHOT = os.environ.get("E2E_SHOT", "out/b11_wheel.png")
HIDDEN = ["btn-cam", "btn-center", "btn-pause", "btn-restart", "btn-haptics"]


def evs(w, k):
    return w.evaluate(f"window.__sent.filter(m => m.k === '{k}').length")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        host_ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        wheel_ctx = browser.new_context(viewport={"width": 800, "height": 360}, has_touch=True, is_mobile=True)
        wheel_ctx.add_init_script(b3.WHEEL_INIT)
        host = b3.watch(host_ctx.new_page(), "host")
        try:
            host.goto(b3.BASE + "/?debug=1")
            host.wait_for_function("window.__f1 && window.__f1.snapshot().room !== null", timeout=60000)
            room = b3.snap(host)["room"]
            w = b3.open_wheel(wheel_ctx, room, "wheel")
            t = b3.Touch(w)
            w.click('[data-testid="tap-start"]')
            host.wait_for_function("window.__f1.snapshot().gameState === 'racing'", timeout=90000)
            host.wait_for_function("window.__f1.snapshot().wheelLink === 'ok'", timeout=20000)
            w.wait_for_function("window.__wheel.state() === 'active'", timeout=20000)

            vis = {k: w.locator(f'[data-testid="{k}"]').is_visible() for k in HIDDEN}
            b3.check("vista principal: sin botones secundarios", not any(vis.values()), str(vis))
            for k in ("btn-drs", "btn-ers"):
                bb = b3.box(w, k)
                b3.check(f"{k} >= 56x56", bb["width"] >= 56 and bb["height"] >= 56, f"{bb['width']:.0f}x{bb['height']:.0f}")
            mb = b3.box(w, "btn-menu")
            b3.check("btn-menu >= 44x44", mb["width"] >= 44 and mb["height"] >= 44, f"{mb['width']:.0f}x{mb['height']:.0f}")
            w.screenshot(path=SHOT)

            # abrir el menú no envía eventos
            n0 = w.evaluate("window.__sent.length")
            t.down(5, *b3.center_of(w, "btn-menu")); t.up(5)
            w.wait_for_selector('[data-testid="menu-panel"]', state="visible", timeout=5000)
            b3.check("abrir menú: sin ev enviados", w.evaluate("window.__sent.length") == n0)
            for k in HIDDEN:
                b3.check(f"menú abierto: {k} visible", w.locator(f'[data-testid="{k}"]').is_visible())
            # el panel no cubre pedales ni levas
            pm = b3.box(w, "menu-panel")
            for k in ("pedal-brk", "pedal-thr", "paddle-up", "paddle-down"):
                o = b3.box(w, k)
                over = not (pm["x"] + pm["width"] <= o["x"] or o["x"] + o["width"] <= pm["x"]
                            or pm["y"] + pm["height"] <= o["y"] or o["y"] + o["height"] <= pm["y"])
                b3.check(f"menú no cubre {k}", not over)

            # CÁMARA: un único ev cam y el panel se cierra
            t.down(5, *b3.center_of(w, "btn-cam")); t.up(5)
            w.wait_for_function("window.__sent.filter(m => m.k === 'cam').length === 1", timeout=5000)
            w.wait_for_selector('[data-testid="menu-panel"]', state="hidden", timeout=5000)
            b3.check("CÁMARA: un único ev cam y menú cerrado", evs(w, "cam") == 1)

            # segundo toque en ☰ cierra
            t.down(5, *b3.center_of(w, "btn-menu")); t.up(5)
            w.wait_for_selector('[data-testid="menu-panel"]', state="visible", timeout=5000)
            t.down(5, *b3.center_of(w, "btn-menu")); t.up(5)
            w.wait_for_selector('[data-testid="menu-panel"]', state="hidden", timeout=5000)
            b3.check("☰ abre y cierra", True)

            # pedal intacto al tocar DRS con el otro pulgar
            t.down(1, *b3.pedal_point(w, "pedal-thr", 0.9))
            host.wait_for_function("window.__f1.snapshot().inputApplied.thr > 0.5", timeout=20000)
            d0 = evs(w, "drs")
            t.down(2, *b3.center_of(w, "btn-drs")); t.up(2)
            w.wait_for_function(f"window.__sent.filter(m => m.k === 'drs').length === {d0 + 1}", timeout=5000)
            w.wait_for_timeout(500)
            b3.check("DRS: un único ev drs", evs(w, "drs") == d0 + 1)
            b3.check("DRS: thr sigue > 0.5 en el host", b3.snap(host)["inputApplied"]["thr"] > 0.5, str(b3.snap(host)["inputApplied"]["thr"]))
            t.up(1)
        except Exception as e:  # noqa: BLE001
            b3.check("excepción", False, f"{type(e).__name__}: {str(e)[:300]}")
            traceback.print_exc()
        browser.close()
    b3.check("sin errores de consola", not b3.errors, str(b3.errors[:3]))
    sys.exit(0 if all(c[1] for c in b3.checks) else 1)


main()
