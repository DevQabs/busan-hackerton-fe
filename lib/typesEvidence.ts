// 통계 씬(statistical-evidence) 전용 데이터 계약.
// 원본 lib/types.ts(frozen)를 수정하지 않기 위해 분리 — analysis/ 스크립트 산출물.

/** analysis/build_dispatch_hourly.py — 본선 해운대 시간대별 미배차·운행 추정 */
export const DATA_HAEUNDAE_DISPATCH = "/data/haeundae_dispatch.json" as const;

/** analysis/build_hospital_distance.py — 병원 목적 통행의 거리-이용 관계 (전역 5월) */
export const DATA_HOSPITAL_DISTANCE = "/data/hospital_distance.json" as const;

export interface DispatchHourly {
  hour: number;
  requests: number;
  unassigned: number; // 배차시간이 없는 접수
  unassignedRate: number; // 0–1
  avgActive: number; // 해당 시각 동시 진행 운행 건수(일 평균) — 차량 ID 없음, 하한 추정
  maxActive: number;
}

export interface HaeundaeDispatch {
  meta: {
    period: string;
    status: "rehearsal" | "final";
    note: string;
    fleetSkipped: number;
  };
  totals: {
    requests: number;
    unassigned: number;
    completed: number;
    cancelled: number;
  };
  hourly: DispatchHourly[]; // 24 entries
}

export interface HospitalDistanceBin {
  label: string; // "0–2km" …
  trips: number;
  unassigned: number;
  unassignedRate: number; // 0–1
}

export interface HospitalDistanceDong {
  name: string; // dongs.geojson properties.name과 조인되는 표기
  gu: string;
  trips: number; // 전체 접수(출발 기준)
  hospTrips: number;
  hospShare: number; // 병원행 / 전체, 0–1
  meanHospKm: number; // 병원행 평균 직선거리
  failRate: number; // 병원행 중 미배차, 0–1
}

export interface HospitalDistance {
  meta: { period: string; status: "rehearsal" | "final"; note: string };
  totals: {
    hospTrips: number;
    unassigned: number;
    unassignedRate: number;
    medianKm: number;
    noCoord: number;
  };
  bins: HospitalDistanceBin[];
  /** 동별 산점(x=meanHospKm, y=hospShare%)의 상관·회귀 — 파이프라인 산출 */
  corr: { n: number; pearsonR: number; slope: number; intercept: number; t: number };
  dongs: HospitalDistanceDong[]; // meanHospKm 내림차순
}
