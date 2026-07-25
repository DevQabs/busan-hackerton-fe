"use client";

// 통계 분석 — 진단의 근거. 탭 3개(미배차 통계 / 인프라 순효과 / 침묵 지역)로
// 각 통계를 하나씩 보여준다. 프론트 통계 재계산 없음 — analysis/·pipeline/
// 산출 JSON을 읽어 렌더만 한다 (IRR 적용 시뮬레이션은 명시된 근사).

import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { GeoJsonLayer } from "deck.gl";
import type { Layer } from "@deck.gl/core";
import {
  Bar,
  BarChart,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useData } from "@/lib/useData";
import { DATA, type DongProps, type ModelResult } from "@/lib/types";
import {
  DATA_DONG_COMPARE,
  type DongCompare,
} from "@/lib/typesDongCompare";
import {
  DATA_HAEUNDAE_DISPATCH,
  DATA_HOSPITAL_DISTANCE,
  type DispatchHourly,
  type DispatchMonthly,
  type HaeundaeDispatch,
  type HospitalDistance,
  type HospitalDistanceDong,
} from "@/lib/typesEvidence";
import {
  tooltipHtml,
  type DongCollection,
  type MapSpec,
} from "@/lib/mapspec";
import { IrrForest, type IrrRow } from "@/components/charts/ModelEvidence";
import {
  CURSOR_FILL,
  TICK,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
} from "@/components/charts/theme";
import { Chip, KpiTile } from "@/components/PresentationLayoutWide";
import { DataPending } from "@/components/ui/DataPending";
import { fmt, pct } from "@/lib/format";
import { HEX, RGB_UNMET } from "@/lib/palette";

/* ------------------------------------------------------------------ */
/* numbers(Record<string, number|string>) 안전 렌더 유틸               */
/* ------------------------------------------------------------------ */

type Nums = Record<string, number | string> | undefined;

function num(nums: Nums, key: string): number | null {
  const v = nums?.[key];
  return typeof v === "number" ? v : null;
}

function numFmt(nums: Nums, key: string, digits = 0): string {
  const v = num(nums, key);
  if (v === null) return "—";
  return digits > 0 ? v.toFixed(digits) : fmt(v);
}

/** p값은 숫자(0.0002)와 문자열("<0.0001")이 섞여 있다 — 그대로 표기한다. */
function pLabel(nums: Nums, key: string): string | undefined {
  const v = nums?.[key];
  if (typeof v === "number") return `p=${v}`;
  if (typeof v === "string") return v.startsWith("<") ? `p${v}` : `p=${v}`;
  return undefined;
}

/** '반여제1동' → '반여1동' — dong_compare·geojson 이름 조인 키 */
const canon = (s: string) => s.replace("제", "");

/* ------------------------------------------------------------------ */
/* 로컬 UI 헬퍼                                                        */
/* ------------------------------------------------------------------ */

/** 탭 블록 셸 — 상단 KPI 밴드(선택) + 차트(좌) : 해석(우) = 3:2. */
function BlockShell({
  title,
  badge,
  kpis,
  chart,
  panel,
}: {
  title: string;
  badge?: ReactNode;
  kpis?: ReactNode;
  chart: ReactNode;
  panel: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-panel">
      <header className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2.5">
        <h2 className="text-[13px] font-bold leading-5 text-ink">{title}</h2>
        {badge}
      </header>
      {kpis && (
        <div className="grid grid-flow-col auto-cols-fr gap-2 border-b border-line px-3 py-2.5">
          {kpis}
        </div>
      )}
      <div className="grid grid-cols-[3fr_2fr] gap-3 p-3">
        <div className="min-w-0">{chart}</div>
        <div className="min-w-0">{panel}</div>
      </div>
    </section>
  );
}

/** 해석 패널 3단(어떻게 계산했나 / 결과 수치 / 그래서) + caveats 각주.
 *  policy를 주면 '그래서' 박스 안에 정책 제안(소관·실행·근거 수치)을 잇는다. */
function ExplainPanel({
  how,
  result,
  so,
  policy,
  caveats,
}: {
  how: string;
  result: ReactNode;
  so: string;
  policy?: { owner: string; action: string; impact: string };
  caveats?: string;
}) {
  return (
    <div className="flex h-full flex-col gap-2.5 rounded-lg border border-line bg-[#0e1424]/40 p-3">
      <div>
        <div className="text-[10px] font-semibold leading-4 text-dim">
          어떻게 계산했나
        </div>
        <p className="mt-0.5 text-[11.5px] leading-5 text-ink/90">{how}</p>
      </div>
      <div>
        <div className="text-[10px] font-semibold leading-4 text-dim">
          결과 수치
        </div>
        <div className="mt-0.5">{result}</div>
      </div>
      <div className="rounded bg-[#0e1424] px-2.5 py-2">
        <p className="text-[11.5px] leading-5 text-ink/90">
          💡 <b className="text-accent">그래서 · </b>
          {so}
        </p>
        {policy && (
          <div className="mt-1.5 border-t border-line/60 pt-1.5">
            <p className="text-[12px] font-bold leading-5 text-ink">
              {policy.action}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] leading-4 text-dim">
              <span className="rounded border border-line bg-panel px-1.5 py-px text-ink/80">
                소관 {policy.owner}
              </span>
              <span className="tnum">{policy.impact}</span>
            </p>
          </div>
        )}
      </div>
      {caveats && (
        <p className="mt-auto border-t border-line pt-1.5 text-[10px] leading-4 text-dim">
          주의: {caveats}
        </p>
      )}
    </div>
  );
}

/** 큰 숫자 + 부가 설명 — CI/p값은 숨기지 않고 본문 크기로 병기한다. */
function BigNum({
  value,
  unit,
  sub,
}: {
  value: string;
  unit?: string;
  sub?: string;
}) {
  return (
    <div>
      <span className="tnum text-[22px] font-bold leading-7 text-ink">
        {value}
      </span>
      {unit && <span className="ml-0.5 text-[12px] text-dim">{unit}</span>}
      {sub && <span className="ml-2 text-[11px] text-dim">{sub}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 탭1 차트 — 시간대별 운행대수 / 미배차율 (같은 x축, 위아래 정렬)       */
/* ------------------------------------------------------------------ */

/** 미배차율 표시 최소 표본 — 이보다 적은 시간대는 비율이 튀어 오독을 부른다 */
const MIN_HOUR_SAMPLE = 100;

function DispatchHourlyCharts({
  rows,
  avgRate,
}: {
  rows: DispatchHourly[];
  avgRate: number; // 전체 미배차율 0–1
}) {
  const data = rows.map((h) => ({
    ...h,
    avgActive: Math.round(h.avgActive),
    rate:
      h.requests >= MIN_HOUR_SAMPLE
        ? +(h.unassignedRate * 100).toFixed(1)
        : null,
  }));
  const hidden = rows
    .filter((h) => h.requests < MIN_HOUR_SAMPLE)
    .map((h) => `${h.hour}시`);
  return (
    <div>
      <div className="text-[10px] font-semibold leading-4 text-dim">
        시간대별 운행대수 — 동시 진행 운행 건수(일 평균 추정)
      </div>
      <div style={{ height: 175 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} syncId="disp" margin={{ top: 6, right: 8, bottom: 0, left: -22 }}>
            <XAxis
              dataKey="hour"
              tick={TICK}
              tickFormatter={(h: number) => `${h}시`}
              interval={2}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
            />
            <YAxis tick={TICK} tickLine={false} axisLine={false} />
            <Tooltip
              cursor={CURSOR_FILL}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
              labelFormatter={(h) => `${h}시`}
              formatter={(v: number, _n, item) => [
                `평균 ${fmt(v)}건 (최대 ${item?.payload?.maxActive ?? "—"}건)`,
                "동시 운행",
              ]}
            />
            <Bar dataKey="avgActive" fill={HEX.demand} fillOpacity={0.8} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1.5 text-[10px] font-semibold leading-4 text-dim">
        시간대별 미배차율 — 점선 = 전체 평균 {pct(avgRate, 1)}
      </div>
      <div style={{ height: 175 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} syncId="disp" margin={{ top: 6, right: 8, bottom: 0, left: -22 }}>
            <XAxis
              dataKey="hour"
              tick={TICK}
              tickFormatter={(h: number) => `${h}시`}
              interval={2}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
            />
            <YAxis
              tick={TICK}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              cursor={CURSOR_FILL}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
              labelFormatter={(h) => `${h}시`}
              formatter={(v: number, _n, item) => [
                `${v}% (접수 ${fmt(item?.payload?.requests ?? 0)}건 중 ${fmt(item?.payload?.unassigned ?? 0)}건)`,
                "미배차율",
              ]}
            />
            <ReferenceLine
              y={+(avgRate * 100).toFixed(1)}
              stroke="var(--ink-dim)"
              strokeDasharray="4 3"
            />
            <Line
              dataKey="rate"
              type="monotone"
              stroke={HEX.unmet}
              strokeWidth={2}
              dot={{ r: 2, strokeWidth: 0, fill: HEX.unmet }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-dim">
        위·아래 같은 시간축 — 저녁(17시 이후) 운행이 급감하는 구간에서
        미배차율이 평균을 크게 웃돈다
        {hidden.length > 0 &&
          ` · 표본 ${MIN_HOUR_SAMPLE}건 미만인 ${hidden.join("·")}는 비율이 튀어 미배차율을 표시하지 않음`}
      </p>
    </div>
  );
}

/** 월별 미배차율 — 특정 달의 문제가 아니라 1년 내내 이어지는 구조임을 보인다 */
function MonthlyRateChart({ rows }: { rows: DispatchMonthly[] }) {
  const data = rows.map((m) => ({
    ...m,
    label: `${m.ym.slice(2, 4)}.${m.ym.slice(5)}`, // "25.03"
    rate: +(m.unassignedRate * 100).toFixed(1),
  }));
  return (
    <div className="mt-2">
      <div className="text-[10px] font-semibold leading-4 text-dim">
        월별 미배차율 (2025-03 ~ 2026-03) — 특정 달의 문제가 아니다
      </div>
      <div style={{ height: 135 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -22 }}>
            <XAxis
              dataKey="label"
              tick={{ ...TICK, fontSize: 9 }}
              interval={1}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
            />
            <YAxis
              tick={TICK}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              cursor={CURSOR_FILL}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
              formatter={(v: number, _n, item) => [
                `${v}% (접수 ${fmt(item?.payload?.requests ?? 0)}건 중 ${fmt(item?.payload?.unassigned ?? 0)}건)`,
                "미배차율",
              ]}
            />
            <Bar dataKey="rate" fill={HEX.warn} fillOpacity={0.7} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 탭3 차트 — 병원행 거리 × 병원행 비중 산점 + 거리 구간별 미배차율      */
/* ------------------------------------------------------------------ */

const OUTER_KM = 10; // '외곽' 표시 기준: 병원행 평균 직선거리 10km 이상

function HospScatter({
  dongs,
  corr,
}: {
  dongs: HospitalDistanceDong[];
  corr: HospitalDistance["corr"];
}) {
  const pts = dongs.map((d) => ({
    x: d.meanHospKm,
    y: +(d.hospShare * 100).toFixed(1),
    name: d.name,
    gu: d.gu,
    outer: d.meanHospKm >= OUTER_KM,
  }));
  const xMax = Math.ceil(Math.max(...pts.map((p) => p.x)) + 1);
  const lineData = [
    { x: 0, ly: corr.intercept },
    { x: xMax, ly: corr.intercept + corr.slope * xMax },
  ];
  const inner = pts.filter((p) => !p.outer);
  const outer = pts.filter((p) => p.outer);
  return (
    <div>
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 8, right: 10, bottom: 2, left: -18 }}>
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, xMax]}
              tick={TICK}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
              tickFormatter={(v: number) => `${v}km`}
              label={{
                value: "병원행 평균 직선거리",
                position: "insideBottomRight",
                offset: 8,
                fill: "var(--ink-dim)",
                fontSize: 9,
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              tick={TICK}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              cursor={CURSOR_FILL}
              content={({ payload }) => {
                const p = payload?.[0]?.payload as (typeof pts)[number] | undefined;
                if (!p || p.name === undefined) return null;
                return (
                  <div style={TOOLTIP_CONTENT_STYLE}>
                    <div style={TOOLTIP_LABEL_STYLE}>
                      {p.gu} {p.name}
                    </div>
                    <div>
                      병원행 평균 {p.x}km · 병원행 비중 {p.y}%
                    </div>
                  </div>
                );
              }}
            />
            <Scatter data={inner} fill={HEX.demand} fillOpacity={0.4} shape="circle" />
            <Scatter data={outer} fill={HEX.unmet} fillOpacity={0.95} shape="circle" />
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
        점 = 출발 행정동 {corr.n}곳 · 점선 = 회귀선(r={corr.pearsonR} — 사실상
        수평) · <b style={{ color: HEX.unmet }}>붉은 점</b> = 병원행 평균{" "}
        {OUTER_KM}km 이상 외곽 동
      </p>
    </div>
  );
}

function DistanceBins({ hd }: { hd: HospitalDistance }) {
  const maxRate = Math.max(...hd.bins.map((b) => b.unassignedRate), 0.001);
  return (
    <div className="mt-3">
      <div className="text-[10px] font-semibold leading-4 text-dim">
        직선거리 구간별 병원행 미배차율 — 거리가 멀어도 오르지 않는다
      </div>
      <div className="mt-1.5 space-y-1.5">
        {hd.bins.map((b) => (
          <div key={b.label} className="flex items-center gap-2">
            <div className="w-[56px] shrink-0 text-[10.5px] leading-4 text-dim">
              {b.label}
            </div>
            <div className="relative h-[14px] flex-1 rounded-sm bg-line/40">
              <div
                className="h-full rounded-sm"
                style={{
                  width: `${(b.unassignedRate / maxRate) * 100}%`,
                  background: HEX.unmet,
                  opacity: 0.7,
                }}
              />
            </div>
            <div className="tnum w-[104px] shrink-0 text-right text-[11px] text-ink">
              {pct(b.unassignedRate, 1)}{" "}
              <span className="text-[9.5px] text-dim">({fmt(b.trips)}건)</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 씬 본체                                                             */
/* ------------------------------------------------------------------ */

type Tab = "dispatch" | "infra" | "silent";

const TABS: { key: Tab; label: string; caption: string }[] = [
  { key: "dispatch", label: "① 미배차 통계", caption: "시간대별 운행 · 미배차" },
  { key: "infra", label: "② 인프라 순효과", caption: "시설 +1의 기대 효과" },
  { key: "silent", label: "③ 침묵 지역", caption: "병원까지의 거리 검정" },
];

type Facility = "charger" | "welfare";

const FAC_DEF: Record<
  Facility,
  { label: string; irrKey: string; color: string; countSrc: string }
> = {
  charger: { label: "충전소", irrKey: "chargers", color: HEX.accent, countSrc: "시설 수" },
  welfare: { label: "복지시설", irrKey: "welfare", color: HEX.infra, countSrc: "전역 POI 수" },
};

export function StatisticalEvidenceScene({
  onMapSpec,
  map,
}: {
  onMapSpec: (spec: MapSpec) => void;
  map: ReactNode;
}) {
  const models = useData<ModelResult[]>(DATA.modelResults);
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);
  const compare = useData<DongCompare>(DATA_DONG_COMPARE);
  const disp = useData<HaeundaeDispatch>(DATA_HAEUNDAE_DISPATCH);
  const hosp = useData<HospitalDistance>(DATA_HOSPITAL_DISTANCE);

  const [tab, setTab] = useState<Tab>("dispatch");
  const [facility, setFacility] = useState<Facility>("charger");

  const byId = useMemo(
    () => new Map((models.data ?? []).map((m) => [m.id, m])),
    [models.data],
  );
  const funnel = byId.get("retry-funnel");
  const nb = byId.get("nb-regression");

  const cmpBy = useMemo(
    () => new Map((compare.data?.dongs ?? []).map((e) => [e.name, e])),
    [compare.data],
  );

  /* ── 탭1: 피크 미배차 시간(표본 100건 이상 시간대만) ─────────────── */
  const peakHour = useMemo(() => {
    const rows = (disp.data?.hourly ?? []).filter((h) => h.requests >= 100);
    if (rows.length === 0) return null;
    return rows.reduce((a, b) => (b.unassignedRate > a.unassignedRate ? b : a));
  }, [disp.data]);

  const avgRate = disp.data
    ? disp.data.totals.unassigned / disp.data.totals.requests
    : 0;

  /* ── 탭2: 포레스트 행 (CI 위치 판독 — 재계산 아님) ────────────────── */
  const irrRows = useMemo<IrrRow[] | null>(() => {
    const n = nb?.numbers;
    if (!n) return null;
    const row = (key: string, label: string, color?: string): IrrRow | null => {
      const irr = num(n, `irr_${key}`);
      const lo = num(n, `irr_${key}_lo`);
      const hi = num(n, `irr_${key}_hi`);
      if (irr === null || lo === null || hi === null) return null;
      return {
        label,
        irr,
        lo,
        hi,
        significant: lo > 1 || hi < 1,
        p: pLabel(n, `p_${key}`),
        color,
      };
    };
    return [
      row("chargers", "충전소 +1기"),
      row("welfare", "복지시설 +1곳", HEX.infra),
    ].filter((r): r is IrrRow => r !== null);
  }, [nb]);

  /* ── 탭2: 시설 부족 동 × IRR 적용 근사 (명시된 클라이언트 근사) ───── */
  const hwGeoBy = useMemo(() => {
    const out = new Map<string, DongProps>();
    for (const f of dongs.data?.features ?? [])
      if (f.properties.gu === "해운대구")
        out.set(canon(f.properties.name), f.properties);
    return out;
  }, [dongs.data]);

  const simRows = useMemo(() => {
    const n = nb?.numbers;
    if (!compare.data || !n) return null;
    const def = FAC_DEF[facility];
    const irr = num(n, `irr_${def.irrKey}`);
    const lo = num(n, `irr_${def.irrKey}_lo`);
    const hi = num(n, `irr_${def.irrKey}_hi`);
    if (irr === null || lo === null || hi === null) return null;
    const rows = compare.data.dongs
      .map((e) => {
        const g = hwGeoBy.get(e.name);
        const cnt = facility === "charger" ? e.fac.charger : (g?.welfare ?? 0);
        const monthly = e.completed / 13; // 13개월 합 → 월평균 (표기용 나눗셈)
        return {
          name: e.name,
          cnt,
          monthly,
          gain: monthly * (irr - 1),
          gainLo: monthly * (lo - 1),
          gainHi: monthly * (hi - 1),
        };
      })
      .sort((a, b) => a.cnt - b.cnt || b.monthly - a.monthly);
    const zero = rows.filter((r) => r.cnt === 0);
    return {
      irr,
      lo,
      hi,
      p: pLabel(n, `p_${def.irrKey}`),
      rows,
      zeroCount: zero.length,
      zeroSum: zero.reduce((s, r) => s + r.gain, 0),
      zeroSumLo: zero.reduce((s, r) => s + r.gainLo, 0),
      zeroSumHi: zero.reduce((s, r) => s + r.gainHi, 0),
    };
  }, [compare.data, nb, facility, hwGeoBy]);

  /* ── 탭3: 지도 — 동별 병원행 평균 직선거리 choropleth ─────────────── */
  const hospByKey = useMemo(() => {
    const out = new Map<string, HospitalDistanceDong>();
    for (const d of hosp.data?.dongs ?? []) out.set(`${d.gu}|${d.name}`, d);
    return out;
  }, [hosp.data]);

  const maxKm = useMemo(
    () => Math.max(1, ...(hosp.data?.dongs ?? []).map((d) => d.meanHospKm)),
    [hosp.data],
  );

  const layers = useMemo<Layer[]>(() => {
    if (!dongs.data || hospByKey.size === 0) return [];
    return [
      new GeoJsonLayer<DongProps>({
        id: "se-hosp-km",
        data: dongs.data as never,
        stroked: true,
        filled: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 40],
        getLineColor: [35, 43, 61, 160],
        getLineWidth: 1,
        lineWidthUnits: "pixels",
        getFillColor: (f) => {
          const p = f.properties;
          const d = hospByKey.get(`${p.gu}|${p.name}`);
          if (!d) return [20, 26, 40, 120]; // 표본 부족(접수 30건 미만) 동
          const heat = d.meanHospKm / maxKm;
          return [...RGB_UNMET, Math.round(30 + heat * 195)];
        },
        updateTriggers: { getFillColor: [hospByKey, maxKm] },
      }),
    ];
  }, [dongs.data, hospByKey, maxKm]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      const p = (info.object as { properties?: DongProps } | undefined)
        ?.properties;
      if (!p) return null;
      const d = hospByKey.get(`${p.gu}|${p.name}`);
      if (!d) return tooltipHtml(`<b>${p.gu} ${p.name}</b><br/>표본 부족(접수 30건 미만)`);
      return tooltipHtml(
        `<b>${d.gu} ${d.name}</b><br/>` +
          `병원행 평균 ${d.meanHospKm}km · 병원행 비중 ${pct(d.hospShare, 1)}<br/>` +
          `병원행 미배차 ${pct(d.failRate, 1)} (병원행 ${fmt(d.hospTrips)}건)`,
      );
    };
  }, [hospByKey]);

  // 침묵 지역 탭에서만 지도 레이어를 올린다
  useEffect(() => {
    onMapSpec(tab === "silent" ? { layers, getTooltip } : { layers: [] });
  }, [tab, layers, getTooltip, onMapSpec]);

  /* ── 제안 밴드 수치 — 찾아 읽기만 ────────────────────────────────── */
  const u3 = cmpBy.get("우3동");
  const by1 = cmpBy.get("반여1동");
  const j4 = cmpBy.get("좌4동");

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 고정 헤더 + 탭 */}
      <header className="shrink-0 border-b border-line bg-panel/60 px-4 pt-3">
        <h1 className="text-[17px] font-bold leading-6 text-ink">
          통계 분석 — 진단의 근거
        </h1>
        <p className="mt-0.5 text-[11px] leading-4 text-dim">
          해운대 상세에서 눈으로 본 어긋남을 세 가지 통계로 검증하고, 제안으로
          연결합니다
        </p>
        <nav className="mt-2.5 flex gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={`rounded-t-md border border-b-0 px-3 py-1.5 text-left transition-colors ${
                tab === t.key
                  ? "border-line bg-bg text-ink"
                  : "border-transparent bg-transparent text-dim hover:text-ink"
              }`}
            >
              <span className="block text-[12px] font-bold leading-4">
                {t.label}
              </span>
              <span className="block text-[9.5px] leading-3.5 text-dim">
                {t.caption}
              </span>
            </button>
          ))}
        </nav>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {/* ══ 탭1 — 미배차 통계 (본선 해운대) ══════════════════════════ */}
        {tab === "dispatch" && (
          <BlockShell
            title="미배차 통계 — 시간대별 운행대수와 미배차 확률"
            kpis={
              disp.data && (
                <>
                  <KpiTile
                    label="접수 (13개월)"
                    value={fmt(disp.data.totals.requests)}
                    sub="해운대 전수"
                    color={HEX.demand}
                  />
                  <KpiTile
                    label="미배차"
                    value={fmt(disp.data.totals.unassigned)}
                    sub={`접수의 ${pct(avgRate, 1)}`}
                    color={HEX.unmet}
                  />
                  <KpiTile
                    label="완료(하차)"
                    value={fmt(disp.data.totals.completed)}
                    sub="배차 후 탑승·도착"
                    color={HEX.infra}
                  />
                  <KpiTile
                    label="취소"
                    value={fmt(disp.data.totals.cancelled)}
                    sub="미배차와 일부 겹침"
                    color={HEX.warn}
                  />
                  {peakHour && (
                    <KpiTile
                      label="최악 시간대"
                      value={`${peakHour.hour}시 ${pct(peakHour.unassignedRate, 0)}`}
                      sub={`평균의 ${(peakHour.unassignedRate / avgRate).toFixed(1)}배`}
                      color={HEX.unmet}
                    />
                  )}
                </>
              )
            }
            chart={
              disp.data ? (
                <div>
                  <DispatchHourlyCharts rows={disp.data.hourly} avgRate={avgRate} />
                  <MonthlyRateChart rows={disp.data.monthly} />
                </div>
              ) : (
                <DataPending note="haeundae_dispatch.json 대기 중 — analysis/build_dispatch_hourly.py 실행" />
              )
            }
            panel={
              <ExplainPanel
                how="해운대 13개월 접수 43,891건을 접수 시각 기준 24개 시간대로 집계했습니다. 미배차 = 배차 자체가 되지 않은 접수, 운행대수 = 배차~하차가 동시에 진행 중인 건수(차량 ID가 없어 하한 추정)."
                result={
                  disp.data ? (
                    <div>
                      {peakHour && (
                        <BigNum
                          value={pct(peakHour.unassignedRate, 1)}
                          sub={`${peakHour.hour}시 미배차율 — 전체 평균 ${pct(avgRate, 1)}의 ${(peakHour.unassignedRate / avgRate).toFixed(1)}배`}
                        />
                      )}
                      <p className="tnum mt-0.5 text-[11px] leading-4 text-ink/85">
                        미배차 {fmt(disp.data.totals.unassigned)}건 / 접수{" "}
                        {fmt(disp.data.totals.requests)}건 · 저녁 17시 26.0% ·
                        21~22시 34~41%
                      </p>
                      <p className="mt-1 text-[10.5px] leading-4 text-dim">
                        낮 피크(9시) 평균 동시 운행 9건 → 21시 0건 수준으로
                        급감 — 운행이 꺼지는 시간대에 미배차가 몰린다
                      </p>
                      <p className="mt-1 text-[10.5px] leading-4 text-dim">
                        월별 미배차율{" "}
                        {pct(Math.min(...disp.data.monthly.map((m) => m.unassignedRate)), 1)}
                        ~
                        {pct(Math.max(...disp.data.monthly.map((m) => m.unassignedRate)), 1)}{" "}
                        — 특정 달의 사고가 아니라 13개월 내내 이어지는 구조다
                      </p>
                    </div>
                  ) : (
                    <span className="text-[11px] text-dim">데이터 준비 중</span>
                  )
                }
                so="접수는 남아 있는데 차가 먼저 사라진다 — 저녁 시간대 운행 재배치의 근거."
                policy={{
                  owner: "부산시설공단",
                  action: "운행이 꺼지는 저녁 시간대 증차·교대 조정",
                  impact: `21시 미배차 ${peakHour ? pct(peakHour.unassignedRate, 1) : "—"} · 미배차 ${disp.data ? fmt(disp.data.totals.unassigned) : "—"}건/13개월`,
                }}
                caveats={disp.data?.meta.note}
              />
            }
          />
        )}

        {/* ══ 탭2 — 인프라 순효과 ══════════════════════════════════════ */}
        {tab === "infra" && (
          <BlockShell
            title="인프라 순효과 — 시설이 1개 늘면 방문이 얼마나 느는가"
            kpis={
              simRows && (
                <>
                  <KpiTile
                    label={`${FAC_DEF[facility].label} IRR`}
                    value={`×${simRows.irr.toFixed(2)}`}
                    sub={simRows.p ?? "시설 1개당 방문 배율"}
                    color={FAC_DEF[facility].color}
                  />
                  <KpiTile
                    label={`${FAC_DEF[facility].label} 0개 동`}
                    value={`${simRows.zeroCount}곳`}
                    sub="해운대 18개 동 중"
                    color={HEX.unmet}
                  />
                  <KpiTile
                    label="0개 동 모두 +1이면"
                    value={`+${fmt(simRows.zeroSum)}건/월`}
                    sub={`범위 ${fmt(simRows.zeroSumLo)}~${fmt(simRows.zeroSumHi)}건 · 명시된 근사`}
                    color={FAC_DEF[facility].color}
                  />
                </>
              )
            }
            chart={
              irrRows && irrRows.length > 0 ? (
                <div>
                  <IrrForest rows={irrRows} />
                  <div className="mt-3 flex items-center gap-1.5">
                    {(Object.keys(FAC_DEF) as Facility[]).map((f) => (
                      <Chip
                        key={f}
                        active={facility === f}
                        onClick={() => setFacility(f)}
                        color={FAC_DEF[f].color}
                      >
                        {FAC_DEF[f].label}
                      </Chip>
                    ))}
                    <span className="ml-1 text-[10px] leading-4 text-dim">
                      {FAC_DEF[facility].label}이 적은 해운대 동부터
                    </span>
                  </div>
                  {simRows && (
                    <div className="mt-2 overflow-hidden rounded-lg border border-line">
                      <div className="grid grid-cols-[1fr_72px_88px_1fr] gap-2 border-b border-line bg-[#0e1424] px-2.5 py-1.5 text-[9.5px] font-semibold text-dim">
                        <span>동 (해운대 18개 전체 · 시설 적은 순)</span>
                        <span className="text-right">{FAC_DEF[facility].label}</span>
                        <span className="text-right">월평균 도착</span>
                        <span className="text-right">+1 기대 증가 (95% CI)</span>
                      </div>
                      <div className="max-h-[430px] overflow-y-auto">
                        {simRows.rows.map((r) => (
                          <div
                            key={r.name}
                            className="grid grid-cols-[1fr_72px_88px_1fr] gap-2 border-b border-line/50 px-2.5 py-1 text-[11px] last:border-b-0"
                          >
                            <span className="text-ink/90">{r.name}</span>
                            <span
                              className="tnum text-right"
                              style={{
                                color: r.cnt === 0 ? HEX.unmet : "var(--ink)",
                              }}
                            >
                              {r.cnt === 0 ? "0 (없음)" : fmt(r.cnt)}
                            </span>
                            <span className="tnum text-right text-ink/85">
                              {fmt(r.monthly)}건
                            </span>
                            <span
                              className="tnum text-right"
                              style={{
                                color:
                                  simRows.irr > 1 ? FAC_DEF[facility].color : "var(--ink-dim)",
                              }}
                            >
                              {r.gain >= 0 ? "+" : ""}
                              {r.gain.toFixed(1)}건/월 ({r.gainLo.toFixed(1)}~
                              {r.gainHi.toFixed(1)})
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-line bg-[#0e1424] px-2.5 py-1.5 text-[10.5px] leading-4">
                        <span className="text-dim">
                          {FAC_DEF[facility].label} 0개 동 {simRows.zeroCount}곳에
                          +1씩 보강하면{" "}
                        </span>
                        <b
                          className="tnum"
                          style={{ color: FAC_DEF[facility].color }}
                        >
                          월 +{fmt(simRows.zeroSum)}건
                        </b>
                        <span className="tnum text-dim">
                          {" "}
                          (범위 {fmt(simRows.zeroSumLo)}~{fmt(simRows.zeroSumHi)}건)
                          기대
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <DataPending note="model_results.json 대기 중 — nb-regression" />
              )
            }
            panel={
              <ExplainPanel
                how="큰 동네는 원래 이용이 많으므로 규모 효과를 걷어낸 뒤(음이항 회귀·오프셋) 시설 1개당 방문 배율(IRR)을 추정하고, 그 배율을 각 동의 실제 월평균 도착 건수에 적용해 '+1개의 기대 효과'를 계산했습니다."
                result={
                  nb?.numbers && simRows ? (
                    <div>
                      <BigNum
                        value={`×${simRows.irr.toFixed(2)}`}
                        sub={`${FAC_DEF[facility].label} 1개당 방문 배율`}
                      />
                      <p className="tnum mt-0.5 text-[11px] leading-4 text-ink/85">
                        95% CI {simRows.lo.toFixed(3)}–{simRows.hi.toFixed(3)}
                        {simRows.p ? ` · ${simRows.p}` : ""}
                      </p>
                      <p className="mt-1 text-[10.5px] leading-4 text-dim">
                        {FAC_DEF[facility].label} 0개 동 {simRows.zeroCount}곳
                        모두 +1이면 월 +{fmt(simRows.zeroSum)}건 기대 — 시설이
                        없는 동일수록 +1의 상대 효과가 크다.
                      </p>
                    </div>
                  ) : (
                    <span className="text-[11px] text-dim">데이터 준비 중</span>
                  )
                }
                so="시설이 0~1개인 동(수요는 있는데 인프라가 빈 곳)부터 충전소·복지시설을 보강하는 우선순위의 근거."
                policy={{
                  owner: "지자체·구청",
                  action: "충전소 0개 동부터 +1 보강 (격차 동 우선)",
                  impact: `충전소 IRR ×${numFmt(nb?.numbers, "irr_chargers", 2)} · 우3동 ${u3 ? u3.gapPp.toFixed(1) : "—"}%p · 반여1동 ${by1 ? by1.gapPp.toFixed(1) : "—"}%p`,
                }}
                caveats={
                  (nb?.caveats ? `${nb.caveats} ` : "") +
                  "표의 '+1 기대 증가'는 IRR × 월평균 도착의 명시적 근사 — 관찰 데이터라 인과 단정 불가."
                }
              />
            }
          />
        )}

        {/* ══ 탭3 — 침묵 지역: 병원까지의 거리 검정 ════════════════════ */}
        {tab === "silent" && (
          <BlockShell
            title="침묵 지역 — 외곽은 병원이 멀어서 안 타는가?"
            chart={
              hosp.data ? (
                <div>
                  <HospScatter dongs={hosp.data.dongs} corr={hosp.data.corr} />
                  <DistanceBins hd={hosp.data} />
                  <div className="mt-3">
                    <div className="mb-1.5 text-[10px] font-semibold leading-4 text-dim">
                      동별 병원행 평균 직선거리 — 진할수록 멀다 (회색 = 표본
                      부족)
                    </div>
                    <div className="relative h-[320px] overflow-hidden rounded-lg border border-line">
                      {map}
                    </div>
                  </div>
                </div>
              ) : (
                <DataPending note="hospital_distance.json 대기 중 — analysis/build_hospital_distance.py 실행" />
              )
            }
            panel={
              <ExplainPanel
                how="목적이 '병원'인 통행 6,351건을 골라 ① 출발→병원 직선거리 구간별 미배차율 ② 동별 '병원행 평균거리 × 병원행 비중'의 상관을 검정했습니다."
                result={
                  hosp.data ? (
                    <div>
                      <BigNum
                        value={`r = ${hosp.data.corr.pearsonR}`}
                        sub={`거리 × 병원행 비중 상관 (동 ${hosp.data.corr.n}곳) — 사실상 0`}
                      />
                      <p className="tnum mt-0.5 text-[11px] leading-4 text-ink/85">
                        거리 구간별 미배차율{" "}
                        {hosp.data.bins
                          .map((b) => pct(b.unassignedRate, 1))
                          .join(" · ")}{" "}
                        — 거리와 무관
                      </p>
                      <p className="mt-1 text-[10.5px] leading-4 text-dim">
                        검정 결과 <b className="text-ink/90">'멀어서 안 탄다'는 기각</b> —
                        병원은 멀어도 타는 필수 수요다 (외곽 장안읍: 평균{" "}
                        {hosp.data.dongs[0]?.meanHospKm ?? "—"}km 이동, 병원행
                        비중 {pct(hosp.data.dongs[0]?.hospShare ?? 0, 1)}).
                        외곽의 문제는 탑승 포기가 아니라 편도 10km+의 이동
                        부담이다.
                      </p>
                    </div>
                  ) : (
                    <span className="text-[11px] text-dim">데이터 준비 중</span>
                  )
                }
                so="외곽 침묵 지역 대책은 배차 확충보다 거리 부담 완화가 제안 방향."
                policy={{
                  owner: "지자체·공단",
                  action: "장거리 병원행 셔틀·순회 진료 연계",
                  impact: `외곽 병원행 평균 ${hosp.data?.dongs[0]?.meanHospKm ?? "—"}km · 좌4동 1천명당 ${j4 && j4.per1k !== null ? fmt(j4.per1k) : "—"}건 · 전역 포기 추정 ${numFmt(funnel?.numbers, "abandoned")}건/월`,
                }}
                caveats={hosp.data?.meta.note}
              />
            }
          />
        )}

      </div>
    </div>
  );
}
