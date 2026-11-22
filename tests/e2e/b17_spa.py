# E2E del bloque 17 (3.1): circuito de Spa y selector de circuito.
# Relay: .venv/bin/uvicorn server.main:app --port 8111 ; Vite (proxy /ws y /api a 8111) en E2E_WEB_PORT.
#   E2E_WEB_PORT=5211 E2E_SHOTS=out .venv/bin/python tests/e2e/b17_spa.py
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
T0 = time.time()


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


def ls_track(p):
    return p.evaluate("window.localStorage.getItem('f1mw.track')")


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=ARGS)
        mkctx = lambda: browser.new_context(viewport={"width": 960, "height": 540})

        # 1) Vuelta completa en Spa con capturas
        ctx = mkctx()
        p = watch(ctx.new_page(), "spa")
        p.goto(f"{BASE}/?track=spa&debug=1&autopilot=1&timescale=8")
        p.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'racing'", timeout=120000)
        marks = [("01_la_source", 376), ("02_eau_rouge", 1150), ("03_pouhon", 3850), ("04_chicane", 6740)]
        sMax, dc, seen = 0, 0, {}
        for name, s0 in marks:
            # la parrilla está justo antes de la meta (s alto): se espera a la ventana [s0, s0+400] tras cruzarla
            p.wait_for_function(f"(() => {{ const s = window.__f1.snapshot().s; return s >= {s0} && s < {s0 + 400}; }})()", timeout=240000, polling="raf")
            sn = snap(p)
            shot(p, "b17_" + name)
            seen[name] = round(sn["s"])
            dc = max(dc, sn["maxDrawCalls"], sn["drawCalls"])
            sMax = max(sMax, sn["s"])
        p.wait_for_function("window.__f1.snapshot().lap >= 2 || window.__f1.snapshot().lastLapS > 0", timeout=240000)
        sn = snap(p)
        check("Spa: una vuelta completada", sn["lastLapS"] > 0 or sn["lap"] >= 2, f"lap={sn['lap']} lastLapS={sn['lastLapS']:.1f} simT={sn['simTimeS']:.0f}")
        check("Spa: circuito largo (s>6700 antes de cerrar vuelta)", sMax > 6700, f"sMax={sMax:.0f}")
        print(f"  INFO capturas en s={seen}")
        dc = max(dc, snap(p)["maxDrawCalls"])
        check("draw calls <= 200 en Spa", dc <= 200, f"max={dc}")
        ctx.close()

        # 2) Selector del menú
        ctx = mkctx()
        p = watch(ctx.new_page(), "menu")
        p.goto(f"{BASE}/?debug=1&menu=1")
        tid(p, "menu-track-spa").wait_for(timeout=60000)
        tid(p, "menu-track-spa").click()
        p.wait_for_url("**track=spa**", timeout=60000)
        check("selector: recarga con ?track=spa", "track=spa" in p.url, p.url)
        check("selector: elección recordada", ls_track(p) == "spa", str(ls_track(p)))
        tid(p, "menu-track-spa").wait_for(timeout=60000)
        check("selector: Spa marcado tras recargar", tid(p, "menu-track-spa").get_attribute("aria-pressed") == "true")
        p.goto(f"{BASE}/?debug=1&menu=1")
        tid(p, "menu-track-spa").wait_for(timeout=60000)
        check("siguiente apertura sin parámetro carga Spa (menú)", tid(p, "menu-track-spa").get_attribute("aria-pressed") == "true"
              and "track=" not in p.url)
        p.goto(f"{BASE}/?debug=1&autopilot=1&timescale=8")
        p.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'racing'", timeout=120000)
        p.wait_for_function("window.__f1.snapshot().s > 4600", timeout=240000, polling="raf")
        check("sin parámetro carga Spa (s > longitud de Interlagos)", True, f"s={snap(p)['s']:.0f}")
        ctx.close()

        # 3) ?track=xyz
        ctx = mkctx()
        p = watch(ctx.new_page(), "xyz")
        p.goto(f"{BASE}/?track=xyz&debug=1")
        tid(p, "error-back").wait_for(timeout=60000)
        txt = p.locator("#overlay-error").inner_text()
        check("?track=xyz muestra el error", "xyz" in txt, txt.replace("\n", " | "))
        shot(p, "b17_error_xyz")
        tid(p, "error-back").click()
        p.wait_for_load_state("load")
        check("error-back vuelve sin el parámetro", "track=" not in p.url, p.url)
        ctx.close()

        # 4) Contexto nuevo sin elección: Interlagos
        ctx = mkctx()
        p = watch(ctx.new_page(), "default")
        p.goto(f"{BASE}/?debug=1&menu=1")
        tid(p, "menu-track-interlagos").wait_for(timeout=60000)
        check("contexto nuevo: Interlagos seleccionado", tid(p, "menu-track-interlagos").get_attribute("aria-pressed") == "true" and ls_track(p) is None)
        p.goto(f"{BASE}/?debug=1&autopilot=1&timescale=8")
        p.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'racing'", timeout=120000)
        p.wait_for_function("window.__f1.snapshot().lap >= 2 || window.__f1.snapshot().lastLapS > 0", timeout=240000)
        sn = snap(p)
        check("Interlagos: vuelta completa", 55 < sn["lastLapS"] < 95, f"lastLapS={sn['lastLapS']:.1f}")
        ctx.close()

        # 5) Online: propietario elige Spa; invitado en Interlagos se une y recarga
        o = watch(mkctx().new_page(), "owner")
        g = watch(mkctx().new_page(), "guest")
        o.goto(f"{BASE}/?debug=1&menu=1")
        tid(o, "menu-track-spa").wait_for(timeout=60000)
        tid(o, "menu-track-spa").click()
        o.wait_for_url("**track=spa**", timeout=60000)
        tid(o, "menu-online").wait_for(timeout=60000)
        tid(o, "menu-online").click()
        tid(o, "lobby-name").fill("Ana")
        tid(o, "lobby-create").click()
        tid(o, "lobby-room").wait_for(timeout=60000)
        code = tid(o, "lobby-room").inner_text().strip()
        check("propietario: sala creada en Spa", "Spa" in tid(o, "lobby-track").inner_text(), tid(o, "lobby-track").inner_text())
        g.goto(f"{BASE}/?online=join&code={code}&name=Beto&debug=1&autopilot=1")
        g.wait_for_url("**track=spa**", timeout=120000)
        check("invitado: recarga con ?track=spa", "track=spa" in g.url and f"code={code}" in g.url, g.url)
        tid(g, "lobby-room").wait_for(timeout=120000)
        check("invitado: vuelve a la sala", tid(g, "lobby-room").inner_text().strip() == code)
        o.wait_for_function("document.querySelectorAll('[data-testid=\"lobby-player\"]').length >= 2", timeout=120000)
        shot(o, "b17_online_lobby_owner"); shot(g, "b17_online_lobby_guest")
        tid(o, "lobby-start").click()
        for pg in (o, g):
            pg.wait_for_function("window.__f1 && ['grid','green'].includes(window.__f1.snapshot().race.phase)", timeout=240000)
        check("ambos en semáforo con Spa", "track=spa" in g.url and ls_track(o) == "spa" and ls_track(g) == "spa",
              f"phase o={snap(o)['race']['phase']} g={snap(g)['race']['phase']}")
        shot(o, "b17_online_grid_owner"); shot(g, "b17_online_grid_guest")
        o.context.close(); g.context.close()

        check("0 errores de consola", not errors, str(errors[:5]))
        browser.close()
    bad = [n for n, ok, _ in checks if not ok]
    print("FALLOS: " + ", ".join(bad) if bad else "TODO OK")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
