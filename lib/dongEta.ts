// 좌표 → 행정동 → 예상 배차 대기시간.
//
// dispatch_eta.json is keyed by (admCd, hour) on the PICKUP side, so a booking
// form needs to resolve the origin coordinate to a 행정동 first. We do proper
// point-in-polygon against dongs.geojson (206 features — cheap enough on the
// client) and fall back to the nearest centroid only when a point lands outside
// every polygon (coastline, 관외 출발).
//
// The estimate is 접수→승차 minutes from the May-2025 rehearsal fit — a
// statistical expectation for that dong×hour, NOT a live prediction. The UI must
// say so; see DispatchEtaMeta.caveats.

import { haversineM } from "./access";
import type { DispatchEtaData, DongProps } from "./types";
import type { DongCollection } from "./mapspec";

type Ring = [number, number][];

/** Ray-casting test for a single ring. */
function inRing(pt: [number, number], ring: Ring): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Polygon = [outer, ...holes]. Inside outer and outside every hole. */
function inPolygon(pt: [number, number], rings: Ring[]): boolean {
  if (rings.length === 0 || !inRing(pt, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (inRing(pt, rings[i])) return false;
  }
  return true;
}

function hitsGeometry(
  pt: [number, number],
  type: string,
  coords: unknown,
): boolean {
  if (type === "Polygon") return inPolygon(pt, coords as Ring[]);
  if (type === "MultiPolygon") {
    return (coords as Ring[][]).some((poly) => inPolygon(pt, poly));
  }
  return false;
}

export interface DongHit {
  props: DongProps;
  /** true when the point fell inside the polygon; false = nearest-centroid guess */
  exact: boolean;
}

/** Which 행정동 contains this [lng, lat]? */
export function findDong(
  coord: [number, number],
  dongs: DongCollection<DongProps>,
): DongHit | null {
  for (const f of dongs.features) {
    if (hitsGeometry(coord, f.geometry.type, f.geometry.coordinates)) {
      return { props: f.properties, exact: true };
    }
  }

  // Outside every polygon — fall back to the closest centroid so the page can
  // still show something, flagged as approximate.
  let best: DongHit | null = null;
  let bestM = Infinity;
  for (const f of dongs.features) {
    const m = haversineM(coord, f.properties.centroid);
    if (m < bestM) {
      bestM = m;
      best = { props: f.properties, exact: false };
    }
  }
  // Anything further than 15 km from every centroid is not Busan at all.
  return bestM <= 15000 ? best : null;
}

export interface WaitEstimate {
  minutes: number;
  ci: [number, number] | null;
  /** 표본수 (해당 동 24시간 합계) */
  n: number;
  /** 미배차+취소 비율 0..1 */
  unassignedShare: number;
  dongName: string;
  gu: string;
  hour: number;
  /** false when the dong was guessed from the nearest centroid */
  exactDong: boolean;
  /** true when this dong×hour had no cell and we used the dong's daily median */
  hourFallback: boolean;
}

/** Expected wait for a pickup in this dong at this hour. */
export function lookupWait(
  coord: [number, number],
  hour: number,
  dongs: DongCollection<DongProps>,
  eta: DispatchEtaData,
): WaitEstimate | null {
  const hit = findDong(coord, dongs);
  if (!hit) return null;

  const admCd = hit.props.admCd;
  const cells = eta.cells.filter((c) => c.admCd === admCd);
  if (cells.length === 0) return null;

  const exact = cells.find((c) => c.hour === hour);
  const cell = exact ?? medianCell(cells);
  if (!cell) return null;

  return {
    minutes: cell.minutes,
    ci: cell.ci,
    n: cell.n,
    unassignedShare: cell.unassignedShare,
    dongName: hit.props.name,
    gu: hit.props.gu,
    hour,
    exactDong: hit.exact,
    hourFallback: exact === undefined,
  };
}

/** The dong's middle-of-the-day cell, used when the requested hour has no data. */
function medianCell<T extends { minutes: number }>(cells: T[]): T | null {
  if (cells.length === 0) return null;
  const sorted = [...cells].sort((a, b) => a.minutes - b.minutes);
  return sorted[Math.floor(sorted.length / 2)];
}
