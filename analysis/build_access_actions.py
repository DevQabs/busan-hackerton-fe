#!/usr/bin/env python3
"""Generate public/data/access_actions.json for the '도착 이후 400m' scene.

Source: 2026 DIVE 본선 데이터 (해운대구 전체) — 윌체어 무장애가게 12-field
audit(321곳, 행정동명 포함) × 두리발 하차(43,891건 중 completed).
구 폴더 규칙: 원본 xlsx는 repo 밖 <codeVodca>/data/해운대구/ 에 둔다.

본선 데이터 좌표 규칙(AGENTS.md): 개별 트립 좌표는 집계 표시만 허용 —
dropoffs는 소수 3자리(~100m 격자)로 반올림해 내보낸다. nearbyArrivals
거리가중 합은 반올림 전 원좌표로 계산한다.

두리발 파일 주의: 목적지X좌표=위도(35.x), 목적지Y좌표=경도(129.x) — 스왑됨.

Run: python3 analysis/build_access_actions.py
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
import common  # noqa: E402

SCRATCH = os.path.dirname(ROOT)  # codeVodca/
SRC_CANDIDATES = [
    os.path.join(SCRATCH, "data", "해운대구"),
    os.path.join(os.path.expanduser("~"), "Desktop", "해운대구 데이터"),
]
SRC = next((p for p in SRC_CANDIDATES if os.path.isdir(p)), SRC_CANDIDATES[-1])
F_SHOPS = os.path.join(SRC, "03.해운대구_무장애가게 데이터.xlsx")
F_TRIPS = os.path.join(SRC, "01.해운대구_두리발 교통약자 이동수요 데이터_20250301_20260331.xlsx")
SHOPS_SHEET = "xl/worksheets/sheet6.xml"  # "5.무장애 가게 리스트"

OUT = os.path.join(ROOT, "public", "data", "access_actions.json")
FIELDS = ["일층", "경사로", "입구턱", "입구무턱", "테이블석", "화장실턱",
          "화장실무턱", "장애인화장실", "엘리베이터", "주차장", "장애인주차장", "테이크아웃"]
BBOX = {"lat": (34.9, 35.5), "lng": (128.7, 129.5)}  # 좌표 sanity 필터
GU_PREFIX = "부산광역시 해운대구 "


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


def in_bbox(lng, lat):
    return BBOX["lng"][0] <= lng <= BBOX["lng"][1] and BBOX["lat"][0] <= lat <= BBOX["lat"][1]


# --- shops (321곳 전수 실사, 행정동명 컬럼 보유) -----------------------------
rows = list(common.iter_xlsx_rows(F_SHOPS, sheet_path=SHOPS_SHEET))
h = rows[0]
ix = {n: h.index(n) for n in h}
shops = []
skipped_shops = 0
for r in rows[1:]:
    if not any((c or "").strip() for c in r):
        continue
    try:
        lat = float(r[ix["위도"]])
        lng = float(r[ix["경도"]])
    except (TypeError, ValueError):
        skipped_shops += 1
        continue
    if not in_bbox(lng, lat):
        skipped_shops += 1
        continue
    f = {k: ("Y" if (r[ix[k]] or "").strip() == "Y" else "N") for k in FIELDS}
    enterable, usable, comfort, barrier, cls = status_of(f)
    shops.append({
        "name": r[ix["상호명"]],
        "cat": r[ix["상권업종중분류명"]],
        "dong": (r[ix["행정동명"]] or "").strip() or "미상",
        "lng": round(lng, 6),
        "lat": round(lat, 6),
        "fields": f,
        "enterable": enterable, "usable": usable, "comfort": comfort,
        "barrier": barrier, "cls": cls,
    })

# --- dropoffs (completed = 하차시간 present) --------------------------------
# X좌표=위도 / Y좌표=경도 스왑. 원좌표는 catchment 계산용으로만 쓰고,
# 출력은 [lng, lat] 소수 3자리(~100m) 반올림 (본선 개인정보 규칙).
dr = common.iter_xlsx_rows(F_TRIPS)
hd = next(dr)
xi, yi, ci = hd.index("목적지X좌표"), hd.index("목적지Y좌표"), hd.index("하차시간")
di = hd.index("목적지행정동")
drops_raw = []          # [lng, lat] 원좌표 (계산용, 파일에 쓰지 않음)
dropoffs_by_dong = {}
skipped_drops = 0
for r in dr:
    if not (r[ci] or "").strip():
        continue
    try:
        lat = float(r[xi])
        lng = float(r[yi])
    except (TypeError, ValueError):
        skipped_drops += 1
        continue
    if not in_bbox(lng, lat):
        skipped_drops += 1
        continue
    drops_raw.append([lng, lat])
    dong = (r[di] or "").strip()
    dong = dong[len(GU_PREFIX):] if dong.startswith(GU_PREFIX) else (dong or "기타")
    dropoffs_by_dong[dong] = dropoffs_by_dong.get(dong, 0) + 1
drops_out = [[round(d[0], 3), round(d[1], 3)] for d in drops_raw]

# per-shop served arrivals: distance-weighted 하차 within the catchment (doc §5,
# linear distanceWeight → 0 at catchmentM). The "impact" weight for each action.
CATCH = 400.0
DLAT = CATCH / 111000.0                                   # 400m를 위도 각도로
DLNG = CATCH / (111000.0 * math.cos(math.radians(35.2)))  # 경도 각도(해운대 위도 기준)
for s in shops:
    served = 0.0
    slng, slat = s["lng"], s["lat"]
    for d in drops_raw:
        if abs(d[0] - slng) > DLNG or abs(d[1] - slat) > DLAT:
            continue  # 사각 프리필터 — haversine 호출 절감
        m = common.haversine_m(slng, slat, d[0], d[1])
        if m < CATCH:
            served += 1.0 - m / CATCH
    s["nearbyArrivals"] = round(served)

barrier_dna = {}
shops_by_dong = {}
for s in shops:
    barrier_dna[s["barrier"]] = barrier_dna.get(s["barrier"], 0) + 1
    shops_by_dong[s["dong"]] = shops_by_dong.get(s["dong"], 0) + 1

out = {
    "meta": {
        "period": "2025-03 ~ 2026-03",
        "scope": "해운대구 전체 (2026 DIVE 본선)",
        "catchmentM": 400,
        "note": "두리발 하차(completed) × 윌체어 무장애가게 12개 Y/N 실사(구 전수). "
                "진입→이용→편의 사슬. 하차 좌표는 ~100m 반올림(집계 표시 규칙).",
    },
    "shops": shops,
    "dropoffs": drops_out,
    "summary": {
        "arrivals": len(drops_out),
        "shops": len(shops),
        "enterable": sum(s["enterable"] for s in shops),
        "usable": sum(s["usable"] for s in shops),
        "comfort": sum(s["comfort"] for s in shops),
        "barrierDNA": barrier_dna,
        "dropoffsByDong": dict(sorted(dropoffs_by_dong.items(), key=lambda kv: -kv[1])),
        "shopsByDong": dict(sorted(shops_by_dong.items(), key=lambda kv: -kv[1])),
    },
}
json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("src:", SRC)
print("skipped: shops=%d drops=%d" % (skipped_shops, skipped_drops))
print("wrote", OUT, "(%d KB)" % (os.path.getsize(OUT) // 1024))
print("summary:", json.dumps({k: v for k, v in out["summary"].items()
                              if k not in ("dropoffsByDong", "shopsByDong")}, ensure_ascii=False))
print("dropoffsByDong:", json.dumps(out["summary"]["dropoffsByDong"], ensure_ascii=False))
print("shopsByDong:", json.dumps(out["summary"]["shopsByDong"], ensure_ascii=False))
