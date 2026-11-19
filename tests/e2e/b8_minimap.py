# E2E del bloque 8: minimapa de anticipación del HUD.
# Lanzar con relay y Vite ya activos:  E2E_WEB_PORT=5173 .venv/bin/python tests/e2e/b8_minimap.py
# Opcional: E2E_SHOT=/ruta/captura.png guarda una captura a 1920x1080.
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(__file__))
import b3_wheel as b3  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

WEB_PORT = os.environ.get("E2E_WEB_PORT", "5173")
BASE = f"http://localhost:{WEB_PORT}"
SHOT = os.environ.get("E2E_SHOT")
errors = b3.errors
checks = []
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]

RECTS = """() => {
  const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect();
    return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  return { map: r('[data-testid="hud-minimap"]'), energy: r('.hud-energy'), warn: r('[data-testid="hud-warn"]') };
}"""

# Píxeles no transparentes del canvas, y píxeles blancos (trazo de pista) en la mitad superior
PIXELS = """() => {
  const c = document.querySelector('[data-testid="hud-minimap"]');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let opaque = 0, white = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 0) opaque++;
    if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240 && d[i + 3] > 200) white++;
  }
  return { opaque, white, w: c.width, h: c.height };
}"""


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def inter(a, b):
    return not (a["r"] <= b["l"] or b["r"] <= a["l"] or a["b"] <= b["t"] or b["b"] <= a["t"])


def snap(pg):
    return pg.evaluate("window.__f1.snapshot()")


def layout(browser, w, h, shot=None, laps=False):
    ctx = browser.new_context(viewport={"width": w, "height": h})
    pg = ctx.new_page()
    b3.watch(pg, f"host-{w}")
    pg.goto(f"{BASE}/?debug=1&autopilot=1&timescale=4")
    pg.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'racing'", timeout=60000)
    t0 = snap(pg)["simTimeS"]
    pg.wait_for_function(f"window.__f1.snapshot().simTimeS >= {t0 + 6}", timeout=300000)
    r = pg.evaluate(RECTS)
    tag = f"{w}x{h}"
    check(f"{tag}: existe hud-minimap", r["map"] is not None and r["map"]["w"] > 100, str(r["map"]))
    if r["map"]:
        check(f"{tag}: sin solape con hud-energy", not inter(r["map"], r["energy"]), f"{r['map']} {r['energy']}")
        check(f"{tag}: sin solape con hud-warn", not inter(r["map"], r["warn"]), f"{r['map']} {r['warn']}")
        check(f"{tag}: dentro de pantalla", r["map"]["r"] <= w and r["map"]["t"] >= 0, "")
    px = pg.evaluate(PIXELS)
    check(f"{tag}: canvas con píxeles", px["opaque"] > 1000 and px["white"] > 50, str(px))
    if shot:
        pg.screenshot(path=shot)
    if laps:
        # una vuelta completa de simulación (el contador de vuelta del snapshot empieza en 1)
        pg.wait_for_function("window.__f1.snapshot().lap >= 2", timeout=600000)
        px = pg.evaluate(PIXELS)
        check(f"{tag}: píxeles tras una vuelta", px["white"] > 50, str(px))
    ctx.close()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=ARGS)
        for name, w, h, shot, laps in (("a", 1920, 1080, SHOT, True), ("b", 1280, 720, None, False)):
            try:
                layout(browser, w, h, shot, laps)
            except Exception as e:  # noqa: BLE001
                check(f"{name}: excepción", False, f"{type(e).__name__}: {str(e)[:300]}")
                traceback.print_exc()
        browser.close()
    check("sin errores de consola", not errors, str(errors)[:400])
    bad = [c for c in checks if not c[1]]
    print(f"{len(checks) - len(bad)}/{len(checks)} OK")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
