"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ScatterplotLayer } from "deck.gl";
import {
  DATA,
  DISABILITY_TYPES,
  type DisabilityType,
  type WelfareProgram,
  type WelfareProgramsData,
} from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt, pct } from "@/lib/format";
import { HEX, RGB_WARN, DISABILITY_HEX, DISABILITY_TYPE_LABEL } from "@/lib/palette";
import { tooltipHtml, type FlyTo, type MapSpec } from "@/lib/mapspec";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";
import { Explainer } from "@/components/ui/Explainer";
import { Kpi } from "@/components/ui/Kpi";

const GU_LIST = ["남구", "영도구", "사하구", "금정구", "사상구"];

function badgeFor(p: WelfareProgram): { label: string; color: string } {
  return p.matchType === "general"
    ? { label: "이용 가능(일반)", color: HEX.warn }
    : { label: "직접 명시", color: HEX.infra };
}

interface CenterPoint {
  center: string;
  gu: string;
  lng: number;
  lat: number;
  matched: boolean;
  approx: boolean;
}

export function WelfareScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const welfare = useData<WelfareProgramsData>(DATA.welfarePrograms);

  const [selectedType, setSelectedType] = useState<DisabilityType | null>(null);
  const [selectedGu, setSelectedGu] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);

  const programs = welfare.data?.programs ?? [];
  const stats = welfare.data?.stats;

  const guFiltered = useMemo(
    () => (selectedGu ? programs.filter((p) => p.gu === selectedGu) : programs),
    [programs, selectedGu],
  );

  const directMatches = useMemo(() => {
    if (!selectedType) return guFiltered;
    return guFiltered.filter((p) => p.disabilityTypes.includes(selectedType));
  }, [guFiltered, selectedType]);

  // 유형이 전체 데이터(구 필터 적용 전)에서 통째로 0건일 때만(현재 시각·청각)
  // 공통 프로그램으로 대체한다 — Round 5 결정은 "그 유형 자체가 원본에 아예
  // 없는 경우"를 위한 것이지, "이 구 안에서만 0건"인 정상적인 AND 필터 결과까지
  // 대체해서는 안 된다 (그러면 구 필터만 적용된 것처럼 보이는 버그가 된다).
  const typeGloballyEmpty = useMemo(
    () => selectedType !== null && !programs.some((p) => p.disabilityTypes.includes(selectedType)),
    [programs, selectedType],
  );
  const showFallback = typeGloballyEmpty;
  const fallbackPrograms = useMemo(
    () => (showFallback ? guFiltered.filter((p) => p.isGeneral) : []),
    [showFallback, guFiltered],
  );

  const displayed = showFallback ? fallbackPrograms : directMatches;

  const selected = useMemo(
    () => programs.find((p) => p.id === selectedId) ?? null,
    [programs, selectedId],
  );

  const select = useCallback(
    (p: WelfareProgram | null) => {
      setSelectedId(p?.id ?? null);
      if (p && p.lng != null && p.lat != null) {
        setFlyTo({ longitude: p.lng, latitude: p.lat, zoom: 14.5 });
      }
    },
    [],
  );

  const centers = useMemo<CenterPoint[]>(() => {
    const map = new Map<string, CenterPoint>();
    const matchedIds = new Set(displayed.map((p) => p.id));
    for (const p of programs) {
      if (p.lng == null || p.lat == null) continue;
      const key = `${p.center}|${p.lng}|${p.lat}`;
      if (!map.has(key)) {
        map.set(key, {
          center: p.center,
          gu: p.gu,
          lng: p.lng,
          lat: p.lat,
          matched: false,
          approx: !!p.locationApprox,
        });
      }
      if (matchedIds.has(p.id)) map.get(key)!.matched = true;
    }
    return [...map.values()];
  }, [programs, displayed]);

  const layers = useMemo(() => {
    if (centers.length === 0) return [];
    return [
      new ScatterplotLayer<CenterPoint>({
        id: "welfare-centers",
        data: centers,
        getPosition: (d) => [d.lng, d.lat],
        getFillColor: (d) => {
          const [r, g, b] = RGB_WARN;
          return [r, g, b, d.matched ? 230 : 90];
        },
        getRadius: (d) => (d.matched ? 7 : 4),
        radiusUnits: "pixels",
        stroked: true,
        // 근사 위치(구 중심)는 실제 주소가 아님을 지도에서도 구분할 수 있도록
        // 점선 느낌의 옅은 흰 테두리 대신 경고색 테두리를 준다.
        getLineColor: (d) => (d.approx ? [251, 191, 36, 220] : [255, 255, 255, 160]),
        getLineWidth: (d) => (d.approx ? 2 : 1),
        lineWidthUnits: "pixels",
        pickable: true,
        onClick: (info) => {
          const c = info.object as CenterPoint | undefined;
          if (c) setFlyTo({ longitude: c.lng, latitude: c.lat, zoom: 14.5 });
        },
        updateTriggers: {
          getFillColor: [centers],
          getRadius: [centers],
          getLineColor: [centers],
          getLineWidth: [centers],
        },
      }),
    ];
  }, [centers]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      const c = info.object as CenterPoint | undefined;
      if (!c) return null;
      const note = c.approx
        ? `<br/><span style="color:#fbbf24">근사 위치(구 중심) — 실제 주소 아님</span>`
        : "";
      return tooltipHtml(`<b>${c.center}</b><br/>${c.gu}${note}`);
    };
  }, []);

  useEffect(() => {
    onMapSpec({ layers, getTooltip, flyTo });
  }, [layers, getTooltip, flyTo, onMapSpec]);

  if (!welfare.data) {
    return (
      <div className="space-y-3">
        <DataPending note="welfare_programs.json 대기 중 — 장애유형별 복지 프로그램 현황이 여기 표시됩니다." />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Kpi label="전체 프로그램" value={`${fmt(stats?.total ?? 0)}건`} color={HEX.warn} />
        <Kpi
          label="공통(전체 이용가능) 비율"
          value={pct((stats?.generalCount ?? 0) / (stats?.total || 1))}
          sub={`${fmt(stats?.generalCount ?? 0)}건 / ${fmt(stats?.total ?? 0)}건`}
          color={HEX.infra}
        />
      </div>

      <Section
        title="필터"
        aside={`표시 중 ${fmt(displayed.length)} / 전체 ${fmt(guFiltered.length)}`}
      >
        <div className="text-[11px] text-dim">장애유형 (단일 선택)</div>
        <div className="mt-1 grid grid-cols-3 gap-1.5">
          {DISABILITY_TYPES.map((t) => {
            const on = selectedType === t;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => setSelectedType(on ? null : t)}
                className={`rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
                  on ? "border-transparent text-[#0b0f1a]" : "border-line text-dim hover:text-ink"
                }`}
                style={on ? { background: DISABILITY_HEX[t] } : undefined}
              >
                {t}
              </button>
            );
          })}
        </div>

        <div className="mt-2.5 text-[11px] text-dim">구</div>
        <div className="mt-1 grid grid-cols-3 gap-1.5">
          {GU_LIST.map((g) => {
            const on = selectedGu === g;
            return (
              <button
                key={g}
                type="button"
                aria-pressed={on}
                onClick={() => setSelectedGu(on ? null : g)}
                className={`rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
                  on
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-line text-dim hover:text-ink"
                }`}
              >
                {g}
              </button>
            );
          })}
        </div>

        {(selectedType || selectedGu) && (
          <button
            type="button"
            onClick={() => {
              setSelectedType(null);
              setSelectedGu(null);
            }}
            className="mt-2.5 text-[11px] text-accent hover:underline"
          >
            필터 초기화
          </button>
        )}
      </Section>

      {showFallback && selectedType && (
        <p className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-[11px] leading-4 text-ink/85">
          <b style={{ color: HEX.warn }}>{DISABILITY_TYPE_LABEL[selectedType]}</b>으로
          직접 명시된 프로그램이 없습니다. 대신 모든 이용자에게 열려 있는 공통 프로그램을
          보여드립니다.
        </p>
      )}

      {selected && (
        <Section
          title={selected.programName}
          aside={
            <button type="button" onClick={() => select(null)} className="text-accent hover:underline">
              선택 해제
            </button>
          }
        >
          <dl className="space-y-1.5 text-[12px]">
            <div className="flex items-start justify-between gap-2 border-b border-line/60 pb-1.5">
              <dt className="shrink-0 text-dim">복지관</dt>
              <dd className="text-right text-ink">
                {selected.center} · {selected.gu}
              </dd>
            </div>
            {selected.description && (
              <div className="flex items-start justify-between gap-2 border-b border-line/60 pb-1.5">
                <dt className="shrink-0 text-dim">내용</dt>
                <dd className="text-right text-ink">{selected.description}</dd>
              </div>
            )}
            {selected.targetRaw && (
              <div className="flex items-start justify-between gap-2 border-b border-line/60 pb-1.5">
                <dt className="shrink-0 text-dim">대상</dt>
                <dd className="text-right text-ink">{selected.targetRaw}</dd>
              </div>
            )}
            {selected.schedule && (
              <div className="flex items-start justify-between gap-2 border-b border-line/60 pb-1.5">
                <dt className="shrink-0 text-dim">일정</dt>
                <dd className="text-right text-ink">{selected.schedule}</dd>
              </div>
            )}
            {selected.address && (
              <div className="flex items-start justify-between gap-2 border-b border-line/60 pb-1.5">
                <dt className="shrink-0 text-dim">장소</dt>
                <dd className="text-right text-ink">{selected.address}</dd>
              </div>
            )}
            {selected.locationApprox && (
              <div className="flex items-start justify-between gap-2 border-b border-line/60 pb-1.5">
                <dt className="shrink-0 text-dim">지도 위치</dt>
                <dd className="text-right" style={{ color: HEX.warn }}>
                  근사값(구 중심) — 원본에 주소·좌표 없음
                </dd>
              </div>
            )}
            {selected.phone && (
              <div className="flex items-start justify-between gap-2">
                <dt className="shrink-0 text-dim">전화</dt>
                <dd className="text-right text-ink">{selected.phone}</dd>
              </div>
            )}
          </dl>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {selected.matchType === "general" ? (
              <span
                className="rounded px-1.5 py-0.5 text-[10px] leading-4"
                style={{ background: `${HEX.warn}33`, color: HEX.warn }}
              >
                {badgeFor(selected).label}
              </span>
            ) : (
              selected.disabilityTypes.map((t) => (
                <span
                  key={t}
                  className="rounded px-1.5 py-0.5 text-[10px] leading-4 text-[#0b0f1a]"
                  style={{ background: DISABILITY_HEX[t] }}
                >
                  {t}
                </span>
              ))
            )}
          </div>
        </Section>
      )}

      <Section title="프로그램 목록" aside="행 클릭 = 상세보기" flush>
        <div className="max-h-[320px] overflow-y-auto">
          <table className="w-full table-fixed text-[12px]">
            <colgroup>
              <col className="w-[46%]" />
              <col className="w-[18%]" />
              <col className="w-[36%]" />
            </colgroup>
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-line text-left text-[11px] text-dim">
                <th className="px-3 py-1.5 font-medium">프로그램명</th>
                <th className="whitespace-nowrap py-1.5 font-medium">구</th>
                <th className="whitespace-nowrap px-3 py-1.5 text-right font-medium">매칭</th>
              </tr>
            </thead>
            <tbody>
              {displayed.slice(0, 200).map((p) => {
                const active = p.id === selectedId;
                const badge = badgeFor(p);
                return (
                  <tr
                    key={p.id}
                    onClick={() => select(active ? null : p)}
                    className={`cursor-pointer border-b border-line/60 last:border-b-0 ${
                      active ? "bg-accent/10" : "hover:bg-[#161e30]"
                    }`}
                  >
                    <td
                      title={p.programName}
                      className={`truncate py-1.5 pl-3 align-top ${
                        active ? "font-semibold text-accent" : "text-ink"
                      }`}
                    >
                      {p.programName}
                    </td>
                    <td className="whitespace-nowrap py-1.5 align-top text-dim">{p.gu}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right align-top">
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] leading-4"
                        style={{ background: `${badge.color}33`, color: badge.color }}
                      >
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {displayed.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-dim">
                    조건에 맞는 프로그램이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Explainer
        what={
          <>
            <p>
              부산 5개구(남구·영도구·사하구·금정구·사상구) 장애인복지관이 운영하는
              프로그램 {fmt(stats?.total ?? 0)}건을 15개 공식 장애유형별로 분류해 보여줍니다.
              장애유형을 하나 선택하면 해당 유형에 매칭되는 프로그램만 필터링되고, 구
              필터와 함께 적용됩니다.
            </p>
          </>
        }
        how={
          <>
            <p>
              각 프로그램의 이용대상 텍스트에 유형명이 직접 언급되면 <b>직접 명시</b>로
              분류합니다. 대상이 &ldquo;성인장애인&rdquo;처럼 범용 표현이면 프로그램명·내용의
              키워드로 유형을 추론합니다(내용 기반 추론 — UI에서는 직접 명시와 같은 배지로
              표시). 둘 다 실패하면 <b>공통</b> 프로그램으로 분류되며, 그중 신장·심장·호흡기·
              간·안면·장루_요루·뇌전증 7개 &ldquo;내부·비가시장애&rdquo; 유형은 대부분의 일상
              활동에 실질적 제약이 적다는 판단 하에 자동으로 <b style={{ color: HEX.warn }}>
              이용 가능(일반)</b> 배지와 함께 노출됩니다.
            </p>
          </>
        }
        caveats={
          <>
            <p>
              시각·청각은 5개 CSV 원본 어디에도 해당 유형이 언급되지 않아 직접 매칭
              프로그램이 0건입니다 — 분류 오류가 아니라 원본 데이터의 공백이며, 이 유형을
              선택하면 공통 프로그램을 대신 보여드립니다. &ldquo;이용 가능(일반)&rdquo;
              배지는 명시적으로 검증된 매칭이 아니라 추론에 기반한 판단이므로, 체력 소모가
              큰 활동(예: 유산소·환경정화 활동)은 실제 이용 전 복지관에 문의가 필요할 수
              있습니다. 금정구는 원본 CSV의 내용·대상 컬럼이 대부분 비어 있어 49건 중
              48건이 공통으로 분류되었습니다. 남구·사상구는 원본에 주소·좌표 컬럼이 아예
              없어, 지도에는 실제 복지관 위치가 아닌 <b style={{ color: HEX.warn }}>
              구 중심 근사 좌표</b>(노란 테두리 점)로 표시됩니다.
            </p>
          </>
        }
      />
    </div>
  );
}
