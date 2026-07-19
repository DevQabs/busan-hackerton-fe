"use client";

import { useCallback, useState, type ReactNode } from "react";
import { SCENES, type SceneId } from "@/lib/scenes";
import { EMPTY_SPEC, type MapSpec } from "@/lib/mapspec";
import { Sidebar } from "@/components/Sidebar";
import { MapCanvas } from "@/components/MapCanvas";
import { OverviewScene } from "@/components/scenes/OverviewScene";
import { DemandScene } from "@/components/scenes/DemandScene";
import { FlowScene } from "@/components/scenes/FlowScene";
import { ForensicsScene } from "@/components/scenes/ForensicsScene";
import { DesertsScene } from "@/components/scenes/DesertsScene";
import { Last400Scene } from "@/components/scenes/Last400Scene";
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

  const sceneNode: ReactNode = (
    <>
      {scene === "overview" && <OverviewScene onMapSpec={onMapSpec} />}
      {scene === "demand" && <DemandScene onMapSpec={onMapSpec} />}
      {scene === "flow" && <FlowScene onMapSpec={onMapSpec} />}
      {scene === "forensics" && <ForensicsScene onMapSpec={onMapSpec} />}
      {scene === "deserts" && <DesertsScene onMapSpec={onMapSpec} />}
      {scene === "last400" && <Last400Scene onMapSpec={onMapSpec} />}
      {scene === "od" && <OdScene onMapSpec={onMapSpec} />}
      {scene === "gap" && <GapScene onMapSpec={onMapSpec} />}
      {scene === "unmet" && <UnmetScene onMapSpec={onMapSpec} />}
      {scene === "infra" && <InfraScene onMapSpec={onMapSpec} />}
      {scene === "priority" && <PriorityScene onMapSpec={onMapSpec} />}
      {scene === "models" && <ModelsScene onMapSpec={onMapSpec} />}
      {scene === "tourism" && <TourismScene onMapSpec={onMapSpec} />}
      {scene === "welfare" && <WelfareScene onMapSpec={onMapSpec} />}
      {scene === "disability" && <DisabilityScene onMapSpec={onMapSpec} />}
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-ink">
      <Sidebar scene={scene} onSelect={setScene} />

      {def?.fullPage ? (
        // 읽기 중심 씬 — 지도 대신 본문이 중앙 전체를 차지 (우측 패널 없음)
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1500px] px-5 py-4">
            <header className="mb-3 px-0.5">
              <div className="text-[16px] font-bold leading-6 text-ink">
                {def.label}
              </div>
              <div className="text-[12px] leading-4 text-dim">{def.caption}</div>
            </header>
            {sceneNode}
          </div>
        </main>
      ) : (
        <>
          <main className="relative min-w-0 flex-1">
            <MapCanvas spec={mapSpec} />
            {/* scene title chip + scene-owned overlay controls (e.g. search box) */}
            <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-2">
              <div className="pointer-events-none rounded-lg border border-line bg-panel/85 px-3.5 py-2.5 backdrop-blur">
                <div className="text-[13px] font-bold leading-5 text-ink">
                  {def?.label}
                </div>
                <div className="text-[11px] leading-4 text-dim">{def?.caption}</div>
              </div>
              {mapSpec.overlay}
            </div>
          </main>

          <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-line bg-bg p-3">
            {sceneNode}
          </aside>
        </>
      )}
    </div>
  );
}
