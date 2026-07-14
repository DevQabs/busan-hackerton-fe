"use client";

import { useEffect, useMemo, useState } from "react";
import { GeoJsonLayer } from "deck.gl";
import { DATA, type DongProps, type ModelResult } from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt, pct, signed } from "@/lib/format";
import { HEX } from "@/lib/palette";
import { tooltipHtml, type DongCollection, type MapSpec } from "@/lib/mapspec";
import { chargerIrr } from "@/lib/model";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";
import { Explainer } from "@/components/ui/Explainer";

type SortKey = "rank" | "name" | "gu" | "score" | "ptop5";

/** Badges for missing infra elements (부족 요소). */
function shortageBadges(p: DongProps): string[] {
  const out: string[] = [];
  if (p.chargers === 0) out.push("충전소 0");
  if (p.hospitals === 0) out.push("병의원 0");
  if (p.pharmacies === 0) out.push("약국 0");
  if (p.welfare === 0) out.push("복지 0");
  return out;
}

/** Slim horizontal band for a bootstrap CI, on a scale shared by all rows. */
function CiBar({
  ci,
  point,
  min,
  max,
}: {
  ci: [number, number] | null;
  point: number;
  min: number;
  max: number;
}) {
  const span = max - min || 1;
  const x = (v: number) => Math.min(Math.max(((v - min) / span) * 100, 0), 100);
  return (
    <div className="relative h-[6px] w-full min-w-[56px] rounded-full bg-line/60">
      {ci && (
        <div
          className="absolute top-0 h-full rounded-full bg-accent/35"
          style={{ left: `${x(ci[0])}%`, width: `${Math.max(x(ci[1]) - x(ci[0]), 1.5)}%` }}
        />
      )}
      <div
        className="absolute top-1/2 h-[10px] w-[3px] -translate-y-1/2 rounded-sm bg-accent"
        style={{ left: `calc(${x(point)}% - 1.5px)` }}
      />
    </div>
  );
}

export function PriorityScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);
  const models = useData<ModelResult[]>(DATA.modelResults);

  const [selected, setSelected] = useState<string | null>(null);
  const [adds, setAdds] = useState<Record<string, number>>({}); // admCd → +K chargers
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortAsc, setSortAsc] = useState(true);

  const irr = useMemo(() => chargerIrr(models.data), [models.data]);

  const all = useMemo(
    () => (dongs.data ? dongs.data.features.map((f) => f.properties) : []),
    [dongs.data],
  );

  // Secondary (legacy) re-rank approximation: infraZ as the mean of the four
  // component z-scores, so +1 charger shifts z(chargers) by 1/σ_chargers and
  // ΔgapScore = −1/(4·σ_chargers). Kept as a supporting line under the
  // IRR-driven prediction.
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
        case "ptop5":
          return ((a.pTop5 ?? -1) - (b.pTop5 ?? -1)) * dir;
        default:
          return ((origRank.get(a.admCd) ?? 0) - (origRank.get(b.admCd) ?? 0)) * dir;
      }
    });
  }, [all, sortKey, sortAsc, origRank]);

  // Shared scale for the inline CI bars: cover every band in the table.
  const ciScale = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const p of top20) {
      const lo = p.gapCI ? p.gapCI[0] : p.gapScore;
      const hi = p.gapCI ? p.gapCI[1] : p.gapScore;
      if (lo < min) min = lo;
      if (hi > max) max = hi;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
    return { min, max };
  }, [top20]);

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
          setSortAsc(key !== "score" && key !== "ptop5"); // metrics read best descending
        }
      }}
    >
      {label}
      {sortKey === key ? (sortAsc ? " ↑" : " ↓") : ""}
    </th>
  );

  const added = sel ? (adds[sel.admCd] ?? 0) : 0;

  // IRR-driven prediction for the selected dong at K added chargers.
  const predicted =
    sel && irr && added > 0
      ? {
          mid: sel.dropoffs * irr.irr ** added,
          lo: sel.dropoffs * irr.lo ** added,
          hi: sel.dropoffs * irr.hi ** added,
        }
      : null;

  return (
    <div className="space-y-3">
      <Section title="개선 시뮬레이션 — 충전소 +K기">
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
              월 하차 {fmt(sel.dropoffs)}건
            </div>

            {/* K selector — diminishing emphasis for larger K (마지막 1기의
                한계 효과는 첫 1기보다 불확실하다는 시각적 힌트) */}
            <div className="mt-2.5 flex items-center gap-2">
              {[1, 2, 3].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setAdds((a) => ({ ...a, [sel.admCd]: k }))}
                  style={{ opacity: added === k ? 1 : 1 - (k - 1) * 0.22 }}
                  className={`rounded-md border px-3 py-1.5 text-[12px] font-semibold ${
                    added === k
                      ? "border-infra bg-infra/25 text-infra"
                      : "border-infra/50 bg-infra/10 text-infra hover:bg-infra/20"
                  }`}
                >
                  +{k}기
                </button>
              ))}
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
              <div className="text-[11px] text-dim">모델 예측 (NB 회귀 IRR 기반)</div>
              {predicted ? (
                <>
                  <div className="tnum mt-0.5 text-[15px] font-bold leading-6 text-ink">
                    충전소 +{added}기 → 월 하차 {fmt(sel.dropoffs)}건 →{" "}
                    <span className="text-infra">{fmt(predicted.mid)}건</span>
                  </div>
                  <div className="tnum mt-0.5 text-[11px] text-dim">
                    95% CI {fmt(predicted.lo)}–{fmt(predicted.hi)}건 · 연관 기반 추정
                    {irr && ` (1기당 ×${irr.irr.toFixed(3)})`}
                  </div>
                </>
              ) : (
                <div className="mt-0.5 text-[12px] leading-5 text-dim">
                  {irr
                    ? "위에서 +1/+2/+3기를 선택하면 음이항 회귀의 IRR로 하차 건수 변화를 신뢰구간과 함께 예측합니다."
                    : "model_results.json 대기 중 — NB 회귀 IRR이 로드되면 예측이 표시됩니다."}
                </div>
              )}

              {/* secondary: legacy gapScore re-rank */}
              <div className="tnum mt-2 border-t border-line/60 pt-1.5 text-[11px] text-dim">
                격차 순위 {origRank.get(sel.admCd)}위
                {added > 0 && (
                  <>
                    {" "}
                    → <span className="text-infra">{simRank.get(sel.admCd)}위</span> · 격차점수{" "}
                    {sel.gapScore.toFixed(2)} →{" "}
                    {(simScore.get(sel.admCd) ?? sel.gapScore).toFixed(2)} (1기당 −
                    {deltaPerCharger.toFixed(2)})
                  </>
                )}
              </div>
            </div>

            <p className="mt-2 text-[10px] leading-4 text-dim">
              몇 기를 어디에 둘지는 행정동 단위가 아니라{" "}
              <b className="text-ink">&ldquo;도착지 사각지대&rdquo; 화면의 그리디 후보
              지점</b>(250m 격자 커버리지 최대화)을 따르는 것이 좋습니다. 이 패널은
              동 단위의 기대 효과 크기를 가늠하는 용도입니다.
            </p>
          </div>
        ) : (
          <p className="text-[12px] leading-5 text-dim">
            아래 표나 지도에서 행정동을 선택한 뒤 <b className="text-infra">+1/+2/+3기</b>
            를 누르면 음이항 회귀 IRR로 예측한 하차 건수 변화(신뢰구간 포함)와
            격차 순위 변화를 즉시 보여줍니다.
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
                {header("score", "격차", true)}
                {header("ptop5", "상위5 확률", true)}
                <th className="px-2 py-1.5 text-left font-medium">90% CI</th>
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
                      <span className="ml-1 text-[10px] text-dim">{p.gu}</span>
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
                    <td className="tnum px-2 py-1.5 text-right font-medium text-ink">
                      {p.gapScore.toFixed(2)}
                    </td>
                    <td
                      className={`tnum px-2 py-1.5 text-right ${
                        p.pTop5 !== null && p.pTop5 >= 0.7
                          ? "font-bold text-accent"
                          : "text-dim"
                      }`}
                    >
                      {p.pTop5 === null ? "—" : pct(p.pTop5, 0)}
                    </td>
                    <td className="w-[72px] px-2 py-1.5">
                      <CiBar
                        ci={p.gapCI}
                        point={p.gapScore}
                        min={ciScale.min}
                        max={ciScale.max}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Explainer
        what={
          <>
            <p>
              이 화면은 &ldquo;예산이 한정돼 있다면 어느 동부터 손대야
              하는가&rdquo;에 대한 표입니다. 격차점수는 수요 대비 인프라 부족의
              합성 지표이고, 그 옆의 <b className="text-ink">상위5 확률</b>과
              신뢰구간 막대는 &ldquo;이 순위를 믿어도 되는가&rdquo;를 보여주는
              장치입니다. 상단 시뮬레이션은 선택한 동에 충전소를 1~3기 더 놓았을
              때 월 하차 건수가 통계 모델상 얼마나 늘어날 것으로 기대되는지를
              신뢰구간과 함께 보여줍니다.
            </p>
          </>
        }
        how={
          <>
            <p>
              시뮬레이션의 배수는 음이항 회귀에서 나온{" "}
              <b className="text-ink">IRR(발생률비)</b>입니다. IRR{" "}
              {irr ? irr.irr.toFixed(3) : "1.223"}은 &ldquo;다른 조건이 같을 때
              충전소가 1기 많은 동은 하차 건수가 약{" "}
              {irr ? `${((irr.irr - 1) * 100).toFixed(0)}%` : "22%"} 많다&rdquo;는
              뜻이고, +K기는 IRR을 K번 곱해(복리처럼) 계산합니다. 괄호의 95%
              신뢰구간은 이 배수 자체의 불확실성{irr &&
                ` (${irr.lo.toFixed(2)}–${irr.hi.toFixed(2)})`}
              을 그대로 전달한 것입니다 — 점 추정 하나만 보여주면 실제보다
              확실해 보이기 때문입니다. 표의 상위5 확률(pTop5)과 CI 막대는 5월
              데이터를 일 단위로 500회 재표집(부트스트랩)해 순위가 얼마나
              흔들리는지 잰 결과입니다: pTop5가 100%면 어떤 재표집에서도 그 동이
              상위 5위 안에 들었다는 뜻입니다.
            </p>
          </>
        }
        caveats={
          <>
            <p>
              IRR은 <b className="text-ink">관찰 데이터의 연관성이지 인과 효과가
              아닙니다</b> — 충전소를 실제로 설치했을 때 이용이 정확히 그만큼
              늘어난다는 보장은 없고, &ldquo;충전소가 많은 동이 이용도 많더라&rdquo;는
              패턴을 근거로 한 기대치입니다. 예산 담당자라면 이렇게 읽으시길
              권합니다: pTop5가 굵게 표시된(70% 이상) 동은 데이터가 흔들려도
              우선순위가 유지되는 안전한 선택이고, CI 막대가 길게 겹치는 동들
              사이의 순위 차이는 사실상 동률입니다. 격차 순위 변화(둘째 줄)는
              발표용 근사 공식이라 참고 지표로만 보세요. 수치는 리허설
              데이터(2025년 5월, 부산 전역) 기준이며 본선 데이터로 재적합합니다.
            </p>
          </>
        }
      />
    </div>
  );
}
