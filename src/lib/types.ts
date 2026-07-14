// ============================================================================
// DATA CONTRACT between the Python pipeline (pipeline/) and the UI (app/).
//
// The pipeline writes JSON artifacts into public/data/. The UI reads ONLY these
// files. At the DIVE finals, swapping input CSVs and re-running the pipeline
// must be the ONLY change needed — keep these schemas stable. Do not edit this
// file casually; both sides depend on it.
//
// Coordinate convention: [lng, lat] (GeoJSON order), WGS84.
// All Korean domain values (행정동 names, 업종, 장애유형) stay in Korean.
// ============================================================================

/** public/data/stats.json — headline KPIs for the overview scene. */
export interface Stats {
  period: { from: string; to: string }; // ISO dates of the trip data window
  totals: {
    trips: number;          // all requests (접수)
    completed: number;      // 하차 완료
    unassigned: number;     // 미배차 — no vehicle assigned
    cancelled: number;      // 취소 (customer/system)
    unassignedRate: number; // unassigned / trips, 0..1
  };
  waitMinutes: { median: number; p90: number }; // 접수→승차 for completed trips
  wheelchair: { manual: number; electric: number; none: number; unknown: number };
  /** 24 entries, hour 0..23 */
  hourly: { hour: number; requests: number; unassigned: number; cancelled: number }[];
  /** 7 entries, 0=Mon..6=Sun */
  byDow: { dow: number; label: string; requests: number }[];
  purpose: { name: string; count: number }[];       // 목적 breakdown
  topDestDongs: { dong: string; count: number }[];  // top-15 destination 행정동
}

/** public/data/dongs.geojson — FeatureCollection<Polygon|MultiPolygon, DongProps>.
 *  One feature per Busan 행정동 (boundaries from vuski/admdongkor). */
export interface DongProps {
  admCd: string;   // 행정동코드 10자리 (adm_cd2)
  name: string;    // short name, e.g. "우1동"
  gu: string;      // 시군구, e.g. "해운대구"
  centroid: [number, number]; // [lng, lat] — precomputed for labels/arcs
  // --- demand (from 두리발 trips) ---
  dropoffs: number;
  pickups: number;
  unassigned: number;   // 미배차 originating here (pickup side)
  cancelled: number;
  waitMedian: number | null; // minutes, null when n < 10
  // --- infrastructure counts ---
  chargers: number;    // 전동휠체어 급속충전기
  hospitals: number;   // 병의원 (HIRA)
  pharmacies: number;
  welfare: number;     // 장애인복지시설 (SHP)
  shops: number;       // 상가 총수
  shopsFloor1Share: number | null; // share of shops on 1st floor (accessibility proxy)
  // --- derived (placeholder formula, to be replaced by DS model outputs) ---
  demandZ: number;
  infraZ: number;
  gapScore: number;    // z(demand) − z(infra) + 0.5·z(unmet); higher = worse
  gapClass: "HH" | "HL" | "LH" | "LL"; // demand×infra terciles; HL = 사각지대 (priority)
}

/** public/data/od.json — aggregated origin→destination flows between dong centroids. */
export interface OdPair {
  o: [number, number]; // origin centroid [lng, lat]
  d: [number, number];
  oName: string;       // "사상구 학장동"
  dName: string;
  count: number;
}

/** public/data/trips_anim.json — trips for the animated TripsLayer scene.
 *  One representative pattern: every completed trip mapped to seconds-of-day. */
export interface AnimTrip {
  /** two-point path [[lng,lat],[lng,lat]] (O → D), coords rounded to 4 decimals */
  p: [[number, number], [number, number]];
  /** [departSec, arriveSec] seconds since midnight (승차/하차 time-of-day) */
  t: [number, number];
  /** wheelchair: 0=none/unknown, 1=수동 (manual), 2=전동 (electric) */
  w: 0 | 1 | 2;
}

/** public/data/unmet.json — unmet demand aggregated to ~100m cells (privacy: no raw points). */
export interface UnmetCell {
  lng: number; // cell center, rounded 3 decimals
  lat: number;
  unassigned: number; // 미배차 requests in this cell (pickup side)
  cancelled: number;
}

/** public/data/infra_points.json — infrastructure POI layer. */
export interface InfraPoint {
  lng: number;
  lat: number;
  type: "charger" | "hospital" | "pharmacy" | "welfare";
  name: string;
  dong?: string;
  /** extra label: hospital 종별 (의원/병원/종합병원…), charger capacity, welfare type */
  detail?: string;
}

/** public/data/toilets_gu.json — public toilets per 구 (no coordinates in source). */
export interface GuToilets {
  gu: string;
  total: number;
  accessible: number; // has ≥1 장애인용 fixture
}

/** public/data/elevators.json — metro elevators/escalators per station (2025 snapshot). */
export interface StationLift {
  line: string;     // "1호선".."4호선"
  station: string;
  elevators: number;
  escalators: number;
  firstYear: number | null; // earliest 설치년도
}

/** public/data/model_results.json — filled by the data scientist at the finals.
 *  The UI renders these cards as-is; status drives the badge. */
export interface ModelResult {
  id: string;               // "nb-regression" | "welch-t" | "chi2" | "decision-tree" | ...
  name: string;             // display name (Korean)
  status: "placeholder" | "final";
  headline: string;         // one-line result, e.g. "인프라 지수 +1단위 → 방문 +18% (IRR 1.18)"
  detail: string;           // interpretation paragraph
  numbers?: Record<string, number | string>; // coefficients, p-values, CI bounds
}

/** Convenience: all artifact paths in one place. */
export const DATA = {
  stats: "/data/stats.json",
  dongs: "/data/dongs.geojson",
  od: "/data/od.json",
  tripsAnim: "/data/trips_anim.json",
  unmet: "/data/unmet.json",
  infraPoints: "/data/infra_points.json",
  toiletsGu: "/data/toilets_gu.json",
  elevators: "/data/elevators.json",
  modelResults: "/data/model_results.json",
} as const;
