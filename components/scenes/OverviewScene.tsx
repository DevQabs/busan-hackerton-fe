"use client";

import { useEffect, useMemo } from "react";
import { GeoJsonLayer } from "deck.gl";
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

export function OverviewScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const stats = useData<Stats>(DATA.stats);
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);

  const layers = useMemo(() => {
    if (!dongs.data) return [];
    const max = Math.max(1, ...dongs.data.features.map((f) => f.properties.dropoffs));
    return [
      new GeoJsonLayer<DongProps>({
        id: "overview-dongs",
        data: dongs.data as never,
        pickable: true,
        stroked: true,
        filled: true,
        getFillColor: (f) => {
          // faint sqrt ramp so the map stays a backdrop, not the message
          const t = Math.sqrt(f.properties.dropoffs / max);
          return [56, 189, 248, Math.round(18 + t * 110)];
        },
        getLineColor: [35, 43, 61, 200],
        getLineWidth: 1,
        lineWidthUnits: "pixels",
      }),
    ];
  }, [dongs.data]);

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

  useEffect(() => {
    onMapSpec({ layers, getTooltip });
  }, [layers, getTooltip, onMapSpec]);

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
