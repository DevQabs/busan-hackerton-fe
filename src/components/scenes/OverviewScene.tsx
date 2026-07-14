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

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Kpi
          label="총 이용 접수"
          value={fmt(s.totals.trips)}
          sub={`완료 ${fmt(s.totals.completed)}건 · ${s.period.from} ~ ${s.period.to}`}
          color={HEX.demand}
        />
        <Kpi
          label="미배차율"
          value={pct(s.totals.unassignedRate)}
          sub={`미배차 ${fmt(s.totals.unassigned)}건 · 취소 ${fmt(s.totals.cancelled)}건`}
          color={HEX.unmet}
        />
        <Kpi
          label="대기시간 중앙값"
          value={`${fmt(s.waitMinutes.median)}분`}
          sub={`P90 ${fmt(s.waitMinutes.p90)}분 (접수→승차)`}
          color={HEX.warn}
        />
        <Kpi
          label="휠체어 이용 비중"
          value={wcTotal > 0 ? pct(wcKnown / wcTotal) : "—"}
          sub={`전동 ${fmt(s.wheelchair.electric)} · 수동 ${fmt(s.wheelchair.manual)}`}
          color={HEX.accent}
        />
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
    </div>
  );
}
