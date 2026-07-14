"use client";

import { useEffect, useMemo, useState } from "react";
import { GeoJsonLayer, ScatterplotLayer, TextLayer } from "deck.gl";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DATA,
  type ArrivalDeserts,
  type DesertCell,
  type DesertGreedyPick,
  type DongProps,
} from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt, pct } from "@/lib/format";
import { HEX, RGB_ACCENT } from "@/lib/palette";
import {
  tooltipHtml,
  type DongCollection,
  type FlyTo,
  type MapSpec,
} from "@/lib/mapspec";
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

/** 소관 (responsible party) derived from Korean shortage badges. */
export function ownersOfLack(lack: string[]): string[] {
  const out: string[] = [];
  const push = (v: string) => {
    if (!out.includes(v)) out.push(v);
  };
  for (const l of lack) {
    if (l.includes("충전")) push("구청·윌체어");
    else if (l.includes("병의원") || l.includes("병원") || l.includes("의원")) push("구청");
    else if (l.includes("복지")) push("구청");
    else if (l.includes("상가") || l.includes("1층")) push("윌체어");
  }
  return out;
}

function distLabel(m: number | null): string {
  return m === null ? "2km 밖" : `${fmt(m)}m`;
}

export function DesertsScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const deserts = useData<ArrivalDeserts>(DATA.arrivalDeserts);
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);

  const [selectedRank, setSelectedRank] = useState<number | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);

  const cells = deserts.data?.cells ?? [];
  const greedy = deserts.data?.greedy ?? [];

  const selected = useMemo(
    () => cells.find((c) => c.rank === selectedRank) ?? null,
    [cells, selectedRank],
  );

  const maxScore = useMemo(
    () => Math.max(1e-9, ...cells.map((c) => c.score)),
    [cells],
  );

  const layers = useMemo(() => {
    const out = [];
    if (dongs.data) {
      out.push(
        new GeoJsonLayer<DongProps>({
          id: "deserts-dongs",
          data: dongs.data as never,
          stroked: true,
          filled: false,
          getLineColor: [35, 43, 61, 150],
          getLineWidth: 1,
          lineWidthUnits: "pixels",
        }),
      );
    }
    if (cells.length > 0) {
      out.push(
        new ScatterplotLayer<DesertCell>({
          id: "deserts-cells",
          data: cells,
          getPosition: (d) => [d.lng, d.lat],
          // size + color both ride on score (single-hue red ramp, worse = bigger/brighter)
          getRadius: (d) => 90 + Math.sqrt(d.score / maxScore) * 260,
          radiusUnits: "meters",
          radiusMinPixels: 3,
          radiusMaxPixels: 34,
          getFillColor: (d) => {
            const t = Math.sqrt(d.score / maxScore);
            return [
              Math.round(140 + t * 89), // 140→229
              Math.round(40 + t * 32), //  40→72
              Math.round(45 + t * 32), //  45→77
              Math.round(90 + t * 150),
            ];
          },
          getLineColor: (d) =>
            d.rank === selectedRank ? [34, 211, 238, 255] : [0, 0, 0, 0],
          getLineWidth: (d) => (d.rank === selectedRank ? 2.5 : 0),
          lineWidthUnits: "pixels",
          stroked: true,
          pickable: true,
          onClick: (info) => {
            const c = info.object as DesertCell | undefined;
            if (!c) return;
            setSelectedRank(c.rank);
            setFlyTo({ longitude: c.lng, latitude: c.lat, zoom: 13.6 });
          },
          updateTriggers: {
            getLineColor: [selectedRank],
            getLineWidth: [selectedRank],
          },
        }),
      );
    }
    if (greedy.length > 0) {
      out.push(
        new ScatterplotLayer<DesertGreedyPick>({
          id: "deserts-greedy",
          data: greedy,
          getPosition: (d) => [d.lng, d.lat],
          getRadius: 11,
          radiusUnits: "pixels",
          getFillColor: [...RGB_ACCENT, 235] as [number, number, number, number],
          stroked: true,
          getLineColor: [11, 15, 26, 255],
          getLineWidth: 2,
          lineWidthUnits: "pixels",
          pickable: true,
        }),
        new TextLayer<DesertGreedyPick>({
          id: "deserts-greedy-labels",
          data: greedy,
          getPosition: (d) => [d.lng, d.lat],
          getText: (_, { index }) => String(index + 1),
          getSize: 13,
          getColor: [11, 15, 26, 255],
          fontWeight: 700,
          getTextAnchor: "middle",
          getAlignmentBaseline: "center",
        }),
      );
    }
    return out;
  }, [dongs.data, cells, greedy, maxScore, selectedRank]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      const o = info.object as (DesertCell & DesertGreedyPick) | undefined;
      if (!o) return null;
      if ("gain" in o && o.gain !== undefined) {
        const idx = greedy.indexOf(o as DesertGreedyPick);
        return tooltipHtml(
          `<b>후보 지점 ${idx + 1}</b><br/>신규 커버 하차 ${fmt(o.gain)}건 · 누적 ${pct(o.cumShare)}`,
        );
      }
      const c = o as DesertCell;
      return tooltipHtml(
        `<b>${c.dong ?? "행정동 미확인"} · ${c.rank}위 격자</b><br/>하차 ${fmt(c.dropoffs)}건 · ${c.lack.join(" · ") || "부족 항목 없음"}`,
      );
    };
  }, [greedy]);

  useEffect(() => {
    onMapSpec({ layers, getTooltip, flyTo });
  }, [layers, getTooltip, flyTo, onMapSpec]);

  if (!deserts.data) {
    return (
      <div className="space-y-3">
        <DataPending note="arrival_deserts.json 대기 중 — 하차 지점 250m 격자 사각지대가 표시됩니다." />
      </div>
    );
  }

  const lastPick = greedy[greedy.length - 1];

  return (
    <div className="space-y-3">
      {/* ── selected cell detail ────────────────────────────────────────── */}
      {selected && (
        <Section
          title={`${selected.dong ?? "행정동 미확인"} · ${selected.rank}위 격자`}
          aside={
            <button
              type="button"
              onClick={() => setSelectedRank(null)}
              className="text-accent hover:underline"
            >
              선택 해제
            </button>
          }
        >
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
            {(
              [
                ["기간 내 하차", `${fmt(selected.dropoffs)}건`],
                ["부족 점수", selected.score.toFixed(1)],
                ["최근접 충전소", distLabel(selected.nearestM.charger)],
                ["최근접 병의원", distLabel(selected.nearestM.hospital)],
                ["최근접 복지시설", distLabel(selected.nearestM.welfare)],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div
                key={k}
                className="flex items-baseline justify-between border-b border-line/60 pb-1"
              >
                <dt className="text-dim">{k}</dt>
                <dd className="tnum font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          {selected.lack.length > 0 && (
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

      {/* ── ranked table ────────────────────────────────────────────────── */}
      <Section
        title="하차 사각지대 순위"
        aside={`${deserts.data.params.cellM}m 격자 · 행 클릭 = 지도 이동`}
        flush
      >
        <div className="max-h-[300px] overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-line text-left text-[11px] text-dim">
                <th className="px-3 py-1.5 font-medium">순위</th>
                <th className="py-1.5 font-medium">동</th>
                <th className="tnum py-1.5 text-right font-medium">하차</th>
                <th className="px-3 py-1.5 text-right font-medium">부족·소관</th>
              </tr>
            </thead>
            <tbody>
              {cells.slice(0, 30).map((c) => {
                const active = c.rank === selectedRank;
                const owners = ownersOfLack(c.lack);
                return (
                  <tr
                    key={c.rank}
                    onClick={() => {
                      setSelectedRank(active ? null : c.rank);
                      if (!active)
                        setFlyTo({ longitude: c.lng, latitude: c.lat, zoom: 13.6 });
                    }}
                    className={`cursor-pointer border-b border-line/60 last:border-b-0 ${
                      active ? "bg-accent/10" : "hover:bg-[#161e30]"
                    }`}
                  >
                    <td className="tnum px-3 py-1.5 align-top text-dim">{c.rank}</td>
                    <td className={`py-1.5 align-top ${active ? "font-semibold text-accent" : "text-ink"}`}>
                      {c.dong ?? "—"}
                    </td>
                    <td className="tnum py-1.5 text-right align-top text-ink">
                      {fmt(c.dropoffs)}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="flex flex-wrap justify-end gap-1">
                        {c.lack.map((l) => (
                          <span
                            key={l}
                            className="rounded bg-unmet/10 px-1 py-px text-[10px] leading-4 text-unmet"
                          >
                            {l}
                          </span>
                        ))}
                        {owners.map((o) => (
                          <span
                            key={o}
                            className="rounded border border-line bg-[#0e1424] px-1 py-px text-[10px] leading-4 text-ink/80"
                          >
                            {o}
                          </span>
                        ))}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── greedy coverage ─────────────────────────────────────────────── */}
      {greedy.length > 0 && (
        <Section title="다음 시설 후보 지점 — 누적 커버리지">
          <div style={{ height: 130 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={greedy.map((g, i) => ({ pick: i + 1, share: g.cumShare }))}
                margin={{ top: 4, right: 4, bottom: 0, left: -24 }}
              >
                <XAxis
                  dataKey="pick"
                  tick={TICK}
                  tickLine={false}
                  axisLine={{ stroke: "var(--line)" }}
                  tickFormatter={(v: number) => `${v}`}
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
                  cursor={CURSOR_FILL}
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                  labelFormatter={(v) => `후보 ${v}번까지`}
                  formatter={(v) => [pct(Number(v)), "누적 커버"]}
                />
                <Bar
                  dataKey="share"
                  name="누적 커버"
                  fill={HEX.accent}
                  fillOpacity={0.75}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={16}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {lastPick && (
            <p className="mt-1.5 text-[11px] leading-4 text-dim">
              후보 지점 <b className="text-accent">{greedy.length}곳</b>으로 사각
              하차의 <b className="text-accent">{pct(lastPick.cumShare)}</b>를
              커버합니다. 지도의 번호 마커가 선정 순서입니다 — 앞 번호일수록
              한 곳으로 커버되는 하차가 많습니다.
            </p>
          )}
        </Section>
      )}

      <Explainer
        what={
          <>
            <p>
              두리발에서 내린 다음이 문제입니다. 이 화면은 하차 지점을{" "}
              {deserts.data.params.cellM}m 격자로 묶고, 격자마다 &ldquo;휠체어
              이용자가 자주 내리는데 주변에 갈 만한 시설이 없는 정도&rdquo;를
              점수로 매긴 것입니다. 붉은 원이 클수록 하차는 많은데 시설이 먼
              곳입니다. 오른쪽 표는 나쁜 순서대로의 순위표이고, 각 행에는 무엇이
              부족한지(부족 배지)와 이를 개선할 수 있는 주체(소관 배지)가
              붙어 있습니다. 하늘색 번호 마커는 &ldquo;다음에 시설을 놓는다면
              어디부터가 효율적인가&rdquo;에 대한 후보 지점 제안입니다.
            </p>
          </>
        }
        how={
          <>
            <p>
              격자 점수는 하차 건수에 시설 부족 가중치를 곱해 계산합니다. 부족
              여부는 도달 거리 기준으로 판정합니다: 전동휠체어 급속충전소는
              800m, 병의원은 500m, 복지시설은 1km 안에 있어야 &ldquo;도달
              가능&rdquo;으로 봅니다(전동휠체어의 실용 이동 거리를 감안한
              기준). 후보 지점은 greedy maximal-coverage 알고리즘으로 뽑았습니다
              — 매 단계에서 아직 커버되지 않은 하차를 가장 많이 커버하는
              지점을 고르는 방식입니다. 이 방식은 이론적으로 최적해의 63%
              이상을 보장한다는 것이 증명돼 있어(서브모듈러 함수의 성질), 후보
              개수가 적어도 결과의 하한을 말할 수 있습니다.
            </p>
          </>
        }
        caveats={
          <>
            <p>
              리허설 단계에서는 공공 데이터(충전소·병의원·복지시설·1층 상가
              비율)로 부족도를 계산했습니다. 본선에서는 윌체어의 무장애가게
              실사 데이터(경사로·입구턱·장애인화장실 등 12개 Y/N 항목)로
              교체해 &ldquo;내렸는데 들어갈 수 있는 가게가 없는 곳&rdquo;
              수준까지 내려갑니다. 도달 거리는 직선거리 기준이라 언덕·횡단보도
              등 실제 이동 부담은 반영되지 않았습니다. 후보 지점은 통계적
              제안일 뿐 부지 확보 가능성을 검토한 것이 아니므로, 실제 입지
              선정의 출발점으로만 쓰는 것이 맞습니다.
            </p>
          </>
        }
      />
    </div>
  );
}
