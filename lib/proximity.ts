// 목적지 기준 접근성 시설 근접성.
//
// Pure functions over the existing artifacts — no new data contract:
//   infra_points.json  (InfraPoint)   → 휠체어충전소 · 복지시설 · 배리어프리 관광지 · 병의원
//   access_actions.json (AccessShop)  → 무장애 식당 12항목 실사
//
// Per the interview: every category shows its single nearest facility, and 식당
// alone gets a Top-5 list. Distances are straight-line (haversine), matching how
// DispatchScene and arrival_deserts.json already report proximity — the road
// route is only drawn for the trip itself, not for each facility.
//
// COVERAGE CAVEAT: the 해운대구 본선 artifacts (access_actions.json 321 shops,
// haeundae_facilities.json 1,258 points) stop at the 구 boundary, while
// infra_points.json is citywide. A destination outside 해운대구 therefore shows
// 충전소/복지/관광/병의원 but no 식당·화장실·주차장·승강기 — callers must label that
// as a data-coverage limit, never as "nothing nearby".

import { haversineM, statusOf, type AccessStatus } from "./access";
import {
  FIT_RANK,
  wheelchairFit,
  type Chair,
  type WheelchairFit,
} from "./wheelchair";
import type { AccessShop, HaeundaeFacility, InfraPoint } from "./types";

/** Facility categories the booking page resolves.
 *  charger/welfare/tourism/hospital come from the citywide infra_points.json;
 *  toilet/parking/elevator come from haeundae_facilities.json (해운대구 only, the
 *  only source with per-facility coordinates for those three). */
export type FacilityKind =
  | "charger"
  | "welfare"
  | "tourism"
  | "hospital"
  | "toilet"
  | "parking"
  | "elevator";

export const FACILITY_LABEL: Record<FacilityKind, string> = {
  charger: "휠체어 충전소",
  welfare: "복지시설",
  tourism: "배리어프리 관광지",
  hospital: "병의원",
  toilet: "장애인 화장실",
  parking: "장애인 주차장",
  elevator: "장애인용 승강기",
};

/** Display order: the ones a 교통약자 checks before leaving, first.
 *
 *  "elevator" is deliberately ABSENT. A 승강기 is a property of the building you
 *  are entering, not an amenity you travel to — and it is already reported per
 *  shop as the 엘리베이터 tag (lib/access.ts `floorOk`). Listing it as a nearby
 *  POI would show the same fact twice, in two different ways. The type and the
 *  584 데이터 포인트 stay available for other uses. */
export const FACILITY_ORDER: FacilityKind[] = [
  "toilet",
  "charger",
  "parking",
  "welfare",
  "tourism",
  "hospital",
];

/** Which kinds only exist inside 해운대구 — used to explain an empty slot as a
 *  data-coverage limit rather than "there is nothing near you". */
export const HAEUNDAE_ONLY_KINDS: FacilityKind[] = ["toilet", "parking"];

export interface NearestFacility {
  kind: FacilityKind;
  label: string;
  name: string;
  detail?: string;
  coord: [number, number];
  distanceM: number;
}

/** Nearest single facility of each kind, in FACILITY_ORDER. Kinds with no point
 *  within `maxM` are omitted so the UI can name the gap explicitly.
 *
 *  Two sources are merged because neither alone covers the categories the trip
 *  planner needs: infra_points.json is citywide but has no 화장실/주차장/승강기,
 *  while haeundae_facilities.json has those but stops at the 구 boundary. */
export function nearestByKind(
  destination: [number, number],
  infra: InfraPoint[],
  facilities: HaeundaeFacility[] = [],
  kinds: FacilityKind[] = FACILITY_ORDER,
  maxM = 5000,
): NearestFacility[] {
  const best = new Map<FacilityKind, NearestFacility>();

  const consider = (
    kind: FacilityKind,
    name: string,
    lng: number,
    lat: number,
    detail?: string,
  ) => {
    if (!kinds.includes(kind)) return;
    const coord: [number, number] = [lng, lat];
    const distanceM = haversineM(destination, coord);
    if (distanceM > maxM) return;
    const prev = best.get(kind);
    if (prev && prev.distanceM <= distanceM) return;
    best.set(kind, {
      kind,
      label: FACILITY_LABEL[kind],
      name,
      detail,
      coord,
      distanceM: Math.round(distanceM),
    });
  };

  for (const p of infra) {
    consider(p.type as FacilityKind, p.name, p.lng, p.lat, p.detail);
  }
  for (const p of facilities) {
    // 충전소는 두 소스에 모두 있다 — 더 가까운 쪽이 consider() 안에서 이긴다.
    consider(p.type, p.name, p.lng, p.lat, p.addr);
  }

  return kinds
    .map((k) => best.get(k))
    .filter((f): f is NearestFacility => f !== undefined);
}

export interface NearbyShop {
  shop: AccessShop;
  status: AccessStatus;
  distanceM: number;
  /** 탑승 휠체어 종류별 적합 판정 (lib/wheelchair.ts) */
  fit: WheelchairFit;
}

/** 목적지 반경 내 무장애 식당 Top-N, 가까운 순.
 *  Verdicts are recomputed via statusOf() on the raw 12 fields rather than read
 *  from the artifact's precomputed booleans, so this page can never disagree
 *  with the 접근성 사각지대 / Last400 scenes. */
export function nearbyShops(
  destination: [number, number],
  shops: AccessShop[],
  chair: Chair = "none",
  limit = 5,
  maxM = 1500,
): NearbyShop[] {
  return dedupe(shops)
    .map((shop) => ({
      shop,
      status: statusOf(shop.fields),
      distanceM: Math.round(haversineM(destination, [shop.lng, shop.lat])),
      fit: wheelchairFit(shop.fields, chair),
    }))
    .filter((s) => s.distanceM <= maxM)
    // 확인된 장벽(이용 불가)은 추천 목록에서 제외한다 — 휠체어 이용자에게
    // 들어갈 수 없는 가게를 Top-5 자리에 앉히는 것은 추천이 아니다. 대신 몇 곳이
    // 왜 빠졌는지는 groupNearbyShops().excluded 가 밝힌다.
    .filter((s) => s.fit.fit !== "unfit")
    // 이용 가능 → 확인 필요 순, 같은 등급 안에서는 가까운 순.
    .sort(
      (a, b) =>
        FIT_RANK[a.fit.fit] - FIT_RANK[b.fit.fit] || a.distanceM - b.distanceM,
    )
    .slice(0, limit);
}

/** 업종 표기 정규화. 원자료에 `"비알코올 "`처럼 뒤쪽 공백이 붙은 값이 있어서,
 *  그대로 쓰면 같은 업종이 칩 두 개로 갈라진다. */
export function normCat(cat: string): string {
  return cat.trim();
}

export interface CatCount {
  cat: string;
  count: number;
}

export interface GroupedShops {
  /** 이용 가능 — 실사로 확인된 곳 */
  fit: NearbyShop[];
  /** 확인 필요 — 정보 부족이나 경사로처럼 현장 확인이 필요한 곳 */
  check: NearbyShop[];
  /** 이용 불가로 목록에서 뺀 곳 수 */
  excluded: number;
  /** 반경 내 표시 가능한 곳의 업종별 개수, 많은 순.
   *  업종 필터와 무관하게 항상 전체 목록이므로 칩이 사라지지 않는다 — 필터를 걸면
   *  칩이 없어져서 해제할 수 없게 되는 상황을 막는다. */
  cats: CatCount[];
}

/** 두 칸(이용 가능 / 확인 필요)을 각각 채운다.
 *
 *  한 리스트를 잘라 나누면 가까운 '확인 필요'가 상위를 차지해 '이용 가능'이 한 곳도
 *  안 보이는 일이 생긴다. 그래서 그룹별로 따로 정렬·절단해 각 칸이 자기 Top-N을 갖게
 *  한다 — 두 칸의 개수는 서로 다를 수 있다. */
export function groupNearbyShops(
  destination: [number, number],
  shops: AccessShop[],
  chair: Chair = "none",
  catFilter: string[] = [],
  perGroup = 5,
  maxM = 1500,
): GroupedShops {
  const inRange = dedupe(shops)
    .map((shop) => ({
      shop,
      status: statusOf(shop.fields),
      distanceM: Math.round(haversineM(destination, [shop.lng, shop.lat])),
      fit: wheelchairFit(shop.fields, chair),
    }))
    .filter((s) => s.distanceM <= maxM)
    .sort((a, b) => a.distanceM - b.distanceM);

  // 이용 불가는 어차피 표시하지 않으므로 업종 칩에서도 세지 않는다.
  const displayable = inRange.filter((s) => s.fit.fit !== "unfit");

  const counts = new Map<string, number>();
  for (const s of displayable) {
    const c = normCat(s.shop.cat);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }

  // 업종 필터는 그룹을 자르기 전에 적용해야 한다 — 5곳으로 자른 뒤 걸러내면
  // 해당 업종이 반경 안에 있어도 화면에는 0곳으로 나온다.
  const picked =
    catFilter.length === 0
      ? displayable
      : displayable.filter((s) => catFilter.includes(normCat(s.shop.cat)));

  return {
    fit: picked.filter((s) => s.fit.fit === "fit").slice(0, perGroup),
    check: picked.filter((s) => s.fit.fit === "check").slice(0, perGroup),
    excluded: inRange.filter((s) => s.fit.fit === "unfit").length,
    cats: [...counts.entries()]
      .map(([cat, count]) => ({ cat, count }))
      .sort((a, b) => b.count - a.count || a.cat.localeCompare(b.cat, "ko")),
  };
}

/** Drop repeated rows for the same storefront.
 *
 *  access_actions.json currently carries 3 such pairs (산마루 identical, 거대갈비 and
 *  양산왕돼지국밥 ~2 m apart with a different 업종 label) — a Top-5 list that spends
 *  two slots on one restaurant is worse than useless to someone planning a trip.
 *  The key is 상호명 + 좌표(4 decimals ≈ 11 m): tight enough that genuinely separate
 *  branches survive (몽불 in 재송1동 vs 좌2동), loose enough to catch the metre-level
 *  coordinate drift. Different names at one address (a mall floor) are untouched. */
function dedupe(shops: AccessShop[]): AccessShop[] {
  const seen = new Set<string>();
  const out: AccessShop[] = [];
  for (const s of shops) {
    const key = `${s.name}@${s.lng.toFixed(4)},${s.lat.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** "320m" / "1.4km" — one formatter so every card reads the same. */
export function formatDistance(m: number): string {
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`;
}

/** "12분" / "1시간 5분" from seconds. */
export function formatDuration(sec: number): string {
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분`;
  return `${Math.floor(min / 60)}시간 ${min % 60}분`;
}

/** The 12 감사 항목 in a fixed display order (chain order, not artifact order):
 *  진입 → 층이동 → 내부이용 → 편의 → 주차 → 기타. */
export const TAG_ORDER = [
  "일층",
  "경사로",
  "입구턱",
  "입구무턱",
  "엘리베이터",
  "테이블석",
  "장애인화장실",
  "화장실턱",
  "화장실무턱",
  "주차장",
  "장애인주차장",
  "테이크아웃",
] as const;

/** 입구턱·화장실턱 are barriers: "Y" means an obstacle EXISTS, so a green tag
 *  would be a lie. Every other field is a positive amenity. */
const NEGATIVE_TAGS = new Set(["입구턱", "화장실턱"]);

export interface AccessTag {
  key: string;
  /** raw 실사값 */
  value: "Y" | "N";
  /** true = 접근성에 유리, false = 불리 — drives the O/X colour */
  good: boolean;
}

export function accessTags(fields: Record<string, "Y" | "N">): AccessTag[] {
  return TAG_ORDER.filter((k) => k in fields).map((k) => {
    const value = fields[k];
    const isNegative = NEGATIVE_TAGS.has(k);
    return { key: k, value, good: isNegative ? value !== "Y" : value === "Y" };
  });
}
