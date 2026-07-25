// 2막 해운대 상세("접근성 사각지대" 개조판) 전용 데이터 계약.
// 원본 lib/types.ts를 수정하지 않기 위해 분리한 파일 — dong_compare.json 한정.

export const DATA_DONG_COMPARE = "/data/dong_compare.json" as const;

/** public/data/dong_compare.json — 접근성 사각지대 step-1 "수요와 인프라, 어디서
 *  어긋나는가" 5-chip 비교. 본선 두리발(도착 기준) × 편의시설 4종 × 등록장애인
 *  (2025-12) × 일반인 인구이동(2022-04~06 기준선 — 시점 상이 각주 필수). */
export interface DongCompareEntry {
  name: string;          // canonical short name ('반여1동' — '제' 제거형)
  code: string | null;   // 행정동코드 10자리 (인구이동 join)
  calls: number;         // 접수 (목적지 기준)
  completed: number;     // 하차
  unmet: number;         // 접수 − 하차 (취소+미배차)
  unmetRate: number;     // 0–1
  fac: { restroom: number; parking: number; charger: number; elevator: number };
  facTotal: number;
  disabled: number;      // 등록장애인 (2025-12)
  /** 등록장애인 1천명당 완료 도착 — 도착 기준, 거주자 이용률 아님 */
  per1k: number | null;
  duribalShare: number;  // 이 동의 두리발 도착 비중 (0–1)
  moveShare: number;     // 이 동의 일반인 이동 비중 (0–1)
  /** (duribalShare − moveShare) × 100 [%p]. 음수 클수록 "일반인은 가는데
   *  교통약자는 못 가는" 동. */
  gapPp: number;
}
export interface DongCompareHour {
  hour: number;
  duribalShare: number;  // 두리발 접수의 시간대 비중
  generalShare: number;  // 일반인 이동의 시간대 비중
}
export interface DongCompare {
  meta: {
    duribalPeriod: string;
    moveBasis: string;
    disabledAsOf: string;
    note: string;
  };
  totals: { calls: number; completed: number; unmet: number };
  dongs: DongCompareEntry[];  // sorted by calls desc, 18 dongs
  hourly: DongCompareHour[];  // 24 entries
}
