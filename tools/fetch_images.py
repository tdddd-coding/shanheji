# -*- coding: utf-8 -*-
"""从公开图片检索（搜狗图片）下载本地百科配图，保存为 assets/images/*.webp。

古迹每个条目尽量 3 张；人物、事件、都城各 1 张。图片保留来源页，
仅用于课堂教学展示。"""
from __future__ import annotations

import hashlib
import io
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
IMG_DIR = ASSETS / "images"
IMG_DIR.mkdir(parents=True, exist_ok=True)
MANIFEST_PATH = IMG_DIR / "manifest.json"
GEO = json.loads((ASSETS / "geo.json").read_text(encoding="utf-8"))

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
HEADERS = {"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9"}


def person_key(p):
    return f"person:{p['name']}"


def event_key(ev):
    return f"event:{ev['year']}:{ev['name']}"


def landmark_key(lm):
    return f"landmark:{lm['name']}"


def capital_key(era, c):
    return f"capital:{era['id']}:{c['name']}"


BAD = ["门票", "攻略", "地图", "简笔", "漫画", "表情包", "试题", "作文", "游戏", "海报", "广告", "素材", "矢量", "logo", "图标", "标志"]


def decode(s):
    try:
        return json.loads('"' + s + '"')
    except Exception:
        return s.replace("\u002F", "/").replace("\/", "/")


def score(title, query_name, tw, th):
    if any(b in title for b in BAD):
        return -999
    s = 0
    probes = [query_name, query_name[-4:], query_name[-3:], query_name[-2:], query_name[:4], query_name[:3], query_name[:2]]
    if any(p and p in title for p in probes):
        s += 100
    if any(k in title for k in ["实拍", "摄影", "风景", "高清", "全景", "图片"]):
        s += 20
    if tw >= 500:
        s += 5
    if tw < 300 or th < 200:
        s -= 50
    return s


def image_search(query, query_name):
    url = "https://pic.sogou.com/pics?query=" + urllib.parse.quote(query)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=30) as r:
            page = r.read().decode("utf-8", "ignore")
    except Exception as e:
        print("  search fail", query, type(e).__name__, str(e)[:80], flush=True)
        return []
    out = []
    seen = set()
    for m in re.finditer(r'"thumbUrl":"([^"]+)"', page):
        window = page[max(0, m.start() - 2000):m.start() + 900]
        thumb = decode(m.group(1))
        if not thumb or thumb in seen:
            continue
        seen.add(thumb)
        p = re.search(r'"picUrl":"([^"]+)"', window)
        t = re.search(r'"title":"([^"]+)"', window)
        u = re.search(r'"url":"([^"]+)"', window)
        tw = re.search(r'"thumbWidth":(\d+)', window)
        th = re.search(r'"thumbHeight":(\d+)', window)
        title = decode(t.group(1)) if t else ""
        purl = decode(u.group(1)) if u else ""
        tw = int(tw.group(1)) if tw else 0
        th = int(th.group(1)) if th else 0
        sc = score(title, query_name, tw, th)
        if sc <= -900:
            continue
        out.append({
            "thumb": thumb, "img": decode(p.group(1)) if p else "",
            "title": title, "purl": purl, "_score": sc,
        })
    out.sort(key=lambda x: -x["_score"])
    return out


def download_image(item, key, index):
    candidates = [item.get("thumb"), item.get("img")]
    data = None
    used = None
    for u in candidates:
        if not u:
            continue
        try:
            req = urllib.request.Request(u, headers={
                "User-Agent": UA, "Referer": "https://pic.sogou.com/",
                "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            })
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            used = u
            if len(data) > 4000:
                break
        except Exception:
            data = None
    if not data or len(data) < 4000:
        return None
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception:
        return None
    w, h = im.size
    if w < 300 or h < 200:
        return None
    if w / max(1, h) > 2.6 or h / max(1, w) > 2.6:
        return None
    im = im.convert("RGB")
    if im.width > 900:
        im = im.resize((900, round(im.height * 900 / im.width)), Image.LANCZOS)
    digest = hashlib.md5(key.encode("utf-8")).hexdigest()[:12]
    name = f"{digest}_{index}.webp"
    im.save(IMG_DIR / name, "WEBP", quality=80, method=4)
    return {
        "file": name,
        "caption": item.get("title", ""),
        "credit": "搜狗图片 · 公开网络资料",
        "license": "版权归原作者",
        "source": item.get("purl", ""),
        "original": used or "",
    }


def main():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8")) if MANIFEST_PATH.exists() else {}
    items = []
    seen = set()
    for lm in GEO["landmarks"]:
        k = landmark_key(lm)
        if k not in seen:
            seen.add(k)
            items.append((k, lm["name"], 3, "古迹", lm["name"]))
    for era in GEO["eras"]:
        for p in era["people"]:
            k = person_key(p)
            if k not in seen:
                seen.add(k)
                q = p["name"] + (" 画像" if re.search(r"前|1[0-8]\d{2}", p.get("life", "")) else " 照片")
                items.append((k, q, 1, "人物", p["name"]))
        for ev in era["events"]:
            k = event_key(ev)
            if k not in seen:
                seen.add(k)
                q = ev["name"] + " 历史"
                items.append((k, q, 1, "事件", ev["name"]))
        for c in era["capitals"]:
            k = capital_key(era, c)
            if k not in seen:
                seen.add(k)
                q = c["name"] + " 城市 风景"
                items.append((k, q, 1, "都城", c["name"]))

    total = len(items)
    for n, (key, query, want, kind, qname) in enumerate(items, 1):
        existing = [x for x in manifest.get(key, []) if (IMG_DIR / x["file"]).exists()]
        if len(existing) >= want:
            continue
        print(f"[{n}/{total}] {kind} {key}", flush=True)
        found = image_search(query, qname)
        images = existing[:]
        seen_urls = {x.get("original") for x in images}
        idx = len(images)
        for item in found:
            if len(images) >= want:
                break
            if item.get("thumb") in seen_urls:
                continue
            img = download_image(item, key, idx)
            if not img:
                continue
            images.append(img)
            seen_urls.add(item.get("thumb"))
            idx += 1
        if images:
            manifest[key] = images
            MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
        time.sleep(0.28)
    print("done", len(manifest), "entries with images", flush=True)


if __name__ == "__main__":
    main()
