#!/usr/bin/env python3
"""Generate public/data/hospital_distance.json — 통계 씬 탭3 "침묵 지역".

질문: 외곽 지역에서 목적지가 병원인 경우, 거리가 너무 멀어서 안 타는가?

5월 전역 두리발 CSV(리허설, 목적·출발/도착 좌표·결과 보유)에서 목적=='병원'
통행만 골라:
  1. 직선거리 구간별 미배차율 — "병원까지 멀수록 배차가 실패하는가"
  2. 출발동별 병원행 평균 직선거리 × 병원행 비중 산점 + 상관/회귀 —
     "병원이 먼 동일수록 병원행 시도 자체가 적은가" (침묵 수요)

주의: 두리발 CSV는 X좌표=위도, Y좌표=경도로 뒤집혀 있다 (pipeline/README).
본선 해운대 데이터에는 출발 좌표·목적 컬럼이 없어 이 분석은 전역 5월 데이터
기준(status: rehearsal) — 본선 재적합 대상.

Run: python3 analysis/build_hospital_distance.py
"""
import csv
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

F_TRIPS_CANDIDATES = [
    os.path.join(os.path.dirname(ROOT), "data",
                 "부산시설공단_부산 교통약자 이동지원 차량 운영현황_20250501.csv"),
]
F_DONGS = os.path.join(ROOT, "public", "data", "dongs.geojson")
OUT = os.path.join(ROOT, "public", "data", "hospital_distance.json")

BBOX = (34.9, 35.5, 128.7, 129.5)  # lat_min, lat_max, lng_min, lng_max
MIN_DONG_TRIPS = 30  # 산점·상관에 포함할 동의 최소 전체 접수 건수


def find_trips():
    for p in F_TRIPS_CANDIDATES:
        if os.path.exists(p):
            return p
    raise SystemExit(f"trips CSV not found: {F_TRIPS_CANDIDATES}")


def haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def canon(name):
    return (name or "").replace("　", "").replace("제", "").replace("일광면", "일광읍").strip()


def parse_latlng(xs, ys):
    """두리발 CSV: X=위도, Y=경도 (뒤집힘). bbox 밖이면 None."""
    try:
        lat, lng = float(xs), float(ys)
    except (TypeError, ValueError):
        return None
    if not (BBOX[0] <= lat <= BBOX[1] and BBOX[2] <= lng <= BBOX[3]):
        return None
    return lat, lng


# ── geojson: (구, canonical 동) → 표기 이름 (지도 조인 키) ────────────────────
with open(F_DONGS, encoding="utf-8") as f:
    gj = json.load(f)
dong_key = {}
for ft in gj["features"]:
    p = ft["properties"]
    dong_key[(p["gu"], canon(p["name"]))] = p["name"]

# ── 병원행 집계 ──────────────────────────────────────────────────────────────
BIN_EDGES = [0.0, 2.0, 5.0, 10.0, float("inf")]
BIN_LABELS = ["0–2km", "2–5km", "5–10km", "10km+"]
bins = [{"label": l, "trips": 0, "unassigned": 0} for l in BIN_LABELS]

per_dong = {}  # (gu, canon) → dict
tot = {"hospTrips": 0, "unassigned": 0, "noCoord": 0}
km_all = []

with open(find_trips(), encoding="cp949", newline="") as f:
    for r in csv.DictReader(f):
        raw = (r["출발지 행정동"] or "").replace("부산광역시", "").strip()
        parts = raw.split()
        key = (parts[0], canon(parts[1])) if len(parts) >= 2 else None
        if key is not None:
            d = per_dong.setdefault(key, {
                "trips": 0, "hosp": 0, "hospUnassigned": 0, "kmSum": 0.0, "kmN": 0,
            })
            d["trips"] += 1

        if (r["목적"] or "").strip() != "병원":
            continue
        tot["hospTrips"] += 1
        fail = (r["결과"] or "").strip() == "미배차"
        if fail:
            tot["unassigned"] += 1
        if key is not None:
            d["hosp"] += 1
            if fail:
                d["hospUnassigned"] += 1

        o = parse_latlng(r["출발지 X좌표"], r["출발지 Y좌표"])
        t = parse_latlng(r["목적지 X좌표"], r["목적지 Y좌표"])
        if o is None or t is None:
            tot["noCoord"] += 1
            continue
        km = haversine_km(o[0], o[1], t[0], t[1])
        km_all.append(km)
        for i in range(len(BIN_LABELS)):
            if BIN_EDGES[i] <= km < BIN_EDGES[i + 1]:
                bins[i]["trips"] += 1
                if fail:
                    bins[i]["unassigned"] += 1
                break
        if key is not None:
            d["kmSum"] += km
            d["kmN"] += 1

for b in bins:
    b["unassignedRate"] = round(b["unassigned"] / b["trips"], 4) if b["trips"] else 0.0

# ── 동별 산점 행 (전체 접수 MIN_DONG_TRIPS건 이상 + 지도 조인 성공만) ────────
dongs_out = []
for (gu, cn), d in per_dong.items():
    if d["trips"] < MIN_DONG_TRIPS or d["kmN"] == 0:
        continue
    name = dong_key.get((gu, cn))
    if name is None:
        continue
    dongs_out.append({
        "name": name,
        "gu": gu,
        "trips": d["trips"],
        "hospTrips": d["hosp"],
        "hospShare": round(d["hosp"] / d["trips"], 4),
        "meanHospKm": round(d["kmSum"] / d["kmN"], 2),
        "failRate": round(d["hospUnassigned"] / d["hosp"], 4) if d["hosp"] else 0.0,
    })
dongs_out.sort(key=lambda x: -x["meanHospKm"])

# ── 상관·회귀: x=병원행 평균 직선거리, y=병원행 비중(%) ──────────────────────
xs = [d["meanHospKm"] for d in dongs_out]
ys = [d["hospShare"] * 100 for d in dongs_out]
n = len(xs)
mx, my = sum(xs) / n, sum(ys) / n
sxx = sum((x - mx) ** 2 for x in xs)
syy = sum((y - my) ** 2 for y in ys)
sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
r_val = sxy / math.sqrt(sxx * syy)
slope = sxy / sxx
intercept = my - slope * mx
t_stat = r_val * math.sqrt((n - 2) / (1 - r_val ** 2))

km_all.sort()
median_km = km_all[len(km_all) // 2]

out = {
    "meta": {
        "period": "2025-05 부산 전역 (리허설)",
        "status": "rehearsal",
        "note": (
            "목적=='병원' 통행만. 거리는 출발→목적지 직선거리(운행경로 아님). "
            f"동별 산점은 전체 접수 {MIN_DONG_TRIPS}건 이상 동만 포함. "
            "본선 해운대 데이터에는 출발 좌표·목적 컬럼이 없어 전역 5월 기준 — "
            "본선 재적합 대상."
        ),
    },
    "totals": {
        "hospTrips": tot["hospTrips"],
        "unassigned": tot["unassigned"],
        "unassignedRate": round(tot["unassigned"] / tot["hospTrips"], 4),
        "medianKm": round(median_km, 2),
        "noCoord": tot["noCoord"],
    },
    "bins": bins,
    "corr": {
        "n": n,
        "pearsonR": round(r_val, 3),
        "slope": round(slope, 4),
        "intercept": round(intercept, 4),
        "t": round(t_stat, 2),
    },
    "dongs": dongs_out,
}

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

print(f"wrote {OUT}")
print(f"  hospTrips {tot['hospTrips']} | unassigned {tot['unassigned']} "
      f"({tot['unassigned']/tot['hospTrips']:.1%}) | noCoord {tot['noCoord']}")
for b in bins:
    print(f"  {b['label']:>7}: {b['trips']:5d}건, 미배차 {b['unassignedRate']:.1%}")
print(f"  dong scatter n={n}, r={r_val:.3f}, t={t_stat:.2f}, "
      f"slope={slope:.3f}%p/km")
print("  외곽(평균거리 상위) 5:",
      [(d['name'], d['meanHospKm'], d['hospShare']) for d in dongs_out[:5]])
