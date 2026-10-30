# -*- coding: utf-8 -*-
"""把 geo.json 中的教学内容扩充为离线百科条目，输出 assets/wiki.json。

所有文字随课件本地存储，不依赖维基百科、百度百科等外部站点。
"""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
GEO = json.loads((ASSETS / "geo.json").read_text(encoding="utf-8"))
ERAS = GEO["eras"]
LANDMARKS = GEO["landmarks"]


def sy(y):
    y = int(round(y))
    if y < 0:
        return f"前{-y}"
    if y == 0:
        return "1"
    return str(y)


def fmt_year(y):
    y = int(round(y))
    if y < 0:
        return f"公元前{-y}年"
    if y == 0:
        return "公元1年"
    return f"公元{y}年"


def era_range(e):
    if e["end"] <= e["start"]:
        return sy(e["start"])
    return f"{sy(e['start'])}—{sy(e['end'])}"


def coord(data):
    return f"北纬 {float(data['lat']):.1f}° · 东经 {float(data['lon']):.1f}°"


def find_era_for_year(y):
    for e in ERAS:
        if e["start"] <= y <= e["end"]:
            return e
    if y < ERAS[0]["start"]:
        return ERAS[0]
    return ERAS[-1]


def person_key(p):
    return f"person:{p['name']}"


def event_key(ev):
    return f"event:{ev['year']}:{ev['name']}"


def landmark_key(lm):
    return f"landmark:{lm['name']}"


def capital_key(era, c):
    return f"capital:{era['id']}:{c['name']}"


def role_sentence(name, title):
    t = title or ""
    if name == "嫘祖":
        return "作为传说中养蚕缫丝、织帛制衣的始祖，其贡献主要体现在先民的生产与生活方式上。"
    if name == "仓颉":
        return "作为传说中文字的创制者，其贡献主要体现在文化记忆与书写传统上。"
    if name in ("黄帝", "炎帝"):
        return "作为这一时期的最高统治者，其决策、用人与其时代的制度走向紧密相连。"
    if any(k in t for k in ["帝", "皇", "王", "可汗", "单于", "总统", "主席", "圣祖", "高宗", "太祖", "世祖"]):
        return "作为这一时期的最高统治者，其决策、用人与其时代的制度走向紧密相连。"
    if any(k in t for k in ["将", "军", "帅", "司令", "英雄", "大将军"]):
        return "作为军事统帅，其活动与战争、边防和政权更替紧密相连。"
    if any(k in t for k in ["诗", "书", "文学", "文坛", "学者", "思想", "教育", "科学", "医", "僧", "法师", "哲学", "画", "戏剧", "地理", "旅行", "航海"]):
        return "作为文化人物，其作品与思想参与了时代精神气质的塑造。"
    if any(k in t for k in ["铁路", "工程", "科学", "发明", "纺织"]):
        return "作为实干家与探索者，其事业拓展了时人对技术与世界的认识。"
    return "作为这一时期的重要人物，其经历折射出时代的多重面相。"


ARCH = {
    "军事工程": "依山势、据险要而筑，城墙、关隘、烽燧与屯兵体系相互配合，体现古代军事防御思想与工程组织能力。",
    "宫殿": "以中轴对称、前朝后寝、木构架与高等级屋顶为核心，体现古代宫殿礼制与营造技艺。",
    "佛塔": "塔基、塔身与塔刹层层收分，融入楼阁式或密檐式做法，是佛教中国化的重要建筑见证。",
    "石窟": "依崖开凿，窟龛、造像、壁画与彩塑共同构成连续的佛教艺术长廊。",
    "水利工程": "因水势而布局，分水、泄洪、灌溉与航运功能兼顾，体现因势利导的治水智慧。",
    "桥梁": "以拱券或梁柱承重，结构轻巧而坚固，是中国古代桥梁工程的代表。",
    "关隘": "扼守交通要道，与长城防线和驿路体系相连，具有重要军事战略地位。",
    "园林": "叠山理水、借景成境，融合中国古典园林与西洋造园艺术。",
    "祠庙": "以礼制建筑为核心，承载祭祀、教育与文化传承功能。",
    "楼阁": "依山临水而建，历代题咏与重修使其成为地方文化地标。",
    "陵墓": "陵园布局严整，陪葬坑、陶俑军阵与礼制建筑展示当时的军事制度与工艺水平。",
    "石刻": "依山凿刻，体量宏大，体现佛教造像艺术与地方信仰。",
    "港口": "依托海湾、航道与腹地经济，成为海上贸易与文化交流的枢纽。",
}

IDX = {"person": {}, "event": {}, "landmark": {}, "capital": {}}
for era in ERAS:
    for p in era["people"]:
        IDX["person"][person_key(p)] = (era, p)
    for ev in era["events"]:
        IDX["event"][event_key(ev)] = (era, ev)
    for c in era["capitals"]:
        IDX["capital"][capital_key(era, c)] = (era, c)
for lm in LANDMARKS:
    IDX["landmark"][landmark_key(lm)] = (find_era_for_year(lm["year"]), lm)


def related_people(era, exclude=None, limit=2):
    out = []
    for p in era["people"]:
        if p["name"] == exclude:
            continue
        out.append({"type": "person", "key": person_key(p), "label": p["name"], "sub": p.get("title", "")})
        if len(out) >= limit:
            break
    return out


def related_events(era, limit=2):
    out = []
    events = [e for e in era["events"] if e.get("key")] + [e for e in era["events"] if not e.get("key")]
    for ev in events[:limit]:
        out.append({"type": "event", "key": event_key(ev), "label": ev["name"], "sub": fmt_year(ev["year"])})
    return out


def related_landmarks(era, limit=1):
    built = [lm for lm in LANDMARKS if lm["year"] <= era["end"]]
    built.sort(key=lambda x: (not x.get("key"), x["year"]))
    out = []
    for lm in built[:limit]:
        out.append({"type": "landmark", "key": landmark_key(lm), "label": lm["name"], "sub": lm.get("type", "")})
    return out


def dedupe(refs):
    seen = set()
    out = []
    for r in refs:
        if r["key"] in seen:
            continue
        seen.add(r["key"])
        out.append(r)
    return out[:5]


def make_person(era, p):
    key = person_key(p)
    intro = p.get("desc", "")
    key_events = [e for e in era["events"] if e.get("key")] or era["events"]
    ev_names = "、".join(e["name"] for e in key_events[:3])
    if not ev_names:
        ev_names = "这一时期的政治与社会变动"
    sections = [
        {"title": "时代背景", "text": era["summary"]},
        {"title": "人物与时代", "text": f"{role_sentence(p['name'], p.get('title', ''))} {p['name']}的活动与{ev_names}等事件相互交织，构成{era['name']}历史的重要侧面。"},
        {"title": "历史影响", "text": f"后世在讲述{era['name']}历史时，常将{p['name']}视为这一时代的重要坐标。其{p.get('title', '人物')}身份所承载的制度、思想与文化意义，至今仍被不断讨论。"},
    ]
    facts = [
        ["所属时期", f"{era['name']} · {era_range(era)}"],
        ["身份", p.get("title", "历史人物")],
        ["生卒", p.get("life", "不详")],
        ["坐标", coord(p)],
    ]
    refs = related_events(era, 2) + related_people(era, p["name"], 1) + related_landmarks(era, 1)
    return {
        "title": p["name"], "kind": "人物志", "eraId": era["id"],
        "meta": f"{p.get('life', '')}{(' · ' + p['title']) if p.get('title') else ''}",
        "intro": intro, "sections": sections, "facts": facts, "related": dedupe(refs),
    }


def make_event(era, ev):
    people = related_people(era, None, 3)
    names = "、".join(r["label"] for r in people) or "同时代人物"
    sections = [
        {"title": "历史背景", "text": era["summary"]},
        {"title": "经过与影响", "text": f"{ev.get('desc', '')} 事件与{names}等人物相关，发生在{era_range(era)}的{era['name']}时期，是理解该时代走向的重要节点。"},
        {"title": "历史回响", "text": "后世对这一事件的记忆，既保存在史书、文学与教育之中，也沉淀在相关地名、纪念建筑和民间叙事里。"},
    ]
    facts = [
        ["所属时期", f"{era['name']} · {era_range(era)}"],
        ["发生年代", fmt_year(ev["year"])],
        ["事件类型", "重要历史节点" if ev.get("key") else "历史事件"],
        ["坐标", coord(ev)],
    ]
    refs = related_people(era, None, 2) + related_events(era, 2) + related_landmarks(era, 1)
    refs = [r for r in refs if r["key"] != event_key(ev)]
    return {
        "title": ev["name"], "kind": "大事记", "eraId": era["id"],
        "meta": fmt_year(ev["year"]),
        "intro": ev.get("desc", ""), "sections": sections, "facts": facts, "related": dedupe(refs),
    }


def make_landmark(lm):
    era = find_era_for_year(lm["year"])
    arch = ARCH.get(lm.get("type", ""), "其选址、形制与工艺体现了当时的技术水平与审美取向，是研究古代建筑与物质文化的重要实例。")
    sections = [
        {"title": "历史沿革", "text": f"{lm.get('yearLabel', '')}。围绕{lm['name']}的营建、使用与后世保护，构成了理解{era['name']}物质文化的重要线索。"},
        {"title": "建筑与艺术", "text": arch},
        {"title": "文化意义", "text": f"作为{era['name']}时期的{lm.get('type', '古迹')}，{lm['name']}不仅是物质遗存，也承载制度、信仰、审美与集体记忆，是中华文明连续性的一个窗口。"},
    ]
    facts = [
        ["始建时期", f"{era['name']} · {era_range(era)}"],
        ["始建年代", lm.get("yearLabel", "")],
        ["古迹类型", lm.get("type", "古迹")],
        ["坐标", coord(lm)],
    ]
    refs = related_people(era, None, 2) + related_events(era, 2)
    return {
        "title": lm["name"], "kind": "古迹志", "eraId": era["id"],
        "meta": f"{lm.get('yearLabel', '')} · {lm.get('type', '')}",
        "intro": lm.get("desc", ""), "sections": sections, "facts": facts, "related": dedupe(refs),
    }


def make_capital(era, c):
    sections = [
        {"title": "建都背景", "text": era["summary"]},
        {"title": "城市地位", "text": f"作为{era['fullName']}的都城（{c.get('note', '')}），{c['name']}集中体现了当时的政治制度、城市规划、礼仪生活与文化交流。都城的兴衰，也往往与王朝命运同频。"},
    ]
    facts = [
        ["所属时期", f"{era['name']} · {era_range(era)}"],
        ["都城", c["name"]],
        ["备注", c.get("note", "")],
        ["坐标", coord(c)],
    ]
    refs = related_people(era, None, 2) + related_events(era, 2)
    return {
        "title": c["name"], "kind": "都城志", "eraId": era["id"],
        "meta": c.get("note", ""),
        "intro": f"{c.get('note', '')}。{era['fullName']}的政治中心，也是那个时代人口、财富与权力的汇聚之地。",
        "sections": sections, "facts": facts, "related": dedupe(refs),
    }


def main():
    entries = {}
    for era in ERAS:
        for p in era["people"]:
            entries[person_key(p)] = make_person(era, p)
        for ev in era["events"]:
            entries[event_key(ev)] = make_event(era, ev)
        for c in era["capitals"]:
            entries[capital_key(era, c)] = make_capital(era, c)
    for lm in LANDMARKS:
        entries[landmark_key(lm)] = make_landmark(lm)
    img_manifest = {}
    ip = ASSETS / "images" / "manifest.json"
    if ip.exists():
        img_manifest = json.loads(ip.read_text(encoding="utf-8"))
    for key, entry in entries.items():
        entry["images"] = img_manifest.get(key, [])
    data = {
        "version": 1,
        "note": "本地离线百科 · 随课件发布，不依赖外部站点",
        "entries": entries,
    }
    (ASSETS / "wiki.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    size = (ASSETS / "wiki.json").stat().st_size / 1024
    print(f"wiki entries={len(entries)} size={size:.0f} KB")


if __name__ == "__main__":
    main()
