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
import { Explainer } from "@/components/ui/Explainer";

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
          3D 밀도는 승·하차 지점을 250m 육각 셀로 집계해 기둥 높이로
          보여줍니다. 행정동 하차는 같은 수요를 행정 단위로 뭉쳐 &ldquo;어느
          동이 많은가&rdquo;를 한눈에 보여줍니다 — 두 시선을 오가며 보세요.
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

      <Explainer
        what={
          <>
            <p>
              두리발 이용자가 실제로 &ldquo;어디서 타고 어디에 내리는가&rdquo;를
              공간 위에 펼친 화면입니다. 같은 데이터를 두 가지 방식으로 볼 수
              있습니다. <b>3D 밀도(250m 육각 셀)</b>는 행정 경계와 무관하게
              수요가 진짜로 뭉치는 지점 — 병원 정문 앞, 복지관 골목 — 을
              드러내고, <b>행정동 하차</b>는 &ldquo;어느 동이 많은가&rdquo;라는
              행정 언어로 뭉쳐 보여줍니다. 정책은 행정동 단위로 집행되지만
              현장의 수요는 경계를 따르지 않기 때문에, 두 시선을 함께 두었습니다.
              행정동으로 뭉치면 큰 동 안의 국지적 집중이 평균에 묻히고(가림
              효과), 격자로 잘게 보면 우연한 몇 건이 과장돼 보일 수 있습니다 —
              서로의 약점을 보완하는 구성입니다.
            </p>
            <p className="mt-2">
              <b>어떻게 활용하나</b> — 공단은 시간대 필터로 통원 피크와 심야
              공백을 비교해 차량 배치 시간표를 검토하고, 구청은 하차 밀집
              지점을 무장애 인프라(경사로·화장실·충전소) 점검 동선과 겹쳐볼 수
              있습니다. 뒤의 &lsquo;도착지 사각지대&rsquo; 씬이 이 밀집 지점과
              시설 거리를 자동으로 대조합니다.
            </p>
          </>
        }
        how={
          <>
            <p>
              완료된 운행의 승차·하차 좌표를 각각 한 점으로 놓고, 3D 모드에서는
              반경 250m 육각형 셀에 떨어지는 점 개수를 세어 기둥 높이와 색으로
              표현했습니다. 시간대 필터는 승차(출발) 시각 기준입니다. 행정동
              모드의 음영은 동별 하차 건수를 제곱근 스케일로 칠해, 상위 몇 개
              동만 밝게 타버리지 않도록 했습니다. 좌표는 소수 4자리(약 10m)로
              반올림해 개인 식별 가능성을 낮췄습니다.
            </p>
          </>
        }
        caveats={
          <>
            <p>
              리허설 지도에서 가장 높은 기둥은 사상구 학장동 일대에 섭니다.
              다만 이 일대에는 두리발 차고지가 있어, 운행 시작·종료가 몰리며
              수요가 실제보다 커 보일 가능성이 있습니다 — 본선 데이터에서
              차고지 효과를 분리해 확인할 항목입니다. 또한 여기 보이는 것은
              &ldquo;배차에 성공한&rdquo; 수요입니다. 애초에 차량을 못 받았거나
              부르기를 포기한 수요는 이 지도에 없으며, 그 이야기는 &lsquo;미충족
              수요&rsquo;와 &lsquo;사각지대 분석&rsquo; 씬에서 다룹니다. 데이터는
              한 달(2025년 5월) 치입니다.
            </p>
          </>
        }
      />
    </div>
  );
}
