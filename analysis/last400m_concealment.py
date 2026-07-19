#!/usr/bin/env python3
"""Standalone prototype for the "Last 400m" concept — read-only, pure stdlib.

Does NOT touch build_all.py / validate.py. Reads existing artifacts and answers
one question the flagship demo depends on: does a clean HERO EXAMPLE exist —
a 행정동 that looks benign on the administrative choropleth but hides a severe
arrival microzone? Also emits the QA list of desert cells with no dong.

Run:  python3 analysis/last400m_concealment.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")


def load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as fh:
        return json.load(fh)


def main():
    deserts = load("arrival_deserts.json")
    dongs_fc = load("dongs.geojson")
    cells = deserts["cells"]

    # --- dong-level administrative signal: rank all 206 by gapScore desc ---
    dongs = [f["properties"] for f in dongs_fc["features"]]
    by_gap = sorted(dongs, key=lambda p: -p["gapScore"])
    admin_rank = {}       # name -> 1..206 (1 = worst infra at dong level)
    dong_meta = {}        # name -> props
    for i, p in enumerate(by_gap):
        admin_rank[p["name"]] = i + 1
        dong_meta[p["name"]] = p
    n_dong = len(by_gap)

    # --- group arrival-desert cells by dong ---
    cells_by_dong = {}
    no_dong = []
    for c in cells:
        d = c.get("dong")
        if d is None:
            no_dong.append(c)
        else:
            cells_by_dong.setdefault(d, []).append(c)

    # =====================================================================
    print("=" * 72)
    print("A. QA — desert cells with NO 행정동 (must be resolved before demo)")
    print("=" * 72)
    for c in no_dong:
        print(f"  rank#{c['rank']:>3} score={c['score']:>6} dropoffs={c['dropoffs']:>4}"
              f"  @({c['lat']},{c['lng']})  lack={c['lack']}")
    print(f"  → {len(no_dong)} cell(s) unassigned; "
          f"{sum(x['dropoffs'] for x in no_dong)} dropoffs float outside every polygon\n")

    # =====================================================================
    # B. CONCEALMENT HEROES — benign-looking dong that hides a severe microzone.
    #    A dong "looks fine" if its administrative rank is NOT in the worst
    #    tercile (rank > 69) and its gapClass is not the HL priority class.
    #    It "hides severity" if it contains a citywide top-30 desert cell.
    # =====================================================================
    print("=" * 72)
    print("B. CONCEALMENT HEROES — 동 looks OK administratively, hides a red cell")
    print("=" * 72)
    heroes = []
    for name, cs in cells_by_dong.items():
        worst = min(cs, key=lambda c: c["rank"])      # best (smallest) citywide rank
        meta = dong_meta.get(name)
        if meta is None:
            continue
        arank = admin_rank[name]
        heroes.append({
            "name": name, "gu": meta["gu"], "gapClass": meta["gapClass"],
            "adminRank": arank, "adminPct": round(100 * arank / n_dong),
            "worstCellRank": worst["rank"], "worstScore": worst["score"],
            "worstDropoffs": worst["dropoffs"], "worstLack": worst["lack"],
            "nCells": len(cs),
            "concealGap": arank - worst["rank"],  # big positive = benign dong, severe cell
        })
    # sort: most "hidden" first — dong ranks late, but owns an early cell
    heroes.sort(key=lambda h: (-h["concealGap"], h["worstCellRank"]))
    for h in heroes[:12]:
        flag = "  <-- HERO" if (h["adminRank"] > 69 and h["worstCellRank"] <= 30
                                and h["gapClass"] != "HL") else ""
        print(f"  {h['name']:<7}({h['gu']:<5}) admin #{h['adminRank']:>3}/{n_dong} "
              f"({h['adminPct']:>2}%, {h['gapClass']}) | worst microzone: citywide "
              f"#{h['worstCellRank']:<3} score={h['worstScore']:>5} "
              f"{h['worstDropoffs']:>4} dropoffs | {h['nCells']} cell(s){flag}")
    print()

    # =====================================================================
    # C. INTRA-DONG HETEROGENEITY — the "administrative average lies" list.
    #    Dongs with >=3 desert cells, ranked by max/min score spread.
    # =====================================================================
    print("=" * 72)
    print("C. INTRA-DONG SPREAD — one average conceals N-fold internal variation")
    print("=" * 72)
    spreads = []
    for name, cs in cells_by_dong.items():
        if len(cs) < 3:
            continue
        scores = [c["score"] for c in cs]
        hi, lo = max(scores), min(scores)
        spreads.append({
            "name": name, "gu": dong_meta[name]["gu"], "n": len(cs),
            "hi": hi, "lo": lo, "ratio": round(hi / lo, 1) if lo else None,
            "adminRank": admin_rank[name],
        })
    spreads.sort(key=lambda s: -(s["ratio"] or 0))
    for s in spreads[:10]:
        print(f"  {s['name']:<7}({s['gu']:<5}) {s['n']:>2} cells | "
              f"score {s['lo']:>4} … {s['hi']:>5}  ({s['ratio']}x spread) | "
              f"admin #{s['adminRank']}/{n_dong}")
    print()

    # =====================================================================
    print("=" * 72)
    print("VERDICT")
    print("=" * 72)
    strong = [h for h in heroes if h["adminRank"] > 69 and h["worstCellRank"] <= 30
              and h["gapClass"] != "HL"]
    if strong:
        b = strong[0]
        print(f"  Best hero for demo step 1-2: {b['name']} ({b['gu']}).")
        print(f"  '이 동은 접근성 지표 상위 사각지대가 아닙니다 — 부산 {n_dong}개 동 중 "
              f"#{b['adminRank']} ({b['gapClass']}).'")
        print(f"  '그러나 이 동 안에는 부산 전체 도착 사각지대 #{b['worstCellRank']} "
              f"미시존이 숨어 있습니다: {b['worstDropoffs']}건 하차, {b['worstLack']}.'")
    else:
        print("  No dong is both administratively benign AND hides a top-30 cell.")
        print("  → Lead instead with INTRA-DONG spread (section C): the average hides")
        print("    N-fold variation even inside already-flagged dongs.")


if __name__ == "__main__":
    main()
