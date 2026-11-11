# E2E del bloque 6 (design D8): aspecto, exposición, posproceso, presupuesto de render y niveles de calidad.
# Uso (relay y Vite ya activos):  E2E_WEB_PORT=5211 .venv/bin/python tests/e2e/b6_visual.py
# Calidad fijada con ?quality=high porque en SwiftShader la adaptativa bajaría a low.
# Las métricas de píxel leen el canvas de WebGL (sin HUD de HTML). Se espera por estado, no por reloj.
import base64
import json
import os
import sys
import time
import traceback
import urllib.request

from playwright.sync_api import sync_playwright

WEB_PORT = os.environ.get("E2E_WEB_PORT", "5173")
BASE = f"http://localhost:{WEB_PORT}"
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
VIEW = {"width": 1280, "height": 720}
checks = []
problems = []   # errores y avisos de WebGL de consola


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def step(name, fn):
    try:
        fn()
    except Exception as e:  # noqa: BLE001
        check(f"{name}: excepción", False, f"{type(e).__name__}: {str(e)[:300]}")
        traceback.print_exc()


def watch(page, label):
    def on_console(msg):
        t = msg.text
        low = (t + str(msg.location)).lower()
        if "favicon" in low:
            return
        if msg.type == "error" or (msg.type == "warning" and any(k in low for k in ("webgl", "gl error", "shader", "framebuffer"))):
            problems.append((label, msg.type, t[:200]))
    page.on("console", on_console)
    page.on("pageerror", lambda e: problems.append((label, "pageerror", str(e)[:200])))
    return page


def snap(pg):
    return pg.evaluate("window.__f1.snapshot()")


def open_page(ctx, label, query, state):
    pg = watch(ctx.new_page(), label)
    pg.goto(f"{BASE}/?{query}")
    pg.wait_for_function(f"window.__f1 && window.__f1.snapshot().gameState === '{state}'", timeout=120000)
    return pg


def wait_state(pg, st, timeout=120000):
    pg.wait_for_function(f"window.__f1.snapshot().gameState === '{st}'", timeout=timeout)


def pause_now(pg):
    pg.keyboard.press("KeyP")
    wait_state(pg, "paused")
    pg.wait_for_timeout(400)   # unos fotogramas con la pausa ya aplicada


def resume(pg):
    pg.keyboard.press("KeyP")
    wait_state(pg, "racing")


def goto_s(pg, s):
    """Avanza (con el piloto automático) hasta el s pedido y pausa. Desde la parrilla s crece tras cruzar la meta."""
    pg.wait_for_function(f"(() => {{ const x = window.__f1.snapshot().s; return x >= {s} && x < {s} + 400; }})()",
                         timeout=900000, polling=50)
    pause_now(pg)


def save_canvas(pg, path):
    url = pg.evaluate("document.getElementById('game').toDataURL('image/png')")
    with open(path, "wb") as f:
        f.write(base64.b64decode(url.split(",", 1)[1]))


def full_pixels(pg):
    return pg.evaluate("(() => { const c = document.getElementById('game'); return window.__f1.pixels({x:0,y:0,w:c.width,h:c.height}); })()")


# Fracción de píxeles "escena visible" (no carbono oscuro del coche) en la región entre el halo y el volante
COCKPIT_JS = """(() => {
  const c = document.getElementById('game'), W = c.width, H = c.height;
  const x0 = Math.floor(W * 0.25), x1 = Math.floor(W * 0.75), y0 = Math.floor(H * 0.10), y1 = Math.floor(H * 0.65);
  const c2 = document.createElement('canvas'); c2.width = x1 - x0; c2.height = y1 - y0;
  const g = c2.getContext('2d'); g.drawImage(c, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
  const d = g.getImageData(0, 0, x1 - x0, y1 - y0).data; let vis = 0;
  for (let i = 0; i < d.length; i += 4) { const l = (0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]) / 255; if (l > 0.12) vis++; }
  return vis / (d.length / 4);
})()"""

# Sombra del coche: en franjas horizontales bajo el coche (la altura del coche en pantalla varía con la pendiente),
# luminancia mínima de los bloques centrales frente a la mediana de los laterales contiguos (asfalto iluminado)
BAND_JS = """(() => {
  const c = document.getElementById('game'), W = c.width, H = c.height, best = {red: -1, shadow: 0, lit: 0};
  const lum = (x0, y0, w, h) => window.__f1.pixels({x: Math.floor(W * x0), y: Math.floor(H * y0), w: Math.floor(W * w), h: Math.floor(H * h)}).lum;
  for (let y = 0.70; y <= 0.84; y += 0.02) {
    const mid = [], side = [];
    for (let k = 0; k < 6; k++) mid.push(lum(0.38 + k * 0.04, y, 0.04, 0.02));
    for (let k = 0; k < 3; k++) { side.push(lum(0.26 + k * 0.04, y, 0.04, 0.02)); side.push(lum(0.62 + k * 0.04, y, 0.04, 0.02)); }
    side.sort((a, b) => a - b);
    const shadow = Math.min(...mid), lit = side[3], red = lit > 0 ? 1 - shadow / lit : 0;
    if (red > best.red) { best.red = red; best.shadow = shadow; best.lit = lit; }
  }
  return best;
})()"""

CORNERS_JS = """(() => {
  const c = document.getElementById('game'), W = c.width, H = c.height, w = Math.floor(W * 0.06), h = Math.floor(H * 0.06);
  const r = [[0,0],[W-w,0],[0,H-h],[W-w,H-h]].map(([x,y]) => window.__f1.pixels({x,y,w,h}).lum);
  return r.reduce((a, b) => a + b, 0) / 4;
})()"""


def main():
    os.makedirs("out", exist_ok=True)
    with urllib.request.urlopen(f"{BASE}/track/interlagos.json") as r:
        track = json.load(r)
    corner_s = {}
    for c in track["corners"]:
        corner_s.setdefault(c["name"], c["s"])
    lap_len = track["length_m"]
    # (nombre de captura, s de parada, margen de aproximación). Parrilla: nada más empezar (s ≈ meta - 20 m)
    stops = [("grid", None), ("senna", corner_s["S do Senna"] - 40), ("sol", corner_s["Curva do Sol"] - 40),
             ("bico", corner_s["Bico de Pato"] - 40), ("juncao", corner_s["Junção"] - 40), ("straight", lap_len - 220)]
    expo = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=ARGS)

        # (a)(b) primera persona: capturas, habitáculo y exposición
        def helmet_pass():
            ctx = browser.new_context(viewport=VIEW)
            pg = open_page(ctx, "helmet", "debug=1&quality=high&autopilot=1&timescale=4", "racing")
            check("camara inicial: helmet", snap(pg)["camera"]["mode"] == "helmet", snap(pg)["camera"]["mode"])
            pause_now(pg)
            for name, s in stops:
                if s is not None:
                    resume(pg)
                    goto_s(pg, s)
                    pg.wait_for_timeout(600)
                save_canvas(pg, f"out/b6_{name}.png")
                expo[name] = full_pixels(pg)
                if name == "grid":
                    frac = pg.evaluate(COCKPIT_JS)
                    check("Elementos del habitáculo: escena visible entre halo y volante >= 35 %", frac >= 0.35, f"fracción={frac:.3f}")
            for name, v in expo.items():
                ok = 0.25 <= v["lum"] <= 0.65 and v["white"] < 0.01 and v["black"] < 0.05
                check(f"Exposición correcta ({name})", ok, f"lum={v['lum']:.3f} blanco={v['white']:.4f} negro={v['black']:.4f}")
            ctx.close()
        step("helmet", helmet_pass)

        # (a)(b) persecución: sombra del coche en parrilla y otros tres puntos
        def chase_pass():
            ctx = browser.new_context(viewport=VIEW)
            pg = open_page(ctx, "chase", "debug=1&quality=high&autopilot=1&timescale=4", "racing")
            pg.keyboard.press("KeyC")   # helmet -> chase
            pg.wait_for_function("window.__f1.snapshot().camera.mode === 'chase'", timeout=10000)
            pause_now(pg)
            pts = [("grid", None), ("senna", stops[1][1]), ("bico", stops[3][1]), ("juncao", stops[4][1])]
            for name, s in pts:
                if s is not None:
                    resume(pg)
                    goto_s(pg, s)
                    pg.wait_for_timeout(600)
                if name == "grid":
                    save_canvas(pg, "out/b6_chase.png")
                else:
                    save_canvas(pg, f"out/b6_chase_{name}.png")
                v = full_pixels(pg)
                check(f"Exposición correcta (chase {name})",
                      0.25 <= v["lum"] <= 0.65 and v["white"] < 0.01 and v["black"] < 0.05,
                      f"lum={v['lum']:.3f} blanco={v['white']:.4f} negro={v['black']:.4f}")
                b = pg.evaluate(BAND_JS)
                red, shadow, lit = b["red"], b["shadow"], b["lit"]
                check(f"Sombra del coche ({name}): asfalto bajo el coche >= 20 % más oscuro", red >= 0.20,
                      f"reducción={red:.3f} sombra={shadow:.3f} lateral={lit:.3f}")
            ctx.close()
        step("chase", chase_pass)

        # (a) TV
        def tv_pass():
            ctx = browser.new_context(viewport=VIEW)
            pg = open_page(ctx, "tv", "debug=1&quality=high&autopilot=1&timescale=4", "racing")
            pg.keyboard.press("KeyC")
            pg.keyboard.press("KeyC")
            pg.wait_for_function("window.__f1.snapshot().camera.mode === 'tv'", timeout=10000)
            pg.wait_for_function("window.__f1.snapshot().simTimeS > 2", timeout=120000)
            pause_now(pg)
            save_canvas(pg, "out/b6_tv.png")
            v = full_pixels(pg)
            check("Exposición correcta (tv)", 0.25 <= v["lum"] <= 0.65 and v["white"] < 0.01 and v["black"] < 0.05,
                  f"lum={v['lum']:.3f} blanco={v['white']:.4f} negro={v['black']:.4f}")
            ctx.close()
        step("tv", tv_pass)

        # (c) posproceso: misma parrilla (antes de arrancar, escena estática) con y sin post
        def post_pass():
            res = {}
            for label, q in (("post", "debug=1&quality=high"), ("nopost", "debug=1&quality=high&post=0")):
                ctx = browser.new_context(viewport=VIEW)
                pg = open_page(ctx, label, q, "pairing")
                pg.wait_for_timeout(1500)
                res[label] = {"corners": pg.evaluate(CORNERS_JS), "full": full_pixels(pg), "post": snap(pg)["post"],
                              "png": pg.evaluate("document.getElementById('game').toDataURL('image/png')")}
                ctx.close()
            check("Posproceso: post=true por defecto y false con ?post=0", res["post"]["post"] and not res["nopost"]["post"],
                  f"{res['post']['post']}/{res['nopost']['post']}")
            check("Posproceso activo: las imágenes difieren", res["post"]["png"] != res["nopost"]["png"])
            ratio = res["post"]["corners"] / res["nopost"]["corners"] if res["nopost"]["corners"] > 0 else 1
            check("Posproceso activo: esquinas entre 5 % y 30 % más oscuras (sin HUD)", 0.70 <= ratio <= 0.95,
                  f"ratio={ratio:.3f} post={res['post']['corners']:.3f} sin={res['nopost']['corners']:.3f}")
        step("post", post_pass)

        # (e) niveles: selección manual y diferencias
        def levels_pass():
            data = {}
            for lv in ("high", "low"):
                ctx = browser.new_context(viewport=VIEW)
                pg = open_page(ctx, f"q-{lv}", f"debug=1&quality={lv}&autopilot=1&timescale=4", "racing")
                pg.wait_for_function("window.__f1.snapshot().simTimeS > 1", timeout=120000)
                pause_now(pg)
                data[lv] = snap(pg)
                if lv == "low":
                    t0 = data[lv]["simTimeS"]
                    resume(pg)
                    pg.wait_for_function(f"window.__f1.snapshot().simTimeS > {t0 + 1}", timeout=120000)
                    data["low_plays"] = True
                ctx.close()
            lo, hi = data["low"], data["high"]
            check("Selección manual: low sin post, sin sombras, DPR 1, jugable",
                  not lo["post"] and lo["shadowLights"] == 0 and lo["dpr"] == 1 and data.get("low_plays"),
                  f"post={lo['post']} shadowLights={lo['shadowLights']} dpr={lo['dpr']} quality={lo['quality']}")
            check("Selección manual: high conserva post y sombra", hi["post"] and hi["shadowLights"] == 1 and hi["quality"] == "high",
                  f"post={hi['post']} shadowLights={hi['shadowLights']} quality={hi['quality']}")
        step("levels", levels_pass)

        # (e) diferencias medibles en el mismo punto (parrilla, escena estática)
        def diff_pass():
            d = {}
            for lv in ("high", "low"):
                ctx = browser.new_context(viewport=VIEW)
                pg = open_page(ctx, f"d-{lv}", f"debug=1&quality={lv}", "pairing")
                pg.wait_for_timeout(1500)
                s = snap(pg)
                d[lv] = (s["drawCalls"], s["triangles"])
                ctx.close()
            check("Diferencias medibles: low usa menos draw calls y triángulos que high",
                  d["low"][0] < d["high"][0] and d["low"][1] < d["high"][1], f"high={d['high']} low={d['low']}")
        step("diff", diff_pass)

        # (f) carga con caché vacía
        def load_pass():
            # GPU real si existe (el arranque en SwiftShader compila shaders por CPU y no representa un navegador normal);
            # contexto nuevo = caché vacía
            hw = p.chromium.launch(headless=True, args=["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=gl-egl"])
            ctx = hw.new_context(viewport=VIEW)
            pg = watch(ctx.new_page(), "load")
            t0 = time.time()
            pg.goto(f"{BASE}/?debug=1&quality=high")
            pg.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'pairing'", timeout=60000)
            dt = time.time() - t0
            check("Carga: parrilla visible en < 5 s", dt < 5, f"{dt:.2f} s, {snap(pg)['rendererName'][:60]}")
            ctx.close()
            hw.close()
        step("load", load_pass)

        # (d) vuelta completa por cámara: presupuesto de render (viewport reducido: el recuento no depende de la resolución)
        def lap_pass(cam_presses, label):
            def run():
                ctx = browser.new_context(viewport={"width": 640, "height": 360})
                pg = open_page(ctx, f"lap-{label}", "debug=1&quality=high&autopilot=1&timescale=8", "racing")
                for _ in range(cam_presses):
                    pg.keyboard.press("KeyC")
                pg.wait_for_function(f"window.__f1.snapshot().camera.mode === '{label}'", timeout=10000)
                pg.wait_for_function("window.__f1.snapshot().lastLapS !== null", timeout=900000, polling=200)
                s = snap(pg)
                check(f"Vuelta {label}: maxDrawCalls < 200", s["maxDrawCalls"] < 200, str(s["maxDrawCalls"]))
                check(f"Vuelta {label}: maxTriangles < 600000", s["maxTriangles"] < 600000, str(s["maxTriangles"]))
                check(f"Vuelta {label}: una luz con sombra, mapa <= 2048, DPR <= 1.5",
                      s["shadowLights"] == 1 and s["shadowMapSize"] <= 2048 and s["dpr"] <= 1.5,
                      f"luces={s['shadowLights']} mapa={s['shadowMapSize']} dpr={s['dpr']} vuelta={s['lastLapS']:.1f}s")
                ctx.close()
            step(f"lap-{label}", run)
        lap_pass(1, "chase")
        lap_pass(0, "helmet")
        lap_pass(2, "tv")

        browser.close()

    check("Consola sin errores ni avisos de WebGL", not problems, str(problems[:5]))
    bad = [c for c in checks if not c[1]]
    print(f"\n{len(checks) - len(bad)}/{len(checks)} checks OK")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
