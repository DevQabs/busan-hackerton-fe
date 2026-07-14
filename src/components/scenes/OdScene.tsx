"use client";

import { useEffect, useMemo, useState } from "react";
import { ArcLayer, GeoJsonLayer } from "deck.gl";
import { DATA, type DongProps, type OdPair } from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt, shortDong } from "@/lib/format";
import { tooltipHtml, type DongCollection, type MapSpec } from "@/lib/mapspec";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";

export function OdScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const od = useData<OdPair[]>(DATA.od);
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);
  const [selected, setSelected] = useState<string | null>(null);

  // Dong list for the filter: total flow where the dong is origin or dest.
  const dongTotals = useMemo(() => {
    if (!od.data) return [];
    const totals = new Map<string, number>();
    for (const p of od.data) {
      totals.set(p.oName, (totals.get(p.oName) ?? 0) + p.count);
      totals.set(p.dName, (totals.get(p.dName) ?? 0) + p.count);
    }
    return [...totals.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [od.data]);

  const arcs = useMemo(() => {
    if (!od.data) return [];
    if (!selected) return od.data;
    return od.data.filter((p) => p.oName === selected || p.dName === selected);
  }, [od.data, selected]);

  const layers = useMemo(() => {
    const out = [];
    if (dongs.data) {
      out.push(
        new GeoJsonLayer<DongProps>({
          id: "od-dongs",
          data: dongs.data as never,
          stroked: true,
          filled: false,
          getLineColor: [35, 43, 61, 140],
          getLineWidth: 1,
          lineWidthUnits: "pixels",
        }),
      );
    }
    if (arcs.length === 0) return out;
    out.push(
      new ArcLayer<OdPair>({
        id: "od-arcs",
        data: arcs,
        getSourcePosition: (d) => d.o,
        getTargetPosition: (d) => d.d,
        getSourceColor: [52, 211, 153, 200], // origin: infra green
        getTargetColor: [34, 211, 238, 200], // destination: accent cyan
        getWidth: (d) => Math.max(0.8, Math.sqrt(d.count) * 0.55),
        widthUnits: "pixels",
        getHeight: 0.25,
        pickable: true,
        opacity: selected ? 0.9 : 0.45,
      }),
    );
    return out;
  }, [arcs, selected, dongs.data]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      const p = info.object as OdPair | undefined;
      if (!p) return null;
      return tooltipHtml(
        `<b>${shortDong(p.oName)} → ${shortDong(p.dName)}</b> · ${fmt(p.count)}건<br/><span style="color:#8b96ab">${p.oName} → ${p.dName}</span>`,
      );
    };
  }, []);

  useEffect(() => {
    onMapSpec({ layers, getTooltip });
  }, [layers, getTooltip, onMapSpec]);

  if (!od.data) {
    return <DataPending note="od.json 대기 중 — 행정동 간 이동 아크가 표시됩니다." />;
  }

  return (
    <div className="space-y-3">
      <Section title="범례">
        <div className="flex items-center gap-3 text-[12px] text-ink">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-infra" /> 출발
          </span>
          <span className="text-dim">→</span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-accent" /> 도착
          </span>
          <span className="ml-auto text-[11px] text-dim">굵기 ∝ √건수</span>
        </div>
      </Section>

      <Section
        title="행정동별 이동량"
        aside={
          selected ? (
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-accent hover:underline"
            >
              전체 보기
            </button>
          ) : (
            `${fmt(arcs.length)}개 흐름`
          )
        }
        flush
      >
        <ul className="max-h-[420px] overflow-y-auto">
          {dongTotals.slice(0, 40).map((d, i) => {
            const active = d.name === selected;
            return (
              <li key={d.name}>
                <button
                  type="button"
                  onClick={() => setSelected(active ? null : d.name)}
                  className={`flex w-full items-center gap-2 border-b border-line px-3.5 py-1.5 text-left text-[12px] last:border-b-0 ${
                    active ? "bg-accent/10" : "hover:bg-[#161e30]"
                  }`}
                >
                  <span className="tnum w-5 text-dim">{i + 1}</span>
                  <span className={active ? "font-semibold text-accent" : "text-ink"}>
                    {d.name}
                  </span>
                  <span className="tnum ml-auto text-dim">{fmt(d.count)}건</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      {selected && (
        <Section title={`${shortDong(selected)} 연결 흐름`} aside={`${fmt(arcs.length)}건`}>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-[12px]">
            {[...arcs]
              .sort((a, b) => b.count - a.count)
              .slice(0, 12)
              .map((p, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span className="truncate text-ink">
                    {shortDong(p.oName)} → {shortDong(p.dName)}
                  </span>
                  <span className="tnum ml-auto shrink-0 text-dim">{fmt(p.count)}건</span>
                </li>
              ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
