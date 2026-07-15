"use client";

import { useEffect, useMemo, useState } from "react";
import { ScatterplotLayer } from "deck.gl";
import {
  DATA,
  type GuToilets,
  type InfraPoint,
  type StationLift,
} from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt, pct } from "@/lib/format";
import { INFRA_COLORS, INFRA_HEX, INFRA_LABEL } from "@/lib/palette";
import { tooltipHtml, type MapSpec } from "@/lib/mapspec";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";
import { Explainer } from "@/components/ui/Explainer";
import { ToiletsBar } from "@/components/charts/ToiletsBar";

const TYPES = ["charger", "hospital", "pharmacy", "welfare", "tourism"] as const;
type InfraType = (typeof TYPES)[number];

export function InfraScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const points = useData<InfraPoint[]>(DATA.infraPoints);
  const toilets = useData<GuToilets[]>(DATA.toiletsGu);
  const lifts = useData<StationLift[]>(DATA.elevators);

  const [enabled, setEnabled] = useState<Record<InfraType, boolean>>({
    charger: true,
    hospital: true,
    pharmacy: true,
    welfare: true,
    tourism: true,
  });

  const counts = useMemo(() => {
    const c: Record<InfraType, number> = {
      charger: 0,
      hospital: 0,
      pharmacy: 0,
      welfare: 0,
      tourism: 0,
    };
    for (const p of points.data ?? []) {
      if (p.type in c) c[p.type as InfraType] += 1;
    }
    return c;
  }, [points.data]);

  const visible = useMemo(
    () => (points.data ?? []).filter((p) => enabled[p.type as InfraType]),
    [points.data, enabled],
  );

  const layers = useMemo(() => {
    if (visible.length === 0) return [];
    return [
      new ScatterplotLayer<InfraPoint>({
        id: "infra-points",
        data: visible,
        getPosition: (d) => [d.lng, d.lat],
        getFillColor: (d) => {
          const c = INFRA_COLORS[d.type];
          return [c[0], c[1], c[2], d.type === "charger" ? 255 : 170];
        },
        // chargers are the scarcest resource — draw them slightly larger
        getRadius: (d) => (d.type === "charger" ? 5 : 3),
        radiusUnits: "pixels",
        pickable: true,
        stroked: false,
      }),
    ];
  }, [visible]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      const p = info.object as InfraPoint | undefined;
      if (!p) return null;
      const parts = [
        `<b>${p.name}</b>`,
        `${INFRA_LABEL[p.type]}${p.detail ? ` · ${p.detail}` : ""}`,
      ];
      if (p.dong) parts.push(`<span style="color:#8b96ab">${p.dong}</span>`);
      return tooltipHtml(parts.join("<br/>"));
    };
  }, []);

  useEffect(() => {
    onMapSpec({ layers, getTooltip });
  }, [layers, getTooltip, onMapSpec]);

  const liftRows = useMemo(() => {
    if (!lifts.data) return [];
    return [...lifts.data].sort((a, b) => b.elevators - a.elevators).slice(0, 8);
  }, [lifts.data]);

  const noElevator = useMemo(
    () => (lifts.data ?? []).filter((l) => l.elevators === 0).length,
    [lifts.data],
  );

  const toiletShare = useMemo(() => {
    if (!toilets.data) return null;
    const total = toilets.data.reduce((a, t) => a + t.total, 0);
    const acc = toilets.data.reduce((a, t) => a + t.accessible, 0);
    return total > 0 ? { total, acc, share: acc / total } : null;
  }, [toilets.data]);

  return (
    <div className="space-y-3">
      <Section title="시설 유형" aside={`표시 중 ${fmt(visible.length)}개`}>
        <div className="grid grid-cols-2 gap-1.5">
          {TYPES.map((t) => {
            const on = enabled[t];
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => setEnabled((e) => ({ ...e, [t]: !e[t] }))}
                className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[12px] transition-colors ${
                  on ? "border-line bg-[#161e30]" : "border-line/50 opacity-45"
                }`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: INFRA_HEX[t] }}
                />
                <span className="text-ink">{INFRA_LABEL[t]}</span>
                <span className="tnum ml-auto text-[11px] text-dim">
                  {points.data ? fmt(counts[t]) : "—"}
                </span>
              </button>
            );
          })}
        </div>
        {!points.data && (
          <div className="mt-2">
            <DataPending note="infra_points.json 대기 중 — 시설 포인트가 지도에 표시됩니다." />
          </div>
        )}
        {points.data && (
          <p className="mt-2 text-[11px] leading-4 text-dim">
            가장 희소한 자원은 <b className="text-ink">전동휠체어 급속충전기</b>{" "}
            {fmt(counts.charger)}기입니다 — 병의원 {fmt(counts.hospital)}곳,
            약국 {fmt(counts.pharmacy)}곳과 비교하면 자릿수가 다릅니다. 해운대구
            전체에 16개소뿐인데(2025년 기준), 전동휠체어는 배터리가 떨어지면
            그 자리에서 멈추는 이동수단입니다. 충전소가 없는 동네는 전동휠체어
            이용자에게 &ldquo;갈 수는 있어도 오래 머물 수 없는 곳&rdquo;이
            됩니다. 지도에서 충전기를 다른 시설보다 크게 그린 이유입니다.
          </p>
        )}
      </Section>

      <Section title="구별 장애인화장실" aside="공중화장실 중 보유 개소">
        {toilets.data ? (
          <>
            <ToiletsBar data={toilets.data} />
            {toiletShare && (
              <p className="mt-1.5 text-[11px] leading-4 text-dim">
                공중화장실 {fmt(toiletShare.total)}곳 중 장애인용 설비를 갖춘
                곳은 {fmt(toiletShare.acc)}곳, 약 {pct(toiletShare.share)}
                입니다. 뒤집어 말하면 절반 이상의 공중화장실은 휠체어
                이용자가 쓸 수 없습니다 — 외출 반경과 체류 시간을 조용히
                제한하는 요인입니다.
              </p>
            )}
          </>
        ) : (
          <DataPending note="toilets_gu.json 대기 중" />
        )}
      </Section>

      <Section
        title="도시철도 승강설비"
        aside={lifts.data ? `승강기 없는 역 ${fmt(noElevator)}곳` : undefined}
        flush
      >
        {lifts.data ? (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] text-dim">
                <th className="px-3.5 py-1.5 font-medium">호선</th>
                <th className="py-1.5 font-medium">역</th>
                <th className="tnum py-1.5 text-right font-medium">승강기</th>
                <th className="tnum px-3.5 py-1.5 text-right font-medium">에스컬레이터</th>
              </tr>
            </thead>
            <tbody>
              {liftRows.map((l) => (
                <tr key={`${l.line}-${l.station}`} className="border-b border-line/60 last:border-b-0">
                  <td className="px-3.5 py-1.5 text-dim">{l.line}</td>
                  <td className="py-1.5 text-ink">{l.station}</td>
                  <td className="tnum py-1.5 text-right text-ink">{l.elevators}</td>
                  <td className="tnum px-3.5 py-1.5 text-right text-dim">{l.escalators}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={4} className="px-3.5 py-1.5 text-[11px] text-dim">
                  승강기 많은 역 상위 8곳 · 전체 {fmt(lifts.data.length)}역 (2025)
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <div className="px-3.5 py-3">
            <DataPending note="elevators.json 대기 중" />
          </div>
        )}
        {lifts.data && (
          <p className="px-3.5 pb-2.5 pt-1 text-[11px] leading-4 text-dim">
            도시철도는 두리발이 커버하지 못하는 장거리 이동의 대안입니다.
            승강기가 없는 역이 아직 {fmt(noElevator)}곳 남아 있어, 해당 역
            생활권에서는 두리발 의존도가 그만큼 높아집니다.
          </p>
        )}
      </Section>

      <Explainer
        what={
          <>
            <p>
              앞의 씬들이 &ldquo;수요&rdquo;를 그렸다면, 이 화면은 문제의
              반대편 절반인 <b>공급(무장애 인프라)</b>을 그립니다. 전동휠체어
              급속충전기·병의원·약국·장애인복지시설·배리어프리 문화예술관광지의
              위치, 구별 장애인화장실 보유율, 도시철도 승강설비까지 —
              &ldquo;두리발에서 내린 다음&rdquo;의
              환경을 구성하는 요소들입니다. 유형 버튼으로 레이어를 켜고 끄며
              수요 밀집 지역과 겹쳐볼 수 있습니다.
            </p>
            <p className="mt-2">
              <b>어떻게 활용하나</b> — 구청·시는 충전소와 장애인화장실처럼
              공공이 직접 설치할 수 있는 시설의 공백 지역을 확인하고,
              민간(윌체어 같은 접근성 정보 서비스)은 정보 공백이 큰 지역의
              조사 우선순위를 잡을 수 있습니다. 수요와 인프라를 실제로 겹쳐
              점수화한 결과는 &lsquo;사각지대 분석&rsquo;·&lsquo;도착지
              사각지대&rsquo; 씬에 있습니다.
            </p>
          </>
        }
        how={
          <>
            <p>
              시설 지도는 공공데이터 포인트를 그대로 찍은 것입니다: 전동휠체어
              급속충전기(부산시), 병의원·약국(건강보험심사평가원),
              장애인복지시설(SHP), 배리어프리 문화예술관광지(한국문화정보원,
              전국 데이터 중 부산광역시만 필터링). 장애인화장실은 원자료에
              좌표가 없어 구
              단위 집계로만 보여줍니다(공중화장실 중 장애인용 대변기 등
              설비를 1개 이상 갖춘 개소 비율). 도시철도 승강설비는 역별
              승강기·에스컬레이터 대수의 2025년 현황 스냅샷입니다.
            </p>
          </>
        }
        caveats={
          <>
            <p>
              공공데이터는 갱신 주기가 제각각입니다 — 승강설비는 2025년
              스냅샷을 쓰지만, 일부 공개 데이터셋(예: 2021년 역별 정보)은
              이후의 설치·철거를 반영하지 못해 교차 검증이 필요합니다.
              시설의 &ldquo;존재&rdquo;와 &ldquo;실제 사용 가능&rdquo;은
              다릅니다: 충전기가 고장이거나 접근 동선에 턱이 있어도 지도에는
              똑같은 점으로 찍힙니다. 병의원 수에는 장애인 편의시설 유무가
              반영되어 있지 않습니다 — 본선에서 윌체어의 무장애 가게
              데이터(경사로·입구턱·장애인화장실 등 12개 항목)가 결합되면
              &ldquo;몇 곳인가&rdquo;에서 &ldquo;실제로 들어갈 수 있는가&rdquo;로
              해상도가 올라갑니다.
            </p>
          </>
        }
      />
    </div>
  );
}
