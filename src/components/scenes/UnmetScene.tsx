"use client";

import { useEffect, useMemo } from "react";
import { ScatterplotLayer } from "deck.gl";
import { DATA, type Stats, type UnmetCell } from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt } from "@/lib/format";
import { HEX } from "@/lib/palette";
import { tooltipHtml, type MapSpec } from "@/lib/mapspec";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";
import { Kpi } from "@/components/ui/Kpi";
import { HourBar } from "@/components/charts/HourBar";

export function UnmetScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const unmet = useData<UnmetCell[]>(DATA.unmet);
  const stats = useData<Stats>(DATA.stats);

  const layers = useMemo(() => {
    if (!unmet.data) return [];
    return [
      new ScatterplotLayer<UnmetCell>({
        id: "unmet-cells",
        data: unmet.data,
        getPosition: (d) => [d.lng, d.lat],
        // area ∝ count → radius ∝ sqrt
        getRadius: (d) => 90 + Math.sqrt(d.unassigned + d.cancelled) * 110,
        radiusUnits: "meters",
        radiusMinPixels: 2,
        radiusMaxPixels: 40,
        getFillColor: (d) => {
          const heavy = d.unassigned + d.cancelled;
          return heavy >= 5 ? [229, 72, 77, 200] : [251, 113, 133, 150];
        },
        pickable: true,
        stroked: false,
      }),
    ];
  }, [unmet.data]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      const c = info.object as UnmetCell | undefined;
      if (!c) return null;
      return tooltipHtml(
        `<b>미충족 수요 셀 (약 100m)</b><br/>미배차 ${fmt(c.unassigned)}건 · 취소 ${fmt(c.cancelled)}건`,
      );
    };
  }, []);

  useEffect(() => {
    onMapSpec({ layers, getTooltip });
  }, [layers, getTooltip, onMapSpec]);

  const s = stats.data;
  const peakHour = useMemo(() => {
    if (!s) return null;
    return [...s.hourly].sort((a, b) => b.unassigned - a.unassigned)[0] ?? null;
  }, [s]);

  const totalCells = unmet.data?.length ?? 0;
  const totalUnassigned = useMemo(
    () => (unmet.data ? unmet.data.reduce((acc, c) => acc + c.unassigned, 0) : 0),
    [unmet.data],
  );

  return (
    <div className="space-y-3">
      {unmet.data ? (
        <div className="grid grid-cols-2 gap-2">
          <Kpi
            label="미충족 셀"
            value={fmt(totalCells)}
            sub="100m 격자 (개인정보 보호 집계)"
            color={HEX.unmet}
          />
          <Kpi
            label="셀 내 미배차 합계"
            value={fmt(totalUnassigned)}
            sub="출발지 기준"
            color={HEX.gapHL}
          />
        </div>
      ) : (
        <DataPending note="unmet.json 대기 중 — 미배차·취소 밀집 지도가 표시됩니다." />
      )}

      {s ? (
        <Section
          title="시간대별 미배차"
          aside={peakHour ? `${peakHour.hour}시 미배차 최다` : undefined}
        >
          <HourBar
            data={s.hourly.map((h) => ({ hour: h.hour, value: h.unassigned }))}
            baseColor={HEX.unmet}
            hiColor={HEX.gapHL}
            seriesName="미배차"
          />
          <p className="mt-1.5 text-[11px] leading-4 text-dim">
            {peakHour
              ? `${peakHour.hour}시에 미배차가 ${fmt(peakHour.unassigned)}건으로 가장 많습니다 — 통원 피크와 차량 공급이 어긋나는 시간대입니다.`
              : "시간대별 미배차 분포입니다."}
          </p>
        </Section>
      ) : (
        <DataPending note="stats.json 대기 중 — 시간대별 미배차 차트가 표시됩니다." />
      )}

      <Section title="읽는 법">
        <p className="text-[12px] leading-5 text-dim">
          원이 클수록 배차 실패·취소가 잦았던 곳입니다. 짙은 붉은 원(5건 이상)이
          모인 곳은 차량 재배치나 증차 검토가 필요한 후보지입니다.
        </p>
      </Section>
    </div>
  );
}
