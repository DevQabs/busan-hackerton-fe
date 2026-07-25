"use client";

import { useEffect, useMemo, useState } from "react";
import { GeoJsonLayer } from "deck.gl";
import {
  Area,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DATA,
  type DispatchEtaCell,
  type DispatchEtaData,
  type DongProps,
} from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt, pct } from "@/lib/format";
import { HEX } from "@/lib/palette";
import { tooltipHtml, type DongCollection, type FlyTo, type MapSpec } from "@/lib/mapspec";
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

const LOW: [number, number, number] = [35, 60, 95]; // muted blue = short wait
const HIGH: [number, number, number] = [229, 72, 77]; // #e5484d warm red = long wait
const MIN_OPACITY = 0.25; // floor so low-confidence dongs stay visible, never fully hidden

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function DispatchEtaScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const eta = useData<DispatchEtaData>(DATA.dispatchEta);
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);
  const [hour, setHour] = useState(8);
  const [selected, setSelected] = useState<string | null>(null); // admCd
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);

  // admCd -> 24-length array indexed by hour
  const byDong = useMemo(() => {
    const m = new Map<string, DispatchEtaCell[]>();
    if (!eta.data) return m;
    for (const c of eta.data.cells) {
      let arr = m.get(c.admCd);
      if (!arr) {
        arr = new Array(24);
        m.set(c.admCd, arr);
      }
      arr[c.hour] = c;
    }
    return m;
  }, [eta.data]);

  // robust color/opacity domains at the selected hour (10th–90th percentile)
  const { minLo, minHi, wLo, wHi } = useMemo(() => {
    const mins: number[] = [];
    const widths: number[] = [];
    for (const arr of byDong.values()) {
      const c = arr[hour];
      if (!c) continue;
      mins.push(c.minutes);
      widths.push(c.ci ? (c.ci[1] - c.ci[0]) / Math.max(1, c.minutes) : 1);
    }
    mins.sort((a, b) => a - b);
    widths.sort((a, b) => a - b);
    const pct10 = (arr: number[]) => arr[Math.floor(arr.length * 0.1)] ?? 0;
    const pct90 = (arr: number[]) => arr[Math.floor(arr.length * 0.9)] ?? 1;
    return {
      minLo: pct10(mins),
      minHi: Math.max(pct90(mins), pct10(mins) + 1),
      wLo: pct10(widths),
      wHi: Math.max(pct90(widths), pct10(widths) + 0.01),
    };
  }, [byDong, hour]);

  const layers = useMemo(() => {
    if (!dongs.data || byDong.size === 0) return [];
    const fill = (admCd: string): [number, number, number, number] => {
      const c = byDong.get(admCd)?.[hour];
      if (!c) return [18, 24, 38, 40];
      const t = Math.max(0, Math.min(1, (c.minutes - minLo) / Math.max(1e-9, minHi - minLo)));
      const widthRatio = c.ci ? (c.ci[1] - c.ci[0]) / Math.max(1, c.minutes) : 1;
      const wt = Math.max(0, Math.min(1, (widthRatio - wLo) / Math.max(1e-9, wHi - wLo)));
      const alpha = Math.round(lerp(230, MIN_OPACITY * 255, wt));
      return [
        Math.round(lerp(LOW[0], HIGH[0], t)),
        Math.round(lerp(LOW[1], HIGH[1], t)),
        Math.round(lerp(LOW[2], HIGH[2], t)),
        alpha,
      ];
    };
    return [
      new GeoJsonLayer<DongProps>({
        id: "dispatch-eta-choropleth",
        data: dongs.data as never,
        stroked: true,
        filled: true,
        pickable: true,
        getFillColor: (f) => fill(f.properties.admCd),
        getLineColor: (f) =>
          f.properties.admCd === selected ? [34, 211, 238, 255] : [35, 43, 61, 200],
        getLineWidth: (f) => (f.properties.admCd === selected ? 2.5 : 1),
        lineWidthUnits: "pixels",
        onClick: (info) => {
          const f = info.object as { properties: DongProps } | undefined;
          if (f?.properties) {
            setSelected(f.properties.admCd);
            setFlyTo({
              longitude: f.properties.centroid[0],
              latitude: f.properties.centroid[1],
              zoom: 12.5,
            });
          }
        },
        updateTriggers: {
          getFillColor: [hour, minLo, minHi, wLo, wHi],
          getLineColor: [selected],
          getLineWidth: [selected],
        },
      }),
    ];
  }, [dongs.data, byDong, hour, minLo, minHi, wLo, wHi, selected]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return ({ object }) => {
      if (!object) return null;
      const p = (object as { properties: DongProps }).properties;
      const c = byDong.get(p.admCd)?.[hour];
      if (!c) return tooltipHtml(`<b>${p.gu} ${p.name}</b><br/>데이터 없음`);
      const ciTxt = c.ci ? `${c.ci[0].toFixed(0)}~${c.ci[1].toFixed(0)}분` : "—";
      return tooltipHtml(
        `<b>${p.gu} ${p.name}</b> · ${hour}시<br/>예상 대기 <b>${c.minutes.toFixed(0)}분</b> (95% CI ${ciTxt})<br/>` +
          `표본 ${fmt(c.n)}건 · 미배차·취소 ${pct(c.unassignedShare)} · 클릭하면 상세`,
      );
    };
  }, [byDong, hour]);

  useEffect(() => {
    onMapSpec({ layers, getTooltip, flyTo });
  }, [layers, getTooltip, flyTo, onMapSpec]);

  if (eta.data && eta.data.meta.status !== "ok") {
    return (
      <DataPending
        note={`dispatch_eta.json 준비 중 — ${eta.data.meta.note ?? "동×시간대 배차 예측 데이터가 표시됩니다."}`}
      />
    );
  }
  if (!eta.data || !dongs.data) {
    return <DataPending note="dispatch_eta.json 대기 중 — 동×시간대 예상 배차 대기시간이 표시됩니다." />;
  }

  const selDong = selected
    ? dongs.data.features.find((f) => f.properties.admCd === selected)?.properties
    : null;
  const selCurve = selected ? byDong.get(selected) : null;
  const curveData = selCurve
    ? selCurve.map((c, h) => ({
        hour: h,
        minutes: c?.minutes ?? null,
        ciLo: c?.ci?.[0] ?? c?.minutes ?? null,
        ciWidth: c?.ci ? c.ci[1] - c.ci[0] : 0,
      }))
    : [];
  const selNow = selCurve?.[hour] ?? null;

  return (
    <div className="space-y-3">
      <Section title="시간대 선택" aside={`${hour}시 접수 기준`}>
        <input
          type="range"
          min={0}
          max={23}
          step={1}
          value={hour}
          onChange={(e) => setHour(Number(e.target.value))}
          className="w-full accent-accent"
        />
        <div className="tnum mt-1 flex justify-between text-[10px] leading-4 text-dim">
          <span>0시</span>
          <span>6시</span>
          <span>12시</span>
          <span>18시</span>
          <span>23시</span>
        </div>
        <p className="mt-2 text-[11px] leading-4 text-dim">
          지도 색상: <span style={{ color: "#5b7bbf" }}>파랑(짧음)</span> →{" "}
          <span style={{ color: "#e5484d" }}>빨강(긺)</span>. 투명도가 낮을수록(흐릴수록)
          표본이 적어 신뢰구간이 넓은 동입니다.
        </p>
      </Section>

      {selDong && selCurve ? (
        <Section
          title={`${selDong.gu} ${selDong.name}`}
          aside={
            <button type="button" onClick={() => setSelected(null)} className="text-accent hover:underline">
              선택 해제
            </button>
          }
        >
          {selNow && (
            <div className="tnum mb-2 grid grid-cols-3 gap-2">
              <div className="rounded-md border border-line bg-[#0e1424] px-2.5 py-2">
                <div className="text-[10px] leading-4 text-dim">{hour}시 예상 대기</div>
                <div className="text-[20px] font-bold leading-7 text-ink">
                  {selNow.minutes.toFixed(0)}분
                </div>
              </div>
              <div className="rounded-md border border-line bg-[#0e1424] px-2.5 py-2">
                <div className="text-[10px] leading-4 text-dim">95% 신뢰구간</div>
                <div className="text-[13px] font-semibold leading-7 text-ink">
                  {selNow.ci ? `${selNow.ci[0].toFixed(0)}~${selNow.ci[1].toFixed(0)}분` : "—"}
                </div>
              </div>
              <div className="rounded-md border border-line bg-[#0e1424] px-2.5 py-2">
                <div className="text-[10px] leading-4 text-dim">표본 / 미배차·취소</div>
                <div className="text-[13px] font-semibold leading-7 text-ink">
                  {fmt(selNow.n)}건 · {pct(selNow.unassignedShare)}
                </div>
              </div>
            </div>
          )}
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={curveData} margin={{ top: 6, right: 6, bottom: 0, left: -22 }}>
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
                  width={46}
                  tickFormatter={(v: number) => `${v}분`}
                />
                <Tooltip
                  cursor={CURSOR_FILL}
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                  labelFormatter={(h) => `${h}시 접수`}
                  formatter={(v, name) =>
                    name === "minutes" ? `${Number(v).toFixed(0)}분` : undefined
                  }
                />
                <Area
                  dataKey="ciLo"
                  stackId="ci"
                  stroke="none"
                  fill="transparent"
                  isAnimationActive={false}
                />
                <Area
                  dataKey="ciWidth"
                  stackId="ci"
                  name="95% CI"
                  stroke="none"
                  fill={HEX.accent}
                  fillOpacity={0.15}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="minutes"
                  name="minutes"
                  stroke={HEX.accent}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-dim">
            선을 감싼 옅은 띠가 95% 신뢰구간입니다. 띠가 넓을수록 그 시간대의 표본이
            적어 추정이 불확실하다는 뜻입니다.
          </p>
        </Section>
      ) : (
        <Section title="동을 선택하세요" flush>
          <p className="px-3.5 py-3 text-[11px] leading-4 text-dim">
            지도에서 행정동을 클릭하면 그 동의 24시간 예상 대기시간 곡선과
            신뢰구간이 여기에 표시됩니다.
          </p>
        </Section>
      )}

      <Explainer
        what={
          <>
            <p>
              이 화면은 &ldquo;지금 이 동에서 배차를 요청하면 얼마나 기다릴까&rdquo;를
              시간대별로 보여줍니다. 슬라이더로 시간을 고르면 지도 전체가 그 시간대
              기준으로 다시 칠해지고, 동을 클릭하면 하루 24시간 전체 곡선을 볼 수
              있습니다.
            </p>
          </>
        }
        how={
          <>
            <p>
              동×시간 조합은 표본이 매우 적어(칸당 평균 6건대) 원시 평균을 그대로
              쓰면 신뢰할 수 없습니다. 대신 구(16개) 단위로 하루 시간대 곡선을 먼저
              추정하고, 각 동은 그 구 곡선에서 얼마나 벗어나는지(절편)만 표본수에
              비례해 조심스럽게 반영합니다 — 표본이 적은 동일수록 구 평균에 가깝게,
              표본이 많은 동일수록 자기 자신의 데이터에 가깝게 추정됩니다(축소
              추정, empirical Bayes). 지도의 투명도는 이 신뢰구간의 폭을 나타내며,
              흐릴수록 &ldquo;불확실하다&rdquo;는 뜻입니다 — 값을 숨기지 않고
              불확실성을 함께 보여주기 위함입니다.
            </p>
          </>
        }
        caveats={
          <>
            <p>
              모든 수치는 접수→승차, 완료된(배차 성공) 즉시배차 트립 기준
              기하평균이며 <b className="text-ink">5월 한 달치 데이터 기반 통계적
              추정치</b>입니다 — 실시간 차량 위치나 현재 가용 대수를 반영한 실시간
              예측이 아닙니다. 미배차·취소로 끝난 요청은 대기가 길어서 발생하는
              경우가 많은데(정보성 관측중단), 이를 인위적으로 보정하지 않고 대신
              &ldquo;미배차·취소 비율&rdquo;을 별도로 함께 표시해 체감 대기가 표시된
              수치보다 길 수 있음을 투명하게 전달합니다.
            </p>
          </>
        }
      />
    </div>
  );
}
