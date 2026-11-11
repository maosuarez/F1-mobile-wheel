# E2E b7 (6.2): presupuesto VR con navigator.xr simulado (sin visor). Uso:
#   E2E_WEB_PORT=5211 .venv/bin/python tests/e2e/b7_vr_budget.py
# Simula isSessionSupported -> true y requestSession -> sesión mínima; makeXRCompatible nunca resuelve, así que
# setSession queda pendiente tras onStart y el estado VR (perfil VR_QUALITY aplicado) puede inspeccionarse.
import os
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:" + os.environ.get("E2E_WEB_PORT", "5173")
errors, checks = [], []
INIT = """
(() => {
  const session = {
    addEventListener() {}, removeEventListener() {}, updateRenderState() {},
    requestReferenceSpace: () => new Promise(() => {}), end: () => Promise.resolve(),
    inputSources: [], renderState: {},
  };
  Object.defineProperty(navigator, 'xr', { configurable: true, value: {
    isSessionSupported: () => Promise.resolve(true),
    requestSession: () => Promise.resolve(session),
    addEventListener() {}, removeEventListener() {},
  }});
  const never = () => new Promise(() => {});
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext])
    if (C) C.prototype.makeXRCompatible = never;
})();
"""


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(("OK   " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def main():
    os.makedirs("out", exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        page = browser.new_context(viewport={"width": 1920, "height": 1080}).new_page()
        page.add_init_script(INIT)
        page.on("console", lambda m: None if m.type != "error" or "favicon" in (m.text + str(m.location)).lower()
                else errors.append(("console", m.text)))
        page.on("pageerror", lambda e: errors.append(("pageerror", str(e))))

        page.goto(BASE + "/?debug=1&quality=high")
        page.wait_for_function("window.__f1 && window.__f1.snapshot().gameState === 'pairing'", timeout=30000)
        btn = page.locator("#vr-enter")
        btn.wait_for(state="visible", timeout=5000)
        check("a: botón #vr-enter visible con xr simulado", btn.is_visible())
        page.wait_for_timeout(1500)
        pre = page.evaluate("window.__f1.snapshot()")
        check("a: antes de entrar post activo, dpr 1 en 1920x1080 headless", pre["post"] is True, f"post={pre['post']} dpr={pre['dpr']}")

        page.keyboard.press("F3")
        btn.click()
        page.wait_for_function("window.__f1.snapshot().post === false", timeout=15000)
        page.wait_for_timeout(2500)  # varios fotogramas con el perfil VR
        s = page.evaluate("window.__f1.snapshot()")
        txt = page.locator('[data-testid="debug-panel"]').inner_text()
        print("vr snapshot", {k: s[k] for k in ("post", "dpr", "shadowMapSize", "drawCalls", "maxDrawCalls", "triangles")}, flush=True)
        check("b: perfil VR: post desactivado", s["post"] is False)
        check("b: perfil VR: dpr 1", s["dpr"] == 1, str(s["dpr"]))
        check("b: perfil VR: sombras <= 1024", 0 < s["shadowMapSize"] <= 1024, str(s["shadowMapSize"]))
        import re
        m = re.search(r"draws (\d+)", txt)
        check("b: F3 muestra el total de draw calls", bool(m) and int(m.group(1)) > 0, repr(txt.split("\n")[0]))
        check("b: draw calls del F3 coinciden con el motor", bool(m) and abs(int(m.group(1)) - s["drawCalls"]) <= 5,
              f"F3={m.group(1) if m else None} snapshot={s['drawCalls']}")
        check("c: sin errores de consola", not errors, str(errors[:3]))
        browser.close()
    bad = [c for c in checks if not c[1]]
    print(f"{len(checks) - len(bad)}/{len(checks)} OK")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
