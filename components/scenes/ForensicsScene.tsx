"use client";

import { useEffect, useMemo } from "react";
import { GeoJsonLayer } from "deck.gl";
import {
  Bar,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DATA, type DongProps, type WaitKm } from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt, pct } from "@/lib/format";
import { HEX } from "@/lib/palette";
import { tooltipHtml, type DongCollection, type MapSpec } from "@/lib/mapspec";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";
import { Explainer } from "@/components/ui/Explainer";
import {
  CURSOR_FILL,
  TICK,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
} from "@/components/charts/theme";

/** Curve label → line color. 전동/수동 follow the dashboard-wide convention
 *  (전동=accent, 수동=demand); 전체 is a neutral dashed reference line. */
function curveColor(label: string): string {
  if (label.includes("전동")) return HEX.accent;
  if (label.includes("수동")) return HEX.demand;
  return HEX.ink;
}

function minutes(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined) return "—";
  return `${v.toFixed(digits)}분`;
}

export function ForensicsScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const km = useData<WaitKm>(DATA.waitKm);
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);

  // Map: per-dong median wait choropleth (cool = short wait, warm red = long).
  // Robust domain: 10th–90th percentile of non-null medians.
  const layers = useMemo(() => {
    if (!dongs.data) return [];
    const vals = dongs.data.features
      .map((f) => f.properties.waitMedian)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    const lo = vals[Math.floor(vals.length * 0.1)] ?? 0;
    const hi = vals[Math.floor(vals.length * 0.9)] ?? lo + 1;
    const LOW: [number, number, number] = [35, 60, 95]; // muted blue
    const HIGH: [number, number, number] = [229, 72, 77]; // #e5484d warm red
    const fill = (v: number | null): [number, number, number, number] => {
      if (v === null) return [18, 24, 38, 40]; // sample too small — near-invisible
      const t = Math.max(0, Math.min(1, (v - lo) / Math.max(1e-9, hi - lo)));
      return [
        Math.round(LOW[0] + t * (HIGH[0] - LOW[0])),
        Math.round(LOW[1] + t * (HIGH[1] - LOW[1])),
        Math.round(LOW[2] + t * (HIGH[2] - LOW[2])),
        165,
      ];
    };
    return [
      new GeoJsonLayer<DongProps>({
        id: "forensics-wait-choropleth",
        data: dongs.data as never,
        stroked: true,
        filled: true,
        pickable: true,
        getFillColor: (f) => fill((f as unknown as { properties: DongProps }).properties.waitMedian),
        getLineColor: [35, 43, 61, 200],
        getLineWidth: 1,
        lineWidthUnits: "pixels",
      }),
    ];
  }, [dongs.data]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return ({ object }) => {
      if (!object) return null;
      const p = (object as { properties: DongProps }).properties;
      if (p.waitMedian === null)
        return tooltipHtml(`<b>${p.gu} ${p.name}</b><br/>표본 10건 미만 — 대기 중앙값 미표시`);
      return tooltipHtml(
        `<b>${p.gu} ${p.name}</b><br/>접수→승차 대기 중앙값 <b>${p.waitMedian.toFixed(0)}분</b> · 하차 ${fmt(p.dropoffs)}건`
      );
    };
  }, []);

  useEffect(() => {
    onMapSpec({ layers, getTooltip });
  }, [layers, getTooltip, onMapSpec]);

  // Merge survival curves onto one time grid so the shared tooltip works.
  const survivalRows = useMemo(() => {
    if (!km.data) return [];
    const byT = new Map<number, Record<string, number>>();
    for (const c of km.data.curves) {
      for (const [t, s] of c.points) {
        const row = byT.get(t) ?? { t };
        row[c.label] = s;
        byT.set(t, row);
      }
    }
    return [...byT.values()].sort((a, b) => a.t - b.t);
  }, [km.data]);

  const worstAssign = useMemo(() => {
    if (!km.data) return null;
    let worst: WaitKm["queue"][number] | null = null;
    for (const q of km.data.queue) {
      if (q.p50Assign === null) continue;
      if (!worst || q.p50Assign > (worst.p50Assign ?? 0)) worst = q;
    }
    return worst;
  }, [km.data]);

  const fleetInsight = useMemo(() => {
    if (!km.data || km.data.queue.length === 0 || km.data.fleet.length === 0)
      return null;
    const reqPeak = [...km.data.queue].sort((a, b) => b.requests - a.requests)[0];
    const occPeak = [...km.data.fleet].sort((a, b) => b.avgActive - a.avgActive)[0];
    return { reqPeak, occPeak };
  }, [km.data]);

  if (!km.data) {
    return (
      <div className="space-y-3">
        <DataPending note="wait_km.json 대기 중 — 생존분석 기반 대기시간 포렌식이 표시됩니다." />
      </div>
    );
  }

  const d = km.data;

  return (
    <div className="space-y-3">
      {/* ── hero: naive vs KM-corrected median ─────────────────────────── */}
      <Section title="대기시간, 두 가지 추정">
        <p className="mb-2 text-[11px] leading-4 text-dim">
          지도: 행정동별 <b className="text-ink">접수→승차 대기 중앙값</b> —{" "}
          <span style={{ color: "#5b7bbf" }}>파랑(짧음)</span> →{" "}
          <span style={{ color: "#e5484d" }}>빨강(긺)</span>, 회색은 표본 10건 미만.
          동 위에 마우스를 올리면 수치가 표시됩니다.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-line bg-[#0e1424] px-3 py-2.5">
            <div className="text-[11px] leading-4 text-dim">
              배차 성공 건 기준 중앙값
            </div>
            <div className="tnum mt-0.5 text-[26px] font-bold leading-8 text-ink">
              {minutes(d.naive.median, 1)}
            </div>
            <div className="tnum text-[10px] text-dim">P90 {minutes(d.naive.p90, 1)}</div>
          </div>
          <div className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2.5">
            <div className="text-[11px] leading-4 text-warn/90">KM 보정 추정</div>
            <div className="tnum mt-0.5 text-[26px] font-bold leading-8 text-warn">
              {d.km.median === null ? "50% 미도달" : minutes(d.km.median, 1)}
            </div>
            <div className="tnum text-[10px] text-dim">
              P90 {d.km.p90 === null ? "미도달" : minutes(d.km.p90, 1)}
            </div>
          </div>
        </div>
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-unmet/10 px-2 py-1 text-[11px] font-medium text-unmet">
          접수의 {pct(d.censoredShare)}는 배차 없이 종료 → 관측중단 처리
        </div>
        <p className="mt-2 text-[11px] leading-4 text-dim">
          기존 지표는 배차에 성공한 요청만 포함하므로 대기 부담을 과소평가할 수
          있습니다.
        </p>
      </Section>

      {/* ── Kaplan-Meier survival curves ────────────────────────────────── */}
      <Section title="아직 배차를 못 받았을 확률 S(t)">
        <div style={{ height: 168 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={survivalRows} margin={{ top: 6, right: 6, bottom: 0, left: -22 }}>
              <XAxis
                dataKey="t"
                type="number"
                domain={[0, "dataMax"]}
                tick={TICK}
                tickLine={false}
                axisLine={{ stroke: "var(--line)" }}
                tickFormatter={(v: number) => `${v}분`}
              />
              <YAxis
                domain={[0, 1]}
                tick={TICK}
                tickLine={false}
                axisLine={false}
                width={50}
                tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              />
              <Tooltip
                cursor={{ stroke: "var(--line)" }}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                labelFormatter={(t) => `${t}분 경과`}
                formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`}
              />
              <ReferenceLine
                y={0.5}
                stroke="var(--ink-dim)"
                strokeDasharray="4 4"
                label={{ value: "50%", position: "insideTopRight", fill: "var(--ink-dim)", fontSize: 10 }}
              />
              {d.curves.map((c) => (
                <Line
                  key={c.label}
                  dataKey={c.label}
                  name={c.label}
                  stroke={curveColor(c.label)}
                  strokeWidth={c.label.includes("전체") ? 2.5 : 2}
                  strokeDasharray={c.label.includes("전체") ? "6 3" : undefined}
                  dot={false}
                  connectNulls
                  type="stepAfter"
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {d.curves.map((c) => (
            <li key={c.label} className="flex items-center gap-1.5 text-ink">
              <span
                className="h-0.5 w-5 rounded-full"
                style={{ background: curveColor(c.label) }}
              />
              {c.label}
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[11px] leading-4 text-dim">
          곡선이 50% 선과 만나는 지점이 &ldquo;절반이 배차를 받기까지 걸린
          시간&rdquo;입니다. 곡선이 오래 높게 유지될수록 대기 부담이 큽니다.
        </p>
      </Section>

      {/* ── queue decomposition per hour ────────────────────────────────── */}
      <Section title="대기 구간 분해 — 접수→배차 vs 배차→승차">
        <div style={{ height: 168 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={d.queue} margin={{ top: 6, right: 6, bottom: 0, left: -22 }}>
              <XAxis
                dataKey="hour"
                tick={TICK}
                tickLine={false}
                axisLine={{ stroke: "var(--line)" }}
                interval={2}
                tickFormatter={(h: number) => `${h}시`}
              />
              <YAxis
                tick={TICK}
                tickLine={false}
                axisLine={false}
                width={50}
                tickFormatter={(v: number) => `${v}분`}
              />
              <Tooltip
                cursor={CURSOR_FILL}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                labelFormatter={(h) => `${h}시 접수`}
                formatter={(v) => (v === null ? "—" : `${Number(v).toFixed(0)}분`)}
              />
              <Bar
                dataKey="p50Assign"
                name="접수→배차 p50"
                stackId="p50"
                fill={HEX.warn}
                fillOpacity={0.85}
                maxBarSize={10}
              />
              <Bar
                dataKey="p50Board"
                name="배차→승차 p50"
                stackId="p50"
                fill={HEX.demand}
                fillOpacity={0.7}
                radius={[3, 3, 0, 0]}
                maxBarSize={10}
              />
              <Line
                dataKey="p90Assign"
                name="접수→배차 p90"
                stroke={HEX.warn}
                strokeWidth={1}
                strokeDasharray="4 3"
                dot={false}
                connectNulls
              />
              <Line
                dataKey="p90Board"
                name="배차→승차 p90"
                stroke={HEX.demand}
                strokeWidth={1}
                strokeDasharray="4 3"
                dot={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          <li className="flex items-center gap-1.5 text-ink">
            <span className="h-2 w-2 rounded-sm" style={{ background: HEX.warn }} />
            접수→배차
          </li>
          <li className="flex items-center gap-1.5 text-ink">
            <span className="h-2 w-2 rounded-sm" style={{ background: HEX.demand }} />
            배차→승차
          </li>
          <li className="flex items-center gap-1.5 text-dim">
            <span className="h-0 w-5 border-t border-dashed border-dim" />
            가는 점선 = p90
          </li>
        </ul>
        {worstAssign && (
          <p className="mt-1.5 text-[11px] leading-4 text-dim">
            <b className="text-warn">{worstAssign.hour}시</b>가 가장 나쁩니다 —
            접수 후 배차까지 중앙값 {minutes(worstAssign.p50Assign)}이고, 상위
            10%는 {minutes(worstAssign.p90Assign)} 넘게 기다렸습니다. 대기의
            대부분이 차량 이동(배차→승차)이 아니라 배차 큐에서 발생합니다.
          </p>
        )}
      </Section>

      {/* ── fleet occupancy ─────────────────────────────────────────────── */}
      <Section title="시간대별 가동 차량">
        <div style={{ height: 150 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={d.fleet} margin={{ top: 6, right: 6, bottom: 0, left: -26 }}>
              <XAxis
                dataKey="hour"
                tick={TICK}
                tickLine={false}
                axisLine={{ stroke: "var(--line)" }}
                interval={2}
                tickFormatter={(h: number) => `${h}시`}
              />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={46} />
              <Tooltip
                cursor={CURSOR_FILL}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                labelFormatter={(h) => `${h}시`}
                formatter={(v) => `${fmt(Number(v))}대`}
              />
              <Bar
                dataKey="avgActive"
                name="평균 가동"
                fill={HEX.infra}
                fillOpacity={0.7}
                radius={[3, 3, 0, 0]}
                maxBarSize={10}
              />
              <Line
                dataKey="maxActive"
                name="최대 가동"
                stroke={HEX.ink}
                strokeWidth={1.5}
                strokeDasharray="5 3"
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          <li className="flex items-center gap-1.5 text-ink">
            <span className="h-2 w-2 rounded-sm" style={{ background: HEX.infra }} />
            평균 가동 차량
          </li>
          <li className="flex items-center gap-1.5 text-ink">
            <span className="h-0 w-5 border-t border-dashed border-ink" />
            최대 가동 차량
          </li>
        </ul>
        {fleetInsight && (
          <p className="mt-1.5 text-[11px] leading-4 text-dim">
            접수 피크는 <b className="text-ink">{fleetInsight.reqPeak.hour}시</b>(
            {fmt(fleetInsight.reqPeak.requests)}건)이고 가동 차량 정점은{" "}
            <b className="text-ink">{fleetInsight.occPeak.hour}시</b>(평균{" "}
            {fleetInsight.occPeak.avgActive.toFixed(1)}대)입니다.
            {fleetInsight.reqPeak.hour === fleetInsight.occPeak.hour
              ? " 수요가 몰리는 시간에 차량이 이미 최대로 돌고 있어 추가 요청은 곧바로 대기 큐로 쌓입니다."
              : " 수요 피크와 차량 가동 정점이 어긋나는 구간에서 배차 대기가 길어집니다."}
          </p>
        )}
      </Section>

      <Explainer
        what={
          <>
            <p>
              이 화면은 &ldquo;두리발을 부르면 얼마나 기다리는가&rdquo;를 세
              가지 각도에서 봅니다. 첫째 칸은 공식 지표와 같은 방식, 즉 배차에
              성공한 요청만으로 계산한 대기 중앙값입니다. 둘째 칸은 배차를 받지
              못한 채 끝난 요청까지 포함해 다시 추정한 값(KM 보정)입니다. 그
              아래 곡선은 접수 후 t분이 지났을 때 아직 배차를 못 받았을 확률
              S(t)를 보여줍니다. 이어지는 두 차트는 대기가 어느 구간(배차 큐
              vs 차량 이동)에서, 그리고 어느 시간대에 발생하는지를 분해합니다.
            </p>
          </>
        }
        how={
          <>
            <p>
              생존분석(Kaplan-Meier)이라는 표준 통계 기법을 썼습니다. 병원에서
              &ldquo;치료 후 생존 기간&rdquo;을 추정할 때 아직 살아 있는 환자를
              버리지 않고 &lsquo;최소 이만큼 생존&rsquo;으로 계산에 넣는 것과
              같은 원리입니다. 여기서는 배차받음 = 사건 발생이고, 미배차·취소로
              끝난 요청은 &lsquo;그 시점까지는 확실히 기다렸다&rsquo;는
              관측중단(censored) 정보로 포함됩니다. 대기 구간 분해는 접수→배차,
              배차→승차 두 구간의 시간대별 중앙값(p50)과 상위 10% 경계(p90)를
              따로 계산한 것입니다. 가동 차량 수는 각 시각에 배차→하차 구간이
              겹치는 차량 수를 센 것입니다.
            </p>
          </>
        }
        caveats={
          <>
            <p>
              기존 지표가 틀렸다는 뜻이 아닙니다 — 배차 성공 건 기준 지표는
              그 나름의 쓰임이 있고, KM 추정은 이를 보완하는 지표입니다. 다만
              성공한 요청만 세면 살아남은 사례만 보는 편향(survivorship
              bias)이 생겨 실제 대기 부담이 낮게 보일 수 있습니다. 취소 요청의
              취소 사유는 데이터에 없어서 모두 관측중단으로 처리했는데, 이는
              보수적인(대기를 크게 추정하는 쪽의) 가정입니다. 예약형 접수가
              섞이면 대기 시간이 부풀 수 있어 본선 데이터에서는 즉시콜만
              분리해 재계산할 예정입니다. 수치는 리허설 데이터(2025년 5월, 시
              전역) 기준입니다.
            </p>
          </>
        }
      />
    </div>
  );
}
