"use client";

import { useEffect, useMemo, useState } from "react";
import { GeoJsonLayer } from "deck.gl";
import { DATA, type DongProps, type ModelResult } from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt, pct, signed } from "@/lib/format";
import { HEX, RGB_GAP } from "@/lib/palette";
import {
  tooltipHtml,
  type DongCollection,
  type FlyTo,
  type MapSpec,
} from "@/lib/mapspec";
import {
  SUPPRESSED_GRADIENT,
  ciText,
  findModel,
  suppressedFill,
} from "@/lib/model";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";
import { Explainer } from "@/components/ui/Explainer";

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

type Mode = "observed" | "latent";

const MODE_LABEL: Record<Mode, string> = {
  observed: "관측 수요 (사각지대)",
  latent: "잠재 수요 (침묵 지도)",
};

export function GapScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);
  const models = useData<ModelResult[]>(DATA.modelResults);
  const [selected, setSelected] = useState<string | null>(null); // admCd
  const [mode, setMode] = useState<Mode>("observed");
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);

  const nb = findModel(models.data, "nb-regression");

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

  // Latent mode: dongs where the NB model has a residual, most-negative first
  // (observed ≪ expected = suppressed-demand candidates).
  const silent = useMemo(
    () =>
      ranked
        .filter((p) => p.suppressedZ !== null)
        .sort((a, b) => (a.suppressedZ ?? 0) - (b.suppressedZ ?? 0)),
    [ranked],
  );

  const maxAbsZ = useMemo(() => {
    let m = 0;
    for (const p of silent) m = Math.max(m, Math.abs(p.suppressedZ ?? 0));
    return m || 1;
  }, [silent]);

  const layers = useMemo(() => {
    if (!dongs.data) return [];
    return [
      new GeoJsonLayer<DongProps>({
        id: "gap-choro",
        data: dongs.data as never,
        pickable: true,
        stroked: true,
        getFillColor: (f) => {
          if (mode === "observed") return RGB_GAP[f.properties.gapClass];
          const z = f.properties.suppressedZ;
          if (z === null) return [24, 30, 46, 90]; // model skipped this dong
          return suppressedFill(z, maxAbsZ);
        },
        getLineColor: (f) =>
          f.properties.admCd === selected ? [34, 211, 238, 255] : [11, 15, 26, 180],
        getLineWidth: (f) => (f.properties.admCd === selected ? 2.5 : 1),
        lineWidthUnits: "pixels",
        onClick: (info) => {
          const f = info.object as { properties: DongProps } | undefined;
          if (f?.properties) setSelected(f.properties.admCd);
        },
        updateTriggers: {
          getFillColor: [mode, maxAbsZ],
          getLineColor: [selected],
          getLineWidth: [selected],
        },
      }),
    ];
  }, [dongs.data, selected, mode, maxAbsZ]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      const f = info.object as { properties: DongProps } | undefined;
      if (!f?.properties) return null;
      const p = f.properties;
      if (mode === "latent") {
        if (p.suppressedZ === null)
          return tooltipHtml(`<b>${p.gu} ${p.name}</b><br/>모델 잔차 없음`);
        return tooltipHtml(
          `<b>${p.gu} ${p.name}</b> · 잔차 z ${signed(p.suppressedZ)}<br/>` +
            `관측 ${fmt(p.dropoffs)}건 vs 기대 ${
              p.expectedDropoffs === null ? "—" : `${fmt(p.expectedDropoffs)}건`
            } · 클릭하면 상세`,
        );
      }
      return tooltipHtml(
        `<b>${p.gu} ${p.name}</b> · ${GAP_LABEL[p.gapClass]}<br/>격차점수 ${p.gapScore.toFixed(2)} · 클릭하면 상세`,
      );
    };
  }, [mode]);

  useEffect(() => {
    onMapSpec({ layers, getTooltip, flyTo });
  }, [layers, getTooltip, flyTo, onMapSpec]);

  if (!dongs.data) {
    return <DataPending note="dongs.geojson 대기 중 — 수요×인프라 사각지대 지도가 표시됩니다." />;
  }

  const hlCount = ranked.filter((p) => p.gapClass === "HL").length;

  const zoomTo = (p: DongProps) => {
    setSelected(p.admCd);
    setFlyTo({ longitude: p.centroid[0], latitude: p.centroid[1], zoom: 12.5 });
  };

  return (
    <div className="space-y-3">
      {/* ── observed ↔ latent segmented control ─────────────────────────── */}
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-panel p-1">
        {(["observed", "latent"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`rounded-md px-2 py-1.5 text-[11px] font-semibold leading-4 transition-colors ${
              mode === m
                ? "bg-accent/15 text-accent"
                : "text-dim hover:text-ink"
            }`}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      {mode === "observed" ? (
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
      ) : (
        <Section title="침묵 지도 — 모델 기대 대비 잔차" aside={`잔차 산출 ${silent.length}개 동`}>
          <div
            className="h-2.5 w-full rounded-full"
            style={{ background: SUPPRESSED_GRADIENT }}
          />
          <div className="mt-1 flex justify-between text-[10px] leading-4 text-dim">
            <span style={{ color: HEX.gapHL }}>관측 ≪ 기대 (침묵 의심)</span>
            <span>기대와 비슷</span>
            <span>관측 &gt; 기대</span>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-dim">
            색이 <b style={{ color: HEX.gapHL }}>붉게</b> 타오르는 동일수록 상가·시설
            규모로 예상되는 이용량에 비해 실제 두리발 하차가 훨씬 적은 곳입니다.
            &ldquo;수요가 없어서&rdquo;가 아니라 <b className="text-ink">갈 수 없어서
            기록이 남지 않았을 가능성</b>이 있는, 관측 수요 지도에는 보이지 않는
            후보 지역입니다. 푸른 쪽은 반대로 기대보다 이용이 많은 동입니다.
          </p>
        </Section>
      )}

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

          {/* bootstrap uncertainty for the headline score */}
          <div className="tnum mb-2 rounded-md border border-line bg-[#0e1424] px-3 py-2 text-[11px] leading-4 text-ink">
            gapScore {sel.gapScore.toFixed(2)}
            {sel.gapCI && <span className="text-dim"> (90% CI {ciText(sel.gapCI)})</span>}
            {sel.pTop5 !== null && (
              <>
                {" "}
                · 상위5 확률 <b className={sel.pTop5 >= 0.7 ? "text-accent" : ""}>{pct(sel.pTop5, 0)}</b>
              </>
            )}
          </div>

          {sel.suppressedZ !== null && (
            <div className="tnum mb-2 rounded-md border border-line bg-[#0e1424] px-3 py-2 text-[11px] leading-4">
              <span className="text-dim">모델 기대 대비: </span>
              <span className="text-ink">
                관측 {fmt(sel.dropoffs)}건 vs 기대{" "}
                {sel.expectedDropoffs === null ? "—" : `${fmt(sel.expectedDropoffs)}건`}
              </span>
              <span
                className="ml-1 font-semibold"
                style={{ color: sel.suppressedZ < 0 ? HEX.gapHL : HEX.gapLH }}
              >
                (잔차 z {signed(sel.suppressedZ)})
              </span>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
            {(
              [
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
      ) : mode === "observed" ? (
        <Section title="사각지대 상위" aside="지도를 클릭해도 됩니다" flush>
          <ul className="max-h-[320px] overflow-y-auto">
            {ranked
              .filter((p) => p.gapClass === "HL")
              .slice(0, 15)
              .map((p) => (
                <li key={p.admCd}>
                  <button
                    type="button"
                    onClick={() => zoomTo(p)}
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
      ) : (
        <Section title="침묵 의심 상위 10" aside="클릭 = 지도 확대" flush>
          <ul className="max-h-[320px] overflow-y-auto">
            {silent.slice(0, 10).map((p, i) => (
              <li key={p.admCd}>
                <button
                  type="button"
                  onClick={() => zoomTo(p)}
                  className="flex w-full items-center gap-2 border-b border-line px-3.5 py-2 text-left text-[12px] last:border-b-0 hover:bg-[#161e30]"
                >
                  <span className="tnum w-6 shrink-0 text-dim">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-ink">
                      {p.gu} {p.name}
                    </span>
                    <span className="tnum block text-[11px] leading-4 text-dim">
                      관측 {fmt(p.dropoffs)}건 vs 기대{" "}
                      {p.expectedDropoffs === null ? "—" : `${fmt(p.expectedDropoffs)}건`}
                    </span>
                  </span>
                  <span
                    className="tnum ml-auto shrink-0 font-semibold"
                    style={{ color: HEX.gapHL }}
                  >
                    z {signed(p.suppressedZ ?? 0)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Explainer
        what={
          <>
            <p>
              이 화면은 같은 질문을 두 장의 지도로 봅니다. <b className="text-ink">관측
              수요</b> 모드는 실제로 기록된 두리발 이용(하차)과 무장애 인프라를
              겹쳐, 수요는 많은데 인프라가 부족한 사각지대(붉은 HL)를 찾습니다.
              그런데 관측 수요에는 함정이 있습니다 — <b className="text-ink">갈 수
              없는 곳에는 애초에 수요 기록도 남지 않습니다</b>. 충전소가 없어
              전동휠체어로 갈 엄두를 못 내는 동네라면, 그 동네의 하차 건수는
              0에 가깝고 &ldquo;수요가 없는 곳&rdquo;처럼 보입니다(선택 편향).
              <b className="text-ink"> 잠재 수요(침묵 지도)</b> 모드는 이 함정을
              뒤집어 봅니다: 상가·시설 규모로 보면 이 정도 이용이 있어야 하는데
              실제로는 훨씬 적은, &ldquo;침묵하는&rdquo; 동을 붉게 표시합니다.
            </p>
          </>
        }
        how={
          <>
            <p>
              행정동 {nb ? fmt(Number(nb.numbers?.n ?? 206)) : "206"}곳의 하차
              건수를 음이항(NB) 회귀로 모델링했습니다. 각 동의 상가 수를
              노출(offset)로 넣어 &ldquo;동네 규모 대비 이용률&rdquo;을 맞추고,
              충전소·병의원·복지시설 수를 설명 변수로 사용했습니다. 모델이 각
              동에 대해 계산한 <b className="text-ink">기대 하차 건수</b>와 실제
              관측치를 비교한 표준화 잔차가 suppressedZ입니다. 잔차가 크게
              음수(예: 관측 132건 vs 기대 512건)일수록 규모에 비해 이용이
              비정상적으로 적은 동, 즉 잠재수요가 눌려 있을 가능성이 있는
              동입니다. 격차점수의 신뢰구간과 상위5 확률은 5월 31일을 일 단위로
              500회 재표집한 부트스트랩에서 나온 값으로, 상세 패널에 함께
              표시됩니다.
            </p>
          </>
        }
        caveats={
          <>
            <p>
              침묵 지도는 <b className="text-ink">연관 기반 추정이지 인과 증명이
              아닙니다</b>. 잔차가 음수인 이유가 접근성 장벽이 아니라 단순히 그
              동네 특성(고령 인구 적음, 대체 교통수단 존재 등)일 수도 있어,
              현장 확인 전에는 &ldquo;의심 후보&rdquo;로만 읽어야 합니다. 노출
              변수도 리허설에서는 상가 수라는 프록시를 썼고, 본선에서는 장애인
              등록 인구로 교체할 예정입니다. 모든 수치는 리허설 데이터(2025년
              5월 한 달, 부산 전역) 기준이라 계절성과 월간 변동은 반영되지
              않았습니다.
            </p>
          </>
        }
      />
    </div>
  );
}
