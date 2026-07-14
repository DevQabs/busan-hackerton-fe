"use client";

import { useEffect, useMemo, useState } from "react";
import { ScatterplotLayer } from "deck.gl";
import {
  DATA,
  type GuToilets,
  type InfraPoint,
  type StationLift,
} from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt } from "@/lib/format";
import { INFRA_COLORS, INFRA_HEX, INFRA_LABEL } from "@/lib/palette";
import { tooltipHtml, type MapSpec } from "@/lib/mapspec";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";
import { ToiletsBar } from "@/components/charts/ToiletsBar";

const TYPES = ["charger", "hospital", "pharmacy", "welfare"] as const;
type InfraType = (typeof TYPES)[number];

export function InfraScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const points = useData<InfraPoint[]>(DATA.infraPoints);
  const toilets = useData<GuToilets[]>(DATA.toiletsGu);
  const lifts = useData<StationLift[]>(DATA.elevators);

  const [enabled, setEnabled] = useState<Record<InfraType, boolean>>({
    charger: true,
    hospital: true,
    pharmacy: true,
    welfare: true,
  });

  const counts = useMemo(() => {
    const c: Record<InfraType, number> = { charger: 0, hospital: 0, pharmacy: 0, welfare: 0 };
    for (const p of points.data ?? []) {
      if (p.type in c) c[p.type as InfraType] += 1;
    }
    return c;
  }, [points.data]);

  const visible = useMemo(
    () => (points.data ?? []).filter((p) => enabled[p.type as InfraType]),
    [points.data, enabled],
  );

  const layers = useMemo(() => {
    if (visible.length === 0) return [];
    return [
      new ScatterplotLayer<InfraPoint>({
        id: "infra-points",
        data: visible,
        getPosition: (d) => [d.lng, d.lat],
        getFillColor: (d) => {
          const c = INFRA_COLORS[d.type];
          return [c[0], c[1], c[2], d.type === "charger" ? 255 : 170];
        },
        // chargers are the scarcest resource — draw them slightly larger
        getRadius: (d) => (d.type === "charger" ? 5 : 3),
        radiusUnits: "pixels",
        pickable: true,
        stroked: false,
      }),
    ];
  }, [visible]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      const p = info.object as InfraPoint | undefined;
      if (!p) return null;
      const parts = [
        `<b>${p.name}</b>`,
        `${INFRA_LABEL[p.type]}${p.detail ? ` · ${p.detail}` : ""}`,
      ];
      if (p.dong) parts.push(`<span style="color:#8b96ab">${p.dong}</span>`);
      return tooltipHtml(parts.join("<br/>"));
    };
  }, []);

  useEffect(() => {
    onMapSpec({ layers, getTooltip });
  }, [layers, getTooltip, onMapSpec]);

  const liftRows = useMemo(() => {
    if (!lifts.data) return [];
    return [...lifts.data].sort((a, b) => b.elevators - a.elevators).slice(0, 8);
  }, [lifts.data]);

  const noElevator = useMemo(
    () => (lifts.data ?? []).filter((l) => l.elevators === 0).length,
    [lifts.data],
  );

  return (
    <div className="space-y-3">
      <Section title="시설 유형" aside={`표시 중 ${fmt(visible.length)}개`}>
        <div className="grid grid-cols-2 gap-1.5">
          {TYPES.map((t) => {
            const on = enabled[t];
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => setEnabled((e) => ({ ...e, [t]: !e[t] }))}
                className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[12px] transition-colors ${
                  on ? "border-line bg-[#161e30]" : "border-line/50 opacity-45"
                }`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: INFRA_HEX[t] }}
                />
                <span className="text-ink">{INFRA_LABEL[t]}</span>
                <span className="tnum ml-auto text-[11px] text-dim">
                  {points.data ? fmt(counts[t]) : "—"}
                </span>
              </button>
            );
          })}
        </div>
        {!points.data && (
          <div className="mt-2">
            <DataPending note="infra_points.json 대기 중 — 시설 포인트가 지도에 표시됩니다." />
          </div>
        )}
      </Section>

      <Section title="구별 장애인화장실" aside="공중화장실 중 보유 개소">
        {toilets.data ? (
          <ToiletsBar data={toilets.data} />
        ) : (
          <DataPending note="toilets_gu.json 대기 중" />
        )}
      </Section>

      <Section
        title="도시철도 승강설비"
        aside={lifts.data ? `승강기 없는 역 ${fmt(noElevator)}곳` : undefined}
        flush
      >
        {lifts.data ? (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] text-dim">
                <th className="px-3.5 py-1.5 font-medium">호선</th>
                <th className="py-1.5 font-medium">역</th>
                <th className="tnum py-1.5 text-right font-medium">승강기</th>
                <th className="tnum px-3.5 py-1.5 text-right font-medium">에스컬레이터</th>
              </tr>
            </thead>
            <tbody>
              {liftRows.map((l) => (
                <tr key={`${l.line}-${l.station}`} className="border-b border-line/60 last:border-b-0">
                  <td className="px-3.5 py-1.5 text-dim">{l.line}</td>
                  <td className="py-1.5 text-ink">{l.station}</td>
                  <td className="tnum py-1.5 text-right text-ink">{l.elevators}</td>
                  <td className="tnum px-3.5 py-1.5 text-right text-dim">{l.escalators}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={4} className="px-3.5 py-1.5 text-[11px] text-dim">
                  승강기 많은 역 상위 8곳 · 전체 {fmt(lifts.data.length)}역 (2025)
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <div className="px-3.5 py-3">
            <DataPending note="elevators.json 대기 중" />
          </div>
        )}
      </Section>
    </div>
  );
}
