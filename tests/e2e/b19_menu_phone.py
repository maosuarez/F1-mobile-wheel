# E2E del change b19-menu-phone: menú rediseñado, acceso al volante en celular y QR online.
# Relay: .venv/bin/uvicorn server.main:app --port 8111 ; Vite (proxy /ws y /api a 8111) en E2E_WEB_PORT.
#   E2E_WEB_PORT=5211 E2E_SHOTS=<carpeta> .venv/bin/python tests/e2e/b19_menu_phone.py
import os
import sys
import time

from playwright.sync_api import sync_playwright

WEB_PORT = os.environ.get("E2E_WEB_PORT", "5173")
SHOTS = os.environ.get("E2E_SHOTS", "/tmp/b19")
BASE = f"http://localhost:{WEB_PORT}"
TMO = int(os.environ.get("E2E_TIMEOUT_MS", str(10 * 60 * 1000)))
ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
QUEST_UA = "Mozilla/5.0 (Linux; Android 12; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/30.0 Chrome/120.0.0.0 VR Safari/537.36"
errors, checks = [], []
os.makedirs(SHOTS, exist_ok=True)
T0 = time.time()


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def watch(p, tag):
    p.on("console", lambda m: errors.append((tag, m.text)) if m.type == "error" and "favicon" not in (m.text + str(m.location)).lower() else None)
    p.on("pageerror", lambda e: errors.append((tag, str(e))))
    return p


def tid(p, t):
    return p.locator(f'[data-testid="{t}"]')


def snap(p):
    return p.evaluate("window.__f1.snapshot()")


def new_page(browser, tag, **kw):
    return watch(browser.new_context(**kw).new_page(), tag)


def test_menu(browser):
    for w, h in ((1280, 720), (360, 740)):
        p = new_page(browser, f"menu{w}", viewport={"width": w, "height": h})
        p.goto(f"{BASE}/?debug=1&menu=1")
        p.wait_for_selector('[data-testid="menu"]', timeout=TMO)
        sw = p.evaluate("document.documentElement.scrollWidth")
        check(f"menú {w}x{h} sin scroll horizontal", sw <= w, f"scrollWidth={sw}")
        check(f"menú {w}x{h}: Empezar visible", tid(p, "menu-start").is_visible())
        p.screenshot(path=os.path.join(SHOTS, f"menu_{w}.png"))
        if w == 1280:
            tid(p, "menu-mode-race").click()
            check("clic en Carrera: aria-pressed", tid(p, "menu-mode-race").get_attribute("aria-pressed") == "true")
            p.keyboard.press("ArrowDown")      # siguiente fila: Dificultad
            p.keyboard.press("ArrowLeft")      # media -> fácil
            check("flecha izquierda baja la dificultad", tid(p, "menu-ai-easy").get_attribute("aria-pressed") == "true")
            p.keyboard.press("Enter")
            p.wait_for_function("window.__f1 && window.__f1.snapshot().race.mode === 'race'", timeout=TMO)
            s = snap(p)
            check("Enter arranca la carrera", s["race"]["mode"] == "race" and not tid(p, "menu").is_visible(), s["race"]["mode"])
        p.context.close()


def test_phone(browser):
    cases = (
        ("móvil Android", dict(viewport={"width": 360, "height": 740}, is_mobile=True, has_touch=True, user_agent=ANDROID_UA), True),
        ("visor OculusBrowser", dict(viewport={"width": 360, "height": 740}, is_mobile=True, has_touch=True, user_agent=QUEST_UA), False),
        ("escritorio", dict(viewport={"width": 1280, "height": 720}), False),
    )
    for name, kw, want in cases:
        p = new_page(browser, name, **kw)
        p.goto(f"{BASE}/?debug=1&menu=1")
        p.wait_for_selector('[data-testid="menu"]', timeout=TMO)
        a, b = tid(p, "open-wheel").is_visible(), tid(p, "menu-open-wheel").is_visible()
        check(f"{name}: open-wheel y menu-open-wheel {'visibles' if want else 'ocultos'}", a == want and b == want, f"open-wheel={a} menu={b}")
        if want:
            head = p.locator(".gp-head").bounding_box()
            btn = tid(p, "open-wheel").bounding_box()
            overlap = not (head["y"] >= btn["y"] + btn["height"] or btn["y"] >= head["y"] + head["height"]
                           or head["x"] >= btn["x"] + btn["width"] or btn["x"] >= head["x"] + head["width"])
            check("móvil: el botón fijo no tapa la cabecera", not overlap, f"head={head} btn={btn}")
            check("móvil: sin scroll horizontal", p.evaluate("document.documentElement.scrollWidth") <= 360)
            check("tarjeta del menú enlaza a /wheel/", tid(p, "menu-open-wheel").get_attribute("href") == "/wheel/")
            p.screenshot(path=os.path.join(SHOTS, "menu_phone.png"))
        p.context.close()


def test_online(browser):
    mk = lambda tag: new_page(browser, tag, viewport={"width": 480, "height": 270})
    a, b = mk("A"), mk("B")
    a.goto(f"{BASE}/?online=create&name=Ana&rivals=1&laps=1&autostart=2&track=spa&debug=1")
    tid(a, "lobby-join-qr").wait_for(timeout=TMO)
    code = tid(a, "lobby-room").inner_text().strip()
    url = tid(a, "lobby-join-qr").get_attribute("data-url") or ""
    check("lobby-join-qr con data-url de unirse", "online=join&code=" in url and f"code={code}" in url and "track=spa" in url, url)
    b.goto(f"{BASE}/?online=join&code={code}&name=Beto&track=spa&laps=1&debug=1&autopilot=1")
    for p in (a, b):
        p.wait_for_function("window.__f1 && window.__f1.snapshot().race.phase === 'green'", timeout=TMO)
    check("overlay-qr oculto al inicio", not tid(a, "overlay-qr").is_visible())
    check("qr-toggle visible en carrera online", tid(a, "qr-toggle").is_visible())
    t0 = snap(a)["simTimeS"]
    a.keyboard.press("KeyO")
    tid(a, "overlay-qr").wait_for(state="visible", timeout=10000)
    check("O abre overlay-qr con sala cerrada", tid(a, "qr-room-closed").is_visible() and tid(a, "qr-room-code").inner_text().strip() == code)
    check("overlay: QR del volante con su código", tid(a, "qr-wheel").is_visible() and len(tid(a, "qr-wheel-code").inner_text().strip()) > 0)
    a.screenshot(path=os.path.join(SHOTS, "overlay_qr.png"))
    a.wait_for_function(f"window.__f1.snapshot().simTimeS > {t0 + 1}", timeout=TMO)
    a.keyboard.press("KeyO")
    tid(a, "overlay-qr").wait_for(state="hidden", timeout=10000)
    t1 = snap(a)["simTimeS"]
    check("O oculta el overlay y simTimeS siguió avanzando", t1 > t0 + 1 and snap(a)["gameState"] != "paused", f"{t0:.2f} -> {t1:.2f}")
    tid(a, "qr-toggle").click()
    check("botón QR abre el overlay", tid(a, "overlay-qr").is_visible())
    for ctx in (a, b):
        ctx.context.close()


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        test_menu(browser)
        test_phone(browser)
        test_online(browser)
        browser.close()
    check("sin errores de consola", not errors, "; ".join(f"{t}: {m}" for t, m in errors[:5]))
    bad = [n for n, ok, _ in checks if not ok]
    print(f"\n{len(checks) - len(bad)}/{len(checks)} OK en {time.time() - T0:.0f}s")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
