"use client";

import { useEffect, useMemo } from "react";
import { ScatterplotLayer } from "deck.gl";
import { DATA, type Stats, type UnmetCell } from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt } from "@/lib/format";
import { HEX } from "@/lib/palette";
import { tooltipHtml, type MapSpec } from "@/lib/mapspec";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";
import { Explainer } from "@/components/ui/Explainer";
import { Kpi } from "@/components/ui/Kpi";
import { HourBar } from "@/components/charts/HourBar";

export function UnmetScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const unmet = useData<UnmetCell[]>(DATA.unmet);
  const stats = useData<Stats>(DATA.stats);

  const layers = useMemo(() => {
    if (!unmet.data) return [];
    return [
      new ScatterplotLayer<UnmetCell>({
        id: "unmet-cells",
        data: unmet.data,
        getPosition: (d) => [d.lng, d.lat],
        // area ∝ count → radius ∝ sqrt
        getRadius: (d) => 90 + Math.sqrt(d.unassigned + d.cancelled) * 110,
        radiusUnits: "meters",
        radiusMinPixels: 2,
        radiusMaxPixels: 40,
        getFillColor: (d) => {
          const heavy = d.unassigned + d.cancelled;
          return heavy >= 5 ? [229, 72, 77, 200] : [251, 113, 133, 150];
        },
        pickable: true,
        stroked: false,
      }),
    ];
  }, [unmet.data]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      const c = info.object as UnmetCell | undefined;
      if (!c) return null;
      return tooltipHtml(
        `<b>미충족 수요 셀 (약 100m)</b><br/>미배차 ${fmt(c.unassigned)}건 · 취소 ${fmt(c.cancelled)}건`,
      );
    };
  }, []);

  useEffect(() => {
    onMapSpec({ layers, getTooltip });
  }, [layers, getTooltip, onMapSpec]);

  const s = stats.data;
  const peakHour = useMemo(() => {
    if (!s) return null;
    return [...s.hourly].sort((a, b) => b.unassigned - a.unassigned)[0] ?? null;
  }, [s]);

  const totalCells = unmet.data?.length ?? 0;
  const totalUnassigned = useMemo(
    () => (unmet.data ? unmet.data.reduce((acc, c) => acc + c.unassigned, 0) : 0),
    [unmet.data],
  );

  return (
    <div className="space-y-3">
      {unmet.data ? (
        <div className="grid grid-cols-2 gap-2">
          <Kpi
            label="미충족 셀"
            value={fmt(totalCells)}
            sub="100m 격자 (개인정보 보호 집계)"
            color={HEX.unmet}
          />
          <Kpi
            label="셀 내 미배차 합계"
            value={fmt(totalUnassigned)}
            sub="출발지 기준"
            color={HEX.gapHL}
          />
        </div>
      ) : (
        <DataPending note="unmet.json 대기 중 — 미배차·취소 밀집 지도가 표시됩니다." />
      )}

      {s ? (
        <Section
          title="시간대별 미배차"
          aside={peakHour ? `${peakHour.hour}시 미배차 최다` : undefined}
        >
          <HourBar
            data={s.hourly.map((h) => ({ hour: h.hour, value: h.unassigned }))}
            baseColor={HEX.unmet}
            hiColor={HEX.gapHL}
            seriesName="미배차"
          />
          <p className="mt-1.5 text-[11px] leading-4 text-dim">
            {peakHour
              ? `${peakHour.hour}시에 미배차가 ${fmt(peakHour.unassigned)}건으로 가장 많습니다 — 통원 피크와 차량 공급이 어긋나는 시간대입니다.`
              : "시간대별 미배차 분포입니다."}
          </p>
        </Section>
      ) : (
        <DataPending note="stats.json 대기 중 — 시간대별 미배차 차트가 표시됩니다." />
      )}

      <Section title="읽는 법">
        <p className="text-[12px] leading-5 text-dim">
          원이 클수록 배차 실패·취소가 잦았던 곳입니다. 짙은 붉은 원(5건 이상)이
          모인 곳은 차량 재배치나 증차 검토가 필요한 후보지입니다.
        </p>
      </Section>

      <Explainer
        what={
          <>
            <p>
              앞의 수요 지도가 &ldquo;이루어진 이동&rdquo;을 보여줬다면, 이
              화면은 <b>이루어지지 못한 이동</b> — 차량을 배정받지 못했거나
              기다리다 취소된 호출 — 이 어디서 발생했는지를 보여줍니다.
              미배차는 잡음이 아니라 <b>억눌린 수요의 신호</b>입니다. 부르고
              거절당한 사람은 다음번에는 아예 부르지 않게 되고, 그러면 수요
              통계에서도 사라집니다. 그래서 이 붉은 점들은 &ldquo;지금 보이는
              수요 지도가 실제 필요보다 작게 그려져 있다&rdquo;는 증거이기도
              합니다.
            </p>
            <p className="mt-2">
              <b>어떻게 활용하나</b> — 공단은 붉은 원이 뭉친 곳과 시간대별
              미배차 차트를 겹쳐 차량 재배치·증차 검토의 근거로 쓸 수
              있습니다. 이 화면은 다른 두 씬과 한 세트입니다: &lsquo;하루의
              흐름&rsquo;의 유령 포인트 토글은 같은 미배차를 시간 흐름 위에서
              보여주고, &lsquo;대기시간 포렌식&rsquo;은 이들을 관측중단으로
              포함해 진짜 대기 부담을 다시 추정합니다. &lsquo;사각지대
              분석&rsquo;의 잠재수요 지수는 한 걸음 더 나아가 &ldquo;부르지도
              않게 된&rdquo; 수요까지 추정합니다.
            </p>
          </>
        }
        how={
          <>
            <p>
              미배차·취소로 끝난 접수의 출발지 좌표를 약 100m 격자 셀로
              모았습니다(현재 {fmt(totalCells)}개 셀, 셀 내 미배차 합계{" "}
              {fmt(totalUnassigned)}건). 원의 면적은 건수에 비례하고, 5건
              이상인 셀은 짙은 붉은색으로 구분했습니다. 개별 지점이 아닌 격자
              집계라 특정 가구를 지목할 수 없습니다. 시간대별 차트는 접수
              시각 기준 미배차 건수입니다.
            </p>
          </>
        }
        caveats={
          <>
            <p>
              취소에는 이용자 사정에 의한 취소도 섞여 있으나 취소 사유가
              데이터에 없어 구분하지 못합니다 — 미배차와 함께 보수적으로
              &ldquo;미충족 후보&rdquo;로 집계했습니다. 미배차가 많은 곳은
              대체로 수요 자체가 많은 곳이기도 하므로, 절대 건수만으로 공급
              부족을 단정하기 어렵습니다(시간대·수요 대비 비율을 함께 볼 것).
              본선 데이터에 미배차 상태 플래그가 없을 경우 비어 있는
              타임스탬프로 식별하며, 그마저 없으면 장기 대기 건 기준의 대안
              분석으로 전환합니다. 수치는 2025년 5월 한 달, 부산시 전역
              기준입니다.
            </p>
          </>
        }
      />
    </div>
  );
}
