// Presentation pages. The combined pages compose several analytical
// datasets into a shared map instead of exposing the old scenes as navigation.

export type PageId =
  | "flow"
  | "accessibility-decision"
  | "infrastructure"
  | "blindspots"
  | "dispatch-analysis"
  | "statistics"
  | "dispatchEta"
  | "blindspots-hw";

export interface PageDef {
  id: PageId;
  label: string;
  caption: string;
}

export const PAGES: PageDef[] = [
  {
    id: "flow",
    label: "하루의 흐름",
    caption: "시간대별 이동 애니메이션",
  },
  {
    id: "accessibility-decision",
    label: "접근성 진단",
    caption: "충분한가·왜·무엇부터",
  },
  {
    id: "infrastructure",
    label: "생활 인프라",
    caption: "시설·프로그램·장애유형 커버리지",
  },
  {
    id: "blindspots",
    label: "접근성 사각지대",
    caption: "수요 격차에서 도착 이후 400m까지",
  },
  {
    id: "dispatch-analysis",
    label: "배차 시스템",
    caption: "시간·출발·도착 기반 배차 판단",
  },
  {
    id: "statistics",
    label: "통계 대시보드",
    caption: "우선순위 지도와 세 가지 근거",
  },
  {
    id: "dispatchEta",
    label: "배차 예측 지도",
    caption: "동×시간대 예상 배차 대기시간",
  },
  {
    id: "blindspots-hw",
    label: "동하버전 — 해운대 진단",
    caption: "문제 진단 · 무엇을 비교할까 7칩",
  },
];
