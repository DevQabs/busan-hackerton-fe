"use client";

// Evidence charts for the 통계 씬 (ModelsScene) — one small chart per model
// card so every statistical claim is SHOWN, not just stated. All colors come
// from the shared palette; recharts styling mirrors components/charts/theme.

import {
  Bar,
  BarChart,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmt, pct } from "@/lib/format";
import { HEX } from "@/lib/palette";
import {
  CURSOR_FILL,
  TICK,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
} from "./theme";

/* ------------------------------------------------------------------ */
/* 1. retry-funnel — 접수 → 미충족 → 재접수/포기 추정                    */
/* ------------------------------------------------------------------ */

function FunnelRow({
  label,
  value,
  share,
  color,
}: {
  label: string;
  value: number;
  share: number; // 0..1 of the widest bar
  color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-[72px] shrink-0 text-[10.5px] leading-4 text-dim">{label}</div>
      <div className="relative h-[14px] flex-1 rounded-sm bg-line/40">
        <div
          className="h-full rounded-sm"
          style={{
            width: `${Math.max(share * 100, 1)}%`,
            background: color,
            opacity: 0.75,
          }}
        />
      </div>
      <div className="tnum w-[64px] shrink-0 text-right text-[11px] text-ink">
        {fmt(value)}건
      </div>
    </div>
  );
}

export function FunnelBars({
  requests,
  unmet,
  retried,
  abandoned,
}: {
  requests: number;
  unmet: number;
  retried: number;
  abandoned: number;
}) {
  return (
    <div className="space-y-1.5">
      <FunnelRow label="전체 접수" value={requests} share={1} color={HEX.demand} />
      <FunnelRow
        label="미충족"
        value={unmet}
        share={unmet / requests}
        color={HEX.warn}
      />
      <FunnelRow
        label="60분 내 재접수"
        value={retried}
        share={retried / requests}
        color={HEX.infra}
      />
      <FunnelRow
        label="포기 추정"
        value={abandoned}
        share={abandoned / requests}
        color={HEX.unmet}
      />
      {/* zoom strip: the unmet slice split into retried vs abandoned */}
      <div className="mt-2 flex items-center gap-2">
        <div className="w-[72px] shrink-0 text-[10.5px] leading-4 text-dim">
          미충족만 확대
        </div>
        <div className="flex h-[14px] flex-1 overflow-hidden rounded-sm">
          <div
            className="h-full"
            style={{ width: `${(retried / unmet) * 100}%`, background: HEX.infra, opacity: 0.7 }}
          />
          <div
            className="h-full"
            style={{ width: `${(abandoned / unmet) * 100}%`, background: HEX.unmet, opacity: 0.75 }}
          />
        </div>
        <div className="tnum w-[64px] shrink-0 text-right text-[10px] text-dim">
          {pct(abandoned / unmet, 0)} 포기
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. correlation — log-log 산점도 + 회귀선 + 잔차 상위 동 라벨          */
/* ------------------------------------------------------------------ */

export interface CorrPoint {
  x: number; // log10(shops+1)
  y: number; // log10(dropoffs+1)
  name: string;
  gu: string;
  shops: number;
  dropoffs: number;
  top: boolean; // 잔차 상위 동
}

const LOG_TICKS = [0, 1, 2, 3, 4];
const logTickLabel = (v: number) =>
  v === 0 ? "0" : v === 3 ? "1천" : v === 4 ? "1만" : fmt(10 ** v);

export function CorrScatter({
  points,
  slope,
  intercept,
}: {
  points: CorrPoint[];
  slope: number;
  intercept: number;
}) {
  const xMax = Math.max(...points.map((p) => p.x));
  const lineData = [
    { x: 0, ly: intercept },
    { x: xMax, ly: intercept + slope * xMax },
  ];
  const base = points.filter((p) => !p.top);
  const tops = points.filter((p) => p.top);
  return (
    <div>
      <div style={{ height: 190 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 8, right: 10, bottom: 2, left: -18 }}>
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, Math.ceil(xMax)]}
              ticks={LOG_TICKS}
              tickFormatter={logTickLabel}
              tick={TICK}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
              label={{
                value: "상가 수 (로그 눈금)",
                position: "insideBottomRight",
                offset: 8,
                fill: "var(--ink-dim)",
                fontSize: 9,
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[0, 4]}
              ticks={LOG_TICKS.slice(0, 4)}
              tickFormatter={logTickLabel}
              tick={TICK}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={CURSOR_FILL}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
              content={({ payload }) => {
                const p = payload?.[0]?.payload as CorrPoint | undefined;
                if (!p || p.name === undefined) return null;
                return (
                  <div style={TOOLTIP_CONTENT_STYLE}>
                    <div style={TOOLTIP_LABEL_STYLE}>
                      {p.gu} {p.name}
                    </div>
                    <div>상가 {fmt(p.shops)} · 하차 {fmt(p.dropoffs)}건</div>
                  </div>
                );
              }}
            />
            <Scatter data={base} fill={HEX.demand} fillOpacity={0.4} shape="circle" />
            <Scatter data={tops} fill={HEX.unmet} fillOpacity={0.95} shape="circle" />
            <Line
              data={lineData}
              dataKey="ly"
              type="linear"
              stroke={HEX.accent}
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-dim">
        점 = 행정동 206개 · 점선 = 회귀선 ·{" "}
        <b style={{ color: HEX.unmet }}>붉은 점</b> = 회귀선 위로 크게 벗어난
        잔차 상위 동({tops.map((t) => t.name).join("·")}) — 상권과 무관한 특수
        수요지
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. nb-regression — IRR 포레스트 플롯 (log-x, 기준선 IRR=1)            */
/* ------------------------------------------------------------------ */

export interface IrrRow {
  label: string;
  irr: number;
  lo: number;
  hi: number;
  significant: boolean; // CI excludes 1
}

export function IrrForest({ rows }: { rows: IrrRow[] }) {
  const min = Math.min(...rows.map((r) => r.lo), 1) * 0.9;
  const max = Math.max(...rows.map((r) => r.hi), 1) * 1.1;
  const x = (v: number) =>
    ((Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min))) * 100;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          <div className="w-[86px] shrink-0 text-[10.5px] leading-4 text-dim">
            {r.label}
          </div>
          <div className="relative h-[14px] flex-1">
            <div className="absolute inset-y-0 left-0 right-0 my-auto h-[3px] rounded-full bg-line/50" />
            <div
              className="absolute inset-y-0 my-auto h-full w-px bg-dim/60"
              style={{ left: `${x(1)}%` }}
            />
            <div
              className="absolute inset-y-0 my-auto h-[5px] rounded-full"
              style={{
                left: `${x(r.lo)}%`,
                width: `${Math.max(x(r.hi) - x(r.lo), 1.5)}%`,
                background: r.significant ? HEX.accent : "var(--ink-dim)",
                opacity: r.significant ? 0.55 : 0.35,
              }}
            />
            <div
              className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-bg"
              style={{ left: `${x(r.irr)}%`, background: r.significant ? HEX.accent : "var(--ink-dim)" }}
            />
          </div>
          <div
            className="tnum w-[104px] shrink-0 text-right text-[10.5px]"
            style={{ color: r.significant ? "var(--ink)" : "var(--ink-dim)" }}
          >
            ×{r.irr.toFixed(2)} [{r.lo.toFixed(2)}–{r.hi.toFixed(2)}]
          </div>
        </div>
      ))}
      <p className="pt-0.5 text-[10px] leading-4 text-dim">
        세로선 = 효과 없음(×1.0) · 구간이 세로선을 넘지 않으면 통계적으로 유의
        (<span style={{ color: HEX.accent }}>청록</span>) — 유의하지 않은 변수도
        그대로 공개
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 4. chi-square-type-purpose — 유형×목적 히트맵 (평균 대비 배율)         */
/* ------------------------------------------------------------------ */

export function TypePurposeHeat({
  rows,
  purposes,
  counts,
  rowTotals,
  colTotals,
  n,
}: {
  rows: string[];
  purposes: string[];
  counts: number[][];
  rowTotals: number[];
  colTotals: number[];
  n: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th />
            {purposes.map((p) => (
              <th
                key={p}
                className="pb-0.5 text-center text-[9px] font-medium leading-3 text-dim"
              >
                {p === "단체/복지관" ? "복지관" : p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((ty, i) => (
            <tr key={ty}>
              <td className="pr-1 text-right text-[9.5px] leading-3 text-dim">
                {ty}
              </td>
              {purposes.map((pu, j) => {
                const share = counts[i][j] / rowTotals[i];
                const overall = colTotals[j] / n;
                const lift = overall > 0 ? share / overall : 0;
                // lift > 1 → accent(그 유형이 평균보다 그 목적에 몰림), < 1 → dim
                const alpha =
                  lift >= 1
                    ? Math.min(0.85, 0.12 + (lift - 1) * 0.28)
                    : Math.min(0.5, 0.08 + (1 - lift) * 0.25);
                const bg =
                  lift >= 1
                    ? `rgba(34, 211, 238, ${alpha})`
                    : `rgba(71, 85, 105, ${alpha})`;
                return (
                  <td
                    key={pu}
                    className="tnum rounded-[3px] px-0.5 py-[5px] text-center text-[9px] leading-3"
                    style={{
                      background: bg,
                      color: lift >= 1.5 ? "#eafcff" : "var(--ink)",
                    }}
                    title={`${ty} × ${pu}: ${fmt(counts[i][j])}건 (${(share * 100).toFixed(1)}% · 평균 ${(overall * 100).toFixed(1)}%의 ${lift.toFixed(1)}배)`}
                  >
                    {(share * 100).toFixed(share >= 0.1 ? 0 : 1)}%
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] leading-4 text-dim">
        칸 = 해당 유형 내 목적 비중 ·{" "}
        <span style={{ color: HEX.accent }}>진한 청록</span> = 전체 평균 대비
        쏠림(배율↑). 마우스를 올리면 건수·배율 표시
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 5. welch-t — 대기시간 분포 비교 (수동 vs 전동, 그룹 내 비중)           */
/* ------------------------------------------------------------------ */

export function WaitHistCompare({
  bins,
  nManual,
  nElectric,
}: {
  bins: { label: string; manual: number; electric: number }[];
  nManual: number;
  nElectric: number;
}) {
  return (
    <div>
      <div style={{ height: 130 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bins} margin={{ top: 4, right: 0, bottom: 0, left: -60 }} barGap={0}>
            <XAxis
              dataKey="label"
              tick={{ ...TICK, fontSize: 8.5 }}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
              interval={1}
            />
            <YAxis tick={false} tickLine={false} axisLine={false} width={54} />
            <Tooltip
              cursor={CURSOR_FILL}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
              formatter={(v, name) => [
                pct(Number(v)),
                name === "manual" ? "수동휠체어" : "전동휠체어",
              ]}
              labelFormatter={(l) => `대기 ${l}분`}
            />
            <Bar dataKey="manual" fill={HEX.demand} fillOpacity={0.7} maxBarSize={9} radius={[2, 2, 0, 0]} />
            <Bar dataKey="electric" fill={HEX.accent} fillOpacity={0.7} maxBarSize={9} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-dim">
        <span style={{ color: HEX.demand }}>■ 수동</span> n={fmt(nManual)} ·{" "}
        <span style={{ color: HEX.accent }}>■ 전동</span> n={fmt(nElectric)} —
        각 그룹 내 비중이라 표본 크기가 달라도 모양 비교 가능
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 6. chi-square — 시간대 4구간 미배차율 + 전체 평균선                    */
/* ------------------------------------------------------------------ */

export function BandUnmetBar({
  bands,
  overall,
}: {
  bands: { band: string; rate: number; requests: number }[];
  overall: number;
}) {
  const worst = Math.max(...bands.map((b) => b.rate));
  return (
    <div>
      <div style={{ height: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bands} margin={{ top: 6, right: 6, bottom: 0, left: -54 }}>
            <XAxis
              dataKey="band"
              tick={TICK}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
            />
            <YAxis tick={false} tickLine={false} axisLine={false} width={54} />
            <Tooltip
              cursor={CURSOR_FILL}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
              formatter={(v, _name, entry) => [
                `${pct(Number(v))} (접수 ${fmt(entry?.payload?.requests ?? 0)}건)`,
                "미배차율",
              ]}
            />
            <ReferenceLine
              y={overall}
              stroke="var(--ink-dim)"
              strokeDasharray="4 3"
              label={{
                value: `평균 ${pct(overall)}`,
                position: "insideTopRight",
                fill: "var(--ink-dim)",
                fontSize: 9,
              }}
            />
            <Bar dataKey="rate" radius={[3, 3, 0, 0]} maxBarSize={34}>
              {bands.map((b) => (
                <Cell
                  key={b.band}
                  fill={b.rate === worst ? HEX.unmet : HEX.demand}
                  fillOpacity={b.rate === worst ? 0.9 : 0.55}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 7. bootstrap-stability — 상위 동 gapScore 90% CI 막대                */
/* ------------------------------------------------------------------ */

export interface GapCiRow {
  name: string;
  gu: string;
  gap: number;
  ci: [number, number] | null;
  pTop5: number | null;
}

export function GapCiTop({ rows }: { rows: GapCiRow[] }) {
  const min = Math.min(...rows.map((r) => (r.ci ? r.ci[0] : r.gap)));
  const max = Math.max(...rows.map((r) => (r.ci ? r.ci[1] : r.gap)));
  const span = max - min || 1;
  const x = (v: number) => Math.min(Math.max(((v - min) / span) * 100, 0), 100);
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={r.name + r.gu} className="flex items-center gap-2">
          <div className="w-[92px] shrink-0 truncate text-[10.5px] leading-4 text-dim">
            <span className="tnum text-ink/70">{i + 1}.</span> {r.name}
          </div>
          <div className="relative h-[12px] flex-1 rounded-full bg-line/40">
            {r.ci && (
              <div
                className="absolute top-0 h-full rounded-full bg-accent/35"
                style={{
                  left: `${x(r.ci[0])}%`,
                  width: `${Math.max(x(r.ci[1]) - x(r.ci[0]), 1.5)}%`,
                }}
              />
            )}
            <div
              className="absolute top-1/2 h-[8px] w-[8px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
              style={{ left: `${x(r.gap)}%` }}
            />
          </div>
          <div
            className={`tnum w-[70px] shrink-0 text-right text-[10px] ${
              (r.pTop5 ?? 0) >= 0.7 ? "font-semibold text-ink" : "text-dim"
            }`}
          >
            P(top5) {(r.pTop5 ?? 0) >= 0.995 ? "100" : (((r.pTop5 ?? 0) * 100).toFixed(0))}%
          </div>
        </div>
      ))}
      <p className="pt-0.5 text-[10px] leading-4 text-dim">
        막대 = gapScore 90% 신뢰구간(날짜 재표집 500회) · P(top5) = 재표집에서
        상위 5위 안에 든 비율 — 구간이 겹치지 않는 최상위권은 순위가 안정적
      </p>
    </div>
  );
}
