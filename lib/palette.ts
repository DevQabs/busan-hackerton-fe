// Central color constants. Hex values mirror the CSS vars in app/globals.css;
// RGB tuples are for deck.gl layer accessors ([r, g, b] or [r, g, b, a]).

export const HEX = {
  bg: "#0b0f1a",
  panel: "#121826",
  line: "#232b3d",
  ink: "#e2e8f0",
  inkDim: "#8b96ab",
  accent: "#22d3ee", // 전동휠체어 / 강조
  demand: "#38bdf8", // 이동수요 / 수동휠체어
  unmet: "#fb7185", // 미충족 수요
  infra: "#34d399", // 인프라
  warn: "#fbbf24", // 경고 / 대기
  gapHL: "#e5484d", // 사각지대 (수요高·인프라低)
  gapHH: "#8b5cf6",
  gapLH: "#14b8a6",
  gapLL: "#2a3348",
  tourism: "#c084fc", // 배리어프리 문화예술관광지
} as const;

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

export const RGB_ACCENT: RGB = [34, 211, 238];
export const RGB_DEMAND: RGB = [56, 189, 248];
export const RGB_UNMET: RGB = [251, 113, 133];
export const RGB_INFRA: RGB = [52, 211, 153];
export const RGB_WARN: RGB = [251, 191, 36];
export const RGB_GRAY: RGB = [100, 116, 139];
export const RGB_TOURISM: RGB = [192, 132, 252];

export const RGB_GAP: Record<"HH" | "HL" | "LH" | "LL", RGBA> = {
  HL: [229, 72, 77, 210], // priority: high demand, low infra
  HH: [139, 92, 246, 150],
  LH: [20, 184, 166, 120],
  LL: [42, 51, 72, 110],
};

/** Sequential blues for HexagonLayer colorRange (light on dark surface). */
export const HEX_COLOR_RANGE: RGB[] = [
  [15, 40, 66],
  [17, 62, 98],
  [22, 92, 132],
  [33, 133, 175],
  [56, 189, 248],
  [147, 220, 252],
];

/** Infra POI colors by type — distinct hues from the dashboard palette. */
export const INFRA_COLORS: Record<string, RGB> = {
  charger: RGB_ACCENT,
  hospital: RGB_INFRA,
  pharmacy: RGB_DEMAND,
  welfare: RGB_WARN,
  tourism: RGB_TOURISM,
};

export const INFRA_HEX: Record<string, string> = {
  charger: HEX.accent,
  hospital: HEX.infra,
  pharmacy: HEX.demand,
  welfare: HEX.warn,
  tourism: HEX.tourism,
};

export const INFRA_LABEL: Record<string, string> = {
  charger: "충전소",
  hospital: "병의원",
  pharmacy: "약국",
  welfare: "복지시설",
  tourism: "문화관광지",
};

/** 15 official disability types — colors span the existing hue set (accent/
 *  demand/infra/warn/unmet/tourism/gapHH) plus a few new hues so all 15
 *  stay visually distinct in the welfare-programs scene. */
export const DISABILITY_HEX: Record<string, string> = {
  지체: "#38bdf8",
  시각: "#fbbf24",
  청각: "#c084fc",
  언어: "#f472b6",
  지적: "#34d399",
  뇌병변: "#e5484d",
  자폐성: "#8b5cf6",
  정신: "#fb7185",
  신장: "#22d3ee",
  심장: "#f97316",
  호흡기: "#2dd4bf",
  간: "#a3e635",
  안면: "#eab308",
  장루_요루: "#818cf8",
  뇌전증: "#f43f5e",
};

export const DISABILITY_TYPE_LABEL: Record<string, string> = {
  지체: "지체장애",
  시각: "시각장애",
  청각: "청각장애",
  언어: "언어장애",
  지적: "지적장애",
  뇌병변: "뇌병변장애",
  자폐성: "자폐성장애",
  정신: "정신장애",
  신장: "신장장애",
  심장: "심장장애",
  호흡기: "호흡기장애",
  간: "간장애",
  안면: "안면장애",
  장루_요루: "장루·요루장애",
  뇌전증: "뇌전증장애",
};
