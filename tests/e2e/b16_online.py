# E2E del bloque 16 (3.2): carrera online con 3 contextos (A propietaria con 4 rivales, B con dropst=10, C abandona a mitad).
# Relay: RACE_TEST_DELAY_MS=80 .venv/bin/uvicorn server.main:app --port 8111 ; Vite (proxy /ws y /api a 8111) en E2E_WEB_PORT.
#   E2E_WEB_PORT=5211 E2E_SHOTS=<carpeta> .venv/bin/python tests/e2e/b16_online.py
import os
import random
import string
import sys
import time

from playwright.sync_api import sync_playwright

WEB_PORT = os.environ.get("E2E_WEB_PORT", "5173")
SHOTS = os.environ.get("E2E_SHOTS", "/tmp/b16")
BASE = f"http://localhost:{WEB_PORT}"
LONG_MS = int(os.environ.get("E2E_RACE_TIMEOUT_MS", str(25 * 60 * 1000)))
CODE = "".join(random.choice("ABCDEFGHJKMNPQRSTUVWXYZ23456789") for _ in range(6))
errors, checks = [], []
os.makedirs(SHOTS, exist_ok=True)
T0 = time.time()


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def log(m):
    print(f"[{time.time() - T0:6.0f}s] {m}", flush=True)


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


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        mk = lambda tag: watch(browser.new_context(viewport={"width": 480, "height": 270}).new_page(), tag)
        a, b, c = mk("A"), mk("B"), mk("C")
        n = lambda p: p.locator('[data-testid="lobby-player"]').count()
        wait_n = lambda p, k: p.wait_for_function(f"document.querySelectorAll('[data-testid=\"lobby-player\"]').length >= {k}", timeout=240000)
        a.goto(f"{BASE}/?online=create&name=Ana&rivals=4&laps=1&autostart=3&debug=1&autopilot=1")
        wait_n(a, 1)
        code = tid(a, "lobby-room").inner_text().strip()   # `create` genera el código; el unirse lo lee del vestíbulo
        b.goto(f"{BASE}/?online=join&code={code}&name=Beto&laps=1&debug=1&autopilot=1&dropst=10")
        wait_n(a, 2); wait_n(b, 2)
        log("A y B en sala")
        shot(a, "01_vestibulo_A"); shot(b, "01_vestibulo_B")
        names = lambda p: [" ".join(t.split()) for t in p.locator('[data-testid="lobby-player"]').all_inner_texts()]
        check("A y B en la lista de ambos", n(a) >= 2 and n(b) >= 2 and any("Ana" in t for t in names(b)) and any("Beto" in t for t in names(a)), f"A={names(a)} B={names(b)}")
        c.goto(f"{BASE}/?online=join&code={code}&name=Ceci&laps=1&debug=1&autopilot=1")
        for p in (a, b, c):
            p.wait_for_function("window.__f1 && window.__f1.snapshot().online && window.__f1.snapshot().online.players.length >= 3", timeout=240000)
        log("C en sala; autostart")
        for p, t in ((a, "A"), (b, "B"), (c, "C")):
            p.wait_for_function("window.__f1.snapshot().race.phase === 'grid' || window.__f1.snapshot().race.phase === 'green'", timeout=240000)
        shot(a, "02_parrilla_A"); shot(b, "02_parrilla_B")
        for p in (a, b, c):
            p.wait_for_function("window.__f1.snapshot().race.phase === 'green'", timeout=LONG_MS)
        log("luz verde")
        for p in (a, b):
            p.wait_for_function("window.__f1.snapshot().online.lightsOutSrv !== null", timeout=60000)
        sa0, sb0 = snap(a), snap(b)
        oa, ob = sa0["online"], sb0["online"]
        la, lb = oa["lightsOutSrv"], ob["lightsOutSrv"]
        check("lightsOutTargetSrv idéntico en A y B", oa["lightsOutTargetSrv"] is not None and oa["lightsOutTargetSrv"] == ob["lightsOutTargetSrv"],
              f"A={oa['lightsOutTargetSrv']} B={ob['lightsOutTargetSrv']}")
        check("|lightsOutSrv A-B| < 50 ms", abs(la - lb) < 50, f"{abs(la - lb):.1f} ms")
        errs = {"A": [], "B": []}
        for _ in range(5):
            for t, p in (("A", a), ("B", b)):
                errs[t].append(snap(p)["online"]["clockErrMs"])
            time.sleep(2)
        print(f"  INFO clockErrMs (sin umbral) {errs}")
        for t, o in (("A", oa), ("B", ob)):
            print(f"  INFO {t}: lightsOutSrv - objetivo = {o['lightsOutSrv'] - o['lightsOutTargetSrv']:.0f} ms (sin umbral)")
        # Abandono de C a mitad de carrera (≥ 15 s de sim) sin que haya terminado
        a.wait_for_function("window.__f1.snapshot().simTimeS > 15", timeout=LONG_MS)
        slotC = [q["slot"] for q in snap(a)["online"]["players"] if q["name"] == "Ceci"]
        c.context.close()
        log("C cerrada")
        a.wait_for_function("window.__f1.snapshot().online.players.length === 2", timeout=60000)
        b.wait_for_function("window.__f1.snapshot().online.players.length === 2", timeout=60000)
        check("A y B ven que C se fue", len(slotC) == 1 and all(len(snap(p)["online"]["players"]) == 2 for p in (a, b)), f"slot C={slotC}")
        check("la carrera continúa tras el abandono", snap(a)["race"]["phase"] in ("green", "finished") and snap(b)["race"]["phase"] in ("green", "finished"),
              f"{snap(a)['race']['phase']}/{snap(b)['race']['phase']}")
        shot(a, "03_en_carrera_A")
        t1 = time.time()
        while time.time() - t1 < LONG_MS / 1000 and not all(snap(p)["gameState"] == "results" for p in (a, b)):
            time.sleep(30)
            log(f"sim A={snap(a)['simTimeS']:.0f}s B={snap(b)['simTimeS']:.0f}s phase={snap(a)['race']['phase']}/{snap(b)['race']['phase']}")
        for p in (a, b):
            p.wait_for_function("window.__f1.snapshot().gameState === 'results'", timeout=10000)
            p.wait_for_selector('[data-testid="results-table"]', timeout=30000)
        log("resultados")
        shot(a, "04_resultados_A"); shot(b, "04_resultados_B")
        sa, sb = snap(a), snap(b)
        check("resultados del propietario en ambos", sa["online"]["results"] and sb["online"]["results"] and sb["online"]["results"]["official"],
              f"A={sa['online']['results']} B={sb['online']['results']}")
        ta = tid(a, "results-table").locator("tbody tr").all_inner_texts()
        tb = tid(b, "results-table").locator("tbody tr").all_inner_texts()
        norm = lambda rows: [" ".join(r.split()) for r in rows]
        ia, ib = sa["online"]["results"]["ids"], sb["online"]["results"]["ids"]
        check("misma tabla (mismo orden)", ia == ib and len(ia) == 7, f"ids A={ia} B={ib}")
        print("  A:", norm(ta)); print("  B:", norm(tb))
        check("filas con el mismo nombre/orden en pantalla", [r.split()[1] if len(r.split()) > 1 else r for r in norm(ta)] == [r.split()[1] if len(r.split()) > 1 else r for r in norm(tb)])
        check("C aparece como DNF en A y B", sum("DNF" in r for r in ta) >= 1 and sum("DNF" in r for r in tb) >= 1,
              f"DNF A={sum('DNF' in r for r in ta)} B={sum('DNF' in r for r in tb)}")
        jb, ja = sb["online"]["remoteJumpMaxM"], sa["online"]["remoteJumpMaxM"]
        print(f"  INFO remoteJumpMaxM B={jb:.3f} A={ja:.3f}; remoteStepMaxM B={sb['online']['remoteStepMaxM']:.2f} A={sa['online']['remoteStepMaxM']:.2f} (sin umbral; lo cubre Vitest)")
        check("0 errores de consola", not errors, str(errors[:5]))
        browser.close()
    bad = [n for n, ok, _ in checks if not ok]
    log("FALLOS: " + ", ".join(bad) if bad else "TODO OK")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
