"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArcLayer,
  GeoJsonLayer,
  HeatmapLayer,
  PathLayer,
  ScatterplotLayer,
  TextLayer,
} from "deck.gl";
import type { Layer } from "@deck.gl/core";
import {
  DATA,
  type DisabilityData,
  type DisabilityGu,
  type DongProps,
  type GuToilets,
  type AnimTrip,
  type InfraPoint,
  type OdPair,
  type TravelTimes,
} from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt } from "@/lib/format";
import { HEX } from "@/lib/palette";
import {
  tooltipHtml,
  type DongCollection,
  type FlyTo,
  type MapSpec,
} from "@/lib/mapspec";
import {
  ActionCard,
  Chip,
  KpiTile,
  MapToolbar,
  PresentationLayout,
  type StoryStep,
} from "@/components/PresentationLayout";
import { DataPending } from "@/components/ui/DataPending";

type Step = "compare" | "profile";
type Basis = "balanced" | "population" | "trips";
/** 두 층위를 한 지도에 섞지 않는다: 배분 비교는 구, 실제 도달 거리는 행정동. */
type View = "gu" | "dong";
/** 공급 지도 위에 실제 수요를 겹쳐 "시설은 여기, 사람은 저기"를 한 화면에 둔다. */
type Overlay = "none" | "heat" | "arcs";
type Ring = [number, number][];
type Polygon = Ring[];
/** 두 점으로 이뤄진 경계 조각. */
type Segment = [[number, number], [number, number]];
type FacilityKey =
  | "chargers"
  | "medical"
  | "welfare"
  | "toilets"
  | "floor1Shops";
type Lens = "all" | FacilityKey;

interface Supply {
  chargers: number;
  medical: number;
  welfare: number;
  toilets: number;
  floor1Shops: number;
}

interface GuBase {
  gu: DisabilityGu;
  center: [number, number];
  supply: Supply;
}

interface FacilityMetric {
  key: FacilityKey;
  actual: number;
  expected: number;
  ratio: number;
  shortfall: number;
}

interface GuProfile extends GuBase {
  populationShare: number;
  tripShare: number;
  needShare: number;
  facilities: FacilityMetric[];
  deficitCount: number;
  severity: number;
}

const STEPS: StoryStep[] = [
  { id: "compare", label: "16개 구·군 비교", caption: "인구와 이용 대비 공급" },
  { id: "profile", label: "선택 지역 해석", caption: "시설별 기대·실제" },
];

const FACILITY_KEYS: FacilityKey[] = [
  "chargers",
  "medical",
  "welfare",
  "toilets",
  "floor1Shops",
];

const FACILITY_LABEL: Record<FacilityKey, string> = {
  chargers: "휠체어 충전기",
  medical: "병의원·약국",
  welfare: "장애인복지시설",
  toilets: "장애인화장실",
  floor1Shops: "1층 상가 프록시",
};

const FACILITY_SHORT: Record<FacilityKey, string> = {
  chargers: "충전",
  medical: "의료",
  welfare: "복지",
  toilets: "화장실",
  floor1Shops: "1층상가",
};

const FACILITY_COLOR: Record<FacilityKey, string> = {
  chargers: HEX.accent,
  medical: HEX.infra,
  welfare: HEX.warn,
  toilets: "#f472b6",
  floor1Shops: HEX.demand,
};

/** 좌표가 있는 시설만 점으로 찍는다 — 화장실·상가는 좌표가 없어 제외된다. */
const POINT_TYPES: Record<FacilityKey, InfraPoint["type"][]> = {
  chargers: ["charger"],
  medical: ["hospital", "pharmacy"],
  welfare: ["welfare"],
  toilets: [],
  floor1Shops: [],
};

const POINT_COLOR: Record<string, [number, number, number]> = {
  charger: [14, 165, 233],
  hospital: [45, 212, 191],
  pharmacy: [45, 212, 191],
  welfare: [251, 191, 36],
};

const POINT_LABEL: Record<string, string> = {
  charger: "휠체어 충전기",
  hospital: "병의원",
  pharmacy: "약국",
  welfare: "장애인복지시설",
};

const BASIS_LABEL: Record<Basis, string> = {
  balanced: "인구 50% + 이용 50%",
  population: "등록 인구만",
  trips: "완료 이용만",
};

/** 기준을 바꾸면 "필요"의 정의가 바뀐다 — 무엇이 달라지는지 화면에서 밝힌다. */
const BASIS_MEANING: Record<Basis, { headline: string; detail: string }> = {
  balanced: {
    headline: "사는 사람과 실제로 오가는 사람을 같은 무게로",
    detail:
      "등록 인구 비중과 완료 이용 비중을 절반씩 섞습니다. 거주 기반 형평과 실제 통행량 어느 한쪽에도 치우치지 않는 기본값이며, 두 값이 크게 다른 지역에서는 중간값이 나옵니다.",
  },
  population: {
    headline: "거주 형평 — 사는 사람 수만큼 시설이 있어야 한다",
    detail:
      "등록 장애인 비중만으로 기대량을 잡습니다. 이용이 적은 지역이 불리해지지 않아, 이동이 어려워 아예 호출을 못 하는 곳을 드러내는 데 유리합니다. 반대로 외부에서 사람이 몰려오는 목적지형 지역은 과소평가됩니다.",
  },
  trips: {
    headline: "실수요 — 실제로 오간 만큼 시설이 있어야 한다",
    detail:
      "완료 이용 비중만으로 기대량을 잡습니다. 사람이 실제로 모이는 곳을 우선하게 되지만, 이용이 억눌린 지역은 필요 자체가 작게 잡히는 위험이 있습니다.",
  },
};

/** 칩용 축약 — 전체 문구는 KPI 밴드가 계속 보여준다. */
const BASIS_SHORT: Record<Basis, string> = {
  balanced: "50:50",
  population: "인구",
  trips: "이용",
};

/** 부산 위도대에서 도(度) → m. 구 단위 비교에는 충분한 근사. */
const M_PER_LAT = 111_320;
const M_PER_LNG = 91_000;

function metersBetween(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const dx = (a[0] - b[0]) * M_PER_LNG;
  const dy = (a[1] - b[1]) * M_PER_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 직선거리 → 도로 주행거리 근사. 두가자는 차로 이동하므로 우회를 보정한다. */
const DETOUR = 1.3;

/** 양(배분)과 거리(도달)는 서로 다른 종류의 공백이다. 두 축을 한 문장으로 합친다. */
function verdictFor(
  deficitShare: number,
  accessPercentile: number | null,
): { title: string; detail: string; tone: string } {
  const scarce = deficitShare >= 0.4;
  const far = accessPercentile !== null && accessPercentile >= 0.6;
  if (scarce && far) {
    return {
      title: "이중 공백",
      detail: "개수도 부족하고 거리도 멉니다 — 최우선 검토 대상",
      tone: HEX.gapHL,
    };
  }
  if (!scarce && far) {
    return {
      title: "거리 문제",
      detail:
        "인구 대비 개수는 부족하지 않지만 동이 넓어 도달이 멉니다 — 증설보다 위치 재배치·순회 서비스",
      tone: HEX.warn,
    };
  }
  if (scarce && !far) {
    return {
      title: "밀집지 부족",
      detail:
        "가까이는 있지만 이용자 수에 비해 개수가 모자랍니다 — 기존 거점의 수용력 보강",
      tone: HEX.demand,
    };
  }
  return {
    title: "상대적 양호",
    detail: "두 기준 모두 부산 평균 근처입니다",
    tone: HEX.infra,
  };
}

/** 부산 206개 행정동 안에서의 백분위로 칠한다 — 구 지도와 같은 "평균 대비" 언어. */
function fillForPercentile(
  percentile: number,
): [number, number, number, number] {
  if (percentile >= 0.75) return [229, 72, 77, 195];
  if (percentile >= 0.5) return [251, 191, 36, 155];
  if (percentile >= 0.25) return [56, 189, 248, 110];
  return [52, 211, 153, 130];
}

function distanceText(meters: number): string {
  if (!Number.isFinite(meters)) return "없음";
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)}km`
    : `${Math.round(meters / 50) * 50}m`;
}

function emptySupply(): Supply {
  return {
    chargers: 0,
    medical: 0,
    welfare: 0,
    toilets: 0,
    floor1Shops: 0,
  };
}

function ratioText(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function levelOf(ratio: number): string {
  if (ratio < 0.75) return "평균보다 크게 낮음";
  if (ratio < 1) return "평균보다 낮음";
  if (ratio < 1.25) return "평균 수준";
  return "평균보다 높음";
}

function fillForRatio(ratio: number): [number, number, number, number] {
  if (ratio < 0.75) {
    const severity = Math.min(1, (0.75 - ratio) / 0.75);
    return [229, 72, 77, Math.round(125 + severity * 90)];
  }
  if (ratio < 1) return [251, 191, 36, 145];
  if (ratio < 1.25) return [56, 189, 248, 95];
  return [52, 211, 153, 145];
}

function fillForDeficits(
  facilities: FacilityMetric[],
): [number, number, number, number] {
  const strong = facilities.filter((metric) => metric.ratio < 0.75).length;
  const belowAverage = facilities.filter(
    (metric) => metric.ratio < 1,
  ).length;
  if (strong >= 2) return [229, 72, 77, 195];
  if (strong === 1) return [251, 191, 36, 155];
  if (belowAverage >= 2) return [56, 189, 248, 100];
  return [52, 211, 153, 120];
}

function actionFor(metric: FacilityMetric): {
  action: string;
  owner: string;
  impact: string;
} {
  const count = Math.max(0, Math.ceil(metric.shortfall));
  if (metric.key === "chargers") {
    return {
      action: `충전기 후보 ${fmt(count)}곳의 위치·운영 가능성 검토`,
      owner: "구청·복지시설",
      impact: "부산 평균 배분 수준까지의 수량 시나리오",
    };
  }
  if (metric.key === "medical") {
    return {
      action: `의료시설 ${fmt(count)}곳 상당의 접근 경로 우선 점검`,
      owner: "구청·의료기관",
      impact: "시설 신설 확정이 아닌 접근성 조사 물량",
    };
  }
  if (metric.key === "welfare") {
    return {
      action: `복지 거점 ${fmt(count)}곳 상당의 서비스 공백 검토`,
      owner: "구청·복지기관",
      impact: "시설·순회 서비스·인접구 연계를 함께 검토",
    };
  }
  if (metric.key === "toilets") {
    return {
      action: `장애인화장실 ${fmt(count)}곳 상당의 위치·운영 공백 확인`,
      owner: "구청·시설관리",
      impact: "현재 원자료는 구별 개수만 있어 위치 조사가 먼저 필요",
    };
  }
  return {
    action: "1층 상가의 진입 가능 여부를 표본 조사",
    owner: "구청·상인회",
    impact: "1층은 접근 가능 확정이 아니라 조사 우선 프록시",
  };
}

function RatioBar({ metric }: { metric: FacilityMetric }) {
  // Шкала 0..200%: городская пропорциональная доля (100%) стоит по центру,
  // поэтому избыток больше не выглядит так же, как ровно 100%.
  const width = Math.min(100, metric.ratio * 50);
  const color =
    metric.ratio < 0.75
      ? HEX.gapHL
      : metric.ratio < 1
        ? HEX.warn
        : HEX.infra;
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-[11px]">
        <span className="font-semibold text-ink">
          {FACILITY_LABEL[metric.key]}
        </span>
        <span className="tnum ml-auto font-bold" style={{ color }}>
          {ratioText(metric.ratio)}
        </span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${width}%`, background: color }}
        />
        <span className="absolute bottom-0 left-1/2 top-0 w-px bg-white/90" />
      </div>
      <div className="mt-1 flex justify-between text-[9.5px] text-dim">
        <span>
          실제 {fmt(Math.round(metric.actual))} · 기대{" "}
          {metric.expected.toFixed(metric.expected >= 10 ? 0 : 1)}
        </span>
        <span>100% 기준 · {levelOf(metric.ratio)}</span>
      </div>
    </div>
  );
}

export function AccessibilityDecisionScene({
  onMapSpec,
  map,
  onDrilldown,
}: {
  onMapSpec: (spec: MapSpec) => void;
  map: ReactNode;
  /** 해운대구는 본선 데이터가 따로 있어 상세 페이지로 넘긴다 — 두 데이터를
   *  한 화면에 섞지 않고 페이지 경계에서 갈아끼운다. */
  onDrilldown?: () => void;
}) {
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);
  const disability = useData<DisabilityData>(DATA.disability);
  const toilets = useData<GuToilets[]>(DATA.toiletsGu);
  const infra = useData<InfraPoint[]>(DATA.infraPoints);
  const travel = useData<TravelTimes>(DATA.travelTimes);
  const trips = useData<AnimTrip[]>(DATA.tripsAnim);
  const od = useData<OdPair[]>(DATA.od);
  const [step, setStep] = useState<Step>("compare");
  const [basis, setBasis] = useState<Basis>("balanced");
  const [lens, setLens] = useState<Lens>("all");
  const [view, setView] = useState<View>("gu");
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [selectedGu, setSelectedGu] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);

  useEffect(() => {
    if (
      view === "dong" &&
      lens !== "all" &&
      POINT_TYPES[lens].length === 0
    ) {
      setLens("all");
    }
  }, [lens, view]);

  const bases = useMemo<GuBase[]>(() => {
    const source = disability.data?.gus ?? [];
    const aggregates = new Map<
      string,
      { supply: Supply; lng: number; lat: number; n: number }
    >();

    for (const feature of dongs.data?.features ?? []) {
      const p = feature.properties;
      const row = aggregates.get(p.gu) ?? {
        supply: emptySupply(),
        lng: 0,
        lat: 0,
        n: 0,
      };
      row.supply.chargers += p.chargers;
      row.supply.medical += p.hospitals + p.pharmacies;
      row.supply.welfare += p.welfare;
      row.supply.floor1Shops += p.shops * (p.shopsFloor1Share ?? 0);
      row.lng += p.centroid[0];
      row.lat += p.centroid[1];
      row.n += 1;
      aggregates.set(p.gu, row);
    }

    // 장애인화장실은 원자료에 좌표가 없어 구 단위 개수로만 합류시킨다.
    const accessibleToilets = new Map(
      (toilets.data ?? []).map((row) => [row.gu, row.accessible]),
    );

    return source.flatMap((gu) => {
      const row = aggregates.get(gu.gu);
      if (!row || row.n === 0 || gu.registered === null) return [];
      return [
        {
          gu,
          supply: {
            ...row.supply,
            toilets: accessibleToilets.get(gu.gu) ?? 0,
          },
          center: [row.lng / row.n, row.lat / row.n] as [number, number],
        },
      ];
    });
  }, [disability.data, dongs.data, toilets.data]);

  /** infra_points는 행정동 이름만 가지고 있어 구는 경계 데이터에서 되찾는다. */
  const guOfDong = useMemo(() => {
    const out = new Map<string, string>();
    for (const feature of dongs.data?.features ?? []) {
      out.set(feature.properties.name, feature.properties.gu);
    }
    return out;
  }, [dongs.data]);

  const citySupply = useMemo(
    () =>
      bases.reduce<Supply>((total, base) => {
        for (const key of FACILITY_KEYS) total[key] += base.supply[key];
        return total;
      }, emptySupply()),
    [bases],
  );

  const profiles = useMemo<GuProfile[]>(() => {
    const registeredTotal = bases.reduce(
      (sum, base) => sum + (base.gu.registered ?? 0),
      0,
    );
    const tripTotal = bases.reduce((sum, base) => sum + base.gu.trips, 0);

    return bases.map((base) => {
      const populationShare =
        (base.gu.registered ?? 0) / Math.max(1, registeredTotal);
      const tripShare = base.gu.trips / Math.max(1, tripTotal);
      const needShare =
        basis === "population"
          ? populationShare
          : basis === "trips"
            ? tripShare
            : (populationShare + tripShare) / 2;
      const facilities = FACILITY_KEYS.map((key) => {
        const actual = base.supply[key];
        const expected = citySupply[key] * needShare;
        const ratio = expected > 0 ? actual / expected : 1;
        return {
          key,
          actual,
          expected,
          ratio,
          shortfall: Math.max(0, expected - actual),
        };
      });
      return {
        ...base,
        populationShare,
        tripShare,
        needShare,
        facilities,
        deficitCount: facilities.filter((metric) => metric.ratio < 1).length,
        severity: facilities.reduce(
          (sum, metric) => sum + Math.max(0, 1 - metric.ratio),
          0,
        ),
      };
    });
  }, [bases, basis, citySupply]);

  const ranked = useMemo(
    () =>
      [...profiles].sort(
        (a, b) =>
          b.deficitCount - a.deficitCount || b.severity - a.severity,
      ),
    [profiles],
  );
  const selected =
    profiles.find((profile) => profile.gu.gu === selectedGu) ??
    ranked[0] ??
    null;
  const selectedRank = selected
    ? ranked.findIndex((profile) => profile.gu.gu === selected.gu.gu) + 1
    : 0;
  const selectedWorst = selected
    ? [...selected.facilities].sort((a, b) => a.ratio - b.ratio)[0]
    : null;
  const selectedAction = selectedWorst ? actionFor(selectedWorst) : null;
  /** 평균 배분에 못 미치는 항목 전부 — 가장 낮은 것부터. */
  const deficits = selected
    ? selected.facilities
        .filter((metric) => metric.ratio < 1)
        .sort((a, b) => a.ratio - b.ratio)
    : [];

  const profileByGu = useMemo(
    () => new Map(profiles.map((profile) => [profile.gu.gu, profile])),
    [profiles],
  );

  /** 행정동 폴리곤을 구 하나로 합치고, 내부 경계선은 한 번만 등장하는 변으로 지운다. */
  const guGeo = useMemo(() => {
    const polygonsByGu = new Map<string, Polygon[]>();
    for (const feature of dongs.data?.features ?? []) {
      const geometry = feature.geometry as {
        type: string;
        coordinates: Polygon | Polygon[];
      };
      const polygons =
        geometry.type === "Polygon"
          ? [geometry.coordinates as Polygon]
          : (geometry.coordinates as Polygon[]);
      const bucket = polygonsByGu.get(feature.properties.gu) ?? [];
      bucket.push(...polygons);
      polygonsByGu.set(feature.properties.gu, bucket);
    }

    const features = [...polygonsByGu].map(([gu, polygons]) => ({
      type: "Feature" as const,
      properties: { gu },
      geometry: { type: "MultiPolygon" as const, coordinates: polygons },
    }));

    const outline: Segment[] = [];
    for (const [, polygons] of polygonsByGu) {
      const seen = new Map<string, Segment>();
      for (const rings of polygons) {
        for (const ring of rings) {
          for (let i = 1; i < ring.length; i += 1) {
            const a = ring[i - 1];
            const b = ring[i];
            const key =
              a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1])
                ? `${a[0]},${a[1]}|${b[0]},${b[1]}`
                : `${b[0]},${b[1]}|${a[0]},${a[1]}`;
            if (seen.has(key)) seen.delete(key);
            else seen.set(key, [a, b]);
          }
        }
      }
      outline.push(...seen.values());
    }

    return {
      collection: { type: "FeatureCollection" as const, features },
      outline,
    };
  }, [dongs.data]);

  const dongCentroids = useMemo(
    () =>
      new Map(
        (dongs.data?.features ?? []).map((feature) => [
          feature.properties.admCd,
          feature.properties.centroid,
        ]),
      ),
    [dongs.data],
  );

  /** 행정동 중심에서 가장 가까운 시설까지의 거리 — "도시 전체를 가로지르지 않는다"는 관점. */
  const dongAccess = useMemo(() => {
    const points = infra.data ?? [];
    if (points.length === 0) return [];
    // 병의원·약국은 거의 모든 동에 있어 거리로는 변별력이 없다 —
    // 기본값은 실제로 희소한 충전기·복지 거점으로 잡는다.
    const wanted =
      lens === "all"
        ? (["charger", "welfare"] as string[])
        : (POINT_TYPES[lens] as string[]);
    const targets = points.filter((point) => wanted.includes(point.type));
    const features = dongs.data?.features ?? [];

    // 실측 주행시간이 있으면 거리 대신 분을 쓴다. 없으면 직선거리 그대로.
    const observed = travel.data?.meta.status === "ok" ? travel.data : null;
    const minutesByPair = new Map(
      (observed?.pairs ?? []).map((pair) => [
        `${pair.o}|${pair.d}`,
        pair.medianMin,
      ]),
    );
    const kmh = observed?.meta.medianKmh || 0;
    /** 관측이 없는 쌍은 직선거리 × 우회계수 ÷ 관측 평균속도로 메운다. */
    const approxMinutes = (meters: number) =>
      kmh > 0 ? (meters * DETOUR) / 1000 / kmh * 60 : Number.POSITIVE_INFINITY;

    // 목표 시설이 하나라도 있는 행정동 — 주행시간은 동 단위로만 관측된다.
    const targetDongs = new Set<string>();
    if (observed) {
      const admCdByName = new Map(
        features.map((feature) => [
          feature.properties.name,
          feature.properties.admCd,
        ]),
      );
      for (const point of targets) {
        const admCd = point.dong ? admCdByName.get(point.dong) : undefined;
        if (admCd) targetDongs.add(admCd);
      }
    }

    const rows = features.map((feature) => {
      const p = feature.properties;
      let nearest = Number.POSITIVE_INFINITY;
      let within800 = 0;
      for (const point of targets) {
        const distance = metersBetween(p.centroid, [point.lng, point.lat]);
        if (distance < nearest) nearest = distance;
        if (distance <= 800) within800 += 1;
      }

      let minutes: number | null = null;
      if (observed) {
        // 자기 동 안에 시설이 있으면 실제 점까지의 거리가 가장 정확하다.
        minutes = targetDongs.has(p.admCd) ? approxMinutes(nearest) : Infinity;
        for (const admCd of targetDongs) {
          if (admCd === p.admCd) continue;
          const seen = minutesByPair.get(`${p.admCd}|${admCd}`);
          const value =
            seen ??
            approxMinutes(
              metersBetween(
                p.centroid,
                dongCentroids.get(admCd) ?? p.centroid,
              ),
            );
          if (value < minutes) minutes = value;
        }
        if (!Number.isFinite(minutes)) minutes = null;
      }

      return {
        admCd: p.admCd,
        gu: p.gu,
        name: p.name,
        nearest: nearest * DETOUR,
        minutes,
        within800,
        percentile: 0,
      };
    });
    // 절대 미터·분으로 칠하면 밀집한 부산은 거의 전부 초록이 된다.
    // 구 지도와 같은 언어("부산 평균 대비")를 쓰도록 백분위로 바꾼다.
    const cost = (row: (typeof rows)[number]) =>
      row.minutes ?? row.nearest / 1000;
    const order = [...rows].sort((a, b) => cost(a) - cost(b));
    order.forEach((row, index) => {
      row.percentile = order.length > 1 ? index / (order.length - 1) : 0;
    });
    return rows;
  }, [dongCentroids, dongs.data, infra.data, lens, travel.data]);

  const travelOn = travel.data?.meta.status === "ok";
  const medianNearest = useMemo(() => {
    const sorted = dongAccess
      .map((row) => row.nearest)
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  }, [dongAccess]);
  const medianMinutes = useMemo(() => {
    const sorted = dongAccess
      .map((row) => row.minutes)
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  }, [dongAccess]);

  /** 구의 도달 백분위 = 소속 행정동 백분위의 중앙값. */
  const accessByGu = useMemo(() => {
    const grouped = new Map<string, number[]>();
    for (const row of dongAccess) {
      const bucket = grouped.get(row.gu) ?? [];
      bucket.push(row.percentile);
      grouped.set(row.gu, bucket);
    }
    return new Map(
      [...grouped].map(([gu, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        return [gu, sorted[Math.floor(sorted.length / 2)]] as const;
      }),
    );
  }, [dongAccess]);

  const accessByDong = useMemo(
    () => new Map(dongAccess.map((row) => [row.admCd, row])),
    [dongAccess],
  );

  const selectedAccess = selected
    ? (accessByGu.get(selected.gu.gu) ?? null)
    : null;
  const verdict = selected
    ? verdictFor(
        selected.deficitCount / Math.max(1, selected.facilities.length),
        selectedAccess,
      )
    : null;

  /** 백분위만으로는 "그래서 얼마나 먼가"가 안 보인다 — 실제 값과 최악의 동. */
  const selectedDistance = useMemo(() => {
    if (!selected) return null;
    const rows = dongAccess.filter((row) => row.gu === selected.gu.gu);
    if (rows.length === 0) return null;
    const cost = (row: (typeof rows)[number]) =>
      row.minutes ?? row.nearest / 1000;
    const text = (row: (typeof rows)[number]) =>
      row.minutes !== null
        ? `${row.minutes.toFixed(0)}분`
        : distanceText(row.nearest);
    const sorted = [...rows].sort((a, b) => cost(a) - cost(b));
    const worst = sorted[sorted.length - 1];
    return {
      dongCount: rows.length,
      medianText: text(sorted[Math.floor(sorted.length / 2)]),
      worstName: worst.name,
      worstText: text(worst),
    };
  }, [dongAccess, selected]);

  const layers = useMemo<Layer[]>(() => {
    if (!dongs.data || profiles.length === 0) return [];
    const selectGu = (gu: string | undefined) => {
      const profile = gu ? profileByGu.get(gu) : null;
      if (!profile) return;
      setSelectedGu(profile.gu.gu);
      setFlyTo({
        longitude: profile.center[0],
        latitude: profile.center[1],
        zoom: step === "compare" ? 11 : 11.8,
      });
    };

    const out: Layer[] =
      view === "gu"
        ? [
            // 배분 비교는 구 단위 — 행정동 경계는 그리지 않는다.
            new GeoJsonLayer<{ gu: string }>({
              id: "gu-adequacy-map",
              data: guGeo.collection as never,
              pickable: true,
              filled: true,
              stroked: false,
              autoHighlight: true,
              highlightColor: [255, 255, 255, 45],
              getFillColor: (feature) => {
                const profile = profileByGu.get(feature.properties.gu);
                if (!profile) return [71, 85, 105, 25];
                const dim =
                  step === "profile" && profile.gu.gu !== selected?.gu.gu;
                const base: [number, number, number, number] =
                  lens === "all"
                    ? fillForDeficits(profile.facilities)
                    : (() => {
                        const metric = profile.facilities.find(
                          (item) => item.key === lens,
                        );
                        return metric
                          ? fillForRatio(metric.ratio)
                          : ([71, 85, 105, 25] as [
                              number,
                              number,
                              number,
                              number,
                            ]);
                      })();
                // 선택 지역을 강조하되 나머지 색은 남겨 기준 변경이 계속 보이게 한다.
                // 수요를 겹칠 때는 바닥색을 더 죽여 히트맵·화살이 읽히게 한다.
                const fade = (dim ? 0.4 : 1) * (overlay === "none" ? 1 : 0.45);
                return fade === 1
                  ? base
                  : [base[0], base[1], base[2], Math.round(base[3] * fade)];
              },
              onClick: (info) =>
                selectGu(
                  (info.object as { properties?: { gu: string } } | undefined)
                    ?.properties?.gu,
                ),
              updateTriggers: {
                getFillColor: [
                  basis,
                  lens,
                  overlay,
                  step,
                  selected?.gu.gu,
                  profileByGu,
                ],
              },
            }),
            new PathLayer<Segment>({
              id: "gu-adequacy-outline",
              data: guGeo.outline,
              getPath: (segment) => segment,
              getColor: [11, 15, 26, 180],
              getWidth: 1.2,
              widthUnits: "pixels",
              widthMinPixels: 1,
              pickable: false,
            }),
          ]
        : [
            // 도달 거리는 행정동 단위 — 구 경계만 위에 얹는다.
            new GeoJsonLayer<DongProps>({
              id: "dong-access-map",
              data: dongs.data as never,
              pickable: true,
              filled: true,
              stroked: true,
              autoHighlight: true,
              highlightColor: [255, 255, 255, 45],
              getFillColor: (feature) => {
                const row = accessByDong.get(feature.properties.admCd);
                if (!row || !Number.isFinite(row.nearest)) {
                  return [71, 85, 105, 25];
                }
                const base = fillForPercentile(row.percentile);
                if (overlay === "none") return base;
                return [base[0], base[1], base[2], Math.round(base[3] * 0.45)];
              },
              getLineColor: [11, 15, 26, 90],
              getLineWidth: 0.4,
              lineWidthUnits: "pixels",
              onClick: (info) =>
                selectGu(
                  (info.object as { properties?: DongProps } | undefined)
                    ?.properties?.gu,
                ),
              updateTriggers: { getFillColor: [accessByDong, lens, overlay] },
            }),
            new PathLayer<Segment>({
              id: "dong-access-outline",
              data: guGeo.outline,
              getPath: (segment) => segment,
              getColor: [226, 232, 240, 130],
              getWidth: 1.4,
              widthUnits: "pixels",
              widthMinPixels: 1,
              pickable: false,
            }),
          ];

    // 선택 지역의 실제 시설 위치 — 막대의 "실제" 값이 어디에 서 있는지 보여준다.
    const wanted =
      lens === "all"
        ? (["charger", "hospital", "pharmacy", "welfare"] as const)
        : POINT_TYPES[lens];
    if (selected && step !== "compare" && wanted.length > 0) {
      const points = (infra.data ?? []).filter(
        (point) =>
          (wanted as readonly string[]).includes(point.type) &&
          point.dong !== undefined &&
          guOfDong.get(point.dong) === selected.gu.gu,
      );
      out.push(
        new ScatterplotLayer<InfraPoint>({
          id: "gu-adequacy-infra",
          data: points,
          pickable: true,
          getPosition: (point) => [point.lng, point.lat],
          getRadius: (point) => (point.type === "charger" ? 90 : 55),
          radiusUnits: "meters",
          radiusMinPixels: 2.5,
          radiusMaxPixels: 9,
          stroked: true,
          getLineColor: [11, 15, 26, 200],
          getLineWidth: 1,
          lineWidthUnits: "pixels",
          getFillColor: (point) => [
            ...(POINT_COLOR[point.type] ?? [148, 163, 184]),
            215,
          ],
          updateTriggers: { getFillColor: [lens] },
        }),
      );
    }

    // 수요 겹쳐보기 — 공급 지도 위에 "사람이 실제로 어디로 가는가"를 얹는다.
    if (overlay === "heat" && trips.data?.length) {
      out.push(
        new HeatmapLayer<AnimTrip>({
          id: "demand-heat",
          data: trips.data,
          getPosition: (trip) => trip.p[1],
          getWeight: 1,
          radiusPixels: 45,
          intensity: 1,
          threshold: 0.04,
          colorRange: [
            [56, 189, 248, 0],
            [56, 189, 248, 90],
            [125, 211, 252, 140],
            [251, 191, 36, 180],
            [249, 115, 22, 210],
            [239, 68, 68, 235],
          ],
          pickable: false,
        }),
      );
    }

    if (overlay === "arcs" && od.data?.length) {
      // 같은 동 안에서 끝나는 쌍은 길이 0이라 화살로 그릴 수 없다.
      const arcs = od.data
        .filter((pair) => pair.oName !== pair.dName)
        .slice(0, 60);
      out.push(
        new ArcLayer<OdPair>({
          id: "demand-arcs",
          data: arcs,
          pickable: true,
          getSourcePosition: (pair) => pair.o,
          getTargetPosition: (pair) => pair.d,
          getSourceColor: [125, 211, 252, 120],
          getTargetColor: [249, 115, 22, 230],
          getWidth: (pair) => Math.max(1, Math.sqrt(pair.count) / 2.4),
          widthUnits: "pixels",
          getHeight: 0.35,
        }),
      );
    }

    const labels =
      step === "profile"
        ? selected
          ? [selected]
          : []
        : ranked.slice(0, 5);
    out.push(
      new TextLayer<GuProfile>({
        id: "gu-adequacy-labels",
        data: labels,
        pickable: false,
        getPosition: (profile) => profile.center,
        getText: (profile) =>
          `${ranked.findIndex((item) => item.gu.gu === profile.gu.gu) + 1}위 · ${profile.gu.gu}`,
        getSize: (profile) =>
          profile.gu.gu === selected?.gu.gu ? 13 : 11,
        sizeUnits: "pixels",
        getColor: [226, 232, 240, 255],
        background: true,
        getBackgroundColor: (profile) =>
          profile.gu.gu === selected?.gu.gu
            ? [14, 165, 233, 225]
            : [11, 15, 26, 205],
        backgroundPadding: [8, 5],
        getPixelOffset: [0, -8],
        fontWeight: 700,
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        updateTriggers: {
          getSize: [selected?.gu.gu],
          getBackgroundColor: [selected?.gu.gu],
        },
      }),
    );
    return out;
  }, [
    accessByDong,
    basis,
    dongs.data,
    guGeo,
    guOfDong,
    infra.data,
    lens,
    profileByGu,
    od.data,
    overlay,
    profiles.length,
    ranked,
    selected,
    step,
    trips.data,
    view,
  ]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      if (info.layer?.id === "gu-adequacy-infra") {
        const point = info.object as InfraPoint | undefined;
        if (!point) return null;
        return tooltipHtml(
          `<b>${point.name}</b><br/>${POINT_LABEL[point.type] ?? point.type}` +
            (point.detail ? ` · ${point.detail}` : "") +
            (point.dong ? `<br/><span style="color:#8b96ab">${point.dong}</span>` : ""),
        );
      }
      if (info.layer?.id === "demand-arcs") {
        const pair = info.object as OdPair | undefined;
        if (!pair) return null;
        return tooltipHtml(
          `<b>${pair.oName} → ${pair.dName}</b><br/>표본 ${fmt(pair.count)}건`,
        );
      }
      if (info.layer?.id === "dong-access-map") {
        const p = (
          info.object as { properties?: DongProps } | undefined
        )?.properties;
        const row = p ? accessByDong.get(p.admCd) : null;
        if (!p || !row) return null;
        return tooltipHtml(
          `<b>${p.gu} ${p.name}</b><br/>가장 가까운 ${
            lens === "all" || POINT_TYPES[lens].length === 0
              ? "충전기·복지 거점"
              : FACILITY_LABEL[lens]
          } ${
            row.minutes !== null
              ? `약 ${row.minutes.toFixed(0)}분`
              : `약 ${distanceText(row.nearest)}`
          }` +
            `<br/>부산 206개 동 중 ${Math.round(row.percentile * 205) + 1}번째로 가까움` +
            `<br/>중심 800m 안 ${fmt(row.within800)}곳` +
            `<br/><span style="color:#8b96ab">${
              row.minutes !== null
                ? "실제 두가자 운행 승차→하차 중앙값 기준"
                : `동 중심 직선거리 × 우회계수 ${DETOUR} — 실제 주행경로는 아님`
            }</span>`,
        );
      }
      const p = (
        info.object as { properties?: { gu?: string } } | undefined
      )?.properties;
      const profile = p?.gu ? profileByGu.get(p.gu) : null;
      if (!profile) return null;
      const weakest = [...profile.facilities].sort(
        (a, b) => a.ratio - b.ratio,
      )[0];
      return tooltipHtml(
        `<b>${profile.gu.gu}</b><br/>등록 ${fmt(profile.gu.registered ?? 0)}명 · 5월 이용 ${fmt(profile.gu.trips)}건` +
          `<br/>평균 미달 ${profile.deficitCount}/${profile.facilities.length}개 항목` +
          `<br/><span style="color:#8b96ab">가장 낮음: ${FACILITY_LABEL[weakest.key]} ${ratioText(weakest.ratio)}</span>`,
      );
    };
  }, [accessByDong, lens, profileByGu]);

  useEffect(() => {
    onMapSpec({ layers, getTooltip, flyTo });
  }, [flyTo, getTooltip, layers, onMapSpec]);

  const cityRegistered = disability.data?.totals.registeredKnown ?? 0;
  const cityTrips = disability.data?.totals.tripsFromBusan ?? 0;
  // KPI 밴드는 선택 지역을 따라간다 — 도시 전체 값은 부제로 남겨 규모를 잃지 않는다.
  const selectedRegistered = selected?.gu.registered ?? 0;
  const selectedTrips = selected?.gu.trips ?? 0;
  const tripsPer1k =
    selectedRegistered > 0 ? (selectedTrips / selectedRegistered) * 1000 : 0;
  /** 해운대구는 본선 데이터로 만든 동 단위 상세가 따로 있다. */
  const drilldownReady = Boolean(
    selected && selected.gu.gu === "해운대구" && onDrilldown,
  );
  const kpis = (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <KpiTile
        label={selected ? `${selected.gu.gu} · 등록 장애인` : "등록 장애인"}
        value={`${fmt(selected ? selectedRegistered : cityRegistered)}명`}
        sub={
          drilldownReady
            ? "클릭 → 해운대 18개 동 상세 진단"
            : selected
              ? `부산 ${fmt(cityRegistered)}명의 ${(selected.populationShare * 100).toFixed(1)}%`
              : "16개 구·군 전체"
        }
        color={HEX.demand}
        active={drilldownReady}
        onClick={drilldownReady ? onDrilldown : undefined}
      />
      <KpiTile
        label={selected ? `${selected.gu.gu} · 5월 완료 이용` : "5월 완료 이용"}
        value={`${fmt(selected ? selectedTrips : cityTrips)}건`}
        sub={
          selected
            ? `부산의 ${(selected.tripShare * 100).toFixed(1)}% · 등록 1천명당 ${tripsPer1k.toFixed(0)}건`
            : "16개 구·군 전체"
        }
        color={HEX.accent}
      />
      <KpiTile
        label={travelOn ? "도달 시간 순위" : "도달 거리 순위"}
        value={
          selectedAccess === null
            ? "—"
            : `상위 ${Math.round((1 - selectedAccess) * 100)}%`
        }
        sub={
          selectedAccess === null
            ? "행정동 지도를 열면 계산됩니다"
            : `부산 206개 동 대비 ${selected?.gu.gu} 중앙값`
        }
        color={HEX.warn}
      />
      <KpiTile
        label="평균 배분 순위"
        value={selected ? `${selectedRank}위 / ${ranked.length}` : "—"}
        sub={
          selected
            ? `미달 ${selected.deficitCount}/${selected.facilities.length}개 항목 · ${verdict?.title ?? ""}`
            : undefined
        }
        color={HEX.gapHL}
        active={Boolean(selected)}
      />
    </div>
  );

  const toolbar = (
    <>
      <MapToolbar inline label="기준">
        {(["balanced", "population", "trips"] as Basis[]).map((value) => (
          <Chip
            key={value}
            active={basis === value}
            onClick={() => setBasis(value)}
          >
            {BASIS_SHORT[value]}
          </Chip>
        ))}
      </MapToolbar>
      <MapToolbar inline label="단위">
        <Chip active={view === "gu"} onClick={() => setView("gu")}>
          구 · 배분
        </Chip>
        <Chip
          active={view === "dong"}
          onClick={() => {
            // 좌표 없는 시설을 고른 채 거리 지도로 넘어가면 대상이 비어버린다.
            if (lens !== "all" && POINT_TYPES[lens].length === 0) setLens("all");
            setView("dong");
          }}
        >
          {travelOn ? "행정동 · 시간" : "행정동 · 거리"}
        </Chip>
      </MapToolbar>
      <MapToolbar inline label="시설">
        <Chip active={lens === "all"} onClick={() => setLens("all")}>
          {view === "gu" ? "미달 수" : "충전·복지"}
        </Chip>
        {FACILITY_KEYS.filter(
          (key) => view === "gu" || POINT_TYPES[key].length > 0,
        ).map((key) => (
          <Chip
            key={key}
            active={lens === key}
            onClick={() => setLens(key)}
            color={FACILITY_COLOR[key]}
          >
            {FACILITY_SHORT[key]}
          </Chip>
        ))}
      </MapToolbar>
      <MapToolbar inline label="수요">
        <Chip active={overlay === "none"} onClick={() => setOverlay("none")}>
          없음
        </Chip>
        <Chip
          active={overlay === "heat"}
          onClick={() => setOverlay("heat")}
          color={HEX.demand}
        >
          하차 히트맵
        </Chip>
        <Chip
          active={overlay === "arcs"}
          onClick={() => setOverlay("arcs")}
          color={HEX.demand}
        >
          이동 화살
        </Chip>
      </MapToolbar>
    </>
  );

  /** 읽기 전용 범례는 지도 좌하단으로 — 조작 칩을 아래로 밀지 않는다. */
  const legend = (
    <>
      {overlay !== "none" && (
        <MapToolbar inline label={overlay === "heat" ? "히트맵" : "화살"}>
          <span className="text-[10px] text-dim">
            {overlay === "heat"
              ? "완료 이동 12,000건 표본의 하차 밀도 — 밝을수록 도착이 몰림"
              : "표본 상위 이동축 60개, 하늘색 출발 → 주황 도착"}
          </span>
        </MapToolbar>
      )}
      {step !== "compare" && (
        <MapToolbar inline label="시설 위치">
          {(["charger", "hospital", "welfare"] as const).map((type) => (
            <span
              key={type}
              className="flex items-center gap-1.5 text-[10px] text-dim"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  background: `rgb(${POINT_COLOR[type].join(",")})`,
                }}
              />
              {POINT_LABEL[type]}
            </span>
          ))}
          <span className="text-[10px] text-dim">
            장애인화장실·1층 상가는 좌표가 없어 점으로 표시하지 않습니다
          </span>
        </MapToolbar>
      )}
      <MapToolbar inline label="색상">
        {(view === "dong"
          ? [
              ["#e5484d", "부산 하위 25% · 가장 멂"],
              ["#fbbf24", "평균보다 멂"],
              ["#38bdf8", "평균보다 가까움"],
              ["#34d399", "상위 25% · 가장 가까움"],
            ]
          : lens === "all"
            ? [
                ["#e5484d", "2개 이상 · 기대량 75% 미만"],
                ["#fbbf24", "1개 · 기대량 75% 미만"],
                ["#38bdf8", "미달은 있지만 모두 75% 이상"],
                ["#34d399", "1개 이하만 평균 미달"],
              ]
            : [
                ["#e5484d", "기대량의 75% 미만"],
                ["#fbbf24", "75~100%"],
                ["#34d399", "평균 이상"],
              ]
        ).map(([color, label]) => (
          <span
            key={label}
            className="flex items-center gap-1.5 text-[10px] text-dim"
          >
            <span
              className="h-2 w-3 rounded-sm"
              style={{ background: color }}
            />
            {label}
          </span>
        ))}
      </MapToolbar>
    </>
  );

  /** 양·거리 두 축을 한 카드에 붙여 "왜 두 지도가 반대냐"를 결론으로 만든다. */
  const verdictCard =
    selected && verdict ? (
      <section
        className="rounded-lg border bg-panel p-3"
        style={{ borderColor: `${verdict.tone}66` }}
      >
        <div className="flex items-baseline gap-2">
          <span
            className="text-[11px] font-bold"
            style={{ color: verdict.tone }}
          >
            {selected.gu.gu} · {verdict.title}
          </span>
        </div>
        <p className="mt-1 text-[10.5px] leading-4 text-dim">
          {verdict.detail}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-md bg-[#0e1424] px-2.5 py-2">
            <div className="text-[9.5px] text-dim">양 · 평균 배분 대비</div>
            <div className="tnum text-[13px] font-bold text-ink">
              {selected.deficitCount} / {selected.facilities.length}개 미달
            </div>
          </div>
          <div className="rounded-md bg-[#0e1424] px-2.5 py-2">
            <div className="text-[9.5px] text-dim">
              거리 · 부산 206개 동 대비
            </div>
            <div className="tnum text-[13px] font-bold text-ink">
              {selectedAccess === null
                ? "—"
                : `상위 ${Math.round((1 - selectedAccess) * 100)}%`}
            </div>
          </div>
        </div>
        {selected.gu.gu === "해운대구" && onDrilldown && (
          <button
            type="button"
            onClick={onDrilldown}
            className="mt-2 w-full rounded-md border border-accent/50 bg-accent/[0.08] px-2.5 py-2 text-left transition hover:bg-accent/[0.14]"
          >
            <div className="text-[11.5px] font-bold text-accent">
              해운대구 상세보기 →
            </div>
            <div className="mt-0.5 text-[9.5px] leading-[14px] text-dim">
              여기부터 본선 해운대 데이터 · 2025.3~2026.3 호출 43,891건 ·
              동 단위 진단으로 전환됩니다
            </div>
          </button>
        )}
      </section>
    ) : null;

  /** 두 지도가 서로 반대로 보이는 이유를 화면 안에서 먼저 해명한다. */
  const viewNote =
    view === "dong" ? (
      <section className="rounded-lg border border-warn/35 bg-warn/[0.05] p-3">
        <div className="text-[10px] font-bold text-warn">
          이 지도는 구 지도와 다른 질문에 답합니다
        </div>
        <p className="mt-1.5 text-[10.5px] leading-4 text-dim">
          구 지도는 <span className="text-ink">인구·이용 대비 시설이 몇 개인가</span>,
          이 지도는 <span className="text-ink">가장 가까운 시설까지 얼마나 먼가</span>를
          봅니다. 밀집한 구는 1인당 시설은 부족해도 거리는 가까울 수 있어 두 지도가
          반대로 보일 수 있고, 그 자체가 결론입니다 — 부족의 성격이 다릅니다.
        </p>
        <p className="mt-1.5 text-[10px] leading-4 text-dim">
          {medianMinutes !== null
            ? `부산 206개 동의 중앙값은 약 ${medianMinutes.toFixed(0)}분입니다. 실제 두가자 운행의 승차→하차 시간에서 나온 값이며, 관측이 없는 구간만 근사입니다.`
            : `부산 206개 동의 중앙값은 약 ${distanceText(medianNearest)}입니다. travel_times.json이 없어 직선거리로 대체 중입니다.`}{" "}
          색은 절대값이 아니라 부산 안에서의 순위입니다.
        </p>
      </section>
    ) : null;

  const sideBody =
    !dongs.data || !disability.data || !selected ? (
      <DataPending note="dongs.geojson과 disability.json을 불러오면 구·군 비교가 표시됩니다." />
    ) : step === "compare" ? (
      <div className="space-y-3">
        <section className="rounded-lg border border-accent/40 bg-accent/[0.06] p-3.5">
          <div className="text-[10px] font-bold text-accent">
            1단계 · 부산 16개 구·군 비교
          </div>
          <h2 className="mt-1.5 text-[17px] font-bold leading-6 text-ink">
            {selected.gu.gu}은 {selected.facilities.length}개 중 {selected.deficitCount}개 항목이 평균
            배분보다 낮습니다
          </h2>
          <p className="mt-2 text-[11px] leading-[17px] text-dim">
            등록 장애인 <span className="font-semibold text-ink">
              {fmt(selected.gu.registered ?? 0)}명
            </span>, 5월 완료 이용{" "}
            <span className="font-semibold text-ink">
              {fmt(selected.gu.trips)}건
            </span>의 비중을 현재 기준으로 결합해 기대 공급량을 계산했습니다.
          </p>
        </section>
        <section className="rounded-lg border border-line bg-panel p-3.5">
          <div className="mb-3 text-[10px] font-bold text-dim">
            시설별 부산 평균 대비
          </div>
          <div className="space-y-3">
            {selected.facilities.map((metric) => (
              <RatioBar key={metric.key} metric={metric} />
            ))}
          </div>
        </section>
        <div className="rounded-lg border border-line bg-panel px-3 py-2.5 text-[10.5px] leading-4 text-dim">
          빨간색은 법정 부족 판정이 아니라 현재 선택한 필요 기준으로 부산 평균보다
          적게 배분된 시설 항목이 많다는 뜻입니다.
        </div>
      </div>
    ) : step === "profile" ? (
      <div className="space-y-3">
        <section className="rounded-lg border border-demand/35 bg-demand/[0.05] p-3.5">
          <div className="text-[10px] font-bold text-demand">
            2단계 · {selected.gu.gu} 기대량 계산
          </div>
          <h2 className="mt-1.5 text-[16px] font-bold leading-6 text-ink">
            인구 비중과 이용 비중을 먼저 분리합니다
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-md bg-[#0e1424] p-2.5">
              <div className="text-[10px] text-dim">부산 등록 인구 중</div>
              <div className="tnum mt-1 text-[18px] font-bold text-demand">
                {(selected.populationShare * 100).toFixed(1)}%
              </div>
            </div>
            <div className="rounded-md bg-[#0e1424] p-2.5">
              <div className="text-[10px] text-dim">부산 완료 이용 중</div>
              <div className="tnum mt-1 text-[18px] font-bold text-accent">
                {(selected.tripShare * 100).toFixed(1)}%
              </div>
            </div>
          </div>
          <p className="mt-2 text-[10.5px] leading-4 text-dim">
            {basis === "balanced"
              ? `두 비중을 50:50으로 평균한 필요 비중은 ${(selected.needShare * 100).toFixed(1)}%입니다.`
              : `${BASIS_LABEL[basis]} 기준 필요 비중은 ${(selected.needShare * 100).toFixed(1)}%입니다.`}
          </p>
        </section>
        <section className="rounded-lg border border-line bg-panel p-3.5">
          <div className="text-[10px] font-bold text-dim">
            실제 공급 ÷ 기대 공급
          </div>
          <p className="mt-1.5 text-[10.5px] leading-4 text-dim">
            예: 부산 충전기의 {Math.round(selected.needShare * 100)}%가 이
            지역의 기대량입니다. 100% 선보다 짧으면 평균 배분보다 적습니다.
          </p>
          <div className="mt-4 space-y-4">
            {selected.facilities.map((metric) => (
              <RatioBar key={metric.key} metric={metric} />
            ))}
          </div>
        </section>
      </div>
    ) : null;

  /** 칩만으로는 "기준을 바꾸면 무엇이 달라지나"가 안 보인다 — 문장으로 붙인다. */
  const basisNote = (
    <section className="rounded-lg border border-line bg-panel p-3">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-bold text-dim">필요의 기준</span>
        <span className="text-[11px] font-bold text-accent">
          {BASIS_LABEL[basis]}
        </span>
      </div>
      <div className="mt-1 text-[11.5px] font-bold leading-4 text-ink">
        {BASIS_MEANING[basis].headline}
      </div>
      <p className="mt-1 text-[10.5px] leading-4 text-dim">
        {BASIS_MEANING[basis].detail}
      </p>
      {selected && (
        <div className="tnum mt-2 rounded-md bg-[#0e1424] px-2.5 py-2 text-[10px] leading-4 text-dim">
          {selected.gu.gu} · 인구 기준{" "}
          <span className="font-semibold text-demand">
            {(selected.populationShare * 100).toFixed(1)}%
          </span>{" "}
          · 이용 기준{" "}
          <span className="font-semibold text-accent">
            {(selected.tripShare * 100).toFixed(1)}%
          </span>{" "}
          → 지금 적용{" "}
          <span className="font-semibold text-ink">
            {(selected.needShare * 100).toFixed(1)}%
          </span>
          {Math.abs(selected.populationShare - selected.tripShare) >= 0.01 &&
            " — 두 기준의 차이가 커서 기준을 바꾸면 순위가 움직입니다"}
        </div>
      )}
    </section>
  );

  const side = (
    <div className="space-y-3">
      {viewNote}
      {basisNote}
      {verdictCard}
      {sideBody}
    </div>
  );

  const bottom =
    selected && selectedWorst && selectedAction ? (
      // 진단의 "왜"를 여기서 끝낸다 — 기대량의 근거, 양 축 전체 항목,
      // 거리 축의 실제 값. 사이드는 단계별 서술, 이 줄은 단계와 무관한 근거.
      <div className="flex flex-col items-stretch gap-3 md:flex-row">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className="text-[12.5px] font-bold leading-5"
              style={{ color: verdict?.tone }}
            >
              {selected.gu.gu} · {verdict?.title}
            </span>
            <span className="text-[10px] text-dim">
              {view === "gu"
                ? "구 · 평균 배분 대비"
                : travelOn
                  ? "행정동 · 도달 시간"
                  : "행정동 · 도달 거리"}
              {" · "}
              {BASIS_LABEL[basis]} 기준
            </span>
          </div>
          <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-line bg-[#0e1424] px-2.5 py-1.5">
              <div className="text-[9.5px] text-dim">필요 비중 · 기대량의 근거</div>
              <div className="tnum mt-0.5 text-[11.5px] font-bold leading-4 text-ink">
                인구 {(selected.populationShare * 100).toFixed(1)}% · 이용{" "}
                {(selected.tripShare * 100).toFixed(1)}% → 적용{" "}
                {(selected.needShare * 100).toFixed(1)}%
              </div>
              <div className="tnum mt-0.5 text-[9.5px] leading-[14px] text-dim">
                기대량 = 부산 시설 총량 ×{" "}
                {(selected.needShare * 100).toFixed(1)}%
              </div>
            </div>

            <div className="rounded-md border border-line bg-[#0e1424] px-2.5 py-1.5">
              <div className="text-[9.5px] text-dim">
                양 · {selected.facilities.length}개 중 {selected.deficitCount}개
                평균 배분 미달
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {selected.facilities.map((metric) => {
                  const tone =
                    metric.ratio < 0.75
                      ? HEX.gapHL
                      : metric.ratio < 1
                        ? HEX.warn
                        : HEX.infra;
                  return (
                    <span
                      key={metric.key}
                      className="tnum rounded px-1 py-[1px] text-[9.5px] font-semibold leading-4"
                      style={{ background: `${tone}1f`, color: tone }}
                    >
                      {FACILITY_SHORT[metric.key]} {ratioText(metric.ratio)}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="rounded-md border border-line bg-[#0e1424] px-2.5 py-1.5">
              <div className="text-[9.5px] text-dim">
                거리 ·{" "}
                {travelOn ? "실측 주행시간 기준" : "직선거리 × 1.3 근사"} ·
                충전기·복지 거점
              </div>
              {selectedDistance ? (
                <>
                  <div className="tnum mt-0.5 text-[11.5px] font-bold leading-4 text-ink">
                    {selectedDistance.dongCount}개 동 중앙값{" "}
                    {selectedDistance.medianText}
                    {selectedAccess !== null &&
                      ` · 부산 상위 ${Math.round((1 - selectedAccess) * 100)}%`}
                  </div>
                  <div className="tnum mt-0.5 text-[9.5px] leading-[14px] text-dim">
                    가장 먼 동 {selectedDistance.worstName}{" "}
                    {selectedDistance.worstText}
                  </div>
                </>
              ) : (
                <div className="mt-0.5 text-[10px] leading-4 text-dim">
                  infra_points.json을 불러오면 계산됩니다
                </div>
              )}
            </div>
          </div>
        </div>
        <ActionCard
          eyebrow={
            selected.gu.gu === "해운대구" ? "본선 상세 데이터" : "다음 단계"
          }
          action={
            selected.gu.gu === "해운대구"
              ? "해운대구는 18개 동 단위 상세 진단으로 이어집니다"
              : step === "compare"
                ? `${selected.gu.gu}의 기대량 계산 보기`
                : `${selected.gu.gu}의 부족 항목은 동 단위 상세에서 확인합니다`
          }
          impact={
            selected.gu.gu === "해운대구"
              ? "2025.3~2026.3 호출 43,891건 기준"
              : `${BASIS_LABEL[basis]} 기준`
          }
          cta={{
            label:
              selected.gu.gu === "해운대구"
                ? "해운대 상세 진단으로"
                : step === "compare"
                  ? "2단계로"
                  : "지도에서 다시 선택",
            onClick: () => {
              if (selected.gu.gu === "해운대구" && onDrilldown) {
                onDrilldown();
                return;
              }
              if (step === "profile") {
                setStep("compare");
                setFlyTo({ longitude: 129.04, latitude: 35.18, zoom: 9.6 });
                return;
              }
              setStep("profile");
              setFlyTo({
                longitude: selected.center[0],
                latitude: selected.center[1],
                zoom: 11.8,
              });
            },
          }}
        />
      </div>
    ) : null;

  const changeStep = (id: string) => {
    const next = id as Step;
    setStep(next);
    if (next === "compare") {
      setFlyTo({ longitude: 129.04, latitude: 35.18, zoom: 9.6 });
    } else if (selected) {
      setFlyTo({
        longitude: selected.center[0],
        latitude: selected.center[1],
        zoom: 11.8,
      });
    }
  };

  return (
    <PresentationLayout
      question="등록 장애인 및 두리발 이용 대비 생활 인프라 현황"
      hint="16개 구·군의 필요 비중만큼 부산 전체 시설이 배분됐다고 가정한 비교 시나리오"
      steps={STEPS}
      activeStep={step}
      onStep={changeStep}
      kpis={kpis}
      toolbar={toolbar}
      map={map}
      legend={legend}
      side={side}
      sideWide
      bottom={bottom}
      footnote={
        <>
          필요 비중 = 등록 장애인 비중과 출발지 기준 5월 완료 이용 비중의 선택 가중
          · 기대 공급 = 부산 시설 총량 × 필요 비중 · 1층 상가는 접근 가능 확정이
          아닌 조사 프록시 · 장애인화장실은 원자료에 좌표가 없어 구 단위 개수로만
          비교 · 등록현황 기준일은 구별로 2024~2026년 상이 · 도시 평균과의 형평
          비교이며 법정 충분성 기준이 아님
        </>
      }
    />
  );
}
