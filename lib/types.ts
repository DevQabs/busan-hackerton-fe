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
  // --- statistical enrichment (rehearsal on May citywide data; refit at finals) ---
  /** NB-model expected dropoffs given exposure + infra (null if model skipped) */
  expectedDropoffs: number | null;
  /** standardized deviance residual of the NB fit; strongly NEGATIVE = far fewer
   *  trips than expected = 잠재수요/침묵 의심 지역 (suppressed demand candidate) */
  suppressedZ: number | null;
  /** day-cluster bootstrap 90% CI of gapScore, [lo, hi] */
  gapCI: [number, number] | null;
  /** bootstrap probability this dong ranks in the top-5 by gapScore, 0..1 */
  pTop5: number | null;
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

/** public/data/ghosts.json — the "보이지 않는 승객" layer: requests that never
 *  became trips. Pickup-side points at request time-of-day, coords rounded to
 *  3 decimals (~110 m) for privacy. */
export interface GhostPoint {
  p: [number, number]; // [lng, lat], rounded 3 decimals
  t: number;           // seconds since midnight of 접수시간
  kind: "unassigned" | "cancelled"; // 미배차 | 취소
}

/** public/data/wait_km.json — waiting-time forensics (survival analysis).
 *  Event = vehicle assigned (배차). 미배차/취소 without 배차 are CENSORED at
 *  their cancel time — the naive median silently drops them. */
export interface WaitKm {
  /** assigned-only percentiles — the "official-style" metric (survivor-biased) */
  naive: { median: number; p90: number };
  /** Kaplan-Meier estimates including censored requests; null if S(t) never crosses */
  km: { median: number | null; p90: number | null };
  censoredShare: number; // share of requests treated as censored, 0..1
  /** survival curves S(t): [minutes, S]; labels like 전체 / 수동휠체어 / 전동휠체어 */
  curves: { label: string; points: [number, number][] }[];
  /** queue decomposition per request-hour: 접수→배차 vs 배차→승차 */
  queue: {
    hour: number;
    requests: number;
    unassignedRate: number;         // 0..1
    p50Assign: number | null;       // minutes 접수→배차
    p90Assign: number | null;
    p50Board: number | null;        // minutes 배차→승차
    p90Board: number | null;
  }[];
  /** fleet occupancy per hour-of-day: vehicles with an active 배차→하차 interval */
  fleet: { hour: number; avgActive: number; maxActive: number }[];
}

/** public/data/arrival_deserts.json — door-level scoring of dropoff hotspots
 *  against nearby infrastructure ("도착지 사각지대"), plus a greedy
 *  maximal-coverage suggestion of next-K facility locations. */
export interface DesertCell {
  lng: number;  // cell center (grid ~250 m), rounded
  lat: number;
  dropoffs: number; // completed dropoffs in the cell (period total)
  /** haversine meters to the nearest facility; null if none within 2 km */
  nearestM: { charger: number | null; hospital: number | null; welfare: number | null };
  /** Korean shortage badges, e.g. "충전소 800m 밖", "1층 상가 비율 낮음" */
  lack: string[];
  score: number; // dropoffs × weighted shortage; higher = worse
  rank: number;  // 1 = worst
  dong?: string; // containing 행정동 (short name) when resolvable
}
export interface DesertGreedyPick {
  lng: number;
  lat: number;
  gain: number;       // newly covered dropoffs by this pick
  cumCovered: number; // cumulative covered dropoffs
  cumShare: number;   // cumulative share of all desert dropoffs, 0..1
}
export interface ArrivalDeserts {
  params: { cellM: number; radiusM: number; note: string }; // note: methodology one-liner (Korean)
  cells: DesertCell[];   // ranked, worst first (cap ~200)
  greedy: DesertGreedyPick[]; // K sequential picks (K ~10)
}

/** public/data/infra_points.json — infrastructure POI layer. */
export interface InfraPoint {
  lng: number;
  lat: number;
  type: "charger" | "hospital" | "pharmacy" | "welfare" | "tourism";
  name: string;
  dong?: string;
  /** extra label: hospital 종별 (의원/병원/종합병원…), charger capacity, welfare type,
   *  tourism 카테고리 (전시/공연, 관광지 등) */
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

/** public/data/model_results.json — statistical model outputs.
 *  status: "placeholder" (not yet run) | "rehearsal" (fit on May citywide
 *  public data — numbers are real but the exposure is a proxy) | "final"
 *  (fit on the finals dataset by the data scientist).
 *  Array order = presentation order in the 통계 씬 (문제 규모 → 통제 필요성 →
 *  통제 후 효과 → 맞춤 근거 → 형평 → 시간대 편중 → 순위 신뢰도). */
export interface ModelResult {
  id: string;               // "retry-funnel" | "correlation" | "nb-regression" |
                            // "chi-square-type-purpose" | "welch-t" | "chi-square" |
                            // "bootstrap-stability" | ...
  name: string;             // display name (Korean)
  status: "placeholder" | "rehearsal" | "final";
  headline: string;         // one-line result, e.g. "인프라 지수 +1단위 → 방문 +18% (IRR 1.18)"
  detail: string;           // interpretation paragraph (Korean, plain factual tone)
  numbers?: Record<string, number | string>; // coefficients, p-values, CI bounds
  caveats?: string;         // limitations the presenter must say out loud (Korean)
}

/** public/data/model_charts.json — chart-only datasets for the 통계 씬 that
 *  cannot be derived client-side from other artifacts (they need the raw trip
 *  rows). Regenerated by the pipeline alongside model_results.json. */
export interface ModelCharts {
  /** 접수→배차 wait histogram (배차 성공 건), shares WITHIN each wheelchair
   *  group so the two distributions are comparable despite different n. */
  waitHist: {
    binMinutes: number; // bin width (5)
    nManual: number;
    nElectric: number;
    /** last bin label is "60+" (cap) */
    bins: { label: string; manual: number; electric: number }[];
  };
  /** 장애유형 × 이동 목적 contingency table (all 37,512 requests).
   *  rows = top-6 disability groups + "그 외 유형"; purposes end with "그 외". */
  typePurpose: {
    rows: string[];
    purposes: string[];
    counts: number[][]; // counts[rowIdx][purposeIdx]
    rowTotals: number[];
    colTotals: number[];
    n: number;
  };
}

/** Convenience: all artifact paths in one place. */
export const DATA = {
  stats: "/data/stats.json",
  dongs: "/data/dongs.geojson",
  od: "/data/od.json",
  tripsAnim: "/data/trips_anim.json",
  ghosts: "/data/ghosts.json",
  waitKm: "/data/wait_km.json",
  arrivalDeserts: "/data/arrival_deserts.json",
  unmet: "/data/unmet.json",
  infraPoints: "/data/infra_points.json",
  toiletsGu: "/data/toilets_gu.json",
  elevators: "/data/elevators.json",
  modelResults: "/data/model_results.json",
  modelCharts: "/data/model_charts.json",
  tourism: "/data/tourism.json",
  welfarePrograms: "/data/welfare_programs.json",
  disability: "/data/disability.json",
} as const;

/** public/data/unmet.json — unmet demand aggregated to ~100m cells (privacy: no raw points). */
export interface UnmetCell {
  lng: number; // cell center, rounded 3 decimals
  lat: number;
  unassigned: number; // 미배차 requests in this cell (pickup side)
  cancelled: number;
}

/** public/data/tourism.json — Busan tourist-site catalogue ("관광지 사각지대").
 *  Sourced from TourAPI-style xlsx exports (관광지/문화시설/레포츠/숙박 sheets),
 *  cross-referenced against the 배리어프리 문화예술관광지 layer already used by
 *  infra_points.json (type "tourism") to flag barrier-free coverage. */
export interface TourismSite {
  id: string;
  name: string;
  category: "관광지" | "문화시설" | "레포츠" | "숙박";
  lng: number;
  lat: number;
  address: string;
  gu: string; // 시군구, parsed from address; "기타" if unresolved
  phone?: string;
  /** raw 이용시간 text (Korean, may be empty) — shown verbatim in the UI */
  hoursRaw: string;
  /** raw 쉬는날 text (Korean, may be empty) */
  closedRaw: string;
  /** true when 이용시간 text indicates 24시간/상시 개방 (no daily close time) */
  alwaysOpen: boolean;
  /** true when 이용시간 could not be parsed into an hour range (filters treat as always-visible) */
  hoursUnknown: boolean;
  openHour: number | null;  // 0..23, null when alwaysOpen/hoursUnknown
  closeHour: number | null; // 0..23, null when alwaysOpen/hoursUnknown
  /** best-effort from 쉬는날: at least one weekday (월~금) is not a closed day */
  openWeekday: boolean;
  /** best-effort from 쉬는날: at least one weekend day (토·일) is not a closed day */
  openWeekend: boolean;
  /** matched against the barrier-free 문화예술관광지 layer (name/proximity match) */
  barrierFree: boolean;
  /** haversine meters to the nearest infra point of each type (null if none exist) */
  nearestM: { charger: number | null; hospital: number | null; welfare: number | null };
  /** Korean shortage badges vs. the "관광지 사각지대" thresholds (charger 2km /
   *  hospital 500m / welfare 1km), e.g. "충전소 2km 밖" — empty when fully covered */
  lack: string[];
  /** sum of (distance/threshold − 1) over each lacking category; 0 when none lack.
   *  Higher = worse. Used to rank barrier-free-lacking sites in the UI. */
  blindSpotScore: number;
}

export interface TourismCategoryStat {
  category: string;
  total: number;
  barrierFree: number;
  share: number; // barrierFree / total, 0..1
}

export interface TourismGuStat {
  gu: string;
  total: number;
  barrierFree: number;
  share: number;
}

export interface TourismStats {
  total: number;
  barrierFree: number;
  barrierFreeShare: number;
  byCategory: TourismCategoryStat[];
  byGu: TourismGuStat[]; // sorted by total desc
}

export interface TourismDeserts {
  sites: TourismSite[];
  stats: TourismStats;
}

/** public/data/welfare_programs.json — 부산 5개구 장애인복지관 프로그램
 *  ("장애유형별 복지 운영 프로그램"). Sourced from 5 gu-level program CSVs
 *  with differing schemas/encodings; classified into the 15 official
 *  disability types via a 3-tier matcher (explicit target text → content
 *  keyword inference → 공통/general fallback). Programs with no
 *  type-specific text (general) are additionally tagged with the 7
 *  "내부·비가시장애" types (신장/심장/호흡기/간/안면/장루_요루/뇌전증), since
 *  those rarely have activity restrictions implied by generic program text —
 *  시각·청각 are excluded from that fallback (real sensory access barriers,
 *  never mentioned in the source data). */
export interface WelfareProgram {
  id: string;
  gu: string;      // 남구 | 영도구 | 사하구 | 금정구 | 사상구
  center: string;  // 복지관명
  programName: string;
  description?: string;
  targetRaw?: string;   // original 대상/이용대상 free text
  schedule?: string;
  address?: string;
  lng?: number;
  lat?: number;
  /** true when lng/lat is a 구 centroid approximation (남구/사상구 source CSVs
   *  have no address/coordinate columns at all), not the actual 복지관 address. */
  locationApprox?: boolean;
  phone?: string;
  disabilityTypes: string[]; // subset of the 15 official types
  isGeneral: boolean;        // true when no type-specific text was found (공통)
  classifyTier: 1 | 2 | 3;   // 1=explicit, 2=content-inferred, 3=general
  /** UI-facing badge: "explicit" = 직접 명시, "inferred" = 내용 기반 추론
   *  (표시상 explicit과 동일 취급), "general" = 이용 가능(일반) */
  matchType: "explicit" | "inferred" | "general";
}

export interface WelfareTypeStat {
  type: string;
  total: number;
  byGu: Record<string, number>;
}

export interface WelfareGuStat {
  gu: string;
  total: number;
  generalCount: number;
  byType: Record<string, number>;
}

export interface WelfareProgramStats {
  total: number;
  generalCount: number;
  byType: WelfareTypeStat[];
  byGu: WelfareGuStat[]; // sorted by total desc
}

export interface WelfareProgramsData {
  programs: WelfareProgram[];
  stats: WelfareProgramStats;
}

/** The 15 official disability types, canonical display order. */
export const DISABILITY_TYPES = [
  "지체", "시각", "청각", "언어", "지적", "뇌병변", "자폐성", "정신",
  "신장", "심장", "호흡기", "간", "안면", "장루_요루", "뇌전증",
] as const;
export type DisabilityType = (typeof DISABILITY_TYPES)[number];

/** public/data/disability.json — 구·군별 장애인 등록현황(잠재 수요) × 두리발
 *  완료 운행(실제 이용) 교차 집계 ("장애인 수요 분석").
 *  Built by scripts/build_disability.mjs from 9개 구·군 등록현황 CSV(스키마
 *  제각각, CP949)와 두리발 운영 로그(2025-05). 값이 원자료에 없는 필드는 null. */
export interface DisabilityTypeStat {
  type: string;          // 장애유형 15종 (지체·시각·…·뇌전증)
  total: number | null;  // 강서구 언어: 청각(언어) 병합 표기라 null
  severe: number | null; // 심한 장애 — 유형별 정도 미제공 구(사하·강서)는 null
  mild: number | null;   // 심하지 않은 장애
  male: number | null;   // 성별 미제공 구(북·사하·강서)는 null
  female: number | null;
}

export interface DisabilityGu {
  gu: string;
  /** false = 등록현황 미공개 7개 구·군 (서·부산진·동래·해운대·금정·연제·수영) */
  hasRegistry: boolean;
  asOf: string | null;        // 등록현황 기준일 (남구는 기준일 미상 → null)
  registered: number | null;  // 등록 장애인 총수
  severe: number | null;
  mild: number | null;
  male: number | null;
  female: number | null;
  /** 강서구: 원자료가 청각·언어를 "청각(언어)"로 병합 → 청각에 계상 */
  hearingMerged: boolean;
  byType: DisabilityTypeStat[]; // hasRegistry=false면 빈 배열
  // --- 두리발 이용 (2025-05, 출발지 구 기준, 완료 운행만) ---
  trips: number;
  /** 로그 장애유형이 등록 15종에 매핑되는 운행 (65세이상·일시적 등 제외) */
  tripsDisabled: number;
  /** 이용자 ID가 없어 (출발좌표+유형+등급+휠체어) 조합으로 근사한 추정치 */
  estUsers: number;
  /** 등록 장애인 1,000명당 월 이용 건수 = trips / registered × 1000.
   *  건수 지표(비율 아님 — 한 사람이 여러 번 이용). hasRegistry=false → null */
  tripsPer1k: number | null;
}

export interface DisabilityData {
  period: string; // 두리발 로그 기간, "2025-05"
  totals: {
    registeredKnown: number;  // 등록현황 보유 9개 구·군 합계
    guWithRegistry: number;
    completedTrips: number;   // 결과=하차, 32,526
    tripsFromBusan: number;   // 출발지 행정동이 부산 구·군으로 매핑된 건
    tripsOutside: number;     // 관외(경남 등) 출발
  };
  /** 시 전체 유형별 등록(9개 구 합) vs 이용 비교. "기타 교통약자"(65세이상·
   *  일시적장애 등 비장애 교통약자)는 registered=null로 이용만 집계. */
  typeTotals: { type: string; registered: number | null; trips: number }[];
  gus: DisabilityGu[]; // 16개 구·군 전부, trips 내림차순
}
