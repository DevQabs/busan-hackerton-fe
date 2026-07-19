#!/usr/bin/env python3
"""Gate 0 profiler — point it at a finals CSV (Wheelchair 무장애가게 audit, or the
new 두리발 export) the moment it arrives and it answers the kill-criteria:

  1. Does it have usable coordinates?          -> coord detection + Busan/해운대 coverage
  2. Can you tell `N` from blank / unknown?    -> per categorical column: value split
  3. What's the scope and fill quality?        -> rows, columns, per-column fill rate

Pure stdlib, read-only. Usage:
    python3 analysis/gate0_profile.py <path-to.csv> [encoding]
"""
import csv
import sys
from collections import Counter

BUSAN = dict(lat=(34.9, 35.5), lng=(128.7, 129.5))
HAEUNDAE = dict(lat=(35.14, 35.24), lng=(129.10, 129.22))
YN_TOKENS = {"y", "n", "예", "아니오", "아니요", "있음", "없음", "o", "x", "유", "무",
             "가능", "불가", "가능함", "불가능", "true", "false", "네", "1", "0"}
BLANKS = {"", "-", "na", "n/a", "null", "none", "미상", "해당없음", "."}


def sniff_encoding(path, hint=None):
    for enc in ([hint] if hint else []) + ["utf-8-sig", "cp949", "utf-8", "latin-1"]:
        try:
            with open(path, encoding=enc) as fh:
                fh.read(4096)
            return enc
        except (UnicodeDecodeError, LookupError):
            continue
    return "latin-1"


def is_num(s):
    try:
        float(s)
        return True
    except ValueError:
        return False


def in_range(v, lo, hi):
    return lo <= v <= hi


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    path = sys.argv[1]
    enc = sniff_encoding(path, sys.argv[2] if len(sys.argv) > 2 else None)
    with open(path, encoding=enc, newline="") as fh:
        rows = list(csv.reader(fh))
    if not rows:
        print("empty file")
        sys.exit(1)
    header, data = rows[0], rows[1:]
    ncol = len(header)
    print(f"file        : {path}")
    print(f"encoding     : {enc}")
    print(f"rows         : {len(data)}   columns: {ncol}\n")

    cols = list(zip(*data)) if data else [() for _ in header]
    lat_cols, lng_cols = [], []

    print("PER-COLUMN PROFILE (fill% | distinct | Y/N split | samples)")
    print("-" * 72)
    for i, name in enumerate(header):
        vals = cols[i] if i < len(cols) else ()
        nonblank = [v for v in vals if v.strip().lower() not in BLANKS]
        fill = round(100 * len(nonblank) / len(vals)) if vals else 0
        distinct = len(set(nonblank))
        low = [v.strip().lower() for v in nonblank]

        # coordinate detection
        nums = [float(v) for v in nonblank if is_num(v)]
        if nums and len(nums) / max(len(nonblank), 1) > 0.8:
            if sum(in_range(x, *BUSAN["lat"]) for x in nums) / len(nums) > 0.7:
                lat_cols.append(i)
            elif sum(in_range(x, *BUSAN["lng"]) for x in nums) / len(nums) > 0.7:
                lng_cols.append(i)

        # Y/N-ness
        ynshare = sum(1 for v in low if v in YN_TOKENS) / max(len(low), 1)
        ynnote = ""
        if ynshare > 0.6 and distinct <= 6:
            c = Counter(low)
            blanks = len(vals) - len(nonblank)
            ynnote = f" | Y/N split: {dict(c.most_common(4))} +blank={blanks}"

        samples = ", ".join(list(dict.fromkeys(nonblank))[:3])
        print(f"  [{i:>2}] {name[:22]:<22} {fill:>3}% | {distinct:>4} distinct{ynnote}"
              f" | e.g. {samples[:40]}")

    # -------------------------------------------------------------------
    print("\n" + "=" * 72)
    print("KILL-CRITERIA VERDICT")
    print("=" * 72)
    if lat_cols and lng_cols:
        li, gi = lat_cols[0], lng_cols[0]
        pairs = [(float(a), float(b)) for a, b in zip(cols[li], cols[gi])
                 if is_num(a) and is_num(b)]
        nb = sum(in_range(la, *BUSAN["lat"]) and in_range(lo, *BUSAN["lng"])
                 for la, lo in pairs)
        nh = sum(in_range(la, *HAEUNDAE["lat"]) and in_range(lo, *HAEUNDAE["lng"])
                 for la, lo in pairs)
        print(f"  [1] COORDS: YES — lat=col#{li}({header[li]}), lng=col#{gi}({header[gi]})")
        print(f"      in Busan bbox: {nb}/{len(pairs)} ({round(100*nb/max(len(pairs),1))}%)"
              f" | in 해운대 rough bbox: {nh} ({round(100*nh/max(len(pairs),1))}%)")
        if nb / max(len(pairs), 1) < 0.5:
            print("      ⚠ most points fall OUTSIDE Busan — check lat/lng swap or CRS")
    else:
        print("  [1] COORDS: NONE detected — concept degrades to name/address join only")
        print("      → if no geocodable address column either, this is a KILL signal")
    print("  [2] N-vs-blank: inspect the 'Y/N split' columns above — if a field shows"
          " only Y and blank (no explicit N), you CANNOT treat blank as N.")
    print(f"  [3] SCOPE: {len(data)} rows, {ncol} cols. Confirm this is 해운대 and that"
          " the 12 audit fields are among the columns.")


if __name__ == "__main__":
    main()
