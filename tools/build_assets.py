# -*- coding: utf-8 -*-
"""生成课件所需的地形贴图与地理数据。

用法：python tools/build_assets.py
产物：assets/terrain_height.png, terrain_color.png, terrain_normal.png,
      land_mask.png, geo.json, preview_territories.png
"""
from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import content  # noqa: E402

ASSETS = ROOT / "assets"
DATA = ROOT / "data"
ASSETS.mkdir(exist_ok=True)

# 地图范围：东亚
LON0, LON1 = 65.0, 145.0
LAT0, LAT1 = 5.0, 58.0
W, H = 1440, 1120
SS = 2  # 海岸线超采样

PLATEAUS = [
    # (points, amplitude, blur px)
    ([[78.5, 36.5], [79.0, 33.0], [82.0, 30.5], [88.0, 29.0], [94.0, 29.0],
      [98.0, 30.5], [100.0, 33.5], [98.0, 36.5], [92.0, 38.2], [84.0, 38.2]],
     0.36, 30),
    ([[97.0, 28.0], [99.0, 26.0], [102.0, 23.0], [105.0, 23.0], [106.0, 25.0],
      [104.0, 27.0], [101.0, 28.5]], 0.16, 16),
    ([[103.0, 38.5], [106.0, 39.0], [110.5, 38.2], [112.0, 36.0], [110.5, 34.0],
      [106.5, 34.2], [104.0, 35.5]], 0.085, 16),
    ([[100.0, 46.0], [108.0, 47.0], [116.0, 46.5], [120.0, 44.0], [118.0, 41.0],
      [110.0, 41.0], [104.0, 42.0]], 0.10, 18),
    ([[88.0, 49.0], [98.0, 51.0], [110.0, 50.0], [118.0, 48.0], [116.0, 44.0],
      [108.0, 43.0], [96.0, 45.0]], 0.105, 20),
    ([[102.5, 31.0], [106.0, 31.2], [108.0, 29.0], [106.0, 27.5], [103.0, 28.0]],
     -0.045, 14),
    ([[122.0, 47.0], [126.0, 48.0], [128.0, 45.0], [126.0, 43.0], [123.0, 44.0]],
     -0.03, 14),
]

RIDGES = [
    # (coords, amplitude, width in degrees, seed)
    ([[74.0, 36.0], [78.0, 33.0], [82.0, 30.2], [86.0, 28.5], [90.0, 28.0],
      [94.0, 29.0], [97.0, 30.0]], 0.72, 1.35, 11),        # 喜马拉雅
    ([[75.0, 37.0], [80.0, 36.5], [86.0, 36.3], [92.0, 36.8], [98.0, 37.5]],
     0.38, 1.0, 12),                                        # 昆仑
    ([[74.5, 39.0], [78.0, 39.5], [82.0, 39.0], [86.0, 38.5], [90.0, 38.0]],
     0.34, 0.9, 13),                                        # 喀喇昆仑/阿尔金
    ([[75.0, 42.0], [80.0, 42.5], [84.0, 43.0], [88.0, 43.0], [92.0, 44.0]],
     0.42, 1.1, 14),                                        # 天山
    ([[86.0, 48.0], [89.0, 48.5], [92.0, 49.0], [95.0, 50.0]], 0.22, 0.85, 15),  # 阿尔泰
    ([[95.0, 39.0], [98.0, 38.5], [101.0, 37.5]], 0.20, 0.75, 16),  # 祁连
    ([[98.0, 32.0], [99.0, 30.0], [100.0, 28.0], [101.0, 26.0], [102.0, 24.0]],
     0.38, 0.9, 17),                                        # 横断山
    ([[104.0, 34.0], [107.0, 33.8], [110.0, 33.6], [112.0, 33.5]], 0.28, 0.7, 18),  # 秦岭
    ([[113.0, 40.0], [113.5, 38.0], [114.0, 36.0]], 0.20, 0.6, 19),  # 太行
    ([[106.0, 41.0], [110.0, 41.5], [114.0, 41.0]], 0.14, 0.7, 20),  # 阴山
    ([[121.0, 52.0], [121.5, 49.0], [122.0, 46.0], [122.5, 43.0]], 0.13, 0.8, 21),  # 大兴安岭
    ([[126.0, 44.0], [128.0, 42.5], [129.0, 41.0]], 0.15, 0.7, 22),  # 长白
    ([[116.0, 28.0], [117.5, 26.5], [118.5, 25.0]], 0.18, 0.55, 23),  # 武夷
    ([[110.0, 25.0], [113.0, 24.7], [116.0, 24.5]], 0.14, 0.55, 24),  # 南岭
    ([[120.8, 25.0], [121.2, 23.5], [120.9, 22.3]], 0.36, 0.35, 25),  # 台湾山脉
    ([[137.5, 36.5], [138.0, 35.5], [137.0, 34.5]], 0.26, 0.5, 26),  # 日本
    ([[128.3, 38.0], [128.5, 36.0], [127.8, 35.0]], 0.10, 0.45, 27),  # 朝鲜半岛
    ([[74.0, 37.5], [75.0, 39.0], [76.0, 40.5]], 0.30, 0.6, 28),  # 帕米尔
    ([[80.0, 32.0], [83.0, 31.5], [86.0, 31.0], [89.0, 31.0]], 0.30, 0.8, 29),  # 冈底斯
    ([[86.0, 30.5], [89.0, 30.0], [92.0, 30.0], [95.0, 30.5]], 0.28, 0.7, 30),  # 念青唐古拉
    ([[88.0, 37.5], [91.0, 37.0], [94.0, 37.0]], 0.22, 0.7, 31),  # 阿尔金
    ([[105.5, 39.0], [106.2, 38.2], [106.0, 37.0]], 0.07, 0.45, 32),  # 贺兰山
    ([[111.0, 38.5], [111.5, 37.0], [112.0, 35.5]], 0.065, 0.45, 33),  # 吕梁
    ([[114.0, 41.0], [115.0, 40.0], [116.0, 39.5]], 0.05, 0.5, 34),  # 燕山
    ([[114.0, 31.5], [115.5, 31.0], [116.5, 30.5]], 0.10, 0.5, 35),  # 大别
    ([[109.5, 28.0], [110.5, 27.0], [111.5, 26.0]], 0.13, 0.5, 36),  # 雪峰
    ([[126.5, 49.0], [128.0, 47.5], [129.0, 46.5]], 0.07, 0.6, 37),  # 小兴安岭
    ([[135.0, 48.5], [136.0, 46.5], [137.0, 45.0]], 0.13, 0.7, 38),  # 锡霍特
    ([[105.5, 36.5], [106.2, 35.5], [106.0, 34.5]], 0.13, 0.45, 39),  # 六盘山
    ([[111.0, 34.0], [112.2, 33.4], [113.0, 32.8]], 0.11, 0.45, 40),  # 伏牛山
    ([[112.5, 32.0], [113.5, 31.0], [114.0, 30.0]], 0.06, 0.45, 41),  # 大洪山
    ([[118.5, 31.0], [119.5, 30.2], [120.5, 29.5]], 0.09, 0.45, 42),  # 天目山
    ([[113.5, 27.0], [114.5, 26.0], [115.5, 25.0]], 0.12, 0.5, 43),   # 罗霄山
]

ARID = [
    ([[76.0, 41.0], [80.0, 41.5], [88.0, 40.5], [90.0, 38.5], [84.0, 37.0],
      [78.0, 38.0]], 0.92),
    ([[92.0, 45.0], [102.0, 46.0], [110.0, 44.0], [108.0, 41.0], [98.0, 41.0]], 0.85),
    ([[106.0, 40.0], [110.0, 40.0], [111.0, 37.5], [107.0, 37.0]], 0.55),
    ([[90.0, 48.0], [105.0, 50.0], [115.0, 47.0], [112.0, 43.0], [100.0, 44.0]], 0.62),
    ([[80.0, 35.0], [90.0, 36.0], [98.0, 34.0], [96.0, 30.0], [84.0, 30.0]], 0.35),
]

COLOR_STOPS = [
    (0.00, (58, 78, 54)),
    (0.07, (76, 96, 61)),
    (0.16, (101, 114, 70)),
    (0.30, (137, 133, 90)),
    (0.46, (155, 141, 109)),
    (0.62, (137, 125, 112)),
    (0.76, (156, 152, 146)),
    (0.88, (214, 214, 208)),
    (1.00, (244, 245, 242)),
]


def lonlat_to_px(lon, lat, w=W, h=H, ss=1):
    return ((lon - LON0) / (LON1 - LON0) * (w - 1) * ss,
            (LAT1 - lat) / (LAT1 - LAT0) * (h - 1) * ss)


def iter_polygons(geometry):
    if not geometry:
        return
    t = geometry.get("type")
    c = geometry.get("coordinates")
    if t == "Polygon":
        yield c
    elif t == "MultiPolygon":
        yield from c
    elif t == "GeometryCollection":
        for g in geometry.get("geometries", []):
            yield from iter_polygons(g)


def bbox_of(geometry):
    xs, ys = [], []

    def walk(c):
        if isinstance(c[0], (int, float)):
            xs.append(c[0]); ys.append(c[1])
        else:
            for x in c:
                walk(x)

    walk(geometry["coordinates"])
    return min(xs), min(ys), max(xs), max(ys)


def draw_polygons(polygons, fill=255, blur=0, w=W, h=H, ss=1):
    img = Image.new("L", (w * ss, h * ss), 0)
    d = ImageDraw.Draw(img)
    for poly in polygons:
        if not poly:
            continue
        outer = [lonlat_to_px(x, y, w, h, ss) for x, y in poly[0]]
        if len(outer) >= 3:
            d.polygon(outer, fill=fill)
        for hole in poly[1:]:
            hp = [lonlat_to_px(x, y, w, h, ss) for x, y in hole]
            if len(hp) >= 3:
                d.polygon(hp, fill=0)
    if ss > 1:
        img = img.resize((w, h), Image.LANCZOS)
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(img, dtype=np.float32) / 255.0


def draw_mask_from_rings(rings, blur=0, w=W, h=H):
    return draw_polygons([[r] for r in rings], blur=blur, w=w, h=h)


def value_noise(w, h, cell, seed):
    rng = np.random.default_rng(seed)
    small = rng.random((max(2, h // cell), max(2, w // cell))).astype(np.float32)
    img = Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return np.asarray(img, dtype=np.float32) / 255.0


def fbm(seed, w=W, h=H):
    out = np.zeros((h, w), np.float32)
    amp, total = 1.0, 0.0
    for i, cell in enumerate([120, 60, 30, 15, 8]):
        out += amp * value_noise(w, h, cell, seed + i * 31)
        total += amp
        amp *= 0.52
    return out / total


def ridge_layer(coords, amp, width_deg, seed):
    img = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(img)
    pts = [lonlat_to_px(x, y) for x, y in coords]
    d.line(pts, fill=255, width=max(3, int(width_deg * 18)), joint="curve")
    rng = random.Random(seed)
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]; x1, y1 = pts[i + 1]
        n = max(2, int(math.dist((x0, y0), (x1, y1)) / 24))
        for j in range(n):
            t = (j + 0.5) / n
            x = x0 + (x1 - x0) * t + rng.uniform(-9, 9)
            y = y0 + (y1 - y0) * t + rng.uniform(-9, 9)
            r = width_deg * 18 * rng.uniform(0.55, 1.05)
            d.ellipse([x - r, y - r * 0.78, x + r, y + r * 0.78], fill=255)
    img = img.filter(ImageFilter.GaussianBlur(max(4, int(width_deg * 7))))
    return np.asarray(img, dtype=np.float32) / 255.0 * amp


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def colorize(h, arid, moist, loess, steppe, east, south, north, slope, patch, noise, shade):
    low_green = np.array([50, 82, 54], np.float32)
    deep_green = np.array([32, 64, 42], np.float32)
    dry = np.array([162, 148, 104], np.float32)
    khaki = np.array([143, 132, 86], np.float32)
    rock = np.array([112, 103, 93], np.float32)
    loess_c = np.array([175, 147, 98], np.float32)
    sand = np.array([196, 171, 126], np.float32)
    farm_c = np.array([150, 136, 88], np.float32)
    snow_c = np.array([240, 241, 238], np.float32)

    base = dry * (1 - moist[..., None]) + low_green * moist[..., None]
    subtropical = south * (1 - arid) * (1 - smoothstep(0.30, 0.55, h))
    base = base * (1 - subtropical[..., None] * 0.42) + deep_green * (subtropical[..., None] * 0.42)
    north_mask = north * (1 - arid)
    base = base * (1 - north_mask[..., None] * 0.38) + khaki * (north_mask[..., None] * 0.38)

    elev = smoothstep(0.18, 0.72, h)
    base = base * (1 - elev[..., None] * 0.52) + rock * (elev[..., None] * 0.52)
    high = smoothstep(0.56, 0.82, h)
    base = base * (1 - high[..., None] * 0.42) + rock * (high[..., None] * 0.42)
    base = base * (1 - loess[..., None] * 0.62) + loess_c * (loess[..., None] * 0.62)
    base = base * (1 - steppe[..., None] * 0.50) + khaki * (steppe[..., None] * 0.50)
    base = base * (1 - arid[..., None] * 0.88) + sand * (arid[..., None] * 0.88)

    forest = smoothstep(0.42, 0.68, moist * 0.75 + patch * 0.55) * (0.35 + south * 0.65) * (1 - arid)
    base = base * (1 - forest[..., None] * 0.40) + np.array([30, 58, 38], np.float32) * (forest[..., None] * 0.40)
    farm = smoothstep(0.38, 0.62, patch) * east * (1 - smoothstep(0.18, 0.42, h)) * (1 - arid)
    base = base * (1 - farm[..., None] * 0.34) + farm_c * (farm[..., None] * 0.34)

    snow = smoothstep(0.74, 0.89, h)
    base = base * (1 - snow[..., None] * 0.97) + snow_c * (snow[..., None] * 0.97)
    steep = smoothstep(0.007, 0.026, slope) * smoothstep(0.12, 0.40, h)
    base = base * (1 - steep[..., None] * 0.40) + np.array([105, 96, 88], np.float32) * (steep[..., None] * 0.40)

    base += (noise[..., None] - 0.5) * 12.0
    base *= shade[..., None]
    return np.clip(base, 0, 255)


def load_dem():
    p = DATA / "dem_east_asia.npz"
    if not p.exists():
        return None
    elev = np.load(p)["elev"].astype(np.float32)
    if elev.shape != (H, W):
        img = Image.fromarray(np.clip((elev + 11000) / 20000 * 255, 0, 255).astype(np.uint8))
        img = img.resize((W, H), Image.BILINEAR)
        elev = np.asarray(img, dtype=np.float32) / 255 * 20000 - 11000
    return elev


def fill_inland_water(elev, land):
    e = np.where(land > 0.5, np.maximum(elev, 0.0), elev).astype(np.float32)
    norm = (np.clip(e, 0, 8000) / 8000 * 255).astype(np.uint8)
    blurred = np.asarray(
        Image.fromarray(norm).filter(ImageFilter.GaussianBlur(30)),
        dtype=np.float32) / 255.0 * 8000.0
    low = (land > 0.5) & (e < 80.0)
    fill = low & (blurred > 350.0)
    e[fill] = blurred[fill]
    return np.maximum(e, 0.0)


def build_terrain():
    print("[terrain] loading land polygons …")
    ne = json.loads((DATA / "ne_50m_land.geojson").read_text(encoding="utf-8"))
    polys = []
    for ft in ne["features"]:
        g = ft.get("geometry")
        if not g:
            continue
        try:
            b = bbox_of(g)
        except Exception:
            continue
        if b[2] < LON0 - 1 or b[0] > LON1 + 1 or b[3] < LAT0 - 1 or b[1] > LAT1 + 1:
            continue
        polys.extend(iter_polygons(g))
    print(f"[terrain] land polygons: {len(polys)}")

    mask = draw_polygons(polys, fill=255, w=W, h=H, ss=SS)
    land = (mask > 0.5).astype(np.float32)

    lon = np.linspace(LON0, LON1, W, dtype=np.float32)[None, :]
    lat = np.linspace(LAT1, LAT0, H, dtype=np.float32)[:, None]
    noise_a = fbm(41)
    noise_b = fbm(77)
    noise_c = fbm(133)

    dem = load_dem()
    if dem is not None:
        print("[terrain] using real DEM (Mapzen / SRTM / GMTED)")
        elev = fill_inland_water(dem, land)
        detail = ((value_noise(W, H, 5, 401) - 0.5) * 0.0025
                  + (value_noise(W, H, 11, 402) - 0.5) * 0.0015)
        h = (np.clip(elev, 0, 8000) / 8000.0) ** 0.85
        h = h * land + detail * land
        h = np.clip(h, 0.0, 1.0)
    else:
        print("[terrain] DEM not found, using procedural fallback")
        h = land * (0.028 + 0.022 * noise_a)
        h += land * 0.065 * np.clip((106.0 - lon) / 28.0, 0, 1) ** 1.1
        h += land * 0.028 * np.clip((94.0 - lon) / 20.0, 0, 1)

        for pts, amp, blur in PLATEAUS:
            m = draw_mask_from_rings([pts], blur=blur)
            h += m * amp * land
        for coords, amp, width, seed in RIDGES:
            h += ridge_layer(coords, amp, width, seed) * land

        rough = ((value_noise(W, H, 4, 201) - 0.5) * 0.010
                 + (value_noise(W, H, 8, 202) - 0.5) * 0.014
                 + (value_noise(W, H, 16, 203) - 0.5) * 0.010)
        h += rough * land * np.clip(0.35 + h * 3.0, 0.2, 1.25)
        h = np.clip(h, 0.0, 1.0)

    arid = np.zeros((H, W), np.float32)
    for pts, strength in ARID:
        arid = np.maximum(arid, draw_mask_from_rings([pts], blur=18) * strength)
    arid = np.clip(arid + (noise_b - 0.5) * 0.12, 0, 1)

    loess = draw_mask_from_rings([[
        [103.0, 39.0], [106.0, 39.5], [111.0, 38.5], [112.5, 36.0],
        [110.5, 34.0], [106.5, 34.0], [104.0, 35.5],
    ]], blur=22)
    steppe = draw_mask_from_rings([[
        [86.0, 50.0], [96.0, 51.0], [108.0, 50.0], [116.0, 47.5],
        [118.0, 43.0], [110.0, 41.5], [98.0, 42.5], [89.0, 45.5],
    ]], blur=26)
    east = (smoothstep(103.0, 118.0, lon) * smoothstep(19.0, 26.0, lat)
            * (1 - smoothstep(42.0, 46.0, lat)) * (1 - smoothstep(0.25, 0.45, h)))
    east = np.clip(east * land, 0, 1)
    south = 1.0 - smoothstep(29.0, 38.0, lat)
    north = smoothstep(34.0, 45.0, lat)
    patch = value_noise(W, H, 13, 303)
    moist = np.clip(0.60 - arid * 0.90 + 0.28 * south + 0.10 * east - 0.12 * north
                    + 0.20 * (noise_b - 0.5), 0, 1)

    # 自然光影，烘焙进颜色，增强立体肌理
    gy, gx = np.gradient(h)
    slope = np.hypot(gx, gy)
    scale = 80.0
    nx, ny = -gx * scale, -gy * scale
    nz = np.ones_like(nx)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    lx, ly, lz = -0.52, -0.66, 0.54
    dot = np.clip((nx * lx + ny * ly + nz * lz) / norm, 0, 1)
    shade = np.clip(0.66 + 0.52 * dot, 0.64, 1.18)

    h_land = h
    print("[terrain] colorizing …")
    rgb = colorize(h_land, arid, moist, loess, steppe, east, south, north, slope, patch, noise_c, shade)

    # 海洋颜色
    shallow_mask = np.asarray(
        Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(20)),
        dtype=np.float32) / 255.0
    sea_depth = np.clip(1.0 - shallow_mask * 2.0, 0.0, 1.0)
    sea = (np.array([7, 20, 32], np.float32) * sea_depth[..., None]
           + np.array([18, 58, 68], np.float32) * (1 - sea_depth[..., None]))
    sea += (noise_a[..., None] - 0.5) * 5.0
    shore = np.exp(-((shallow_mask - 0.5) / 0.07) ** 2)
    sea = sea * (1 - shore[..., None] * 0.28) + np.array([35, 112, 120], np.float32) * (shore[..., None] * 0.28)

    a = smoothstep(0.40, 0.60, mask)[..., None]
    rgb = sea * (1 - a) + rgb * a
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)

    # 高度图（海面以下裁为 0，海陆由 land_mask 决定）
    hh = np.clip(h_land, 0, 1)
    height_img = Image.fromarray((hh * 255).astype(np.uint8), mode="L")

    # 法线图
    gy, gx = np.gradient(h_land)
    s = 24.0
    nx, ny = -gx * s, -gy * s
    nz = np.ones_like(nx)
    nrm = np.sqrt(nx * nx + ny * ny + nz * nz)
    nimg = np.stack([(nx / nrm) * 0.5 + 0.5, (ny / nrm) * 0.5 + 0.5, (nz / nrm) * 0.5 + 0.5], axis=-1)
    nimg = (np.clip(nimg, 0, 1) * 255).astype(np.uint8)
    nimg = np.where(land[..., None] > 0.5, nimg, np.array([128, 128, 255], np.uint8))

    Image.fromarray(rgb).save(ASSETS / "terrain_color.png")
    height_img.save(ASSETS / "terrain_height.png")
    Image.fromarray(nimg).save(ASSETS / "terrain_normal.png")
    Image.fromarray((mask * 255).astype(np.uint8), mode="L").save(ASSETS / "land_mask.png")
    print("[terrain] textures written.")
    return mask


# ---------------------------------------------------------------- 疆域
def rdp(points, eps):
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        s, e = stack.pop()
        if e <= s + 1:
            continue
        x1, y1 = points[s]; x2, y2 = points[e]
        dx, dy = x2 - x1, y2 - y1
        den = math.hypot(dx, dy) or 1e-12
        best, idx = -1.0, None
        for i in range(s + 1, e):
            px, py = points[i]
            dist = abs(dy * (px - x1) - dx * (py - y1)) / den
            if dist > best:
                best, idx = dist, i
        if idx is not None and best > eps:
            keep[idx] = True
            stack.append((s, idx))
            stack.append((idx, e))
    return [p for i, p in enumerate(points) if keep[i]]


def ring_area(ring):
    area = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]; x2, y2 = ring[i + 1]
        area += x1 * y2 - x2 * y1
    return abs(area) * 0.5


def simplify_ring(ring, eps=0.035):
    pts = [tuple(p[:2]) for p in ring]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3:
        return []
    simplified = rdp(pts, eps)
    if len(simplified) < 3:
        return []
    simplified.append(simplified[0])
    return [[round(x, 4), round(y, 4)] for x, y in simplified]


def clip_halfplane(ring, lat_max):
    if len(ring) < 2:
        return []
    out = []
    for i in range(len(ring)):
        cur = ring[i]
        nxt = ring[(i + 1) % len(ring)]
        cur_in = cur[1] <= lat_max
        nxt_in = nxt[1] <= lat_max
        if cur_in:
            out.append(cur)
        if cur_in != nxt_in:
            t = (lat_max - cur[1]) / (nxt[1] - cur[1])
            out.append([cur[0] + t * (nxt[0] - cur[0]), lat_max])
    if not out:
        return []
    out.append(out[0])
    return out


def load_year(year):
    return json.loads((DATA / f"world_{year}.geojson").read_text(encoding="utf-8"))


def extract_group(group):
    polygons = []
    if "polygons" in group:
        for ring in group["polygons"]:
            polygons.append([[[round(x, 4), round(y, 4)] for x, y in ring]])
    else:
        d = load_year(group["year"])
        wanted = set(group.get("names", []))
        for ft in d["features"]:
            props = ft.get("properties") or {}
            name = props.get("NAME")
            if name not in wanted:
                continue
            g = ft.get("geometry")
            if not g:
                continue
            try:
                b = bbox_of(g)
            except Exception:
                continue
            if b[2] < LON0 or b[0] > LON1 or b[3] < LAT0 or b[1] > LAT1:
                continue
            for poly in iter_polygons(g):
                rings = []
                for ri, ring in enumerate(poly):
                    sr = simplify_ring(ring)
                    if not sr:
                        continue
                    if ri > 0 and ring_area(sr) < 0.02:
                        continue
                    rings.append(sr)
                if not rings:
                    continue
                if ring_area(rings[0]) < 0.05:
                    continue
                polygons.append(rings)
        for extra_poly in group.get("extra", []):
            rings = [[[round(x, 4), round(y, 4)] for x, y in ring] for ring in extra_poly]
            if rings:
                polygons.append(rings)

    # 裁掉北侧，用于南宋等
    lat_max = group.get("clipLat")
    if lat_max is not None:
        clipped = []
        for poly in polygons:
            rings = []
            for ri, ring in enumerate(poly):
                cr = clip_halfplane(ring, lat_max)
                if cr and ring_area(cr) > 0.03:
                    rings.append([[round(x, 4), round(y, 4)] for x, y in cr])
            if rings:
                clipped.append(rings)
        polygons = clipped

    # 只保留面积较大的多边形，限制数据量
    polygons.sort(key=lambda p: ring_area(p[0]), reverse=True)
    polygons = polygons[:40]
    polygons = [[r for r in poly if ring_area(r) > 0.012] for poly in polygons]
    polygons = [poly for poly in polygons if poly and ring_area(poly[0]) > 0.012]

    out = {"label": group["label"], "color": group["color"], "polygons": polygons}
    if "labelAt" in group:
        out["labelAt"] = group["labelAt"]
    if "labels" in group:
        out["labels"] = group["labels"]
    return out


def build_territories():
    print("[territory] extracting historical shapes …")
    result = {}
    for era in content.ERAS:
        cfg = content.TERRITORIES[era["id"]]
        groups = []
        for g in cfg["groups"]:
            groups.append(extract_group(g))
            print(f"  {era['id']:8} {g['label']:10} polygons={len(groups[-1]['polygons'])}")
        result[era["id"]] = groups
    return result


def build_preview(territories):
    cols, rows = 4, 4
    pw, ph = 440, 330
    canvas = Image.new("RGB", (cols * pw, rows * ph), (8, 12, 18))
    d = ImageDraw.Draw(canvas)
    region_w, region_h = pw - 40, ph - 70

    def project(lon, lat, ox, oy):
        return (ox + (lon - LON0) / (LON1 - LON0) * region_w,
                oy + (LAT1 - lat) / (LAT1 - LAT0) * region_h)

    for i, era in enumerate(content.ERAS):
        cx = (i % cols) * pw
        cy = (i // cols) * ph
        d.rectangle([cx, cy, cx + pw - 1, cy + ph - 1], outline=(38, 52, 68))
        d.text((cx + 18, cy + 12), f"{era['id'].upper()}  {era['start']}..{era['end']}", fill=(220, 190, 120))
        # 简化海岸线背景
        for poly in territories[era["id"]]:
            for p in poly["polygons"]:
                pts = [project(x, y, cx + 20, cy + 50) for x, y in p[0]]
                if len(pts) >= 3:
                    d.polygon(pts, fill=(22, 34, 44))
        for poly in territories[era["id"]]:
            for p in poly["polygons"]:
                pts = [project(x, y, cx + 20, cy + 50) for x, y in p[0]]
                if len(pts) >= 3:
                    d.polygon(pts, outline=tuple(int(poly["color"][j:j + 2], 16) for j in (1, 3, 5)),
                              fill=tuple(int(poly["color"][j:j + 2], 16) for j in (1, 3, 5)))
    canvas.save(ASSETS / "preview_territories.png")
    print("[preview] assets/preview_territories.png")


def build_geo(territories):
    eras = []
    for e in content.ERAS:
        eras.append({
            "id": e["id"], "name": e["name"], "fullName": e["fullName"],
            "start": e["start"], "end": e["end"], "defaultYear": e["defaultYear"],
            "color": e["color"], "mapNote": e["mapNote"], "summary": e["summary"],
            "capitals": e["capitals"], "people": e["people"], "events": e["events"],
            "territories": territories[e["id"]],
            "adminUnits": content.ADMIN_UNITS.get(e["id"], []),
        })
    geo = {
        "map": {
            "lon0": LON0, "lon1": LON1, "lat0": LAT0, "lat1": LAT1,
            "width": W, "height": H,
        },
        "eras": eras,
        "landmarks": content.LANDMARKS,
        "rivers": content.RIVERS,
        "geoLabels": content.GEO_LABELS,
        "attribution": [
            "疆域轮廓：Historical Basemaps（CC BY-SA 4.0），经简化与局部修补",
            "海岸线：Natural Earth 1:50m（公有领域）",
            "高程：Mapzen Terrain Tiles（SRTM / GMTED，CC BY 4.0）",
            "色彩、法线与光影：程序化生成，仅作教学示意",
        ],
    }
    (ASSETS / "geo.json").write_text(
        json.dumps(geo, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    size = (ASSETS / "geo.json").stat().st_size / 1024
    print(f"[geo] assets/geo.json {size:.0f} KB")


def main():
    mask = build_terrain()
    territories = build_territories()
    build_preview(territories)
    build_geo(territories)
    print("done.")


if __name__ == "__main__":
    main()
