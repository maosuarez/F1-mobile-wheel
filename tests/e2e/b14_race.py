# E2E del bloque 14 (4.3): menú, práctica sin cambios y carrera completa hasta resultados.
# Lanzar con Vite y relay en puertos libres:
#   E2E_WEB_PORT=<puerto> E2E_SHOTS=<carpeta> .venv/bin/python tests/e2e/b14_race.py
# La carrera completa a timescale 8 con GL por software tarda ~13 min: se espera por race.phase.
import os
import sys
import traceback

from playwright.sync_api import sync_playwright

WEB_PORT = os.environ.get("E2E_WEB_PORT", "5173")
SHOTS = os.environ.get("E2E_SHOTS", "/tmp/b14")
BASE = f"http://localhost:{WEB_PORT}"
LONG_MS = int(os.environ.get("E2E_RACE_TIMEOUT_MS", str(35 * 60 * 1000)))
errors, checks = [], []
os.makedirs(SHOTS, exist_ok=True)


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def watch(page, label):
    def on_console(msg):
        if msg.type == "error" and "favicon" not in (msg.text + str(msg.location)).lower():
            errors.append((label, "console", msg.text))
    page.on("console", on_console)
    page.on("pageerror", lambda e: errors.append((label, "pageerror", str(e))))
    return page


def snap(page):
    return page.evaluate("window.__f1.snapshot()")


def shot(page, name):
    page.screenshot(path=os.path.join(SHOTS, name + ".png"))


def tid(page, t):
    return page.locator(f'[data-testid="{t}"]')


def ready(page):
    page.wait_for_function("window.__f1 && window.__f1.snapshot().gameState !== 'loading'", timeout=120000)


def test_menu(browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 720})
    page = watch(ctx.new_page(), "menu")
    page.goto(BASE + "/?debug=1&menu=1")
    page.wait_for_selector('[data-testid="menu"]', timeout=120000)
    check("menú visible, sin parámetros de modo", tid(page, "menu").is_visible())
    check("práctica por defecto: solo la fila Modo", tid(page, "menu-ai-hard").count() == 0)
    tid(page, "menu-mode-race").click()
    check("clic en Carrera muestra Dificultad y Rivales", tid(page, "menu-ai-hard").count() == 1 and tid(page, "menu-rivals-5").count() == 1)
    tid(page, "menu-ai-hard").click()
    tid(page, "menu-rivals-5").click()
    check("selección por ratón", tid(page, "menu-ai-hard").get_attribute("aria-pressed") == "true"
          and tid(page, "menu-rivals-5").get_attribute("aria-pressed") == "true")
    page.keyboard.press("ArrowUp")      # fila anterior: Dificultad
    page.keyboard.press("ArrowLeft")    # difícil → media
    check("teclado: flecha izquierda cambia la dificultad", tid(page, "menu-ai-medium").get_attribute("aria-pressed") == "true")
    shot(page, "01_menu")
    page.keyboard.press("Enter")
    page.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'pairing'", timeout=120000)
    check("Enter confirma y pasa a emparejamiento", snap(page)["race"]["mode"] == "race")
    saved = page.evaluate("localStorage.getItem('f1mw.raceChoice')")
    check("elección recordada", saved is not None and '"race"' in saved and '"medium"' in saved and '"rivals":5' in saved, str(saved))
    ctx.close()
    # Segunda visita: el menú arranca con lo recordado (mismo contexto de almacenamiento → nuevo contexto no lo hereda)
    ctx = browser.new_context(viewport={"width": 1280, "height": 720})
    page = watch(ctx.new_page(), "menu2")
    page.goto(BASE + "/?debug=1&menu=1")
    page.wait_for_selector('[data-testid="menu"]', timeout=120000)
    page.evaluate("localStorage.setItem('f1mw.raceChoice', JSON.stringify({mode:'race',ai:'hard',rivals:3}))")
    page.reload()
    page.wait_for_selector('[data-testid="menu"]', timeout=120000)
    check("recuerda la última elección", tid(page, "menu-rivals-3").get_attribute("aria-pressed") == "true"
          and tid(page, "menu-ai-hard").get_attribute("aria-pressed") == "true")
    ctx.close()


def test_lights(browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 720})
    page = watch(ctx.new_page(), "lights")
    page.goto(BASE + "/?debug=1&mode=race&rivals=9&autopilot=1&timescale=1")
    ready(page)
    # Con las 5 luces encendidas y el semáforo visible en el mismo instante (el apagado llega 0,2–3 s después)
    page.wait_for_function("window.__f1.snapshot().race.lightsOn >= 5 && !document.getElementById('race-lights').hidden", timeout=120000)
    shot(page, "02_parrilla_luces")
    check("parrilla con 5 luces y semáforo visible", True)
    check("HUD de carrera: posición P y vuelta V 1/5", tid(page, "race-pos").inner_text().startswith("P")
          and tid(page, "race-lap").inner_text() == "V 1/5", tid(page, "race-pos").inner_text())
    ctx.close()


def test_practice(browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 720})
    page = watch(ctx.new_page(), "practice")
    page.goto(BASE + "/?debug=1&mode=practice&autopilot=1&timescale=8")
    ready(page)
    page.wait_for_function("window.__f1.snapshot().gameState === 'racing'", timeout=120000)
    check("práctica: sin HUD de carrera", not tid(page, "race-hud").is_visible())
    page.wait_for_function("window.__f1.snapshot().lastLapS !== null", timeout=LONG_MS)
    s = snap(page)
    check("práctica completa una vuelta", s["lastLapS"] is not None and s["lap"] >= 2, f"{s['lastLapS']}")
    check("práctica: 1 coche, sin rivales", s["race"]["standings"] and len(s["race"]["standings"]) == 1)
    ctx.close()


def test_race(browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 720})
    page = watch(ctx.new_page(), "race")
    page.goto(BASE + "/?debug=1&mode=race&rivals=9&autopilot=1&timescale=8")
    ready(page)
    page.wait_for_function("window.__f1.snapshot().race.phase === 'green'", timeout=LONG_MS)
    page.wait_for_function("window.__f1.snapshot().simTimeS > 25", timeout=LONG_MS)
    rows = tid(page, "race-tower").locator("li")
    check("torre con 10 posiciones", rows.count() == 10, str(rows.count()))
    check("exactamente una fila marcada como jugador", page.locator('[data-testid="race-tower"] li[data-player="1"]').count() == 1)
    check("diferencias con delante y detrás", "▲" in tid(page, "race-gap-ahead").inner_text() and "▼" in tid(page, "race-gap-behind").inner_text())
    shot(page, "03_torre_en_carrera")
    page.wait_for_function("window.__f1.snapshot().race.phase === 'finished'", timeout=LONG_MS)
    page.wait_for_function("window.__f1.snapshot().gameState === 'results'", timeout=60000)
    page.wait_for_selector('[data-testid="results-table"]', timeout=10000)
    n = page.locator('[data-testid="results-table"] tbody tr').count()
    check("resultados con 10 filas", n == 10, str(n))
    check("botones Reiniciar y Menú", tid(page, "results-restart").is_visible() and tid(page, "results-menu").is_visible())
    shot(page, "04_resultados")
    s = snap(page)
    check("race.playerPos coherente", 1 <= s["race"]["playerPos"] <= 10, str(s["race"]["playerPos"]))
    tid(page, "results-menu").click()
    page.wait_for_selector('[data-testid="menu"]', timeout=10000)
    check("Menú vuelve a la pantalla de opciones", snap(page)["gameState"] == "menu")
    tid(page, "menu-mode-practice").click()
    tid(page, "menu-start").click()
    page.wait_for_function("window.__f1.snapshot().gameState === 'racing'", timeout=120000)
    check("tras el menú empieza práctica", snap(page)["race"]["mode"] == "practice")
    ctx.close()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        try:
            only = os.environ.get("E2E_ONLY", "menu,lights,practice,race").split(",")
            for name, fn in (("menu", test_menu), ("lights", test_lights), ("practice", test_practice), ("race", test_race)):
                if name in only:
                    fn(browser)
        except Exception:
            traceback.print_exc()
            check("sin excepciones en el script", False)
        finally:
            browser.close()
    check("sin errores de consola", not errors, "; ".join(f"{a}:{b}:{c}" for a, b, c in errors[:5]))
    failed = [c for c in checks if not c[1]]
    print(f"\n{len(checks) - len(failed)}/{len(checks)} OK")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
