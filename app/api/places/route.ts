// 카카오 로컬 검색 프록시 (장소/주소 → 좌표).
//
// Runs server-side so the REST key never reaches the browser: no JS SDK, no
// domain whitelist, no key in the client bundle. Tries keyword search first
// (상호명·건물명·아파트명) and falls back to address search so a pasted 도로명
// 주소 still resolves.
//
// Returns [lng, lat] — the repo's GeoJSON coordinate convention (lib/types.ts).

import { NextResponse } from "next/server";

const KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json";

// Busan-first ordering. We deliberately do NOT pass x/y/radius to the Local API:
// with a radius it *filters* to that circle, and the cap is 20 km — centred on
// the city that would cut off 기장군. Instead we search nationwide and sort
// 부산 addresses to the top, so "시청" lands on 부산시청 without ever excluding
// an outlying dong.
function isBusan(address: string): boolean {
  return address.startsWith("부산");
}

export interface PlaceHit {
  name: string;
  address: string;
  /** [lng, lat] */
  coord: [number, number];
}

interface KakaoKeywordDoc {
  place_name: string;
  road_address_name?: string;
  address_name?: string;
  x: string;
  y: string;
}

interface KakaoAddressDoc {
  address_name: string;
  road_address?: { address_name: string; building_name?: string } | null;
  x: string;
  y: string;
}

function toHit(name: string, address: string, x: string, y: string): PlaceHit | null {
  const lng = Number(x);
  const lat = Number(y);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { name, address, coord: [lng, lat] };
}

async function kakaoGet<T>(
  url: string,
  params: Record<string, string>,
  key: string,
): Promise<T | null> {
  try {
    const res = await fetch(`${url}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `KakaoAK ${key}` },
      // No `next: { revalidate }` here: an Authorization-bearing fetch cannot go
      // into Next's shared Data Cache, and asking for it 500s the route in a
      // production build. Repeat lookups are cached at the HTTP layer instead —
      // see the Cache-Control header on our own response below.
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[places] kakao ${res.status} ${url}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.error("[places] kakao fetch failed", e);
    return null;
  }
}

/** Identical queries are re-asked constantly while typing; let the browser and
 *  the CDN answer those instead of Kakao. */
const CACHE_HEADERS = { "Cache-Control": "public, max-age=3600, s-maxage=3600" };

export async function GET(req: Request) {
  try {
    return await handle(req);
  } catch (e) {
    // Without this an unexpected throw becomes an opaque "Internal Server
    // Error" with nothing in the production log.
    console.error("[places] unhandled", e);
    return NextResponse.json(
      { error: "검색 처리 중 오류", code: "unhandled" },
      { status: 500 },
    );
  }
}

async function handle(req: Request) {
  const key = process.env.KAKAO_REST_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "KAKAO_REST_KEY 미설정", code: "no_key" },
      { status: 503 },
    );
  }

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ places: [] });

  const keyword = await kakaoGet<{ documents: KakaoKeywordDoc[] }>(
    KEYWORD_URL,
    { query: q, size: "15" },
    key,
  );

  if (keyword === null) {
    return NextResponse.json(
      { error: "카카오 검색 호출 실패", code: "upstream" },
      { status: 502 },
    );
  }

  let places = (keyword.documents ?? [])
    .map((d) =>
      toHit(d.place_name, d.road_address_name || d.address_name || "", d.x, d.y),
    )
    .filter((p): p is PlaceHit => p !== null);

  // No POI matched — treat the query as a literal address.
  if (places.length === 0) {
    const addr = await kakaoGet<{ documents: KakaoAddressDoc[] }>(
      ADDRESS_URL,
      { query: q, size: "10" },
      key,
    );
    places = (addr?.documents ?? [])
      .map((d) =>
        toHit(
          d.road_address?.building_name || d.address_name,
          d.road_address?.address_name || d.address_name,
          d.x,
          d.y,
        ),
      )
      .filter((p): p is PlaceHit => p !== null);
  }

  // Stable partition: 부산 hits keep their relevance order, then the rest.
  places = [
    ...places.filter((p) => isBusan(p.address)),
    ...places.filter((p) => !isBusan(p.address)),
  ];

  return NextResponse.json({ places }, { headers: CACHE_HEADERS });
}
