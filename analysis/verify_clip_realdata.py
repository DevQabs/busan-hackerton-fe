#!/usr/bin/env python3
"""End-to-end check of the strict-Busan clip on REAL data, without touching any
committed artifact. Imports the real pipeline, rebuilds the 250m dropoff grid
from the real 두리발 CSV, and runs the (edited) build_arrival_deserts.

The clip depends only on trips + dong polygons, so infra is passed empty here —
scoring is then ~proportional to dropoffs, which is fine for proving that
out-of-Busan cells are removed. Run: python3 analysis/verify_clip_realdata.py
"""
import csv
import math
import os
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
import build_all as B  # noqa: E402  (safe: main-guarded, no module-level file reads)

DATA = os.path.join(ROOT, "data")
LAT_STEP, LNG_STEP = 0.00225, 0.00275

trips = next(os.path.join(DATA, n) for n in os.listdir(DATA)
             if n.endswith(".csv") and "20250501" in n)
feats, _ = B.load_dongs()
locator = B.DongLocator(feats)

dropoff_cells = Counter()
n_completed = 0
with open(trips, encoding="cp949", newline="") as fh:
    for row in csv.DictReader(fh):
        if (row.get("결과") or "").strip() != "하차":
            continue
        n_completed += 1
        d_xy = B.swap_coords(row.get("목적지 X좌표"), row.get("목적지 Y좌표"))
        if d_xy and B.in_bbox(*d_xy):
            cell = (math.floor(d_xy[0] / LNG_STEP), math.floor(d_xy[1] / LAT_STEP))
            dropoff_cells[cell] += 1

# which >=20-dropoff cells fall outside every dong polygon (what the clip drops)?
nodong = []
tot = 0
for (ix, iy), cnt in dropoff_cells.items():
    if cnt < 20:
        continue
    tot += 1
    lng = round((ix + 0.5) * LNG_STEP, 5)
    lat = round((iy + 0.5) * LAT_STEP, 5)
    if locator.locate(lng, lat) is None:
        nodong.append((cnt, lat, lng))
nodong.sort(reverse=True)

print(f"completed dropoffs (결과=하차) parsed : {n_completed}")
print(f"250m cells with >=20 dropoffs        : {tot}")
print(f"OUT-OF-BUSAN cells the clip removes  : {len(nodong)} "
      f"({sum(c for c, _, _ in nodong)} dropoffs)")
for cnt, lat, lng in nodong:
    print(f"    {cnt:>4} dropoffs @({lat},{lng})")

# run the actual edited pipeline function; infra empty -> clip still runs
res, n_total = B.build_arrival_deserts(dropoff_cells, [], locator, {}, None)
cells = res["cells"]
no_dong_out = [c for c in cells if "dong" not in c or c["dong"] is None]
print(f"\nbuild_arrival_deserts() -> {len(cells)} ranked cells (of {n_total}); "
      f"cells with NO dong in output: {len(no_dong_out)}")
print("top 5 (empty-infra scoring ≈ by dropoffs):")
for c in cells[:5]:
    print(f"    #{c['rank']} {c['dong']:<8} {c['dropoffs']:>4} dropoffs  score={c['score']}")
print("\nPASS" if not no_dong_out else "\nFAIL: no-dong cells leaked into output")
