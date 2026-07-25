"use client";

// 배차 예약 — 예상 대기시간 우선 + 목적지 접근성 시설 근접성.
//
// A booking EXPERIENCE, not a booking transaction: nothing is persisted and
// there is no backend beyond the two stateless Kakao proxies (app/api/places,
// app/api/directions). AGENTS.md's "no backend" rule holds for state; those
// routes exist only because the Kakao REST key must never reach the browser.
//
// Layout is one responsive tree, not two: mobile stacks form → wait → map →
// facilities, and at lg: the results become a scrolling column beside a sticky
// map. Same components, same data, both resolutions.

import { useEffect, useMemo, useState } from "react";
import { IconLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { MapCanvas } from "@/components/MapCanvas";
import { PlaceInput } from "./PlaceInput";
import { AccessTagList, ChainLine, FixLine, VerdictBadge } from "./AccessTagList";
import { useData } from "@/lib/useData";
import { kakaoMapUrl, type KakaoPlace } from "@/lib/kakao";
import { fetchRoute, type RouteResult } from "@/lib/directions";
import { lookupWait, type WaitEstimate } from "@/lib/dongEta";
import {
  FACILITY_LABEL,
  FACILITY_ORDER,
  HAEUNDAE_ONLY_KINDS,
  formatDistance,
  formatDuration,
  groupNearbyShops,
  nearestByKind,
  type FacilityKind,
  type GroupedShops,
  type NearbyShop,
  type NearestFacility,
} from "@/lib/proximity";
import { FIT_HEX, FIT_LABEL, type Chair, type Fit } from "@/lib/wheelchair";
import {
  DATA,
  type AccessActions,
  type DispatchEtaData,
  type DongProps,
  type HaeundaeFacilities,
  type InfraPoint,
} from "@/lib/types";
import type { DongCollection } from "@/lib/mapspec";
import { tooltipHtml } from "@/lib/mapspec";

const ORIGIN_HEX = "#38bdf8"; // --demand
const DEST_HEX = "#22d3ee"; // --accent

const CHAIR_LABEL: Record<Chair, string> = {
  none: "해당 없음",
  manual: "수동 휠체어",
  electric: "전동 휠체어",
};

/** 휠체어 탑승은 리프트 고정 시간이 붙는다 — DispatchScene과 동일한 계수. */
const CHAIR_WAIT: Record<Chair, number> = {
  none: 1,
  manual: 1.08,
  electric: 1.18,
};

const FACILITY_HEX: Record<FacilityKind, string> = {
  toilet: "#60a5fa",
  charger: "#34d399",
  parking: "#c084fc",
  elevator: "#2dd4bf",
  welfare: "#a78bfa",
  tourism: "#fbbf24",
  hospital: "#f472b6",
};

/** 지도 마커 = 이모지. 색 점 6개는 범례 없이는 구분이 안 되지만, 그림은 바로 읽힌다. */
const FACILITY_EMOJI: Record<FacilityKind, string> = {
  toilet: "🚻",
  charger: "🔌",
  parking: "🅿️",
  elevator: "🛗",
  welfare: "🤝",
  tourism: "📷",
  hospital: "🏥",
};

const EMOJI_FONT =
  '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

/** 무장애 식당도 같은 이모지 마커로 찍는다. */
const SHOP_EMOJI = "🍽️";

const MARKER_PX = 96; // 굽는 해상도. 표시 크기(26px)보다 크게 잡아 확대 시 뭉개짐 방지.

/** 화면 표시 크기. 읽히려면 이 정도는 되어야 하고, 그래서 겹침을 따로 푼다. */
const MARKER_SIZE = 26;

const markerCache = new Map<string, string>();

/** 마커 하나를 캔버스에 그려 data URL로 굽는다 — IconLayer의 아이콘 원본.
 *
 *  TextLayer로는 컬러 이모지를 그릴 수 없다. 폰트 아틀라스의 알파 채널만 샘플링해
 *  getColor로 칠하는 구조라 색이 전부 날아가고, 내부 디테일도 알파에 남지 않아
 *  🏥는 그냥 사각 덩어리가 된다. IconLayer는 텍스처 RGB를 그대로 쓰므로(mask:false)
 *  색이 살아난다 — 대신 아이콘을 우리가 직접 래스터화해서 넘겨야 한다.
 *
 *  캔버스 fillText는 폰트 폴백을 그대로 타므로 코드포인트 개수를 신경 쓸 필요가
 *  없다 — 🅿️(U+1F17F+U+FE0F)처럼 변형 선택자가 붙어도 정상 렌더된다.
 *
 *  받침도 테두리도 없이 이모지만 그린다. 다만 밝은 basemap 위에서 이모지가 묻히므로
 *  그림자만 남겼다 — 상자가 아니라 글리프 외곽을 따라가므로 눈에 띄지 않는다. */
function emojiMarkerUrl(emoji: string): string {
  const hit = markerCache.get(emoji);
  if (hit) return hit;

  const canvas = document.createElement("canvas");
  canvas.width = MARKER_PX;
  canvas.height = MARKER_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 9;
  ctx.font = `${Math.round(MARKER_PX * 0.72)}px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, MARKER_PX / 2, MARKER_PX / 2);

  const url = canvas.toDataURL();
  markerCache.set(emoji, url);
  return url;
}

/** 호버 시 살짝 커지는 배율. 겹친 마커 중 어느 것을 집었는지 알려주는 신호이지,
 *  장식이 아니다 — 그래서 아주 약간만. */
const MARKER_HOVER_SCALE = 1.18;

export default function BookingApp() {
  const [origin, setOrigin] = useState<KakaoPlace | null>(null);
  const [dest, setDest] = useState<KakaoPlace | null>(null);
  const [hour, setHour] = useState(() => new Date().getHours());
  const [chair, setChair] = useState<Chair>("manual");
  /** 선택된 업종. 빈 배열 = 전체 */
  const [catFilter, setCatFilter] = useState<string[]>([]);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routing, setRouting] = useState(false);
  /** 마우스가 올라간 마커의 키. null = 아무것도 안 올라감. */
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);
  const eta = useData<DispatchEtaData>(DATA.dispatchEta);
  const infra = useData<InfraPoint[]>(DATA.infraPoints);
  const shopData = useData<AccessActions>(DATA.accessActions);
  const hFacilities = useData<HaeundaeFacilities>(DATA.haeundaeFacilities);

  // Fetch the road route whenever both ends are pinned.
  useEffect(() => {
    if (!origin || !dest) {
      setRoute(null);
      return;
    }
    let live = true;
    setRouting(true);
    fetchRoute(origin.coord, dest.coord)
      .then((r) => {
        if (live) setRoute(r);
      })
      .finally(() => {
        if (live) setRouting(false);
      });
    return () => {
      live = false;
    };
  }, [origin, dest]);

  // 목적지가 바뀌면 업종 필터를 푼다 — 이전 동네에만 있던 업종이 선택된 채로
  // 남으면 새 목적지에서 "0곳"만 보이고 원인이 화면에 드러나지 않는다.
  useEffect(() => {
    setCatFilter([]);
  }, [dest]);

  const wait: WaitEstimate | null = useMemo(() => {
    if (!origin || !dongs.data || !eta.data) return null;
    return lookupWait(origin.coord, hour, dongs.data, eta.data);
  }, [origin, hour, dongs.data, eta.data]);

  const adjustedWait = wait ? wait.minutes * CHAIR_WAIT[chair] : null;

  const facilities: NearestFacility[] = useMemo(() => {
    if (!dest || !infra.data) return [];
    return nearestByKind(dest.coord, infra.data, hFacilities.data?.points ?? []);
  }, [dest, infra.data, hFacilities.data]);

  // 휠체어 종류가 바뀌면 추천 목록 자체가 달라진다 (chair가 의존성에 들어간다).
  const shopGroups: GroupedShops = useMemo(() => {
    if (!dest || !shopData.data)
      return { fit: [], check: [], excluded: 0, cats: [] };
    return groupNearbyShops(dest.coord, shopData.data.shops, chair, catFilter);
  }, [dest, shopData.data, chair, catFilter]);

  // 지도에는 두 칸에 실제로 보이는 곳만 찍는다.
  const shops: NearbyShop[] = useMemo(
    () => [...shopGroups.fit, ...shopGroups.check],
    [shopGroups],
  );

  // ── map ────────────────────────────────────────────────────────────────

  /** 출발·도착이 찍혔을 때 카메라가 잡을 화면. spec과 반드시 분리해야 한다 —
   *  MapCanvas는 flyTo 객체의 IDENTITY가 바뀌면 다시 날아가므로, zoom을 의존성으로
   *  가진 spec 안에서 만들면 사용자가 확대하는 순간 새 flyTo가 생겨 카메라를 원래
   *  자리로 되돌려버린다 (= 확대할수록 밀려남). origin/dest에만 반응해야 한다. */
  const flyTo = useMemo(() => {
    if (origin && dest) {
      const mid: [number, number] = [
        (origin.coord[0] + dest.coord[0]) / 2,
        (origin.coord[1] + dest.coord[1]) / 2,
      ];
      const spanKm = Math.max(
        Math.abs(origin.coord[0] - dest.coord[0]) * 90,
        Math.abs(origin.coord[1] - dest.coord[1]) * 111,
      );
      const z = spanKm > 20 ? 10.2 : spanKm > 10 ? 11.2 : spanKm > 4 ? 12.2 : 13.2;
      return { longitude: mid[0], latitude: mid[1], zoom: z };
    }
    const only = dest ?? origin;
    return only ? { longitude: only.coord[0], latitude: only.coord[1], zoom: 13.5 } : null;
  }, [origin, dest]);

  const spec = useMemo(() => {
    const layers = [];

    if (route) {
      layers.push(
        new PathLayer<{ path: [number, number][] }>({
          id: "booking-route",
          data: [{ path: route.path }],
          getPath: (d) => d.path,
          getColor: route.source === "road" ? [34, 211, 238, 230] : [139, 150, 171, 200],
          getWidth: 6,
          widthMinPixels: 3,
          widthMaxPixels: 10,
          capRounded: true,
          jointRounded: true,
          pickable: false,
        }),
      );
    }

    // 마커는 실제 좌표에 그대로 찍는다 — 겹치는 건 감안한다. 어느 것을 집었는지는
    // 호버 시 커지는 효과와 툴팁이 알려준다.
    if (facilities.length > 0) {
      // mask:false → 텍스처 RGB를 그대로 쓴다 = 컬러 이모지. true면 알파만 쓰고
      // getColor로 칠해버려서 단색 실루엣이 된다.
      layers.push(
        new IconLayer<NearestFacility>({
          id: "booking-facilities",
          data: facilities,
          getPosition: (d) => d.coord,
          getIcon: (d) => ({
            id: d.kind,
            url: emojiMarkerUrl(FACILITY_EMOJI[d.kind]),
            width: MARKER_PX,
            height: MARKER_PX,
            mask: false,
          }),
          getSize: (d) =>
            hoverKey === `f-${d.kind}` ? MARKER_SIZE * MARKER_HOVER_SCALE : MARKER_SIZE,
          updateTriggers: { getSize: [hoverKey] },
          transitions: { getSize: 120 },
          sizeUnits: "pixels",
          pickable: true,
          // 자기 레이어가 잡고 있던 호버만 해제한다 — 겹친 마커 사이를 지날 때
          // 시설 레이어의 "빠져나감"이 식당 레이어의 "들어옴"을 덮어쓰면 안 된다.
          onHover: ({ object }) =>
            setHoverKey((prev) =>
              object ? `f-${object.kind}` : prev?.startsWith("f-") ? null : prev,
            ),
        }),
      );
    }

    if (shops.length > 0) {
      layers.push(
        new IconLayer<NearbyShop>({
          id: "booking-shops",
          data: shops,
          getPosition: (d) => [d.shop.lng, d.shop.lat],
          getIcon: () => ({
            id: "shop",
            url: emojiMarkerUrl(SHOP_EMOJI),
            width: MARKER_PX,
            height: MARKER_PX,
            mask: false,
          }),
          getSize: (d) =>
            hoverKey === shopKey(d) ? MARKER_SIZE * MARKER_HOVER_SCALE : MARKER_SIZE,
          updateTriggers: { getSize: [hoverKey] },
          transitions: { getSize: 120 },
          sizeUnits: "pixels",
          pickable: true,
          onHover: ({ object }) =>
            setHoverKey((prev) =>
              object ? shopKey(object) : prev?.startsWith("s-") ? null : prev,
            ),
        }),
      );
    }

    const ends: { coord: [number, number]; hex: string; label: string }[] = [];
    if (origin) ends.push({ coord: origin.coord, hex: ORIGIN_HEX, label: `출발 · ${origin.name}` });
    if (dest) ends.push({ coord: dest.coord, hex: DEST_HEX, label: `도착 · ${dest.name}` });
    if (ends.length > 0) {
      layers.push(
        new ScatterplotLayer<(typeof ends)[number]>({
          id: "booking-ends",
          data: ends,
          getPosition: (d) => d.coord,
          getFillColor: (d) => hexToRgb(d.hex),
          getRadius: 10,
          radiusUnits: "pixels",
          stroked: true,
          getLineColor: [226, 232, 240, 255],
          lineWidthMinPixels: 2,
          pickable: true,
        }),
      );
    }

    return {
      layers,
      flyTo,
      getTooltip: ({ object }: { object?: unknown }) => {
        const o = object;
        if (!o) return null;
        if (isFacility(o)) {
          return tooltipHtml(
            `<b>${escapeHtml(o.name)}</b><br/>${o.label} · ${formatDistance(o.distanceM)}`,
          );
        }
        if (isShop(o)) {
          return tooltipHtml(
            `<b>${escapeHtml(o.shop.name)}</b><br/>${escapeHtml(o.shop.cat)} · ${formatDistance(o.distanceM)}<br/>막히는 지점: ${escapeHtml(o.status.barrier)}`,
          );
        }
        if (isEnd(o)) return tooltipHtml(`<b>${escapeHtml(o.label)}</b>`);
        return null;
      },
    };
  }, [route, facilities, shops, origin, dest, flyTo, hoverKey]);

  const dataPending = dongs.data === null || eta.data === null;

  return (
    <div className="min-h-screen bg-bg text-ink">
      {/* ── header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold">배차 예약</h1>
            <p className="truncate text-[11px] text-dim">
              예상 대기시간 · 목적지 무장애 시설
            </p>
          </div>
          <a
            href="/"
            className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-dim transition-colors hover:border-accent hover:text-ink"
          >
            대시보드
          </a>
        </div>
      </header>

      {/* ONE map instance only.
          deck.gl Layer objects cannot be handed to two overlays — rendering the
          map twice (a mobile copy + a desktop copy hidden with CSS) still mounts
          both and trips `assert(!this.internalState)` ("finalized layer cannot be
          reused"). So this is a single grid whose MAP CHILD MOVES: on phones it
          sits third in flow (right under the wait card), and from lg: it jumps to
          a sticky second column spanning all four rows. */}
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-4 px-4 pb-16 pt-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-5">
        <div className="space-y-4 lg:col-start-1 lg:row-start-1">
          <section className="space-y-3 rounded-xl border border-line bg-panel/60 p-3.5">
            <PlaceInput
              label="출발지"
              placeholder="아파트·건물·주소로 검색"
              value={origin}
              onPick={setOrigin}
              onClear={() => setOrigin(null)}
              accentHex={ORIGIN_HEX}
            />
            <PlaceInput
              label="도착지"
              placeholder="목적지를 검색"
              value={dest}
              onPick={setDest}
              onClear={() => setDest(null)}
              accentHex={DEST_HEX}
            />

            <div>
              <label className="mb-1.5 block text-[11px] text-dim">
                탑승 시각 <span className="tnum text-ink">{hour}시</span>
              </label>
              <input
                type="range"
                min={0}
                max={23}
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <span className="mb-1.5 block text-[11px] text-dim">휠체어</span>
              <div className="flex gap-1.5">
                {(Object.keys(CHAIR_LABEL) as Chair[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setChair(c)}
                    className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] transition-colors ${
                      chair === c
                        ? "border-accent bg-accent/10 text-ink"
                        : "border-line text-dim hover:border-dim"
                    }`}
                  >
                    {CHAIR_LABEL[c]}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* 예상 대기시간 — 요구사항상 가장 먼저 노출 */}
          <WaitCard
            wait={wait}
            adjusted={adjustedWait}
            chair={chair}
            hasOrigin={origin !== null}
            pending={dataPending}
            caveat={eta.data?.meta.caveats}
          />

        </div>

        {/* phones: third in flow · lg+: sticky right column */}
        <div className="lg:sticky lg:top-[84px] lg:col-start-2 lg:row-start-1 lg:row-span-3">
          <MapPanel
            spec={spec}
            route={route}
            routing={routing}
            cursor={hoverKey ? "pointer" : undefined}
          />
        </div>

        <div className="lg:col-start-1 lg:row-start-2">
          <FacilitySection
            dest={dest}
            facilities={facilities}
            pending={infra.data === null}
          />
        </div>

        {/* 식당은 두 칸(이용 가능 / 확인 필요)을 나란히 두므로 좌우 폭을 다 쓴다 —
            420px 사이드 칼럼 안에서 2단을 하면 한 칸이 200px 남짓으로 쪼그라든다. */}
        <div className="lg:col-span-2 lg:col-start-1 lg:row-start-3">
          <ShopSection
            dest={dest}
            groups={shopGroups}
            scope={shopData.data?.meta.scope}
            chair={chair}
            catFilter={catFilter}
            onToggleCat={(cat) =>
              setCatFilter((prev) =>
                prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
              )
            }
            onClearCats={() => setCatFilter([])}
          />
        </div>
      </div>
    </div>
  );
}

// ── panels ─────────────────────────────────────────────────────────────────

function MapPanel({
  spec,
  route,
  routing,
  cursor,
}: {
  spec: Parameters<typeof MapCanvas>[0]["spec"];
  route: RouteResult | null;
  routing: boolean;
  cursor?: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line">
      {/* 46vh on a phone keeps the form reachable; a tall viewport gets the
          full sticky column height. */}
      <div className="relative h-[46vh] min-h-[260px] lg:h-[calc(100vh-190px)] lg:min-h-[420px]">
        <MapCanvas spec={spec} cursor={cursor} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-panel/60 px-3 py-2 text-[11px] text-dim">
        {routing ? (
          <span>경로 계산 중…</span>
        ) : route ? (
          <>
            <span className="tnum text-ink">{formatDistance(route.distanceM)}</span>
            {route.durationS !== null && (
              <span className="tnum">차량 {formatDuration(route.durationS)}</span>
            )}
            <span>
              {route.source === "road" ? "실제 도로 경로 (카카오모빌리티)" : route.note}
            </span>
          </>
        ) : (
          <span>출발지·도착지를 선택하면 경로가 표시됩니다</span>
        )}
      </div>
    </section>
  );
}

function WaitCard({
  wait,
  adjusted,
  chair,
  hasOrigin,
  pending,
  caveat,
}: {
  wait: WaitEstimate | null;
  adjusted: number | null;
  chair: Chair;
  hasOrigin: boolean;
  pending: boolean;
  caveat?: string;
}) {
  return (
    <section className="rounded-xl border border-line bg-panel/60 p-3.5">
      <h2 className="mb-2 text-[11px] text-dim">예상 대기시간</h2>

      {!hasOrigin ? (
        <p className="text-[13px] text-dim">출발지를 선택하면 예상 대기시간을 계산합니다.</p>
      ) : pending ? (
        <p className="text-[13px] text-dim">데이터 준비 중…</p>
      ) : !wait || adjusted === null ? (
        <p className="text-[13px] text-dim">
          이 지역의 배차 기록이 없어 대기시간을 추정할 수 없습니다.
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="tnum text-[34px] font-semibold leading-none text-accent">
              {Math.round(adjusted)}
            </span>
            <span className="text-[13px] text-dim">분</span>
            {wait.ci && (
              <span className="tnum ml-1 text-[11px] text-dim">
                95% CI {Math.round(wait.ci[0] * (adjusted / wait.minutes))}–
                {Math.round(wait.ci[1] * (adjusted / wait.minutes))}분
              </span>
            )}
          </div>

          <p className="mt-2 text-[11px] text-dim">
            {wait.gu} {wait.dongName} · {wait.hour}시 접수 기준
            {chair !== "none" && ` · ${CHAIR_LABEL[chair]} 보정`}
          </p>

          <dl className="mt-2.5 grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg border border-line px-2 py-1.5">
              <dt className="text-dim">미배차·취소 비율</dt>
              <dd className="tnum mt-0.5 text-ink">
                {(wait.unassignedShare * 100).toFixed(1)}%
              </dd>
            </div>
            <div className="rounded-lg border border-line px-2 py-1.5">
              <dt className="text-dim">표본</dt>
              <dd className="tnum mt-0.5 text-ink">{wait.n.toLocaleString()}건</dd>
            </div>
          </dl>

          <ul className="mt-2.5 space-y-0.5 text-[10px] leading-relaxed text-dim">
            {wait.hourFallback && (
              <li>· 해당 시간대 표본이 없어 이 동의 중위 시간대 값을 사용했습니다.</li>
            )}
            {!wait.exactDong && (
              <li>· 출발지가 행정동 경계 밖이라 가장 가까운 동 기준으로 계산했습니다.</li>
            )}
            {caveat && <li>· {caveat}</li>}
          </ul>
        </>
      )}
    </section>
  );
}

function FacilitySection({
  dest,
  facilities,
  pending,
}: {
  dest: KakaoPlace | null;
  facilities: NearestFacility[];
  pending: boolean;
}) {
  const found = new Set(facilities.map((f) => f.kind));
  const missing = FACILITY_ORDER.filter((k) => !found.has(k));

  return (
    <section className="rounded-xl border border-line bg-panel/60 p-3.5">
      <h2 className="mb-2 text-[11px] text-dim">
        도착지 주변 시설 <span className="opacity-70">· 카테고리별 최근접</span>
      </h2>

      {!dest ? (
        <p className="text-[13px] text-dim">도착지를 선택하면 주변 시설을 표시합니다.</p>
      ) : pending ? (
        <p className="text-[13px] text-dim">데이터 준비 중…</p>
      ) : facilities.length === 0 ? (
        <p className="text-[13px] text-dim">반경 5km 안에 등록된 시설이 없습니다.</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {facilities.map((f) => (
              <li
                key={f.kind}
                className="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-2"
              >
                {/* 지도 마커와 같은 글리프 — 목록의 색 점은 지도 위 점과 짝을
                    맞추려고 있었으므로, 지도가 이모지가 되면 여기도 따라간다. */}
                <span
                  className="w-[18px] shrink-0 text-center text-[14px] leading-none"
                  aria-hidden
                >
                  {FACILITY_EMOJI[f.kind]}
                </span>
                <div className="min-w-0 flex-1">
                  <MapNameLink
                    coord={f.coord}
                    name={f.name}
                    className="text-[12.5px]"
                  />
                  <p className="truncate text-[10.5px] text-dim">
                    {f.label}
                    {f.detail ? ` · ${f.detail}` : ""}
                  </p>
                </div>
                <span className="tnum shrink-0 text-[11.5px] text-dim">
                  {formatDistance(f.distanceM)}
                </span>
              </li>
            ))}
          </ul>

          {/* Two honesty captions. An empty slot outside 해운대구 is a data gap, not
              an accessibility finding — and so is a suspiciously FAR one: the
              nearest 화장실 to 부산시청 is not really 4 km away, it is simply absent
              from the 해운대구 실사. Both must be said out loud. */}
          {missing.length > 0 && (
            <p className="mt-2 text-[10px] leading-relaxed text-dim">
              · {missing.map((k) => FACILITY_LABEL[k]).join(" · ")}: 반경 5km 내 없음
            </p>
          )}
          {facilities.some((f) => HAEUNDAE_ONLY_KINDS.includes(f.kind)) && (
            <p className="mt-1 text-[10px] leading-relaxed text-dim">
              ·{" "}
              {HAEUNDAE_ONLY_KINDS.map((k) => FACILITY_LABEL[k]).join(" · ")}은 해운대구
              실사 데이터 기준입니다 — 구 외 지역은 미집계라 실제보다 멀게 표시될 수
              있습니다.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ShopSection({
  dest,
  groups,
  scope,
  chair,
  catFilter,
  onToggleCat,
  onClearCats,
}: {
  dest: KakaoPlace | null;
  groups: GroupedShops;
  scope?: string;
  chair: Chair;
  catFilter: string[];
  onToggleCat: (cat: string) => void;
  onClearCats: () => void;
}) {
  const filtering = chair !== "none";
  const { fit, check, excluded, cats } = groups;
  const empty = fit.length === 0 && check.length === 0;
  // 반경 안에 표시 가능한 곳이 아예 없는 것과, 업종 필터 때문에 0곳이 된 것은
  // 완전히 다른 상황이다 — 후자는 필터를 풀면 되므로 그렇게 안내한다.
  const emptyByFilter = empty && catFilter.length > 0 && cats.length > 0;

  return (
    <section className="rounded-xl border border-line bg-panel/60 p-3.5">
      <h2 className="mb-2.5 text-[11px] text-dim">
        도착지 주변 무장애 식당{" "}
        <span className="opacity-70">
          {filtering ? `· ${CHAIR_LABEL[chair]} 기준` : "· 가까운 순"}
        </span>
      </h2>

      {/* 업종 선택 — 목록보다 위에 둔다. 카드가 최대 10장이라 아래에 두면 필터를
          보려고 결과 전체를 지나쳐야 하고, 화면에 없는 것처럼 보인다.
          칩 목록은 업종 필터와 무관하게 반경 기준 전체이므로, 필터를 걸어도 해제할
          칩이 사라지지 않는다. */}
      {dest && cats.length > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] text-dim">
              업종
              {catFilter.length > 0 && (
                <span className="ml-1 text-accent">{catFilter.length}개 선택</span>
              )}
            </span>
            {catFilter.length > 0 && (
              <button
                type="button"
                onClick={onClearCats}
                className="text-[10.5px] text-accent transition-opacity hover:opacity-80"
              >
                전체 보기
              </button>
            )}
          </div>
          <ul className="flex flex-wrap gap-1">
            {cats.map(({ cat, count }) => {
              const on = catFilter.includes(cat);
              return (
                <li key={cat}>
                  <button
                    type="button"
                    onClick={() => onToggleCat(cat)}
                    aria-pressed={on}
                    className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                      on
                        ? "border-accent bg-accent/15 text-ink"
                        : "border-line text-dim hover:border-dim hover:text-ink"
                    }`}
                  >
                    {cat} <span className="tnum opacity-60">{count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!dest ? (
        <p className="text-[13px] text-dim">도착지를 선택하면 식당을 표시합니다.</p>
      ) : emptyByFilter ? (
        <p className="text-[13px] text-dim">
          선택한 업종에 해당하는 곳이 없습니다. 아래에서 업종을 바꾸거나 전체로
          돌리세요.
        </p>
      ) : empty ? (
        <p className="text-[13px] text-dim">
          {excluded > 0
            ? `반경 1.5km 안 ${excluded}곳이 모두 ${CHAIR_LABEL[chair]}로 진입 불가입니다.`
            : `이 주변은 무장애가게 실사 데이터가 아직 없습니다${scope ? ` (현재 표본: ${scope})` : ""}.`}
        </p>
      ) : filtering ? (
        <>
          {/* 두 칸은 phone에서 위아래로 쌓고 sm: 이상에서 좌우로 나뉜다.
              좁은 화면에서 2단을 강행하면 상호명이 두 글자마다 줄바꿈된다. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ShopColumn
              title="이용 가능"
              fitState="fit"
              shops={fit}
              emptyText="실사로 확인된 곳이 이 반경에 없습니다."
            />
            <ShopColumn
              title="확인 필요"
              fitState="check"
              shops={check}
              emptyText="확인이 필요한 곳은 없습니다."
            />
          </div>

          {excluded > 0 && (
            <p className="mt-2.5 text-[10px] leading-relaxed text-dim">
              · {CHAIR_LABEL[chair]}로 진입 불가한 {excluded}곳은 양쪽 모두에서
              제외했습니다 (입구턱 있음 · 화장실턱 있음 · 2층 이상인데 엘리베이터 없음).
            </p>
          )}
        </>
      ) : (
        // 휠체어 '해당 없음'이면 적합 판정이 의미가 없으므로 기존 verdict 한 줄 목록.
        <ul className="space-y-2">
          {fit.map((s) => (
            <ShopCard key={`${s.shop.name}-${s.shop.lng}`} entry={s} showFit={false} />
          ))}
        </ul>
      )}

    </section>
  );
}

function ShopColumn({
  title,
  fitState,
  shops,
  emptyText,
}: {
  title: string;
  fitState: Fit;
  shops: NearbyShop[];
  emptyText: string;
}) {
  const hex = FIT_HEX[fitState];
  return (
    <div>
      <h3
        className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium"
        style={{ color: hex }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: hex }} aria-hidden />
        {title}
        <span className="tnum opacity-70">{shops.length}곳</span>
      </h3>
      {shops.length === 0 ? (
        <p className="text-[11px] text-dim">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {shops.map((s) => (
            <ShopCard key={`${s.shop.name}-${s.shop.lng}`} entry={s} showFit />
          ))}
        </ul>
      )}
    </div>
  );
}

function ShopCard({ entry, showFit }: { entry: NearbyShop; showFit: boolean }) {
  const { shop, status, distanceM, fit } = entry;
  return (
    <li
      className="space-y-1.5 rounded-lg border px-2.5 py-2"
      style={{
        // 배지 색만으로는 스크롤 중에 놓치므로 테두리로도 등급을 구분한다.
        borderColor: showFit ? `${FIT_HEX[fit.fit]}55` : undefined,
      }}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <MapNameLink
            coord={[shop.lng, shop.lat]}
            name={shop.name}
            className="text-[13px] font-medium"
          />
          <p className="truncate text-[10.5px] text-dim">
            {shop.cat} · {formatDistance(distanceM)}
            {shop.dong ? ` · ${shop.dong}` : ""}
          </p>
        </div>
        {!showFit && <VerdictBadge status={status} />}
      </div>

      {/* 확인 필요 사유 (판정에 반영된 것) */}
      {showFit &&
        fit.steps
          .filter((s) => s.state !== "fit")
          .map((s) => (
            <p key={s.label} className="text-[10.5px]" style={{ color: FIT_HEX[s.state] }}>
              {s.label}: {s.note}
            </p>
          ))}

      {/* 판정에 반영되지 않은 미조사 사실 — '이용 가능' 카드에도 붙는다 */}
      {showFit &&
        fit.notes.map((n) => (
          <p key={n} className="text-[10.5px] text-dim">
            {n}
          </p>
        ))}

      <AccessTagList fields={shop.fields} />
      {!showFit && <ChainLine status={status} />}
      {!showFit && <FixLine status={status} />}
    </li>
  );
}

function FitBadge({ fit }: { fit: Fit }) {
  const hex = FIT_HEX[fit];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: `${hex}22`, color: hex, border: `1px solid ${hex}55` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: hex }} aria-hidden />
      {FIT_LABEL[fit]}
    </span>
  );
}

/** 시설·가게 이름 자체가 카카오맵 링크다 — 별도 "지도" 버튼을 두면 같은 곳으로 가는
 *  링크가 한 행에 두 개 생기고, 스크린리더는 그걸 두 번 읽는다. 이름은 truncate하되
 *  ↗ 표시는 항상 보이도록 span을 분리했다. */
function MapNameLink({
  coord,
  name,
  className,
}: {
  coord: [number, number];
  name: string;
  className?: string;
}) {
  return (
    <a
      href={kakaoMapUrl(coord, name)}
      target="_blank"
      rel="noopener noreferrer"
      title={`카카오맵에서 ${name} 보기`}
      className={`flex min-w-0 items-baseline gap-1 transition-colors hover:text-accent hover:underline focus-visible:text-accent ${className ?? ""}`}
    >
      <span className="truncate">{name}</span>
      <span aria-hidden className="shrink-0 text-[9px] opacity-55">
        ↗
      </span>
    </a>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    235,
  ];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

/** 식당 마커의 호버 키. 같은 상호가 여러 지점일 수 있어 좌표까지 넣는다. */
function shopKey(s: NearbyShop): string {
  return `s-${s.shop.name}-${s.shop.lng}`;
}

function isFacility(o: unknown): o is NearestFacility {
  return typeof o === "object" && o !== null && "kind" in o && "distanceM" in o;
}

function isShop(o: unknown): o is NearbyShop {
  return typeof o === "object" && o !== null && "shop" in o && "status" in o;
}

function isEnd(o: unknown): o is { label: string } {
  return typeof o === "object" && o !== null && "label" in o && !("kind" in o);
}
