"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PAGES, PAGE_SLUG, type PageId } from "@/lib/scenes";
import { EMPTY_SPEC, type MapSpec } from "@/lib/mapspec";
import { Sidebar } from "@/components/Sidebar";
import { BottomTabBar } from "@/components/BottomTabBar";
import { MapCanvas } from "@/components/MapCanvas";
import { FlowScene } from "@/components/scenes/FlowScene";
import { BlindspotsScene } from "@/components/scenes/BlindspotsScene";
import { BlindspotsHaeundaeScene } from "@/components/scenes/BlindspotsHaeundaeScene";
import { InfrastructureScene } from "@/components/scenes/InfrastructureScene";
import { DispatchScene } from "@/components/scenes/DispatchScene";
import { StatisticsScene } from "@/components/scenes/StatisticsScene";
import { DispatchEtaScene } from "@/components/scenes/DispatchEtaScene";
import { AccessibilityDecisionScene } from "@/components/scenes/AccessibilityDecisionScene";
import { StatisticalEvidenceScene } from "@/components/scenes/StatisticalEvidenceScene";

/** Pages rebuilt as self-contained compositions own the whole content area
 *  (KPI band, map, side column, action strip) and receive the map as a slot.
 *  The remaining pages still use the legacy map + right-panel shell. */
const COMPOSED: ReadonlySet<PageId> = new Set<PageId>([
  "accessibility-decision",
  "infrastructure",
  "blindspots",
  "blindspots-hw",
  "dispatch-analysis",
  "statistics",
  "statistical-evidence",
]);

export default function Dashboard({ page }: { page: PageId }) {
  const router = useRouter();
  const [mapSpec, setMapSpec] = useState<MapSpec>(EMPTY_SPEC);

  const onMapSpec = useCallback((spec: MapSpec) => setMapSpec(spec), []);
  const pageDef = PAGES.find((item) => item.id === page) ?? PAGES[0];

  // 페이지가 바뀌면 이전 화면의 레이어를 지운다 — 새 씬이 자기 것을 올린다.
  useEffect(() => setMapSpec(EMPTY_SPEC), [page]);

  const selectPage = useCallback(
    (id: PageId) => router.push(`/${PAGE_SLUG[id]}`),
    [router],
  );

  const map: ReactNode = <MapCanvas spec={mapSpec} />;

  const composed = COMPOSED.has(page);

  const legacyPanel: ReactNode = (
    <>
      {page === "flow" && <FlowScene onMapSpec={onMapSpec} />}
      {page === "dispatchEta" && <DispatchEtaScene onMapSpec={onMapSpec} />}
    </>
  );

  return (
    // 폰: 세로 스택(내용 + 하단 탭) / lg: 이상: 가로(사이드바 + 내용).
    // h-[100dvh]는 iOS 주소창이 접혔다 펴져도 지도가 잘리지 않게 한다.
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-bg text-ink lg:flex-row">
      <Sidebar page={page} onSelect={selectPage} />

      {composed ? (
        <main className="min-h-0 min-w-0 flex-1">
          {page === "accessibility-decision" && (
            <AccessibilityDecisionScene
              onMapSpec={onMapSpec}
              map={map}
              onDrilldown={() => selectPage("blindspots-hw")}
            />
          )}
          {page === "infrastructure" && (
            <InfrastructureScene onMapSpec={onMapSpec} map={map} />
          )}
          {page === "blindspots" && (
            <BlindspotsScene onMapSpec={onMapSpec} map={map} />
          )}
          {page === "blindspots-hw" && (
            <BlindspotsHaeundaeScene onMapSpec={onMapSpec} map={map} />
          )}
          {page === "statistical-evidence" && (
            <StatisticalEvidenceScene onMapSpec={onMapSpec} map={map} />
          )}
          {page === "dispatch-analysis" && (
            <DispatchScene onMapSpec={onMapSpec} map={map} />
          )}
          {page === "statistics" && (
            <StatisticsScene onMapSpec={onMapSpec} map={map} />
          )}
        </main>
      ) : (
        // 레거시 셸(지도 + 우측 패널) — 폰에서는 지도가 위 45vh, 패널이 아래
        // 나머지를 차지하며 스크롤한다. lg: 이상은 기존 좌우 배치 그대로.
        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
          <main className="relative h-[45vh] min-w-0 shrink-0 lg:h-auto lg:flex-1">
            {map}
            <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-2">
              <div className="pointer-events-none rounded-lg border border-line bg-panel/90 px-3.5 py-2.5 backdrop-blur">
                <div className="text-[13px] font-bold leading-5 text-ink">
                  {pageDef.label}
                </div>
                <div className="text-[11px] leading-4 text-dim">
                  {pageDef.caption}
                </div>
              </div>
              {mapSpec.overlay}
            </div>
          </main>

          <aside className="min-h-0 flex-1 overflow-y-auto border-t border-line bg-bg p-3 lg:w-[400px] lg:flex-none lg:border-l lg:border-t-0">
            {legacyPanel}
          </aside>
        </div>
      )}

      <BottomTabBar page={page} onSelect={selectPage} />
    </div>
  );
}
