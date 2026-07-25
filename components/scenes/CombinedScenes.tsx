"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  DATA,
  type AccessActions,
  type ArrivalDeserts,
  type DisabilityData,
  type DongProps,
  type GuToilets,
  type InfraPoint,
  type ModelResult,
  type OdPair,
  type Stats,
  type TourismDeserts,
  type UnmetCell,
  type WaitKm,
  type WelfareProgramsData,
} from "@/lib/types";
import { useData } from "@/lib/useData";
import {
  EMPTY_SPEC,
  type DongCollection,
  type MapSpec,
} from "@/lib/mapspec";
import { fmt, pct } from "@/lib/format";
import { HEX } from "@/lib/palette";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";
import { InfraScene } from "@/components/scenes/InfraScene";
import { WelfareScene } from "@/components/scenes/WelfareScene";
import { GapScene } from "@/components/scenes/GapScene";
import { OdScene } from "@/components/scenes/OdScene";
import { DesertsScene } from "@/components/scenes/DesertsScene";
import { Last400Scene } from "@/components/scenes/Last400Scene";
import { TourismScene } from "@/components/scenes/TourismScene";
import { ForensicsScene } from "@/components/scenes/ForensicsScene";
import { DemandScene } from "@/components/scenes/DemandScene";
import { UnmetScene } from "@/components/scenes/UnmetScene";
import { PriorityScene } from "@/components/scenes/PriorityScene";
import { DisabilityScene } from "@/components/scenes/DisabilityScene";

type SceneComponent = ComponentType<{ onMapSpec: (spec: MapSpec) => void }>;

interface ModuleDef {
  id: string;
  label: string;
  caption: string;
  component: SceneComponent;
  /** Redundant boundary layers that would cover the shared base choropleth. */
  suppressLayerIds?: string[];
  mapVisible?: boolean;
  mapLayer?: boolean;
  detailOpen?: boolean;
  scope?: string;
}

interface CapturedSpec {
  spec: MapSpec;
  sequence: number;
}

const REGION_LAYER_IDS = new Set([
  "gap-choro",
  "forensics-wait-choropleth",
  "demand-choro",
  "priority-choro",
  "disability-choro",
]);

function SceneCapture({
  id,
  component: Component,
  onCapture,
}: {
  id: string;
  component: SceneComponent;
  onCapture: (id: string, spec: MapSpec) => void;
}) {
  const capture = useCallback(
    (spec: MapSpec) => onCapture(id, spec),
    [id, onCapture],
  );
  return <Component onMapSpec={capture} />;
}

function SceneModulePanel({
  module,
  onCapture,
}: {
  module: ModuleDef;
  onCapture: (id: string, spec: MapSpec) => void;
}) {
  const [open, setOpen] = useState(module.detailOpen ?? false);

  return (
    <section className="mb-3 overflow-hidden rounded-lg border border-line bg-panel/30">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 border-b border-line bg-panel/70 px-3 py-2 text-left"
      >
        <span>
          <span className="block text-[12px] font-bold leading-5 text-ink">
            {module.label}
          </span>
          <span className="block text-[10px] leading-4 text-dim">
            {module.caption}
          </span>
        </span>
        <span className="text-[10px] text-dim">
          {open ? "접기 ▴" : "상세 보기 ▾"}
        </span>
      </button>
      <div className={open ? "p-2" : "hidden"}>
        <SceneCapture
          id={module.id}
          component={module.component}
          onCapture={onCapture}
        />
      </div>
    </section>
  );
}

function CompositeMapScene({
  modules,
  summary: Summary,
  onMapSpec,
}: {
  modules: ModuleDef[];
  summary?: ComponentType;
  onMapSpec: (spec: MapSpec) => void;
}) {
  const [captured, setCaptured] = useState<Record<string, CapturedSpec>>({});
  const [visible, setVisible] = useState(
    () =>
      new Set(
        modules
          .filter(
            (module) =>
              module.mapLayer !== false && module.mapVisible !== false,
          )
          .map((module) => module.id),
      ),
  );
  const sequence = useRef(0);

  const onCapture = useCallback((id: string, spec: MapSpec) => {
    setCaptured((current) => {
      if (current[id]?.spec === spec) return current;
      sequence.current += 1;
      return {
        ...current,
        [id]: { spec, sequence: sequence.current },
      };
    });
  }, []);

  const merged = useMemo<MapSpec>(() => {
    const active = modules
      .filter((module) => visible.has(module.id))
      .map((module) => ({
        module,
        captured: captured[module.id],
      }))
      .filter(
        (
          item,
        ): item is {
          module: ModuleDef;
          captured: CapturedSpec;
        } => Boolean(item.captured),
      );

    const layers = active.flatMap(({ module, captured: item }) => {
      const suppressed = new Set(module.suppressLayerIds ?? []);
      return item.spec.layers
        .filter((layer) => !suppressed.has(layer.id))
        .map((layer) =>
          REGION_LAYER_IDS.has(layer.id)
            ? layer.clone({
                pickable: true,
                autoHighlight: true,
                highlightColor: [255, 255, 255, 72],
              })
            : layer,
        );
    });

    const tooltipByLayer = new Map<
      string,
      NonNullable<MapSpec["getTooltip"]>
    >();
    for (const { module, captured: item } of active) {
      if (typeof item.spec.getTooltip !== "function") continue;
      const suppressed = new Set(module.suppressLayerIds ?? []);
      for (const layer of item.spec.layers) {
        if (!suppressed.has(layer.id)) {
          tooltipByLayer.set(layer.id, item.spec.getTooltip);
        }
      }
    }

    const getTooltip: MapSpec["getTooltip"] = (info) => {
      const tooltip = info.layer?.id
        ? tooltipByLayer.get(info.layer.id)
        : undefined;
      return tooltip?.(info) ?? null;
    };

    const latestFlight = [...active]
      .filter(({ captured: item }) => item.spec.flyTo)
      .sort((a, b) => b.captured.sequence - a.captured.sequence)[0];

    const overlays = active
      .map(({ module, captured: item }) =>
        item.spec.overlay ? (
          <Fragment key={module.id}>{item.spec.overlay}</Fragment>
        ) : null,
      )
      .filter(Boolean);

    return {
      layers,
      getTooltip,
      flyTo: latestFlight?.captured.spec.flyTo ?? null,
      overlay: overlays.length ? (
        <div className="flex flex-col items-start gap-2">{overlays}</div>
      ) : undefined,
    };
  }, [captured, modules, visible]);

  useEffect(() => {
    onMapSpec(merged);
  }, [merged, onMapSpec]);

  const toggleLayer = useCallback((id: string) => {
    setVisible((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <>
      {Summary && <Summary />}

      <Section title="통합 지도 레이어" aside="여러 데이터를 한 지도에서 비교">
        <div className="flex flex-wrap gap-1.5">
          {modules.filter((module) => module.mapLayer !== false).map((module) => {
            const active = visible.has(module.id);
            const layerCount = captured[module.id]?.spec.layers.length ?? 0;
            return (
              <button
                key={module.id}
                type="button"
                onClick={() => toggleLayer(module.id)}
                aria-pressed={active}
                className={`rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                  active
                    ? "border-accent/60 bg-accent/15 text-accent"
                    : "border-line bg-panel text-dim hover:text-ink"
                }`}
              >
                {active ? "●" : "○"} {module.label}
                {layerCount > 1 ? ` · ${layerCount}` : ""}
              </button>
            );
          })}
        </div>
        <div className="mt-2 space-y-1 border-t border-line/70 pt-2">
          {modules
            .filter((module) => module.scope)
            .map((module) => (
              <div
                key={module.id}
                className="flex items-start justify-between gap-3 text-[9.5px] leading-4"
              >
                <span className="text-dim">{module.label}</span>
                <span className="text-right text-ink/70">{module.scope}</span>
              </div>
            ))}
          <p className="pt-1 text-[9px] leading-4 text-dim">
            회색·비표시 지역은 값이 0이라는 뜻이 아니라 원자료 범위 밖이거나
            표본이 부족할 수 있습니다.
          </p>
        </div>
      </Section>

      {modules.map((module) => (
        <SceneModulePanel
          key={module.id}
          module={module}
          onCapture={onCapture}
        />
      ))}
    </>
  );
}

function CompactMetrics({
  items,
}: {
  items: {
    label: string;
    value: string;
    sub?: string;
    color?: string;
  }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-md border border-line bg-[#0e1424] px-3 py-2.5"
        >
          <div
            className="mb-1.5 h-0.5 w-5 rounded-full"
            style={{ background: item.color ?? HEX.accent }}
          />
          <div className="text-[10px] leading-4 text-dim">{item.label}</div>
          <div className="tnum text-[17px] font-bold leading-6 text-ink">
            {item.value}
          </div>
          {item.sub && (
            <div className="text-[9.5px] leading-4 text-dim">{item.sub}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function InfrastructureSummary() {
  const points = useData<InfraPoint[]>(DATA.infraPoints);
  const toilets = useData<GuToilets[]>(DATA.toiletsGu);
  const welfare = useData<WelfareProgramsData>(DATA.welfarePrograms);

  const centers = new Set(
    (welfare.data?.programs ?? []).map((program) => program.center),
  ).size;
  const accessibleToilets = (toilets.data ?? []).reduce(
    (sum, item) => sum + item.accessible,
    0,
  );

  return (
    <Section title="생활 접근성 한눈에" aside="시설 + 서비스">
      <CompactMetrics
        items={[
          {
            label: "지도 시설",
            value: points.data ? `${fmt(points.data.length)}개` : "—",
            color: HEX.infra,
          },
          {
            label: "장애인화장실",
            value: toilets.data ? `${fmt(accessibleToilets)}개` : "—",
            color: HEX.accent,
          },
          {
            label: "복지 프로그램",
            value: welfare.data ? `${fmt(welfare.data.stats.total)}건` : "—",
            color: HEX.warn,
          },
          {
            label: "프로그램 운영기관",
            value: welfare.data ? `${fmt(centers)}곳` : "—",
            color: HEX.demand,
          },
        ]}
      />
    </Section>
  );
}

function BlindspotSummary() {
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);
  const od = useData<OdPair[]>(DATA.od);
  const deserts = useData<ArrivalDeserts>(DATA.arrivalDeserts);
  const access = useData<AccessActions>(DATA.accessActions);
  const tourism = useData<TourismDeserts>(DATA.tourism);

  const priorityDongs =
    dongs.data?.features.filter(
      (feature) => feature.properties.gapClass === "HL",
    ).length ?? 0;
  const odTrips = (od.data ?? []).reduce((sum, pair) => sum + pair.count, 0);
  const enterableShare = access.data
    ? access.data.summary.enterable / Math.max(1, access.data.summary.shops)
    : 0;

  return (
    <Section title="이동에서 진입까지" aside="도시 → 도착지 → 400m">
      <CompactMetrics
        items={[
          {
            label: "우선 사각지대",
            value: dongs.data ? `${fmt(priorityDongs)}개 동` : "—",
            color: HEX.unmet,
          },
          {
            label: "주요 OD 이동",
            value: od.data ? `${fmt(odTrips)}건` : "—",
            sub: "지도에 포함된 주요 흐름 합계",
            color: HEX.demand,
          },
          {
            label: "도착지 공백 격자",
            value: deserts.data ? `${fmt(deserts.data.cells.length)}곳` : "—",
            color: HEX.warn,
          },
          {
            label: "400m 진입 가능",
            value: access.data ? pct(enterableShare) : "—",
            sub: access.data
              ? `${fmt(access.data.summary.enterable)}/${fmt(access.data.summary.shops)}개소`
              : undefined,
            color: HEX.infra,
          },
          {
            label: "관광지 베리어프리",
            value: tourism.data
              ? pct(tourism.data.stats.barrierFreeShare)
              : "—",
            sub: tourism.data
              ? `${fmt(tourism.data.stats.barrierFree)}/${fmt(tourism.data.stats.total)}곳`
              : undefined,
            color: HEX.accent,
          },
        ]}
      />
    </Section>
  );
}

function DispatchSummary() {
  const stats = useData<Stats>(DATA.stats);
  const wait = useData<WaitKm>(DATA.waitKm);
  const unmet = useData<UnmetCell[]>(DATA.unmet);
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);
  const [selectedHour, setSelectedHour] = useState(8);
  const [originCd, setOriginCd] = useState("");
  const [destinationCd, setDestinationCd] = useState("");
  const [wheelchair, setWheelchair] = useState<
    "none" | "manual" | "electric"
  >("manual");

  const worstHour = wait.data?.queue.reduce<
    WaitKm["queue"][number] | undefined
  >(
    (worst, row) =>
      !worst || row.unassignedRate > worst.unassignedRate ? row : worst,
    undefined,
  );
  const unmetRequests = (unmet.data ?? []).reduce(
    (sum, cell) => sum + cell.unassigned + cell.cancelled,
    0,
  );
  const selected = wait.data?.queue.find(
    (row) => row.hour === selectedHour,
  );
  const baseExpected =
    selected?.p50Assign != null && selected.p50Board != null
      ? selected.p50Assign + selected.p50Board
      : null;
  const features = dongs.data?.features ?? [];
  const originOptions = useMemo(
    () =>
      [...features]
        .sort((a, b) => b.properties.pickups - a.properties.pickups)
        .map((feature) => feature.properties),
    [features],
  );
  const destinationOptions = useMemo(
    () =>
      [...features]
        .sort((a, b) => b.properties.dropoffs - a.properties.dropoffs)
        .map((feature) => feature.properties),
    [features],
  );
  const origin =
    originOptions.find((dong) => dong.admCd === originCd) ??
    originOptions[0];
  const destination =
    destinationOptions.find((dong) => dong.admCd === destinationCd) ??
    destinationOptions[0];

  const cityUnassignedRate = stats.data?.totals.unassignedRate ?? 0;
  const originUnassignedRate = origin
    ? origin.unassigned / Math.max(1, origin.pickups + origin.unassigned)
    : cityUnassignedRate;
  const pressureFactor = Math.max(
    0.8,
    Math.min(1.5, 1 + (originUnassignedRate - cityUnassignedRate) * 2),
  );
  const wheelchairFactor =
    wheelchair === "electric" ? 1.12 : wheelchair === "manual" ? 1.06 : 1;
  const expectedTotal =
    baseExpected != null
      ? baseExpected * pressureFactor * wheelchairFactor
      : null;
  const estimatedRisk = selected
    ? Math.max(
        0,
        Math.min(
          1,
          selected.unassignedRate *
            (1 + (originUnassignedRate - cityUnassignedRate)) *
            (wheelchair === "electric"
              ? 1.15
              : wheelchair === "manual"
                ? 1.07
                : 1),
        ),
      )
    : null;
  const priorityScore =
    expectedTotal != null && estimatedRisk != null
      ? Math.min(
          100,
          Math.round(
            expectedTotal * 0.7 +
              estimatedRisk * 300 +
              (wheelchair === "electric"
                ? 12
                : wheelchair === "manual"
                  ? 6
                  : 0),
          ),
        )
      : null;
  const recommendation =
    priorityScore == null
      ? "분석 대기"
      : priorityScore >= 70
        ? "우선 배차 권고"
        : priorityScore >= 45
          ? "주의 배차"
          : "일반 배차";
  const destinationWarning =
    !destination
      ? null
      : wheelchair === "electric" && destination.chargers === 0
        ? "도착 행정동에 전동휠체어 급속충전기가 없습니다."
        : destination.gapClass === "HL"
          ? "도착지가 수요 대비 인프라가 부족한 우선 사각지대입니다."
          : null;

  return (
    <Section title="배차 판단 핵심 신호" aside="현재는 과거 데이터 기반">
      <CompactMetrics
        items={[
          {
            label: "배차 대기 중앙값",
            value:
              wait.data?.km.median != null
                ? `${wait.data.km.median.toFixed(1)}분`
                : "—",
            color: HEX.warn,
          },
          {
            label: "전체 미배차율",
            value: stats.data ? pct(stats.data.totals.unassignedRate) : "—",
            color: HEX.unmet,
          },
          {
            label: "최대 위험 시간",
            value: worstHour ? `${worstHour.hour}시` : "—",
            sub: worstHour
              ? `미배차 ${pct(worstHour.unassignedRate)}`
              : undefined,
            color: HEX.demand,
          },
          {
            label: "지도 미충족 요청",
            value: unmet.data ? `${fmt(unmetRequests)}건` : "—",
            sub: "좌표가 있는 미배차·취소",
            color: HEX.accent,
          },
        ]}
      />
      <div className="mt-3 rounded-md border border-line bg-[#0e1424] px-3 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] text-dim">특정 시간 예상 대기</div>
            <div className="tnum text-[20px] font-bold leading-7 text-ink">
              {String(selectedHour).padStart(2, "0")}:00
              <span className="ml-2 text-accent">
                {expectedTotal != null
                  ? `약 ${expectedTotal.toFixed(0)}분`
                  : "표본 부족"}
              </span>
            </div>
          </div>
          <div className="text-right text-[10px] leading-4 text-dim">
            <div>요청 {selected ? fmt(selected.requests) : "—"}건</div>
            <div>
              미배차 {selected ? pct(selected.unassignedRate) : "—"}
            </div>
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={23}
          step={1}
          value={selectedHour}
          onChange={(event) => setSelectedHour(Number(event.target.value))}
          className="mt-2 w-full"
          aria-label="예상 대기시간 조회 시각"
        />
        <div className="mt-1 flex justify-between text-[9px] text-dim">
          <span>00시</span>
          <span>12시</span>
          <span>23시</span>
        </div>
        {selected && (
          <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] leading-4">
            <div className="rounded border border-line px-2 py-1.5 text-dim">
              접수→배차{" "}
              <b className="tnum text-ink">
                {selected.p50Assign != null
                  ? `${selected.p50Assign.toFixed(0)}분`
                  : "—"}
              </b>
            </div>
            <div className="rounded border border-line px-2 py-1.5 text-dim">
              배차→승차{" "}
              <b className="tnum text-ink">
                {selected.p50Board != null
                  ? `${selected.p50Board.toFixed(0)}분`
                  : "—"}
              </b>
            </div>
          </div>
        )}
        <p className="mt-2 text-[9.5px] leading-4 text-dim">
          2025년 5월 같은 시간대의 단계별 중앙값을 합산한 근사치이며,
          실시간 배차 예측은 아닙니다.
        </p>
      </div>

      <div className="mt-3 rounded-md border border-accent/30 bg-accent/[0.04] px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-semibold text-accent">
              배차 시뮬레이션
            </div>
            <div className="text-[9.5px] leading-4 text-dim">
              시간·출발지·휠체어 조건 기반
            </div>
          </div>
          <div className="rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 text-right">
            <div className="text-[9px] text-dim">우선순위</div>
            <div className="tnum text-[14px] font-bold text-accent">
              {priorityScore ?? "—"}점
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-2">
          <label className="text-[10px] text-dim">
            출발 행정동
            <select
              value={origin?.admCd ?? ""}
              onChange={(event) => setOriginCd(event.target.value)}
              className="mt-1 w-full rounded-md border border-line bg-[#0e1424] px-2 py-1.5 text-[11px] text-ink"
            >
              {originOptions.map((dong) => (
                <option key={dong.admCd} value={dong.admCd}>
                  {dong.gu} {dong.name} · 승차 {fmt(dong.pickups)}건
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] text-dim">
            도착 행정동
            <select
              value={destination?.admCd ?? ""}
              onChange={(event) => setDestinationCd(event.target.value)}
              className="mt-1 w-full rounded-md border border-line bg-[#0e1424] px-2 py-1.5 text-[11px] text-ink"
            >
              {destinationOptions.map((dong) => (
                <option key={dong.admCd} value={dong.admCd}>
                  {dong.gu} {dong.name} · 하차 {fmt(dong.dropoffs)}건
                </option>
              ))}
            </select>
          </label>
          <div>
            <div className="text-[10px] text-dim">휠체어 조건</div>
            <div className="mt-1 grid grid-cols-3 gap-1">
              {(
                [
                  ["none", "미이용"],
                  ["manual", "수동"],
                  ["electric", "전동"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setWheelchair(value)}
                  aria-pressed={wheelchair === value}
                  className={`rounded border px-2 py-1.5 text-[10px] ${
                    wheelchair === value
                      ? "border-accent/60 bg-accent/15 text-accent"
                      : "border-line bg-[#0e1424] text-dim"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded border border-line bg-[#0e1424] px-2 py-2">
            <div className="text-[9px] text-dim">예상 총 대기</div>
            <div className="tnum text-[17px] font-bold text-ink">
              {expectedTotal != null ? `${expectedTotal.toFixed(0)}분` : "—"}
            </div>
          </div>
          <div className="rounded border border-line bg-[#0e1424] px-2 py-2">
            <div className="text-[9px] text-dim">미배차 위험</div>
            <div className="tnum text-[17px] font-bold text-unmet">
              {estimatedRisk != null ? pct(estimatedRisk) : "—"}
            </div>
          </div>
        </div>

        <div className="mt-2 rounded border border-accent/30 bg-accent/10 px-2.5 py-2">
          <div className="text-[11px] font-bold text-accent">
            {recommendation}
          </div>
          <div className="mt-0.5 text-[9.5px] leading-4 text-dim">
            선택 시간의 대기·미배차율, 출발지 미충족 비율, 휠체어 조건을
            함께 반영했습니다.
          </div>
        </div>
        {destinationWarning && (
          <div className="mt-2 rounded border border-warn/40 bg-warn/10 px-2.5 py-2 text-[10px] leading-4 text-warn">
            도착지 확인: {destinationWarning}
          </div>
        )}
        <p className="mt-2 text-[9px] leading-4 text-dim">
          데모용 휴리스틱입니다. 실제 차량 위치·도로시간·운전자 상태를
          사용하지 않으며 운영 배차 결정을 대체하지 않습니다.
        </p>
        <div className="mt-2 flex items-center justify-between rounded border border-line bg-[#0e1424] px-2.5 py-2 text-[9px] leading-4">
          <span className="text-dim">LLM 설명 계층</span>
          <span className="text-warn">
            미연결 · OpenAI-compatible API 교체 가능
          </span>
        </div>
      </div>
    </Section>
  );
}

function StatisticsSummary() {
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);
  const models = useData<ModelResult[]>(DATA.modelResults);
  const disability = useData<DisabilityData>(DATA.disability);

  const top = dongs.data
    ? [...dongs.data.features].sort(
        (a, b) => b.properties.gapScore - a.properties.gapScore,
      )[0]?.properties
    : undefined;
  const confirmed = (models.data ?? []).filter(
    (model) => model.status === "final",
  ).length;

  return (
    <Section title="우선순위와 근거" aside="결정용 요약">
      <CompactMetrics
        items={[
          {
            label: "격차점수 1위",
            value: top ? top.name : "—",
            sub: top ? `${top.gu} · ${top.gapScore.toFixed(2)}점` : undefined,
            color: HEX.unmet,
          },
          {
            label: "통계 분석",
            value: models.data ? `${fmt(models.data.length)}개` : "—",
            sub: models.data ? `최종 확정 ${fmt(confirmed)}개` : undefined,
            color: HEX.accent,
          },
          {
            label: "등록현황 확보",
            value: disability.data
              ? `${fmt(disability.data.totals.guWithRegistry)}개 구·군`
              : "—",
            color: HEX.infra,
          },
          {
            label: "확인 등록 장애인",
            value: disability.data
              ? `${fmt(disability.data.totals.registeredKnown)}명`
              : "—",
            color: HEX.demand,
          },
        ]}
      />
    </Section>
  );
}

function ModelSummaryScene({
  onMapSpec,
}: {
  onMapSpec: (spec: MapSpec) => void;
}) {
  const models = useData<ModelResult[]>(DATA.modelResults);

  useEffect(() => {
    onMapSpec(EMPTY_SPEC);
  }, [onMapSpec]);

  if (models.loading || !models.data) {
    return (
      <DataPending
        note={
          models.error
            ? "model_results.json을 불러오지 못했습니다. 자동으로 다시 시도합니다."
            : "model_results.json 대기 중 — 핵심 통계 결과가 여기 표시됩니다."
        }
      />
    );
  }

  return (
    <Section title="핵심 정책 근거" aside={`${models.data.length}개 분석`}>
      <div className="space-y-2">
        {models.data.map((model) => (
          <article
            key={model.id}
            className="rounded-md border border-line bg-[#0e1424] px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold text-dim">
                {model.name}
              </div>
              <span className="rounded border border-line px-1.5 py-0.5 text-[9px] text-dim">
                {model.status === "final"
                  ? "확정"
                  : model.status === "rehearsal"
                    ? "리허설"
                    : "대기"}
              </span>
            </div>
            <div className="mt-1 text-[12px] font-bold leading-5 text-ink">
              {model.headline}
            </div>
            <p className="mt-1 text-[10.5px] leading-4 text-dim">
              {model.detail}
            </p>
          </article>
        ))}
      </div>
    </Section>
  );
}

const INFRASTRUCTURE_MODULES: ModuleDef[] = [
  {
    id: "infra",
    label: "시설 지도",
    caption: "충전소·의료·화장실·도시철도 시설",
    component: InfraScene,
    detailOpen: true,
    scope: "부산 전역 공공데이터",
  },
  {
    id: "welfare",
    label: "복지 프로그램",
    caption: "복지관 위치와 장애유형별 프로그램",
    component: WelfareScene,
    scope: "프로그램 원자료 확보 5개구",
  },
];

const BLINDSPOT_MODULES: ModuleDef[] = [
  {
    id: "gap",
    label: "지역 격차",
    caption: "수요와 인프라의 행정동별 격차",
    component: GapScene,
    detailOpen: true,
    scope: "부산 206개 행정동 · 2025년 5월",
  },
  {
    id: "od",
    label: "이동 흐름",
    caption: "행정동 간 주요 출발·도착 흐름",
    component: OdScene,
    suppressLayerIds: ["od-dongs"],
    scope: "주요 OD 400개 · 2025년 5월",
  },
  {
    id: "deserts",
    label: "도착지 공백",
    caption: "하차 밀집지와 시설 공백 250m 격자",
    component: DesertsScene,
    suppressLayerIds: ["deserts-dongs"],
    scope: "부산 전역 하차 250m 격자",
  },
  {
    id: "last400",
    label: "도착 이후 400m",
    caption: "하차 지점과 실제 진입 가능성",
    component: Last400Scene,
    suppressLayerIds: ["l4-dongs"],
    scope: "송정동 무장애가게 실사 표본",
  },
  {
    id: "tourism",
    label: "관광 접근성",
    caption: "관광지와 베리어프리 커버리지",
    component: TourismScene,
    scope: "부산 전역 관광 원자료",
  },
];

const DISPATCH_MODULES: ModuleDef[] = [
  {
    id: "forensics",
    label: "시간대별 대기",
    caption: "대기시간과 시간대별 차량 가동",
    component: ForensicsScene,
    detailOpen: true,
    scope: "부산 전역 · 2025년 5월",
  },
  {
    id: "demand",
    label: "이동수요",
    caption: "승하차 수요의 공간·시간 분포",
    component: DemandScene,
    mapVisible: false,
    scope: "부산 전역 · 2025년 5월",
  },
  {
    id: "unmet",
    label: "미충족 수요",
    caption: "미배차·취소 요청의 공간 분포",
    component: UnmetScene,
    scope: "약 100m 집계 · 개인 좌표 미표시",
  },
];

const STATISTICS_MODULES: ModuleDef[] = [
  {
    id: "priority",
    label: "개선 우선순위",
    caption: "격차점수 순위와 충전소 개선 시뮬레이션",
    component: PriorityScene,
    detailOpen: true,
    scope: "부산 206개 행정동",
  },
  {
    id: "models",
    label: "정책 근거",
    caption: "핵심 통계 검증 결과",
    component: ModelSummaryScene,
    mapLayer: false,
    scope: "리허설·확정 상태를 결과별 표시",
  },
  {
    id: "disability",
    label: "장애인 수요",
    caption: "등록 장애인과 두리발 이용 격차",
    component: DisabilityScene,
    mapVisible: false,
    scope: "등록현황 확보 9개구 · 미확보 지역 회색",
  },
];

export function InfrastructureCombinedScene({
  onMapSpec,
}: {
  onMapSpec: (spec: MapSpec) => void;
}) {
  return (
    <CompositeMapScene
      modules={INFRASTRUCTURE_MODULES}
      summary={InfrastructureSummary}
      onMapSpec={onMapSpec}
    />
  );
}

export function BlindspotsCombinedScene({
  onMapSpec,
}: {
  onMapSpec: (spec: MapSpec) => void;
}) {
  return (
    <CompositeMapScene
      modules={BLINDSPOT_MODULES}
      summary={BlindspotSummary}
      onMapSpec={onMapSpec}
    />
  );
}

export function DispatchCombinedScene({
  onMapSpec,
}: {
  onMapSpec: (spec: MapSpec) => void;
}) {
  return (
    <CompositeMapScene
      modules={DISPATCH_MODULES}
      summary={DispatchSummary}
      onMapSpec={onMapSpec}
    />
  );
}

export function StatisticsCombinedScene({
  onMapSpec,
}: {
  onMapSpec: (spec: MapSpec) => void;
}) {
  return (
    <CompositeMapScene
      modules={STATISTICS_MODULES}
      summary={StatisticsSummary}
      onMapSpec={onMapSpec}
    />
  );
}
