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


def check_world(spec_id: str) -> None:
    """Escenarios de la spec track-world sobre public/track/<id>.world.json."""
    from tools.track.build_world import Grid, covering, prepare, zone_dist  # noqa: E402
    root = Path(__file__).resolve().parents[2]
    p = root / "public" / "track" / f"{spec_id}.world.json"
    if not p.exists():
        check(False, "world.json existe", str(p))
        return
    w = json.loads(p.read_text(encoding="utf-8"))
    size = p.stat().st_size
    check(size < 1_500_000, "world.json < 1,5 MB", f"{size / 1e6:.3f} MB")
    t = w["terrain"]
    check(len(t["h"]) == t["nx"] * t["nz"], "terrain.h = nx*nz", f"{len(t['h'])} vs {t['nx'] * t['nz']}")
    rings = [b["ring"] for b in w["buildings"]] + [x["ring"] for x in w["water"]] + [x["ring"] for x in w["forest"]]
    check(all(len(r) % 2 == 0 and len(r) >= 6 for r in rings), "anillos pares y >= 3 vértices", f"{len(rings)} anillos")
    ctx = prepare(TRACKS[spec_id])
    sm, grid = ctx["sm"], Grid(t)
    d_step = float(ctx["trk"]["step_m"])
    # terreno bajo la pista dentro de los muros
    idx = np.arange(0, len(sm["x"]), 5)
    pts, ytr, own = [], [], []
    for off in (-0.95, -0.5, 0.0, 0.5, 0.95):
        w_ = np.where(off >= 0, sm["wl"][idx], sm["wr"][idx]) + ctx["runoff"]
        pts.append(np.column_stack([sm["x"][idx] + sm["nx"][idx] * off * w_, sm["z"][idx] + sm["nz"][idx] * off * w_]))
        ytr.append(sm["y"][idx])
        own.append(idx)
    pts, ytr, own = np.vstack(pts), np.concatenate(ytr), np.concatenate(own)
    n_s, L = len(sm["x"]), len(sm["x"]) * float(d_step)
    ht = grid.at(pts)
    bad1 = bad2 = n1 = n2 = 0
    lo1 = hi1 = lo2 = None
    band = float(t["cell"]) * 2.5  # franja de transición (celda del terreno) alrededor de la zona de otro tramo
    nb = 0
    for k, (c, cb) in enumerate(zip(covering(ctx, pts), covering(ctx, pts, band))):
        ds = np.abs(c - own[k]); ds = np.minimum(ds, n_s - ds) * d_step
        other = c[ds > 60.0]
        dsb = np.abs(cb - own[k]); dsb = np.minimum(dsb, n_s - dsb) * d_step
        cd = covering(ctx, pts[k:k + 1], -float(t["cell"]) * 0.5)[0]
        deep = cd[np.minimum(np.abs(cd - own[k]), n_s - np.abs(cd - own[k])) * d_step > 60.0]
        if (len(other) == 0 and (dsb > 60.0).any()) or (len(other) and len(deep) == 0):
            nb += 1  # transición: ni zona única ni solapada a fondo
            continue
        other = deep if len(other) else other
        if len(other) == 0:  # un solo tramo
            v = ytr[k] - ht[k]
            n1 += 1
            lo1, hi1 = (v, v) if lo1 is None else (min(lo1, v), max(hi1, v))
            bad1 += not (0.1 - 0.005 <= v <= 0.6 + 0.005)  # tolerancia: alturas en dm
        else:  # zonas solapadas: bajo el tramo más bajo
            v = min(ytr[k], sm["y"][other].min()) - ht[k]
            n2 += 1
            lo2 = v if lo2 is None else min(lo2, v)
            bad2 += v < 0.1
    check(bad1 == 0, "terreno 0,1-0,6 m bajo la pista (un solo tramo, hasta 95 % del muro)",
          f"[{lo1:.3f},{hi1:.3f}] m, {bad1} fuera de {n1}")
    check(bad2 == 0, "zonas solapadas: terreno >= 0,1 m bajo el tramo más bajo",
          f"mín={lo2 if lo2 is None else round(lo2, 2)} m, {bad2} fuera de {n2} (+{nb} en franja de transición)")
    # relieve lejos de la pista
    gx, gz = np.meshgrid(t["x0"] + np.arange(t["nx"]) * t["cell"], t["z0"] + np.arange(t["nz"]) * t["cell"])
    g = np.column_stack([gx.ravel(), gz.ravel()])
    far = zone_dist(ctx, g) > 40.0
    dem_h = ctx["dem"].sample(*ctx["to_osm"](g[far]).T) + ctx["offset"]
    mad = float(np.abs(np.asarray(t["h"])[far] / 10.0 - dem_h).mean())
    check(mad < 0.5 and far.sum() > 0, "relieve = DEM + offset (>40 m del muro, MAE < 0,5 m)", f"MAE={mad:.3f} m, {int(far.sum())} celdas")
    # contenido
    kinds = {k: sum(b["kind"] == k for b in w["buildings"]) for k in ("pit", "grandstand", "tower", "generic")}
    check(kinds["pit"] >= 1 and kinds["grandstand"] >= 1, "al menos un pit y un grandstand", kinds)
    check(len(w["water"]) >= 1, "al menos un polígono de agua", len(w["water"]))
    check(w["pitlane"] is not None and len(w["pitlane"]["pts"]) >= 6, "calle de boxes no nula",
          "presente" if w["pitlane"] else "null")
    # zona libre
    mn = {"gr": np.inf, "otros": np.inf}
    for b in w["buildings"]:
        key = "gr" if b["kind"] == "grandstand" else "otros"
        mn[key] = min(mn[key], zone_dist(ctx, np.array(b["ring"]).reshape(-1, 2)).min())
    check(mn["otros"] >= 6.0 - 0.05 and mn["gr"] >= 2.0 - 0.05, "zona libre: edificios >= +6 m, gradas >= +2 m del muro",
          f"mín edificios={mn['otros']:.2f} gradas={mn['gr']:.2f}")


def main() -> int:
    args = sys.argv[1:]
    world = "--world" in args
    args = [a for a in args if a != "--world"]
    if args and args[0] == "--track" and len(args) == 2:
        path = Path(__file__).resolve().parents[2] / "public" / "track" / f"{args[1]}.json"
    elif len(args) == 1:
        path = Path(args[0])
    else:
        print("uso: validate_track.py <ruta.json> | --track <id> [--world]")
        return 2
    d = json.loads(path.read_text(encoding="utf-8"))
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
    if world:
        check_world(d["id"])
    return report()


def report() -> int:
    for ok, name, val in results:
        print(f"{'OK' if ok else 'FAIL'} {name}: {val}")
    return 0 if all(r[0] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
