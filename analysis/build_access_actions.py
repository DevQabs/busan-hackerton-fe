#!/usr/bin/env python3
"""Generate public/data/access_actions.json for the '도착 이후 400m' scene.

Source: the 2026 DIVE finals SAMPLE (해운대구 송정동) — 윌체어 무장애가게 12-field
audit × 두리발 하차. Kept standalone for now because the finals-format inputs live
outside build_all.py's May-2025 pipeline; fold in once the pipeline is reworked for
the finals 두리발 schema (no 결과 column — outcome from timestamps).

Run: python3 analysis/build_access_actions.py
"""
import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
import common  # noqa: E402

DATA_DIR = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "public", "data", "access_actions.json")
FIELDS = ["일층", "경사로", "입구턱", "입구무턱", "테이블석", "화장실턱",
          "화장실무턱", "장애인화장실", "엘리베이터", "주차장", "장애인주차장", "테이크아웃"]

ARC = next(os.path.join(DATA_DIR, n) for n in os.listdir(DATA_DIR)
           if n.endswith(".zip") and "샘플 데이터" in n)
Z = zipfile.ZipFile(ARC)


def extract(sub):
    e = next(x for x in Z.namelist() if sub in x and x.endswith(".xlsx"))
    p = os.path.join("/tmp", "_aa_%s.xlsx" % sub)
    open(p, "wb").write(Z.read(e))
    return p


def status_of(f, sim=False):
    """The enterable→usable→comfort chain from the 12 Y/N fields (doc §5).
    hard gates = entrance + floor; quality = seating, toilet, parking."""
    entry_ok = sim or f["입구턱"] != "Y" or f["입구무턱"] == "Y" or f["경사로"] == "Y"
    floor_ok = f["일층"] == "Y" or f["엘리베이터"] == "Y"
    enterable = entry_ok and floor_ok
    usable = enterable and f["테이블석"] == "Y"
    comfort = usable and f["장애인화장실"] == "Y"
    if not entry_ok:
        barrier = "입구(진입)"
    elif not floor_ok:
        barrier = "층이동"
    elif f["테이블석"] != "Y":
        barrier = "내부이용"
    elif f["장애인화장실"] != "Y":
        barrier = "편의(화장실)"
    else:
        barrier = "완비"
    cls = "good" if comfort else ("critical" if not enterable else "warning")
    return enterable, usable, comfort, barrier, cls


# --- shops ------------------------------------------------------------------
rows = list(common.iter_xlsx_rows(extract("무장애가게")))
h = rows[0]
ix = {n: h.index(n) for n in h}
shops = []
for r in rows[1:]:
    f = {k: ("Y" if (r[ix[k]] or "").strip() == "Y" else "N") for k in FIELDS}
    enterable, usable, comfort, barrier, cls = status_of(f)
    shops.append({
        "name": r[ix["상호명"]],
        "cat": r[ix["상권업종중분류명"]],
        "lng": round(float(r[ix["경도"]]), 6),
        "lat": round(float(r[ix["위도"]]), 6),
        "fields": f,
        "enterable": enterable, "usable": usable, "comfort": comfort,
        "barrier": barrier, "cls": cls,
    })

# --- dropoffs (completed = 하차시간 present); store [lng, lat] --------------
dr = list(common.iter_xlsx_rows(extract("두리발운행")))
hd = dr[0]
xi, yi, ci = hd.index("목적지X좌표"), hd.index("목적지Y좌표"), hd.index("하차시간")
drops = []
for r in dr[1:]:
    if (r[ci] or "").strip() and r[xi] and r[yi]:
        try:
            drops.append([round(float(r[yi]), 5), round(float(r[xi]), 5)])  # [lng, lat]
        except ValueError:
            pass

# per-shop served arrivals: distance-weighted 하차 within the catchment (doc §5,
# linear distanceWeight → 0 at catchmentM). The "impact" weight for each action.
CATCH = 400.0
for s in shops:
    served = 0.0
    for d in drops:
        m = common.haversine_m(s["lng"], s["lat"], d[0], d[1])
        if m < CATCH:
            served += 1.0 - m / CATCH
    s["nearbyArrivals"] = round(served)

barrier_dna = {}
for s in shops:
    barrier_dna[s["barrier"]] = barrier_dna.get(s["barrier"], 0) + 1

out = {
    "meta": {
        "period": "2025-03 ~ 2026-03",
        "scope": "해운대구 송정동 (2026 DIVE 샘플)",
        "catchmentM": 400,
        "note": "두리발 하차 × 윌체어 무장애가게 12개 Y/N 실사. 진입→이용→편의 사슬. proximity 기준·표본.",
    },
    "shops": shops,
    "dropoffs": drops,
    "summary": {
        "arrivals": len(drops),
        "shops": len(shops),
        "enterable": sum(s["enterable"] for s in shops),
        "usable": sum(s["usable"] for s in shops),
        "comfort": sum(s["comfort"] for s in shops),
        "barrierDNA": barrier_dna,
    },
}
json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("wrote", OUT, "(%d KB)" % (os.path.getsize(OUT) // 1024))
print("summary:", json.dumps(out["summary"], ensure_ascii=False))
