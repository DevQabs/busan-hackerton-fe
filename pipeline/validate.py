"""Validation of all public/data/ artifacts against lib/types.ts contract.

Run after build_all.py: python3 pipeline/validate.py
Exits non-zero on any failure; prints a summary report.
"""
import json
import math
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'public', 'data')

LAT = (34.9, 35.5)
LNG = (128.7, 129.5)

errors = []
lines = []


def check(cond, msg):
    if cond:
        lines.append(f'  OK   {msg}')
    else:
        lines.append(f'  FAIL {msg}')
        errors.append(msg)


def load(name):
    path = os.path.join(OUT, name)
    with open(path, encoding='utf-8') as f:
        obj = json.load(f)
    size = os.path.getsize(path)
    lines.append(f'{name}: parses, {size:,} bytes')
    return obj, size


def in_bbox(lng, lat):
    return LNG[0] <= lng <= LNG[1] and LAT[0] <= lat <= LAT[1]


def main():
    # stats.json
    stats, _ = load('stats.json')
    t = stats['totals']
    check(t['trips'] == 37512, f"totals.trips == 37512 (got {t['trips']})")
    check(t['unassigned'] == 3520, f"totals.unassigned == 3520 (got {t['unassigned']})")
    check(t['completed'] == 32526, f"totals.completed == 32526 (got {t['completed']})")
    check(t['completed'] + t['unassigned'] + t['cancelled'] == t['trips'],
          'completed + unassigned + cancelled == trips')
    check(abs(t['unassignedRate'] - t['unassigned'] / t['trips']) < 1e-3, 'unassignedRate consistent')
    check(len(stats['hourly']) == 24 and [h['hour'] for h in stats['hourly']] == list(range(24)),
          'hourly has 24 entries 0..23')
    check(sum(h['requests'] for h in stats['hourly']) == t['trips'], 'hourly requests sum == trips')
    check(len(stats['byDow']) == 7 and [d['label'] for d in stats['byDow']] == list('월화수목금토일'),
          'byDow 7 entries with Korean labels')
    check(len(stats['topDestDongs']) == 15, 'topDestDongs has 15 entries')
    check(stats['period']['from'] == '2025-05-01' and stats['period']['to'] == '2025-05-31',
          f"period 2025-05-01..2025-05-31 (got {stats['period']})")
    check(0 < stats['waitMinutes']['median'] < stats['waitMinutes']['p90'] < 120,
          f"wait median<p90 sane (got {stats['waitMinutes']})")
    wc = stats['wheelchair']
    check(sum(wc.values()) == t['trips'], 'wheelchair categories sum == trips')

    # dongs.geojson
    dongs, dsize = load('dongs.geojson')
    feats = dongs['features']
    check(len(feats) == 206, f'206 features (got {len(feats)})')
    check(dsize <= 3 * 1024 * 1024, 'dongs.geojson <= 3MB')
    req_keys = {'admCd', 'name', 'gu', 'centroid', 'dropoffs', 'pickups', 'unassigned',
                'cancelled', 'waitMedian', 'chargers', 'hospitals', 'pharmacies', 'welfare',
                'shops', 'shopsFloor1Share', 'demandZ', 'infraZ', 'gapScore', 'gapClass',
                'expectedDropoffs', 'suppressedZ', 'gapCI', 'pTop5'}
    check(all(req_keys <= set(f['properties'].keys()) for f in feats), 'all DongProps keys present')
    check(all(f['properties']['gapClass'] in ('HH', 'HL', 'LH', 'LL') for f in feats),
          'gapClass in {HH,HL,LH,LL}')
    check(all(in_bbox(*f['properties']['centroid']) for f in feats), 'all centroids in bbox')
    top_pick = max(feats, key=lambda f: f['properties']['pickups'])['properties']
    check(top_pick['name'] == '학장동',
          f"top pickup dong is 학장동 (got {top_pick['name']} {top_pick['pickups']})")
    hot = {f['properties']['name']: f['properties'] for f in feats}
    check(hot['학장동']['dropoffs'] > 500, f"학장동 dropoffs > 500 (got {hot['학장동']['dropoffs']})")
    total_drop = sum(f['properties']['dropoffs'] for f in feats)
    check(total_drop > 30000, f'dong dropoffs sum > 30000 (got {total_drop})')
    n_hl = sum(1 for f in feats if f['properties']['gapClass'] == 'HL')
    lines.append(f'  info gapClass HL (사각지대) count: {n_hl}')

    # dongs.geojson — NB/bootstrap fields (suppressedZ, gapCI, pTop5, expectedDropoffs)
    supp = [f['properties']['suppressedZ'] for f in feats]
    n_supp = sum(1 for s in supp if s is not None)
    check(n_supp == 206, f'suppressedZ non-null on all 206 dongs (got {n_supp})')
    check(all(s is None or (isinstance(s, (int, float)) and math.isfinite(s)) for s in supp),
          'suppressedZ finite where not null')
    cis = [f['properties']['gapCI'] for f in feats]
    check(all(ci is None or (len(ci) == 2 and ci[0] <= ci[1]) for ci in cis),
          'gapCI is [lo, hi] with lo <= hi')
    check(all(f['properties']['pTop5'] is None or 0.0 <= f['properties']['pTop5'] <= 1.0
              for f in feats), 'pTop5 in 0..1')
    check(all(f['properties']['expectedDropoffs'] is None
              or f['properties']['expectedDropoffs'] >= 0 for f in feats),
          'expectedDropoffs >= 0')
    n_top5 = sum(1 for f in feats if (f['properties']['pTop5'] or 0) > 0)
    lines.append(f"  info dongs with pTop5 > 0: {n_top5}; "
                 f"suppressedZ min {min(s for s in supp if s is not None):.2f}")

    # od.json
    od, _ = load('od.json')
    check(len(od) <= 400, f'<= 400 pairs (got {len(od)})')
    check(all(p['count'] >= 5 for p in od), 'all pair counts >= 5')
    check(all(od[i]['count'] >= od[i + 1]['count'] for i in range(len(od) - 1)), 'sorted desc')
    check(all(in_bbox(*p['o']) and in_bbox(*p['d']) for p in od), 'od coords in bbox')

    # trips_anim.json
    anim, asize = load('trips_anim.json')
    check(len(anim) <= 12000, f'<= 12000 trips (got {len(anim)})')
    check(asize <= 8 * 1024 * 1024, 'trips_anim.json <= 8MB')
    check(all(a['w'] in (0, 1, 2) for a in anim), 'w in {0,1,2}')
    check(all(a['t'][1] > a['t'][0] >= 0 for a in anim), 't[1] > t[0] >= 0')
    check(all(in_bbox(*a['p'][0]) and in_bbox(*a['p'][1]) for a in anim), 'anim coords in bbox')

    # unmet.json
    unmet, _ = load('unmet.json')
    check(all(in_bbox(u['lng'], u['lat']) for u in unmet), 'unmet cells in bbox')
    check(all(u['unassigned'] + u['cancelled'] > 0 for u in unmet), 'no empty cells')
    lines.append(f"  info unmet: {len(unmet)} cells, unassigned {sum(u['unassigned'] for u in unmet)}, "
                 f"cancelled {sum(u['cancelled'] for u in unmet)}")

    # infra_points.json
    infra, _ = load('infra_points.json')
    types = {}
    for p in infra:
        types[p['type']] = types.get(p['type'], 0) + 1
    check(set(types) == {'charger', 'hospital', 'pharmacy', 'welfare', 'tourism'},
          f'5 infra types present ({types})')
    check(all(in_bbox(p['lng'], p['lat']) for p in infra), 'infra coords in bbox')
    check(types['hospital'] > 5000 and types['pharmacy'] > 1500, 'hospital/pharmacy counts sane')

    # toilets_gu.json
    toilets, _ = load('toilets_gu.json')
    check(len(toilets) == 16, f'16 gu (got {len(toilets)})')
    check(all(0 <= t['accessible'] <= t['total'] for t in toilets), 'accessible <= total')
    lines.append(f"  info toilets total {sum(t['total'] for t in toilets)}, "
                 f"accessible {sum(t['accessible'] for t in toilets)}")

    # elevators.json
    elev, _ = load('elevators.json')
    check(all(e['line'] in ('1호선', '2호선', '3호선', '4호선') for e in elev),
          f"lines are 1..4호선 (got {sorted(set(e['line'] for e in elev))})")
    check(all(e['elevators'] + e['escalators'] > 0 for e in elev), 'every station has lifts')
    check(all(e['firstYear'] is None or 1980 <= e['firstYear'] <= 2025 for e in elev),
          'firstYear sane')

    # ghosts.json
    ghosts, _ = load('ghosts.json')
    check(all(in_bbox(*g['p']) for g in ghosts), 'ghost coords in bbox')
    check(all(0 <= g['t'] < 86400 for g in ghosts), 'ghost t in 0..86400')
    check(all(g['kind'] in ('unassigned', 'cancelled') for g in ghosts),
          'ghost kind in {unassigned, cancelled}')
    expected_ghosts = t['unassigned'] + t['cancelled']
    check(abs(len(ghosts) - expected_ghosts) <= 0.02 * expected_ghosts,
          f'ghost count within 2% of unassigned+cancelled '
          f'({len(ghosts)} vs {expected_ghosts})')

    # wait_km.json
    wk, _ = load('wait_km.json')
    check(wk['naive']['median'] <= wk['naive']['p90'], 'naive median <= p90')
    check(wk['km']['median'] is None or wk['km']['p90'] is None
          or wk['km']['median'] <= wk['km']['p90'], 'km median <= p90')
    check(0.0 <= wk['censoredShare'] <= 1.0, 'censoredShare in 0..1')
    # censoredShare < (unassigned+cancelled)/trips: cancelled trips that DID get
    # 배차 count as events (assignment happened), not censored. Rehearsal data:
    # 0.095 vs 0.133 (gap = 1,427 cancelled-after-assignment rows).
    cens_ceiling = (t['unassigned'] + t['cancelled']) / t['trips']
    check(cens_ceiling - 0.05 <= wk['censoredShare'] <= cens_ceiling + 0.005,
          f"censoredShare ≈ (unassigned+cancelled)/trips "
          f"({wk['censoredShare']} vs {cens_ceiling:.3f}, tol -0.05/+0.005)")
    check(any(c['label'] == '전체' for c in wk['curves']), "curves include 전체")
    for c in wk['curves']:
        pts = c['points']
        mono_t = all(pts[i][0] < pts[i + 1][0] for i in range(len(pts) - 1))
        mono_s = all(pts[i][1] >= pts[i + 1][1] for i in range(len(pts) - 1))
        in01 = all(0.0 <= p[1] <= 1.0 for p in pts)
        check(mono_t and mono_s and in01,
              f"curve '{c['label']}': t increasing, S(t) non-increasing, S in 0..1")
    check(len(wk['queue']) == 24 and [q['hour'] for q in wk['queue']] == list(range(24)),
          'queue has 24 hours 0..23')
    check(all(0.0 <= q['unassignedRate'] <= 1.0 for q in wk['queue']),
          'queue unassignedRate in 0..1')
    check(all((q['p50Assign'] is None or q['p90Assign'] is None
               or q['p50Assign'] <= q['p90Assign'])
              and (q['p50Board'] is None or q['p90Board'] is None
                   or q['p50Board'] <= q['p90Board']) for q in wk['queue']),
          'queue p50 <= p90 (assign & board)')
    check(len(wk['fleet']) == 24 and all(f['avgActive'] <= f['maxActive']
                                         for f in wk['fleet']),
          'fleet has 24 entries, avgActive <= maxActive')

    # arrival_deserts.json
    des, _ = load('arrival_deserts.json')
    cells = des['cells']
    check(des['params']['cellM'] == 250 and des['params']['radiusM'] > 0,
          'desert params sane (cellM 250)')
    check(all(in_bbox(c['lng'], c['lat']) for c in cells), 'desert cells in bbox')
    check(all(cells[i]['score'] >= cells[i + 1]['score'] for i in range(len(cells) - 1)),
          'desert cells sorted by score desc')
    check([c['rank'] for c in cells] == list(range(1, len(cells) + 1)),
          'desert ranks contiguous from 1')
    check(all(c['score'] > 0 and c['dropoffs'] > 0 for c in cells),
          'desert score/dropoffs positive')
    nm_ok = all(v is None or 0 <= v <= 2000
                for c in cells for v in c['nearestM'].values())
    check(nm_ok, 'nearestM in 0..2000m or null (null = beyond 2km cap)')
    # spot-check the >2km policy: charger null must carry the shortage badge
    check(all(c['nearestM']['charger'] is not None or '충전소 2km 내 없음' in c['lack']
              for c in cells), "charger null ⇒ '충전소 2km 내 없음' badge present")
    greedy = des['greedy']
    check(all(g['gain'] > 0 for g in greedy), 'greedy gains positive')
    check(all(greedy[i]['cumCovered'] <= greedy[i + 1]['cumCovered']
              and greedy[i]['cumShare'] <= greedy[i + 1]['cumShare']
              for i in range(len(greedy) - 1)), 'greedy cumCovered/cumShare non-decreasing')
    check(all(0.0 < g['cumShare'] <= 1.0 for g in greedy), 'greedy cumShare in (0, 1]')
    lines.append(f"  info deserts: {len(cells)} cells, greedy picks {len(greedy)}, "
                 f"final cumShare {greedy[-1]['cumShare'] if greedy else 'n/a'}")

    # model_results.json (rehearsal fits on May citywide data)
    models, _ = load('model_results.json')
    check(len(models) == 7, f'7 model entries (got {len(models)})')
    check(all(m['status'] in ('placeholder', 'rehearsal', 'final') for m in models),
          'status in {placeholder, rehearsal, final}')
    check({m['id'] for m in models} ==
          {'retry-funnel', 'correlation', 'nb-regression', 'chi-square-type-purpose',
           'welch-t', 'chi-square', 'bootstrap-stability'},
          f"model ids match contract (got {sorted(m['id'] for m in models)})")
    fun = next(m for m in models if m['id'] == 'retry-funnel')['numbers']
    check(fun['retried'] + fun['abandoned'] == fun['unmet'],
          'funnel retried + abandoned == unmet')
    check(fun['unmet'] <= t['unassigned'] + t['cancelled'],
          'funnel unmet <= unassigned + cancelled (coord-having subset)')
    check(0.0 <= fun['retry_share'] <= 1.0, 'funnel retry_share in 0..1')
    corr = next(m for m in models if m['id'] == 'correlation')['numbers']
    check(-1.0 <= corr['pearson_r'] <= 1.0 and corr['n'] == 206,
          f"correlation r in [-1,1], n == 206 (got r={corr['pearson_r']}, n={corr['n']})")
    tp = next(m for m in models if m['id'] == 'chi-square-type-purpose')['numbers']
    check(tp['chi2'] > 0 and tp['df'] > 0 and 0 <= tp['cramers_v'] <= 1,
          'type-purpose chi2/df/V sane')
    nb = next(m for m in models if m['id'] == 'nb-regression')['numbers']
    for vn in ('intercept', 'chargers', 'medical', 'welfare', 'floor1Share'):
        irr, lo, hi = nb[f'irr_{vn}'], nb[f'irr_{vn}_lo'], nb[f'irr_{vn}_hi']
        check(lo < irr < hi, f'nb irr_{vn} CI ordered lo < point < hi '
                             f'({lo} < {irr} < {hi})')
    check(nb['n'] == 206 and nb['alpha'] >= 0, 'nb n == 206, alpha >= 0')
    boot = next(m for m in models if m['id'] == 'bootstrap-stability')['numbers']
    check(boot['clusters'] == 31 and boot['B'] >= 200,
          f"bootstrap clusters == 31 days, B >= 200 (got {boot['clusters']}, {boot['B']})")
    check(boot['top1_gapCI_lo'] <= boot['top1_gapCI_hi'] and 0 <= boot['top1_pTop5'] <= 1,
          'bootstrap top-1 CI ordered, pTop5 in 0..1')

    # model_charts.json (chart-only datasets for the 통계 씬)
    mc, _ = load('model_charts.json')
    wh = mc['waitHist']
    check(wh['nManual'] > 0 and wh['nElectric'] > 0, 'waitHist group sizes > 0')
    for key in ('manual', 'electric'):
        s = sum(b[key] for b in wh['bins'])
        check(abs(s - 1.0) < 0.01, f'waitHist {key} shares sum ≈ 1 (got {s:.3f})')
    check(wh['bins'][-1]['label'].endswith('+'), 'waitHist last bin is the cap bin')
    tpc = mc['typePurpose']
    check(len(tpc['counts']) == len(tpc['rows'])
          and all(len(r) == len(tpc['purposes']) for r in tpc['counts']),
          'typePurpose matrix shape matches rows × purposes')
    check(sum(map(sum, tpc['counts'])) == tpc['n'] == t['trips'],
          f"typePurpose counts sum == n == trips (got {sum(map(sum, tpc['counts']))})")
    check(tpc['rowTotals'] == [sum(r) for r in tpc['counts']]
          and tpc['colTotals'] == [sum(r[j] for r in tpc['counts'])
                                   for j in range(len(tpc['purposes']))],
          'typePurpose row/col totals consistent')

    print('\n'.join(lines))
    if errors:
        print(f'\nVALIDATION FAILED: {len(errors)} error(s)')
        for e in errors:
            print('  - ' + e)
        sys.exit(1)
    print('\nALL CHECKS PASSED')


if __name__ == '__main__':
    main()
