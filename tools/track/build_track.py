"""Pipeline de datos de circuito: TUMFTM + FastF1 -> public/track/<id>.json."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.interpolate import splev, splprep
from scipy.signal import savgol_filter
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.track.tracks import TRACKS, TrackSpec

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "tools" / "track" / ".cache"
TUMFTM_DIR = CACHE / "racetrack-database"
TUMFTM_URL = "https://github.com/TUMFTM/racetrack-database"
STEPS = ("centerline", "fastf1", "align", "elev", "meta")


def die(msg: str, code: int = 2) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


# ---------------------------------------------------------------- centro
@dataclass
class Centerline:
    xy: np.ndarray       # (N,2) metros, sistema de datos
    wr: np.ndarray       # (N,)
    wl: np.ndarray       # (N,)
    tan: np.ndarray      # (N,2) tangente unitaria
    k: np.ndarray        # (N,) curvatura, >0 = giro a la izquierda
    step_m: float
    length: float

    @property
    def n(self) -> int:
        return len(self.xy)


def polyline_len(xy: np.ndarray, closed: bool = True) -> float:
    d = np.diff(xy, axis=0)
    total = np.hypot(d[:, 0], d[:, 1]).sum()
    if closed:
        total += np.hypot(*(xy[0] - xy[-1]))
    return float(total)


def signed_area(xy: np.ndarray) -> float:
    x, y = xy[:, 0], xy[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def load_centerline(spec: TrackSpec) -> np.ndarray | None:
    """(M,4): x_m, y_m, w_right, w_left. None si falta el CSV."""
    if not TUMFTM_DIR.exists():
        TUMFTM_DIR.parent.mkdir(parents=True, exist_ok=True)
        print("Clonando TUMFTM/racetrack-database...")
        r = subprocess.run(["git", "clone", "--depth", "1", TUMFTM_URL, str(TUMFTM_DIR)],
                           capture_output=True, text=True)
        if r.returncode != 0:
            print(f"AVISO: no se pudo clonar TUMFTM: {r.stderr.strip()[:200]}")
            return None
    csv = TUMFTM_DIR / "tracks" / spec.tumftm_csv
    if not csv.exists():
        return None
    return np.loadtxt(csv, delimiter=",", comments="#")


SMOOTH_RMS_M = 0.4  # suavizado leve del spline


def resample_closed(xy: np.ndarray, widths: np.ndarray, step: float = 2.0) -> Centerline:
    """Spline periódico remuestreado cada ~step m (N = round(L/step), step_m = L/N)."""
    xy = np.asarray(xy, float)
    widths = np.asarray(widths, float)  # (M,2): w_right, w_left
    if np.hypot(*(xy[0] - xy[-1])) < 1e-6:
        xy, widths = xy[:-1], widths[:-1]
    m = len(xy)
    pts = np.vstack([xy, xy[:1]])
    tck, u = splprep([pts[:, 0], pts[:, 1]], s=m * SMOOTH_RMS_M ** 2, per=1)
    dense_u = np.linspace(0.0, 1.0, 40001)
    dx, dy = splev(dense_u, tck, der=1)
    ds = np.hypot(dx, dy)
    cum = np.concatenate([[0.0], np.cumsum((ds[1:] + ds[:-1]) / 2 * np.diff(dense_u))])
    length = float(cum[-1])
    n = int(round(length / step))
    step_m = length / n
    uu = np.interp(np.arange(n) * step_m, cum, dense_u)
    x, y = splev(uu, tck)
    dx, dy = splev(uu, tck, der=1)
    ddx, ddy = splev(uu, tck, der=2)
    sp = np.hypot(dx, dy)
    k = (dx * ddy - dy * ddx) / sp ** 3
    tan = np.stack([dx / sp, dy / sp], axis=1)
    # anchos periódicos interpolados sobre el parámetro u de los puntos originales
    ue = np.concatenate([u[:-1] - 1.0, u[:-1], u[:-1] + 1.0])
    out = []
    for c in range(2):
        w = np.tile(widths[:, c], 3)
        out.append(np.interp(uu, ue, w))
    return Centerline(np.stack([x, y], axis=1), out[0], out[1], tan, k, step_m, length)


# ---------------------------------------------------------------- FastF1
@dataclass
class FastF1Data:
    xyz: np.ndarray                      # (K,3) metros; el índice 0 es la línea de meta
    corners: list[tuple[int, float, float]]
    sector_fracs: tuple[float, float]
    year: int
    n_laps: int
    lap_len_m: float


def _lap_polyline(lap, spec):
    """Posiciones (metros) de una vuelta de [LapStartTime, fin], con extremos interpolados."""
    pos = lap.get_pos_data(pad=1, pad_side="both")
    t = pos["SessionTime"].dt.total_seconds().to_numpy()
    t0 = lap["LapStartTime"].total_seconds()
    t1 = (lap["LapStartTime"] + lap["LapTime"]).total_seconds()
    xyz = pos[["X", "Y", "Z"]].to_numpy(float) * 0.1
    if np.isnan(xyz).any() or t.min() > t0 or t.max() < t1:
        return None
    inside = (t > t0) & (t < t1)
    tt = np.concatenate([[t0], t[inside], [t1]])
    out = np.stack([np.interp(tt, t, xyz[:, c]) for c in range(3)], axis=1)
    return tt - t0, out


def _fit_corners_to_path(corners, path_xy):
    """circuit_info usa un origen distinto al de la telemetría: se ajusta una traslación
    (búsqueda en rejilla + ICP) para llevar las curvas al marco de la telemetría."""
    if not corners:
        return corners
    c = np.array([(x, y) for _, x, y in corners])
    tree = cKDTree(path_xy)
    base = path_xy.mean(0) - c.mean(0)
    best = (np.inf, base)
    for dx in range(-500, 501, 10):
        for dy in range(-500, 501, 10):
            off = base + (dx, dy)
            sc = tree.query(c + off)[0].mean()
            if sc < best[0]:
                best = (sc, off)
    q = c + best[1]
    for _ in range(50):
        _, i = tree.query(q)
        q = q + (path_xy[i] - q).mean(0)
    resid = tree.query(q)[0].mean()
    if resid > 5:
        print(f"AVISO: ajuste de curvas con residuo {resid:.1f} m")
    return [(num, float(x), float(y)) for (num, _, _), (x, y) in zip(corners, q)]


def load_fastf1(spec: TrackSpec) -> FastF1Data:
    import logging
    import warnings

    import fastf1
    warnings.filterwarnings("ignore")
    (CACHE / "fastf1").mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(CACHE / "fastf1"))
    fastf1.logger.set_log_level(logging.CRITICAL)
    errors = []
    for year in spec.years:
        try:
            ses = fastf1.get_session(year, spec.fastf1_event, "Q")
            ses.load(laps=True, telemetry=True, weather=False, messages=False)
            laps = ses.laps.dropna(subset=["LapTime", "LapStartTime"]).sort_values("LapTime")
            polys, first_sec = [], None
            for _, lap in laps.iterrows():
                if len(polys) >= 5:
                    break
                try:
                    r = _lap_polyline(lap, spec)
                except Exception:
                    continue
                if r is None or len(r[0]) < 100:
                    continue
                if first_sec is None:
                    s1 = lap.get("Sector1SessionTime")
                    s2 = lap.get("Sector2SessionTime")
                    if s1 == s1 and s2 == s2 and s1 is not None and s2 is not None:
                        first_sec = (s1.total_seconds() - lap["LapStartTime"].total_seconds(),
                                     s2.total_seconds() - lap["LapStartTime"].total_seconds(), r)
                polys.append(r)
            if len(polys) < 3:
                raise RuntimeError(f"solo {len(polys)} vueltas con posición completa")
            lens = [polyline_len(p[1][:, :2], closed=False) for p in polys]
            med = float(np.median(lens))
            if abs(med / spec.official_length_m - 1) > 0.05:
                die(f"FastF1: longitud de vuelta {med:.0f} m fuera de ±5 % de "
                    f"{spec.official_length_m:.0f} m (¿unidades?)")
            keep = [p for p, L in zip(polys, lens) if abs(L / med - 1) < 0.03]
            kn = int(round(med / 2.0))
            fr = np.linspace(0, 1, kn, endpoint=False)
            acc = []
            for tt, xyz in keep:
                cum = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(xyz[:, :2], axis=0).T))])
                acc.append(np.stack([np.interp(fr * cum[-1], cum, xyz[:, c]) for c in range(3)], axis=1))
            mean = np.mean(acc, axis=0)
            # fracciones de sector de la vuelta más rápida
            sf = (1 / 3, 2 / 3)
            if first_sec is not None:
                tt, xyz = first_sec[2]
                cum = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(xyz[:, :2], axis=0).T))])
                sf = (float(np.interp(first_sec[0], tt, cum) / cum[-1]),
                      float(np.interp(first_sec[1], tt, cum) / cum[-1]))
            else:
                print("AVISO: sin tiempos de sector; se usan L/3 y 2L/3")
            corners = []
            try:
                ci = ses.get_circuit_info()
                for _, c in ci.corners.iterrows():
                    corners.append((int(c["Number"]), float(c["X"]) * 0.1, float(c["Y"]) * 0.1))
            except Exception as e:
                print(f"AVISO: FastF1 sin circuit_info ({e})")
            corners = _fit_corners_to_path(corners, mean[:, :2])
            return FastF1Data(mean, corners, sf, year, len(keep), polyline_len(mean[:, :2]))
        except SystemExit:
            raise
        except Exception as e:  # año sin datos
            errors.append(f"{year}: {str(e)[:120]}")
            print(f"AVISO: FastF1 {year} no disponible ({str(e)[:100]})")
    die("FastF1 no entregó telemetría de ninguna temporada candidata: " + " | ".join(errors))


# ---------------------------------------------------------------- alineación
@dataclass
class Transform:
    A: np.ndarray  # (2,2)
    t: np.ndarray  # (2,)

    def apply(self, p: np.ndarray) -> np.ndarray:
        return p @ self.A.T + self.t


def _umeyama(x: np.ndarray, y: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
    mx, my = x.mean(0), y.mean(0)
    xc, yc = x - mx, y - my
    cov = yc.T @ xc / len(x)
    u, s, vt = np.linalg.svd(cov)
    d = np.diag([1.0, np.sign(np.linalg.det(u) * np.linalg.det(vt)) or 1.0])
    r = u @ d @ vt
    scale = np.trace(np.diag(s) @ d) / ((xc ** 2).sum() / len(x))
    return scale, r, my - scale * r @ mx


def align_2d(src_xy: np.ndarray, dst_xy: np.ndarray) -> tuple[Transform, float]:
    """Similitud (con posible reflexión) src->dst sin correspondencias: búsqueda gruesa + ICP."""
    tree = cKDTree(dst_xy)
    scale0 = polyline_len(dst_xy) / polyline_len(src_xy)
    ms, md = src_xy.mean(0), dst_xy.mean(0)
    sub = src_xy[:: max(1, len(src_xy) // 400)]
    best = (np.inf, None)
    for refl in (1.0, -1.0):
        f = np.diag([refl, 1.0])
        for ang in range(0, 359, 2):
            a = np.deg2rad(ang)
            r = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
            A = scale0 * r @ f
            tr = Transform(A, md - A @ ms)
            score = tree.query(tr.apply(sub))[0].mean()
            if score < best[0]:
                best = (score, tr)
    tr = best[1]
    for _ in range(30):
        cur = tr.apply(src_xy)
        idx = tree.query(cur)[1]
        sc, r, t = _umeyama(cur, dst_xy[idx])
        M = sc * r
        tr = Transform(M @ tr.A, M @ tr.t + t)
    resid = float(tree.query(tr.apply(src_xy))[0].mean())
    return tr, resid


def orient_and_start(cl: Centerline, raw: np.ndarray, ff: FastF1Data, tr: Transform,
                     spec: TrackSpec, shift_m: float = 0.0):
    """Fija sentido y meta. Devuelve (cl, transform con origen en la meta, i0)."""
    ffa = tr.apply(ff.xyz[:, :2])
    tree = cKDTree(cl.xy)
    idx = tree.query(ffa)[1]
    d = np.diff(idx)
    d = (d + cl.n // 2) % cl.n - cl.n // 2
    if d.sum() < 0:
        print("Sentido: FastF1 recorre la línea central en s decreciente; se invierte")
        cl = resample_closed(raw[::-1, :2], raw[::-1][:, [3, 2]])
    i0 = int(tree.query(ffa[0])[1]) if cl is not None else 0
    tree = cKDTree(cl.xy)
    i0 = int(tree.query(ffa[0])[1])
    i0 = (i0 + int(round(shift_m / cl.step_m))) % cl.n
    origin = cl.xy[i0].copy()
    cl = Centerline(np.roll(cl.xy, -i0, axis=0) - origin, np.roll(cl.wr, -i0), np.roll(cl.wl, -i0),
                    np.roll(cl.tan, -i0, axis=0), np.roll(cl.k, -i0), cl.step_m, cl.length)
    area = signed_area(cl.xy)
    direction = "ccw" if area > 0 else "cw"
    if direction != spec.direction:
        die(f"sentido {direction} no coincide con {spec.direction} (área {area:.0f})")
    return cl, Transform(tr.A, tr.t - origin), direction, area


# ---------------------------------------------------------------- elevación
def transfer_elevation(cl: Centerline, ff_xy_aligned: np.ndarray, ff_z: np.ndarray) -> np.ndarray:
    tree = cKDTree(ff_xy_aligned)
    _, idx = tree.query(cl.xy, k=3)
    y = ff_z[idx].mean(axis=1)
    y = savgol_filter(y, 31, 3, mode="wrap")
    return y - y[0]


def derive(cl: Centerline, y: np.ndarray) -> dict:
    tx, tz = cl.tan[:, 0], -cl.tan[:, 1]
    pitch = (np.roll(y, -1) - np.roll(y, 1)) / (2 * cl.step_m)
    return {"nx": tz, "nz": -tx, "k": cl.k, "pitch": pitch, "bank": np.zeros(cl.n)}


# ---------------------------------------------------------------- metadatos
def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Tramos contiguos True (inclusive, con envoltura: end puede ser < start)."""
    n = len(mask)
    if mask.all():
        return [(0, n - 1)]
    if not mask.any():
        return []
    start = int(np.argmin(mask))  # primer False
    m = np.roll(mask, -start)
    out, i = [], 0
    while i < n:
        if m[i]:
            j = i
            while j + 1 < n and m[j + 1]:
                j += 1
            out.append(((i + start) % n, (j + start) % n))
            i = j + 1
        else:
            i += 1
    return out


def _merge_gaps(mask: np.ndarray, gap: int) -> np.ndarray:
    out = mask.copy()
    n = len(mask)
    false_runs = _runs(~mask)
    for a, b in false_runs:
        ln = (b - a) % n + 1
        if ln <= gap:
            for i in range(ln):
                out[(a + i) % n] = True
    return out


def _merge_kerbs(items: list[dict], L: float, gap: float = 15.0) -> list[dict]:
    out = []
    for side in ("left", "right"):
        its = sorted((dict(i) for i in items if i["side"] == side), key=lambda d: d["s0"])
        merged = []
        for it in its:
            if merged and it["s0"] - merged[-1]["s1"] < gap:
                merged[-1]["s1"] = max(merged[-1]["s1"], it["s1"])
            else:
                merged.append(it)
        if len(merged) > 1 and merged[0]["s0"] + L - merged[-1]["s1"] < gap:
            last = merged.pop()
            merged[0]["s0"] = last["s0"] - L
        out += merged
    for o in out:
        o["s0"] %= L
        o["s1"] %= L
    return sorted(out, key=lambda d: (d["s0"], d["side"]))


def propose_metadata(cl: Centerline, ff: FastF1Data, tr: Transform, spec: TrackSpec) -> dict:
    n, st, L = cl.n, cl.step_m, cl.length
    s = np.arange(n) * st
    sectors = [round(ff.sector_fracs[0] * L, 3), round(ff.sector_fracs[1] * L, 3)]
    if not (0 < sectors[0] < sectors[1] < L and min(sectors[0], sectors[1] - sectors[0],
                                                    L - sectors[1]) >= 0.15 * L):
        print("AVISO: sectores de FastF1 inválidos; se usan L/3 y 2L/3")
        sectors = [round(L / 3, 3), round(2 * L / 3, 3)]
    # curvas
    corners = []
    if ff.corners:
        tree = cKDTree(cl.xy)
        seen = set()
        for num, x, y in sorted(ff.corners):
            if num in seen:
                continue
            seen.add(num)
            p = tr.apply(np.array([[x, y]]))
            i = int(tree.query(p)[1][0])
            corners.append({"n": num, "name": spec.corner_names.get(num, f"Curva {num}"),
                            "s": round(i * st, 3)})
        corners.sort(key=lambda c: c["n"])
    # rectas y DRS
    straight = _merge_gaps(np.abs(cl.k) < 1 / 500, int(30 / st))
    runs = [(a, b, ((b - a) % n + 1) * st) for a, b in _runs(straight)]
    runs.sort(key=lambda r: -r[2])
    drs = []
    for a, b, ln in runs[:2]:
        drs.append({"detect_s": round(((a * st) - 150) % L, 3),
                    "start_s": round(((a * st) + 80) % L, 3),
                    "end_s": round((b * st) % L, 3)})
    drs.sort(key=lambda z: z["start_s"])
    # pianos
    kerbs = []
    tight = _merge_gaps(np.abs(cl.k) > 1 / 150, 0)
    # separar por signo de k
    for sign in (1, -1):
        mask = tight & (np.sign(cl.k) == sign)
        side_in = "left" if sign > 0 else "right"
        side_out = "right" if sign > 0 else "left"
        for a, b in _runs(mask):
            a_s = a * st
            b_s = ((b - a) % n) * st + a_s
            s0 = a_s - 30
            if b_s - s0 > 400:
                s0 = b_s - 400
            kerbs.append({"s0": s0, "s1": b_s, "side": side_in})
            kerbs.append({"s0": b_s, "s1": b_s + 40, "side": side_out})
    kerbs = [k for k in kerbs if k["s1"] - k["s0"] >= 20]
    kerbs = _merge_kerbs(kerbs, L)
    kerbs = [{"s0": round(k["s0"], 3), "s1": round(k["s1"], 3), "side": k["side"]} for k in kerbs]
    return {"start_s": 0.0, "sectors_s": sectors, "drs_zones": drs, "corners": corners,
            "kerbs": kerbs, "runoff_m": 18.0, "sources": {}}


def _overlap(k: dict, r: dict, L: float) -> bool:
    def segs(a, b):
        return [(a, b)] if a <= b else [(a, L), (0.0, b)]
    return any(x0 < y1 and y0 < x1 for x0, x1 in segs(k["s0"], k["s1"])
               for y0, y1 in segs(r["s0"], r["s1"]))


def apply_overrides(meta: dict, path: Path, L: float) -> dict:
    if not path.exists():
        return meta
    ov = json.loads(path.read_text(encoding="utf-8"))
    if "sectors_s" in ov:
        meta["sectors_s"] = list(ov["sectors_s"]); meta["sources"]["sectors_s"] = "override"
    if "drs_zones" in ov:
        meta["drs_zones"] = ov["drs_zones"]; meta["sources"]["drs_zones"] = "override"
    for n, name in ov.get("corner_names", {}).items():
        for c in meta["corners"]:
            if c["n"] == int(n):
                c["name"] = name
        meta["sources"]["corner_names"] = "override"
    for r in ov.get("kerbs_remove", []):
        meta["kerbs"] = [k for k in meta["kerbs"] if not _overlap(k, r, L)]
        meta["sources"]["kerbs_remove"] = "override"
    if ov.get("kerbs_add"):
        meta["kerbs"] += ov["kerbs_add"]; meta["sources"]["kerbs_add"] = "override"
    return meta


# ---------------------------------------------------------------- salida
def _r(a, d) -> list:
    return [float(v) + 0.0 for v in np.round(a, d)]


def write_json(path: Path, spec: TrackSpec, cl: Centerline, y: np.ndarray, d: dict, meta: dict,
               direction: str) -> None:
    n = cl.n
    samples = {
        "s": _r(np.arange(n) * cl.step_m, 3), "x": _r(cl.xy[:, 0], 3), "y": _r(y, 3),
        "z": _r(-cl.xy[:, 1], 3), "wl": _r(cl.wl, 3), "wr": _r(cl.wr, 3),
        "nx": _r(d["nx"], 6), "nz": _r(d["nz"], 6), "k": _r(d["k"], 6),
        "pitch": _r(d["pitch"], 6), "bank": _r(d["bank"], 6),
    }
    doc = {
        "id": spec.id, "name": spec.name, "length_m": round(n * cl.step_m, 3),
        "direction": direction, "step_m": round(cl.step_m, 8), "samples": samples,
        "start_s": meta["start_s"], "sectors_s": meta["sectors_s"], "drs_zones": meta["drs_zones"],
        "corners": meta["corners"], "kerbs": meta["kerbs"], "runoff_m": meta["runoff_m"],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _plot_common():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    return plt


def plot_plan(path: Path, cl: Centerline, meta: dict, direction: str) -> None:
    plt = _plot_common()
    fig, ax = plt.subplots(figsize=(16, 12), dpi=100)
    st, n, L = cl.step_m, cl.n, cl.length
    nrm = np.stack([-cl.tan[:, 1], cl.tan[:, 0]], axis=1)
    left = cl.xy + nrm * cl.wl[:, None]
    right = cl.xy - nrm * cl.wr[:, None]
    ax.fill(np.concatenate([left[:, 0], right[::-1, 0]]), np.concatenate([left[:, 1], right[::-1, 1]]),
            color="#d8d8d8", zorder=1)
    ax.plot(*np.vstack([left, left[:1]]).T, color="k", lw=0.8)
    ax.plot(*np.vstack([right, right[:1]]).T, color="k", lw=0.8)

    def seg(s0, s1):
        i0, i1 = int(round(s0 / st)) % n, int(round(s1 / st)) % n
        idx = np.arange(i0, i1 + 1) if i0 <= i1 else np.r_[np.arange(i0, n), np.arange(0, i1 + 1)]
        return idx
    for z in meta["drs_zones"]:
        idx = seg(z["start_s"], z["end_s"])
        ax.plot(*cl.xy[idx].T, color="limegreen", lw=6, alpha=0.7, zorder=2, label="DRS")
    for kb in meta["kerbs"]:
        idx = seg(kb["s0"], kb["s1"])
        pts = left[idx] if kb["side"] == "left" else right[idx]
        ax.plot(*pts.T, color="red", lw=3, zorder=3, label="Pianos")
    for c in meta["corners"]:
        i = int(round(c["s"] / st)) % n
        p = cl.xy[i] + nrm[i] * (cl.wl[i] + 25) * (1 if True else -1)
        ax.annotate(str(c["n"]), p, ha="center", va="center", fontsize=11, color="navy", weight="bold")
    for j, sx in enumerate(meta["sectors_s"], start=1):
        i = int(round(sx / st)) % n
        ax.plot(*cl.xy[i], "o", color="orange", ms=10, zorder=4)
        ax.annotate(f"S{j}|S{j+1}", cl.xy[i], xytext=(8, 8), textcoords="offset points", color="darkorange")
    ax.plot(0, 0, "s", color="blue", ms=12, zorder=5)
    ax.annotate("META", (0, 0), xytext=(10, -14), textcoords="offset points", color="blue", weight="bold")
    a = cl.xy[10]
    ax.annotate("", cl.xy[25], xytext=a, arrowprops=dict(arrowstyle="-|>", lw=3, color="blue"))
    ax.set_aspect("equal")
    ax.set_title(f"{direction.upper()}  L={L:.0f} m — planta (x, -z)")
    h, lb = ax.get_legend_handles_labels()
    by = dict(zip(lb, h))
    ax.legend(by.values(), by.keys())
    fig.savefig(path)
    plt.close(fig)


def plot_elev(path: Path, cl: Centerline, y: np.ndarray, meta: dict) -> None:
    plt = _plot_common()
    fig, ax = plt.subplots(figsize=(16, 12), dpi=100)
    s = np.arange(cl.n) * cl.step_m
    ax.plot(s, y, color="k")
    for c in meta["corners"]:
        ax.axvline(c["s"], color="steelblue", lw=0.8, alpha=0.7)
        ax.text(c["s"], y.max() + 1, str(c["n"]), ha="center", color="steelblue")
    for sx in meta["sectors_s"]:
        ax.axvline(sx, color="orange", ls="--", lw=2)
    ax.set_xlabel("s (m)"); ax.set_ylabel("elevación y (m)"); ax.grid(alpha=0.3)
    ax.set_title("Perfil de elevación (corchetes: curvas azules, sectores naranja)")
    fig.savefig(path)
    plt.close(fig)


# ---------------------------------------------------------------- principal
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--track", required=True)
    ap.add_argument("--debug-step", choices=STEPS)
    args = ap.parse_args()
    if args.track not in TRACKS:
        die(f"circuito desconocido '{args.track}'. Soportados: {', '.join(sorted(TRACKS))}")
    spec = TRACKS[args.track]
    ov_path = ROOT / "tools" / "track" / "overrides" / f"{spec.id}.json"
    shift = 0.0
    if ov_path.exists():
        shift = float(json.loads(ov_path.read_text(encoding="utf-8")).get("start_shift_m", 0.0))

    raw = load_centerline(spec)
    ff = None
    if raw is None:
        print("AVISO: sin CSV de TUMFTM; se usa el trazado de FastF1 con ancho 14 m (fidelidad reducida)")
        ff = load_fastf1(spec)
        xy = ff.xyz[:, :2]
        raw = np.column_stack([xy, np.full(len(xy), 7.0), np.full(len(xy), 7.0)])
    cl = resample_closed(raw[:, :2], raw[:, 2:4])
    if args.debug_step == "centerline":
        print(f"N={cl.n} step_m={cl.step_m:.5f} longitud={cl.length:.1f} m "
              f"max|k|={np.abs(cl.k).max():.4f}")
        return

    if ff is None:
        ff = load_fastf1(spec)
    if args.debug_step == "fastf1":
        z = ff.xyz[:, 2]
        print(f"año={ff.year} vueltas={ff.n_laps} longitud_vuelta={ff.lap_len_m:.1f} m "
              f"Z={z.min():.1f}..{z.max():.1f} m rango={z.max()-z.min():.1f} m "
              f"curvas={len(ff.corners)} sectores_frac={ff.sector_fracs}")
        return

    tr, resid = align_2d(ff.xyz[:, :2], cl.xy)
    cl, tr, direction, area = orient_and_start(cl, raw, ff, tr, spec, shift)
    if args.debug_step == "align":
        print(f"residuo medio={resid:.2f} m direction={direction} área={area:.0f} m²")
        return

    ffa = tr.apply(ff.xyz[:, :2])
    y = transfer_elevation(cl, ffa, ff.xyz[:, 2])
    d = derive(cl, y)
    if args.debug_step == "elev":
        print(f"max(y)-min(y)={y.max()-y.min():.2f} m |y[N-1]-y[0]|={abs(y[-1]-y[0]):.3f} m "
              f"max|pitch|={np.abs(d['pitch']).max():.4f}")
        return

    meta = propose_metadata(cl, ff, tr, spec)
    meta = apply_overrides(meta, ov_path, cl.length)
    if args.debug_step == "meta":
        print(f"sectores={meta['sectors_s']} drs={meta['drs_zones']}")
        print(f"curvas={len(meta['corners'])} {[(c['n'], c['name']) for c in meta['corners']]}")
        print(f"pianos={len(meta['kerbs'])} {meta['kerbs']}")
        return

    out_json = ROOT / "public" / "track" / f"{spec.id}.json"
    out_dir = ROOT / "out"
    out_dir.mkdir(exist_ok=True)
    write_json(out_json, spec, cl, y, d, meta, direction)
    plot_plan(out_dir / f"{spec.id}_plan.png", cl, meta, direction)
    plot_elev(out_dir / f"{spec.id}_elev.png", cl, y, meta)
    src = ", ".join(f"{k}={v}" for k, v in meta["sources"].items()) or "ninguno"
    print(f"Circuito: {spec.id}  FastF1 año {ff.year} ({ff.n_laps} vueltas)")
    print(f"Longitud: {cl.length:.1f} m  muestras: {cl.n}  sentido: {direction}")
    print(f"Residuo de alineación: {resid:.2f} m  elevación: {y.min():.1f}..{y.max():.1f} m")
    print(f"Curvas: {len(meta['corners'])}  pianos: {len(meta['kerbs'])}  zonas DRS: "
          f"{len(meta['drs_zones'])}  overrides: {src}")
    print(f"Escrito: {out_json}")


if __name__ == "__main__":
    main()
