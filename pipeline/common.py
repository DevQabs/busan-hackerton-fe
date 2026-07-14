"""Shared pure-stdlib helpers for the DIVE dashboard pipeline.

No third-party deps (no pandas/openpyxl). Python 3 stdlib only.
"""
import math
import re
import struct
import zipfile
import xml.etree.ElementTree as ET

XLSX_NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


# ---------------------------------------------------------------------------
# XLSX (adapted from scratchpad/parse_xlsx.py — zipfile + XML streaming)
# ---------------------------------------------------------------------------

def _xlsx_shared_strings(z):
    strings = []
    if 'xl/sharedStrings.xml' not in z.namelist():
        return strings
    with z.open('xl/sharedStrings.xml') as f:
        for _, el in ET.iterparse(f, events=('end',)):
            if el.tag == XLSX_NS + 'si':
                strings.append(''.join(t.text or '' for t in el.iter(XLSX_NS + 't')))
                el.clear()
    return strings


def _col_index(ref):
    m = re.match(r'([A-Z]+)', ref)
    idx = 0
    for ch in m.group(1):
        idx = idx * 26 + (ord(ch) - 64)
    return idx - 1


def iter_xlsx_rows(path, sheet_path='xl/worksheets/sheet1.xml'):
    """Yield rows (list of str) from an xlsx file, streaming."""
    z = zipfile.ZipFile(path)
    strings = _xlsx_shared_strings(z)
    with z.open(sheet_path) as f:
        for _, el in ET.iterparse(f, events=('end',)):
            if el.tag != XLSX_NS + 'row':
                continue
            cells = {}
            for c in el.iter(XLSX_NS + 'c'):
                ref = c.get('r') or ''
                t = c.get('t')
                v = c.find(XLSX_NS + 'v')
                if t == 'inlineStr':
                    is_el = c.find(XLSX_NS + 'is')
                    val = ''.join(x.text or '' for x in is_el.iter(XLSX_NS + 't')) if is_el is not None else ''
                elif v is None:
                    val = ''
                elif t == 's':
                    val = strings[int(v.text)]
                else:
                    val = v.text or ''
                cells[_col_index(ref)] = val
            if cells:
                width = max(cells) + 1
                yield [cells.get(i, '') for i in range(width)]
            el.clear()


# ---------------------------------------------------------------------------
# DBF (adapted from scratchpad/analyze_dbf.py — UTF-8 dBase file)
# ---------------------------------------------------------------------------

def read_dbf(path, encoding='utf-8'):
    """Read all records from a DBF file as list of dicts."""
    with open(path, 'rb') as f:
        data = f.read()
    nrec = struct.unpack('<I', data[4:8])[0]
    hdr_size = struct.unpack('<H', data[8:10])[0]
    rec_size = struct.unpack('<H', data[10:12])[0]
    fields = []
    pos = 32
    while data[pos] != 0x0D:
        fd = data[pos:pos + 32]
        fields.append((fd[:11].split(b'\x00')[0].decode(), chr(fd[11]), fd[16]))
        pos += 32
    recs = []
    for i in range(nrec):
        off = hdr_size + i * rec_size
        r = data[off:off + rec_size]
        p = 1  # first byte is the deletion flag
        out = {}
        for name, _ftype, flen in fields:
            out[name] = r[p:p + flen].decode(encoding, errors='replace').strip()
            p += flen
        recs.append(out)
    return recs


# ---------------------------------------------------------------------------
# Geometry: centroid + point-in-polygon (ray casting) with bbox prefilter
# ---------------------------------------------------------------------------

def _ring_area(ring):
    """Shoelace area (abs). ring = [[lng, lat], ...]."""
    s = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def largest_ring_centroid(geometry):
    """Centroid = vertex average of the largest exterior ring (good enough for labels)."""
    if geometry['type'] == 'Polygon':
        polys = [geometry['coordinates']]
    else:  # MultiPolygon
        polys = geometry['coordinates']
    best = max((poly[0] for poly in polys), key=_ring_area)
    pts = best[:-1] if best[0] == best[-1] else best
    lng = sum(p[0] for p in pts) / len(pts)
    lat = sum(p[1] for p in pts) / len(pts)
    return [round(lng, 5), round(lat, 5)]


def _point_in_ring(lng, lat, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat):
            x_cross = (xj - xi) * (lat - yi) / (yj - yi) + xi
            if lng < x_cross:
                inside = not inside
        j = i
    return inside


def geometry_bbox(geometry):
    if geometry['type'] == 'Polygon':
        polys = [geometry['coordinates']]
    else:
        polys = geometry['coordinates']
    xs, ys = [], []
    for poly in polys:
        for p in poly[0]:
            xs.append(p[0])
            ys.append(p[1])
    return (min(xs), min(ys), max(xs), max(ys))


def point_in_geometry(lng, lat, geometry):
    """Inside any polygon's exterior ring and not inside any of its holes."""
    if geometry['type'] == 'Polygon':
        polys = [geometry['coordinates']]
    else:
        polys = geometry['coordinates']
    for poly in polys:
        if _point_in_ring(lng, lat, poly[0]):
            in_hole = any(_point_in_ring(lng, lat, hole) for hole in poly[1:])
            if not in_hole:
                return True
    return False


class DongLocator:
    """Point-in-polygon lookup over dong features with bbox prefilter."""

    def __init__(self, features):
        self.items = []
        for f in features:
            self.items.append((geometry_bbox(f['geometry']), f))

    def locate(self, lng, lat):
        for (x0, y0, x1, y1), f in self.items:
            if x0 <= lng <= x1 and y0 <= lat <= y1:
                if point_in_geometry(lng, lat, f['geometry']):
                    return f
        return None


# ---------------------------------------------------------------------------
# Stats helpers
# ---------------------------------------------------------------------------

def percentile(sorted_vals, q):
    """Linear-interpolation percentile, q in 0..1. sorted_vals must be sorted."""
    if not sorted_vals:
        return None
    n = len(sorted_vals)
    if n == 1:
        return sorted_vals[0]
    pos = q * (n - 1)
    lo = int(pos)
    hi = min(lo + 1, n - 1)
    frac = pos - lo
    return sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac


def zscores(values):
    """Population z-scores; all zeros when std == 0."""
    n = len(values)
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values) / n
    std = var ** 0.5
    if std == 0:
        return [0.0] * n
    return [(v - mean) / std for v in values]


def haversine_m(lng1, lat1, lng2, lat2):
    """Great-circle distance in meters (WGS84 mean radius)."""
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------------
# Small dense matrix ops (for the IWLS GLM fit — k is 5, n is 206)
# ---------------------------------------------------------------------------

def mat_inv(A):
    """Gauss-Jordan inverse with partial pivoting. A = list of row lists."""
    n = len(A)
    M = [list(A[i]) + [1.0 if j == i else 0.0 for j in range(n)] for i in range(n)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(M[r][col]))
        if abs(M[piv][col]) < 1e-12:
            raise ValueError('singular matrix in mat_inv')
        M[col], M[piv] = M[piv], M[col]
        pv = M[col][col]
        M[col] = [v / pv for v in M[col]]
        for r in range(n):
            if r != col and M[r][col] != 0.0:
                f = M[r][col]
                M[r] = [a - f * b for a, b in zip(M[r], M[col])]
    return [row[n:] for row in M]


def mat_vec(A, x):
    return [sum(a * b for a, b in zip(row, x)) for row in A]


def xtwx_xtwz(X, w, z):
    """Return (XᵀWX, XᵀWz) for diagonal W given as a weight vector."""
    n, k = len(X), len(X[0])
    A = [[0.0] * k for _ in range(k)]
    c = [0.0] * k
    for i in range(n):
        xi, wi, zi = X[i], w[i], z[i]
        for r in range(k):
            xw = xi[r] * wi
            c[r] += xw * zi
            for s in range(r, k):
                A[r][s] += xw * xi[s]
    for r in range(k):
        for s in range(r):
            A[r][s] = A[s][r]
    return A, c
