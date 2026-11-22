# E2E del bloque 15 (3.1): pantalla dividida con 2 volantes simulados.
# Puertos limpios (relay en E2E_RELAY_PORT, Vite en E2E_WEB_PORT con proxy /ws al relay):
#   E2E_WEB_PORT=5211 E2E_RELAY_PORT=8111 E2E_SHOTS=<carpeta> .venv/bin/python tests/e2e/b15_split.py
import os
import subprocess
import sys
import time
import traceback

from playwright.sync_api import sync_playwright

WEB_PORT = os.environ.get("E2E_WEB_PORT", "5173")
SHOTS = os.environ.get("E2E_SHOTS", "/tmp/b15")
BASE = f"http://localhost:{WEB_PORT}"
WS_URL = os.environ.get("E2E_WS_URL", f"ws://localhost:{WEB_PORT}/ws")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
errors, checks, wheels = [], [], []
os.makedirs(SHOTS, exist_ok=True)


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def snap(page):
    return page.evaluate("window.__f1.snapshot()")


def spawn_wheel(room, script="lap"):
    p = subprocess.Popen([os.path.join(ROOT, ".venv/bin/python"), os.path.join(ROOT, "tools/fake_wheel.py"),
                          "--room", room, "--url", WS_URL, "--script", script, "--duration", "600"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    wheels.append(p)
    return p


def kill(p):
    if p.poll() is None:
        p.terminate()
        try:
            p.wait(3)
        except subprocess.TimeoutExpired:
            p.kill()


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        ctx = browser.new_context(viewport={"width": 1920, "height": 1080})
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(("console", m.text)) if m.type == "error" and "favicon" not in (m.text + str(m.location)).lower() else None)
        page.on("pageerror", lambda e: errors.append(("pageerror", str(e))))
        page.goto(BASE + "/?debug=1&players=2&mode=race&rivals=8")
        page.wait_for_function("window.__f1 && window.__f1.snapshot().gameState !== 'loading'", timeout=180000)
        s = snap(page)
        check("2 jugadores, 10 coches", s["players"] == 2 and len(s["pilots"]) == 2 and len(s["race"]["standings"]) == 10,
              f"players={s['players']} standings={len(s['race']['standings'])}")
        rooms = [p["room"] for p in s["pilots"]]
        check("dos salas distintas", all(rooms) and rooms[0] != rooms[1], str(rooms))
        page.screenshot(path=os.path.join(SHOTS, "01_pairing.png"), timeout=180000)
        # lap solo recibe 'dbg' del host para J1; J2 usa circle (gas + giro constante)
        w1, w2 = spawn_wheel(rooms[0], "lap"), spawn_wheel(rooms[1], "circle")
        try:
            page.wait_for_function("window.__f1.snapshot().pilots.every(p => p.source === 'wheel')", timeout=60000)
            ok = True
        except Exception:
            ok = False
        s = snap(page)
        check("cada volante vinculado a su piloto", ok, str([(p["wheelLink"], p["source"]) for p in s["pilots"]]))
        page.wait_for_function("['countdown','racing'].includes(window.__f1.snapshot().gameState)", timeout=120000)
        check("estado countdown/racing", True, snap(page)["gameState"])
        page.wait_for_function("window.__f1.snapshot().gameState === 'racing' && window.__f1.snapshot().race.phase === 'green'", timeout=600000)
        # Esperar a que ambos coches se muevan por su propio volante
        try:
            page.wait_for_function("window.__f1.snapshot().pilots.every(p => p.speedKmh > 30)", timeout=600000)
            moved = True
        except Exception:
            moved = False
        s = snap(page)
        pl = s["pilots"]
        check("ambos coches aceleran con su volante", moved, str([(round(p["speedKmh"]), p["input"]) for p in pl]))
        check("cada piloto con su propia entrada", pl[0]["input"] != pl[1]["input"] or pl[0]["entryId"] != pl[1]["entryId"],
              f"entry={[p['entryId'] for p in pl]}")
        page.screenshot(path=os.path.join(SHOTS, "02_split_racing.png"), timeout=180000)
        # Independencia: parar el volante de J2 -> solo J1 sigue (la pausa llega antes); se comprueba tras la desconexión
        t0 = s["simTimeS"]
        kill(w2)
        try:
            page.wait_for_function("window.__f1.snapshot().pauseReason === 'wheelLost'", timeout=60000)
            paused = True
        except Exception:
            paused = False
        s = snap(page)
        check("desconexión de J2 -> pauseReason wheelLost", paused, str(s["pauseReason"]))
        label = page.locator('[data-testid="wheel-lost-label"]').text_content() or ''
        check("aviso 'Volante J2 desconectado'", label.strip().lower() == "volante j2 desconectado", label)
        sim_a = snap(page)["simTimeS"]
        time.sleep(2)
        check("simulación detenida en pausa", abs(snap(page)["simTimeS"] - sim_a) < 0.05, f"{sim_a}->{snap(page)['simTimeS']}")
        page.screenshot(path=os.path.join(SHOTS, "03_j2_lost.png"), timeout=180000)
        check("draw calls máx ≤ 320", snap(page)["maxDrawCalls"] <= 320, f"maxDrawCalls={snap(page)['maxDrawCalls']} drawCalls={snap(page)['drawCalls']} quality={snap(page)['quality']}")
        check("sin errores de consola", not errors, str(errors[:3]))
        browser.close()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        checks.append(("excepción", False, ""))
    finally:
        for p in wheels:
            kill(p)
    bad = [c for c in checks if not c[1]]
    print(f"{len(checks) - len(bad)}/{len(checks)} OK")
    sys.exit(1 if bad else 0)
