"""DIVE 2026 dashboard data pipeline — builds ALL public/data/ artifacts.

Inputs (see README.md) → outputs matching lib/types.ts exactly.
Pure stdlib. Run: python3 pipeline/build_all.py
"""
import csv
import io
import json
import math
import os
import random
import re
import unicodedata
import zipfile
from bisect import bisect_right
from collections import Counter, defaultdict
from datetime import datetime, timedelta

from common import (DongLocator, haversine_m, iter_xlsx_rows,
                    largest_ring_centroid, mat_inv, mat_vec, percentile,
                    read_dbf, xtwx_xtwz, zscores)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # dive-dashboard/
OUT = os.path.join(BASE, 'public', 'data')
PIPE = os.path.dirname(os.path.abspath(__file__))
SCRATCH = os.path.dirname(BASE)  # scratchpad/
DIVE = '/Users/alexanderkim/Downloads/dive'

F_TRIPS = os.path.join(DIVE, '부산시설공단_부산 교통약자 이동지원 차량 운영현황_20250501.csv')
F_CHARGERS = os.path.join(DIVE, '전국전동휠체어급속충전기표준데이터.csv')
F_TOILETS = os.path.join(DIVE, '공중화장실정보_부산광역시.csv')
F_ELEV = os.path.join(DIVE, '부산교통공사_승강기 연도별 설치현황_20251231.csv')
F_SHOPS_ZIP = os.path.join(DIVE, '소상공인시장진흥공단_상가(상권)정보_20260331.zip')
SHOPS_INNER = '소상공인시장진흥공단_상가(상권)정보_부산_202603.csv'
F_HOSP = os.path.join(SCRATCH, 'hosp', '1.병원정보서비스(2026.6.).xlsx')
F_PHARM = os.path.join(SCRATCH, 'hosp', '2.약국정보서비스(2026.6.).xlsx')
F_WELFARE = os.path.join(SCRATCH, 'shp', '부산광역시_장애인 복지시설 현황.dbf')
F_TOURISM = os.path.join(DIVE, '한국문화정보원_전국 배리어프리 문화예술관광지_20221125.csv')
F_DONGS_RAW = os.path.join(OUT, 'busan_dongs_raw.geojson')

# Busan bbox used for coordinate sanity filters ([lng, lat] WGS84)
BBOX = {'lat': (34.9, 35.5), 'lng': (128.7, 129.5)}

TS_FMT = '%Y/%m/%d %H:%M:%S'

report_lines = []


def report(line):
    print(line)
    report_lines.append(line)


def in_bbox(lng, lat):
    return BBOX['lng'][0] <= lng <= BBOX['lng'][1] and BBOX['lat'][0] <= lat <= BBOX['lat'][1]


def parse_ts(s):
    s = (s or '').strip()
    if not s:
        return None
    try:
        return datetime.strptime(s, TS_FMT)
    except ValueError:
        return None


def dump_json(name, obj, compact=True):
    path = os.path.join(OUT, name)
    with open(path, 'w', encoding='utf-8') as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=2)
    size = os.path.getsize(path)
    report(f'wrote {name}: {size:,} bytes')


# ---------------------------------------------------------------------------
# 1. Dong boundaries + name matcher
# ---------------------------------------------------------------------------

def norm_dong_name(full_name):
    """Normalize adm_nm-style full names for matching.

    Trips write '가야1동' while admdongkor has '가야제1동' → strip '제' before a
    digit. 일광면 was upgraded to 일광읍 in 2022 but trips still say 일광면 →
    normalize 면/읍 suffix only for that known rename via alias table below.
    """
    return re.sub(r'제(\d)', r'\1', full_name.replace(' ', ''))


DONG_ALIASES = {
    '부산광역시 기장군 일광면': '부산광역시 기장군 일광읍',  # renamed 2022
}


def load_dongs():
    with open(F_DONGS_RAW, encoding='utf-8') as f:
        raw = json.load(f)
    feats = raw['features']
    assert len(feats) == 206, f'expected 206 dong features, got {len(feats)}'
    name_index = {}
    for f_ in feats:
        p = f_['properties']
        p['_admCd'] = p['adm_cd2']
        p['_short'] = p['adm_nm'].split()[-1]
        p['_gu'] = p['sggnm']
        p['_centroid'] = largest_ring_centroid(f_['geometry'])
        key = norm_dong_name(p['adm_nm'])
        assert key not in name_index, f'normalized name collision: {key}'
        name_index[key] = f_
    return feats, name_index


def make_dong_matcher(name_index):
    def match(raw_name):
        nm = (raw_name or '').strip()
        if not nm:
            return None
        nm = DONG_ALIASES.get(nm, nm)
        return name_index.get(norm_dong_name(nm))
    return match


# ---------------------------------------------------------------------------
# 2. Trips (두리발) — stats.json, od.json, trips_anim.json, unmet.json, per-dong demand
# ---------------------------------------------------------------------------

def swap_coords(x_raw, y_raw):
    """Trips CSV has X좌표=latitude / Y좌표=longitude (SWAPPED). Verify by range."""
    try:
        x = float(x_raw)
        y = float(y_raw)
    except (TypeError, ValueError):
        return None
    # x≈35 (lat range), y≈129 (lng range) → swapped in the source
    if 33.0 <= x <= 39.0 and 124.0 <= y <= 132.0:
        return (y, x)  # (lng, lat)
    # tolerate rows that are already in (lat=Y, lng=X) order, just in case
    if 33.0 <= y <= 39.0 and 124.0 <= x <= 132.0:
        return (x, y)
    return None


WHEELCHAIR_ANIM = {'수동': 1, '전동': 2}
DOW_LABELS = ['월', '화', '수', '목', '금', '토', '일']


def process_trips(dong_match):
    totals = {'trips': 0, 'completed': 0, 'unassigned': 0, 'cancelled': 0}
    waits_all = []
    waits_by_dong = defaultdict(list)
    wheelchair = {'manual': 0, 'electric': 0, 'none': 0, 'unknown': 0}
    hourly = [{'hour': h, 'requests': 0, 'unassigned': 0, 'cancelled': 0} for h in range(24)]
    by_dow = [{'dow': d, 'label': DOW_LABELS[d], 'requests': 0} for d in range(7)]
    purpose = Counter()
    dates = []

    dong_demand = defaultdict(lambda: {'dropoffs': 0, 'pickups': 0, 'unassigned': 0, 'cancelled': 0})
    od_counter = Counter()
    anim = []
    unmet_cells = defaultdict(lambda: {'unassigned': 0, 'cancelled': 0})
    top_dest = Counter()

    m_stats = Counter()  # match bookkeeping

    # --- survival analysis (wait_km.json): event = 배차 assigned ---
    surv = []  # (duration_min in (0,1440], event 0/1, raw 휠체어 value)
    surv_dropped = Counter()
    queue_hour = [{'requests': 0, 'unassigned': 0, 'assign': [], 'board': []}
                  for _ in range(24)]
    fleet_rows = []  # (vehicle, 배차 dt, 하차 dt)
    fleet_skipped = 0
    ghosts = []  # GhostPoint dicts
    dropoff_cells = Counter()  # (lng_idx, lat_idx) 250m grid — arrival deserts
    # day-cluster bootstrap inputs: per-day per-dong counts
    day_dong_drop = Counter()        # (date, admCd) → completed dropoffs
    day_dong_unassigned = Counter()  # (date, admCd) → unassigned pickups

    with open(F_TRIPS, encoding='cp949') as f:
        for row in csv.DictReader(f):
            totals['trips'] += 1
            result = (row['결과'] or '').strip()
            status = (row['상태'] or '').strip()
            # Disjoint categories (verified on the May 2025 file):
            #   completed  = 결과 '하차'
            #   unassigned = 결과 '미배차' (all also carry 취소-family 상태)
            #   cancelled  = 취소-family 상태, excluding the two above
            if result == '하차':
                cat = 'completed'
            elif result == '미배차':
                cat = 'unassigned'
            elif '취소' in status:
                cat = 'cancelled'
            else:
                cat = 'other'  # not expected; kept out of the three buckets
            if cat in totals:
                totals[cat] += 1

            t_req = parse_ts(row['접수시간'])
            t_board = parse_ts(row['승차'])
            t_drop = parse_ts(row['하차'])
            t_assign = parse_ts(row['배차'])
            t_cancel = parse_ts(row['취소시간'])
            if t_req:
                dates.append(t_req.date())
                hourly[t_req.hour]['requests'] += 1
                by_dow[t_req.weekday()]['requests'] += 1
                if cat == 'unassigned':
                    hourly[t_req.hour]['unassigned'] += 1
                elif cat == 'cancelled':
                    hourly[t_req.hour]['cancelled'] += 1

                # survival: event = assignment; no 배차 → censored at 취소시간
                if t_assign:
                    d_min = (t_assign - t_req).total_seconds() / 60.0
                    if d_min <= 0:
                        surv_dropped['event_nonpos'] += 1
                    else:
                        surv.append((min(d_min, 1440.0), 1, (row['휠체어'] or '').strip()))
                elif t_cancel:
                    d_min = (t_cancel - t_req).total_seconds() / 60.0
                    if d_min <= 0:
                        surv_dropped['censor_nonpos'] += 1
                    else:
                        surv.append((min(d_min, 1440.0), 0, (row['휠체어'] or '').strip()))
                else:
                    surv_dropped['censor_no_cancel_ts'] += 1

                # queue decomposition per request hour
                qh = queue_hour[t_req.hour]
                qh['requests'] += 1
                if cat == 'unassigned':
                    qh['unassigned'] += 1
                if t_assign:
                    a_min = (t_assign - t_req).total_seconds() / 60.0
                    if a_min > 0:
                        qh['assign'].append(min(a_min, 1440.0))
                    if t_board:
                        b_min = (t_board - t_assign).total_seconds() / 60.0
                        if b_min >= 0:
                            qh['board'].append(min(b_min, 1440.0))
                        else:
                            surv_dropped['board_negative'] += 1
            else:
                surv_dropped['no_request_ts'] += 1

            # fleet occupancy: rows with both 배차+하차; skip pathological spans
            veh = (row['배차차량'] or '').strip()
            if veh and t_assign and t_drop:
                span_h = (t_drop - t_assign).total_seconds() / 3600.0
                if 0 < span_h <= 24:
                    fleet_rows.append((veh, t_assign, t_drop))
                else:
                    fleet_skipped += 1

            wc = (row['휠체어'] or '').strip()
            if wc == '수동':
                wheelchair['manual'] += 1
            elif wc == '전동':
                wheelchair['electric'] += 1
            elif wc == '없음':
                wheelchair['none'] += 1
            else:
                wheelchair['unknown'] += 1  # 기타 + blank

            purpose[(row['목적'] or '').strip() or '미상'] += 1

            o_feat = dong_match(row['출발지 행정동'])
            d_feat = dong_match(row['목적지 행정동'])
            for side, feat, raw in (('o', o_feat, row['출발지 행정동']),
                                    ('d', d_feat, row['목적지 행정동'])):
                raw = (raw or '').strip()
                if not raw:
                    m_stats[side + '_empty'] += 1
                elif feat is not None:
                    m_stats[side + '_matched'] += 1
                elif raw.startswith('부산광역시'):
                    m_stats[side + '_busan_unmatched'] += 1
                else:
                    m_stats[side + '_outside'] += 1  # 관외 — counted, excluded from dongs

            o_xy = swap_coords(row['출발지 X좌표'], row['출발지 Y좌표'])
            d_xy = swap_coords(row['목적지 X좌표'], row['목적지 Y좌표'])

            if cat == 'completed':
                if o_feat is not None:
                    key = o_feat['properties']['_admCd']
                    dong_demand[key]['pickups'] += 1
                    if t_req and t_board:
                        w_min = (t_board - t_req).total_seconds() / 60.0
                        if 0 <= w_min <= 24 * 60:
                            waits_all.append(w_min)
                            waits_by_dong[key].append(w_min)
                if d_feat is not None:
                    key = d_feat['properties']['_admCd']
                    dong_demand[key]['dropoffs'] += 1
                    top_dest[key] += 1
                    if t_req:
                        day_dong_drop[(t_req.date(), key)] += 1
                if d_xy and in_bbox(*d_xy):
                    # ~250 m grid (lat step 0.00225°, lng step 0.00275°)
                    cell = (math.floor(d_xy[0] / 0.00275), math.floor(d_xy[1] / 0.00225))
                    dropoff_cells[cell] += 1
                if o_feat is not None and d_feat is not None:
                    od_counter[(o_feat['properties']['_admCd'],
                                d_feat['properties']['_admCd'])] += 1
                # animated trips: O + D coords inside Busan bbox, 승차 required
                if o_xy and d_xy and t_board and in_bbox(*o_xy) and in_bbox(*d_xy):
                    depart = t_board.hour * 3600 + t_board.minute * 60 + t_board.second
                    dur = None
                    if t_drop:
                        dur = (t_drop - t_board).total_seconds()
                        if dur <= 0:
                            dur = None
                    if dur is None:
                        # fallback: 3 min per km, at least 5 min
                        try:
                            km = float(row['거리(km)'])
                        except (TypeError, ValueError):
                            km = 0.0
                        dur = max(300.0, km * 180.0)
                    anim.append({
                        'p': [[round(o_xy[0], 4), round(o_xy[1], 4)],
                              [round(d_xy[0], 4), round(d_xy[1], 4)]],
                        't': [depart, int(depart + dur)],
                        'w': WHEELCHAIR_ANIM.get(wc, 0),
                    })
            elif cat in ('unassigned', 'cancelled'):
                if o_feat is not None:
                    dong_demand[o_feat['properties']['_admCd']][cat] += 1
                    if cat == 'unassigned' and t_req:
                        day_dong_unassigned[(t_req.date(),
                                             o_feat['properties']['_admCd'])] += 1
                if o_xy and in_bbox(*o_xy):
                    cell = (round(o_xy[0], 3), round(o_xy[1], 3))
                    unmet_cells[cell][cat] += 1
                    if t_req:
                        ghosts.append({
                            'p': [round(o_xy[0], 3), round(o_xy[1], 3)],
                            't': t_req.hour * 3600 + t_req.minute * 60 + t_req.second,
                            'kind': cat,
                        })

    totals['unassignedRate'] = round(totals['unassigned'] / totals['trips'], 4)
    return {
        'totals': totals, 'waits_all': waits_all, 'waits_by_dong': waits_by_dong,
        'wheelchair': wheelchair, 'hourly': hourly, 'by_dow': by_dow,
        'purpose': purpose, 'dates': dates, 'dong_demand': dong_demand,
        'od_counter': od_counter, 'anim': anim, 'unmet_cells': unmet_cells,
        'top_dest': top_dest, 'm_stats': m_stats,
        'surv': surv, 'surv_dropped': surv_dropped, 'queue_hour': queue_hour,
        'fleet_rows': fleet_rows, 'fleet_skipped': fleet_skipped,
        'ghosts': ghosts, 'dropoff_cells': dropoff_cells,
        'day_dong_drop': day_dong_drop, 'day_dong_unassigned': day_dong_unassigned,
    }


# ---------------------------------------------------------------------------
# 3. Infrastructure loaders → infra_points + per-dong counts
# ---------------------------------------------------------------------------

def load_chargers():
    pts = []
    with open(F_CHARGERS, encoding='cp949') as f:
        for row in csv.DictReader(f):
            if (row['시도명'] or '').strip() != '부산광역시':
                continue  # strict 시도명 filter (address matching false-positives on 부산면)
            try:
                lat = float(row['위도'])
                lng = float(row['경도'])
            except (TypeError, ValueError):
                continue
            if not in_bbox(lng, lat):
                continue
            cap = (row['동시사용가능대수'] or '').strip()
            pts.append({'lng': lng, 'lat': lat, 'type': 'charger',
                        'name': (row['시설명'] or '').strip(),
                        'detail': f'동시사용 {cap}대' if cap else ''})
    return pts


def load_hira(path, kind):
    """HIRA hospital/pharmacy xlsx. 좌표(X)=lng, 좌표(Y)=lat (NOT swapped)."""
    pts = []
    header = None
    for row in iter_xlsx_rows(path):
        if header is None:
            header = row
            idx = {h: i for i, h in enumerate(header)}
            i_name, i_sido = idx['요양기관명'], idx['시도코드명']
            i_kind = idx['종별코드명']
            i_x, i_y = idx['좌표(X)'], idx['좌표(Y)']
            continue
        def get(i):
            return row[i].strip() if i < len(row) else ''
        if get(i_sido) != '부산':
            continue
        try:
            lng = float(get(i_x))
            lat = float(get(i_y))
        except (TypeError, ValueError):
            continue  # rare rows without coords — dropped
        if not in_bbox(lng, lat):
            continue
        pts.append({'lng': lng, 'lat': lat, 'type': kind,
                    'name': get(i_name), 'detail': get(i_kind)})
    return pts


def load_welfare():
    pts = []
    skipped = 0
    for rec in read_dbf(F_WELFARE):
        try:
            lat = float(rec['lat'])
            lng = float(rec['lon'])
        except (TypeError, ValueError):
            skipped += 1
            continue
        if not in_bbox(lng, lat):
            skipped += 1  # known coordinate outliers — excluded
            continue
        pts.append({'lng': lng, 'lat': lat, 'type': 'welfare',
                    'name': rec['facility_n'], 'detail': rec['facility_t']})
    return pts, skipped


def load_tourism():
    """한국문화정보원 nationwide barrier-free 문화예술관광지 CSV, filtered to Busan."""
    pts = []
    with open(F_TOURISM, encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            if (row['시도 명칭'] or '').strip() != '부산광역시':
                continue
            try:
                lat = float(row['위도'])
                lng = float(row['경도'])
            except (TypeError, ValueError):
                continue
            if not in_bbox(lng, lat):
                continue
            name = (row['시설명'] or '').strip()
            branch = (row['분점명'] or '').strip()
            if branch and branch != 'N':
                name = f'{name} {branch}'
            detail = (row['카테고리2'] or row['카테고리1'] or '').strip()
            pts.append({'lng': lng, 'lat': lat, 'type': 'tourism',
                        'name': name, 'detail': detail})
    return pts


def load_shops_per_dong(cd8_index):
    """Stream Busan shops CSV from the zip (no extraction).

    Zip entry names are UTF-8 (NFD) mangled through cp437; match by decoded name
    with a size fallback. Join to dongs by 행정동코드 (8-digit) == adm_cd2[:8].
    """
    z = zipfile.ZipFile(F_SHOPS_ZIP)
    target = None
    for info in z.infolist():
        try:
            decoded = unicodedata.normalize(
                'NFC', info.filename.encode('cp437').decode('utf-8'))
        except (UnicodeDecodeError, UnicodeEncodeError):
            decoded = info.filename
        if decoded.endswith(SHOPS_INNER):
            target = info
            break
    if target is None:  # fallback: known file size
        for info in z.infolist():
            if info.file_size == 84329596:
                target = info
                break
    assert target is not None, 'Busan shops CSV entry not found in zip'

    shops = defaultdict(lambda: {'shops': 0, 'floor_known': 0, 'floor1': 0})
    n = matched = 0
    with z.open(target) as fb:
        reader = csv.reader(io.TextIOWrapper(fb, encoding='utf-8-sig'))
        header = next(reader)
        idx = {h: i for i, h in enumerate(header)}
        i_cd, i_floor = idx['행정동코드'], idx['층정보']
        for row in reader:
            n += 1
            cd = row[i_cd].strip()
            key = cd[:8]
            if key not in cd8_index:
                continue
            matched += 1
            adm = cd8_index[key]
            s = shops[adm]
            s['shops'] += 1
            floor = row[i_floor].strip()
            if floor:
                s['floor_known'] += 1
                if floor == '1':
                    s['floor1'] += 1
    return shops, n, matched


# ---------------------------------------------------------------------------
# 4. Toilets per 구
# ---------------------------------------------------------------------------

def build_toilets(gu_names):
    gu_re = re.compile('(' + '|'.join(re.escape(g) for g in sorted(gu_names, key=len, reverse=True)) + ')')
    per_gu = defaultdict(lambda: {'total': 0, 'accessible': 0})
    unparsed = 0
    acc_cols = ['남성용-장애인용대변기수', '남성용-장애인용소변기수', '여성용-장애인용대변기수']
    with open(F_TOILETS, encoding='cp949') as f:
        for row in csv.DictReader(f):
            addr = (row['소재지도로명주소'] or '').strip() or (row['소재지지번주소'] or '').strip()
            m = gu_re.search(addr)
            if not m:
                unparsed += 1
                continue
            gu = m.group(1)
            per_gu[gu]['total'] += 1
            accessible = False
            for c in acc_cols:
                v = (row.get(c) or '').strip()
                try:
                    if v and int(float(v)) > 0:
                        accessible = True
                        break
                except ValueError:
                    pass
            if accessible:
                per_gu[gu]['accessible'] += 1
    out = [{'gu': gu, 'total': v['total'], 'accessible': v['accessible']}
           for gu, v in sorted(per_gu.items(), key=lambda kv: -kv[1]['total'])]
    return out, unparsed


# ---------------------------------------------------------------------------
# 5. Metro elevators per (line, station)
# ---------------------------------------------------------------------------

def build_elevators():
    agg = {}
    with open(F_ELEV, encoding='cp949') as f:
        for row in csv.DictReader(f):
            line_raw = (row['호선'] or '').strip()
            line = f'{line_raw}호선' if line_raw.isdigit() else line_raw
            station = (row['역명'] or '').strip()
            kind = (row['구분'] or '').strip()
            key = (line, station)
            if key not in agg:
                agg[key] = {'line': line, 'station': station,
                            'elevators': 0, 'escalators': 0, 'firstYear': None}
            a = agg[key]
            if kind == '엘리베이터':
                a['elevators'] += 1
            elif kind == '에스컬레이터':
                a['escalators'] += 1
            yr = (row['설치년도'] or '').strip()
            if yr.isdigit():
                y = int(yr)
                if a['firstYear'] is None or y < a['firstYear']:
                    a['firstYear'] = y
    return sorted(agg.values(), key=lambda a: (a['line'], a['station']))


# ---------------------------------------------------------------------------
# 6. Waiting-time survival analysis (wait_km.json)
# ---------------------------------------------------------------------------

def km_curve(items):
    """Kaplan-Meier estimator. items = [(t, event 0/1)], t > 0.

    Returns [(t_i, S_i)] at distinct event times. Censored observations at the
    same t as events stay in the risk set for that t (standard convention).
    """
    items = sorted(items)
    n = len(items)
    points = []
    s = 1.0
    at_risk = n
    i = 0
    while i < n:
        t = items[i][0]
        d = removed = 0
        while i < n and items[i][0] == t:
            d += items[i][1]
            removed += 1
            i += 1
        if d > 0:
            s *= 1.0 - d / at_risk
            points.append((t, s))
        at_risk -= removed
    return points


def km_quantile(points, level):
    """First t where S(t) <= level; None if the curve never crosses."""
    for t, s in points:
        if s <= level:
            return t
    return None


def downsample_curve(points, cap=120):
    """Keep <= cap curve points, uniformly spaced in t (step-function aware)."""
    if len(points) <= cap:
        return points
    ts = [p[0] for p in points]
    t0, t1 = ts[0], ts[-1]
    out = []
    last_j = -1
    for k in range(cap):
        target = t0 + (t1 - t0) * k / (cap - 1)
        j = max(0, bisect_right(ts, target) - 1)
        if j != last_j:
            out.append(points[j])
            last_j = j
    return out


def build_wait_km(T):
    surv = T['surv']
    event_durs = sorted(d for d, e, _ in surv if e)
    n_censored = sum(1 for _, e, _ in surv if not e)

    def curve_for(pred):
        return km_curve([(d, e) for d, e, w in surv if pred(w)])

    pts_all = curve_for(lambda w: True)
    curves = []
    for label, pred in (('전체', lambda w: True),
                        ('수동휠체어', lambda w: w == '수동'),
                        ('전동휠체어', lambda w: w == '전동')):
        pts = pts_all if label == '전체' else curve_for(pred)
        pts = downsample_curve(pts)
        curves.append({'label': label,
                       'points': [[round(t, 1), round(s, 4)] for t, s in pts]})

    km_med = km_quantile(pts_all, 0.5)
    km_p90 = km_quantile(pts_all, 0.1)

    queue = []
    for h in range(24):
        qh = T['queue_hour'][h]
        asg = sorted(qh['assign'])
        brd = sorted(qh['board'])
        queue.append({
            'hour': h,
            'requests': qh['requests'],
            'unassignedRate': round(qh['unassigned'] / qh['requests'], 4) if qh['requests'] else 0.0,
            'p50Assign': round(percentile(asg, 0.5), 1) if len(asg) >= 20 else None,
            'p90Assign': round(percentile(asg, 0.9), 1) if len(asg) >= 20 else None,
            'p50Board': round(percentile(brd, 0.5), 1) if len(brd) >= 20 else None,
            'p90Board': round(percentile(brd, 0.9), 1) if len(brd) >= 20 else None,
        })

    # fleet occupancy: distinct vehicles whose [배차, 하차] covers each day's h:30
    slot_veh = defaultdict(set)  # (day-of-month, hour) → vehicle set
    for veh, ta, td in T['fleet_rows']:
        t = ta.replace(minute=30, second=0, microsecond=0)
        if t < ta:
            t += timedelta(hours=1)
        while t <= td:
            if t.month == 5:
                slot_veh[(t.day, t.hour)].add(veh)
            t += timedelta(hours=1)
    n_days = 31
    fleet = []
    for h in range(24):
        per_day = [len(slot_veh.get((d, h), ())) for d in range(1, n_days + 1)]
        fleet.append({'hour': h,
                      'avgActive': round(sum(per_day) / n_days, 1),
                      'maxActive': max(per_day)})

    return {
        'naive': {'median': round(percentile(event_durs, 0.5), 1),
                  'p90': round(percentile(event_durs, 0.9), 1)},
        'km': {'median': round(km_med, 1) if km_med is not None else None,
               'p90': round(km_p90, 1) if km_p90 is not None else None},
        'censoredShare': round(n_censored / len(surv), 3),
        'curves': curves,
        'queue': queue,
        'fleet': fleet,
    }


# ---------------------------------------------------------------------------
# 7. Arrival deserts (arrival_deserts.json) — 250 m dropoff grid vs infra reach
# ---------------------------------------------------------------------------

LAT_STEP, LNG_STEP = 0.00225, 0.00275  # ~250 m at Busan latitude
DESERT_MIN_DROPOFFS = 20
DESERT_REACH_CAP_M = 2000
GREEDY_RADIUS_M = 400
GREEDY_K = 10


def nearest_m(lng, lat, pts):
    """Haversine meters to the nearest point; None beyond the 2 km cap.

    Degree-window prefilter: 2 km ≈ 0.018° lat / 0.022° lng at 35°N.
    """
    best = None
    for plng, plat in pts:
        if abs(plat - lat) > 0.0185 or abs(plng - lng) > 0.0225:
            continue
        d = haversine_m(lng, lat, plng, plat)
        if best is None or d < best:
            best = d
    if best is None or best > DESERT_REACH_CAP_M:
        return None
    return round(best)


def build_arrival_deserts(dropoff_cells, infra_pts, locator, share_by_cd, share_median):
    charger_pts = [(p['lng'], p['lat']) for p in infra_pts if p['type'] == 'charger']
    hospital_pts = [(p['lng'], p['lat']) for p in infra_pts if p['type'] == 'hospital']
    welfare_pts = [(p['lng'], p['lat']) for p in infra_pts if p['type'] == 'welfare']

    cells = []
    for (ix, iy), cnt in dropoff_cells.items():
        if cnt < DESERT_MIN_DROPOFFS:
            continue
        lng = round((ix + 0.5) * LNG_STEP, 5)
        lat = round((iy + 0.5) * LAT_STEP, 5)
        ch = nearest_m(lng, lat, charger_pts)
        ho = nearest_m(lng, lat, hospital_pts)
        we = nearest_m(lng, lat, welfare_pts)
        lack = []
        weight = 0.0
        if ch is None:
            lack.append('충전소 2km 내 없음')
            weight += 1.5
        elif ch > 800:
            lack.append('충전소 800m 밖')
            weight += 1.5
        if ho is None or ho > 500:
            lack.append('병의원 500m 밖')
            weight += 1.0
        if we is None or we > 1000:
            lack.append('복지시설 1km 밖')
            weight += 0.5
        feat = locator.locate(lng, lat)
        dong = feat['properties']['_short'] if feat is not None else None
        floor1 = share_by_cd.get(feat['properties']['_admCd']) if feat is not None else None
        if floor1 is not None and share_median is not None and floor1 < share_median:
            lack.append('1층 상가 비율 낮음')
            weight += 0.5
        score = cnt * weight
        if score <= 0:
            continue
        cell = {'lng': lng, 'lat': lat, 'dropoffs': cnt,
                'nearestM': {'charger': ch, 'hospital': ho, 'welfare': we},
                'lack': lack, 'score': round(score, 1)}
        if dong is not None:
            cell['dong'] = dong
        cells.append(cell)

    cells.sort(key=lambda c: (-c['score'], -c['dropoffs']))
    for i, c in enumerate(cells):
        c['rank'] = i + 1

    # greedy maximal coverage over ALL desert cells (before the output cap)
    total = sum(c['dropoffs'] for c in cells)
    covered = set()
    greedy = []
    for _ in range(GREEDY_K):
        best_gain, best_cell, best_cov = 0, None, None
        for cand in cells:
            gain = 0
            cov = []
            for j, c in enumerate(cells):
                if j in covered:
                    continue
                if haversine_m(cand['lng'], cand['lat'], c['lng'], c['lat']) <= GREEDY_RADIUS_M:
                    gain += c['dropoffs']
                    cov.append(j)
            if gain > best_gain:
                best_gain, best_cell, best_cov = gain, cand, cov
        if best_cell is None or best_gain < 0.01 * total:
            break
        covered.update(best_cov)
        cum = sum(cells[j]['dropoffs'] for j in covered)
        greedy.append({'lng': best_cell['lng'], 'lat': best_cell['lat'],
                       'gain': best_gain, 'cumCovered': cum,
                       'cumShare': round(cum / total, 3)})

    note = ('하차 지점을 250m 격자로 집계해 시설(충전소·병의원·복지시설·1층 상가) '
            '부족 가중 점수를 매기고 400m 반경 greedy 커버리지로 후보 지점을 뽑았으며, '
            '본선에서는 시설 레이어가 윌체어 무장애가게 데이터로 교체된다.')
    return {'params': {'cellM': 250, 'radiusM': GREEDY_RADIUS_M, 'note': note},
            'cells': cells[:200], 'greedy': greedy}, len(cells)


# ---------------------------------------------------------------------------
# 8. Count regression (Poisson IWLS → NB via moment alpha) + suppressed demand
# ---------------------------------------------------------------------------

def _iwls(X, y, offset, alpha, max_iter=50, tol=1e-8):
    """One IWLS fit with working weights w = mu/(1+alpha*mu) (Poisson: alpha=0).

    Returns (beta, mu, cov) where cov = (XᵀWX)⁻¹ at the converged beta.
    """
    n, k = len(y), len(X[0])
    total_exposure = sum(math.exp(o) for o in offset)
    beta = [math.log(max(sum(y), 1) / total_exposure)] + [0.0] * (k - 1)
    for _ in range(max_iter):
        eta = [sum(X[i][j] * beta[j] for j in range(k)) + offset[i] for i in range(n)]
        mu = [math.exp(min(max(e, -30.0), 30.0)) for e in eta]
        w = [m / (1.0 + alpha * m) for m in mu]
        z = [eta[i] - offset[i] + (y[i] - mu[i]) / mu[i] for i in range(n)]
        A, c = xtwx_xtwz(X, w, z)
        beta_new = mat_vec(mat_inv(A), c)
        delta = max(abs(bn - bo) for bn, bo in zip(beta_new, beta))
        beta = beta_new
        if delta < tol:
            break
    eta = [sum(X[i][j] * beta[j] for j in range(k)) + offset[i] for i in range(n)]
    mu = [math.exp(min(max(e, -30.0), 30.0)) for e in eta]
    w = [m / (1.0 + alpha * m) for m in mu]
    A, _ = xtwx_xtwz(X, w, [0.0] * n)
    return beta, mu, mat_inv(A)


def nb_deviance_residuals(y, mu, alpha):
    """NB deviance residuals (Poisson form when alpha == 0), y = 0 guarded."""
    out = []
    for yi, mi in zip(y, mu):
        t1 = yi * math.log(yi / mi) if yi > 0 else 0.0
        if alpha == 0:
            term = t1 - (yi - mi)
        else:
            term = t1 - (yi + 1.0 / alpha) * math.log((1.0 + alpha * yi) / (1.0 + alpha * mi))
        out.append(math.copysign(math.sqrt(max(0.0, 2.0 * term)), yi - mi))
    return out


def fit_nb_regression(X, y, offset):
    """Poisson fit → moment overdispersion alpha → NB re-weighted fit.

    Returns dict: beta, se, irr, ci lo/hi, z, p (per coefficient), alpha, mu.
    """
    _, mu_p, _ = _iwls(X, y, offset, alpha=0.0)
    n = len(y)
    alpha = max(0.0, sum((y[i] - mu_p[i]) ** 2 - mu_p[i] for i in range(n))
                / sum(m * m for m in mu_p))
    beta, mu, cov = _iwls(X, y, offset, alpha=alpha) if alpha > 0 else _iwls(X, y, offset, 0.0)
    se = [math.sqrt(max(0.0, cov[j][j])) for j in range(len(beta))]
    z = [b / s if s > 0 else 0.0 for b, s in zip(beta, se)]
    p = [math.erfc(abs(zz) / math.sqrt(2.0)) for zz in z]
    irr = [math.exp(b) for b in beta]
    lo = [math.exp(b - 1.96 * s) for b, s in zip(beta, se)]
    hi = [math.exp(b + 1.96 * s) for b, s in zip(beta, se)]
    return {'beta': beta, 'se': se, 'z': z, 'p': p,
            'irr': irr, 'lo': lo, 'hi': hi, 'alpha': alpha, 'mu': mu}


# ---------------------------------------------------------------------------
# 9. Day-cluster bootstrap of gapScore ranks (B=500)
# ---------------------------------------------------------------------------

def bootstrap_gap(feats, day_dong_drop, day_dong_unassigned, infra_z, B=500):
    n = len(feats)
    idx = {f['properties']['_admCd']: i for i, f in enumerate(feats)}
    days = sorted({d for d, _ in day_dong_drop} | {d for d, _ in day_dong_unassigned})
    drop_day = {d: [0] * n for d in days}
    una_day = {d: [0] * n for d in days}
    for (d, cd), c in day_dong_drop.items():
        drop_day[d][idx[cd]] += c
    for (d, cd), c in day_dong_unassigned.items():
        una_day[d][idx[cd]] += c

    random.seed(42)
    gap_samples = [[] for _ in range(n)]
    top5_hits = [0] * n
    for _ in range(B):
        sample = random.choices(days, k=len(days))
        drop_tot = [0] * n
        una_tot = [0] * n
        for d in sample:
            dv, uv = drop_day[d], una_day[d]
            for i in range(n):
                drop_tot[i] += dv[i]
                una_tot[i] += uv[i]
        zd = zscores(drop_tot)
        zu = zscores(una_tot)
        gaps = [zd[i] - infra_z[i] + 0.5 * zu[i] for i in range(n)]
        for i in sorted(range(n), key=lambda i: -gaps[i])[:5]:
            top5_hits[i] += 1
        for i in range(n):
            gap_samples[i].append(gaps[i])

    gap_ci, p_top5 = [], []
    for i in range(n):
        s = sorted(gap_samples[i])
        gap_ci.append([round(percentile(s, 0.05), 2), round(percentile(s, 0.95), 2)])
        p_top5.append(round(top5_hits[i] / B, 3))
    return gap_ci, p_top5, len(days)


# ---------------------------------------------------------------------------
# 10. Core tests for model_results.json (Welch t, chi-square)
# ---------------------------------------------------------------------------

def welch_t(a, b):
    """Welch t-test. Returns (t, df, p_two_sided_normal_approx, cohen_d)."""
    n1, n2 = len(a), len(b)
    m1, m2 = sum(a) / n1, sum(b) / n2
    v1 = sum((x - m1) ** 2 for x in a) / (n1 - 1)
    v2 = sum((x - m2) ** 2 for x in b) / (n2 - 1)
    se2 = v1 / n1 + v2 / n2
    t = (m1 - m2) / math.sqrt(se2)
    df = se2 ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1))
    p = math.erfc(abs(t) / math.sqrt(2.0))  # normal approx, fine for df > 100
    sp = math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2))
    d = (m1 - m2) / sp
    return t, df, p, d, m1, m2, n1, n2


TIME_BANDS = [('00-06시', 0, 6), ('06-11시', 6, 11), ('11-16시', 11, 16), ('16-24시', 16, 24)]


def chi2_sf_df3(x):
    """Chi-square survival P(X > x) for df = 3 (closed form via erfc)."""
    u = math.sqrt(x)
    return math.erfc(u / math.sqrt(2.0)) + math.sqrt(2.0 * x / math.pi) * math.exp(-x / 2.0)


def chi2_unassigned_by_band(hourly):
    """2×4 independence test: 미배차 여부 × 접수 시간대 4구간."""
    obs = []  # per band: (unassigned, other)
    for _, h0, h1 in TIME_BANDS:
        una = sum(hourly[h]['unassigned'] for h in range(h0, h1))
        req = sum(hourly[h]['requests'] for h in range(h0, h1))
        obs.append((una, req - una))
    n = sum(u + o for u, o in obs)
    row_una = sum(u for u, _ in obs)
    row_oth = n - row_una
    chi2 = 0.0
    worst = (0.0, '', 0.0)  # signed adj residual (미배차 row), band label, band rate
    for (label, _, _), (u, o) in zip(TIME_BANDS, obs):
        col = u + o
        for observed, row_tot in ((u, row_una), (o, row_oth)):
            e = row_tot * col / n
            chi2 += (observed - e) ** 2 / e
            adj = (observed - e) / math.sqrt(e * (1 - row_tot / n) * (1 - col / n))
            if row_tot == row_una and abs(adj) > abs(worst[0]):
                worst = (adj, label, u / col)
    p = chi2_sf_df3(chi2)
    v = math.sqrt(chi2 / n)  # Cramér's V, min(r-1, c-1) = 1
    return chi2, p, v, worst


def fmt_p(p):
    """Human p-value: number when representable, else '<0.0001'."""
    if p < 1e-4:
        return '<0.0001'
    return round(p, 4)


# ---------------------------------------------------------------------------
# 11. Derived gap metrics (placeholder formula — see README.md)
# ---------------------------------------------------------------------------

def tercile_flags(values):
    """True (=H) for values in the top tercile of the distribution."""
    s = sorted(values)
    cut = percentile(s, 2.0 / 3.0)
    return [v > cut or (v >= cut and cut == s[-1]) for v in values]


def main():
    os.makedirs(OUT, exist_ok=True)
    feats, name_index = load_dongs()
    dong_match = make_dong_matcher(name_index)
    cd8_index = {f['properties']['_admCd'][:8]: f['properties']['_admCd'] for f in feats}
    by_cd = {f['properties']['_admCd']: f for f in feats}

    report('=== trips ===')
    T = process_trips(dong_match)
    ms = T['m_stats']
    for side, label in (('o', 'origin'), ('d', 'dest')):
        matched = ms[side + '_matched']
        busan_un = ms[side + '_busan_unmatched']
        outside = ms[side + '_outside']
        empty = ms[side + '_empty']
        busan_total = matched + busan_un
        report(f'{label}: matched {matched:,} | busan-unmatched {busan_un:,} '
               f'| outside-busan(관외) {outside:,} | empty {empty:,} '
               f'| busan match rate {matched / busan_total * 100:.2f}% '
               f'| overall {matched / T["totals"]["trips"] * 100:.2f}%')
    report(f'totals: {T["totals"]}')

    # --- stats.json ---
    waits = sorted(T['waits_all'])
    purpose_top = T['purpose'].most_common(12)
    rest = sum(T['purpose'].values()) - sum(c for _, c in purpose_top)
    purpose_out = [{'name': k, 'count': c} for k, c in purpose_top]
    if rest > 0:
        purpose_out.append({'name': '기타(그 외)', 'count': rest})
    top_dest_out = []
    for cd, cnt in T['top_dest'].most_common(15):
        p = by_cd[cd]['properties']
        top_dest_out.append({'dong': f"{p['_gu']} {p['_short']}", 'count': cnt})
    stats = {
        'period': {'from': min(T['dates']).isoformat(), 'to': max(T['dates']).isoformat()},
        'totals': T['totals'],
        'waitMinutes': {'median': round(percentile(waits, 0.5), 1),
                        'p90': round(percentile(waits, 0.9), 1)},
        'wheelchair': T['wheelchair'],
        'hourly': T['hourly'],
        'byDow': T['by_dow'],
        'purpose': purpose_out,
        'topDestDongs': top_dest_out,
    }
    dump_json('stats.json', stats, compact=False)

    # --- infra ---
    report('=== infra ===')
    chargers = load_chargers()
    hospitals = load_hira(F_HOSP, 'hospital')
    pharmacies = load_hira(F_PHARM, 'pharmacy')
    welfare, welfare_skipped = load_welfare()
    tourism = load_tourism()
    report(f'chargers {len(chargers)} | hospitals {len(hospitals)} | '
           f'pharmacies {len(pharmacies)} | welfare {len(welfare)} '
           f'(excluded outliers/invalid: {welfare_skipped}) | tourism {len(tourism)}')

    locator = DongLocator(feats)
    infra_counts = defaultdict(lambda: {'chargers': 0, 'hospitals': 0,
                                        'pharmacies': 0, 'welfare': 0})
    # NOTE: 'tourism' (문화예술관광지) is a display-only POI layer — it is not
    # folded into infra_counts / infraZ / gapScore, only chargers/hospitals/
    # pharmacies/welfare feed the gap-score model.
    type_key = {'charger': 'chargers', 'hospital': 'hospitals',
                'pharmacy': 'pharmacies', 'welfare': 'welfare'}
    infra_points = []
    pip_missed = Counter()
    for pt in chargers + hospitals + pharmacies + welfare + tourism:
        f_ = locator.locate(pt['lng'], pt['lat'])
        rec = {'lng': round(pt['lng'], 6), 'lat': round(pt['lat'], 6),
               'type': pt['type'], 'name': pt['name']}
        if pt.get('detail'):
            rec['detail'] = pt['detail']
        if f_ is not None:
            rec['dong'] = f_['properties']['_short']
            if pt['type'] in type_key:
                infra_counts[f_['properties']['_admCd']][type_key[pt['type']]] += 1
        else:
            pip_missed[pt['type']] += 1
        infra_points.append(rec)
    report(f'infra points outside all dong polygons: {dict(pip_missed)}')
    dump_json('infra_points.json', infra_points)

    # --- shops ---
    report('=== shops ===')
    shops, shops_n, shops_matched = load_shops_per_dong(cd8_index)
    report(f'shops rows {shops_n:,} | joined to dongs {shops_matched:,} '
           f'({shops_matched / shops_n * 100:.2f}%)')

    # --- dongs.geojson ---
    demand_vals, unassigned_vals = [], []
    chargers_vals, medical_vals, welfare_vals, shopsf1_vals = [], [], [], []
    shops_counts, share_vals = [], []
    share_by_cd = {}
    for f_ in feats:
        cd = f_['properties']['_admCd']
        dd = T['dong_demand'].get(cd, {})
        ic = infra_counts.get(cd, {})
        sh = shops.get(cd, {'shops': 0, 'floor_known': 0, 'floor1': 0})
        share = (sh['floor1'] / sh['floor_known']) if sh['floor_known'] else None
        share_by_cd[cd] = share
        demand_vals.append(dd.get('dropoffs', 0))
        unassigned_vals.append(dd.get('unassigned', 0))
        chargers_vals.append(ic.get('chargers', 0))
        medical_vals.append(ic.get('hospitals', 0) + ic.get('pharmacies', 0))
        welfare_vals.append(ic.get('welfare', 0))
        shopsf1_vals.append((share or 0.0) * sh['shops'])
        shops_counts.append(sh['shops'])
        share_vals.append(share)
        f_['properties']['_tmp'] = (dd, ic, sh, share)

    z_demand = zscores(demand_vals)
    z_unassigned = zscores(unassigned_vals)
    z_infra_parts = [zscores(chargers_vals), zscores(medical_vals),
                     zscores(welfare_vals), zscores(shopsf1_vals)]
    infra_z = [sum(part[i] for part in z_infra_parts) / 4 for i in range(len(feats))]
    gap = [z_demand[i] - infra_z[i] + 0.5 * z_unassigned[i] for i in range(len(feats))]
    demand_high = tercile_flags(demand_vals)
    infra_high = tercile_flags(infra_z)

    # NB regression: y = dropoffs, offset = log(shops+1) — REHEARSAL exposure
    # proxy (finals: 장애인등록 인구). X = infra counts + floor-1 share.
    report('=== nb regression ===')
    known_shares = [s for s in share_vals if s is not None]
    share_mean = sum(known_shares) / len(known_shares)
    X = [[1.0, chargers_vals[i], medical_vals[i], welfare_vals[i],
          share_vals[i] if share_vals[i] is not None else share_mean]
         for i in range(len(feats))]
    offset = [math.log(shops_counts[i] + 1) for i in range(len(feats))]
    nb = fit_nb_regression(X, demand_vals, offset)
    resid = nb_deviance_residuals(demand_vals, nb['mu'], nb['alpha'])
    suppressed_z = zscores(resid)
    var_names = ['intercept', 'chargers', 'medical', 'welfare', 'floor1Share']
    for j, vn in enumerate(var_names):
        report(f"  {vn}: IRR {nb['irr'][j]:.4f} [{nb['lo'][j]:.4f}, {nb['hi'][j]:.4f}] "
               f"p={nb['p'][j]:.2e}")
    report(f"  alpha (overdispersion) = {nb['alpha']:.4f}, n = {len(feats)}")

    # day-cluster bootstrap of gapScore (B=500, infra fixed)
    report('=== bootstrap ===')
    gap_ci, p_top5, n_days = bootstrap_gap(
        feats, T['day_dong_drop'], T['day_dong_unassigned'], infra_z)
    report(f'  B=500, day clusters={n_days}')

    out_feats = []
    for i, f_ in enumerate(feats):
        p = f_['properties']
        dd, ic, sh, share = p.pop('_tmp')
        dwaits = sorted(T['waits_by_dong'].get(p['_admCd'], []))
        wait_med = round(percentile(dwaits, 0.5), 1) if len(dwaits) >= 10 else None
        props = {
            'admCd': p['_admCd'],
            'name': p['_short'],
            'gu': p['_gu'],
            'centroid': p['_centroid'],
            'dropoffs': dd.get('dropoffs', 0),
            'pickups': dd.get('pickups', 0),
            'unassigned': dd.get('unassigned', 0),
            'cancelled': dd.get('cancelled', 0),
            'waitMedian': wait_med,
            'chargers': ic.get('chargers', 0),
            'hospitals': ic.get('hospitals', 0),
            'pharmacies': ic.get('pharmacies', 0),
            'welfare': ic.get('welfare', 0),
            'shops': sh['shops'],
            'shopsFloor1Share': round(share, 3) if share is not None else None,
            'demandZ': round(z_demand[i], 3),
            'infraZ': round(infra_z[i], 3),
            'gapScore': round(gap[i], 3),
            'gapClass': ('H' if demand_high[i] else 'L') + ('H' if infra_high[i] else 'L'),
            'expectedDropoffs': round(nb['mu'][i], 1),
            'suppressedZ': round(suppressed_z[i], 3),
            'gapCI': gap_ci[i],
            'pTop5': p_top5[i],
        }
        out_feats.append({'type': 'Feature', 'properties': props,
                          'geometry': f_['geometry']})
    dump_json('dongs.geojson', {'type': 'FeatureCollection', 'features': out_feats})

    # --- od.json ---
    od_pairs = []
    for (o_cd, d_cd), cnt in T['od_counter'].most_common():
        if cnt < 5 or len(od_pairs) >= 400:
            break
        po, pd_ = by_cd[o_cd]['properties'], by_cd[d_cd]['properties']
        od_pairs.append({'o': po['_centroid'], 'd': pd_['_centroid'],
                         'oName': f"{po['_gu']} {po['_short']}",
                         'dName': f"{pd_['_gu']} {pd_['_short']}",
                         'count': cnt})
    report(f'od pairs (count>=5, cap 400): {len(od_pairs)}')
    dump_json('od.json', od_pairs)

    # --- trips_anim.json ---
    anim = T['anim']
    report(f'anim candidates: {len(anim):,}')
    if len(anim) > 12000:
        anim = random.Random(42).sample(anim, 12000)
    dump_json('trips_anim.json', anim)

    # --- unmet.json ---
    unmet = [{'lng': k[0], 'lat': k[1], 'unassigned': v['unassigned'],
              'cancelled': v['cancelled']}
             for k, v in sorted(T['unmet_cells'].items())]
    report(f'unmet cells: {len(unmet):,} (unassigned {sum(u["unassigned"] for u in unmet):,}, '
           f'cancelled {sum(u["cancelled"] for u in unmet):,})')
    dump_json('unmet.json', unmet)

    # --- toilets_gu.json ---
    gu_names = sorted(set(f['properties']['_gu'] for f in feats))
    toilets, toilets_unparsed = build_toilets(gu_names)
    report(f'toilets: {sum(t["total"] for t in toilets):,} across {len(toilets)} gu '
           f'(unparsed addresses: {toilets_unparsed})')
    dump_json('toilets_gu.json', toilets, compact=False)

    # --- elevators.json ---
    elevators = build_elevators()
    report(f'elevator stations: {len(elevators)} '
           f'(EV {sum(e["elevators"] for e in elevators)}, '
           f'ES {sum(e["escalators"] for e in elevators)})')
    dump_json('elevators.json', elevators)

    # --- wait_km.json ---
    report('=== wait km ===')
    wait_km = build_wait_km(T)
    report(f"  events+censored: {len(T['surv']):,} | dropped: {dict(T['surv_dropped'])} "
           f"| fleet rows skipped (span<=0 or >24h): {T['fleet_skipped']}")
    report(f"  naive median/p90: {wait_km['naive']['median']}/{wait_km['naive']['p90']} min "
           f"| KM median/p90: {wait_km['km']['median']}/{wait_km['km']['p90']} min "
           f"| censoredShare: {wait_km['censoredShare']}")
    dump_json('wait_km.json', wait_km)

    # --- ghosts.json ---
    ghosts = T['ghosts']
    n_ghost_kinds = Counter(g['kind'] for g in ghosts)
    report(f"ghost points: {len(ghosts):,} ({dict(n_ghost_kinds)})")
    dump_json('ghosts.json', ghosts)

    # --- arrival_deserts.json ---
    report('=== arrival deserts ===')
    share_median = percentile(sorted(known_shares), 0.5)
    deserts, n_desert_cells = build_arrival_deserts(
        T['dropoff_cells'], infra_points, locator, share_by_cd, share_median)
    report(f"  cells >= {DESERT_MIN_DROPOFFS} dropoffs with score>0: {n_desert_cells} "
           f"(kept {len(deserts['cells'])}) | greedy picks: {len(deserts['greedy'])}")
    if deserts['greedy']:
        report(f"  greedy cumShare: {[g['cumShare'] for g in deserts['greedy']]}")
    dump_json('arrival_deserts.json', deserts)

    # --- model_results.json (REHEARSAL — real fits on May citywide data) ---
    j_ch = var_names.index('chargers')
    logs_manual = [math.log(d) for d, e, w in T['surv'] if e and w == '수동']
    logs_electric = [math.log(d) for d, e, w in T['surv'] if e and w == '전동']
    wt, wdf, wp, wd, wm1, wm2, wn1, wn2 = welch_t(logs_manual, logs_electric)
    chi2, chi2_p, cramers_v, (worst_adj, worst_band, worst_rate) = \
        chi2_unassigned_by_band(T['hourly'])
    overall_una_rate = T['totals']['unassigned'] / T['totals']['trips']
    top_i = max(range(len(feats)), key=lambda i: gap[i])
    top_p = feats[top_i]['properties']
    top_name = f"{top_p['_gu']} {top_p['_short']}"
    report(f"  welch-t: t={wt:.2f} df={wdf:.0f} p={wp:.2e} d={wd:.3f}")
    report(f"  chi-square: chi2={chi2:.1f} p={chi2_p:.2e} V={cramers_v:.3f} "
           f"worst band {worst_band} adj={worst_adj:.1f} rate={worst_rate:.3f}")
    report(f"  bootstrap top-1: {top_name} pTop5={p_top5[top_i]} gapCI={gap_ci[top_i]}")

    nb_numbers = {'n': len(feats), 'alpha': round(nb['alpha'], 4)}
    for j, vn in enumerate(var_names):
        nb_numbers[f'irr_{vn}'] = round(nb['irr'][j], 4)
        nb_numbers[f'irr_{vn}_lo'] = round(nb['lo'][j], 4)
        nb_numbers[f'irr_{vn}_hi'] = round(nb['hi'][j], 4)
        nb_numbers[f'p_{vn}'] = fmt_p(nb['p'][j])

    model_results = [
        {'id': 'nb-regression',
         'name': '음이항 회귀 — 인프라와 하차 수요 (리허설)',
         'status': 'rehearsal',
         'headline': (f"충전소 +1기당 하차 건수 ×{nb['irr'][j_ch]:.3f} "
                      f"(95% CI {nb['lo'][j_ch]:.3f}–{nb['hi'][j_ch]:.3f})"),
         'detail': ('행정동별(206개) 하차 건수를 상가수+1 노출 대비 비율로 모델링했다'
                    '(offset=log(상가수+1)). 계수는 노출 대비 하차율의 배수(IRR)로 해석한다. '
                    f"과산포 보정 alpha={nb['alpha']:.3f}를 적용한 음이항 가중 재적합 결과다. "
                    '편차 잔차가 크게 음수인 동은 노출 대비 이용이 비정상적으로 적은 '
                    '잠재수요 의심 지역(suppressedZ)으로 지도에 표시된다.'),
         'numbers': nb_numbers,
         'caveats': ('연관성 추정이며 인과가 아님. 노출변수는 리허설 프록시(상가수+1) — '
                     '본선에서 장애인등록 인구로 교체.')},
        {'id': 'welch-t',
         'name': 'Welch t — 수동 vs 전동 휠체어 배차 대기 (로그 척도)',
         'status': 'rehearsal',
         'headline': (f"수동·전동 로그 대기 평균 차 {wm1 - wm2:+.3f} "
                      f"(t={wt:.2f}, p={fmt_p(wp)}, d={wd:.3f})"),
         'detail': ('배차 성공 건의 접수→배차 대기시간(분)을 로그 변환해 수동휠체어'
                    f'(n={wn1:,})와 전동휠체어(n={wn2:,})를 Welch t-검정으로 비교했다. '
                    f'Welch–Satterthwaite 자유도 {wdf:.0f}. 로그 척도 차이 {wm1 - wm2:+.3f}은 '
                    f'대기시간 비율 ×{math.exp(wm1 - wm2):.3f}에 해당한다.'),
         'numbers': {'t': round(wt, 2), 'df': round(wdf, 0), 'p': fmt_p(wp),
                     'cohen_d_log': round(wd, 3), 'n_manual': wn1, 'n_electric': wn2,
                     'ratio': round(math.exp(wm1 - wm2), 3)},
         'caveats': ('배차 성공 건만 포함(미배차 제외). 자유도가 충분히 커서 정규 근사 '
                     'p값을 사용. 효과 크기는 로그 척도 기준.')},
        {'id': 'chi-square',
         'name': '카이제곱 — 미배차 여부와 접수 시간대',
         'status': 'rehearsal',
         'headline': (f'{worst_band} 접수의 미배차율 {worst_rate * 100:.1f}% — '
                      f'전체 평균 {overall_una_rate * 100:.1f}% 대비 편중 '
                      f'(χ²={chi2:.0f}, p={fmt_p(chi2_p)})'),
         'detail': ('접수 시간대 4구간(00-06/06-11/11-16/16-24시)과 미배차 여부의 '
                    f'독립성을 검정했다. χ²={chi2:.1f}, df=3, Cramér\'s V={cramers_v:.3f}. '
                    f'조정 표준화 잔차가 가장 큰 칸은 {worst_band} 미배차'
                    f'(잔차 {worst_adj:+.1f})다.'),
         'numbers': {'chi2': round(chi2, 1), 'df': 3, 'p': fmt_p(chi2_p),
                     'cramers_v': round(cramers_v, 3),
                     'worst_band': worst_band,
                     'worst_band_rate': round(worst_rate, 3),
                     'worst_adj_residual': round(worst_adj, 1)},
         'caveats': ('시간대 구간은 사전 정의된 4구간. 효과 크기(Cramér\'s V)가 작으면 '
                     '통계적 유의성만으로 실무적 의미를 주장하지 않는다.')},
        {'id': 'bootstrap-stability',
         'name': '부트스트랩 — 우선순위 순위 안정성',
         'status': 'rehearsal',
         'headline': (f'gapScore 1위 {top_name} — P(상위5)={p_top5[top_i]:.3f}, '
                      f'90% CI [{gap_ci[top_i][0]}, {gap_ci[top_i][1]}]'),
         'detail': ('5월 31일을 일 단위 클러스터로 B=500회 재표집해 행정동별 gapScore와 '
                    '순위를 재계산했다(인프라 고정, 수요·미배차만 재표집). 각 동의 '
                    'gapScore 90% 신뢰구간(gapCI)과 상위 5위 진입 확률(pTop5)을 '
                    'dongs.geojson에 기록했다.'),
         'numbers': {'B': 500, 'clusters': n_days,
                     'top1_dong': top_name,
                     'top1_pTop5': p_top5[top_i],
                     'top1_gapCI_lo': gap_ci[top_i][0],
                     'top1_gapCI_hi': gap_ci[top_i][1]},
         'caveats': ('리허설 데이터(5월 시 전역) 기준. 계절성·월간 변동은 반영되지 않으며 '
                     '본선 데이터 기간에 맞춰 클러스터 단위를 재검토한다.')},
    ]
    dump_json('model_results.json', model_results, compact=False)

    with open(os.path.join(PIPE, 'match_report.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(report_lines) + '\n')
    print('done.')


if __name__ == '__main__':
    main()
