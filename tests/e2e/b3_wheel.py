# E2E del bloque 3: host + volante móvil (dos contextos) sobre relay real, y volante simulado.
# Lanzar: python .claude/skills/webapp-testing/scripts/with_server.py \
#   --server ".venv/bin/uvicorn server.main:app --port 8000" --port 8000 --server "npm run dev" --port 5173 \
#   -- .venv/bin/python tests/e2e/b3_wheel.py
import os
import re
import subprocess
import sys
import time
import traceback

from playwright.sync_api import sync_playwright
from websockets.sync.client import connect as ws_connect

WEB_PORT = os.environ.get("E2E_WEB_PORT", "5173")
BASE = f"http://localhost:{WEB_PORT}"   # E2E_RELAY_PORT solo lo usa el comando que arranca el relay
errors = []
checks = []

# Init del volante: sensor sintético a 60 Hz, ángulo de pantalla 90, y espía del WebSocket (tel recibidos, ev enviados)
WHEEL_INIT = """
window.__g = {x: 9.81, y: 0, z: 0};
try { Object.defineProperty(screen.orientation, 'angle', {get: () => 90, configurable: true}); } catch (e) {}
window.__telCount = 0; window.__sent = [];
(() => {
  const Native = window.WebSocket;
  window.WebSocket = class extends Native {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', (e) => { if (typeof e.data === 'string' && e.data.includes('"t":"tel"')) window.__telCount++; });
    }
    send(d) { if (typeof d === 'string' && d.includes('"t":"ev"')) window.__sent.push(JSON.parse(d)); return super.send(d); }
  };
})();
setInterval(() => typeof DeviceMotionEvent !== 'undefined' && window.dispatchEvent(new DeviceMotionEvent('devicemotion',
  {accelerationIncludingGravity: {x: window.__g.x, y: window.__g.y, z: window.__g.z}})), 16);
"""


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


def watch(page, label):
    def on_console(msg):
        if msg.type == "error" and "favicon" not in (msg.text + str(msg.location)).lower():
            errors.append((label, "console", msg.text))
    page.on("console", on_console)
    page.on("pageerror", lambda e: errors.append((label, "pageerror", str(e))))
    return page


class Touch:
    """Multitáctil real por CDP: los puntos omitidos se sueltan."""

    def __init__(self, page):
        self.cdp = page.context.new_cdp_session(page)
        self.pts = {}

    def _send(self, kind):
        pts = [{"x": x, "y": y, "id": i} for i, (x, y) in self.pts.items()]
        self.cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": pts})

    def down(self, i, x, y):
        self.pts[i] = (x, y)
        self._send("touchStart")

    def up(self, i):
        self.pts.pop(i, None)
        self._send("touchMove" if self.pts else "touchEnd")


def box(page, tid):
    return page.locator(f'[data-testid="{tid}"]').bounding_box()


def pedal_point(page, tid, value):
    b = box(page, tid)
    return b["x"] + b["width"] / 2, b["y"] + b["height"] * (1 - value)


def center_of(page, tid):
    b = box(page, tid)
    return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2


def tilt(page, deg):
    import math
    r = math.radians(90 - deg)           # tiltDeg = 90 - atan2(ax, ay)
    page.evaluate(f"window.__g = {{x: {9.81 * math.sin(r)}, y: {9.81 * math.cos(r)}, z: 0}}")


def open_wheel(ctx, room, label):
    pg = watch(ctx.new_page(), label)
    pg.goto(f"{BASE}/wheel/?room={room}&debug=1")
    pg.wait_for_selector('[data-testid="tap-start"]', state="visible")
    return pg


def main():
    st = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        host_ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        wheel_ctx = browser.new_context(viewport={"width": 800, "height": 360}, has_touch=True, is_mobile=True)
        wheel_ctx.add_init_script(WHEEL_INIT)
        host = watch(host_ctx.new_page(), "host")

        # (a) QR, código y modo USB
        def a():
            host.goto(BASE + "/?debug=1")
            host.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'pairing'", timeout=30000)
            host.wait_for_function("(document.querySelector('[data-testid=pairing-code]').textContent||'').trim().length === 4", timeout=10000)
            st["room"] = host.locator('[data-testid="pairing-code"]').inner_text().strip()
            check("a: QR visible", host.locator('[data-testid="pairing-qr"]').is_visible())
            check("a: código de 4 caracteres = room del snapshot", snap(host)["room"] == st["room"], st["room"])
            hint = host.locator('[data-testid="pairing-hint"]').inner_text()
            check("a: pairing-hint en modo USB", "adb reverse" in hint, hint[:60])
        step("a", a)

        # (b) toque en el volante -> cuenta atrás -> wheelLink ok
        def b():
            w = open_wheel(wheel_ctx, st["room"], "wheel1")
            st["w1"], st["t1"] = w, Touch(w)
            w.click('[data-testid="tap-start"]')
            # (c) acelerar a fondo durante la cuenta atrás no mueve el coche
            st["t1"].down(1, *pedal_point(w, "pedal-thr", 0.97))
            host.wait_for_function("window.__f1.snapshot().gameState === 'countdown'", timeout=20000)
            check("b: el host entra en cuenta atrás", True)
            s0 = snap(host)
            host.wait_for_function("window.__f1.snapshot().gameState === 'racing'", timeout=30000)
            host.wait_for_function("window.__f1.snapshot().wheelLink === 'ok'", timeout=10000)
            check("b: wheelLink = ok en carrera", snap(host)["wheelLink"] == "ok")
            check("c: coche inmóvil en la cuenta atrás con acelerador a fondo", s0["speedKmh"] == 0 and s0["simTimeS"] == 0,
                  f"v={s0['speedKmh']:.2f} simT={s0['simTimeS']:.2f}")
        step("b/c", b)

        # (d) +30° -> steer > 0 y d decrece
        def d():
            host.wait_for_function("window.__f1.snapshot().speedKmh > 10", timeout=120000)
            d0 = snap(host)["d"]
            tilt(st["w1"], 30)
            host.wait_for_function("window.__f1.snapshot().inputApplied.steer > 0.1", timeout=20000)
            check("d: inputApplied.steer > 0", True, f"{snap(host)['inputApplied']['steer']:.3f}")
            host.wait_for_function(f"window.__f1.snapshot().d < {d0} - 0.3", timeout=120000)
            check("d: d del coche decrece", True, f"{d0:.2f} -> {snap(host)['d']:.2f}")
            tilt(st["w1"], 0)
        step("d", d)

        # (e) acelerador + freno + leva a la vez
        def e():
            w, t = st["w1"], st["t1"]
            n0 = w.evaluate("window.__sent.filter(m => m.k === 'up').length")
            t.down(2, *pedal_point(w, "pedal-brk", 0.7))
            t.down(3, *center_of(w, "paddle-up"))
            host.wait_for_function("(() => { const a = window.__f1.snapshot().inputApplied; return a.thr > 0.5 && a.brk > 0.3; })()", timeout=20000)
            a = snap(host)["inputApplied"]
            check("e: thr y brk simultáneos en el host", a["thr"] > 0.5 and a["brk"] > 0.3, f"thr={a['thr']:.2f} brk={a['brk']:.2f}")
            t.up(3)
            w.wait_for_timeout(300)
            n1 = w.evaluate("window.__sent.filter(m => m.k === 'up').length")
            check("e: un único evento up", n1 - n0 == 1, f"{n1 - n0}")
            li = w.evaluate("window.__wheel.lastIn()")
            check("e: lastIn con thr y brk > 0", li["thr"] > 0 and li["brk"] > 0, f"thr={li['thr']:.2f} brk={li['brk']:.2f}")
            t.up(2)
        step("e", e)

        # (f) pantalla del volante, tel/s y RTT
        def f():
            w = st["w1"]
            w.wait_for_function("parseInt(document.querySelector('[data-testid=disp-speed]').textContent) > 0", timeout=60000)
            check("f: el volante muestra velocidad > 0", True, w.locator('[data-testid="disp-speed"]').inner_text())
            rate = 0
            for attempt in range(2):
                c0, t0 = w.evaluate("[window.__telCount, performance.now()]")
                w.wait_for_timeout(3000)
                c1, t1 = w.evaluate("[window.__telCount, performance.now()]")
                rate = (c1 - c0) / ((t1 - t0) / 1000)
                if 17 <= rate <= 23:
                    break
                print(f"  tel/s={rate:.1f} fuera de rango, reintento en 60 s", flush=True)
                time.sleep(60)
            st["rate"] = rate
            check("f: 17-23 tel por segundo", 17 <= rate <= 23, f"{rate:.1f} tel/s")
            host.wait_for_function("window.__f1.snapshot().rttMs !== null", timeout=10000)
            check("f: rttMs del host es un número", isinstance(snap(host)["rttMs"], (int, float)), str(snap(host)["rttMs"]))
            host.screenshot(path="out/b3_host.png")
            w.screenshot(path="out/b3_wheel.png")
        step("f", f)

        # (g) cerrar el volante -> pausa wheelLost < 1,5 s; reabrir -> reanuda < 1 s sin reiniciar la vuelta
        def g():
            before = snap(host)
            # Tiempos medidos dentro de la página del host (performance.now), no desde Python
            host.evaluate("""() => {
              window.__m = {close: null, lost: null, paused: null};
              setInterval(() => {
                const s = window.__f1.snapshot(), n = performance.now();
                if (window.__m.close !== null && window.__m.lost === null && s.wheelLink === 'lost') window.__m.lost = n;
                if (window.__m.close !== null && window.__m.paused === null && s.gameState === 'paused' && s.pauseReason === 'wheelLost') window.__m.paused = n;
              }, 10);
            }""")
            st["t1"].up(1)
            host.evaluate("window.__m.close = performance.now()")
            tc = time.time()
            st["w1"].close()
            close_py = time.time() - tc
            host.wait_for_function("window.__m.paused !== null", timeout=15000, polling=30)
            m = host.evaluate("window.__m")
            lost_s, pause_s = (m["lost"] - m["close"]) / 1000, (m["paused"] - m["close"]) / 1000
            check("g: pausa wheelLost en < 1.5 s (medido en la página)", pause_s < 1.5,
                  f"lost +{lost_s:.3f} s, pausa +{pause_s:.3f} s, close() de Python {close_py:.3f} s")
            t0 = time.time()
            check("g: overlay-wheel-lost visible", host.locator('[data-testid="overlay-wheel-lost"]').is_visible())
            w2 = open_wheel(wheel_ctx, st["room"], "wheel2")
            st["w2"], st["t2"] = w2, Touch(w2)
            t0 = time.time()
            w2.click('[data-testid="tap-start"]')
            host.wait_for_function("window.__f1.snapshot().gameState === 'racing'", timeout=15000, polling=30)
            dt = time.time() - t0
            after = snap(host)
            check("g: reanuda en < 1 s", dt < 1.0, f"{dt:.2f} s")
            check("g: misma vuelta y lapTimeS no reiniciado", after["lap"] == before["lap"] and after["lapTimeS"] >= before["lapTimeS"] - 0.01,
                  f"lap {before['lap']}->{after['lap']} t {before['lapTimeS']:.2f}->{after['lapTimeS']:.2f}")
        step("g", g)

        # (h) un segundo volante reemplaza al primero
        def h():
            w3 = open_wheel(wheel_ctx, st["room"], "wheel3")
            st["w3"], st["t3"] = w3, Touch(w3)
            w3.click('[data-testid="tap-start"]')
            st["w2"].wait_for_function("window.__wheel.state() !== 'active'", timeout=5000)
            check("h: el primer volante deja de estar activo", True, st["w2"].evaluate("window.__wheel.state()"))
            st["t3"].down(1, *pedal_point(w3, "pedal-thr", 0.9))
            host.wait_for_function("window.__f1.snapshot().wheelLink === 'ok' && window.__f1.snapshot().inputApplied.thr > 0.5", timeout=10000)
            check("h: el host recibe del segundo volante", True)
            st["t3"].up(1)
            st["w2"].close()
        step("h", h)

        # (i, j) tel crudo desde un host de prueba en otra sala
        def ij():
            w = open_wheel(wheel_ctx, "TEST", "wheel4")
            w.click('[data-testid="tap-start"]')
            hw = ws_connect(f"ws://localhost:{WEB_PORT}/ws/TEST?role=host")
            base = dict(t="tel", spd=287, gear=7, rpm=0, leds=12, drs=2, ers=0.6, ot=False, lap=1, delta=None, warn="", echo=0, hold=0)

            def push(**kw):
                import json
                msg = json.dumps({**base, **kw})
                for _ in range(4):
                    hw.send(msg)
                    time.sleep(0.05)
                w.wait_for_timeout(150)

            def txt(tid):
                return w.locator(f'[data-testid="{tid}"]').inner_text().strip()

            w.wait_for_function("window.__wheel.state() === 'active'", timeout=10000)
            push()
            leds = w.evaluate("[...document.querySelectorAll('[data-testid=disp-leds] .led.on')].map(l => l.classList.contains('g') ? 'g' : l.classList.contains('r') ? 'r' : 'b').join('')")
            check("i: 287 y marcha 7", txt("disp-speed") == "287" and txt("disp-gear") == "7", f"{txt('disp-speed')}/{txt('disp-gear')}")
            check("i: 12 LEDs (5 verdes, 5 rojos, 2 azul-violeta)", leds == "ggggg" + "rrrrr" + "bb", leds)
            check("i: DRS abierto", w.locator('[data-testid="disp-drs"]').get_attribute("data-state") == "2")
            check("i: barra ERS al 60 %", w.locator('[data-testid="disp-ers"]').get_attribute("data-value") == "0.6"
                  and w.evaluate("document.querySelector('[data-testid=disp-ers] i').style.width") == "60%")
            gear_color = w.evaluate("getComputedStyle(document.querySelector('[data-testid=disp-gear]')).color")
            push(leds=16)
            n_on = w.evaluate("document.querySelectorAll('[data-testid=disp-leds] .led.on').length")
            lim = w.evaluate("document.querySelector('[data-testid=disp-leds]').classList.contains('limiter')")
            check("i: leds=16 -> 15 LEDs parpadeando", n_on == 15 and lim, f"on={n_on} limiter={lim}")
            push(gear=-1)
            c_r = w.evaluate("getComputedStyle(document.querySelector('[data-testid=disp-gear]')).color")
            r_txt = txt("disp-gear")
            push(gear=0)
            c_n = w.evaluate("getComputedStyle(document.querySelector('[data-testid=disp-gear]')).color")
            check("i: R y N con color distinto al de las marchas", r_txt == "R" and txt("disp-gear") == "N" and c_r != gear_color and c_n != gear_color,
                  f"{r_txt}/{txt('disp-gear')} {gear_color} {c_r} {c_n}")
            hw.send('{"t":"fx","k":"shift"}')
            w.wait_for_function("window.__wheel.vibrations.some(p => p.length === 1 && p[0] === 12)", timeout=3000)
            check("j: fx shift registra [12]", True)
            hw.close()
            w.close()
        step("i/j", ij)

        # cerrar páginas de la sesión principal antes del paso (k) para liberar CPU
        for pg in (st.get("w3"), host):
            try:
                if pg:
                    pg.close()
            except Exception:  # noqa: BLE001
                pass
        host_ctx.close()
        wheel_ctx.close()

        # (k) lazo cerrado: host 640x360 + fake_wheel --script lap
        def k():
            ctx = browser.new_context(viewport={"width": 640, "height": 360})
            h2 = watch(ctx.new_page(), "host-k")
            h2.goto(BASE + "/?debug=1")
            h2.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'pairing'", timeout=30000)
            h2.wait_for_function("window.__f1.snapshot().room !== null", timeout=10000)
            room = snap(h2)["room"]
            t0 = time.time()
            proc = subprocess.run([".venv/bin/python", "tools/fake_wheel.py", "--room", room, "--url", f"ws://localhost:{WEB_PORT}/ws", "--script", "lap", "--timeout", "400"],
                                  capture_output=True, text=True, timeout=450)
            dt = time.time() - t0
            print(proc.stdout[-600:], proc.stderr[-300:], flush=True)
            laps = re.findall(r"Vuelta (\d+) completada en ([\d.]+) s", proc.stdout)
            st["lap_s"] = laps[-1][1] if laps else None
            check("k: fake_wheel --script lap sale 0", proc.returncode == 0, f"exit={proc.returncode} {dt:.0f} s reales, vuelta {st['lap_s']} s")
            ctx.close()
        step("k", k)
        browser.close()

    check("sin errores de consola ni pageerror", not errors, "; ".join(f"{l}/{k}: {m}" for l, k, m in errors)[:600])
    failed = [c for c in checks if not c[1]]
    print(f"\n{len(checks) - len(failed)}/{len(checks)} comprobaciones OK", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
