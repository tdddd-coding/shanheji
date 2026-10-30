# -*- coding: utf-8 -*-
"""下载并采样 Mapzen Terrarium 高程瓦片（公开 SRTM/GMTED 数据）。

生成 data/dem_east_asia.npz（1440×1120，米）与 data/dem_z6.png 供离线重建。
"""
from __future__ import annotations

import io
import math
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
TILE_DIR = DATA / "dem_tiles" / "z6"
TILE_DIR.mkdir(parents=True, exist_ok=True)

Z = 6
N = 2 ** Z
X0, X1 = 43, 57
Y0, Y1 = 19, 31
W, H = 1440, 1120
LON0, LON1 = 65.0, 145.0
LAT0, LAT1 = 5.0, 58.0
BASE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium"


def fetch_tile(x, y):
    path = TILE_DIR / f"{x}_{y}.png"
    if path.exists() and path.stat().st_size > 100:
        return x, y, True
    url = f"{BASE}/{Z}/{x}/{y}.png"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=45) as r:
                data = r.read()
            path.write_bytes(data)
            return x, y, True
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError):
            if attempt == 2:
                # 海域瓦片通常仍存在；失败时以 0 高程占位
                try:
                    Image.new("RGB", (256, 256), (0, 0, 0)).save(path)
                except Exception:
                    pass
                return x, y, False
    return x, y, False


def build_mosaic():
    tiles = [(x, y) for y in range(Y0, Y1 + 1) for x in range(X0, X1 + 1)]
    ok = 0
    with ThreadPoolExecutor(max_workers=12) as ex:
        futs = [ex.submit(fetch_tile, x, y) for x, y in tiles]
        for i, f in enumerate(as_completed(futs), 1):
            _, _, good = f.result()
            ok += int(good)
            if i % 30 == 0 or i == len(futs):
                print(f"  tiles {i}/{len(futs)}  ok={ok}", flush=True)

    cols, rows = X1 - X0 + 1, Y1 - Y0 + 1
    mosaic = np.zeros((rows * 256, cols * 256, 3), dtype=np.uint8)
    for y in range(Y0, Y1 + 1):
        for x in range(X0, X1 + 1):
            p = TILE_DIR / f"{x}_{y}.png"
            if not p.exists():
                continue
            im = Image.open(p).convert("RGB")
            if im.size != (256, 256):
                im = im.resize((256, 256))
            mosaic[(y - Y0) * 256:(y - Y0 + 1) * 256,
                   (x - X0) * 256:(x - X0 + 1) * 256] = np.asarray(im)
    Image.fromarray(mosaic).save(DATA / "dem_z6.png")
    print("mosaic", mosaic.shape)
    return mosaic


def sample(mosaic):
    xs = (np.arange(W, dtype=np.float64) / (W - 1)) * (LON1 - LON0) + LON0
    lats = LAT1 - (np.arange(H, dtype=np.float64) / (H - 1)) * (LAT1 - LAT0)

    px = (xs + 180.0) / 360.0 * N * 256.0 - X0 * 256.0
    lat_rad = np.radians(lats)
    py = (1.0 - np.arcsinh(np.tan(lat_rad)) / math.pi) / 2.0 * N * 256.0 - Y0 * 256.0

    x0 = np.clip(np.floor(px).astype(int), 0, mosaic.shape[1] - 2)
    y0 = np.clip(np.floor(py).astype(int), 0, mosaic.shape[0] - 2)
    fx = np.clip(px - x0, 0, 1)[None, :]
    fy = np.clip(py - y0, 0, 1)[:, None]

    def sample_rgb(plane):
        a = plane[np.ix_(y0, x0)].astype(np.float64)
        b = plane[np.ix_(y0, x0 + 1)].astype(np.float64)
        c = plane[np.ix_(y0 + 1, x0)].astype(np.float64)
        d = plane[np.ix_(y0 + 1, x0 + 1)].astype(np.float64)
        top = a * (1 - fx) + b * fx
        bot = c * (1 - fx) + d * fx
        return top * (1 - fy) + bot * fy

    r = sample_rgb(mosaic[:, :, 0])
    g = sample_rgb(mosaic[:, :, 1])
    b = sample_rgb(mosaic[:, :, 2])
    elev = r * 256.0 + g + b / 256.0 - 32768.0
    return elev.astype(np.float32)


def main():
    print("downloading terrain tiles …")
    mosaic = build_mosaic()
    elev = sample(mosaic)
    print("elevation", float(elev.min()), float(elev.max()), float(elev.mean()))
    np.savez_compressed(DATA / "dem_east_asia.npz", elev=elev)
    prev = np.clip(elev / 9000.0 * 255, 0, 255).astype(np.uint8)
    Image.fromarray(prev).save(DATA / "dem_preview.png")
    print("saved data/dem_east_asia.npz and data/dem_preview.png")


if __name__ == "__main__":
    main()
