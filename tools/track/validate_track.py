"""Validador de track.json: una línea OK/FAIL por criterio de la spec; exit 0 solo si todo pasa."""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.track.tracks import TRACKS  # noqa: E402

COLS = ["s", "x", "y", "z", "wl", "wr", "nx", "nz", "k", "pitch", "bank"]
KEYS = ["id", "name", "length_m", "direction", "step_m", "samples", "start_s", "sectors_s",
        "drs_zones", "corners", "kerbs", "runoff_m"]
results: list[tuple[bool, str, str]] = []


def check(ok, name: str, value) -> None:
    results.append((bool(ok), name, str(value)))


def span(a: float, b: float, L: float) -> float:
    return (b - a) % L


def in_span(s: np.ndarray, a: float, b: float, L: float) -> np.ndarray:
    return ((s - a) % L) <= span(a, b, L)


def main() -> int:
    if len(sys.argv) != 2:
        print("uso: validate_track.py <ruta.json>")
        return 2
    d = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    missing = [k for k in KEYS if k not in d]
    check(not missing, "claves de primer nivel", f"faltan {missing}" if missing else "completas")
    if missing:
        return report()
    sm = d["samples"]
    check(all(c in sm for c in COLS), "columnas de samples", "11 presentes" if all(c in sm for c in COLS) else "faltan")
    if not all(c in sm for c in COLS):
        return report()
    a = {c: np.asarray(sm[c], float) for c in COLS}
    n = len(a["s"])
    L, st = float(d["length_m"]), float(d["step_m"])
    spec = TRACKS.get(d["id"])
    check(all(len(a[c]) == n for c in COLS) and n >= 2000, "columnas homogéneas N>=2000", f"N={n}")
    check(all(np.isfinite(a[c]).all() for c in COLS), "valores finitos", "sin NaN/inf" )
    if n < 3:
        return report()
    s, x, y, z, k = a["s"], a["x"], a["y"], a["z"], a["k"]

    # muestreo uniforme
    e = np.abs(s - np.arange(n) * st).max()
    check(abs(s[0]) == 0 and e < 0.002, "s[i]=i*step_m (err<0.002)", f"err={e:.5f}")
    check(1.9 <= st <= 2.1, "step_m en [1.9,2.1]", f"{st:.5f}")
    check(abs(n * st - L) < 0.01, "N*step_m = length_m (<0.01)", f"{abs(n*st-L):.5f}")
    check(max(abs(x[0]), abs(y[0]), abs(z[0])) < 0.01 and d["start_s"] == 0, "origen en la meta",
          f"x0={x[0]} y0={y[0]} z0={z[0]} start_s={d['start_s']}")
    # normal
    tx = np.roll(x, -1) - np.roll(x, 1)
    tz = np.roll(z, -1) - np.roll(z, 1)
    nm = np.hypot(tx, tz)
    ex, ez = tz / nm, -tx / nm
    nn = np.hypot(a["nx"], a["nz"])
    ang = np.degrees(np.arccos(np.clip(a["nx"] * ex + a["nz"] * ez, -1, 1) / nn))
    check(nn.min() >= 0.999 and nn.max() <= 1.001, "normal unitaria", f"[{nn.min():.5f},{nn.max():.5f}]")
    check(ang.max() < 3, "normal = (tz,-tx) (<3°)", f"max={ang.max():.2f}°")

    # fidelidad
    if spec:
        off = spec.official_length_m
        check(abs(L / off - 1) <= 0.01, f"longitud ±1 % de {off:.0f}", f"{L:.1f}")
        if d["id"] == "interlagos":
            check(4266 <= L <= 4352, "longitud en [4266,4352]", f"{L:.1f}")
    else:
        check(False, "circuito conocido", d["id"])
    gap = np.hypot(x[-1] - x[0], z[-1] - z[0])
    check(1.5 <= gap <= 2.5 and abs(y[-1] - y[0]) < 0.5, "cierre del bucle",
          f"xz={gap:.3f} dy={abs(y[-1]-y[0]):.3f}")
    px, py = x, -z
    area = 0.5 * (np.dot(px, np.roll(py, -1)) - np.dot(py, np.roll(px, -1)))
    exp = spec.direction if spec else "ccw"
    check(d["direction"] == exp and (area > 0) == (exp == "ccw"), f"sentido {exp}",
          f"direction={d['direction']} área={area:.0f}")
    check(np.abs(k).max() < 0.12 and (k > 0).any() and (k < 0).any(), "curvatura sin picos",
          f"max|k|={np.abs(k).max():.4f}")

    # anchos
    wt = a["wl"] + a["wr"]
    check(wt.min() >= 8 and wt.max() <= 25 and a["wl"].min() >= 3 and a["wr"].min() >= 3, "anchos plausibles",
          f"total=[{wt.min():.2f},{wt.max():.2f}] wl>={a['wl'].min():.2f} wr>={a['wr'].min():.2f}")

    # elevación
    rng = y.max() - y.min()
    pitch = a["pitch"]
    cd = (y[2:] - y[:-2]) / (2 * st)
    check(a["bank"].any() == False, "bank = 0", f"max|bank|={np.abs(a['bank']).max()}")  # noqa: E712
    check(np.abs(pitch[1:-1] - cd).max() < 0.01 and np.abs(pitch).max() < 0.15, "pitch coherente y suave",
          f"dif={np.abs(pitch[1:-1]-cd).max():.5f} max|pitch|={np.abs(pitch).max():.4f}")
    if d["id"] == "interlagos":
        check(25 <= rng <= 60, "desnivel total en [25,60]", f"{rng:.1f}")
        m1 = y[(s >= 200) & (s <= 1500)].min()
        check(m1 <= y[0] - 10, "bajada tras S do Senna (>=10 m)", f"min={m1:.2f} y0={y[0]:.2f}")
        m2 = y[(s >= 2800) & (s <= 3600)].min()
        mp = pitch[(s >= 3200) & (s <= 3800)].mean()
        check(m2 <= y[0] - 15 and mp > 0.02, "subida de boxes (>=15 m, pitch medio 3200-3800 >0.02)",
              f"min={m2:.2f} pitch={mp:.4f}")

    # metadatos
    sec = d["sectors_s"]
    ok = len(sec) == 2 and 0 < sec[0] < sec[1] < L and min(sec[0], sec[1] - sec[0], L - sec[1]) >= 0.15 * L
    check(ok, "sectores", f"{sec}")
    zs = d["drs_zones"]
    if d["id"] == "interlagos":
        check(len(zs) == 2, "2 zonas DRS", len(zs))
    zok, info = len(zs) > 0, []
    contains0 = False
    for zn in zs:
        v = [zn["detect_s"], zn["start_s"], zn["end_s"]]
        zl = span(zn["start_s"], zn["end_s"], L)
        mask = in_span(s, zn["start_s"], zn["end_s"], L)
        frac = (np.abs(k[mask]) < 1 / 150).mean() if mask.any() else 0
        contains0 |= bool(mask[0])
        zok &= all(0 <= t < L for t in v) and 300 <= zl <= 1300 and frac >= 0.8
        info.append(f"len={zl:.0f} recto={frac:.2f}")
    if d["id"] == "interlagos":
        zok &= contains0
    check(zok, "zonas DRS (rango, 300-1300 m, 80 % recto, una con s=0)", info)
    cs = d["corners"]
    ns = [c["n"] for c in cs]
    names = {c["name"] for c in cs}
    cok = ns == list(range(1, len(cs) + 1)) and all(b["s"] > a_["s"] for a_, b in zip(cs, cs[1:]))
    if d["id"] == "interlagos":
        cok &= 12 <= len(cs) <= 16 and {"S do Senna", "Curva do Sol", "Bico de Pato", "Junção"} <= names
    check(cok, "curvas (n consecutivos, s creciente, nombres)", f"{len(cs)} curvas")
    kb = d["kerbs"]
    kok = all(q["side"] in ("left", "right") and 20 <= span(q["s0"], q["s1"], L) <= 400 for q in kb)
    for side in ("left", "right"):
        qs = sorted((q for q in kb if q["side"] == side), key=lambda q: q["s0"])
        for i, q in enumerate(qs):
            nxt = qs[(i + 1) % len(qs)] if len(qs) > 1 else None
            if nxt is not None:
                g = span(q["s1"], nxt["s0"], L)
                if g < 15 and span(nxt["s0"], q["s1"], L) > g:  # hueco (no solape inverso)
                    kok = False
                if span(nxt["s0"], q["s1"], L) < span(q["s0"], nxt["s0"], L) and nxt is not q:
                    kok = False  # solapamiento
    if d["id"] == "interlagos":
        kok &= len(kb) >= 8
    check(kok, "pianos (>=8, 20-400 m, separación >=15 m)", f"{len(kb)} tramos")
    check(d["runoff_m"] > 0, "runoff_m > 0", d["runoff_m"])
    return report()


def report() -> int:
    for ok, name, val in results:
        print(f"{'OK' if ok else 'FAIL'} {name}: {val}")
    return 0 if all(r[0] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
