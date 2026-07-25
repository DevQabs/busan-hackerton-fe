// Shared "도착 이후" accessibility logic.
//
// The 무장애가게 실사 gives 12 Y/N fields per shop. Accessibility is a CHAIN:
// 진입(enterable) → 이용(usable) → 편의(comfort). The first broken link decides
// the shop's verdict (weakest-link), and each broken link maps to one concrete
// fix with a responsible party. Both the 접근성 사각지대 screen and the older
// Last400 scene read these helpers so the verdicts can never diverge.

export type Cls = "good" | "warning" | "critical";

export interface AccessStatus {
  enterable: boolean;
  usable: boolean;
  comfort: boolean;
  /** dominant broken link: 입구(진입) | 층이동 | 내부이용 | 편의(화장실) | 완비 */
  barrier: string;
  cls: Cls;
}

/** `sim` = 입구 무턱화 counterfactual (entrance made step-free). */
export function statusOf(
  f: Record<string, string>,
  sim = false,
): AccessStatus {
  const entryOk =
    sim || f["입구턱"] !== "Y" || f["입구무턱"] === "Y" || f["경사로"] === "Y";
  const floorOk = f["일층"] === "Y" || f["엘리베이터"] === "Y";
  const enterable = entryOk && floorOk;
  const usable = enterable && f["테이블석"] === "Y";
  const comfort = usable && f["장애인화장실"] === "Y";
  const barrier = !entryOk
    ? "입구(진입)"
    : !floorOk
      ? "층이동"
      : f["테이블석"] !== "Y"
        ? "내부이용"
        : f["장애인화장실"] !== "Y"
          ? "편의(화장실)"
          : "완비";
  const cls: Cls = comfort ? "good" : !enterable ? "critical" : "warning";
  return { enterable, usable, comfort, barrier, cls };
}

export const CLS_RGBA: Record<Cls, [number, number, number, number]> = {
  good: [52, 211, 153, 235], // infra green — 완비
  warning: [251, 191, 36, 235], // warn amber — 진입가능·미완비
  critical: [229, 72, 77, 240], // gapHL red — 진입 불가
};

export const CLS_HEX: Record<Cls, string> = {
  good: "#34d399",
  warning: "#fbbf24",
  critical: "#e5484d",
};

/** hard gate (입구/층) → red, quality gap (내부/편의) → amber. */
export function barrierHex(barrier: string): string {
  if (barrier.startsWith("입구") || barrier === "층이동") return "#e5484d";
  if (barrier === "완비") return "#34d399";
  return "#fbbf24";
}

/** the concrete fix + responsible party for each broken link. */
export function actionOf(barrier: string): { label: string; owner: string } {
  if (barrier.startsWith("입구") || barrier === "층이동")
    return { label: "입구 무턱화·경사로 설치", owner: "구청·건물주" };
  if (barrier === "내부이용")
    return { label: "내부 통로·좌석 개선", owner: "업주" };
  if (barrier === "편의(화장실)")
    return { label: "장애인화장실 설치", owner: "업주·구청" };
  return { label: "접근 거점 유지", owner: "—" };
}

/** 소관 (responsible party) derived from the Korean shortage badges. */
export function ownersOfLack(lack: string[]): string[] {
  const out: string[] = [];
  const push = (v: string) => {
    if (!out.includes(v)) out.push(v);
  };
  for (const l of lack) {
    if (l.includes("충전")) push("구청·윌체어");
    else if (l.includes("병의원") || l.includes("병원") || l.includes("의원"))
      push("구청");
    else if (l.includes("복지")) push("구청");
    else if (l.includes("상가") || l.includes("1층")) push("윌체어");
  }
  return out;
}

/** The single recommended action for a desert cell, from its worst shortage. */
export function actionOfLack(lack: string[]): { label: string; owner: string } {
  if (lack.some((l) => l.includes("충전")))
    return { label: "전동휠체어 급속충전기 설치", owner: "구청·윌체어" };
  if (lack.some((l) => l.includes("병의원")))
    return { label: "의료 접근 동선 확보 (셔틀·연계 진료)", owner: "구청" };
  if (lack.some((l) => l.includes("복지")))
    return { label: "복지시설 프로그램 순회 배치", owner: "구청" };
  if (lack.some((l) => l.includes("상가") || l.includes("1층")))
    return { label: "1층 무장애가게 확충·입구 개선", owner: "윌체어·업주" };
  return { label: "현 수준 유지 관찰", owner: "—" };
}

/** meters between two [lng, lat] points (haversine). */
export function haversineM(
  a: [number, number],
  b: [number, number],
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
