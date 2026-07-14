"use client";

import { useEffect, useMemo, useState } from "react";
import { GeoJsonLayer } from "deck.gl";
import { DATA, type DongProps } from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt, signed } from "@/lib/format";
import { HEX } from "@/lib/palette";
import { tooltipHtml, type DongCollection, type MapSpec } from "@/lib/mapspec";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";

type SortKey = "rank" | "name" | "gu" | "score";

/** Badges for missing infra elements (부족 요소). */
function shortageBadges(p: DongProps): string[] {
  const out: string[] = [];
  if (p.chargers === 0) out.push("충전소 0");
  if (p.hospitals === 0) out.push("병의원 0");
  if (p.pharmacies === 0) out.push("약국 0");
  if (p.welfare === 0) out.push("복지 0");
  return out;
}

export function PriorityScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);

  const [selected, setSelected] = useState<string | null>(null);
  const [adds, setAdds] = useState<Record<string, number>>({}); // admCd → +chargers
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortAsc, setSortAsc] = useState(true);

  const all = useMemo(
    () => (dongs.data ? dongs.data.features.map((f) => f.properties) : []),
    [dongs.data],
  );

  // Approximation embedded at load: treat infraZ as the mean of the four
  // component z-scores (충전소/병의원/약국/복지). Adding one charger shifts
  // z(chargers) by 1/σ_chargers, so ΔinfraZ = 1/(4·σ_chargers) and — since
  // gapScore = z(demand) − z(infra) + 0.5·z(unmet) — ΔgapScore = −ΔinfraZ.
  const chargerSd = useMemo(() => {
    if (all.length === 0) return 1;
    const raw = all.map((p) => p.chargers);
    const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
    const varc = raw.reduce((a, b) => a + (b - mean) ** 2, 0) / raw.length;
    return Math.sqrt(varc) || 1;
  }, [all]);

  const deltaPerCharger = 1 / (4 * chargerSd); // ΔgapScore per added charger

  const simScore = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of all)
      m.set(p.admCd, p.gapScore - (adds[p.admCd] ?? 0) * deltaPerCharger);
    return m;
  }, [all, adds, deltaPerCharger]);

  const origRank = useMemo(() => {
    const m = new Map<string, number>();
    [...all]
      .sort((a, b) => b.gapScore - a.gapScore)
      .forEach((p, i) => m.set(p.admCd, i + 1));
    return m;
  }, [all]);

  const simRank = useMemo(() => {
    const m = new Map<string, number>();
    [...all]
      .sort((a, b) => (simScore.get(b.admCd) ?? 0) - (simScore.get(a.admCd) ?? 0))
      .forEach((p, i) => m.set(p.admCd, i + 1));
    return m;
  }, [all, simScore]);

  const top20 = useMemo(() => {
    const rows = [...all]
      .sort((a, b) => b.gapScore - a.gapScore)
      .slice(0, 20);
    const dir = sortAsc ? 1 : -1;
    return rows.sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.name.localeCompare(b.name, "ko") * dir;
        case "gu":
          return a.gu.localeCompare(b.gu, "ko") * dir;
        case "score":
          return (a.gapScore - b.gapScore) * dir;
        default:
          return ((origRank.get(a.admCd) ?? 0) - (origRank.get(b.admCd) ?? 0)) * dir;
      }
    });
  }, [all, sortKey, sortAsc, origRank]);

  const sel = useMemo(
    () => all.find((p) => p.admCd === selected) ?? null,
    [all, selected],
  );

  const layers = useMemo(() => {
    if (!dongs.data) return [];
    const scores = all.map((p) => simScore.get(p.admCd) ?? p.gapScore);
    const min = Math.min(...scores, 0);
    const max = Math.max(...scores, 1);
    return [
      new GeoJsonLayer<DongProps>({
        id: "priority-choro",
        data: dongs.data as never,
        pickable: true,
        stroked: true,
        getFillColor: (f) => {
          const s = simScore.get(f.properties.admCd) ?? f.properties.gapScore;
          const t = (s - min) / (max - min || 1);
          return [229, 72, 77, Math.round(15 + t * 190)];
        },
        getLineColor: (f) =>
          f.properties.admCd === selected ? [34, 211, 238, 255] : [11, 15, 26, 170],
        getLineWidth: (f) => (f.properties.admCd === selected ? 2.5 : 1),
        lineWidthUnits: "pixels",
        onClick: (info) => {
          const f = info.object as { properties: DongProps } | undefined;
          if (f?.properties) setSelected(f.properties.admCd);
        },
        updateTriggers: {
          getFillColor: [adds],
          getLineColor: [selected],
          getLineWidth: [selected],
        },
      }),
    ];
  }, [dongs.data, all, simScore, selected, adds]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      const f = info.object as { properties: DongProps } | undefined;
      if (!f?.properties) return null;
      const p = f.properties;
      const r0 = origRank.get(p.admCd);
      const r1 = simRank.get(p.admCd);
      const rankTxt = r0 === r1 ? `${r0}위` : `${r0}위 → ${r1}위`;
      return tooltipHtml(`<b>${p.gu} ${p.name}</b><br/>격차 순위 ${rankTxt}`);
    };
  }, [origRank, simRank]);

  useEffect(() => {
    onMapSpec({ layers, getTooltip });
  }, [layers, getTooltip, onMapSpec]);

  if (!dongs.data) {
    return <DataPending note="dongs.geojson 대기 중 — 우선순위 표와 시뮬레이션이 표시됩니다." />;
  }

  const header = (key: SortKey, label: string, right?: boolean) => (
    <th
      className={`cursor-pointer select-none px-2 py-1.5 font-medium hover:text-ink ${
        right ? "text-right" : "text-left"
      } ${sortKey === key ? "text-accent" : ""}`}
      onClick={() => {
        if (sortKey === key) setSortAsc((a) => !a);
        else {
          setSortKey(key);
          setSortAsc(key !== "score"); // score reads best descending
        }
      }}
    >
      {label}
      {sortKey === key ? (sortAsc ? " ↑" : " ↓") : ""}
    </th>
  );

  const added = sel ? (adds[sel.admCd] ?? 0) : 0;

  return (
    <div className="space-y-3">
      <Section title="개선 시뮬레이션">
        {sel ? (
          <div>
            <div className="flex items-baseline justify-between">
              <div className="text-[13px] font-semibold text-ink">
                {sel.gu} {sel.name}
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-[11px] text-dim hover:text-ink"
              >
                선택 해제
              </button>
            </div>
            <div className="tnum mt-1 text-[11px] text-dim">
              충전소 {fmt(sel.chargers)}개 {added > 0 && `→ ${fmt(sel.chargers + added)}개`} ·
              인프라 z {signed(sel.infraZ)}
              {added > 0 && ` → ${signed(sel.infraZ + added * deltaPerCharger)}`}
            </div>

            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAdds((a) => ({ ...a, [sel.admCd]: (a[sel.admCd] ?? 0) + 1 }))}
                className="rounded-md border border-infra/50 bg-infra/10 px-3 py-1.5 text-[12px] font-semibold text-infra hover:bg-infra/20"
              >
                충전소 +1
              </button>
              {added > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setAdds((a) => {
                      const next = { ...a };
                      delete next[sel.admCd];
                      return next;
                    })
                  }
                  className="rounded-md border border-line px-3 py-1.5 text-[12px] text-dim hover:text-ink"
                >
                  초기화
                </button>
              )}
            </div>

            <div className="mt-3 rounded-md border border-line bg-[#0e1424] px-3 py-2.5">
              <div className="text-[11px] text-dim">격차 순위 변화</div>
              <div className="tnum mt-0.5 text-[18px] font-bold text-ink">
                {origRank.get(sel.admCd)}위
                {added > 0 && (
                  <>
                    {" "}
                    <span className="text-dim">→</span>{" "}
                    <span className="text-infra">{simRank.get(sel.admCd)}위</span>
                  </>
                )}
              </div>
              <div className="tnum mt-0.5 text-[11px] text-dim">
                격차점수 {sel.gapScore.toFixed(2)}
                {added > 0 &&
                  ` → ${(simScore.get(sel.admCd) ?? sel.gapScore).toFixed(2)} (충전소 1개당 −${deltaPerCharger.toFixed(2)})`}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-[12px] leading-5 text-dim">
            아래 표나 지도에서 행정동을 선택한 뒤 <b className="text-infra">충전소 +1</b>
            을 누르면 인프라 z점수와 격차 순위가 어떻게 바뀌는지 즉시 보여줍니다.
          </p>
        )}
      </Section>

      <Section title="격차점수 상위 20개 동" aside="열 클릭 = 정렬" flush>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-line text-[11px] text-dim">
                {header("rank", "순위")}
                {header("name", "행정동")}
                {header("gu", "구")}
                {header("score", "격차", true)}
              </tr>
            </thead>
            <tbody>
              {top20.map((p) => {
                const active = p.admCd === selected;
                const badges = shortageBadges(p);
                return (
                  <tr
                    key={p.admCd}
                    onClick={() => setSelected(active ? null : p.admCd)}
                    className={`cursor-pointer border-b border-line/60 last:border-b-0 ${
                      active ? "bg-accent/10" : "hover:bg-[#161e30]"
                    }`}
                  >
                    <td className="tnum px-2 py-1.5 text-dim">{origRank.get(p.admCd)}</td>
                    <td className="px-2 py-1.5">
                      <span className={active ? "font-semibold text-accent" : "text-ink"}>
                        {p.name}
                      </span>
                      {badges.length > 0 && (
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {badges.map((b) => (
                            <span
                              key={b}
                              className="rounded bg-unmet/10 px-1 py-px text-[10px] leading-4 text-unmet"
                            >
                              {b}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-dim">{p.gu}</td>
                    <td className="tnum px-2 py-1.5 text-right font-medium text-ink">
                      {p.gapScore.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <p className="px-1 text-[10px] leading-4 text-dim">
        시뮬레이션은 발표용 근사입니다: 격차점수 = z(수요) − z(인프라) + 0.5·z(미충족),
        인프라 z는 4개 시설 z점수 평균으로 보고 충전소 1개 추가 시 z점수
        +{deltaPerCharger.toFixed(2)} (σ충전소={chargerSd.toFixed(2)}, 전체 동 기준).
        최종 수치는 통계 모델 확정 후 파이프라인에서 재계산됩니다.
      </p>
    </div>
  );
}
