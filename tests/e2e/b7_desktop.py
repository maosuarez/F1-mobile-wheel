# E2E b7 (6.1): escritorio sin cambios. Uso:
#   E2E_WEB_PORT=5211 .venv/bin/python tests/e2e/b7_desktop.py [--record FILE] [--baseline FILE]
# --record guarda las métricas (para correrlo contra el commit base); --baseline las compara con las actuales.
# Sale 0 solo si: consola limpia, #vr-enter oculto sin navigator.xr y (con --baseline) calidad/post/draw calls iguales.
import json
import os
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:" + os.environ.get("E2E_WEB_PORT", "5173")
KEYS = ["quality", "post", "dpr", "shadowMapSize", "shadowLights", "drawCalls", "carDrawCalls", "envDrawCalls", "triangles"]
errors, checks = [], []


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def arg(flag):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else None


def main():
    os.makedirs("out", exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        page = browser.new_context(viewport={"width": 1920, "height": 1080}).new_page()
        page.on("console", lambda m: None if m.type != "error" or "favicon" in (m.text + str(m.location)).lower()
                else errors.append(("console", m.text)))
        page.on("pageerror", lambda e: errors.append(("pageerror", str(e))))

        # (a) consola limpia y botón VR oculto (Chromium headless no expone navigator.xr)
        page.goto(BASE + "/?debug=1")
        page.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'pairing'", timeout=30000)
        page.wait_for_timeout(1500)
        # Chromium headless expone navigator.xr pero sin soporte de immersive-vr
        has_xr = page.evaluate("!!navigator.xr && navigator.xr.isSessionSupported('immersive-vr').catch(() => false)")
        btn = page.locator("#vr-enter")
        hidden = btn.count() == 0 or not btn.is_visible()
        check("a: sin soporte immersive-vr", not has_xr, str(has_xr))
        check("a: #vr-enter oculto", hidden)
        page.screenshot(path="out/b7_desktop.png")

        # (b) ?quality=high: calidad, post y draw calls
        page.goto(BASE + "/?debug=1&quality=high")
        page.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'pairing'", timeout=30000)
        page.wait_for_timeout(2000)
        s = page.evaluate("window.__f1.snapshot()")
        m = {k: s[k] for k in KEYS}
        print("metrics", json.dumps(m), flush=True)
        check("b: calidad high con post", m["quality"] == "high" and m["post"] is True)
        check("b: #vr-enter sigue oculto", page.locator("#vr-enter").count() == 0 or not page.locator("#vr-enter").is_visible())
        if arg("--record"):
            json.dump(m, open(arg("--record"), "w"))
            print("registrado en", arg("--record"))
        if arg("--baseline"):
            base = json.load(open(arg("--baseline")))
            diff = {k: (base[k], m[k]) for k in KEYS if base[k] != m[k]}
            check("b: métricas iguales al commit base", not diff, f"diff={diff}" if diff else "idénticas")
        page.wait_for_timeout(500)
        check("c: sin errores de consola", not errors, str(errors[:3]))
        browser.close()
    bad = [c for c in checks if not c[1]]
    print(f"{len(checks) - len(bad)}/{len(checks)} OK")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
