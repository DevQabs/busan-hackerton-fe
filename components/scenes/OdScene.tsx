"use client";

import { useEffect, useMemo, useState } from "react";
import { ArcLayer, GeoJsonLayer } from "deck.gl";
import { DATA, type DongProps, type OdPair } from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt, shortDong } from "@/lib/format";
import { tooltipHtml, type DongCollection, type MapSpec } from "@/lib/mapspec";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";
import { Explainer } from "@/components/ui/Explainer";

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

      <Explainer
        what={
          <>
            <p>
              행정동 중심점 사이를 잇는 아크(호) 하나하나가 &ldquo;A동에서 타서
              B동에 내린&rdquo; 이동 묶음이고, 굵을수록 그런 이동이 많았다는
              뜻입니다. 이 화면이 드러내는 것은 교통약자의{" "}
              <b>생활권</b>입니다 — 집과 병원, 집과 복지관을 잇는 굵은 아크
              몇 개가 반복되면 그것이 곧 한 사람의 일상 동선입니다. 특히 부산
              바깥(관외)으로 뻗는 아크, 예컨대 양산부산대병원 방향의 흐름은
              &ldquo;시내 인프라만 보아서는 놓치는 의료 수요&rdquo;가
              있음을 보여줍니다.
            </p>
            <p className="mt-2">
              <b>어떻게 활용하나</b> — 공단은 굵은 아크의 양 끝을 차량 순환
              경로·대기 지점 설계에 쓸 수 있고, 구청은 우리 동 주민이 어느
              동의 시설로 이동하는지(우리 동에 없는 무엇을 찾아 나가는지)를
              읽을 수 있습니다. 목록에서 동을 클릭하면 그 동을 오가는 흐름만
              걸러 보입니다.
            </p>
          </>
        }
        how={
          <>
            <p>
              완료된 운행의 승차 행정동 → 하차 행정동 쌍을 집계하고, 상위{" "}
              {fmt(od.data.length)}개 흐름을 각 동의 중심점 좌표로 이어
              그렸습니다. 개별 운행 경로가 아니라 동 단위 집계이므로 특정인의
              이동을 추적할 수 없습니다. 아크 굵기는 건수의 제곱근에 비례해,
              최대 흐름이 화면을 덮지 않으면서도 작은 흐름이 사라지지 않게
              했습니다. 초록 끝이 출발, 하늘색 끝이 도착입니다.
            </p>
          </>
        }
        caveats={
          <>
            <p>
              중요한 주의점: <b>본선 데이터에는 출발지 좌표가 없습니다</b>{" "}
              (도착지 좌표만 제공). 따라서 이 OD 화면은 출발지가 포함된 공개
              5월 데이터(부산시 전역) 기준이며, 본선에서는 참고 씬으로만
              쓰고 본 분석은 도착지 기반 씬(도착지 사각지대·잠재수요)으로
              전개합니다. 동 중심점끼리 이은 직선은 실제 주행 경로가 아니라
              &ldquo;어디서 어디로&rdquo;의 요약입니다. 상위 흐름만 표시하므로
              가늘고 드문 이동은 화면에 없습니다.
            </p>
          </>
        }
      />
    </div>
  );
}
