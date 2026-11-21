"""Descarga OSM (Overpass) con caché y proyección equirectangular local (b12 D2)."""
from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.track.tracks import TRACKS, WORLD_DEFAULTS, TrackSpec  # noqa: E402

OVERPASS = "https://overpass-api.de/api/interpreter"
UA = "f1-game-track-pipeline"
R_EARTH = 6371000.0
CACHE = Path(__file__).resolve().parent / ".cache"


def padded_bbox(spec: TrackSpec, margin_m: float | None = None) -> tuple[float, float, float, float]:
    if spec.bbox is None:
        raise ValueError(f"{spec.id}: sin bbox")
    m = WORLD_DEFAULTS["marginM"] if margin_m is None else margin_m
    la0, lo0, la1, lo1 = spec.bbox
    dlat = math.degrees(m / R_EARTH)
    dlon = math.degrees(m / (R_EARTH * math.cos(math.radians((la0 + la1) / 2))))
    return la0 - dlat, lo0 - dlon, la1 + dlat, lo1 + dlon


def project(lat: float, lon: float, lat0: float, lon0: float) -> tuple[float, float]:
    x = R_EARTH * math.radians(lon - lon0) * math.cos(math.radians(lat0))
    z = -R_EARTH * math.radians(lat - lat0)
    return x, z


def query_for(bbox) -> str:
    b = f"{bbox[0]:.6f},{bbox[1]:.6f},{bbox[2]:.6f},{bbox[3]:.6f}"
    return (
        "[out:json][timeout:90];("
        f'way["highway"="raceway"]({b});'
        f'way["building"]({b});'
        f'way["leisure"="stadium"]({b});'
        f'way["natural"~"^(water|wood)$"]({b});'
        f'way["water"]({b});'
        f'way["landuse"="forest"]({b});'
        f'relation["natural"~"^(water|wood)$"]({b});'
        f'relation["landuse"="forest"]({b});'
        f'relation["building"]({b});'
        ");out geom;"
    )


def fetch_osm(spec: TrackSpec, cache_dir: Path | str = CACHE / "osm") -> dict:
    cache_dir = Path(cache_dir)
    path = cache_dir / f"{spec.id}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    bbox = padded_bbox(spec)
    last = None
    for attempt in range(3):
        try:
            r = requests.post(OVERPASS, data={"data": query_for(bbox)}, headers={"User-Agent": UA}, timeout=120)
            if r.status_code == 200:
                data = r.json()
                cache_dir.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(data), encoding="utf-8")
                return data
            last = f"HTTP {r.status_code}"
        except (requests.RequestException, ValueError) as e:
            last = str(e)
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"Sin red ni caché para OSM de {spec.id} ({last})")


if __name__ == "__main__":
    sp = TRACKS[sys.argv[1] if len(sys.argv) > 1 else "interlagos"]
    d = fetch_osm(sp)
    n = sum(1 for e in d["elements"] if e.get("tags", {}).get("highway") == "raceway")
    print(f"elementos={len(d['elements'])} raceway={n}")
