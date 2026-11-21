"""DEM Terrarium (teselas PNG) con Pillow y muestreo bilineal en metros locales (b12 D2)."""
from __future__ import annotations

import io
import math
import sys
from pathlib import Path

import numpy as np
import requests
from PIL import Image
from scipy.ndimage import median_filter

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.track.osm import R_EARTH, UA  # noqa: E402

URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
CACHE = Path(__file__).resolve().parent / ".cache"


def decode_terrarium(rgb: np.ndarray) -> np.ndarray:
    a = rgb.astype(np.float64)
    return a[..., 0] * 256.0 + a[..., 1] + a[..., 2] / 256.0 - 32768.0


def _tile_xy(lat: float, lon: float, z: int) -> tuple[float, float]:
    n = 2.0 ** z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def _tile_png(z: int, x: int, y: int, cache_dir: Path) -> np.ndarray:
    p = cache_dir / f"{z}_{x}_{y}.png"
    if p.exists():
        raw = p.read_bytes()
    else:
        try:
            r = requests.get(URL.format(z=z, x=x, y=y), headers={"User-Agent": UA}, timeout=60)
            r.raise_for_status()
        except requests.RequestException as e:
            raise RuntimeError(f"Sin red ni caché para la tesela DEM {z}/{x}/{y} ({e})") from e
        raw = r.content
        cache_dir.mkdir(parents=True, exist_ok=True)
        p.write_bytes(raw)
    return np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"))


class Dem:
    """Mosaico de alturas en un grid lat/lon (px de tesela) con muestreo en metros locales."""

    def __init__(self, h: np.ndarray, px0: float, py0: float, zoom: int, lat0: float, lon0: float):
        self.h, self.px0, self.py0, self.zoom, self.lat0, self.lon0 = h, px0, py0, zoom, lat0, lon0

    def sample_latlon(self, lat, lon) -> np.ndarray:
        lat, lon = np.asarray(lat, float), np.asarray(lon, float)
        n = 2.0 ** self.zoom
        fx = ((lon + 180.0) / 360.0 * n) * 256.0 - self.px0
        fy = ((1.0 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2.0 * n) * 256.0 - self.py0
        return _bilinear(self.h, fx - 0.5, fy - 0.5)

    def sample(self, x, z) -> np.ndarray:
        """x, z en metros locales (equirectangular centrada en lat0/lon0)."""
        x, z = np.asarray(x, float), np.asarray(z, float)
        lat = self.lat0 - np.degrees(z / R_EARTH)
        lon = self.lon0 + np.degrees(x / (R_EARTH * math.cos(math.radians(self.lat0))))
        return self.sample_latlon(lat, lon)


def _bilinear(h: np.ndarray, fx: np.ndarray, fy: np.ndarray) -> np.ndarray:
    ny, nx = h.shape
    fx = np.clip(fx, 0, nx - 1.0001)
    fy = np.clip(fy, 0, ny - 1.0001)
    x0, y0 = np.floor(fx).astype(int), np.floor(fy).astype(int)
    tx, ty = fx - x0, fy - y0
    return (h[y0, x0] * (1 - tx) * (1 - ty) + h[y0, x0 + 1] * tx * (1 - ty)
            + h[y0 + 1, x0] * (1 - tx) * ty + h[y0 + 1, x0 + 1] * tx * ty)


def fetch_dem(bbox, zoom: int = 14, cache_dir: Path | str = CACHE / "terrain",
              lat0: float | None = None, lon0: float | None = None) -> Dem:
    """bbox = (lat_min, lon_min, lat_max, lon_max). Devuelve un Dem muestreable con sample(x, z)."""
    cache_dir = Path(cache_dir)
    la0, lo0, la1, lo1 = bbox
    xa, ya = _tile_xy(la1, lo0, zoom)  # esquina NO
    xb, yb = _tile_xy(la0, lo1, zoom)  # esquina SE
    tx0, tx1, ty0, ty1 = int(xa), int(xb), int(ya), int(yb)
    rows = []
    for ty in range(ty0, ty1 + 1):
        rows.append(np.concatenate(
            [decode_terrarium(_tile_png(zoom, tx, ty, cache_dir)) for tx in range(tx0, tx1 + 1)], axis=1))
    h = np.concatenate(rows, axis=0)
    med = median_filter(h, size=5, mode="nearest")  # píxeles espurios de Terrarium (picos aislados)
    bad = np.abs(h - med) > 50.0
    h = np.where(bad, med, h)
    return Dem(h, tx0 * 256.0, ty0 * 256.0, zoom,
               (la0 + la1) / 2 if lat0 is None else lat0, (lo0 + lo1) / 2 if lon0 is None else lon0)


def _selftest() -> None:
    px = np.array([[[128, 0, 0], [128, 1, 128], [129, 0, 0]]], np.uint8)
    h = decode_terrarium(px)[0]
    assert h[0] == 0.0, h
    assert abs(h[1] - 1.5) < 1e-9, h
    assert h[2] == 256.0, h
    grid = np.array([[0.0, 10.0], [20.0, 30.0]])
    assert abs(float(_bilinear(grid, np.array(0.5), np.array(0.5))) - 15.0) < 1e-9
    d = Dem(np.tile(np.linspace(0, 100, 512), (512, 1)), 0.0, 0.0, 1, 0.0, 0.0)
    assert d.sample(0.0, 0.0).shape == ()
    print("terrain selftest OK")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
