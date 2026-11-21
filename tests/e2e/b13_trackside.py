# E2E de b13 (kit de borde de pista y materiales CC0): capturas, presupuesto de render, consola y respaldo.
# Uso (relay y Vite ya activos):  E2E_WEB_PORT=5211 E2E_OUT=<dir> .venv/bin/python tests/e2e/b13_trackside.py
# Calidad fijada con ?quality=high (en SwiftShader la adaptativa bajaría). Se espera por estado, no por reloj.
import base64
import json
import os
import traceback
import urllib.request

from playwright.sync_api import sync_playwright

WEB_PORT = os.environ.get("E2E_WEB_PORT", "5173")
BASE = f"http://localhost:{WEB_PORT}"
OUT = os.environ.get("E2E_OUT", "out")
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
VIEW = {"width": 1280, "height": 720}
QUERY = "debug=1&quality=high&autopilot=1&timescale=16"
checks, problems = [], []


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:  # noqa: BLE001
        check(f"{name}: excepción", False, f"{type(e).__name__}: {str(e)[:300]}")
        traceback.print_exc()


def watch(page, label, ignore=()):
    def on_console(msg):
        t = msg.text
        low = (t + str(msg.location)).lower()
        if "favicon" in low or any(k in low for k in ignore):
            return
        if msg.type == "error" or (msg.type == "warning" and any(k in low for k in ("webgl", "gl error", "shader", "framebuffer"))):
            problems.append((label, msg.type, t[:200]))
        if msg.type == "warning" and "[assets]" in t:
            print(f"aviso ({label}): {t[:160]}", flush=True)
    page.on("console", on_console)
    page.on("pageerror", lambda e: problems.append((label, "pageerror", str(e)[:200])))
    return page


def snap(pg):
    return pg.evaluate("window.__f1.snapshot()")


def save(pg, name):
    url = pg.evaluate("document.getElementById('game').toDataURL('image/png')")
    path = os.path.join(OUT, f"b13_{name}.png")
    with open(path, "wb") as f:
        f.write(base64.b64decode(url.split(",", 1)[1]))
    return path


def wait_state(pg, st, timeout=120000):
    pg.wait_for_function(f"window.__f1.snapshot().gameState === '{st}'", timeout=timeout, polling=200)


def toggle_pause(pg, st):
    pg.keyboard.press("KeyP")
    wait_state(pg, st)
    pg.wait_for_timeout(500)


def goto_s(pg, s):
    pg.wait_for_function(f"(() => {{ const x = window.__f1.snapshot().s; return x >= {s} && x < {s} + 300; }})()",
                         timeout=1200000, polling=50)
    toggle_pause(pg, "paused")


def open_page(ctx, label, ignore=()):
    pg = watch(ctx.new_page(), label, ignore)
    pg.goto(f"{BASE}/?{QUERY}", wait_until="commit", timeout=120000)
    pg.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'racing'", timeout=180000)
    # Assets resueltos (cargados o con respaldo)
    pg.wait_for_function("window.__f1.snapshot().assets.hdri !== null", timeout=180000)
    return pg


def main():
    os.makedirs(OUT, exist_ok=True)
    with urllib.request.urlopen(f"{BASE}/track/interlagos.json") as r:
        track = json.load(r)
    cs = {}
    for c in track["corners"]:
        cs.setdefault(c["name"], c["s"])
    budget = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=ARGS)

        def main_pass():
            ctx = browser.new_context(viewport=VIEW)
            pg = open_page(ctx, "main")
            toggle_pause(pg, "paused")
            st = snap(pg)
            check("texturas CC0 y HDRI cargados", st["assets"]["hdri"] is True and not st["assets"]["failed"]
                  and len(st["assets"]["textures"]) == 5, json.dumps(st["assets"]))
            check("borde de pista <= 15 draw calls", st["tracksideDrawCalls"] <= 15,
                  f"draw={st['tracksideDrawCalls']} tris={st['tracksideTriangles']}")
            print("captura:", save(pg, "straight_helmet"), flush=True)
            budget["straight_helmet"] = (st["drawCalls"], st["triangles"])
            pg.keyboard.press("KeyC")
            pg.wait_for_function("window.__f1.snapshot().camera.mode === 'chase'", timeout=120000, polling=200)
            pg.wait_for_timeout(800)
            st = snap(pg)
            budget["straight_chase"] = (st["drawCalls"], st["triangles"])
            print("captura:", save(pg, "straight_chase"), flush=True)
            for name, s in [("senna", cs["S do Senna"] - 30), ("lago", cs["Descida do Lago"] - 30)]:
                toggle_pause(pg, "racing")
                goto_s(pg, s)
                st = snap(pg)
                budget[name] = (st["drawCalls"], st["triangles"])
                print("captura:", save(pg, f"{name}_chase"), flush=True)
            # Cámara de TV 7 (Laranjinha): activa con el coche en [2131, 2438)
            pg.keyboard.press("KeyC")
            pg.wait_for_function("window.__f1.snapshot().camera.mode === 'tv'", timeout=120000, polling=200)
            for k, s in enumerate([2200, 2300, 2380]):
                toggle_pause(pg, "racing")
                goto_s(pg, s)
                st = snap(pg)
                budget[f"tv7_{k}"] = (st["drawCalls"], st["triangles"])
                print("captura:", save(pg, f"tv7_{k}"), f"tv={st['camera']['tvIndex']} s={st['s']:.0f} pos={st['camera']['pos']}", flush=True)
            # Junção en persecución
            pg.keyboard.press("KeyC")
            pg.keyboard.press("KeyC")
            pg.wait_for_function("window.__f1.snapshot().camera.mode === 'chase'", timeout=120000, polling=200)
            toggle_pause(pg, "racing")
            goto_s(pg, cs["Junção"] - 30)
            st = snap(pg)
            budget["juncao"] = (st["drawCalls"], st["triangles"])
            print("captura:", save(pg, "juncao_chase"), flush=True)
            mx, mt = max(v[0] for v in budget.values()), max(v[1] for v in budget.values())
            check("escena <= 200 draw calls y < 600 000 triángulos", mx <= 200 and mt < 600000, json.dumps(budget))
            ctx.close()
        step("principal", main_pass)

        def fallback_pass():
            ctx = browser.new_context(viewport=VIEW)
            ctx.route("**/assets/asphalt_track/**", lambda route: route.abort())
            # El fallo de red bloqueado a propósito lo registra Chromium como "Failed to load resource"
            pg = open_page(ctx, "fallback", ignore=("asphalt_track",))
            st = snap(pg)
            check("respaldo: asfalto procedural, resto CC0", st["assets"]["failed"] == ["road"] and len(st["assets"]["textures"]) == 4,
                  json.dumps(st["assets"]))
            toggle_pause(pg, "paused")
            pg.keyboard.press("KeyC")
            pg.wait_for_timeout(800)
            print("captura:", save(pg, "fallback_chase"), flush=True)
            ctx.close()
        step("respaldo", fallback_pass)
        browser.close()

    check("sin errores de consola", not problems, json.dumps(problems[:5], ensure_ascii=False))
    failed = [c for c in checks if not c[1]]
    print(f"\n{len(checks) - len(failed)}/{len(checks)} OK", flush=True)
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
