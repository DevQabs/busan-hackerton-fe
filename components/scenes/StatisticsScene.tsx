"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { GeoJsonLayer } from "deck.gl";
import type { Layer } from "@deck.gl/core";
import {
  DATA,
  type DisabilityData,
  type DongProps,
  type ModelResult,
} from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt, pct } from "@/lib/format";
import { HEX } from "@/lib/palette";
import {
  tooltipHtml,
  type DongCollection,
  type FlyTo,
  type MapSpec,
} from "@/lib/mapspec";
import { chargerIrr, findModel } from "@/lib/model";
import { DataPending } from "@/components/ui/DataPending";
import { Explainer } from "@/components/ui/Explainer";
import {
  ActionCard,
  KpiTile,
  MapToolbar,
  PresentationLayout,
} from "@/components/PresentationLayout";

// 통계 대시보드 — the decision screen: priority map on the left, the THREE
// proofs that carry the argument on the right, and the selected 행정동 with its
// uncertainty + proposed action along the bottom. Everything else (the other
// four fits, the methodology) hides in one collapsible.

/** the three results that carry the story: 문제 규모 → 효과 크기 → 순위 신뢰 */
const HEADLINE_IDS = ["retry-funnel", "nb-regression", "bootstrap-stability"];

const PROOF_ROLE: Record<string, string> = {
  "retry-funnel": "① 문제 규모",
  "nb-regression": "② 개선 효과",
  "bootstrap-stability": "③ 순위 신뢰도",
};

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
    <div className="relative h-[6px] w-full min-w-[48px] rounded-full bg-line/60">
      {ci && (
        <div
          className="absolute top-0 h-full rounded-full bg-accent/35"
          style={{
            left: `${x(ci[0])}%`,
            width: `${Math.max(x(ci[1]) - x(ci[0]), 1.5)}%`,
          }}
        />
      )}
      <div
        className="absolute top-1/2 h-[10px] w-[3px] -translate-y-1/2 rounded-sm bg-accent"
        style={{ left: `calc(${x(point)}% - 1.5px)` }}
      />
    </div>
  );
}

export function StatisticsScene({
  onMapSpec,
  map,
}: {
  onMapSpec: (spec: MapSpec) => void;
  map: ReactNode;
}) {
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);
  const models = useData<ModelResult[]>(DATA.modelResults);
  const disability = useData<DisabilityData>(DATA.disability);

  const [selectedCd, setSelectedCd] = useState<string | null>(null);
  const [adds, setAdds] = useState(0); // +K chargers on the selected dong
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);

  const all = useMemo(
    () => dongs.data?.features.map((f) => f.properties) ?? [],
    [dongs.data],
  );

  const ranked = useMemo(
    () => [...all].sort((a, b) => b.gapScore - a.gapScore),
    [all],
  );
  const rankOf = useMemo(() => {
    const m = new Map<string, number>();
    ranked.forEach((p, i) => m.set(p.admCd, i + 1));
    return m;
  }, [ranked]);

  const sel = useMemo(
    () => all.find((p) => p.admCd === selectedCd) ?? null,
    [all, selectedCd],
  );

  const top20 = useMemo(() => ranked.slice(0, 20), [ranked]);
  const ciScale = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const p of top20) {
      const lo = p.gapCI ? p.gapCI[0] : p.gapScore;
      const hi = p.gapCI ? p.gapCI[1] : p.gapScore;
      if (lo < min) min = lo;
      if (hi > max) max = hi;
    }
    return Number.isFinite(min) && Number.isFinite(max)
      ? { min, max }
      : { min: 0, max: 1 };
  }, [top20]);

  const irr = useMemo(() => chargerIrr(models.data), [models.data]);

  const proofs = useMemo(
    () =>
      HEADLINE_IDS.map((id) => findModel(models.data, id)).filter(
        (m): m is ModelResult => m !== null,
      ),
    [models.data],
  );
  const otherModels = useMemo(
    () => (models.data ?? []).filter((m) => !HEADLINE_IDS.includes(m.id)),
    [models.data],
  );
  const confirmed = (models.data ?? []).filter((m) => m.status === "final").length;

  const guDemand = useMemo(() => {
    if (!sel) return null;
    return disability.data?.gus.find((g) => g.gu === sel.gu) ?? null;
  }, [sel, disability.data]);

  const predicted =
    sel && irr && adds > 0
      ? {
          mid: sel.dropoffs * irr.irr ** adds,
          lo: sel.dropoffs * irr.lo ** adds,
          hi: sel.dropoffs * irr.hi ** adds,
        }
      : null;

  // ── layers ──────────────────────────────────────────────────────────────
  const layers = useMemo<Layer[]>(() => {
    if (!dongs.data) return [];
    const scores = all.map((p) => p.gapScore);
    const min = Math.min(...scores, 0);
    const max = Math.max(...scores, 1);
    return [
      new GeoJsonLayer<DongProps>({
        id: "stats-choro",
        data: dongs.data as never,
        pickable: true,
        stroked: true,
        filled: true,
        getFillColor: (f) => {
          const t = (f.properties.gapScore - min) / (max - min || 1);
          return [229, 72, 77, Math.round(15 + t * 195)];
        },
        getLineColor: (f) =>
          f.properties.admCd === selectedCd
            ? [34, 211, 238, 255]
            : [11, 15, 26, 170],
        getLineWidth: (f) => (f.properties.admCd === selectedCd ? 2.5 : 1),
        lineWidthUnits: "pixels",
        autoHighlight: true,
        highlightColor: [255, 255, 255, 55],
        onClick: (info) => {
          const p = (info.object as { properties?: DongProps } | undefined)
            ?.properties;
          if (!p) return;
          setSelectedCd((current) => (current === p.admCd ? null : p.admCd));
          setAdds(0);
        },
        updateTriggers: {
          getLineColor: [selectedCd],
          getLineWidth: [selectedCd],
        },
      }),
    ];
  }, [dongs.data, all, selectedCd]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      const p = (info.object as { properties?: DongProps } | undefined)
        ?.properties;
      if (!p) return null;
      return tooltipHtml(
        `<b>${p.gu} ${p.name}</b> · 격차 ${rankOf.get(p.admCd)}위<br/>` +
          `격차점수 ${p.gapScore.toFixed(2)}` +
          (p.gapCI ? ` · 90% CI [${p.gapCI[0].toFixed(2)}, ${p.gapCI[1].toFixed(2)}]` : "") +
          (p.pTop5 !== null
            ? `<br/>상위5 확률 ${pct(p.pTop5, 0)}`
            : ""),
      );
    };
  }, [rankOf]);

  useEffect(() => {
    onMapSpec({ layers, getTooltip, flyTo });
  }, [layers, getTooltip, flyTo, onMapSpec]);

  // ── KPI band ────────────────────────────────────────────────────────────
  const kpis = (
    <div className="grid grid-cols-4 gap-2">
      <KpiTile
        label="격차점수 1위"
        value={ranked[0] ? ranked[0].name : "—"}
        sub={
          ranked[0]
            ? `${ranked[0].gu} · ${ranked[0].gapScore.toFixed(2)}점`
            : undefined
        }
        color={HEX.gapHL}
      />
      <KpiTile
        label="순위가 흔들리지 않는 동"
        value={
          all.length
            ? `${fmt(all.filter((p) => (p.pTop5 ?? 0) >= 0.7).length)}개`
            : "—"
        }
        sub="상위5 확률 70% 이상"
        color={HEX.accent}
      />
      <KpiTile
        label="통계 분석"
        value={models.data ? `${fmt(models.data.length)}개` : "—"}
        sub={models.data ? `최종 확정 ${fmt(confirmed)}개 · 나머지 리허설` : undefined}
        color={HEX.warn}
      />
      <KpiTile
        label="확인 등록 장애인"
        value={
          disability.data
            ? `${fmt(disability.data.totals.registeredKnown)}명`
            : "—"
        }
        sub={
          disability.data
            ? `등록현황 확보 ${fmt(disability.data.totals.guWithRegistry)}개 구·군`
            : undefined
        }
        color={HEX.infra}
      />
    </div>
  );

  const toolbar = (
    <MapToolbar label="개선 우선순위 지도">
      <span className="flex items-center gap-2 text-[11px] text-ink">
        <span className="flex items-center gap-1">
          <span
            className="h-2 w-6 rounded-sm"
            style={{ background: `${HEX.gapHL}33` }}
          />
          낮음
        </span>
        <span className="flex items-center gap-1">
          <span
            className="h-2 w-6 rounded-sm"
            style={{ background: HEX.gapHL }}
          />
          격차 높음
        </span>
      </span>
      <span className="text-[10px] text-dim">
        동 클릭 = 아래에 근거·조치 표시
      </span>
    </MapToolbar>
  );

  // ── right column: the three proofs ──────────────────────────────────────
  const side: ReactNode = !models.data ? (
    <DataPending note="model_results.json 대기 중 — 핵심 통계 근거가 표시됩니다." />
  ) : (
    <div className="space-y-3">
      {proofs.map((m) => (
        <article
          key={m.id}
          className="rounded-lg border border-line bg-panel px-3.5 py-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold text-accent">
              {PROOF_ROLE[m.id] ?? "근거"}
            </span>
            <span className="rounded border border-line px-1.5 py-0.5 text-[9px] text-dim">
              {m.status === "final"
                ? "확정"
                : m.status === "rehearsal"
                  ? "리허설"
                  : "대기"}
            </span>
          </div>
          <h3 className="mt-1 text-[13px] font-bold leading-5 text-ink">
            {m.headline}
          </h3>
          <p className="mt-1 text-[11px] leading-4 text-dim">{m.detail}</p>
          {m.caveats && (
            <p className="mt-1 text-[10px] leading-4 text-warn/90">
              주의: {m.caveats}
            </p>
          )}
        </article>
      ))}

      <details className="rounded-lg border border-line bg-panel">
        <summary className="cursor-pointer px-3.5 py-2.5 text-[12px] font-semibold text-ink">
          그 외 분석 {fmt(otherModels.length)}개
        </summary>
        <div className="space-y-2 border-t border-line px-3.5 py-2.5">
          {otherModels.map((m) => (
            <div key={m.id}>
              <div className="text-[11px] font-semibold text-dim">{m.name}</div>
              <div className="text-[11.5px] leading-4 text-ink">{m.headline}</div>
            </div>
          ))}
        </div>
      </details>

      <section className="overflow-hidden rounded-lg border border-line bg-panel">
        <header className="flex items-center justify-between border-b border-line px-3 py-2">
          <h3 className="text-[12px] font-semibold text-ink">격차점수 상위 20개 동</h3>
          <span className="text-[10px] text-dim">행 클릭 = 선택</span>
        </header>
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="border-b border-line text-[10px] text-dim">
              <th className="px-2 py-1 text-left font-medium">순위</th>
              <th className="px-1 py-1 text-left font-medium">행정동</th>
              <th className="px-1 py-1 text-right font-medium">격차</th>
              <th className="px-1 py-1 text-right font-medium">상위5</th>
              <th className="px-2 py-1 text-left font-medium">90% CI</th>
            </tr>
          </thead>
          <tbody>
            {top20.map((p) => {
              const active = p.admCd === selectedCd;
              return (
                <tr
                  key={p.admCd}
                  onClick={() => {
                    setSelectedCd(active ? null : p.admCd);
                    setAdds(0);
                    if (!active)
                      setFlyTo({
                        longitude: p.centroid[0],
                        latitude: p.centroid[1],
                        zoom: 12.6,
                      });
                  }}
                  className={`cursor-pointer border-b border-line/60 last:border-b-0 ${
                    active ? "bg-accent/10" : "hover:bg-[#161e30]"
                  }`}
                >
                  <td className="tnum px-2 py-1 text-dim">
                    {rankOf.get(p.admCd)}
                  </td>
                  <td className="px-1 py-1">
                    <span className={active ? "font-semibold text-accent" : "text-ink"}>
                      {p.name}
                    </span>
                    <span className="ml-1 text-[9.5px] text-dim">{p.gu}</span>
                  </td>
                  <td className="tnum px-1 py-1 text-right font-medium text-ink">
                    {p.gapScore.toFixed(2)}
                  </td>
                  <td
                    className={`tnum px-1 py-1 text-right ${
                      (p.pTop5 ?? 0) >= 0.7 ? "font-bold text-accent" : "text-dim"
                    }`}
                  >
                    {p.pTop5 === null ? "—" : pct(p.pTop5, 0)}
                  </td>
                  <td className="w-[64px] px-2 py-1">
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
      </section>

      <Explainer
        what={
          <p>
            &ldquo;예산이 한정돼 있다면 어느 동부터인가&rdquo;에 답하는 화면입니다.
            지도 색은 격차점수(수요 대비 인프라 부족의 합성 지표), 오른쪽 세 카드는
            그 우선순위를 지지하는 <b>문제 규모 · 개선 효과 · 순위 신뢰도</b>의
            근거이고, 아래 줄은 선택한 동의 수치와 권고 조치입니다.
          </p>
        }
        how={
          <p>
            격차점수 = z(하차) − 인프라 z + 0.5·z(미배차). 90% CI와 상위5
            확률(pTop5)은 5월 데이터를 <b>일(day) 단위로 500회 재표집</b>해 순위가
            얼마나 흔들리는지 잰 결과입니다. 충전소 +K기 예측은 음이항 회귀의
            IRR{irr ? ` ${irr.irr.toFixed(3)}` : ""}을 K번 곱한 값이며, 괄호의
            95% 구간은 그 배수 자체의 불확실성입니다. 등록 장애인 수요는 9개
            구·군의 등록현황 원자료와 두리발 이용을 교차한 값입니다.
          </p>
        }
        caveats={
          <p>
            IRR은 <b>관찰 데이터의 연관성이며 인과 효과가 아닙니다</b> — 설치하면
            정확히 그만큼 늘어난다는 보장이 아니라 기대치입니다. CI가 길게 겹치는
            동들의 순위 차이는 사실상 동률로 읽어야 하고, 등록현황 미공개 7개
            구·군은 등록 수요 칸이 비어 있습니다(0이 아님). 모든 수치는 리허설
            데이터(2025년 5월) 기준이며 본선 데이터로 재적합합니다.
          </p>
        }
      />
    </div>
  );

  // ── bottom strip: selected dong + proposed action ───────────────────────
  const action = (() => {
    if (!sel)
      return {
        label: "격차 상위 동부터 선택",
        owner: "—",
        impact: "지도나 순위표에서 행정동을 선택하세요.",
      };
    if (sel.chargers === 0)
      return {
        label: "전동휠체어 급속충전기 신설 (0기 → 1기)",
        owner: "구청·윌체어",
        impact: predicted
          ? `월 하차 ${fmt(sel.dropoffs)} → ${fmt(predicted.mid)}건 (95% CI ${fmt(predicted.lo)}–${fmt(predicted.hi)})`
          : `+K기를 선택하면 NB 회귀 IRR로 기대 효과가 계산됩니다.`,
      };
    if (sel.welfare === 0)
      return {
        label: "복지시설·프로그램 순회 배치",
        owner: "구청",
        impact: `이 동 복지시설 0곳 · 하차 ${fmt(sel.dropoffs)}건`,
      };
    if (sel.suppressedZ !== null && sel.suppressedZ < -1)
      return {
        label: "잠재수요 조사 (기대보다 이용이 적은 동)",
        owner: "공단·구청",
        impact: `NB 잔차 z ${sel.suppressedZ.toFixed(2)} — 기대치보다 이용이 적습니다.`,
      };
    return {
      label: "충전소 +1기 우선 검토",
      owner: "구청·윌체어",
      impact: predicted
        ? `월 하차 ${fmt(sel.dropoffs)} → ${fmt(predicted.mid)}건 (95% CI ${fmt(predicted.lo)}–${fmt(predicted.hi)})`
        : "+K기를 선택하면 기대 효과가 계산됩니다.",
    };
  })();

  const bottom = (
    <div className="flex items-stretch gap-3">
      {sel ? (
        <div className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[14px] font-bold leading-5 text-ink">
              {sel.gu} {sel.name}
            </h2>
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-4"
              style={{ color: HEX.gapHL, background: `${HEX.gapHL}1f` }}
            >
              격차 {rankOf.get(sel.admCd)}위
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedCd(null);
                setAdds(0);
              }}
              className="ml-auto shrink-0 text-[10.5px] text-accent hover:underline"
            >
              선택 해제
            </button>
          </div>
          <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
            {(
              [
                ["격차점수", sel.gapScore.toFixed(2)],
                [
                  "90% 신뢰구간",
                  sel.gapCI
                    ? `[${sel.gapCI[0].toFixed(2)}, ${sel.gapCI[1].toFixed(2)}]`
                    : "—",
                ],
                ["상위5 확률", sel.pTop5 === null ? "—" : pct(sel.pTop5, 0)],
                [
                  `${sel.gu} 등록 장애인`,
                  guDemand?.registered != null
                    ? `${fmt(guDemand.registered)}명`
                    : "원자료 미공개",
                ],
                [
                  "등록 1천명당 이용",
                  guDemand?.tripsPer1k != null
                    ? `${guDemand.tripsPer1k.toFixed(1)}건/월`
                    : "—",
                ],
                ["충전소·복지시설", `${fmt(sel.chargers)}·${fmt(sel.welfare)}개`],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-1.5">
                <dt className="text-[10.5px] text-dim">{k}</dt>
                <dd className="tnum text-[12px] font-semibold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="text-[10px] text-dim">충전소 시뮬</span>
            {[1, 2, 3].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setAdds(adds === k ? 0 : k)}
                className={`rounded border px-2 py-0.5 text-[10.5px] font-semibold ${
                  adds === k
                    ? "border-infra bg-infra/25 text-infra"
                    : "border-infra/40 bg-infra/10 text-infra hover:bg-infra/20"
                }`}
              >
                +{k}기
              </button>
            ))}
            {!irr && (
              <span className="text-[10px] text-dim">
                model_results.json의 IRR 대기 중
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center rounded-lg border border-dashed border-line bg-panel/40 px-3.5 py-2.5 text-[11.5px] leading-5 text-dim">
          지도의 동을 클릭하면 격차점수·신뢰구간·상위5 확률·등록 수요와 권고
          조치가 여기 한 줄로 정리됩니다.
        </div>
      )}
      <ActionCard
        eyebrow="권고 조치"
        action={action.label}
        owner={action.owner}
        impact={action.impact}
      />
    </div>
  );

  if (!dongs.data) {
    return (
      <PresentationLayout
        question="예산이 한정돼 있다면 어느 동부터인가?"
        kpis={kpis}
        map={map}
        side={
          <DataPending note="dongs.geojson 대기 중 — 우선순위 지도와 근거가 표시됩니다." />
        }
      />
    );
  }

  return (
    <PresentationLayout
      question="예산이 한정돼 있다면 어느 동부터인가?"
      hint="우선순위 지도 · 세 가지 근거 · 선택한 동의 조치."
      kpis={kpis}
      toolbar={toolbar}
      map={map}
      side={side}
      bottom={bottom}
      footnote="리허설 수치(2025년 5월 부산 전역 공개 데이터)입니다. model_results.json을 본선 산출물로 교체하면 상태가 '확정'으로 바뀝니다."
    />
  );
}
