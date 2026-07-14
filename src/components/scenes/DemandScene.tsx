"use client";

import { useEffect, useMemo, useState } from "react";
import { GeoJsonLayer, HexagonLayer } from "deck.gl";
import { DATA, type AnimTrip, type DongProps } from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt } from "@/lib/format";
import { HEX, HEX_COLOR_RANGE } from "@/lib/palette";
import { tooltipHtml, type DongCollection, type MapSpec } from "@/lib/mapspec";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";

type Mode = "hex" | "choro";

interface Pt {
  position: [number, number];
  hour: number;
}

export function DemandScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const trips = useData<AnimTrip[]>(DATA.tripsAnim);
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);

  const [mode, setMode] = useState<Mode>("hex");
  const [h0, setH0] = useState(0);
  const [h1, setH1] = useState(24);

  // Both trip endpoints (O + D) feed the hexagons; hour = depart hour.
  const points = useMemo<Pt[]>(() => {
    if (!trips.data) return [];
    const out: Pt[] = [];
    for (const t of trips.data) {
      const hour = Math.floor(t.t[0] / 3600);
      out.push({ position: t.p[0], hour });
      out.push({ position: t.p[1], hour });
    }
    return out;
  }, [trips.data]);

  const filtered = useMemo(
    () => points.filter((p) => p.hour >= h0 && p.hour < h1),
    [points, h0, h1],
  );

  const layers = useMemo(() => {
    if (mode === "hex") {
      if (filtered.length === 0) return [];
      return [
        new HexagonLayer<Pt>({
          id: "demand-hex",
          data: filtered,
          getPosition: (d) => d.position,
          radius: 250,
          extruded: true,
          // max column ≈ 1.2km — visible at city zoom without piercing the camera
          elevationScale: 1,
          elevationRange: [0, 1200],
          coverage: 0.85,
          colorRange: HEX_COLOR_RANGE,
          pickable: true,
          opacity: 0.6,
        }),
      ];
    }
    if (!dongs.data) return [];
    const max = Math.max(1, ...dongs.data.features.map((f) => f.properties.dropoffs));
    return [
      new GeoJsonLayer<DongProps>({
        id: "demand-choro",
        data: dongs.data as never,
        pickable: true,
        stroked: true,
        getFillColor: (f) => {
          const t = Math.sqrt(f.properties.dropoffs / max);
          return [56, 189, 248, Math.round(20 + t * 200)];
        },
        getLineColor: [35, 43, 61, 220],
        getLineWidth: 1,
        lineWidthUnits: "pixels",
      }),
    ];
  }, [mode, filtered, dongs.data]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    if (mode === "hex") {
      return (info) => {
        const o = info.object as { count?: number; points?: unknown[] } | undefined;
        if (!o) return null;
        const n = o.count ?? o.points?.length ?? 0;
        return tooltipHtml(`반경 250m 셀<br/><b>${fmt(n)}</b> 승·하차 지점`);
      };
    }
    return (info) => {
      const f = info.object as { properties: DongProps } | undefined;
      if (!f?.properties) return null;
      const p = f.properties;
      return tooltipHtml(
        `<b>${p.gu} ${p.name}</b><br/>하차 ${fmt(p.dropoffs)}건 · 승차 ${fmt(p.pickups)}건<br/>미배차 ${fmt(p.unassigned)}건`,
      );
    };
  }, [mode]);

  useEffect(() => {
    onMapSpec({ layers, getTooltip });
  }, [layers, getTooltip, onMapSpec]);

  return (
    <div className="space-y-3">
      <Section title="표시 방식">
        <div className="grid grid-cols-2 gap-1 rounded-md border border-line bg-[#0e1424] p-1">
          {(
            [
              ["hex", "3D 밀도 (250m)"],
              ["choro", "행정동 하차"],
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded px-2 py-1.5 text-[12px] font-medium transition-colors ${
                mode === m ? "bg-accent/15 text-accent" : "text-dim hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-4 text-dim">
          3D 밀도는 승·하차 지점을 250m 육각 셀로 집계해 기둥 높이로 보여줍니다.
        </p>
      </Section>

      <Section title="시간대 필터" aside={`${h0}시 – ${h1}시`}>
        <div className="space-y-2">
          <label className="block text-[11px] text-dim">
            시작 <span className="tnum text-ink">{h0}시</span>
            <input
              type="range"
              min={0}
              max={23}
              value={h0}
              onChange={(e) => setH0(Math.min(Number(e.target.value), h1 - 1))}
              className="mt-1 w-full"
            />
          </label>
          <label className="block text-[11px] text-dim">
            종료 <span className="tnum text-ink">{h1}시</span>
            <input
              type="range"
              min={1}
              max={24}
              value={h1}
              onChange={(e) => setH1(Math.max(Number(e.target.value), h0 + 1))}
              className="mt-1 w-full"
            />
          </label>
          <p className="tnum text-[11px] text-dim">
            선택 구간 지점 {fmt(filtered.length)}개 / 전체 {fmt(points.length)}개
          </p>
        </div>
      </Section>

      {mode === "hex" && !trips.data && (
        <DataPending note="trips_anim.json 대기 중 — 3D 수요 밀도가 표시됩니다." />
      )}
      {mode === "choro" && !dongs.data && (
        <DataPending note="dongs.geojson 대기 중 — 행정동 하차 밀도가 표시됩니다." />
      )}

      <Section title="읽는 법">
        <p className="text-[12px] leading-5 text-dim">
          기둥이 높을수록(색이 밝을수록) 두리발 승·하차가 밀집한 곳입니다. 시간대
          필터로 통원 피크(오전 11시·오후 3시)와 심야 공백을 비교해 보세요.
        </p>
      </Section>
    </div>
  );
}
