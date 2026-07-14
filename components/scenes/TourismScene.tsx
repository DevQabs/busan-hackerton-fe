"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScatterplotLayer } from "deck.gl";
import { DATA, type TourismSite, type TourismDeserts } from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt, pct } from "@/lib/format";
import { HEX } from "@/lib/palette";
import { tooltipHtml, type FlyTo, type MapSpec } from "@/lib/mapspec";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";
import { Explainer } from "@/components/ui/Explainer";
import { Kpi } from "@/components/ui/Kpi";
import { TourismBar } from "@/components/charts/TourismBar";

type DayFilter = "all" | "weekday" | "weekend";
type Tab = "list" | "rank" | "stats";

const BANDS = [
  { id: "morning", label: "오전", start: 6, end: 12 },
  { id: "afternoon", label: "오후", start: 12, end: 18 },
  { id: "evening", label: "저녁", start: 18, end: 22 },
  { id: "night", label: "심야", start: 22, end: 30 }, // 22시~익일 06시
] as const;
type BandId = (typeof BANDS)[number]["id"];

function overlapsInterval(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function siteMatchesBand(site: TourismSite, band: (typeof BANDS)[number]): boolean {
  if (site.alwaysOpen || site.hoursUnknown) return true;
  if (site.openHour == null || site.closeHour == null) return true;
  const open = site.openHour;
  const close = site.closeHour <= open ? site.closeHour + 24 : site.closeHour;
  return (
    overlapsInterval(open, close, band.start, band.end) ||
    overlapsInterval(open + 24, close + 24, band.start, band.end) ||
    overlapsInterval(open - 24, close - 24, band.start, band.end)
  );
}

function hoursLabel(s: TourismSite): string {
  if (s.alwaysOpen) return "상시 개방";
  if (s.openHour != null && s.closeHour != null) {
    const pad = (n: number) => String(n % 24).padStart(2, "0");
    return `${pad(s.openHour)}:00 ~ ${pad(s.closeHour)}:00`;
  }
  return s.hoursRaw || "운영시간 정보 없음";
}

const normalize = (s: string) => s.trim().toLowerCase();

function distLabel(m: number | null): string {
  if (m === null) return "정보 없음";
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${fmt(m)}m`;
}

function SearchOverlay({
  query,
  onChange,
}: {
  query: string;
  onChange: (v: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  // Local draft so the input's own re-render stays cheap and instantaneous.
  // `query` (in the parent) drives an expensive re-filter of 483 sites + a
  // deck.gl layer rebuild on every change — feeding that straight back into
  // this input's `value` mid-keystroke is what breaks Korean IME composition
  // into separate jamo (한글 조합이 깨져 자모로 분리 입력되는 문제) instead of
  // combined syllables. We only push to the parent once a composition
  // segment is confirmed (or immediately for non-IME input).
  const [draft, setDraft] = useState(query);
  const composingRef = useRef(false);

  // Stay in sync when the parent value changes from elsewhere (e.g. "필터 초기화").
  useEffect(() => {
    setDraft(query);
  }, [query]);

  const expanded = focused || draft.length > 0;

  return (
    <div
      className="flex h-[34px] items-center overflow-hidden rounded-lg border border-line bg-panel/90 backdrop-blur transition-[width]"
      style={{ width: expanded ? 220 : 34 }}
    >
      <button
        type="button"
        aria-label="관광지 이름 검색"
        onClick={() => setFocused(true)}
        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center text-[14px] text-ink/80"
      >
        🔍
      </button>
      {expanded && (
        <input
          autoFocus={focused}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (!composingRef.current) onChange(e.target.value);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false;
            onChange(e.currentTarget.value);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="관광지 이름 검색"
          className="w-full bg-transparent pr-3 text-[12px] text-ink outline-none placeholder:text-dim"
        />
      )}
    </div>
  );
}

export function TourismScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const tourism = useData<TourismDeserts>(DATA.tourism);

  const [tab, setTab] = useState<Tab>("list");
  const [query, setQuery] = useState("");
  const [barrierFreeOnly, setBarrierFreeOnly] = useState(false);
  const [dayFilter, setDayFilter] = useState<DayFilter>("all");
  const [bands, setBands] = useState<Set<BandId>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);

  const sites = tourism.data?.sites ?? [];

  const toggleBand = useCallback((id: BandId) => {
    setBands((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    const q = normalize(query);
    const activeBands = BANDS.filter((b) => bands.has(b.id));
    return sites.filter((s) => {
      if (q && !normalize(s.name).includes(q)) return false;
      if (barrierFreeOnly && !s.barrierFree) return false;
      if (dayFilter === "weekday" && !s.openWeekday) return false;
      if (dayFilter === "weekend" && !s.openWeekend) return false;
      if (activeBands.length > 0 && !activeBands.some((b) => siteMatchesBand(s, b))) return false;
      return true;
    });
  }, [sites, query, barrierFreeOnly, dayFilter, bands]);

  const selected = useMemo(
    () => sites.find((s) => s.id === selectedId) ?? null,
    [sites, selectedId],
  );

  // 관광지 사각지대 순위: non-barrier-free sites lacking coverage within the
  // charger/hospital/welfare thresholds, worst (highest blindSpotScore) first.
  const rankedBlindSpots = useMemo(() => {
    return sites
      .filter((s) => !s.barrierFree && s.lack.length > 0)
      .sort((a, b) => b.blindSpotScore - a.blindSpotScore)
      .slice(0, 100)
      .map((s, i) => ({ ...s, rank: i + 1 }));
  }, [sites]);

  const blindSpotIds = useMemo(
    () => new Set(rankedBlindSpots.map((s) => s.id)),
    [rankedBlindSpots],
  );

  const select = useCallback((s: TourismSite | null) => {
    setSelectedId(s?.id ?? null);
    if (s) setFlyTo({ longitude: s.lng, latitude: s.lat, zoom: 14.5 });
  }, []);

  const layers = useMemo(() => {
    if (filtered.length === 0) return [];
    return [
      new ScatterplotLayer<TourismSite>({
        id: "tourism-sites",
        data: filtered,
        getPosition: (d) => [d.lng, d.lat],
        getFillColor: (d) => {
          const [r, g, b] = d.barrierFree
            ? ([52, 211, 153] as const) // HEX.infra
            : ([192, 132, 252] as const); // HEX.tourism
          return [r, g, b, d.id === selectedId ? 255 : 170];
        },
        getRadius: (d) => (d.id === selectedId ? 7 : 4),
        radiusUnits: "pixels",
        getLineColor: (d) => {
          if (d.id === selectedId) return [255, 255, 255, 255];
          if (blindSpotIds.has(d.id)) return [251, 113, 133, 200]; // HEX.unmet — 사각지대 표시
          return [0, 0, 0, 0];
        },
        getLineWidth: (d) => (d.id === selectedId ? 2 : blindSpotIds.has(d.id) ? 1.5 : 0),
        lineWidthUnits: "pixels",
        stroked: true,
        pickable: true,
        onClick: (info) => select((info.object as TourismSite | undefined) ?? null),
        updateTriggers: {
          getFillColor: [selectedId],
          getRadius: [selectedId],
          getLineColor: [selectedId, blindSpotIds],
          getLineWidth: [selectedId, blindSpotIds],
        },
      }),
    ];
  }, [filtered, selectedId, select, blindSpotIds]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      const s = info.object as TourismSite | undefined;
      if (!s) return null;
      const badge = s.barrierFree ? "베리어프리" : s.category;
      const lackLine =
        !s.barrierFree && s.lack.length > 0
          ? `<br/><span style="color:#fb7185">${s.lack.join(" · ")}</span>`
          : "";
      return tooltipHtml(`<b>${s.name}</b><br/>${badge} · ${hoursLabel(s)}${lackLine}`);
    };
  }, []);

  const overlay = useMemo(
    () => <SearchOverlay query={query} onChange={setQuery} />,
    [query],
  );

  useEffect(() => {
    onMapSpec({ layers, getTooltip, flyTo, overlay });
  }, [layers, getTooltip, flyTo, overlay, onMapSpec]);

  const stats = tourism.data?.stats;
  const worstGu = useMemo(() => {
    if (!stats) return null;
    const candidates = stats.byGu.filter((g) => g.total >= 5);
    if (candidates.length === 0) return null;
    return [...candidates].sort((a, b) => a.share - b.share)[0];
  }, [stats]);

  if (!tourism.data) {
    return (
      <div className="space-y-3">
        <DataPending note="tourism.json 대기 중 — 관광지 검색·베리어프리 커버리지가 여기 표시됩니다." />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 rounded-lg border border-line bg-panel p-1">
        {(
          [
            ["list", "목록·검색"],
            ["rank", "사각지대 순위"],
            ["stats", "통계"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
              tab === id ? "bg-accent/15 text-accent" : "text-dim hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "list" && (
        <>
          <Section
            title="필터"
            aside={`표시 중 ${fmt(filtered.length)} / 전체 ${fmt(sites.length)}`}
          >
            <label className="flex items-center gap-2 text-[12px] text-ink">
              <input
                type="checkbox"
                checked={barrierFreeOnly}
                onChange={(e) => setBarrierFreeOnly(e.target.checked)}
                className="accent-accent"
              />
              베리어프리 관광지만 보기
            </label>

            <div className="mt-2.5 text-[11px] text-dim">개장 요일</div>
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              {(
                [
                  ["all", "전체"],
                  ["weekday", "평일 운영"],
                  ["weekend", "주말 운영"],
                ] as [DayFilter, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={dayFilter === id}
                  onClick={() => setDayFilter(id)}
                  className={`rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
                    dayFilter === id
                      ? "border-accent/60 bg-accent/10 text-accent"
                      : "border-line text-dim hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-2.5 text-[11px] text-dim">시간대 (복수 선택)</div>
            <div className="mt-1 grid grid-cols-4 gap-1.5">
              {BANDS.map((b) => {
                const on = bands.has(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleBand(b.id)}
                    className={`rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
                      on
                        ? "border-accent/60 bg-accent/10 text-accent"
                        : "border-line text-dim hover:text-ink"
                    }`}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>

            {(query || barrierFreeOnly || dayFilter !== "all" || bands.size > 0) && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setBarrierFreeOnly(false);
                  setDayFilter("all");
                  setBands(new Set());
                }}
                className="mt-2.5 text-[11px] text-accent hover:underline"
              >
                필터 초기화
              </button>
            )}
          </Section>

          {selected && (
            <Section
              title={selected.name}
              aside={
                <button
                  type="button"
                  onClick={() => select(null)}
                  className="text-accent hover:underline"
                >
                  선택 해제
                </button>
              }
            >
              <dl className="space-y-1.5 text-[12px]">
                <div className="flex items-start justify-between gap-2 border-b border-line/60 pb-1.5">
                  <dt className="shrink-0 text-dim">유형</dt>
                  <dd className="text-right text-ink">
                    {selected.category}
                    {selected.barrierFree && (
                      <span className="ml-1.5 rounded bg-infra/15 px-1.5 py-px text-[10px] text-infra">
                        베리어프리
                      </span>
                    )}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-2 border-b border-line/60 pb-1.5">
                  <dt className="shrink-0 text-dim">주소</dt>
                  <dd className="text-right text-ink">{selected.address || "—"}</dd>
                </div>
                <div className="flex items-start justify-between gap-2 border-b border-line/60 pb-1.5">
                  <dt className="shrink-0 text-dim">운영시간</dt>
                  <dd className="text-right text-ink">{hoursLabel(selected)}</dd>
                </div>
                <div className="flex items-start justify-between gap-2 border-b border-line/60 pb-1.5">
                  <dt className="shrink-0 text-dim">쉬는날</dt>
                  <dd className="text-right text-ink">{selected.closedRaw || "연중무휴"}</dd>
                </div>
                {selected.phone && (
                  <div className="flex items-start justify-between gap-2 border-b border-line/60 pb-1.5">
                    <dt className="shrink-0 text-dim">전화</dt>
                    <dd className="text-right text-ink">{selected.phone}</dd>
                  </div>
                )}
                {!selected.barrierFree && (
                  <div className="flex items-start justify-between gap-2">
                    <dt className="shrink-0 text-dim">최근접 시설</dt>
                    <dd className="text-right text-ink">
                      충전소 {distLabel(selected.nearestM.charger)} · 병의원{" "}
                      {distLabel(selected.nearestM.hospital)} · 복지시설{" "}
                      {distLabel(selected.nearestM.welfare)}
                    </dd>
                  </div>
                )}
              </dl>
              {!selected.barrierFree && selected.lack.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {selected.lack.map((l) => (
                    <span
                      key={l}
                      className="rounded bg-unmet/10 px-1.5 py-0.5 text-[10px] leading-4 text-unmet"
                    >
                      {l}
                    </span>
                  ))}
                </div>
              )}
            </Section>
          )}

          <Section title="관광지 목록" aside="행 클릭 = 지도 이동" flush>
            <div className="max-h-[320px] overflow-y-auto">
              <table className="w-full table-fixed text-[12px]">
                <colgroup>
                  <col className="w-[46%]" />
                  <col className="w-[18%]" />
                  <col className="w-[36%]" />
                </colgroup>
                <thead className="sticky top-0 bg-panel">
                  <tr className="border-b border-line text-left text-[11px] text-dim">
                    <th className="px-3 py-1.5 font-medium">이름</th>
                    <th className="whitespace-nowrap py-1.5 font-medium">유형</th>
                    <th className="whitespace-nowrap px-3 py-1.5 text-right font-medium">운영시간</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 200).map((s) => {
                    const active = s.id === selectedId;
                    return (
                      <tr
                        key={s.id}
                        onClick={() => select(active ? null : s)}
                        className={`cursor-pointer border-b border-line/60 last:border-b-0 ${
                          active ? "bg-accent/10" : "hover:bg-[#161e30]"
                        }`}
                      >
                        <td
                          title={s.name}
                          className={`truncate py-1.5 pl-3 align-top ${
                            active ? "font-semibold text-accent" : "text-ink"
                          }`}
                        >
                          <span className="truncate">{s.name}</span>
                          {s.barrierFree && (
                            <span className="ml-1.5 whitespace-nowrap rounded bg-infra/15 px-1 py-px text-[10px] leading-4 text-infra">
                              BF
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap py-1.5 align-top text-dim">
                          {s.category}
                        </td>
                        <td className="truncate whitespace-nowrap px-3 py-1.5 text-right align-top text-dim">
                          {hoursLabel(s)}
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-dim">
                        조건에 맞는 관광지가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}

      {tab === "rank" && (
        <>
          <Section
            title="관광지 사각지대 순위"
            aside={`${fmt(rankedBlindSpots.length)}곳 · 행 클릭 = 지도 이동`}
            flush
          >
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full table-fixed text-[12px]">
                <colgroup>
                  <col className="w-[10%]" />
                  <col className="w-[38%]" />
                  <col className="w-[52%]" />
                </colgroup>
                <thead className="sticky top-0 bg-panel">
                  <tr className="border-b border-line text-left text-[11px] text-dim">
                    <th className="px-3 py-1.5 font-medium">순위</th>
                    <th className="py-1.5 font-medium">이름</th>
                    <th className="px-3 py-1.5 text-right font-medium">부족 시설</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedBlindSpots.map((s) => {
                    const active = s.id === selectedId;
                    return (
                      <tr
                        key={s.id}
                        onClick={() => select(active ? null : s)}
                        className={`cursor-pointer border-b border-line/60 last:border-b-0 ${
                          active ? "bg-accent/10" : "hover:bg-[#161e30]"
                        }`}
                      >
                        <td className="tnum py-1.5 pl-3 align-top text-dim">{s.rank}</td>
                        <td
                          title={s.name}
                          className={`truncate py-1.5 align-top ${
                            active ? "font-semibold text-accent" : "text-ink"
                          }`}
                        >
                          {s.name}
                          <span className="ml-1.5 whitespace-nowrap text-[10px] text-dim">
                            {s.category}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          <span className="flex flex-wrap justify-end gap-1">
                            {s.lack.map((l) => (
                              <span
                                key={l}
                                className="whitespace-nowrap rounded bg-unmet/10 px-1 py-px text-[10px] leading-4 text-unmet"
                              >
                                {l}
                              </span>
                            ))}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {rankedBlindSpots.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-dim">
                        데이터가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>

          <p className="text-[11px] leading-4 text-dim">
            베리어프리 인증이 없는 관광지 {fmt(sites.filter((s) => !s.barrierFree).length)}곳
            중 <b className="text-unmet">{fmt(rankedBlindSpots.length)}곳</b>이 충전소·병의원·
            복지시설 중 하나 이상의 기준 거리를 벗어납니다 — 순위가 높을수록(부족 항목이
            많고 거리가 멀수록) 접근성 사각지대가 심합니다. 지도에서는 이 관광지들에 붉은
            테두리가 표시됩니다.
          </p>
        </>
      )}

      {tab === "stats" && stats && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="전체 관광지" value={`${fmt(stats.total)}곳`} color={HEX.tourism} />
            <Kpi
              label="베리어프리 비율"
              value={pct(stats.barrierFreeShare)}
              sub={`${fmt(stats.barrierFree)}곳 / ${fmt(stats.total)}곳`}
              color={HEX.infra}
            />
          </div>

          <Section title="구·군별 베리어프리 커버리지" aside="전체 대비 베리어프리 수">
            <TourismBar data={stats.byGu.map((g) => ({ label: g.gu, ...g }))} />
          </Section>

          <Section title="유형별 베리어프리 커버리지">
            <TourismBar data={stats.byCategory.map((c) => ({ label: c.category, ...c }))} />
          </Section>

          {worstGu && (
            <p className="rounded-md border border-unmet/40 bg-unmet/5 px-3 py-2 text-[11px] leading-4 text-ink/85">
              <b className="text-unmet">{worstGu.gu}</b>이(가) 관광지{" "}
              {fmt(worstGu.total)}곳 중 베리어프리는{" "}
              <b className="tnum text-unmet">{fmt(worstGu.barrierFree)}곳({pct(worstGu.share)})</b>
              으로 가장 접근성 사각지대가 큰 지역입니다.
            </p>
          )}
        </>
      )}

      <Explainer
        what={
          <>
            <p>
              &lsquo;도착지 사각지대&rsquo; 씬이 두리발 하차 지점 기준의
              시설 공백을 봤다면, 이 화면은 <b>관광지 자체의 접근성 공백</b>을
              봅니다. 관광지·문화시설·레포츠·숙박 {fmt(stats?.total ?? 0)}곳을
              지도에 표시하고, 그중 <b className="text-infra">베리어프리
              인증 관광지</b>(녹색)와 나머지(보라색)를 구분합니다. 왼쪽 위
              돋보기로 이름 검색, 오른쪽 패널에서 개장 요일·시간대·베리어프리
              여부로 필터링할 수 있습니다. &lsquo;사각지대 순위&rsquo; 탭은
              베리어프리 인증이 없는 관광지 중 충전소·병의원·복지시설이
              기준 거리 밖에 있는 곳을 순위로 매기고, &lsquo;통계&rsquo;
              탭에서 구·군·유형별 베리어프리 비율을 확인할 수 있습니다.
            </p>
          </>
        }
        how={
          <>
            <p>
              관광지 데이터는 TourAPI 형식의 부산 관광지·문화시설·레포츠·숙박
              내보내기 파일을 합쳐 명칭+주소 기준으로 중복을 제거했습니다.
              베리어프리 여부는 &lsquo;인프라 지도&rsquo; 씬의 배리어프리
              문화예술관광지 레이어(한국문화정보원)와 이름 일치 또는 80m 이내
              근접 여부로 교차 확인했습니다. 운영시간은 원자료의 자유
              텍스트(이용시간·쉬는날)에서 시간 범위와 휴무 요일을 정규식으로
              추출한 것으로, &ldquo;상시 개방&rdquo;·&ldquo;연중무휴&rdquo;
              같은 문구는 요일·시간 제한이 없는 것으로 처리했습니다.
            </p>
            <p className="mt-2">
              <b>사각지대 순위</b>는 &lsquo;도착지 사각지대&rsquo; 씬과 같은
              방식으로, 베리어프리 인증이 없는 관광지마다 가장 가까운
              전동휠체어 급속충전기·병의원·장애인복지시설까지의 직선거리를
              계산해 기준(충전소 2km · 병의원 500m · 복지시설 1km)을 벗어나면
              &ldquo;부족&rdquo; 배지를 붙입니다. 점수는 기준을 벗어난 항목마다
              (실제거리 ÷ 기준거리 − 1)을 더한 값으로, 부족 항목이 많고
              거리가 멀수록 순위가 높습니다(1위 = 가장 심각).
            </p>
          </>
        }
        caveats={
          <>
            <p>
              평일·주말 시간이 다르게 적혀 있는 항목(예: &ldquo;평일
              10~18시, 주말 10~17시&rdquo;)은 첫 번째 시간대만 인식하며, 전화
              문의 안내만 있고 시간이 명시되지 않은 곳은 필터에서 항상
              표시됩니다(정보 없음 ≠ 폐쇄). 베리어프리 매칭은 이름·좌표
              기준 자동 매칭이라 이름 표기가 크게 다른 일부 시설은 놓칠 수
              있습니다. 베리어프리 인증이 없다고 해서 실제로 접근이 불가능한
              것은 아니며, 인증 데이터가 아직 등록되지 않은 곳일 수 있습니다.
              사각지대 순위의 거리는 직선거리라 실제 도보 이동 부담(언덕·
              횡단보도 등)은 반영하지 않으며, 가덕도·기장 같은 외곽 관광지는
              구조적으로 모든 기준을 벗어나 상위권에 몰리는 경향이 있습니다.
            </p>
          </>
        }
      />
    </div>
  );
}
