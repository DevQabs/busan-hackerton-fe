"use client";

// Client side of place lookup. All Kakao calls go through /api/places so the
// REST key stays on the server — there is no JS SDK, no domain whitelist, and
// no key in the client bundle. The map itself is maplibre + deck.gl
// (components/MapCanvas.tsx), so Kakao is only ever a data source here.

/** A resolved place: what the booking form needs to pin an origin/destination. */
export interface KakaoPlace {
  name: string;
  /** road address when available, else the lot-number address */
  address: string;
  /** [lng, lat] — GeoJSON order, matching lib/types.ts */
  coord: [number, number];
}

export class PlaceSearchError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const MESSAGES: Record<string, string> = {
  no_key: "검색 키가 설정되지 않았습니다 (KAKAO_REST_KEY)",
  upstream: "카카오 검색을 불러오지 못했습니다",
};

/** 장소·주소 검색 (상호명·건물명·아파트명·도로명주소). */
export async function searchPlaces(
  query: string,
  limit = 8,
): Promise<KakaoPlace[]> {
  const q = query.trim();
  if (!q) return [];

  let res: Response;
  try {
    res = await fetch(`/api/places?q=${encodeURIComponent(q)}`);
  } catch {
    throw new PlaceSearchError("network", "네트워크 오류로 검색할 수 없습니다");
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    const code = body.code ?? "upstream";
    throw new PlaceSearchError(code, MESSAGES[code] ?? "검색에 실패했습니다");
  }

  const body = (await res.json()) as { places?: KakaoPlace[] };
  return (body.places ?? []).slice(0, limit);
}

/** 카카오맵 외부 링크 — 좌표+이름으로 여는 지도 URL. */
export function kakaoMapUrl(coord: [number, number], name: string): string {
  const [lng, lat] = coord;
  return `https://map.kakao.com/link/map/${encodeURIComponent(name)},${lat},${lng}`;
}
