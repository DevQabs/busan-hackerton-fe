"use client";

import { useCallback, useState } from "react";
import { SCENES, type SceneId } from "@/lib/scenes";
import { EMPTY_SPEC, type MapSpec } from "@/lib/mapspec";
import { Sidebar } from "@/components/Sidebar";
import { MapCanvas } from "@/components/MapCanvas";
import { OverviewScene } from "@/components/scenes/OverviewScene";
import { DemandScene } from "@/components/scenes/DemandScene";
import { FlowScene } from "@/components/scenes/FlowScene";
import { ForensicsScene } from "@/components/scenes/ForensicsScene";
import { DesertsScene } from "@/components/scenes/DesertsScene";
import { OdScene } from "@/components/scenes/OdScene";
import { GapScene } from "@/components/scenes/GapScene";
import { UnmetScene } from "@/components/scenes/UnmetScene";
import { InfraScene } from "@/components/scenes/InfraScene";
import { PriorityScene } from "@/components/scenes/PriorityScene";
import { ModelsScene } from "@/components/scenes/ModelsScene";
import { TourismScene } from "@/components/scenes/TourismScene";
import { WelfareScene } from "@/components/scenes/WelfareScene";
import { DisabilityScene } from "@/components/scenes/DisabilityScene";

export default function Dashboard() {
  const [scene, setScene] = useState<SceneId>("overview");
  const [mapSpec, setMapSpec] = useState<MapSpec>(EMPTY_SPEC);

  const onMapSpec = useCallback((spec: MapSpec) => setMapSpec(spec), []);
  const def = SCENES.find((s) => s.id === scene);

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-ink">
      <Sidebar scene={scene} onSelect={setScene} />

      <main className="relative min-w-0 flex-1">
        <MapCanvas spec={mapSpec} />
        {/* scene title chip + scene-owned overlay controls (e.g. search box) */}
        <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-2">
          <div className="pointer-events-none rounded-lg border border-line bg-panel/85 px-3.5 py-2.5 backdrop-blur">
            <div className="text-[13px] font-bold leading-5 text-ink">{def?.label}</div>
            <div className="text-[11px] leading-4 text-dim">{def?.caption}</div>
          </div>
          {mapSpec.overlay}
        </div>
      </main>

      <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-line bg-bg p-3">
        {scene === "overview" && <OverviewScene onMapSpec={onMapSpec} />}
        {scene === "demand" && <DemandScene onMapSpec={onMapSpec} />}
        {scene === "flow" && <FlowScene onMapSpec={onMapSpec} />}
        {scene === "forensics" && <ForensicsScene onMapSpec={onMapSpec} />}
        {scene === "deserts" && <DesertsScene onMapSpec={onMapSpec} />}
        {scene === "od" && <OdScene onMapSpec={onMapSpec} />}
        {scene === "gap" && <GapScene onMapSpec={onMapSpec} />}
        {scene === "unmet" && <UnmetScene onMapSpec={onMapSpec} />}
        {scene === "infra" && <InfraScene onMapSpec={onMapSpec} />}
        {scene === "priority" && <PriorityScene onMapSpec={onMapSpec} />}
        {scene === "models" && <ModelsScene onMapSpec={onMapSpec} />}
        {scene === "tourism" && <TourismScene onMapSpec={onMapSpec} />}
        {scene === "welfare" && <WelfareScene onMapSpec={onMapSpec} />}
        {scene === "disability" && <DisabilityScene onMapSpec={onMapSpec} />}
      </aside>
    </div>
  );
}
