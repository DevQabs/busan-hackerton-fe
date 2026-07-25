#!/usr/bin/env python3
"""Generate public/data/dong_compare.json for the 접근성 사각지대 step-1
"수요와 인프라, 어디서 어긋나는가" comparison view (5-chip toggle).

Sources (raw files live OUTSIDE the repo, DIVE folder — house rule):
  1. 두리발 본선 CSV (해운대, 2025-03~2026-03, utf-8-sig, 11 cols)
     — 목적지행정동별 접수/완료/미충족. 미충족 = 하차시간 없음(취소+미배차).
  2. 편의시설 4종 xlsx (04 화장실 / 05 주차장 / 06 충전소 / 07 승강기),
     리스트 시트는 sheet5. 행정동 오염 표기('반여동','우동')는 스킵 후 meta 기록.
  3. 장애인 등록현황 xlsx(08) — '25.12' 시트(sheet15), 지역 캐리 + 나이=='합계'.
  4. 시간대_행정동별 인구이동건수 CSV (cp949, 2022-04~06, 행정동코드 10자리)
     — 일반인 이동의 공간·시간 분포 "기준선" (시점 상이 — meta에 각주).

격차(gapPp) = (두리발 도착 비중 − 일반인 이동 비중) × 100 [%p].
음수가 클수록 "일반인은 가는데 교통약자는 못 가는" 동.
per1k(1천명당 도착)는 도착(목적지) 기준 — 거주자 이용률이 아님.

Run: python3 analysis/build_dong_compare.py
"""
import csv
import json
import os
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
import common  # noqa: E402

DIVE = os.path.dirname(os.path.dirname(ROOT))  # …/DIVE
FINALS = os.path.join(DIVE, "본선데이터")
EXTRA = os.path.join(DIVE, "자료", "추가데이터")

F_TRIPS = os.path.join(
    FINALS, "01.해운대구_두리발 교통약자 이동수요 데이터_20250301_20260331.csv")
F_FAC = {
    "restroom": os.path.join(FINALS, "04.해운대구_장애인 화장실 데이터.xlsx"),
    "parking": os.path.join(FINALS, "05.해운대구_장애인 주차장 데이터.xlsx"),
    "charger": os.path.join(FINALS, "06.해운대구_휠체어 충전소 데이터.xlsx"),
    "elevator": os.path.join(FINALS, "07.해운대구_장애인용 승강기 데이터.xlsx"),
}
F_DISAB = os.path.join(
    FINALS, "08.해운대구_장애인 연령 및 장애정도별 등록 현황_202410~202512.xlsx")
F_MOVE = os.path.join(
    EXTRA, "부산광역시_시간대_행정동별 인구이동건수_20220630.csv")
OUT = os.path.join(ROOT, "public", "data", "dong_compare.json")

GU_PREFIX = "부산광역시 해운대구 "
FAC_SHEET = "xl/worksheets/sheet5.xml"
DISAB_SHEET = "xl/worksheets/sheet15.xml"  # 2025.12


def canon(name):
    """'반여제1동'/'부산광역시 해운대구 반여1동' → '반여1동' (join key)."""
    n = (name or "").replace("　", "").strip()
    if n.startswith(GU_PREFIX):
        n = n[len(GU_PREFIX):]
    return n.replace("제", "").strip()


# ── 1) 두리발: 동별 접수/완료/미충족 + 시간대 접수 분포 ──────────────────────
calls, completed, hour_counts = {}, {}, [0] * 24
other_dest = 0
with open(F_TRIPS, encoding="utf-8-sig", newline="") as f:
    for r in csv.DictReader(f):
        dong_raw = (r["목적지행정동"] or "").strip()
        if "해운대구" not in dong_raw:
            other_dest += 1
            continue
        d = canon(dong_raw)
        calls[d] = calls.get(d, 0) + 1
        if (r["하차시간"] or "").strip():
            completed[d] = completed.get(d, 0) + 1
        recv = (r["접수시간"] or "").strip()
        if recv:
            hour_counts[datetime.strptime(recv, "%Y/%m/%d %H:%M:%S").hour] += 1

# ── 2) 편의시설 4종: 동별 개수 ───────────────────────────────────────────────
fac_by_dong = {}
fac_skipped = {}
for key, path in F_FAC.items():
    rows = list(common.iter_xlsx_rows(path, sheet_path=FAC_SHEET))
    h = rows[0]
    di = h.index("행정동")
    for r in rows[1:]:
        if not any((c or "").strip() for c in r):
            continue
        d = canon(r[di])
        if d not in calls:  # 오염 표기('반여동','우동' 등) — 실동 아님
            fac_skipped[d] = fac_skipped.get(d, 0) + 1
            continue
        fac_by_dong.setdefault(d, {k: 0 for k in F_FAC})
        fac_by_dong[d][key] += 1

# ── 3) 등록장애인 (2025.12): 지역 캐리 + 나이=='합계' 행 ─────────────────────
disabled = {}
region = None
for r in common.iter_xlsx_rows(F_DISAB, sheet_path=DISAB_SHEET):
    if (r[1] or "").strip():
        region = (r[1] or "").strip()
    if (r[2] or "").strip() == "합계" and region and region != "합계":
        disabled[canon(region)] = int(r[3])

# ── 4) 인구이동 (2022-04~06): 동별·시간대별 일반인 이동 ──────────────────────
move_by_dong, move_hour, dong_code = {}, [0] * 24, {}
with open(F_MOVE, encoding="cp949", newline="") as f:
    for r in csv.DictReader(f):
        if not r["행정동코드"].startswith("2635"):  # 해운대구 26350
            continue
        d = canon(r["행정동명"])
        n = int(r["이동건수"])
        move_by_dong[d] = move_by_dong.get(d, 0) + n
        move_hour[int(r["시간대"])] += n
        dong_code[d] = r["행정동코드"]

# ── 5) 결합 ──────────────────────────────────────────────────────────────────
total_calls = sum(calls.values())
total_completed = sum(completed.values())
total_move = sum(move_by_dong.values())
total_hour = sum(hour_counts)
total_move_hour = sum(move_hour)

dongs = []
for d in sorted(calls, key=lambda x: -calls[x]):
    fac = fac_by_dong.get(d, {k: 0 for k in F_FAC})
    comp = completed.get(d, 0)
    dis = disabled.get(d, 0)
    dshare = comp / total_completed
    mshare = move_by_dong.get(d, 0) / total_move
    dongs.append({
        "name": d,
        "code": dong_code.get(d),
        "calls": calls[d],
        "completed": comp,
        "unmet": calls[d] - comp,
        "unmetRate": round((calls[d] - comp) / calls[d], 4),
        "fac": fac,
        "facTotal": sum(fac.values()),
        "disabled": dis,
        "per1k": round(comp / dis * 1000, 1) if dis else None,
        "duribalShare": round(dshare, 4),
        "moveShare": round(mshare, 4),
        "gapPp": round((dshare - mshare) * 100, 2),
    })

hourly = [{
    "hour": h,
    "duribalShare": round(hour_counts[h] / total_hour, 4),
    "generalShare": round(move_hour[h] / total_move_hour, 4),
} for h in range(24)]

out = {
    "meta": {
        "duribalPeriod": "2025-03 ~ 2026-03 (본선 해운대, 43,891건)",
        "moveBasis": "부산광역시 시간대·행정동별 인구이동건수 2022-04~06 — "
                     "일반인 이동의 공간·시간 분포 기준선(시점 상이 각주 필수)",
        "disabledAsOf": "2025-12 등록장애인",
        "note": "per1k·격차의 두리발 값은 도착(목적지) 기준 — 거주자 이용률 아님. "
                "gapPp = (두리발 도착 비중 − 일반인 이동 비중)×100. "
                f"관외/타구 목적지 {other_dest}건 제외, "
                f"시설 오염 표기 스킵 {sum(fac_skipped.values())}건 {fac_skipped}.",
    },
    "totals": {"calls": total_calls, "completed": total_completed,
               "unmet": total_calls - total_completed},
    "dongs": dongs,
    "hourly": hourly,
}

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

# ── sanity ───────────────────────────────────────────────────────────────────
assert len(dongs) == 18, f"expected 18 dongs, got {len(dongs)}"
assert abs(sum(d["duribalShare"] for d in dongs) - 1) < 0.01
assert abs(sum(h["generalShare"] for h in hourly) - 1) < 0.01
assert all(d["disabled"] > 0 for d in dongs), "등록장애인 join 누락"
assert all(d["code"] for d in dongs), "행정동코드 join 누락"
top_gap = min(dongs, key=lambda d: d["gapPp"])
print(f"OK dong_compare.json — {len(dongs)}동, "
      f"호출1위 {dongs[0]['name']} {dongs[0]['calls']}, "
      f"격차최대 {top_gap['name']} {top_gap['gapPp']}%p, "
      f"{os.path.getsize(OUT)//1024}KB")
