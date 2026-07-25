#!/usr/bin/env python3
"""2026 DIVE 본선 해운대구 원본 xlsx(02, 04~11) → public/data/haeundae_*.json 변환.

access_actions.json(01+03)이 다루지 않는 나머지 9개 파일 전부를 UI가 fetch로
읽을 수 있는 JSON 산출물로 만든다. 기존 계약(lib/types.ts)은 건드리지 않는
신규 standalone 아티팩트 — UI 연결은 팀 결정 후 별도 작업.

원본 위치: <codeVodca>/data/해운대구/ (fallback: ~/Desktop/해운대구 데이터)
산출물:
  haeundae_facilities.json  04~07 편의시설 4종 통합 (화장실/주차장/충전소/승강기)
  haeundae_shops.json       02 상가(음식점) 5,147곳
  haeundae_population.json  09 행정동×월×5세구간 주민등록인구
  haeundae_disability.json  08 행정동×월 장애인 등록(성별·정도·연령대)
  haeundae_buildings.json   10 총괄표제부 + 11 표제부 (접근성 관련 컬럼 slim)

데이터 특성 메모:
  - 편의시설 '행정동' 컬럼에 법정동 표기·오매핑이 소수 섞여 있어, 좌표
    point-in-polygon 판정(dongs.geojson)을 dong으로 쓰고 원본과 다르면
    dongSrc에 원본 값을 남긴다.
  - 09는 '우제1동' 식 표기 → 두리발/경계 표기('우1동')로 정규화.
  - 10/11에는 좌표가 없다(주소·법정동 단위).

Run: python3 analysis/build_haeundae_datasets.py
"""
import json
import os
import re
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
OUT_DIR = os.path.join(ROOT, "public", "data")
GU_PREFIX = "부산광역시 해운대구 "
PERIOD_NOTE = "2026 DIVE 본선 데이터 (해운대구)"


def src(name):
    return os.path.join(SRC, name)


def out(name, obj):
    p = os.path.join(OUT_DIR, name)
    json.dump(obj, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("wrote %s (%d KB)" % (p, os.path.getsize(p) // 1024))


def norm_dong(name):
    """'우제1동'/'부산광역시 해운대구 우1동' → '우1동' (경계/두리발 표기)."""
    n = (name or "").strip()
    if n.startswith(GU_PREFIX):
        n = n[len(GU_PREFIX):]
    return re.sub(r"제(\d)", r"\1", n)


def short_addr(addr):
    """주소에서 '부산광역시 해운대구 ' 접두어 제거 (파일 크기·표시용)."""
    a = (addr or "").strip()
    return a[len(GU_PREFIX):] if a.startswith(GU_PREFIX) else a


def to_int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# 행정동 경계 — 해운대구 18개 동만 point-in-polygon 대상으로 로드
dongs_geo = json.load(open(os.path.join(OUT_DIR, "dongs.geojson"), encoding="utf-8"))
LOC = common.DongLocator([f for f in dongs_geo["features"]
                          if f["properties"].get("gu") == "해운대구"])


def dong_of(lng, lat):
    f = LOC.locate(lng, lat)
    return f["properties"]["name"] if f else None


# ── 1. 편의시설 4종 (04~07) ──────────────────────────────────────────────────
FACILITY_FILES = [
    ("toilet",   "04.해운대구_장애인 화장실 데이터.xlsx"),
    ("parking",  "05.해운대구_장애인 주차장 데이터.xlsx"),
    ("charger",  "06.해운대구_휠체어 충전소 데이터.xlsx"),
    ("elevator", "07.해운대구_장애인용 승강기 데이터.xlsx"),
]
points = []
for ftype, fn in FACILITY_FILES:
    p = src(fn)
    # 리스트 시트는 항상 마지막 워크시트("04.○○ 리스트")
    import zipfile
    ws = sorted([n for n in zipfile.ZipFile(p).namelist()
                 if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)],
                key=lambda n: int(re.search(r"\d+", n.split("/")[-1]).group()))
    rows = list(common.iter_xlsx_rows(p, sheet_path=ws[-1]))
    h = rows[0]
    ix = {n: h.index(n) for n in h}
    for r in rows[1:]:
        if not any((c or "").strip() for c in r):
            continue
        lat, lng = to_float(r[ix["위도"]]), to_float(r[ix["경도"]])
        raw_dong = norm_dong(r[ix["행정동"]])
        geo = dong_of(lng, lat) if lat and lng else None
        rec = {
            "type": ftype,
            "name": (r[ix["시설물명"]] or "").strip(),
            "kind": (r[ix["시설물 구분"]] or "").strip(),
            "addr": short_addr(r[ix["소재지 주소"]]),
            "dong": geo or raw_dong or "미상",
            "lng": round(lng, 6) if lng else None,
            "lat": round(lat, 6) if lat else None,
        }
        if geo and raw_dong and geo != raw_dong:
            rec["dongSrc"] = raw_dong  # 원본 표기가 좌표 판정과 다른 경우 보존
        points.append(rec)

by_type = {}
fac_by_dong = {}
for pt in points:
    by_type[pt["type"]] = by_type.get(pt["type"], 0) + 1
    d = fac_by_dong.setdefault(pt["dong"], {t: 0 for t, _ in FACILITY_FILES})
    d[pt["type"]] += 1
out("haeundae_facilities.json", {
    "meta": {"source": "04~07 윌체어 편의시설 실사 4종", "note": PERIOD_NOTE +
             " — dong은 좌표 폴리곤 판정, 원본 표기와 다르면 dongSrc에 보존"},
    "points": points,
    "summary": {"total": len(points), "byType": by_type,
                "byDong": dict(sorted(fac_by_dong.items()))},
})

# ── 2. 상가(음식점) (02) ─────────────────────────────────────────────────────
rows = list(common.iter_xlsx_rows(src("02.해운대구_상가(상권)정보_202603.xlsx")))
h = rows[0]
ix = {n: h.index(n) for n in h}
shops = []
shop_by_dong = {}
for r in rows[1:]:
    if not any((c or "").strip() for c in r):
        continue
    lat, lng = to_float(r[ix["위도"]]), to_float(r[ix["경도"]])
    dong = norm_dong(r[ix["행정동명"]])
    shops.append({
        "id": r[ix["상가업소번호"]],
        "name": (r[ix["상호명"]] or "").strip(),
        "branch": (r[ix["지점명"]] or "").strip() or None,
        "cat": [r[ix["상권업종대분류명"]], r[ix["상권업종중분류명"]], r[ix["상권업종소분류명"]]],
        "dong": dong,
        "bjdong": r[ix["법정동명"]],
        "addr": short_addr(r[ix["도로명주소"]]),
        "floor": (r[ix["층정보"]] or "").strip() or None,
        "lng": round(lng, 6) if lng else None,
        "lat": round(lat, 6) if lat else None,
    })
    shop_by_dong[dong] = shop_by_dong.get(dong, 0) + 1
out("haeundae_shops.json", {
    "meta": {"source": "02 상가(상권)정보 202603 — 음식점만 필터된 원본",
             "note": PERIOD_NOTE},
    "shops": shops,
    "summary": {"total": len(shops),
                "byDong": dict(sorted(shop_by_dong.items(), key=lambda kv: -kv[1]))},
})

# ── 3. 주민등록인구 (09) ─────────────────────────────────────────────────────
rows = list(common.iter_xlsx_rows(
    src("09.해운대구_행정구역_읍면동_별_5세별_주민등록인구_20250301_20260331.xlsx")))
months = [c.replace(".", "-") for c in rows[0][3:] if (c or "").strip()]
regions = []
cur = None
for r in rows[1:]:
    name = (r[0] or "").strip()
    band = (r[2] or "").strip()
    if name:
        cur = {"dong": "해운대구" if name == "해운대구" else norm_dong(name), "bands": {}}
        regions.append(cur)
    if cur is None or not band:
        continue
    key = "계" if band == "계" else band.replace(" - ", "-").replace("세", "")
    cur["bands"][key] = [to_int(v) for v in r[3:3 + len(months)]]
out("haeundae_population.json", {
    "meta": {"source": "09 KOSIS DT_1B04005N 주민등록인구 (행정안전부)",
             "note": PERIOD_NOTE + " — bands 키: '계' 및 '0-4'~'100+', 값은 months 순서"},
    "months": months,
    "regions": regions,
})

# ── 4. 장애인 등록현황 (08) ──────────────────────────────────────────────────
F08 = src("08.해운대구_장애인 연령 및 장애정도별 등록 현황_202410~202512.xlsx")
import zipfile
sheet_names = re.findall(r'<sheet name="([^"]+)"',
                         zipfile.ZipFile(F08).read("xl/workbook.xml").decode("utf-8"))
AGE_BAND = lambda a: "100+" if a >= 100 else "%d-%d" % (a // 10 * 10, a // 10 * 10 + 9)
totals = []      # 월×지역 합계
age_rows = []    # 월×지역×10세 구간
for si, sn in enumerate(sheet_names):
    month = "20" + sn.replace(".", "-")  # '24.10' → '2024-10'
    rows = list(common.iter_xlsx_rows(F08, sheet_path="xl/worksheets/sheet%d.xml" % (si + 1)))
    cur = None
    bands = None
    for r in rows[6:]:  # 데이터는 7행째부터 (0~5행은 제목/헤더)
        name = (r[1] or "").strip()
        if name.startswith("출력일시"):
            break
        if name:
            cur = "해운대구" if name == "합계" else norm_dong(name)
            bands = {}
            # 지역 첫 행 = 그 지역의 '합계' 행
            totals.append({"month": month, "dong": cur,
                           "total": to_int(r[3]), "male": to_int(r[4]), "female": to_int(r[5]),
                           "severe": to_int(r[6]), "severeM": to_int(r[7]), "severeF": to_int(r[8]),
                           "mild": to_int(r[9]), "mildM": to_int(r[10]), "mildF": to_int(r[11])})
            age_rows.append((cur, month, bands))
            continue
        age = to_int(r[2])
        if cur is None or age is None:
            continue
        b = bands.setdefault(AGE_BAND(age), [0, 0, 0])  # [계, 심한, 심하지않은]
        b[0] += to_int(r[3]) or 0
        b[1] += to_int(r[6]) or 0
        b[2] += to_int(r[9]) or 0
ages = [{"month": m, "dong": d, "bands": b} for d, m, b in age_rows]
out("haeundae_disability.json", {
    "meta": {"source": "08 장애인 연령·장애정도별 등록 현황 (해운대구 노인장애인복지과)",
             "note": PERIOD_NOTE + " — bands 값 [전체, 심한 장애, 심하지 않은 장애], "
                     "연령은 10세 구간 집계(원본은 1세 단위)"},
    "months": ["20" + s.replace(".", "-") for s in sheet_names],
    "totals": totals,
    "ages": ages,
})

# ── 5. 건축물대장 (10 총괄표제부 + 11 표제부) ────────────────────────────────
def bjdong_from_addr(addr):
    m = re.search(r"해운대구\s+(\S+동)", addr or "")
    return m.group(1) if m else None

# 11 표제부 — 접근성 관련 컬럼만 slim
rows = common.iter_xlsx_rows(src("11.해운대구_표제부_2026-02-05.xlsx"))
h = next(rows)
ix = {n: h.index(n) for n in h}
buildings = []
bld_by_bjdong = {}
for r in rows:
    if not any((c or "").strip() for c in r):
        continue
    bj = bjdong_from_addr(r[ix["대지위치"]]) or "미상"
    rec = {
        "addr": short_addr(r[ix["대지위치"]]),
        "name": (r[ix["건물명"]] or "").strip() or None,
        "bjdong": bj,
        "kind": r[ix["대장구분코드명"]],          # 일반/집합
        "use": (r[ix["주용도코드명"]] or "").strip() or None,
        "floorsUp": to_int(r[ix["지상층수"]]),
        "floorsDown": to_int(r[ix["지하층수"]]),
        "elevPass": to_int(r[ix["승용승강기수"]]),   # 승용승강기
        "elevEmg": to_int(r[ix["비상용승강기수"]]),  # 비상용승강기
        "households": to_int(r[ix["세대수(세대)"]]),
        "areaM2": to_float(r[ix["연면적(㎡)"]]),
        "approvedYear": (r[ix["사용승인일"]] or "")[:4] or None,
    }
    buildings.append(rec)
    s = bld_by_bjdong.setdefault(bj, {"buildings": 0, "withElevator": 0, "elevators": 0})
    s["buildings"] += 1
    ne = (rec["elevPass"] or 0) + (rec["elevEmg"] or 0)
    if ne > 0:
        s["withElevator"] += 1
        s["elevators"] += ne

# 10 총괄표제부 — 단지 단위(주차 총계 포함)
rows = common.iter_xlsx_rows(src("10.해운대구_총괄표제부_2026-02-05.xlsx"))
h = next(rows)
ix = {n: h.index(n) for n in h}
complexes = []
for r in rows:
    if not any((c or "").strip() for c in r):
        continue
    complexes.append({
        "addr": short_addr(r[ix["대지위치"]]),
        "name": (r[ix["건물명"]] or "").strip() or None,
        "bjdong": bjdong_from_addr(r[ix["대지위치"]]) or "미상",
        "use": (r[ix["주용도코드명"]] or "").strip() or None,
        "households": to_int(r[ix["세대수(세대)"]]),
        "parkingTotal": to_int(r[ix["총주차수"]]),
        "areaM2": to_float(r[ix["연면적(㎡)"]]),
    })
out("haeundae_buildings.json", {
    "meta": {"source": "11 표제부(동 단위 건물) + 10 총괄표제부(단지 총괄), 2026-02-05 건축물대장",
             "note": PERIOD_NOTE + " — 좌표 없음(법정동·주소 단위). "
                     "elevPass/elevEmg=승용/비상용 승강기 수"},
    "buildings": buildings,
    "complexes": complexes,
    "summary": {"buildings": len(buildings), "complexes": len(complexes),
                "byBjdong": dict(sorted(bld_by_bjdong.items()))},
})

print("src:", SRC)
