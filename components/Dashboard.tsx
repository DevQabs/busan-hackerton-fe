"use client";

import { useCallback, useState, type ReactNode } from "react";
import { PAGES, type PageId } from "@/lib/scenes";
import { EMPTY_SPEC, type MapSpec } from "@/lib/mapspec";
import { Sidebar } from "@/components/Sidebar";
import { MapCanvas } from "@/components/MapCanvas";
import { OverviewScene } from "@/components/scenes/OverviewScene";
import { FlowScene } from "@/components/scenes/FlowScene";
import {
  BlindspotsCombinedScene,
  DispatchCombinedScene,
  InfrastructureCombinedScene,
  StatisticsCombinedScene,
} from "@/components/scenes/CombinedScenes";

export default function Dashboard() {
  const [page, setPage] = useState<PageId>("overview");
  const [mapSpec, setMapSpec] = useState<MapSpec>(EMPTY_SPEC);

  const onMapSpec = useCallback((spec: MapSpec) => setMapSpec(spec), []);
  const pageDef = PAGES.find((item) => item.id === page) ?? PAGES[0];

  const selectPage = useCallback((id: PageId) => {
    setPage(id);
    setMapSpec(EMPTY_SPEC);
  }, []);

  const pageNode: ReactNode = (
    <>
      {page === "overview" && <OverviewScene onMapSpec={onMapSpec} />}
      {page === "flow" && <FlowScene onMapSpec={onMapSpec} />}
      {page === "infrastructure" && (
        <InfrastructureCombinedScene onMapSpec={onMapSpec} />
      )}
      {page === "blindspots" && (
        <BlindspotsCombinedScene onMapSpec={onMapSpec} />
      )}
      {page === "dispatch-analysis" && (
        <DispatchCombinedScene onMapSpec={onMapSpec} />
      )}
      {page === "statistics" && (
        <StatisticsCombinedScene onMapSpec={onMapSpec} />
      )}
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-ink">
      <Sidebar page={page} onSelect={selectPage} />

      <main className="relative min-w-0 flex-1">
        <MapCanvas spec={mapSpec} />
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
        {pageNode}
      </aside>
    </div>
  );
}
