# Medición de rendimiento del bloque 6 (design D8). Uso:  E2E_WEB_PORT=5211 .venv/bin/python tests/e2e/b6_perf.py
# Sale 0 si hay GPU real y media >= 55 fps con p5 >= 45 en una vuelta a 1920x1080 (calidad adaptativa, sin ?quality=);
# sale 2 imprimiendo "SIN GPU" si el renderizador es por software (SwiftShader/llvmpipe); sale 1 si hay GPU y no llega.
import os
import sys

from playwright.sync_api import sync_playwright

WEB_PORT = os.environ.get("E2E_WEB_PORT", "5173")
BASE = f"http://localhost:{WEB_PORT}"
BACKENDS = ["--use-angle=gl-egl", "--use-angle=vulkan"]
BASE_ARGS = ["--enable-gpu", "--ignore-gpu-blocklist"]
SOFTWARE = ("swiftshader", "llvmpipe", "software")
AVG_MIN, P5_MIN = 55.0, 45.0


def run(backend, p):
    browser = p.chromium.launch(headless=True, args=BASE_ARGS + [backend])
    try:
        pg = browser.new_page(viewport={"width": 1920, "height": 1080})
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(f"{BASE}/?debug=1&autopilot=1&timescale=1")
        pg.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'racing'", timeout=120000)
        name = pg.evaluate("window.__f1.snapshot().rendererName")
        if any(k in name.lower() for k in SOFTWARE):
            return {"name": name, "software": True}
        # una vuelta completa: se espera a que el cronómetro registre la última vuelta
        pg.wait_for_function("window.__f1.snapshot().lastLapS !== null", timeout=600000, polling=250)
        s = pg.evaluate("window.__f1.snapshot()")
        return {"name": name, "software": False, "avg": s["fpsAvg"], "p5": s["fpsP5"], "quality": s["quality"], "errors": errors}
    finally:
        browser.close()


def main():
    last = None
    with sync_playwright() as p:
        for backend in BACKENDS:
            try:
                r = run(backend, p)
            except Exception as e:  # noqa: BLE001
                print(f"{backend}: error {type(e).__name__}: {str(e)[:200]}")
                continue
            print(f"{backend}: rendererName={r['name']}")
            last = r
            if not r["software"]:
                break
    if last is None or last["software"]:
        print(f"SIN GPU: rendererName={last['name'] if last else 'n/d'}; validar a mano con F3 (tarea 9.1)")
        sys.exit(2)
    ok = last["avg"] >= AVG_MIN and last["p5"] >= P5_MIN
    print(f"rendererName={last['name']} nivel final={last['quality']} media={last['avg']:.1f} fps p5={last['p5']:.1f} fps "
          f"-> {'OK' if ok else 'FAIL'}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
