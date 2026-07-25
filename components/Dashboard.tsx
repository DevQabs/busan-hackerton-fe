"use client";

import { useCallback, useState, type ReactNode } from "react";
import { PAGES, type PageId } from "@/lib/scenes";
import { EMPTY_SPEC, type MapSpec } from "@/lib/mapspec";
import { Sidebar } from "@/components/Sidebar";
import { MapCanvas } from "@/components/MapCanvas";
import { OverviewScene } from "@/components/scenes/OverviewScene";
import { FlowScene } from "@/components/scenes/FlowScene";
import { BlindspotsScene } from "@/components/scenes/BlindspotsScene";
import { InfrastructureScene } from "@/components/scenes/InfrastructureScene";
import { DispatchScene } from "@/components/scenes/DispatchScene";
import { StatisticsScene } from "@/components/scenes/StatisticsScene";

/** Pages rebuilt as self-contained compositions own the whole content area
 *  (KPI band, map, side column, action strip) and receive the map as a slot.
 *  The remaining pages still use the legacy map + right-panel shell. */
const COMPOSED: ReadonlySet<PageId> = new Set<PageId>([
  "infrastructure",
  "blindspots",
  "dispatch-analysis",
  "statistics",
]);

export default function Dashboard() {
  const [page, setPage] = useState<PageId>("overview");
  const [mapSpec, setMapSpec] = useState<MapSpec>(EMPTY_SPEC);

  const onMapSpec = useCallback((spec: MapSpec) => setMapSpec(spec), []);
  const pageDef = PAGES.find((item) => item.id === page) ?? PAGES[0];

  const selectPage = useCallback((id: PageId) => {
    setPage(id);
    setMapSpec(EMPTY_SPEC);
  }, []);

  const map: ReactNode = <MapCanvas spec={mapSpec} />;

  const composed = COMPOSED.has(page);

  const legacyPanel: ReactNode = (
    <>
      {page === "overview" && <OverviewScene onMapSpec={onMapSpec} />}
      {page === "flow" && <FlowScene onMapSpec={onMapSpec} />}
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-ink">
      <Sidebar page={page} onSelect={selectPage} />

      {composed ? (
        <main className="min-w-0 flex-1">
          {page === "infrastructure" && (
            <InfrastructureScene onMapSpec={onMapSpec} map={map} />
          )}
          {page === "blindspots" && (
            <BlindspotsScene onMapSpec={onMapSpec} map={map} />
          )}
          {page === "dispatch-analysis" && (
            <DispatchScene onMapSpec={onMapSpec} map={map} />
          )}
          {page === "statistics" && (
            <StatisticsScene onMapSpec={onMapSpec} map={map} />
          )}
        </main>
      ) : (
        <>
          <main className="relative min-w-0 flex-1">
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

          <aside className="w-[400px] shrink-0 overflow-y-auto border-l border-line bg-bg p-3">
            {legacyPanel}
          </aside>
        </>
      )}
    </div>
  );
}
