"use client";

import { useEffect, useMemo, useState } from "react";
import { GeoJsonLayer } from "deck.gl";
import { DATA, type DisabilityData, type DisabilityGu, type DongProps } from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt, pct } from "@/lib/format";
import { HEX } from "@/lib/palette";
import {
  tooltipHtml,
  type DongCollection,
  type FlyTo,
  type MapSpec,
} from "@/lib/mapspec";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";
import { Explainer } from "@/components/ui/Explainer";
import { Kpi } from "@/components/ui/Kpi";
import { DisabilityTypeBar } from "@/components/charts/DisabilityTypeBar";
import { TypeCompareBar } from "@/components/charts/TypeCompareBar";

type Mode = "per1k" | "registered" | "trips";

const MODE_LABEL: Record<Mode, string> = {
  per1k: "천명당 이용",
  registered: "등록 장애인 수",
  trips: "이용 건수",
};

type RGBA = [number, number, number, number];

const NO_DATA_FILL: RGBA = [100, 116, 139, 45]; // 등록현황 미공개 구 — 회색
const OTHER_TYPE = "기타 교통약자";

/** 좌우 2분할 인라인 비율 바 (심한/심하지 않은, 남/여). */
function SplitBar({
  left,
  right,
  leftLabel,
  rightLabel,
  leftColor,
  rightColor,
}: {
  left: number;
  right: number;
  leftLabel: string;
  rightLabel: string;
  leftColor: string;
  rightColor: string;
}) {
  const total = left + right;
  const share = total > 0 ? left / total : 0;
  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-[#0e1424]">
        <div style={{ width: `${share * 100}%`, background: leftColor }} />
        <div className="flex-1" style={{ background: rightColor, opacity: 0.45 }} />
      </div>
      <div className="tnum mt-1 flex justify-between text-[10px] leading-4 text-dim">
        <span>
          <span style={{ color: leftColor }}>●</span> {leftLabel} {fmt(left)}명 ({pct(share)})
        </span>
        <span>
          {rightLabel} {fmt(right)}명 <span style={{ color: rightColor }}>●</span>
        </span>
      </div>
    </div>
  );
}

function Legend({ mode, meanPer1k }: { mode: Mode; meanPer1k: number }) {
  return (
    <div className="pointer-events-none rounded-lg border border-line bg-panel/85 px-3 py-2 text-[10px] leading-4 text-dim backdrop-blur">
      {mode === "per1k" ? (
        <>
          <div>
            <span style={{ color: HEX.unmet }}>■</span> 평균({fmt(meanPer1k)}건) 미만 — 과소
            서비스 의심
          </div>
          <div>
            <span style={{ color: HEX.infra }}>■</span> 평균 초과
          </div>
        </>
      ) : (
        <div>
          <span style={{ color: mode === "registered" ? HEX.demand : HEX.accent }}>■</span>{" "}
          {MODE_LABEL[mode]} 많을수록 진하게
        </div>
      )}
      <div>
        <span className="text-[#64748b]">■</span> 회색 = 등록현황 미공개 구·군
      </div>
    </div>
  );
}

export function DisabilityScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const disability = useData<DisabilityData>(DATA.disability);
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);

  const [mode, setMode] = useState<Mode>("per1k");
  const [selectedGu, setSelectedGu] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);

  const gus = useMemo(() => disability.data?.gus ?? [], [disability.data]);
  const guMap = useMemo(() => new Map(gus.map((g) => [g.gu, g])), [gus]);
  const totals = disability.data?.totals;

  /** 등록현황 보유 9개 구의 가중평균 천명당 이용 — diverging 색의 기준선. */
  const meanPer1k = useMemo(() => {
    const withReg = gus.filter((g) => g.hasRegistry && (g.registered ?? 0) > 0);
    const trips = withReg.reduce((s, g) => s + g.trips, 0);
    const reg = withReg.reduce((s, g) => s + (g.registered ?? 0), 0);
    return reg > 0 ? (trips / reg) * 1000 : 0;
  }, [gus]);

  const maxRegistered = useMemo(
    () => Math.max(1, ...gus.map((g) => g.registered ?? 0)),
    [gus],
  );
  const maxTrips = useMemo(() => Math.max(1, ...gus.map((g) => g.trips)), [gus]);

  /** 천명당 이용 오름차순 (1위 = 가장 과소 서비스). */
  const ranked = useMemo(
    () =>
      gus
        .filter((g) => g.tripsPer1k !== null)
        .sort((a, b) => (a.tripsPer1k ?? 0) - (b.tripsPer1k ?? 0)),
    [gus],
  );
  const maxPer1k = useMemo(
    () => Math.max(1, ...ranked.map((g) => g.tripsPer1k ?? 0)),
    [ranked],
  );

  /** 구별 대표 좌표(소속 행정동 centroid 평균) — flyTo 용. */
  const guCenter = useMemo(() => {
    const acc = new Map<string, { lng: number; lat: number; n: number }>();
    for (const f of dongs.data?.features ?? []) {
      const { gu, centroid } = f.properties;
      const cur = acc.get(gu) ?? { lng: 0, lat: 0, n: 0 };
      cur.lng += centroid[0];
      cur.lat += centroid[1];
      cur.n += 1;
      acc.set(gu, cur);
    }
    const out = new Map<string, [number, number]>();
    acc.forEach((v, k) => out.set(k, [v.lng / v.n, v.lat / v.n]));
    return out;
  }, [dongs.data]);

  const fillOf = useMemo(() => {
    return (gu: string): RGBA => {
      const g = guMap.get(gu);
      if (!g) return NO_DATA_FILL;
      if (mode === "registered") {
        if (!g.hasRegistry) return NO_DATA_FILL;
        const t = Math.sqrt((g.registered ?? 0) / maxRegistered);
        return [56, 189, 248, 18 + t * 160];
      }
      if (mode === "trips") {
        const t = Math.sqrt(g.trips / maxTrips);
        return [34, 211, 238, 18 + t * 160];
      }
      // per1k — 9개 구 가중평균 대비 diverging
      if (g.tripsPer1k === null || meanPer1k === 0) return NO_DATA_FILL;
      const ratio = g.tripsPer1k / meanPer1k;
      if (ratio < 1) {
        const t = Math.min(1, (1 - ratio) / 0.5);
        return [251, 113, 133, 40 + t * 170];
      }
      const t = Math.min(1, (ratio - 1) / 0.5);
      return [52, 211, 153, 30 + t * 140];
    };
  }, [guMap, mode, maxRegistered, maxTrips, meanPer1k]);

  const selectGu = (gu: string | null) => {
    setSelectedGu(gu);
    const c = gu ? guCenter.get(gu) : undefined;
    if (c) setFlyTo({ longitude: c[0], latitude: c[1], zoom: 11.6 });
  };

  const layers = useMemo(() => {
    if (!dongs.data || gus.length === 0) return [];
    return [
      new GeoJsonLayer<DongProps>({
        id: "disability-choro",
        data: dongs.data as never,
        pickable: true,
        stroked: true,
        getFillColor: (f) => fillOf(f.properties.gu),
        getLineColor: (f) =>
          f.properties.gu === selectedGu ? [226, 232, 240, 220] : [11, 15, 26, 150],
        getLineWidth: (f) => (f.properties.gu === selectedGu ? 1.8 : 0.8),
        lineWidthUnits: "pixels",
        onClick: (info) => {
          const f = info.object as { properties: DongProps } | undefined;
          if (f?.properties) selectGu(f.properties.gu);
        },
        updateTriggers: {
          getFillColor: [mode, fillOf],
          getLineColor: [selectedGu],
          getLineWidth: [selectedGu],
        },
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dongs.data, gus.length, fillOf, mode, selectedGu]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      const f = info.object as { properties: DongProps } | undefined;
      if (!f?.properties) return null;
      const g = guMap.get(f.properties.gu);
      if (!g) return null;
      const regLine = g.hasRegistry
        ? `등록 ${fmt(g.registered ?? 0)}명 (기준 ${g.asOf ?? "미상"})` +
          (g.hearingMerged ? ` · 청각(언어) 병합 집계` : "")
        : `<span style="color:#8b96ab">등록현황 미공개</span>`;
      const per1kLine =
        g.tripsPer1k === null ? "" : `<br/>천명당 월 이용 <b>${fmt(g.tripsPer1k)}건</b>`;
      return tooltipHtml(
        `<b>${g.gu}</b><br/>${regLine}<br/>5월 완료 이용 ${fmt(g.trips)}건${per1kLine}`,
      );
    };
  }, [guMap]);

  const overlay = useMemo(
    () => (gus.length > 0 ? <Legend mode={mode} meanPer1k={meanPer1k} /> : undefined),
    [gus.length, mode, meanPer1k],
  );

  useEffect(() => {
    onMapSpec({ layers, getTooltip, flyTo, overlay });
  }, [layers, getTooltip, flyTo, overlay, onMapSpec]);

  const sel = selectedGu ? (guMap.get(selectedGu) ?? null) : null;

  /** 시 전체 유형별 등록 vs 이용 구성비 (기타 교통약자는 차트 밖 주석). */
  const compareRows = useMemo(() => {
    const rows = (disability.data?.typeTotals ?? []).filter((t) => t.type !== OTHER_TYPE);
    const regSum = rows.reduce((s, t) => s + (t.registered ?? 0), 0);
    const tripSum = rows.reduce((s, t) => s + t.trips, 0);
    if (regSum === 0 || tripSum === 0) return [];
    return rows.map((t) => ({
      type: t.type,
      regShare: (t.registered ?? 0) / regSum,
      tripShare: t.trips / tripSum,
    }));
  }, [disability.data]);

  const otherTrips =
    disability.data?.typeTotals.find((t) => t.type === OTHER_TYPE)?.trips ?? 0;
  const estUsersSum = useMemo(() => gus.reduce((s, g) => s + g.estUsers, 0), [gus]);
  const worst = ranked[0] ?? null;
  const noRegistryGus = gus.filter((g) => !g.hasRegistry);

  if (!disability.data || !dongs.data) {
    return (
      <div className="space-y-3">
        <DataPending note="disability.json 대기 중 — 구·군별 등록 장애인 × 두리발 이용 갭이 여기 표시됩니다. (생성: npm run build:disability)" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── 지도 지표 토글 ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-panel p-1">
        {(["per1k", "registered", "trips"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`rounded-md px-2 py-1.5 text-[11px] font-semibold leading-4 transition-colors ${
              mode === m ? "bg-accent/15 text-accent" : "text-dim hover:text-ink"
            }`}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Kpi
          label="등록 장애인"
          value={`${fmt(totals?.registeredKnown ?? 0)}명`}
          sub={`${totals?.guWithRegistry ?? 0}개 구·군 합계 — ${noRegistryGus.length}개 구 미공개`}
          color={HEX.demand}
        />
        <Kpi
          label="5월 완료 이용"
          value={`${fmt(totals?.completedTrips ?? 0)}건`}
          sub={`부산 출발 ${fmt(totals?.tripsFromBusan ?? 0)}건`}
          color={HEX.accent}
        />
        <Kpi
          label="최소 이용 구"
          value={worst ? worst.gu : "—"}
          sub={worst ? `천명당 ${fmt(worst.tripsPer1k ?? 0)}건 (평균 ${fmt(meanPer1k)}건)` : undefined}
          color={HEX.unmet}
        />
        <Kpi
          label="추정 이용자"
          value={`${fmt(estUsersSum)}명`}
          sub="출발좌표·유형 조합 근사"
          color={HEX.warn}
        />
      </div>

      {/* ── 구별 이용 갭 순위 ──────────────────────────────────────────── */}
      <Section
        title="구별 이용 갭 순위"
        aside="천명당 낮은 순 · 행 클릭 = 지도 이동"
        flush
      >
        <table className="w-full table-fixed text-[12px]">
          <colgroup>
            <col className="w-[12%]" />
            <col className="w-[24%]" />
            <col className="w-[26%]" />
            <col className="w-[38%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-line text-left text-[11px] text-dim">
              <th className="px-3 py-1.5 font-medium">순위</th>
              <th className="py-1.5 font-medium">구·군</th>
              <th className="py-1.5 text-right font-medium">등록</th>
              <th className="px-3 py-1.5 text-right font-medium">천명당 이용</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((g, i) => {
              const active = g.gu === selectedGu;
              const below = (g.tripsPer1k ?? 0) < meanPer1k;
              return (
                <tr
                  key={g.gu}
                  onClick={() => selectGu(active ? null : g.gu)}
                  className={`cursor-pointer border-b border-line/60 last:border-b-0 ${
                    active ? "bg-accent/10" : "hover:bg-[#161e30]"
                  }`}
                >
                  <td className="tnum py-1.5 pl-3 text-dim">{i + 1}</td>
                  <td className={active ? "py-1.5 font-semibold text-accent" : "py-1.5 text-ink"}>
                    {g.gu}
                  </td>
                  <td className="tnum py-1.5 text-right text-dim">{fmt(g.registered ?? 0)}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-[#0e1424]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${((g.tripsPer1k ?? 0) / maxPer1k) * 100}%`,
                            background: below ? HEX.unmet : HEX.infra,
                          }}
                        />
                      </div>
                      <span
                        className="tnum w-8 text-right font-medium"
                        style={{ color: below ? HEX.unmet : HEX.infra }}
                      >
                        {fmt(g.tripsPer1k ?? 0)}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <p className="rounded-md border border-unmet/40 bg-unmet/5 px-3 py-2 text-[11px] leading-4 text-ink/85">
        <b className="text-unmet">{noRegistryGus.map((g) => g.gu).join("·")}</b>{" "}
        {noRegistryGus.length}개 구는 등록현황이 공개되지 않아 순위에서 빠졌습니다(지도의
        회색). 특히 <b className="text-unmet">부산진구</b>는 이용{" "}
        {fmt(guMap.get("부산진구")?.trips ?? 0)}건으로 16개 구·군 중 최다인데도 비교가
        불가능합니다.
      </p>

      {/* ── 선택 구 상세 ───────────────────────────────────────────────── */}
      {sel && (
        <Section
          title={`${sel.gu} 상세`}
          aside={
            <button
              type="button"
              onClick={() => selectGu(null)}
              className="text-accent hover:underline"
            >
              선택 해제
            </button>
          }
        >
          {sel.hasRegistry ? (
            <>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
                {(
                  [
                    ["기준일", sel.asOf ?? "미상"],
                    ["등록 장애인", `${fmt(sel.registered ?? 0)}명`],
                    ["5월 완료 이용", `${fmt(sel.trips)}건`],
                    [
                      "천명당 이용",
                      sel.tripsPer1k === null ? "—" : `${fmt(sel.tripsPer1k)}건`,
                    ],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-baseline justify-between border-b border-line/60 pb-1"
                  >
                    <dt className="text-dim">{k}</dt>
                    <dd className="tnum font-medium text-ink">{v}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-3 space-y-2.5">
                {sel.severe !== null && sel.mild !== null ? (
                  <SplitBar
                    left={sel.severe}
                    right={sel.mild}
                    leftLabel="심한 장애"
                    rightLabel="심하지 않은 장애"
                    leftColor={HEX.warn}
                    rightColor={HEX.demand}
                  />
                ) : (
                  <p className="text-[11px] text-dim">장애 정도 구분 자료 미제공</p>
                )}
                {sel.male !== null && sel.female !== null ? (
                  <SplitBar
                    left={sel.male}
                    right={sel.female}
                    leftLabel="남성"
                    rightLabel="여성"
                    leftColor={HEX.accent}
                    rightColor={HEX.tourism}
                  />
                ) : (
                  <p className="text-[11px] text-dim">성별 구분 자료 미제공</p>
                )}
              </div>

              <div className="mt-3">
                <div className="mb-1 text-[11px] text-dim">유형별 등록 현황</div>
                <DisabilityTypeBar data={sel.byType} />
                {sel.hearingMerged && (
                  <p className="mt-1 text-[10px] leading-4 text-dim">
                    * 원자료가 청각·언어를 &ldquo;청각(언어)&rdquo;로 병합해 청각에 합산했습니다.
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
                {(
                  [
                    ["5월 완료 이용", `${fmt(sel.trips)}건`],
                    ["추정 이용자", `${fmt(sel.estUsers)}명`],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-baseline justify-between border-b border-line/60 pb-1"
                  >
                    <dt className="text-dim">{k}</dt>
                    <dd className="tnum font-medium text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[11px] leading-4 text-dim">
                이 구·군은 장애인 등록현황이 공개 데이터로 제공되지 않아 이용 실적만
                표시합니다.
              </p>
            </>
          )}
        </Section>
      )}

      {/* ── 시 전체 유형별 등록 vs 이용 ───────────────────────────────── */}
      <Section title="유형별 등록 vs 이용 구성비" aside="시 전체">
        <div className="mb-2 flex gap-3 text-[10px] leading-4 text-dim">
          <span>
            <span style={{ color: HEX.demand }}>■</span> 등록 구성비 (9개 구 합)
          </span>
          <span>
            <span style={{ color: HEX.accent }}>■</span> 두리발 이용 구성비
          </span>
        </div>
        <TypeCompareBar data={compareRows} />
        <p className="mt-2 text-[11px] leading-4 text-dim">
          등록 비중에 비해 이용 비중이 큰 유형(예: 뇌병변)이 두리발의 실질 수요층입니다.
          65세 이상·일시적 장애 등 <b className="text-ink">비장애 교통약자</b>의 이용{" "}
          {fmt(otherTrips)}건({pct(otherTrips / (totals?.completedTrips ?? 1))})은 이
          비교에서 제외했습니다.
        </p>
      </Section>

      <Explainer
        what={
          <>
            <p>
              지금까지의 씬이 두리발 <b className="text-ink">이용 기록</b>에서 출발했다면,
              이 화면은 그 반대편 — <b className="text-ink">잠재 수요</b>인 구·군별 등록
              장애인 현황에서 출발합니다. 등록 장애인 수 대비 두리발 이용이 적은
              구(지도의 <b style={{ color: HEX.unmet }}>붉은 구</b>)는 수요가 없어서가
              아니라 서비스가 닿지 않아서일 수 있는 과소 서비스 후보입니다. 위 토글로
              등록 수·이용 건수·천명당 이용을 전환하고, 구를 클릭하면 유형·정도·성별
              구성을 볼 수 있습니다.
            </p>
          </>
        }
        how={
          <>
            <p>
              9개 구·군의 장애인 등록현황 공공데이터(구마다 형식이 달라 장애유형 15종 ×
              심한/심하지 않은 장애 기준으로 통일, 제공되는 구는 성별 포함)를 정규화하고,
              2025년 5월 두리발 완료 운행 {fmt(totals?.completedTrips ?? 0)}건을 출발지
              행정동의 구·군으로 집계해 교차했습니다. 핵심 지표는{" "}
              <b className="text-ink">등록 장애인 1,000명당 월 이용 건수</b>(이용 건수 ÷
              등록 장애인 수 × 1,000)로, 지도의 붉은/녹색은 등록현황 보유 9개 구
              가중평균({fmt(meanPer1k)}건) 대비 낮음/높음을 뜻합니다.
            </p>
          </>
        }
        caveats={
          <>
            <p>
              ① 등록현황 기준일이 구마다 2024-05~2026-06으로 제각각이고 이용 로그는
              2025년 5월 한 달뿐이라 시점이 어긋납니다. ② 7개 구·군(이용 최다인
              부산진구 포함)은 등록현황 미공개라 갭 순위가 9개 구로 한정됩니다. ③ 이용
              건수의 약 {pct(otherTrips / (totals?.completedTrips ?? 1), 0)}는 65세
              이상·일시적 장애 등 등록 장애인이 아닌 교통약자입니다. ④ 한 사람이 여러 번
              이용하므로 천명당 이용은 <b className="text-ink">건수 지표이지
              이용률(%)이 아니며</b>, 추정 이용자 수도 이용자 ID가 없어 출발좌표·유형
              조합으로 근사한 값입니다. ⑤ 강서구는 청각·언어가 병합 집계돼 있고 남구는
              기준일이 원자료에 없습니다.
            </p>
          </>
        }
      />
    </div>
  );
}
