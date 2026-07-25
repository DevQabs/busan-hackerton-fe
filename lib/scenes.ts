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
  /** 폰 하단 탭 이름. 한 칸이 ~95px(390px 폰 기준)이라 두 줄까지 쓰고,
   *  줄바꿈은 띄어쓰기에서만 일어난다(break-keep). "흐름·진단"처럼 잘라 쓰면
   *  무엇을 여는 탭인지 읽히지 않아서 전체 이름을 유지한다. */
  short: string;
}

/** URL 조각 — 상태가 아니라 주소로 페이지를 연다. 메뉴에서 감춘 페이지도
 *  주소는 살아 있어야 해서 여기에는 전부 남긴다. */
export const PAGE_SLUG: Record<PageId, string> = {
  flow: "flow",
  "accessibility-decision": "accessibility",
  "blindspots-hw": "haeundae",
  infrastructure: "infrastructure",
  blindspots: "blindspots",
  "dispatch-analysis": "dispatch",
  statistics: "statistics",
  dispatchEta: "dispatch-eta",
};

export const PAGE_BY_SLUG: Record<string, PageId> = Object.fromEntries(
  Object.entries(PAGE_SLUG).map(([id, slug]) => [slug, id as PageId]),
) as Record<string, PageId>;

/** 주소 없이 들어오면 여기로 — 메뉴의 첫 페이지. */
export const DEFAULT_SLUG = PAGE_SLUG.flow;

/** 메뉴에 함께 세우지만 대시보드 씬이 아닌 화면. 별도 라우트(app/booking)라
 *  PageId를 주지 않고 주소로 넘어간다 — 사이드바는 PAGES 뒤에 이어서 그린다. */
export interface ExternalPageDef {
  href: string;
  label: string;
  caption: string;
  short: string;
}

export const EXTERNAL_PAGES: ExternalPageDef[] = [
  {
    href: "/booking",
    label: "배차 대기 · 목적지 주변",
    caption: "예상 대기시간과 주변 가게·시설 (음성지원)",
    short: "배차 대기",
  },
];

export const PAGES: PageDef[] = [
  {
    id: "flow",
    label: "하루의 흐름",
    caption: "시간대별 이동 애니메이션",
    short: "하루의 흐름",
  },
  {
    id: "accessibility-decision",
    label: "접근성 진단",
    caption: "충분한가·왜·무엇부터",
    short: "접근성 진단",
  },
  {
    id: "blindspots-hw",
    label: "해운대 상세 진단",
    caption: "본선 데이터 · 무엇을 비교할까 7칩",
    short: "해운대 상세",
  },
  // 발표용으로 앞의 3개만 노출한다. 씬·라우팅은 그대로 살아 있으니 아래 주석만
  // 풀면 즉시 되돌아온다 (PageId 유니온에도 그대로 남겨 뒀다).
  // {
  //   id: "infrastructure",
  //   label: "생활 인프라",
  //   caption: "시설·프로그램·장애유형 커버리지",
  // },
  // {
  //   id: "blindspots",
  //   label: "접근성 사각지대",
  //   caption: "수요 격차에서 도착 이후 400m까지",
  // },
  // {
  //   id: "dispatch-analysis",
  //   label: "배차 시스템",
  //   caption: "시간·출발·도착 기반 배차 판단",
  // },
  // {
  //   id: "statistics",
  //   label: "통계 대시보드",
  //   caption: "우선순위 지도와 세 가지 근거",
  // },
  // {
  //   id: "dispatchEta",
  //   label: "배차 예측 지도",
  //   caption: "동×시간대 예상 배차 대기시간",
  // },
];
