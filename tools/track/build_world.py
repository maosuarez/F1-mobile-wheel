"""Entorno real de un circuito: OSM + DEM -> public/track/<id>.world.json (b12). Uso: build_world.py --track <id>"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.track.build_track import Transform, align_2d, die  # noqa: E402
from tools.track.osm import fetch_osm, padded_bbox, project  # noqa: E402
from tools.track.terrain import fetch_dem  # noqa: E402
from tools.track.tracks import TRACKS, WORLD_DEFAULTS as WD, TrackSpec  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ATTRIB = "© OpenStreetMap contributors (ODbL)"
DEFAULT_H = {"pit": 9.0, "grandstand": 14.0, "tower": 25.0, "generic": 7.0}
PIT_NEAR_M = 60.0
MIN_GENERIC_AREA = 40.0
PITLANE_W = 10.0


# ---------------------------------------------------------------- geometría
def resample(poly: np.ndarray, step: float = 2.0, closed: bool = False) -> np.ndarray:
    p = np.vstack([poly, poly[:1]]) if closed else poly
    seg = np.hypot(*np.diff(p, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    n = max(int(s[-1] / step), 2)
    t = np.linspace(0, s[-1], n, endpoint=not closed)
    return np.column_stack([np.interp(t, s, p[:, 0]), np.interp(t, s, p[:, 1])])


def signed_area(r: np.ndarray) -> float:
    x, y = r[:, 0], r[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def simplify(pts: np.ndarray, tol: float) -> np.ndarray:
    """Douglas-Peucker para un anillo (sin repetir el primer punto)."""
    if len(pts) <= 4 or tol <= 0:
        return pts
    p = np.vstack([pts, pts[:1]])
    keep = np.zeros(len(p), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(p) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        d = p[b] - p[a]
        n = np.hypot(*d)
        seg = p[a + 1:b]
        dist = np.hypot(*(seg - p[a]).T) if n == 0 else np.abs(d[0] * (seg[:, 1] - p[a][1]) - d[1] * (seg[:, 0] - p[a][0])) / n
        k = int(dist.argmax())
        if dist[k] > tol:
            keep[a + 1 + k] = True
            stack += [(a, a + 1 + k), (a + 1 + k, b)]
    out = p[keep][:-1]
    return out if len(out) >= 3 else pts


def clip_rect(ring: np.ndarray, x0, z0, x1, z1) -> np.ndarray:
    """Sutherland-Hodgman contra un rectángulo."""
    pts = [tuple(p) for p in ring]
    for ax, val, keep_gt in ((0, x0, True), (0, x1, False), (1, z0, True), (1, z1, False)):
        if not pts:
            break
        out = []
        inside = (lambda q: q[ax] >= val) if keep_gt else (lambda q: q[ax] <= val)
        for i, cur in enumerate(pts):
            prv = pts[i - 1]
            if inside(cur) != inside(prv):
                t = (val - prv[ax]) / (cur[ax] - prv[ax])
                out.append((prv[0] + t * (cur[0] - prv[0]), prv[1] + t * (cur[1] - prv[1])))
            if inside(cur):
                out.append(cur)
        pts = out
    return np.array(pts) if len(pts) >= 3 else np.zeros((0, 2))


def join_rings(segs: list[np.ndarray]) -> list[np.ndarray]:
    """Une tramos de un multipolígono por extremos coincidentes; devuelve anillos cerrados."""
    rings, open_ = [], [s for s in segs if len(s) >= 2]
    while open_:
        cur = open_.pop(0)
        while not np.allclose(cur[0], cur[-1]):
            for i, o in enumerate(open_):
                if np.allclose(cur[-1], o[0]):
                    cur = np.vstack([cur, o[1:]])
                elif np.allclose(cur[-1], o[-1]):
                    cur = np.vstack([cur, o[::-1][1:]])
                else:
                    continue
                open_.pop(i)
                break
            else:
                break
        if len(cur) >= 4 and np.allclose(cur[0], cur[-1]):
            rings.append(cur[:-1])
    return rings


# ---------------------------------------------------------------- OSM
def load_track(spec: TrackSpec) -> dict:
    p = ROOT / "public" / "track" / f"{spec.id}.json"
    if not p.exists():
        die(f"no existe {p}; ejecuta build_track.py primero")
    return json.loads(p.read_text(encoding="utf-8"))


def elem_rings(e: dict, ll) -> list[np.ndarray]:
    """Anillos cerrados (lat/lon proyectados con ll) de una vía o relación."""
    def pts(g):
        return np.array([ll(q["lat"], q["lon"]) for q in g])
    if e["type"] == "way":
        g = e.get("geometry") or []
        if len(g) >= 4 and g[0] == g[-1]:
            return [pts(g)[:-1]]
        return []
    segs = [pts(m["geometry"]) for m in e.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
    return join_rings(segs)


def raceway_pieces(osm: dict, ll) -> tuple[list[np.ndarray], np.ndarray | None]:
    pieces, pit = [], None
    for e in osm["elements"]:
        t = e.get("tags", {})
        if e["type"] != "way" or t.get("highway") != "raceway" or t.get("sport") != "motor" or len(e["geometry"]) < 2:
            continue
        g = np.array([ll(q["lat"], q["lon"]) for q in e["geometry"]])
        if t.get("service") == "pit_lane" or "pit" in t.get("name", "").lower():
            pit = g if pit is None or len(g) > len(pit) else pit
        else:
            pieces.append(g)
    return pieces, pit


def chain_circuit(pieces: list[np.ndarray]) -> np.ndarray:
    """Cadena los tramos raceway (sin duplicados) en una polilínea cerrada, tapando huecos en recta."""
    pieces = sorted(pieces, key=lambda g: -np.hypot(*np.diff(g, axis=0).T).sum())
    acc: list[np.ndarray] = []
    tree = None
    for g in pieces:
        d = resample(g, 2.0) if len(g) > 1 else g
        if tree is not None and (tree.query(d)[0] < 5.0).mean() > 0.5:
            continue
        acc.append(g)
        tree = cKDTree(np.vstack([resample(a, 2.0) for a in acc]))
    # unión por extremos coincidentes (<1 m) en ambos sentidos; tramos sin conexión exacta se descartan
    chain = acc.pop(0)
    for end in (1, 0):
        grew = True
        while grew:
            grew = False
            tip = chain[-1] if end else chain[0]
            for i, g in enumerate(acc):
                for rev in (False, True):
                    gg = g[::-1] if rev else g
                    pt = gg[0] if end else gg[-1]
                    if np.hypot(*(pt - tip)) < 1.0:
                        chain = np.vstack([chain, gg[1:]]) if end else np.vstack([gg[:-1], chain])
                        acc.pop(i)
                        grew = True
                        break
                if grew:
                    break
    if np.hypot(*(chain[0] - chain[-1])) < 1.0:
        chain = chain[:-1]
    return resample(chain, 2.0, closed=True)


# ---------------------------------------------------------------- contexto
def prepare(spec: TrackSpec, trk: dict | None = None) -> dict:
    """Carga OSM+DEM, alinea con la pista y calcula el offset de altura. Reutilizable por el validador."""
    trk = trk or load_track(spec)
    sm = {k: np.asarray(v, float) for k, v in trk["samples"].items()}
    cxz = np.column_stack([sm["x"], sm["z"]])
    la0, lo0, la1, lo1 = spec.bbox
    lat0, lon0 = (la0 + la1) / 2, (lo0 + lo1) / 2
    ll = lambda la, lo: project(la, lo, lat0, lon0)  # noqa: E731
    osm = fetch_osm(spec)
    pieces, pit = raceway_pieces(osm, ll)
    src = chain_circuit(pieces)
    dst = resample(cxz, 2.0, closed=True)
    tr, _ = align_2d(src, dst)
    al = tr.apply(src)
    d_fw = cKDTree(dst).query(al)[0]
    rms = float(np.sqrt((d_fw ** 2).mean()))
    dem = fetch_dem(padded_bbox(spec), WD["tileZoom"], lat0=lat0, lon0=lon0)
    inv = np.linalg.inv(tr.A)
    to_osm = lambda p: (np.asarray(p) - tr.t) @ inv.T  # noqa: E731
    h_dem = dem.sample(*to_osm(cxz).T)
    offset = float(np.median(sm["y"] - h_dem))
    return dict(trk=trk, sm=sm, cxz=cxz, ll=ll, osm=osm, pit=pit, tr=tr, rms=rms, n_src=len(src), dem=dem,
                to_osm=to_osm, offset=offset, tree=cKDTree(cxz), runoff=float(trk["runoff_m"]))


def zone_dist(ctx: dict, pts: np.ndarray) -> np.ndarray:
    """Distancia a la línea central menos (ancho del lado + runoff) en la muestra más cercana (>0 = fuera de muros)."""
    sm = ctx["sm"]
    dist, i = ctx["tree"].query(pts)
    d = (pts[:, 0] - sm["x"][i]) * sm["nx"][i] + (pts[:, 1] - sm["z"][i]) * sm["nz"][i]
    w = np.where(d >= 0, sm["wl"][i], sm["wr"][i]) + ctx["runoff"]
    return dist - w


def covering(ctx: dict, pts: np.ndarray, extra: float = 0.0) -> list[np.ndarray]:
    """Por punto, índices de muestras cuya zona de muros (+extra) lo contiene."""
    sm = ctx["sm"]
    rmax = float(max(sm["wl"].max(), sm["wr"].max()) + ctx["runoff"] + extra)
    out = []
    for p, cand in zip(pts, ctx["tree"].query_ball_point(pts, rmax)):
        c = np.asarray(cand, int)
        if len(c) == 0:
            out.append(c)
            continue
        dx, dz = p[0] - sm["x"][c], p[1] - sm["z"][c]
        d = dx * sm["nx"][c] + dz * sm["nz"][c]
        w = np.where(d >= 0, sm["wl"][c], sm["wr"][c]) + ctx["runoff"]
        out.append(c[np.hypot(dx, dz) - w <= extra])
    return out


def build_terrain(ctx: dict, margin: float) -> dict:
    sm, cell = ctx["sm"], WD["cellM"]
    x0 = math.floor((sm["x"].min() - margin) / cell) * cell
    z0 = math.floor((sm["z"].min() - margin) / cell) * cell
    nx = int(math.ceil((sm["x"].max() + margin - x0) / cell)) + 1
    nz = int(math.ceil((sm["z"].max() + margin - z0) / cell)) + 1
    gx, gz = np.meshgrid(x0 + np.arange(nx) * cell, z0 + np.arange(nz) * cell)
    pts = np.column_stack([gx.ravel(), gz.ravel()])
    zd, near = ctx["tree"].query(pts)[0], ctx["tree"].query(pts)[1]
    ed = zone_dist(ctx, pts)  # >0 fuera de muros
    h_dem = ctx["dem"].sample(*ctx["to_osm"](pts).T) + ctx["offset"]
    h_trk = sm["y"][near] - WD["terrainSinkM"]
    blend, flat = WD["blendM"], cell
    t = np.clip((ed - flat) / (blend - flat), 0, 1)
    w = t * t * (3 - 2 * t)
    # solapes: en la zona de muros (+cell) de varios tramos manda el más bajo
    for k, (c, c0) in enumerate(zip(covering(ctx, pts, flat), covering(ctx, pts, flat))):
        if len(c):
            ds = np.abs(c0 - near[k])
            ds = np.minimum(ds, len(sm["x"]) - ds) * float(ctx["trk"]["step_m"])
            other = c0[ds > 60.0]  # otro tramo (>60 m a lo largo de la pista) con la celda dentro de sus muros
            h_trk[k] = (min(sm["y"][near[k]], sm["y"][other].min()) if len(other) else sm["y"][near[k]]) - WD["terrainSinkM"]
            w[k] = 0.0
    h = h_trk * (1 - w) + h_dem * w
    return dict(x0=float(x0), z0=float(z0), cell=float(cell), nx=nx, nz=nz, h=np.round(h * 10).astype(int))


class Grid:
    def __init__(self, t: dict):
        self.t, self.hm = t, np.asarray(t["h"]).reshape(t["nz"], t["nx"]) / 10.0

    def at(self, pts: np.ndarray) -> np.ndarray:
        t = self.t
        fx = np.clip((pts[:, 0] - t["x0"]) / t["cell"], 0, t["nx"] - 1.0001)
        fz = np.clip((pts[:, 1] - t["z0"]) / t["cell"], 0, t["nz"] - 1.0001)
        i, j = fx.astype(int), fz.astype(int)
        a, b = fx - i, fz - j
        h = self.hm
        return h[j, i] * (1 - a) * (1 - b) + h[j, i + 1] * a * (1 - b) + h[j + 1, i] * (1 - a) * b + h[j + 1, i + 1] * a * b


# ---------------------------------------------------------------- clasificación
def parse_height(tags: dict, kind: str) -> float:
    h = tags.get("height", "").replace("m", "").strip()
    try:
        return float(h.replace(",", "."))
    except ValueError:
        pass
    try:
        return float(tags["building:levels"]) * 3.2
    except (KeyError, ValueError):
        return DEFAULT_H[kind]


def classify_buildings(ctx: dict, grid: Grid, ext: tuple) -> tuple[list, dict]:
    tr, pit_xz = ctx["tr"], None
    pit_pts = tr.apply(resample(ctx["pit"], 2.0)) if ctx["pit"] is not None else None
    pit_tree = cKDTree(pit_pts) if pit_pts is not None else None
    stats = {"descartado_zona": 0, "descartado_fuera": 0, "descartado_pequeño": 0}
    out = []
    for e in ctx["osm"]["elements"]:
        t = e.get("tags", {})
        if "building" not in t and t.get("leisure") != "stadium":
            continue
        if t.get("leisure") == "stadium" and "building" not in t:
            continue
        for ring in elem_rings(e, ctx["ll"]):
            r = tr.apply(ring)
            if signed_area(r) < 0:
                r = r[::-1]
            area = abs(signed_area(r))
            if area < 4.0:
                continue
            if r[:, 0].max() < ext[0] or r[:, 0].min() > ext[2] or r[:, 1].max() < ext[1] or r[:, 1].min() > ext[3]:
                stats["descartado_fuera"] += 1
                continue
            h0 = 0.0
            if t.get("building") == "grandstand" or t.get("leisure") == "stadium":
                kind = "grandstand"
            elif pit_tree is not None and pit_tree.query(r)[0].min() < PIT_NEAR_M:
                kind = "pit"
            else:
                kind = "generic"
            h0 = parse_height(t, kind)
            if kind == "generic" and h0 >= 25.0:
                kind = "tower"
            if kind == "generic" and area < MIN_GENERIC_AREA:
                stats["descartado_pequeño"] += 1
                continue
            if kind == "grandstand":
                for _ in range(6):
                    zd = zone_dist(ctx, r)
                    need = WD["grandstandClearM"] - zd.min()
                    if need <= 0:
                        break
                    k = int(zd.argmin())
                    dist, i = ctx["tree"].query(r[k])
                    sm = ctx["sm"]
                    n = np.array([sm["nx"][i], sm["nz"][i]])
                    sg = 1.0 if (r[k] - [sm["x"][i], sm["z"][i]]) @ n >= 0 else -1.0
                    r = r + sg * n * need
                    stats["gradas_trasladadas"] = stats.get("gradas_trasladadas", 0) + (1 if _ == 0 else 0)
            elif (zone_dist(ctx, r) < WD["clearM"]).any():
                stats["descartado_zona"] += 1
                continue
            out.append({"kind": kind, "h": round(h0, 1), "y": round(float(grid.at(r).min()), 1),
                        "ring": [round(float(v), 1) for v in r.ravel()]})
    return out, stats


def polygons(ctx: dict, ext: tuple, pred, tol: float = 2.0) -> list[np.ndarray]:
    out = []
    for e in ctx["osm"]["elements"]:
        if not pred(e.get("tags", {})):
            continue
        for ring in elem_rings(e, ctx["ll"]):
            r = clip_rect(ctx["tr"].apply(ring), *ext)
            if len(r) >= 3 and abs(signed_area(r)) >= 20.0:
                r = simplify(r, tol)
                out.append(r if signed_area(r) > 0 else r[::-1])
    return out


def pitlane(ctx: dict, grid: Grid | None = None) -> dict | None:
    if ctx["pit"] is None:
        return None
    p = ctx["tr"].apply(resample(ctx["pit"], 4.0))
    _, i = ctx["tree"].query(p)
    y = ctx["sm"]["y"][i]
    return {"pts": [round(float(v), 1) for q, yy in zip(p, y) for v in (q[0], yy, q[1])], "w": PITLANE_W}


# ---------------------------------------------------------------- PNG
def plot_world(path: Path, ctx: dict, world: dict) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Polygon

    t = world["terrain"]
    h = np.asarray(t["h"]).reshape(t["nz"], t["nx"]) / 10.0
    fig, ax = plt.subplots(figsize=(12, 12), dpi=110)
    ext = [t["x0"], t["x0"] + (t["nx"] - 1) * t["cell"], t["z0"] + (t["nz"] - 1) * t["cell"], t["z0"]]
    ax.imshow(h, extent=ext, cmap="Greys", alpha=0.35, origin="upper", zorder=0)
    ax.contour(np.linspace(ext[0], ext[1], t["nx"]), np.linspace(ext[3], ext[2], t["nz"]), h, levels=12, colors="#999", linewidths=0.4)
    cols = {"pit": "#e6192b", "grandstand": "#1e6bd6", "tower": "#e08a00", "generic": "#9a9a9a"}
    for f in world["forest"]:
        ax.add_patch(Polygon(np.array(f["ring"]).reshape(-1, 2), fc="#58a35f", ec="none", alpha=0.5, zorder=1))
    for w in world["water"]:
        ax.add_patch(Polygon(np.array(w["ring"]).reshape(-1, 2), fc="#3d8fd1", ec="none", zorder=2))
    sm = ctx["sm"]
    ax.plot(sm["x"], sm["z"], color="#222", lw=2.2, zorder=3)
    for side, col in (("wl", "#0a0"), ("wr", "#a0a")):
        i = np.arange(len(sm["x"]))
        sgn = 1 if side == "wl" else -1
        wall = sm[side] + ctx["runoff"]
        ax.plot(sm["x"] + sgn * sm["nx"] * wall, sm["z"] + sgn * sm["nz"] * wall, color=col, lw=0.5, zorder=3)
    for b in world["buildings"]:
        ax.add_patch(Polygon(np.array(b["ring"]).reshape(-1, 2), fc=cols[b["kind"]], ec="k", lw=0.3, zorder=4))
    if world["pitlane"]:
        p = np.array(world["pitlane"]["pts"]).reshape(-1, 3)
        ax.plot(p[:, 0], p[:, 2], color="#e6192b", lw=3, zorder=5)
    ax.set_aspect("equal")
    ax.set_title(f"{world['id']}: pista (negro), muros (verde/magenta), edificios por tipo, agua, bosque, boxes (rojo)")
    cnt = {k: sum(b["kind"] == k for b in world["buildings"]) for k in cols}
    ax.text(0.01, 0.01, "  ".join(f"{k}={v}" for k, v in cnt.items()), transform=ax.transAxes, fontsize=10,
            bbox=dict(fc="w", alpha=0.8))
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path)
    plt.close(fig)


# ---------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--track", required=True)
    a = ap.parse_args()
    spec = TRACKS.get(a.track)
    if spec is None or spec.bbox is None:
        die(f"circuito desconocido o sin bbox: {a.track}")
    try:
        ctx = prepare(spec)
    except RuntimeError as e:
        die(str(e), 3)
    print(f"Alineación OSM->pista: RMS={ctx['rms']:.2f} m (puntos={ctx['n_src']}), offset altura={ctx['offset']:.2f} m")
    if ctx["rms"] > WD["alignMaxRmsM"]:
        die(f"RMS de alineación {ctx['rms']:.2f} m > {WD['alignMaxRmsM']} m", 2)
    margin = WD["marginM"]
    terrain = build_terrain(ctx, margin)
    grid = Grid(terrain)
    ext = (terrain["x0"], terrain["z0"], terrain["x0"] + (terrain["nx"] - 1) * terrain["cell"],
           terrain["z0"] + (terrain["nz"] - 1) * terrain["cell"])
    blds, stats = classify_buildings(ctx, grid, ext)
    water_pred = lambda t: t.get("natural") == "water" or "water" in t  # noqa: E731
    forest_pred = lambda t: t.get("landuse") == "forest" or t.get("natural") == "wood"  # noqa: E731
    water = [{"ring": [round(float(v), 1) for v in r.ravel()], "y": round(float(grid.at(r).min()), 1)}
             for r in polygons(ctx, ext, water_pred)]
    forest = [{"ring": [round(float(v), 1) for v in r.ravel()]} for r in polygons(ctx, ext, forest_pred)]
    world = {
        "id": spec.id, "version": 1, "attribution": ATTRIB,
        "terrain": {**{k: terrain[k] for k in ("x0", "z0", "cell", "nx", "nz")}, "h": terrain["h"].tolist()},
        "buildings": blds, "water": water, "forest": forest, "pitlane": pitlane(ctx),
    }
    out = ROOT / "public" / "track" / f"{spec.id}.world.json"
    out.write_text(json.dumps(world, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    kinds = {k: sum(b["kind"] == k for b in blds) for k in ("pit", "grandstand", "tower", "generic")}
    print(f"{out.name}: {out.stat().st_size / 1e6:.3f} MB; edificios={kinds} agua={len(water)} bosque={len(forest)} "
          f"pitlane={'sí' if world['pitlane'] else 'no'} descartes={stats}")
    plot_world(ROOT / "out" / f"{spec.id}_world.png", ctx, world)
    print(f"out/{spec.id}_world.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
