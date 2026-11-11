# E2E del bloque 4: marchas, DRS, ERS, HUD de carrera y volante en manual.
# Lanzar (servidores en puertos libres, ver cabecera de b3_wheel.py para los de siempre):
#   E2E_WEB_PORT=5173 .venv/bin/python tests/e2e/b4_mechanics.py   (con relay y `npm run dev` ya activos)
import os
import re
import subprocess
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(__file__))
import b3_wheel as b3  # noqa: E402  (reutiliza volante, táctil y WHEEL_INIT)
from playwright.sync_api import sync_playwright  # noqa: E402

WEB_PORT = os.environ.get("E2E_WEB_PORT", "5173")
BASE = f"http://localhost:{WEB_PORT}"
errors = b3.errors
checks = []
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


def hold(page, code, ms=400):
    page.keyboard.down(code)
    page.wait_for_timeout(ms)
    page.keyboard.up(code)


def wait_racing(page, timeout=60000):
    page.wait_for_function("window.__f1.snapshot().gameState === 'racing'", timeout=timeout)


# Muestreo dentro de la página (cada 20 ms) del autopiloto
SAMPLER = """
window.__acc = {drs: [], hudDrs: [], gearMax: 0, ersMin: 1, ersRecovered: false, laps: [], leds: 0};
(() => {
  let lastLap = window.__f1.snapshot().lap;
  setInterval(() => {
    const s = window.__f1.snapshot(), a = window.__acc;
    if (!a.drs.includes(s.drs)) a.drs.push(s.drs);
    const hs = Number(document.querySelector('[data-testid=hud-drs]').dataset.state);
    if (!a.hudDrs.includes(hs)) a.hudDrs.push(hs);
    a.gearMax = Math.max(a.gearMax, s.gear);
    if (s.ers < a.ersMin) a.ersMin = s.ers;
    if (a.ersMin < 0.97 && s.ers > a.ersMin + 0.02) a.ersRecovered = true;
    a.leds = Math.max(a.leds, s.leds);
    if (s.lap !== lastLap) { a.laps.push({lap: lastLap, t: s.lastLapS, valid: s.lastLapValid}); lastLap = s.lap; }
  }, 20);
})();
"""


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=ARGS)

        # (a) teclado: M no cambia el automático (fijo); limitador/E en manual quedan cubiertos por (d) con volante
        def a():
            ctx = browser.new_context(viewport={"width": 1280, "height": 720})
            pg = b3.watch(ctx.new_page(), "host-a")
            pg.goto(BASE + "/?debug=1")
            pg.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'pairing'", timeout=30000)
            pg.keyboard.press("Enter")
            wait_racing(pg)
            check("a: automático activo por defecto", snap(pg)["autoShift"] is True)
            pg.keyboard.press("KeyM")
            pg.wait_for_timeout(500)
            check("a: M no cambia autoShift (sigue true)", snap(pg)["autoShift"] is True)
            check("a: indicador del HUD sigue en automático", pg.locator('[data-testid="hud-auto"]').get_attribute("data-on") == "1")
            ctx.close()
        step("a", a)

        # (b) autopiloto 2 vueltas a 8x y (c) capturas
        def b():
            ctx = browser.new_context(viewport={"width": 1920, "height": 1080})
            pg = b3.watch(ctx.new_page(), "host-b")
            pg.goto(BASE + "/?debug=1&autopilot=1&timescale=8")
            pg.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'racing'", timeout=30000)
            pg.evaluate(SAMPLER)
            pg.wait_for_function("window.__f1.snapshot().speedKmh > 100", timeout=120000)
            os.makedirs("out", exist_ok=True)
            hud_layout(pg, 1920, 1080, "out/b4_hud_1080.png")
            hud_layout(pg, 1280, 720, "out/b4_hud_720.png")
            pg.wait_for_function("window.__acc.laps.filter(l => l.t !== null).length >= 2", timeout=420000)
            a = pg.evaluate("window.__acc")
            check("b: drs pasa por 1 y 2", 1 in a["drs"] and 2 in a["drs"], str(a["drs"]))
            check("b: hud-drs refleja 1 y 2", 1 in a["hudDrs"] and 2 in a["hudDrs"], str(a["hudDrs"]))
            check("b: ers baja de 1 y se recupera", a["ersMin"] < 0.97 and a["ersRecovered"], f"min={a['ersMin']:.2f} rec={a['ersRecovered']}")
            check("b: gear llega a >= 7", a["gearMax"] >= 7, str(a["gearMax"]))
            laps = [l for l in a["laps"] if l["t"] is not None][:2]
            check("b: 2 vueltas válidas con 62 <= lastLapS <= 105",
                  len(laps) >= 2 and all(l["valid"] and l["t"] is not None and 62 <= l["t"] <= 105 for l in laps), str(laps))
            ctx.close()
        step("b/c", b)

        # (d) volante: la leva cambia disp-gear y fake_wheel completa la vuelta en manual
        def d():
            host_ctx = browser.new_context(viewport={"width": 1280, "height": 720})
            wheel_ctx = browser.new_context(viewport={"width": 800, "height": 360}, has_touch=True, is_mobile=True)
            wheel_ctx.add_init_script(b3.WHEEL_INIT)
            host = b3.watch(host_ctx.new_page(), "host-d")
            host.goto(BASE + "/?debug=1")
            host.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'pairing'", timeout=30000)
            host.wait_for_function("window.__f1.snapshot().room !== null", timeout=10000)
            room = snap(host)["room"]
            w = b3.open_wheel(wheel_ctx, room, "wheel-d")
            t = b3.Touch(w)
            w.click('[data-testid="tap-start"]')
            wait_racing(host)
            host.wait_for_function("window.__f1.snapshot().wheelLink === 'ok'", timeout=10000)
            check("d: con volante el automático está desactivado", snap(host)["autoShift"] is False)
            t.down(1, *b3.pedal_point(w, "pedal-thr", 0.9))
            host.wait_for_function("window.__f1.snapshot().speedKmh > 20", timeout=60000)
            g0 = snap(host)["gear"]
            t.down(2, *b3.center_of(w, "paddle-up"))
            t.up(2)
            host.wait_for_function(f"window.__f1.snapshot().gear === {g0 + 1}", timeout=10000)
            w.wait_for_function(f"document.querySelector('[data-testid=disp-gear]').textContent.trim() === '{g0 + 1}'", timeout=10000)
            check("d: evento up sube la marcha y cambia disp-gear", True, f"{g0} -> {g0 + 1}")
            t.up(1)
            w.close()
            host_ctx.close()
            wheel_ctx.close()

            ctx = browser.new_context(viewport={"width": 640, "height": 360})
            h2 = b3.watch(ctx.new_page(), "host-d2")
            h2.goto(BASE + "/?debug=1")
            h2.wait_for_function("window.__f1 && window.__f1.snapshot().room !== null", timeout=30000)
            room = snap(h2)["room"]
            proc = subprocess.run([".venv/bin/python", "tools/fake_wheel.py", "--room", room, "--url", f"ws://localhost:{WEB_PORT}/ws",
                                   "--script", "lap", "--timeout", "400"], capture_output=True, text=True, timeout=450)
            print(proc.stdout[-300:], proc.stderr[-200:], flush=True)
            laps = re.findall(r"Vuelta (\d+) completada en ([\d.]+) s", proc.stdout)
            check("d: fake_wheel --script lap completa la vuelta en manual", proc.returncode == 0 and bool(laps) and snap(h2)["autoShift"] is False,
                  f"exit={proc.returncode} laps={laps[-1:] }")
            ctx.close()
        step("d", d)
        browser.close()

    check("sin errores de consola ni pageerror", not errors, "; ".join(f"{l}/{k}: {m}" for l, k, m in errors)[:600])
    failed = [c for c in checks if not c[1]]
    print(f"\n{len(checks) - len(failed)}/{len(checks)} comprobaciones OK", flush=True)
    return 1 if failed else 0


def hud_layout(pg, w, h, path):
    pg.set_viewport_size({"width": w, "height": h})
    pg.wait_for_timeout(500)
    pg.screenshot(path=path)
    els = pg.evaluate("""() => [...document.querySelectorAll('[data-testid^="hud-"]')].map(e => {
      const r = e.getBoundingClientRect(); return {id: e.dataset.testid, x: r.x, y: r.y, w: r.width, h: r.height}; })""")
    bad = []
    for i, e in enumerate(els):
        if e["x"] < -0.5 or e["y"] < -0.5 or e["x"] + e["w"] > w + 0.5 or e["y"] + e["h"] > h + 0.5:
            bad.append(f"fuera:{e['id']}")
        if e["id"] != "hud-warn" and e["w"] > 0 and e["x"] < w * 2 / 3 and e["x"] + e["w"] > w / 3 and e["y"] + e["h"] > h * 0.8:
            bad.append(f"franja-inferior-central:{e['id']}")
        for o in els[i + 1:]:
            if min(e["x"] + e["w"], o["x"] + o["w"]) - max(e["x"], o["x"]) > 0.5 and min(e["y"] + e["h"], o["y"] + o["h"]) - max(e["y"], o["y"]) > 0.5:
                bad.append(f"solape:{e['id']}/{o['id']}")
    check(f"c: HUD sin solapes ni desbordes a {w}x{h} ({path})", not bad, ", ".join(bad)[:300])


if __name__ == "__main__":
    sys.exit(main())
