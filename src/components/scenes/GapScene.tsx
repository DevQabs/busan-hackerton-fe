"use client";

import { useEffect, useMemo, useState } from "react";
import { GeoJsonLayer } from "deck.gl";
import { DATA, type DongProps } from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt, pct, signed } from "@/lib/format";
import { HEX, RGB_GAP } from "@/lib/palette";
import { tooltipHtml, type DongCollection, type MapSpec } from "@/lib/mapspec";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";

const GAP_LABEL: Record<DongProps["gapClass"], string> = {
  HL: "수요高 · 인프라低",
  HH: "수요高 · 인프라高",
  LH: "수요低 · 인프라高",
  LL: "수요低 · 인프라低",
};

const GAP_HEX: Record<DongProps["gapClass"], string> = {
  HL: HEX.gapHL,
  HH: HEX.gapHH,
  LH: HEX.gapLH,
  LL: "#3a4560",
};

export function GapScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);
  const [selected, setSelected] = useState<string | null>(null); // admCd

  const ranked = useMemo(() => {
    if (!dongs.data) return [];
    return [...dongs.data.features]
      .map((f) => f.properties)
      .sort((a, b) => b.gapScore - a.gapScore);
  }, [dongs.data]);

  const rankOf = useMemo(() => {
    const m = new Map<string, number>();
    ranked.forEach((p, i) => m.set(p.admCd, i + 1));
    return m;
  }, [ranked]);

  const sel = useMemo(
    () => ranked.find((p) => p.admCd === selected) ?? null,
    [ranked, selected],
  );

  const layers = useMemo(() => {
    if (!dongs.data) return [];
    return [
      new GeoJsonLayer<DongProps>({
        id: "gap-choro",
        data: dongs.data as never,
        pickable: true,
        stroked: true,
        getFillColor: (f) => RGB_GAP[f.properties.gapClass],
        getLineColor: (f) =>
          f.properties.admCd === selected ? [34, 211, 238, 255] : [11, 15, 26, 180],
        getLineWidth: (f) => (f.properties.admCd === selected ? 2.5 : 1),
        lineWidthUnits: "pixels",
        onClick: (info) => {
          const f = info.object as { properties: DongProps } | undefined;
          if (f?.properties) setSelected(f.properties.admCd);
        },
        updateTriggers: {
          getLineColor: [selected],
          getLineWidth: [selected],
        },
      }),
    ];
  }, [dongs.data, selected]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      const f = info.object as { properties: DongProps } | undefined;
      if (!f?.properties) return null;
      const p = f.properties;
      return tooltipHtml(
        `<b>${p.gu} ${p.name}</b> · ${GAP_LABEL[p.gapClass]}<br/>격차점수 ${p.gapScore.toFixed(2)} · 클릭하면 상세`,
      );
    };
  }, []);

  useEffect(() => {
    onMapSpec({ layers, getTooltip });
  }, [layers, getTooltip, onMapSpec]);

  if (!dongs.data) {
    return <DataPending note="dongs.geojson 대기 중 — 수요×인프라 사각지대 지도가 표시됩니다." />;
  }

  const hlCount = ranked.filter((p) => p.gapClass === "HL").length;

  return (
    <div className="space-y-3">
      <Section title="수요 × 인프라 유형" aside={`사각지대 ${hlCount}개 동`}>
        <div className="grid grid-cols-2 gap-1.5">
          {(["HL", "HH", "LL", "LH"] as const).map((c) => (
            <div
              key={c}
              className="flex items-center gap-2 rounded-md border border-line px-2.5 py-2"
            >
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ background: GAP_HEX[c], opacity: c === "LL" ? 0.6 : 1 }}
              />
              <div>
                <div className="text-[11px] font-medium leading-4 text-ink">
                  {GAP_LABEL[c]}
                </div>
                {c === "HL" && (
                  <div className="text-[10px] leading-3 text-unmet">우선 개선 대상</div>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-4 text-dim">
          이동수요와 무장애 인프라를 각각 3분위로 나눈 조합입니다. 수요는 많은데
          인프라가 부족한 <b style={{ color: HEX.gapHL }}>사각지대(HL)</b>가 핵심입니다.
        </p>
      </Section>

      {sel ? (
        <Section
          title={`${sel.gu} ${sel.name}`}
          aside={
            <button type="button" onClick={() => setSelected(null)} className="text-accent hover:underline">
              선택 해제
            </button>
          }
        >
          <div className="mb-2 flex items-center gap-2">
            <span
              className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
              style={{ background: `${GAP_HEX[sel.gapClass]}26`, color: GAP_HEX[sel.gapClass] }}
            >
              {GAP_LABEL[sel.gapClass]}
            </span>
            <span className="tnum text-[11px] text-dim">
              격차 순위 {rankOf.get(sel.admCd)}위 / {ranked.length}개 동
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
            {(
              [
                ["격차점수", sel.gapScore.toFixed(2)],
                ["수요 z", signed(sel.demandZ)],
                ["인프라 z", signed(sel.infraZ)],
                ["하차", `${fmt(sel.dropoffs)}건`],
                ["승차", `${fmt(sel.pickups)}건`],
                ["미배차", `${fmt(sel.unassigned)}건`],
                ["취소", `${fmt(sel.cancelled)}건`],
                ["대기 중앙값", sel.waitMedian === null ? "표본<10" : `${fmt(sel.waitMedian)}분`],
                ["충전소", `${fmt(sel.chargers)}개`],
                ["병의원", `${fmt(sel.hospitals)}개`],
                ["약국", `${fmt(sel.pharmacies)}개`],
                ["복지시설", `${fmt(sel.welfare)}개`],
                ["상가", `${fmt(sel.shops)}개`],
                [
                  "1층 상가 비율",
                  sel.shopsFloor1Share === null ? "—" : pct(sel.shopsFloor1Share, 0),
                ],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between border-b border-line/60 pb-1">
                <dt className="text-dim">{k}</dt>
                <dd className="tnum font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : (
        <Section title="사각지대 상위" aside="지도를 클릭해도 됩니다" flush>
          <ul className="max-h-[320px] overflow-y-auto">
            {ranked
              .filter((p) => p.gapClass === "HL")
              .slice(0, 15)
              .map((p) => (
                <li key={p.admCd}>
                  <button
                    type="button"
                    onClick={() => setSelected(p.admCd)}
                    className="flex w-full items-center gap-2 border-b border-line px-3.5 py-1.5 text-left text-[12px] last:border-b-0 hover:bg-[#161e30]"
                  >
                    <span className="tnum w-9 shrink-0 whitespace-nowrap text-dim">
                      {rankOf.get(p.admCd)}위
                    </span>
                    <span className="text-ink">
                      {p.gu} {p.name}
                    </span>
                    <span className="tnum ml-auto text-unmet">{p.gapScore.toFixed(2)}</span>
                  </button>
                </li>
              ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
