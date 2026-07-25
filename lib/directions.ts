"use client";

// Client side of the route lookup. Asks /api/directions for the real road
// geometry and falls back to the straight origin→destination line when the
// proxy is unavailable (no REST key yet, upstream down, offline demo). The
// caller renders both the same way, so a missing key degrades the fidelity of
// the line but never breaks the page.

import { haversineM } from "./access";

export type RouteSource = "road" | "straight";

export interface RouteResult {
  /** [[lng, lat], ...] — feeds deck.gl PathLayer directly */
  path: [number, number][];
  distanceM: number;
  /** driving seconds from Kakao; null when we only have the straight line */
  durationS: number | null;
  source: RouteSource;
  /** why we fell back, for the honesty caption under the map */
  note?: string;
}

const NOTES: Record<string, string> = {
  no_key: "길찾기 키 미설정 — 직선 표시",
  upstream: "길찾기 응답 오류 — 직선 표시",
  fetch_failed: "길찾기 호출 실패 — 직선 표시",
  no_route: "도로 경로를 찾지 못함 — 직선 표시",
  empty_path: "경로 좌표 없음 — 직선 표시",
  bad_input: "좌표 오류 — 직선 표시",
};

function straightLine(
  origin: [number, number],
  destination: [number, number],
  note?: string,
): RouteResult {
  return {
    path: [origin, destination],
    distanceM: Math.round(haversineM(origin, destination)),
    durationS: null,
    source: "straight",
    note,
  };
}

/** Total길이 of a polyline in meters (used for the road path, which Kakao also
 *  reports — we prefer Kakao's own summary and only compute this as a guard). */
function pathLengthM(path: [number, number][]): number {
  let sum = 0;
  for (let i = 1; i < path.length; i++) sum += haversineM(path[i - 1], path[i]);
  return Math.round(sum);
}

export async function fetchRoute(
  origin: [number, number],
  destination: [number, number],
): Promise<RouteResult> {
  const qs = new URLSearchParams({
    origin: `${origin[0]},${origin[1]}`,
    destination: `${destination[0]},${destination[1]}`,
  });

  try {
    const res = await fetch(`/api/directions?${qs}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      return straightLine(
        origin,
        destination,
        NOTES[body.code ?? ""] ?? "길찾기 사용 불가 — 직선 표시",
      );
    }
    const body = (await res.json()) as {
      path: [number, number][];
      distanceM: number | null;
      durationS: number | null;
    };
    if (!Array.isArray(body.path) || body.path.length < 2) {
      return straightLine(origin, destination, NOTES.empty_path);
    }
    return {
      path: body.path,
      distanceM: body.distanceM ?? pathLengthM(body.path),
      durationS: body.durationS,
      source: "road",
    };
  } catch {
    return straightLine(origin, destination, NOTES.fetch_failed);
  }
}
