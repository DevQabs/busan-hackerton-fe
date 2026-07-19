// Scene registry — sidebar order tells the story (스토리 순서).

export type SceneId =
  | "overview"
  | "flow"
  | "forensics"
  | "demand"
  | "od"
  | "gap"
  | "deserts"
  | "last400"
  | "unmet"
  | "infra"
  | "priority"
  | "models"
  | "tourism"
  | "welfare"
  | "disability";

export interface SceneDef {
  id: SceneId;
  label: string;
  caption: string;
  /** true = 지도 대신 본문이 중앙 전체를 차지하는 읽기 중심 씬
   *  (통계 모델·정책 브리프 — 우측 패널은 숨김). */
  fullPage?: boolean;
}

export const SCENES: SceneDef[] = [
  { id: "overview", label: "개요", caption: "두리발 운행 핵심 지표" },
  { id: "flow", label: "하루의 흐름", caption: "시간대별 이동 애니메이션" },
  { id: "forensics", label: "대기시간 포렌식", caption: "생존분석으로 본 진짜 대기" },
  { id: "demand", label: "이동수요 지도", caption: "어디서 타고 어디서 내리나" },
  { id: "od", label: "OD 흐름", caption: "행정동 간 이동 경로" },
  { id: "gap", label: "사각지대 분석", caption: "수요 × 인프라 격차" },
  { id: "deserts", label: "도착지 사각지대", caption: "하차 후 시설 공백 250m 격자" },
  { id: "last400", label: "도착 이후 400m", caption: "무장애가게 실사 × 하차 — 진입 사슬 격차" },
  { id: "unmet", label: "미충족 수요", caption: "미배차·취소 밀집 지역" },
  { id: "infra", label: "인프라 지도", caption: "무장애 시설 분포" },
  { id: "priority", label: "우선순위·시뮬레이션", caption: "개선 투자 효과 미리보기" },
  { id: "models", label: "데이터 분석 · 정책 근거", caption: "7개 통계 검증 → 실행주체별 정책 제안", fullPage: true },
  { id: "tourism", label: "관광지 사각지대", caption: "검색·개장시간 필터 · 베리어프리 커버리지" },
  { id: "welfare", label: "장애유형별 복지 프로그램", caption: "5개구 장애인복지관 운영 프로그램 현황" },
  { id: "disability", label: "장애인 수요 분석", caption: "등록 장애인 × 두리발 이용 갭" },
];
