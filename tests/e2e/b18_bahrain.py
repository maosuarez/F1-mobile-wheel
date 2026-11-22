# E2E del bloque 18 (3.1): Bahréin nocturno, luminancia, selector y circuitos de día intactos.
# Relay: .venv/bin/uvicorn server.main:app --port 8111 ; Vite (proxy /ws y /api a 8111) en E2E_WEB_PORT.
#   E2E_WEB_PORT=5211 E2E_SHOTS=out .venv/bin/python tests/e2e/b18_bahrain.py
import os
import sys
import time

from playwright.sync_api import sync_playwright

WEB_PORT = os.environ.get("E2E_WEB_PORT", "5173")
SHOTS = os.environ.get("E2E_SHOTS", "out")
BASE = f"http://localhost:{WEB_PORT}"
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
errors, checks = [], []
os.makedirs(SHOTS, exist_ok=True)

# Franjas en fracción del canvas (cámara de casco): cielo arriba, asfalto de la recta bajo el horizonte
SKY = (0.30, 0.02, 0.40, 0.08)
# Asfalto: dos franjas a los lados del pilar del halo y por encima del morro (la central caía sobre el cockpit)
ROAD = [(0.39, 0.545, 0.08, 0.02), (0.53, 0.545, 0.07, 0.02)]
LUM_JS = """([sky, road]) => {
  const c = document.getElementById('game'), W = c.width, H = c.height;
  const f = (r) => window.__f1.pixels({x: Math.floor(W * r[0]), y: Math.floor(H * r[1]), w: Math.floor(W * r[2]), h: Math.floor(H * r[3])}).lum;
  return { sky: f(sky), road: road.map(f).reduce((a, b) => a + b, 0) / road.length };
}"""


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def snap(p):
    return p.evaluate("window.__f1.snapshot()")


def shot(p, name):
    p.screenshot(path=os.path.join(SHOTS, name + ".png"))


def watch(p, tag):
    p.on("console", lambda m: errors.append((tag, m.text)) if m.type == "error" and "favicon" not in (m.text + str(m.location)).lower() else None)
    p.on("pageerror", lambda e: errors.append((tag, str(e))))
    return p


def tid(p, t):
    return p.locator(f'[data-testid="{t}"]')


def wait_s(p, s0, timeout=240000):
    # la parrilla está justo antes de la meta (s alto): se espera a la ventana [s0, s0+400] tras cruzarla
    p.wait_for_function(f"(() => {{ const s = window.__f1.snapshot().s; return s >= {s0} && s < {s0 + 400}; }})()", timeout=timeout, polling="raf")


def lum(p, n=5):
    # Mediana de n lecturas en fotogramas distintos: un rival que cruza la franja no decide la medida
    reads = []
    for _ in range(n):
        reads.append(p.evaluate(LUM_JS, [list(SKY), [list(r) for r in ROAD]]))
        p.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")
    med = lambda k: sorted(x[k] for x in reads)[n // 2]
    return {"sky": med("sky"), "road": med("road"), "roadReads": [round(x["road"], 3) for x in reads]}


def open_race(ctx, tag, track):
    p = watch(ctx.new_page(), tag)
    p.goto(f"{BASE}/?track={track}&debug=1&autopilot=1&timescale=8")
    p.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'racing'", timeout=120000)
    return p


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=ARGS)
        mkctx = lambda: browser.new_context(viewport={"width": 960, "height": 540})

        # 1) Bahréin: vuelta completa, luminancia en la recta y capturas
        ctx = mkctx()
        p = open_race(ctx, "bahrain", "bahrain")
        check("Bahréin: cámara de casco", snap(p)["camera"]["mode"] == "helmet", snap(p)["camera"]["mode"])
        marks = [("01_meta", 200), ("02_curva1", 717), ("03_curva4", 1527), ("04_curva10", 2700)]
        dc, seen, lums = 0, {}, {}
        for name, s0 in marks:
            wait_s(p, s0)
            sn = snap(p)
            lums[name] = lum(p)
            shot(p, "b18_" + name)
            seen[name] = round(sn["s"])
            dc = max(dc, sn["maxDrawCalls"], sn["drawCalls"])
        print(f"  INFO capturas en s={seen}")
        print(f"  INFO luminancias {lums}")
        m = lums["01_meta"]
        check("Bahréin: luminancia del asfalto en recta >= 0,25", m["road"] >= 0.25, f"road={m['road']:.3f}")
        check("Bahréin: luminancia del cielo en recta <= 0,15", m["sky"] <= 0.15, f"sky={m['sky']:.3f}")
        p.wait_for_function("window.__f1.snapshot().lap >= 2 || window.__f1.snapshot().lastLapS > 0", timeout=240000)
        sn = snap(p)
        check("Bahréin: una vuelta completada", sn["lastLapS"] > 0 or sn["lap"] >= 2, f"lap={sn['lap']} lastLapS={sn['lastLapS']:.1f} simT={sn['simTimeS']:.0f}")
        dc = max(dc, sn["maxDrawCalls"])
        check("draw calls <= 200 en Bahréin", dc <= 200, f"max={dc}")
        ctx.close()

        # 2) Circuitos de día: cielo claro
        for track in ("interlagos", "spa"):
            ctx = mkctx()
            p = open_race(ctx, track, track)
            wait_s(p, 200)
            v = lum(p)
            shot(p, f"b18_dia_{track}")
            check(f"{track}: de día (cielo > 0,4)", v["sky"] > 0.4, f"sky={v['sky']:.3f} road={v['road']:.3f}")
            ctx.close()

        # 3) Selector del menú
        ctx = mkctx()
        p = watch(ctx.new_page(), "menu")
        p.goto(f"{BASE}/?debug=1&menu=1")
        tid(p, "menu-track-bahrain").wait_for(timeout=60000)
        names = {t: tid(p, f"menu-track-{t}").inner_text().strip() for t in ("interlagos", "spa", "bahrain")}
        check("selector: ofrece Interlagos, Spa-Francorchamps y Bahréin", names == {"interlagos": "Interlagos", "spa": "Spa-Francorchamps", "bahrain": "Bahréin"}, str(names))
        shot(p, "b18_menu")
        ctx.close()

        check("0 errores de consola", not errors, str(errors[:5]))
        browser.close()
    bad = [n for n, ok, _ in checks if not ok]
    print("FALLOS: " + ", ".join(bad) if bad else "TODO OK")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
