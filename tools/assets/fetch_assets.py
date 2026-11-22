"""Descarga los assets CC0 de Poly Haven a public/assets/<id>/ y escribe manifest.json (design D7)."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "assets"
API = "https://api.polyhaven.com/files/"
HEADERS = {"User-Agent": "f1-game-asset-fetch"}
MAX_BYTES = 20 * 1024 * 1024

# (id, resolución, tipo) exactamente como la tabla D7
ASSETS = [
    ("asphalt_track", "2k", "texture"),
    ("asphalt_pit_lane", "1k", "texture"),
    ("leafy_grass", "1k", "texture"),
    ("gravel_floor", "1k", "texture"),
    ("brushed_concrete", "1k", "texture"),
    ("kloofendal_48d_partly_cloudy_puresky", "2k", "hdri"),
    ("qwantani_night_puresky", "1k", "hdri"),
    ("coast_sand_01", "1k", "texture"),
]
MAPS = (("Diffuse", "diff"), ("nor_gl", "nor_gl"), ("Rough", "rough"))


def plan() -> list[dict]:
    """Lista de archivos a descargar: id, mapa, url, tamaño, md5, ruta local."""
    files = []
    for aid, res, kind in ASSETS:
        r = requests.get(API + aid, headers=HEADERS, timeout=30)
        r.raise_for_status()
        j = r.json()
        picks = ([(m, j[m][res]["jpg"]) for m, _ in MAPS] if kind == "texture"
                 else [("hdri", j["hdri"][res]["hdr"])])
        for name, info in picks:
            fn = info["url"].rsplit("/", 1)[1]
            files.append({"id": aid, "res": res, "map": name, "url": info["url"], "size": info["size"],
                          "md5": info["md5"], "path": OUT / aid / fn, "kind": kind})
    return files


def md5(p: Path) -> str:
    h = hashlib.md5()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


QUALITY = {"Diffuse": 85, "Rough": 85, "nor_gl": 92}  # recompresión con Pillow, misma resolución


def recompress(src: Path, dst: Path, q: int) -> None:
    from PIL import Image
    with Image.open(src) as im:
        im.load()
        im.save(dst, "JPEG", quality=q, optimize=True)


def main() -> int:
    files = plan()
    mpath = OUT / "manifest.json"
    prev = {}
    if mpath.exists():
        for a in json.loads(mpath.read_text(encoding="utf-8")).get("assets", []):
            for f in a["files"]:
                prev[f["path"]] = f.get("source_md5")
    done = skipped = 0
    for f in files:
        p = f["path"]
        rel = f"{f['id']}/{p.name}"
        if p.exists() and prev.get(rel) == f["md5"]:
            skipped += 1
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".part")
        with requests.get(f["url"], headers=HEADERS, stream=True, timeout=60) as r:
            r.raise_for_status()
            with tmp.open("wb") as o:
                for chunk in r.iter_content(1 << 20):
                    o.write(chunk)
        if md5(tmp) != f["md5"]:
            tmp.unlink()
            print(f"ERROR: md5 distinto en {p.name}", file=sys.stderr)
            return 1
        if f["kind"] == "texture":
            out = p.with_suffix(".tmp.jpg")
            recompress(tmp, out, QUALITY[f["map"]])
            tmp.unlink()
            out.replace(p)
        else:
            tmp.replace(p)
        done += 1
    total = 0
    entries = {}
    for f in files:
        size = f["path"].stat().st_size
        total += size
        print(f"{size / 1e6:6.2f} MB  {f['id']}/{f['path'].name}")
        e = entries.setdefault(f["id"], {"id": f["id"], "license": "CC0", "res": f["res"],
                                         "source": f"https://polyhaven.com/a/{f['id']}", "files": []})
        ent = {"map": f["map"], "path": f"{f['id']}/{f['path'].name}", "url": f["url"], "bytes": size,
               "source_md5": f["md5"], "recompressed": f["kind"] == "texture"}
        if f["kind"] == "texture":
            ent["jpeg_quality"] = QUALITY[f["map"]]
        e["files"].append(ent)
    OUT.mkdir(parents=True, exist_ok=True)
    mpath.write_text(json.dumps({"provider": "Poly Haven", "assets": list(entries.values())}, indent=2,
                                ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Descargados: {done}  ya presentes: {skipped}  Total: {total / 1e6:.2f} MB")
    if total > MAX_BYTES:
        print("ERROR: el total supera 20 MB", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
