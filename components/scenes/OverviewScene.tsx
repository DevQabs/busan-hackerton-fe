"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GeoJsonLayer, TextLayer } from "deck.gl";
import { DATA, type DongProps, type Stats } from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt, pct } from "@/lib/format";
import { HEX } from "@/lib/palette";
import {
  tooltipHtml,
  type DongCollection,
  type MapSpec,
} from "@/lib/mapspec";
import { Kpi } from "@/components/ui/Kpi";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";
import { Explainer } from "@/components/ui/Explainer";
import { HourBar } from "@/components/charts/HourBar";
import { DowBar } from "@/components/charts/DowBar";

/** How high (metres) the hovered 행정동 rises out of the map. At the opening
 *  zoom this reads as a ~30px lift — enough for the 3D pop, small enough that
 *  the block never covers its neighbours. */
const HOVER_LIFT_M = 1600;

export function OverviewScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const stats = useData<Stats>(DATA.stats);
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);
  const [hoverCd, setHoverCd] = useState<string | null>(null);

  // deck fires onHover on every move; setting the same admCd is a React no-op.
  const onHover = useCallback(
    (info: { object?: { properties?: DongProps } | null }) =>
      setHoverCd(info.object?.properties?.admCd ?? null),
    [],
  );

  const all = useMemo(
    () => dongs.data?.features.map((f) => f.properties) ?? [],
    [dongs.data],
  );

  /** hovered dong + where it sits among all 206 행정동 */
  const hovered = useMemo(() => {
    if (!hoverCd) return null;
    const p = all.find((d) => d.admCd === hoverCd);
    if (!p) return null;
    const dropRank =
      all.filter((d) => d.dropoffs > p.dropoffs).length + 1;
    const maxDrop = Math.max(1, ...all.map((d) => d.dropoffs));
    const maxPick = Math.max(1, ...all.map((d) => d.pickups));
    const rate = p.unassigned / Math.max(1, p.pickups + p.unassigned);
    return { p, dropRank, total: all.length, maxDrop, maxPick, rate };
  }, [hoverCd, all]);

  const layers = useMemo(() => {
    if (!dongs.data) return [];
    const max = Math.max(1, ...dongs.data.features.map((f) => f.properties.dropoffs));
    return [
      // extruded fill: flat at rest, the hovered dong animates up on its walls
      new GeoJsonLayer<DongProps>({
        id: "overview-dongs",
        data: dongs.data as never,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 72],
        stroked: false,
        filled: true,
        extruded: true,
        material: false, // flat colors — no lighting shift on the raised walls
        getElevation: (f) =>
          f.properties.admCd === hoverCd ? HOVER_LIFT_M : 0,
        getFillColor: (f) => {
          // faint sqrt ramp so the map stays a backdrop, not the message
          const t = Math.sqrt(f.properties.dropoffs / max);
          const lifted = f.properties.admCd === hoverCd;
          return [
            56,
            189,
            248,
            Math.round((lifted ? 70 : 18) + t * 110),
          ];
        },
        onHover,
        transitions: {
          getElevation: { duration: 260 },
          getFillColor: { duration: 180 },
        },
        updateTriggers: {
          getElevation: [hoverCd],
          getFillColor: [hoverCd],
        },
      }),
      // ground outlines stay put, so a raised dong reads against its footprint
      new GeoJsonLayer<DongProps>({
        id: "overview-dong-lines",
        data: dongs.data as never,
        pickable: false,
        stroked: true,
        filled: false,
        getLineColor: (f) =>
          f.properties.admCd === hoverCd
            ? [34, 211, 238, 220]
            : [35, 43, 61, 200],
        getLineWidth: (f) => (f.properties.admCd === hoverCd ? 2 : 1),
        lineWidthUnits: "pixels",
        updateTriggers: {
          getLineColor: [hoverCd],
          getLineWidth: [hoverCd],
        },
      }),
      // name + 하차 floating on top of the raised block
      ...(hovered
        ? [
            new TextLayer<DongProps>({
              id: "overview-hover-label",
              data: [hovered.p],
              getPosition: (d) => [
                d.centroid[0],
                d.centroid[1],
                HOVER_LIFT_M + 120,
              ],
              getText: (d) =>
                `${d.name}\n하차 ${fmt(d.dropoffs)}건 · ${hovered.dropRank}위`,
              getSize: 13,
              getColor: [226, 232, 240, 255],
              lineHeight: 1.35,
              fontWeight: 700,
              getTextAnchor: "middle",
              getAlignmentBaseline: "bottom",
              getPixelOffset: [0, -6],
              background: true,
              getBackgroundColor: [11, 15, 26, 215],
              backgroundPadding: [6, 4, 6, 4],
            }),
          ]
        : []),
    ];
  }, [dongs.data, hoverCd, hovered, onHover]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      const f = info.object as { properties: DongProps } | undefined;
      if (!f?.properties) return null;
      const p = f.properties;
      return tooltipHtml(
        `<b>${p.gu} ${p.name}</b><br/>하차 ${fmt(p.dropoffs)}건 · 승차 ${fmt(p.pickups)}건`,
      );
    };
  }, []);

  // Hover card over the map: the raised dong's own numbers, each next to the
  // citywide reference so a judge can read "높다 / 낮다" without a legend.
  const cityRate = stats.data?.totals.unassignedRate ?? 0;
  const overlay = useMemo(() => {
    if (!hovered) {
      return dongs.data ? (
        <div className="pointer-events-none rounded-lg border border-line bg-panel/85 px-3 py-1.5 text-[11px] leading-4 text-dim backdrop-blur">
          지도의 행정동에 마우스를 올리면 그 동이 떠오르며 상세 지표가
          표시됩니다
        </div>
      ) : undefined;
    }
    const { p, dropRank, total, maxDrop, maxPick, rate } = hovered;
    const bars: [string, string, number, string][] = [
      ["하차", `${fmt(p.dropoffs)}건`, p.dropoffs / maxDrop, HEX.demand],
      ["승차", `${fmt(p.pickups)}건`, p.pickups / maxPick, HEX.accent],
      [
        "미배차율",
        `${pct(rate)} (시 평균 ${pct(cityRate)})`,
        Math.min(1, rate / Math.max(0.01, cityRate * 2)),
        rate > cityRate ? HEX.unmet : HEX.infra,
      ],
    ];
    return (
      <div className="pointer-events-none w-[268px] rounded-lg border border-accent/40 bg-panel/95 px-3 py-2.5 backdrop-blur">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[13px] font-bold leading-5 text-ink">
            {p.gu} {p.name}
          </div>
          <div className="tnum shrink-0 text-[10px] text-dim">
            하차 {dropRank}위 / {total}
          </div>
        </div>

        <div className="mt-1.5 space-y-1">
          {bars.map(([label, value, t, color]) => (
            <div key={label}>
              <div className="flex items-baseline justify-between gap-2 text-[10.5px] leading-4">
                <span className="text-dim">{label}</span>
                <span className="tnum text-ink">{value}</span>
              </div>
              <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-[#1a2336]">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.round(Math.min(1, t) * 100)}%`,
                    background: color,
                  }}
                />
              </span>
            </div>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-4 gap-1 border-t border-line/70 pt-1.5 text-center">
          {(
            [
              ["충전소", p.chargers],
              ["병의원", p.hospitals],
              ["약국", p.pharmacies],
              ["복지", p.welfare],
            ] as [string, number][]
          ).map(([label, n]) => (
            <div key={label}>
              <div
                className={`tnum text-[13px] font-bold leading-4 ${
                  n === 0 ? "text-unmet" : "text-ink"
                }`}
              >
                {fmt(n)}
              </div>
              <div className="text-[9px] leading-3 text-dim">{label}</div>
            </div>
          ))}
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] leading-4">
          <span className="text-dim">
            대기 중앙값{" "}
            <b className="tnum text-ink">
              {p.waitMedian === null ? "표본 부족" : `${fmt(p.waitMedian)}분`}
            </b>
          </span>
          <span
            className="rounded px-1.5 py-0.5 font-semibold"
            style={
              p.gapClass === "HL"
                ? { color: HEX.gapHL, background: `${HEX.gapHL}1f` }
                : { color: HEX.inkDim, background: "#1a2336" }
            }
          >
            {p.gapClass === "HL" ? "우선 사각지대" : `격차 ${p.gapScore.toFixed(2)}`}
          </span>
        </div>
      </div>
    );
  }, [hovered, dongs.data, cityRate]);

  useEffect(() => {
    onMapSpec({ layers, getTooltip, overlay });
  }, [layers, getTooltip, overlay, onMapSpec]);

  if (!stats.data) {
    return <DataPending note="stats.json 대기 중 — 지표·차트가 여기 표시됩니다." />;
  }

  const s = stats.data;
  const wcKnown = s.wheelchair.manual + s.wheelchair.electric;
  const wcTotal = wcKnown + s.wheelchair.none + s.wheelchair.unknown;
  const hourly = s.hourly.map((h) => ({ hour: h.hour, value: h.requests }));
  const peaks = [...s.hourly].sort((a, b) => b.requests - a.requests).slice(0, 2);
  const hourKo = (h: number) => (h < 12 ? `오전 ${h}시` : `오후 ${h - 12}시`);
  const peakHours = peaks.map((p) => p.hour).sort((a, b) => a - b);
  // "약 N건 중 1건" framing for the unassigned rate — easier to grasp than a percent
  const oneInN =
    s.totals.unassignedRate > 0 ? Math.round(1 / s.totals.unassignedRate) : null;

  return (
    <div className="space-y-3">
      {/* ── story intro: why this dashboard exists ──────────────────────── */}
      <Section title="어디든 두가자 — 문제의식">
        <p className="text-[12px] leading-5 text-ink/85">
          두리발(부산 교통약자 특별교통수단)의 호출 기록은 &ldquo;어디서 타서
          어디에 내렸는가&rdquo;를 보여줍니다. 그런데 내린 다음은 어떨까요?
          충전소·경사로·장애인화장실 같은 <b className="text-ink">도착지 인프라</b>는
          이 기록 어디에도 없습니다. 수요는 보이는데 도착한 뒤의 환경은 보이지
          않는 것 — 이 대시보드는 그 간극을 데이터로 잇습니다. 이동 기록과
          무장애 인프라 데이터를 겹쳐, <b className="text-ink">사람들이 많이 내리는데
          인프라가 따라가지 못하는 곳</b>을 찾아냅니다.
        </p>
      </Section>

      <div className="grid grid-cols-2 gap-2">
        <Kpi
          label="총 이용 접수"
          value={fmt(s.totals.trips)}
          sub={`한 달간 완료 ${fmt(s.totals.completed)}건 · ${s.period.from} ~ ${s.period.to}`}
          color={HEX.demand}
        />
        <Kpi
          label="미배차율"
          value={pct(s.totals.unassignedRate)}
          sub={
            oneInN
              ? `약 ${oneInN}건 중 1건은 차량을 배정받지 못함 (미배차 ${fmt(s.totals.unassigned)}건)`
              : `미배차 ${fmt(s.totals.unassigned)}건 · 취소 ${fmt(s.totals.cancelled)}건`
          }
          color={HEX.unmet}
        />
        <Kpi
          label="대기시간 중앙값"
          value={`${fmt(s.waitMinutes.median)}분`}
          sub={`절반은 이보다 오래 대기 · 상위 10%는 ${fmt(s.waitMinutes.p90)}분 이상`}
          color={HEX.warn}
        />
        <Kpi
          label="휠체어 이용 비중"
          value={wcTotal > 0 ? pct(wcKnown / wcTotal) : "—"}
          sub={`수동 ${fmt(s.wheelchair.manual)}건 · 전동 ${fmt(s.wheelchair.electric)}건 — 전동은 충전 인프라가 필수`}
          color={HEX.accent}
        />
      </div>

      {/* chi-square evening anomaly — one-line callout, detail in 통계 분석 씬 */}
      <div className="rounded-md border border-unmet/40 bg-unmet/5 px-3 py-2 text-[11px] leading-4 text-ink/85">
        <b className="text-unmet">저녁이 특히 취약합니다.</b> 16–24시 접수의
        미배차율은 <b className="tnum text-unmet">15.9%</b>로 전체 평균{" "}
        <span className="tnum">9.4%</span>를 크게 웃돕니다 (독립성 검정 χ²=335,
        p&lt;0.0001 — 자세한 해석은 &lsquo;통계 모델&rsquo; 씬).
      </div>

      <Section
        title="시간대별 접수"
        aside={peaks.map((p) => `${p.hour}시 ${fmt(p.requests)}건`).join(" · ")}
      >
        <HourBar data={hourly} baseColor={HEX.demand} hiColor={HEX.accent} seriesName="접수" />
        <p className="mt-1.5 text-[11px] leading-4 text-dim">
          {peakHours.map(hourKo).join("·")} 병원 통원 시간대에 수요가 집중됩니다.
        </p>
      </Section>

      <Section title="요일별 접수">
        <DowBar data={s.byDow} />
      </Section>

      <Section title="이용 목적 상위" flush>
        <ul>
          {s.purpose.slice(0, 5).map((p, i) => {
            const max = Math.max(1, s.purpose[0]?.count ?? 1);
            return (
              <li
                key={p.name}
                className="flex items-center gap-2 border-b border-line px-3.5 py-1.5 text-[12px] last:border-b-0"
              >
                <span className="tnum w-4 text-dim">{i + 1}</span>
                <span className="w-20 truncate text-ink">{p.name}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1a2336]">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.round((p.count / max) * 100)}%`,
                      background: HEX.demand,
                      opacity: 0.75,
                    }}
                  />
                </span>
                <span className="tnum w-14 text-right text-dim">{fmt(p.count)}건</span>
              </li>
            );
          })}
        </ul>
      </Section>

      {!dongs.data && (
        <DataPending note="dongs.geojson 대기 중 — 지도에 행정동 하차 밀도가 표시됩니다." />
      )}

      <Explainer
        what={
          <>
            <p>
              이 화면은 대시보드 전체의 출발점입니다. 한 달치 두리발 호출
              기록을 네 개의 핵심 지표(접수량 / 미배차율 / 대기시간 / 휠체어
              비중)로 요약하고, 수요가 언제(시간대·요일) 몰리고 무엇 때문에(이용
              목적) 발생하는지 보여줍니다. 뒤에 이어지는 씬들은 여기서 던진
              질문 — &ldquo;배정받지 못한 1할은 어디에 있었나&rdquo;,
              &ldquo;내린 다음의 환경은 어떤가&rdquo; — 에 하나씩 답합니다.
            </p>
            <p className="mt-2">
              <b>어떻게 활용하나</b> — 공단(운영기관)에는 시간대별 수요·미배차
              곡선이 배차 인력·차량 운영 계획의 근거가 되고, 구청에는 이용
              목적과 도착지 분포가 인프라 투자 우선순위 논의의 출발 자료가
              됩니다. 저녁 시간대 미배차 편중 콜아웃은 &ldquo;평균만 보면
              놓치는 취약 시간대&rdquo;를 짚는 첫 단서입니다.
            </p>
          </>
        }
        how={
          <>
            <p>
              두리발 호출 기록(2025년 5월, 부산시 전역 {fmt(s.totals.trips)}건)을
              접수 단위로 집계했습니다. 미배차율 = 미배차 건수 ÷ 전체 접수,
              대기시간은 배차에 성공한 건의 접수→승차 소요 시간 중앙값입니다.
              지도의 행정동 음영은 하차 건수를 제곱근 스케일로 칠한 것으로,
              값이 몇 배 차이나도 상위 지역만 하얗게 타버리지 않도록 한
              표현입니다. 저녁 미배차 편중은 접수 시간대 4구간과 미배차 여부의
              카이제곱 독립성 검정(χ²=335, p&lt;0.0001) 결과입니다.
            </p>
          </>
        }
        caveats={
          <>
            <p>
              데이터는 한 달(5월) 치입니다 — 계절 요인(장마·방학·행사)은 반영되지
              않으며, 본선에서는 더 긴 기간(해운대구 약 1년)으로 재계산합니다.
              이용 목적의 {pct((s.purpose.find((p) => p.name === "기타")?.count ?? 0) / s.totals.trips)}가
              &lsquo;기타&rsquo;로 기록되어 목적 분석의 해상도는 제한적입니다.
              대기시간 중앙값은 배차에 성공한 건만의 통계라 실제 대기 부담을
              과소평가할 수 있습니다 — 이를 보정한 추정은 &lsquo;대기시간
              포렌식&rsquo; 씬에서 다룹니다.
            </p>
          </>
        }
      />
    </div>
  );
}
