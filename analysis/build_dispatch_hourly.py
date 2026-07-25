#!/usr/bin/env python3
"""Generate public/data/haeundae_dispatch.json — 통계 씬 탭1 "미배차 통계".

본선 해운대 두리발 xlsx(2025-03~2026-03, 43,891건)에서:
  - 시간대별 접수 건수와 미배차 확률 (미배차 = 배차시간이 아예 없는 접수 —
    '기다리다 취소'도 배차 실패로 포함, 즉시 취소(변심)도 섞여 있음을 meta에 명시)
  - 시간대별 운행대수 추정: 본선 데이터에는 차량 ID가 없어 [배차, 하차] 구간이
    각 날짜의 h:30 시각을 덮는 "동시 진행 운행 건수"로 추정한다
    (pipeline/build_all.py wait_km fleet 로직과 동일 샘플링, 차량집합 대신 건수).

Run: python3 analysis/build_dispatch_hourly.py
"""
import json
import os
import sys
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
import common  # noqa: E402

DIVE = os.path.dirname(os.path.dirname(ROOT))  # …/DIVE
XLSX_NAME = "01.해운대구_두리발 교통약자 이동수요 데이터_20250301_20260331.xlsx"


def _find(*candidates):
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return candidates[-1]


F_TRIPS = _find(
    os.path.join(DIVE, "본선데이터", XLSX_NAME),
    os.path.join(os.path.dirname(ROOT), "data", "해운대구", XLSX_NAME),
)
OUT = os.path.join(ROOT, "public", "data", "haeundae_dispatch.json")

FMT = "%Y/%m/%d %H:%M:%S"


def ts(v):
    v = (v or "").strip()
    if not v:
        return None
    return datetime.strptime(v, FMT)


rows = iter(common.iter_xlsx_rows(F_TRIPS))
header = next(rows)
idx = {name: i for i, name in enumerate(header)}


def col(r, name):
    i = idx[name]
    return (r[i] if i < len(r) else "") or ""


requests = [0] * 24
unassigned = [0] * 24
completed_h = [0] * 24
assign_wait = [[] for _ in range(24)]  # 접수→배차 분 (배차 성공 건)
monthly = {}  # 'YYYY-MM' → {"requests": n, "unassigned": u}
tot = {"requests": 0, "unassigned": 0, "completed": 0, "cancelled": 0}
fleet_rows = []  # (배차 dt, 하차 dt)
fleet_skipped = 0
d_min, d_max = None, None

for r in rows:
    t_recv = ts(col(r, "접수시간"))
    if t_recv is None:
        continue
    t_assign = ts(col(r, "배차시간"))
    t_drop = ts(col(r, "하차시간"))
    t_cancel = ts(col(r, "취소시간"))

    h = t_recv.hour
    tot["requests"] += 1
    requests[h] += 1
    ym = t_recv.strftime("%Y-%m")
    m = monthly.setdefault(ym, {"requests": 0, "unassigned": 0})
    m["requests"] += 1
    if t_assign is None:
        tot["unassigned"] += 1
        unassigned[h] += 1
        m["unassigned"] += 1
    else:
        wait_min = (t_assign - t_recv).total_seconds() / 60.0
        if 0 <= wait_min <= 24 * 60:
            assign_wait[h].append(wait_min)
    if t_drop is not None:
        tot["completed"] += 1
        completed_h[h] += 1
    if t_cancel is not None:
        tot["cancelled"] += 1

    day = t_recv.date()
    d_min = day if d_min is None or day < d_min else d_min
    d_max = day if d_max is None or day > d_max else d_max

    # 운행 추정: 배차~하차 둘 다 있는 건만, 병리적 구간(24h 초과·역순)은 제외
    if t_assign is not None and t_drop is not None:
        span_h = (t_drop - t_assign).total_seconds() / 3600.0
        if 0 < span_h <= 24:
            fleet_rows.append((t_assign, t_drop))
        else:
            fleet_skipped += 1

# ── 동시 운행 건수: 각 날짜 h:30 시각을 덮는 [배차, 하차] 구간 수 ────────────
slot_cnt = {}  # (date, hour) → count
for ta, td in fleet_rows:
    t = ta.replace(minute=30, second=0, microsecond=0)
    if t < ta:
        t += timedelta(hours=1)
    while t <= td:
        key = (t.date(), t.hour)
        slot_cnt[key] = slot_cnt.get(key, 0) + 1
        t += timedelta(hours=1)

n_days = (d_max - d_min).days + 1
all_days = [d_min + timedelta(days=i) for i in range(n_days)]

def p50(vals):
    if not vals:
        return None
    s = sorted(vals)
    return round(s[len(s) // 2], 1)


hourly = []
for h in range(24):
    per_day = [slot_cnt.get((d, h), 0) for d in all_days]
    req = requests[h]
    una = unassigned[h]
    hourly.append({
        "hour": h,
        "requests": req,
        "unassigned": una,
        "unassignedRate": round(una / req, 4) if req else 0.0,
        "avgActive": round(sum(per_day) / n_days, 1),
        "maxActive": max(per_day),
        "p50AssignMin": p50(assign_wait[h]),  # 접수→배차 중앙값(분), 배차 성공 건
    })

monthly_out = [
    {
        "ym": ym,
        "requests": m["requests"],
        "unassigned": m["unassigned"],
        "unassignedRate": round(m["unassigned"] / m["requests"], 4),
    }
    for ym, m in sorted(monthly.items())
]

out = {
    "meta": {
        "period": f"{d_min} ~ {d_max} (본선 해운대, {tot['requests']:,}건)",
        "status": "final",
        "note": (
            "미배차 = 배차시간이 없는 접수(기다리다 취소한 건 포함, 접수 직후 "
            "변심 취소도 섞임). 운행대수는 차량 ID 미제공으로 [배차, 하차] 구간이 "
            "각 날짜 h:30을 덮는 동시 진행 건수 추정 — 실제 가용 차량 수의 하한."
        ),
        "fleetSkipped": fleet_skipped,
    },
    "totals": tot,
    "hourly": hourly,
    "monthly": monthly_out,
}

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

print(f"wrote {OUT}")
print(f"  totals {tot} | days {n_days} | fleet rows {len(fleet_rows)} "
      f"(skipped {fleet_skipped})")
peak = max(hourly, key=lambda x: x["unassignedRate"] if x["requests"] >= 100 else 0)
busy = max(hourly, key=lambda x: x["avgActive"])
print(f"  peak unassignedRate: {peak['hour']}시 {peak['unassignedRate']:.1%} "
      f"({peak['requests']}건) | busiest fleet: {busy['hour']}시 avg {busy['avgActive']}")
