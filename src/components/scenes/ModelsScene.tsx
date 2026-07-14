"use client";

import { useEffect, useMemo } from "react";
import { GeoJsonLayer } from "deck.gl";
import { DATA, type DongProps, type ModelResult } from "@/lib/types";
import { useData } from "@/lib/useData";
import { type DongCollection, type MapSpec } from "@/lib/mapspec";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";

export function ModelsScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const models = useData<ModelResult[]>(DATA.modelResults);
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);

  // Quiet context map — dong outlines only; this scene lives in the panel.
  const layers = useMemo(() => {
    if (!dongs.data) return [];
    return [
      new GeoJsonLayer<DongProps>({
        id: "models-dongs",
        data: dongs.data as never,
        stroked: true,
        filled: true,
        getFillColor: [18, 24, 38, 60],
        getLineColor: [35, 43, 61, 180],
        getLineWidth: 1,
        lineWidthUnits: "pixels",
      }),
    ];
  }, [dongs.data]);

  useEffect(() => {
    onMapSpec({ layers });
  }, [layers, onMapSpec]);

  if (!models.data) {
    return (
      <DataPending note="model_results.json 대기 중 — 본선에서 데이터 분석 결과 카드가 이 자리에 채워집니다." />
    );
  }

  return (
    <div className="space-y-3">
      {models.data.map((m) => (
        <Section
          key={m.id}
          title={m.name}
          aside={
            m.status === "final" ? (
              <span className="rounded bg-infra/15 px-1.5 py-0.5 font-semibold text-infra">
                확정
              </span>
            ) : (
              <span className="rounded bg-warn/15 px-1.5 py-0.5 font-semibold text-warn">
                분석 대기
              </span>
            )
          }
        >
          <p
            className={`text-[13px] font-semibold leading-5 ${
              m.status === "final" ? "text-ink" : "text-dim"
            }`}
          >
            {m.headline}
          </p>
          <p className="mt-1.5 text-[12px] leading-5 text-dim">{m.detail}</p>

          {m.numbers && Object.keys(m.numbers).length > 0 && (
            <table className="mt-2.5 w-full text-[11px]">
              <tbody>
                {Object.entries(m.numbers).map(([k, v]) => (
                  <tr key={k} className="border-t border-line/60">
                    <td className="py-1 pr-2 text-dim">{k}</td>
                    <td className="tnum py-1 text-right text-ink">{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      ))}

      <p className="px-1 text-[10px] leading-4 text-dim">
        카드 내용은 model_results.json을 그대로 렌더링합니다 — 본선 당일 데이터
        분석 결과로 교체됩니다 (UI 수정 불필요).
      </p>
    </div>
  );
}
