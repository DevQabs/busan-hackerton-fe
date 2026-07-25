// 카카오모빌리티 자동차 길찾기 프록시.
//
// WHY A SERVER ROUTE AT ALL (AGENTS.md says the UI has no backend):
// the Kakao Maps JS SDK has no directions API, and the Mobility REST endpoint
// cannot be called from the browser — it needs an `Authorization: KakaoAK`
// header with the REST key (which must never reach the client) and does not
// serve CORS headers. This single route handler is the documented exception; it
// holds no state, touches no database, and the page degrades to a straight line
// when it is unavailable, so the offline/static demo still works.
//
// 두리발 is a vehicle dispatch service, so 자동차 경로 is the correct mode.
// Response geometry is WGS84 [lng, lat] — the repo's coordinate convention.

import { NextResponse } from "next/server";

const KAKAO_NAVI = "https://apis-navi.kakaomobility.com/v1/directions";

interface KakaoRoad {
  vertexes: number[]; // flat [lng, lat, lng, lat, ...]
}
interface KakaoSection {
  roads?: KakaoRoad[];
}
interface KakaoRoute {
  result_code: number;
  result_msg?: string;
  summary?: { distance?: number; duration?: number };
  sections?: KakaoSection[];
}

function parseCoord(raw: string | null): [number, number] | null {
  if (!raw) return null;
  const parts = raw.split(",").map((v) => Number(v.trim()));
  if (parts.length !== 2 || parts.some((v) => !Number.isFinite(v))) return null;
  const [lng, lat] = parts;
  // Busan-ish sanity window (same bounds pipeline/validate.py enforces).
  if (lng < 126 || lng > 131 || lat < 33 || lat > 39) return null;
  return [lng, lat];
}

/** A fixed OD pair always yields the same road geometry — let the browser/CDN
 *  serve repeats instead of Kakao. */
const CACHE_HEADERS = { "Cache-Control": "public, max-age=3600, s-maxage=3600" };

export async function GET(req: Request) {
  try {
    return await handle(req);
  } catch (e) {
    // Without this an unexpected throw becomes an opaque "Internal Server
    // Error" with nothing in the production log.
    console.error("[directions] unhandled", e);
    return NextResponse.json(
      { error: "경로 처리 중 오류", code: "unhandled" },
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

  const url = new URL(req.url);
  const origin = parseCoord(url.searchParams.get("origin"));
  const dest = parseCoord(url.searchParams.get("destination"));
  if (!origin || !dest) {
    return NextResponse.json(
      { error: "origin/destination 좌표가 올바르지 않습니다", code: "bad_input" },
      { status: 400 },
    );
  }

  const qs = new URLSearchParams({
    origin: `${origin[0]},${origin[1]}`,
    destination: `${dest[0]},${dest[1]}`,
    priority: "RECOMMEND",
    car_fuel: "GASOLINE",
    alternatives: "false",
    road_details: "false",
  });

  let payload: { routes?: KakaoRoute[] };
  try {
    const res = await fetch(`${KAKAO_NAVI}?${qs}`, {
      headers: { Authorization: `KakaoAK ${key}` },
      // No `next: { revalidate }`: an Authorization-bearing fetch cannot go into
      // Next's shared Data Cache, and requesting it 500s the route in a
      // production build. Repeats are cached at the HTTP layer instead.
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[directions] kakao ${res.status}`);
      return NextResponse.json(
        { error: `카카오 응답 ${res.status}`, code: "upstream" },
        { status: 502 },
      );
    }
    payload = await res.json();
  } catch (e) {
    console.error("[directions] kakao fetch failed", e);
    return NextResponse.json(
      { error: "카카오 길찾기 호출 실패", code: "fetch_failed" },
      { status: 502 },
    );
  }

  const route = payload.routes?.[0];
  if (!route || route.result_code !== 0) {
    return NextResponse.json(
      {
        error: route?.result_msg || "경로를 찾을 수 없습니다",
        code: "no_route",
      },
      { status: 404 },
    );
  }

  // Stitch every road segment's flat vertex array into [[lng, lat], ...].
  const path: [number, number][] = [];
  for (const section of route.sections ?? []) {
    for (const road of section.roads ?? []) {
      const v = road.vertexes;
      for (let i = 0; i + 1 < v.length; i += 2) {
        path.push([v[i], v[i + 1]]);
      }
    }
  }

  if (path.length < 2) {
    return NextResponse.json(
      { error: "경로 좌표가 비어 있습니다", code: "empty_path" },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      path,
      distanceM: route.summary?.distance ?? null,
      durationS: route.summary?.duration ?? null,
    },
    { headers: CACHE_HEADERS },
  );
}
