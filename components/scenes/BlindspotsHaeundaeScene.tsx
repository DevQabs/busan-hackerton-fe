"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { GeoJsonLayer, ScatterplotLayer, TextLayer } from "deck.gl";
import type { Layer } from "@deck.gl/core";
import {
  DATA,
  type AccessActions,
  type AccessShop,
  type ArrivalDeserts,
  type DesertCell,
  type DesertGreedyPick,
  type DongProps,
  type TourismDeserts,
  type TourismSite,
} from "@/lib/types";
import {
  DATA_DONG_COMPARE,
  type DongCompare,
  type DongCompareEntry,
} from "@/lib/typesDongCompare";
import { useData } from "@/lib/useData";
import { fmt, pct, shortDong } from "@/lib/format";
import { HEX, RGB_ACCENT, RGB_GAP } from "@/lib/palette";
import {
  tooltipHtml,
  type DongCollection,
  type FlyTo,
  type MapSpec,
} from "@/lib/mapspec";
import {
  actionOf,
  actionOfLack,
  barrierHex,
  haversineM,
  statusOf,
  CLS_HEX,
  CLS_RGBA,
} from "@/lib/access";
import { DataPending } from "@/components/ui/DataPending";
import { DongCompareRank } from "@/components/charts/DongCompareRank";
import { HourGapArea } from "@/components/charts/HourGapArea";
import {
  ActionCard,
  Chip,
  KpiTile,
  MapToolbar,
  PresentationLayout,
} from "@/components/PresentationLayoutWide";

// 접근성 사각지대 — 해운대구 집중, 단일 화면. "무엇을 비교할까" 칩 7개가
// 지도·설명을 동시에 갈아끼운다 (스텝 대신 칩 — 사용자 확정 구조):
//   동 단위 5칩: 호출 최다 · 배차 실패 최다 · 시설 최다/최소 · 일반인 격차
//   지점 2칩:   어디가 부족할까(250m 격자) · 어디로 갈 수 있을까(무장애가게)
// 우측 설명란(3:2)은 항상 펼쳐진 쉬운 말 해설 + 산출 기준 + 인사이트 + 용어.

/** radius (m) around a selected desert cell that defines "이 도착지 안" */
const ZONE_M = 1200;

type MetricKey = "calls" | "unmet" | "facMost" | "facLeast" | "gap";
type Mode = MetricKey | "deserts" | "shops";

interface ModeDef {
  key: Mode;
  chip: string;
  title: string;
  color: string;
  rgb?: [number, number, number]; // choropleth ramp (동 단위 지표만)
  /** 쉬운 말: 무엇을 어떻게 세었나 (산출 기준) */
  plain: string;
  /** 읽는 방향: 높은 게 좋은가 낮은 게 좋은가 */
  direction: string;
  /** 실측 한 줄 인사이트 */
  insight: string;
  /** 3막(통계·솔루션)으로 이어지는 다음 질문 */
  solution: string;
}

const MODES: ModeDef[] = [
  {
    key: "calls",
    chip: "호출 최다",
    title: "호출이 가장 많은 곳",
    color: HEX.demand,
    rgb: [56, 189, 248],
    plain:
      "13개월(2025.3~2026.3) 동안 그 동에 '도착'한 두리발 호출 수. 사는 사람이 아니라 '가는 곳' 기준입니다.",
    direction: "많을수록 = 교통약자가 많이 찾는 목적지",
    insight:
      "좌4동 7,358건 1위 — 그런데 이 동의 등록장애인은 677명뿐. 주민이 아니라 방문객이 몰리는 '목적지형' 동네입니다.",
    solution:
      "→ 3막: 수요 대비 시설이 모자란 동 우선순위 랭킹 — 목적지형 동네부터 정비.",
  },
  {
    key: "unmet",
    chip: "배차 실패 최다",
    title: "불러도 못 타는 곳",
    color: HEX.unmet,
    rgb: [251, 113, 133],
    plain:
      "호출했지만 결국 타지 못한 비율 = (취소+미배차) ÷ 호출. 시설이 아니라 '배차'가 실패한 것입니다.",
    direction: "높을수록 문제 = 서비스가 받아주지 못하는 동",
    insight:
      "재송2동 25.0% — 네 번에 한 번 실패. 이 동은 충전소도 0개, 등록장애인 수는 구 3위(1,166명)입니다.",
    solution:
      "→ 3막: 실패가 몰리는 시간대(21시 46%) 분석 — 증차보다 야간 배차 구조 재설계 검토.",
  },
  {
    key: "facMost",
    chip: "시설 최다",
    title: "무장애시설이 가장 많은 곳",
    color: HEX.infra,
    rgb: [52, 211, 153],
    plain:
      "구 실사 데이터의 장애인화장실(310)·장애인주차장(348)·휠체어충전소(16)·장애인승강기(584) 4종을 동별로 합한 수입니다.",
    direction: "많을수록 좋음",
    insight:
      "우2동 193개 최다 — 해운대 충전소 16개 중 6개가 이 한 동에 몰려 있습니다(편중).",
    solution:
      "→ 3막: 잘 갖춘 동을 기준선으로 — 다른 동이 무엇부터 채워야 하는지 비교.",
  },
  {
    key: "facLeast",
    chip: "시설 최소",
    title: "무장애시설이 가장 적은 곳",
    color: HEX.warn,
    rgb: [251, 191, 36],
    plain:
      "위와 같은 4종 합계를 적은 순서로 봅니다. 충전소 0개인 동은 빨간 신호입니다.",
    direction: "적을수록 문제",
    insight:
      "충전기가 0개인 동이 18개 중 9개(송정·반여2·3·4동 등) — 배치가 수요를 따라가지 못하고 있습니다.",
    solution:
      "→ 3막: '시설 1개 추가'의 기대효과(통계 모델) — 어느 동에 어떤 시설부터 지을지 순위화.",
  },
  {
    key: "gap",
    chip: "일반인 격차",
    title: "일반인은 가는데 교통약자는 못 가는 곳",
    color: HEX.tourism,
    rgb: [192, 132, 252],
    plain:
      "산출: 격차(%p) = [그 동의 두리발 도착 비중] − [그 동의 일반인 이동 비중]. 일반인 기준선은 부산시 시간대·행정동별 인구이동(2022.4~6)이며, 절대량이 아니라 비중(분포)으로 비교합니다.",
    direction:
      "음수(−)일수록 문제 — 일반인은 가는데 교통약자는 못 가는 동. 양수(+)는 교통약자 특화 목적지",
    insight:
      "'못 가는 3인방' 우3동 −3.1 · 반여1동 −2.8 · 중2동 −2.5%p = 우선 투자 후보. 반대로 좌4동 +9.8%p는 특화 목적지인데 시설은 최하위권 — 이중 문제입니다.",
    solution:
      "→ 3막: 어떤 시설 항목을 개선하면 일반인 이용 패턴에 가장 가까워지는지 — 항목별 가중치 분석.",
  },
  {
    key: "deserts",
    chip: "어디가 부족할까",
    title: "하차는 많은데 시설이 없는 지점",
    color: HEX.warn,
    plain:
      "완료 하차를 250m 격자로 묶고(개인 위치 보호), 반경 내 충전소·병의원·복지시설이 없는 정도를 하차량과 곱해 점수화한 '도착지 공백'입니다.",
    direction: "점수 높을수록 시급한 지점",
    insight:
      "격자 산출물은 현재 5월 부산 전역 리허설 기준이라 해운대 셀이 아직 없습니다 — 본선 데이터 파이프라인 재생성 후 이 칩에 채워집니다.",
    solution:
      "→ 3막: 공백 점수 상위 격자에 신규 시설 후보 지점 제안(최대 커버 방식).",
  },
  {
    key: "shops",
    chip: "어디로 갈 수 있을까",
    title: "도착 후 실제로 들어갈 수 있는 가게",
    color: HEX.infra,
    plain:
      "구 전체 무장애가게 321곳 전수 실사(12개 항목)를 진입(입구·층)→이용(테이블석)→편의(장애인화장실) 순서로 검사해, 처음 끊기는 단계로 판정합니다.",
    direction: "초록(완비)일수록 좋음 · 빨강 = 진입 불가",
    insight:
      "진입 가능 84% — 그러나 장애인화장실까지 갖춘 '완비'는 321곳 중 0곳. 내릴 수는 있어도, 머물 수는 없습니다.",
    solution:
      "→ 3막: 하차가 많은 가게부터 '끊긴 단계'를 고치는 조치 순위 — 조치당 영향 하차수로 정렬.",
  },
];

/** 우리끼리 쓰는 용어 — 화면 하단 주석용 (누구나 이해 가능하게) */
const GLOSSARY: [string, string][] = [
  ["배차 실패", "호출했지만 타지 못한 건(취소+미배차). 시설이 아니라 배차의 문제"],
  ["도착 기준", "그 동에 '사는' 사람이 아니라 그 동으로 '간' 이동을 센 것"],
  ["격차(%p)", "두리발 도착 비중 − 일반인 이동 비중. 음수 = 교통약자만 못 가는 동"],
  ["250m 격자", "하차 지점을 250m 칸으로 묶은 집계 (개인 위치 보호)"],
  ["판정", "진입(입구·층)→이용(테이블석)→편의(화장실) 중 처음 끊기는 단계"],
];

function metricValue(e: DongCompareEntry, m: MetricKey): number {
  switch (m) {
    case "calls":
      return e.calls;
    case "unmet":
      return e.unmetRate * 100;
    case "facMost":
    case "facLeast":
      return e.facTotal;
    case "gap":
      return e.gapPp;
  }
}

function metricLabel(e: DongCompareEntry, m: MetricKey): string {
  switch (m) {
    case "calls":
      return `${fmt(e.calls)}건`;
    case "unmet":
      return `${(e.unmetRate * 100).toFixed(1)}%`;
    case "facMost":
    case "facLeast":
      return `${fmt(e.facTotal)}개`;
    case "gap":
      return `${e.gapPp > 0 ? "+" : ""}${e.gapPp.toFixed(1)}%p`;
  }
}

/** 0(차분)…1(뜨거움). facLeast·gap은 값이 낮을수록 문제라 방향을 뒤집는다. */
function metricHeat(v: number, min: number, max: number, m: MetricKey): number {
  const t = max === min ? 0.5 : (v - min) / (max - min);
  return m === "facLeast" || m === "gap" ? 1 - t : t;
}

/** '반여제1동' → '반여1동' — dong_compare.json canonical name과 조인 */
function canonDong(name: string): string {
  return name.replace("제", "").trim();
}

const GAP_LABEL: Record<DongProps["gapClass"], string> = {
  HL: "수요高·인프라低 (우선)",
  HH: "수요高·인프라高",
  LH: "수요低·인프라高",
  LL: "수요低·인프라低",
};

const GAP_HEX: Record<DongProps["gapClass"], string> = {
  HL: HEX.gapHL,
  HH: HEX.gapHH,
  LH: HEX.gapLH,
  LL: HEX.gapLL,
};

function distLabel(m: number | null): string {
  return m === null ? "2km 밖" : `${fmt(m)}m`;
}

export function BlindspotsHaeundaeScene({
  onMapSpec,
  map,
}: {
  onMapSpec: (spec: MapSpec) => void;
  map: ReactNode;
}) {
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);
  const compare = useData<DongCompare>(DATA_DONG_COMPARE);
  const deserts = useData<ArrivalDeserts>(DATA.arrivalDeserts);
  const access = useData<AccessActions>(DATA.accessActions);
  const tourism = useData<TourismDeserts>(DATA.tourism);

  const [mode, setMode] = useState<Mode>("calls");
  const [cmpName, setCmpName] = useState<string | null>(null);
  const [cellRank, setCellRank] = useState<number | null>(null);
  const [shopIdx, setShopIdx] = useState<number | null>(null);
  const [sim, setSim] = useState(false);
  const [showGreedy, setShowGreedy] = useState(true);
  const [showTourism, setShowTourism] = useState(true);
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);
  const [didFlyShops, setDidFlyShops] = useState(false);
  const [didFrameHw, setDidFrameHw] = useState(false);

  const isMetric = mode !== "deserts" && mode !== "shops";
  const metric: MetricKey = isMetric ? (mode as MetricKey) : "calls";
  const activeMode = MODES.find((m) => m.key === mode) ?? MODES[0];

  const features = useMemo(() => dongs.data?.features ?? [], [dongs.data]);
  const cells = useMemo(() => deserts.data?.cells ?? [], [deserts.data]);
  const greedy = useMemo(() => deserts.data?.greedy ?? [], [deserts.data]);
  const shops = useMemo(() => access.data?.shops ?? [], [access.data]);
  const drops = useMemo(() => access.data?.dropoffs ?? [], [access.data]);
  const sites = useMemo(() => tourism.data?.sites ?? [], [tourism.data]);

  // ── step 1: 5-chip 비교 (dong_compare.json) ─────────────────────────────
  const entries = useMemo(() => compare.data?.dongs ?? [], [compare.data]);

  const entryByCanon = useMemo(() => {
    const out = new Map<string, DongCompareEntry>();
    for (const e of entries) out.set(e.name, e);
    return out;
  }, [entries]);

  /** 해운대 행정동 feature — canonical 이름으로 비교 엔트리와 조인 */
  const hwFeatures = useMemo(
    () => features.filter((f) => f.properties.gu === "해운대구"),
    [features],
  );
  const featureOf = useMemo(() => {
    const out = new Map<string, DongProps>();
    for (const f of hwFeatures)
      out.set(canonDong(f.properties.name), f.properties);
    return out;
  }, [hwFeatures]);

  const ranked = useMemo(() => {
    const asc = metric === "facLeast" || metric === "gap";
    return [...entries].sort((a, b) =>
      asc
        ? metricValue(a, metric) - metricValue(b, metric)
        : metricValue(b, metric) - metricValue(a, metric),
    );
  }, [entries, metric]);

  const heatRange = useMemo(() => {
    const vs = entries.map((e) => metricValue(e, metric));
    if (vs.length === 0) return { min: 0, max: 1 };
    return { min: Math.min(...vs), max: Math.max(...vs) };
  }, [entries, metric]);

  /** KPI 밴드 고정 4개: 호출 1위 · 미충족률 1위 · 충전소 0 동 · 격차 최대 */
  const kpiTop = useMemo(() => {
    if (entries.length === 0) return null;
    return {
      calls: entries[0], // builder sorts by calls desc
      unmet: [...entries].sort((a, b) => b.unmetRate - a.unmetRate)[0],
      zeroCharger: entries.filter((e) => e.fac.charger === 0).length,
      gap: [...entries].sort((a, b) => a.gapPp - b.gapPp)[0],
    };
  }, [entries]);

  const cmp = cmpName ? (entryByCanon.get(cmpName) ?? null) : null;
  const cmpFeature = cmpName ? (featureOf.get(cmpName) ?? null) : null;

  /** 해운대 동 이름 집합 — 격자·시설 레이어를 해운대로 한정 */
  const hwDongSet = useMemo(
    () => new Set(entries.map((e) => e.name)),
    [entries],
  );
  const hwCells = useMemo(
    () => cells.filter((c) => c.dong && hwDongSet.has(canonDong(c.dong))),
    [cells, hwDongSet],
  );

  // entering step 1: frame 해운대구 once
  useEffect(() => {
    if (!isMetric || didFrameHw || hwFeatures.length === 0) return;
    const lng =
      hwFeatures.reduce((s, f) => s + f.properties.centroid[0], 0) /
      hwFeatures.length;
    const lat =
      hwFeatures.reduce((s, f) => s + f.properties.centroid[1], 0) /
      hwFeatures.length;
    setFlyTo({ longitude: lng, latitude: lat, zoom: 11.4 });
    setDidFrameHw(true);
  }, [isMetric, didFrameHw, hwFeatures]);

  // ── step 2: destination deserts ─────────────────────────────────────────
  const cell = useMemo(
    () => hwCells.find((c) => c.rank === cellRank) ?? null,
    [hwCells, cellRank],
  );
  const maxScore = useMemo(
    () => Math.max(1e-9, ...hwCells.map((c) => c.score)),
    [hwCells],
  );

  /** what actually sits inside the selected destination zone */
  const zone = useMemo(() => {
    if (!cell) return null;
    const center: [number, number] = [cell.lng, cell.lat];
    const zoneShops = shops
      .map((s, i) => ({
        shop: s,
        index: i,
        dist: haversineM(center, [s.lng, s.lat]),
      }))
      .filter((x) => x.dist <= ZONE_M)
      .sort((a, b) => b.shop.nearbyArrivals - a.shop.nearbyArrivals);
    const zoneSites = sites
      .map((s) => ({ site: s, dist: haversineM(center, [s.lng, s.lat]) }))
      .filter((x) => x.dist <= ZONE_M)
      .sort((a, b) => a.dist - b.dist);
    return {
      shops: zoneShops,
      sites: zoneSites,
      enterable: zoneShops.filter((x) => statusOf(x.shop.fields, sim).enterable)
        .length,
      barrierFree: zoneSites.filter((x) => x.site.barrierFree).length,
    };
  }, [cell, shops, sites, sim]);

  const chargerLackShare = useMemo(() => {
    if (hwCells.length === 0) return 0;
    return (
      hwCells.filter((c) => c.lack.some((l) => l.includes("충전"))).length /
      hwCells.length
    );
  }, [hwCells]);

  // ── step 3: 도착 이후 400m ──────────────────────────────────────────────
  const statuses = useMemo(
    () => shops.map((s) => statusOf(s.fields, sim)),
    [shops, sim],
  );

  const roll = useMemo(() => {
    const dna: Record<string, number> = {};
    for (const s of statuses) dna[s.barrier] = (dna[s.barrier] ?? 0) + 1;
    return {
      enterable: statuses.filter((s) => s.enterable).length,
      usable: statuses.filter((s) => s.usable).length,
      comfort: statuses.filter((s) => s.comfort).length,
      baseEnterable: shops.filter((s) => statusOf(s.fields, false).enterable)
        .length,
      dna,
    };
  }, [statuses, shops]);

  const actions = useMemo(
    () =>
      shops
        .map((s, i) => ({ shop: s, index: i, st: statuses[i] }))
        .filter((x) => x.st && x.st.barrier !== "완비")
        .sort((a, b) => b.shop.nearbyArrivals - a.shop.nearbyArrivals),
    [shops, statuses],
  );

  const shop = shopIdx !== null ? shops[shopIdx] ?? null : null;
  const shopSt = shop ? statusOf(shop.fields, sim) : null;

  // ── navigation between steps ────────────────────────────────────────────
  const goDeserts = useCallback(
    (fromDong?: DongProps | null) => {
      setMode("deserts");
      if (!fromDong) return;
      const match = hwCells.find(
        (c) => c.dong && shortDong(c.dong) === shortDong(fromDong.name),
      );
      if (match) {
        setCellRank(match.rank);
        setFlyTo({ longitude: match.lng, latitude: match.lat, zoom: 14.2 });
      } else {
        setFlyTo({
          longitude: fromDong.centroid[0],
          latitude: fromDong.centroid[1],
          zoom: 13,
        });
      }
    },
    [hwCells],
  );

  const goLast400 = useCallback(() => {
    setMode("shops");
    const first = zone?.shops[0];
    if (first) {
      setShopIdx(first.index);
      setFlyTo({
        longitude: first.shop.lng,
        latitude: first.shop.lat,
        zoom: 15.4,
      });
      setDidFlyShops(true);
    }
  }, [zone]);

  const selectCell = useCallback((c: DesertCell) => {
    setCellRank((current) => (current === c.rank ? null : c.rank));
    setFlyTo({ longitude: c.lng, latitude: c.lat, zoom: 14.2 });
  }, []);

  // entering step 3 without a chosen shop: frame the audited sample once
  useEffect(() => {
    if (mode !== "shops" || didFlyShops || shops.length === 0) return;
    const lng = shops.reduce((s, x) => s + x.lng, 0) / shops.length;
    const lat = shops.reduce((s, x) => s + x.lat, 0) / shops.length;
    setFlyTo({ longitude: lng, latitude: lat, zoom: 14.6 });
    setDidFlyShops(true);
  }, [mode, didFlyShops, shops]);

  // ── map layers ──────────────────────────────────────────────────────────
  const layers = useMemo<Layer[]>(() => {
    const out: Layer[] = [];
    if (!dongs.data) return out;

    const filled = isMetric;
    out.push(
      new GeoJsonLayer<DongProps>({
        id: "bs-dongs",
        data: dongs.data as never,
        stroked: true,
        filled,
        getFillColor: (f) => {
          const p = f.properties;
          if (isMetric) {
            const e =
              p.gu === "해운대구"
                ? entryByCanon.get(canonDong(p.name))
                : undefined;
            if (!e) return [20, 26, 40, 140]; // 해운대 밖 — 어둡게 가라앉힘
            const heat = metricHeat(
              metricValue(e, metric),
              heatRange.min,
              heatRange.max,
              metric,
            );
            const [r, g, b] = activeMode.rgb ?? [56, 189, 248];
            return [r, g, b, Math.round(36 + heat * 195)];
          }
          if (p.gapClass !== "HL") return [42, 51, 72, 40];
          return RGB_GAP.HL;
        },
        getLineColor: (f) =>
          cmpFeature && f.properties.admCd === cmpFeature.admCd
            ? [34, 211, 238, 255]
            : [35, 43, 61, 160],
        getLineWidth: (f) =>
          cmpFeature && f.properties.admCd === cmpFeature.admCd ? 2.5 : 1,
        lineWidthUnits: "pixels",
        opacity: isMetric ? 0.85 : 0.3,
        pickable: isMetric,
        autoHighlight: isMetric,
        highlightColor: [255, 255, 255, 40],
        onClick: (info) => {
          const p = (info.object as { properties?: DongProps } | undefined)
            ?.properties;
          if (!p || p.gu !== "해운대구") return;
          const name = canonDong(p.name);
          setCmpName((current) => (current === name ? null : name));
          setFlyTo({
            longitude: p.centroid[0],
            latitude: p.centroid[1],
            zoom: 12.6,
          });
        },
        updateTriggers: {
          getFillColor: [mode, entryByCanon, heatRange],
          getLineColor: [cmpFeature?.admCd],
          getLineWidth: [cmpFeature?.admCd],
        },
      }),
    );

    if (isMetric && ranked.length > 0) {
      // TOP3 라벨 — 지표를 바꾸면 지도 위 이름표가 따라 바뀐다
      const top3 = ranked.slice(0, 3).flatMap((e, i) => {
        const f = featureOf.get(e.name);
        return f ? [{ e, f, i }] : [];
      });
      out.push(
        new TextLayer<(typeof top3)[number]>({
          id: "bs-cmp-labels",
          data: top3,
          getPosition: (d) => [d.f.centroid[0], d.f.centroid[1]],
          getText: (d) => `${d.i + 1} ${d.e.name}\n${metricLabel(d.e, metric)}`,
          getSize: (d) => (d.i === 0 ? 15 : 12.5),
          getColor: [226, 232, 240, 255],
          background: true,
          getBackgroundColor: [11, 15, 26, 200],
          backgroundPadding: [5, 3, 5, 3],
          getTextAnchor: "middle",
          getAlignmentBaseline: "center",
          fontWeight: 700,
          characterSet: "auto",
          updateTriggers: { getText: [metric], getSize: [metric] },
        }),
      );
    }

    if (mode === "deserts" && hwCells.length > 0) {
      out.push(
        new ScatterplotLayer<DesertCell>({
          id: "bs-cells",
          data: hwCells,
          getPosition: (d) => [d.lng, d.lat],
          getRadius: (d) => 90 + Math.sqrt(d.score / maxScore) * 260,
          radiusUnits: "meters",
          radiusMinPixels: 3,
          radiusMaxPixels: 34,
          getFillColor: (d) => {
            const t = Math.sqrt(d.score / maxScore);
            return [
              Math.round(140 + t * 89),
              Math.round(40 + t * 32),
              Math.round(45 + t * 32),
              Math.round(90 + t * 150),
            ];
          },
          getLineColor: (d) =>
            d.rank === cellRank ? [34, 211, 238, 255] : [0, 0, 0, 0],
          getLineWidth: (d) => (d.rank === cellRank ? 2.5 : 0),
          lineWidthUnits: "pixels",
          stroked: true,
          pickable: true,
          onClick: (info) => {
            const c = info.object as DesertCell | undefined;
            if (c) selectCell(c);
          },
          updateTriggers: {
            getLineColor: [cellRank],
            getLineWidth: [cellRank],
          },
        }),
      );

      if (cell) {
        out.push(
          new ScatterplotLayer<DesertCell>({
            id: "bs-zone",
            data: [cell],
            getPosition: (d) => [d.lng, d.lat],
            getRadius: ZONE_M,
            radiusUnits: "meters",
            filled: false,
            stroked: true,
            getLineColor: [34, 211, 238, 130],
            getLineWidth: 2,
            lineWidthUnits: "pixels",
          }),
        );
      }

      if (showGreedy && greedy.length > 0) {
        out.push(
          new ScatterplotLayer<DesertGreedyPick>({
            id: "bs-greedy",
            data: greedy,
            getPosition: (d) => [d.lng, d.lat],
            getRadius: 11,
            radiusUnits: "pixels",
            getFillColor: [...RGB_ACCENT, 235] as [
              number,
              number,
              number,
              number,
            ],
            stroked: true,
            getLineColor: [11, 15, 26, 255],
            getLineWidth: 2,
            lineWidthUnits: "pixels",
            pickable: true,
          }),
          new TextLayer<DesertGreedyPick>({
            id: "bs-greedy-labels",
            data: greedy,
            getPosition: (d) => [d.lng, d.lat],
            getText: (_d, { index }) => String(index + 1),
            getSize: 13,
            getColor: [11, 15, 26, 255],
            fontWeight: 700,
            getTextAnchor: "middle",
            getAlignmentBaseline: "center",
          }),
        );
      }
    }

    // door-scale layers: the selected zone in step 2, the whole sample in step 3
    const zoneShops = mode === "deserts" ? (zone?.shops ?? []) : [];
    const zoneSites =
      mode === "deserts" && showTourism ? (zone?.sites ?? []) : [];
    const shopData = mode === "shops" ? shops : zoneShops.map((x) => x.shop);
    const siteData = mode === "deserts" ? zoneSites.map((x) => x.site) : [];

    if (mode === "shops" && drops.length > 0) {
      out.push(
        new ScatterplotLayer<[number, number]>({
          id: "bs-drops",
          data: drops,
          getPosition: (d) => d,
          getRadius: 22,
          radiusUnits: "meters",
          radiusMinPixels: 1.5,
          radiusMaxPixels: 4,
          getFillColor: [56, 189, 248, 45],
        }),
      );
    }

    if (siteData.length > 0) {
      out.push(
        new ScatterplotLayer<TourismSite>({
          id: "bs-sites",
          data: siteData,
          getPosition: (d) => [d.lng, d.lat],
          getRadius: 9,
          radiusUnits: "pixels",
          getFillColor: (d) =>
            d.barrierFree ? [192, 132, 252, 235] : [139, 150, 171, 190],
          stroked: true,
          getLineColor: (d) =>
            d.barrierFree ? [192, 132, 252, 255] : [11, 15, 26, 220],
          getLineWidth: 1.5,
          lineWidthUnits: "pixels",
          pickable: true,
        }),
      );
    }

    if (shopData.length > 0) {
      out.push(
        new ScatterplotLayer<AccessShop>({
          id: "bs-shops",
          data: shopData,
          getPosition: (d) => [d.lng, d.lat],
          getRadius: 26,
          radiusUnits: "meters",
          radiusMinPixels: 6,
          radiusMaxPixels: 13,
          getFillColor: (d) => CLS_RGBA[statusOf(d.fields, sim).cls],
          stroked: true,
          getLineColor: (d) =>
            shop && d.name === shop.name
              ? [34, 211, 238, 255]
              : [11, 15, 26, 220],
          getLineWidth: (d) => (shop && d.name === shop.name ? 3 : 1.5),
          lineWidthUnits: "pixels",
          pickable: true,
          onClick: (info) => {
            const s = info.object as AccessShop | undefined;
            if (!s) return;
            const idx = shops.findIndex((x) => x.name === s.name);
            if (idx < 0) return;
            setShopIdx(idx);
            setFlyTo({ longitude: s.lng, latitude: s.lat, zoom: 15.4 });
          },
          updateTriggers: {
            getFillColor: [sim],
            getLineColor: [shop?.name],
            getLineWidth: [shop?.name],
          },
        }),
      );
    }

    return out;
  }, [
    dongs.data,
    mode,
    isMetric,
    entryByCanon,
    metric,
    heatRange,
    activeMode,
    ranked,
    featureOf,
    cmpFeature,
    hwCells,
    cell,
    cellRank,
    maxScore,
    greedy,
    showGreedy,
    showTourism,
    zone,
    shops,
    shop,
    drops,
    sim,
    selectCell,
  ]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      const o = info.object as Record<string, unknown> | undefined;
      if (!o) return null;
      const id = info.layer?.id;

      if (id === "bs-dongs") {
        const p = (o as { properties?: DongProps }).properties;
        if (!p) return null;
        const e =
          p.gu === "해운대구" ? entryByCanon.get(canonDong(p.name)) : undefined;
        if (e) {
          return tooltipHtml(
            `<b>${e.name}</b><br/>` +
              `호출 ${fmt(e.calls)}건 · 미충족 ${(e.unmetRate * 100).toFixed(1)}%<br/>` +
              `무장애시설 ${fmt(e.facTotal)}개 (충전소 ${e.fac.charger}) · 등록장애인 ${fmt(e.disabled)}명<br/>` +
              `<span style="color:${HEX.tourism}">일반인 격차 ${e.gapPp > 0 ? "+" : ""}${e.gapPp.toFixed(1)}%p</span>` +
              `<br/><span style="color:#8b96ab">클릭 = 이 동 프로필</span>`,
          );
        }
        return tooltipHtml(
          `<b>${p.gu} ${p.name}</b><br/>하차 ${fmt(p.dropoffs)}건 · 승차 ${fmt(p.pickups)}건<br/>` +
            `<span style="color:${GAP_HEX[p.gapClass]}">${GAP_LABEL[p.gapClass]} · 격차 ${p.gapScore.toFixed(2)}</span>`,
        );
      }
      if (id === "bs-cells") {
        const c = o as unknown as DesertCell;
        return tooltipHtml(
          `<b>${c.dong ?? "행정동 미확인"} · ${c.rank}위 격자</b><br/>하차 ${fmt(c.dropoffs)}건 · ${c.lack.join(" · ") || "부족 항목 없음"}<br/><span style="color:#8b96ab">클릭 = 이 도착지 안으로 확대</span>`,
        );
      }
      if (id === "bs-greedy") {
        const g = o as unknown as DesertGreedyPick;
        const idx = greedy.indexOf(g);
        return tooltipHtml(
          `<b>후보 지점 ${idx + 1}</b><br/>신규 커버 하차 ${fmt(g.gain)}건 · 누적 ${pct(g.cumShare)}`,
        );
      }
      if (id === "bs-sites") {
        const s = o as unknown as TourismSite;
        return tooltipHtml(
          `<b>${s.name}</b> <span style="color:#8b96ab">${s.category}</span><br/>` +
            (s.barrierFree
              ? `<span style="color:${HEX.tourism}">베리어프리 확인</span>`
              : `<span style="color:${HEX.warn}">베리어프리 미확인</span>`) +
            (s.lack.length ? `<br/>${s.lack.join(" · ")}` : ""),
        );
      }
      if (id === "bs-shops") {
        const s = o as unknown as AccessShop;
        const st = statusOf(s.fields, sim);
        const chip = (k: string) => {
          const yes = s.fields[k] === "Y";
          return `<span style="color:${yes ? "#4fd14f" : "#8b96ab"}">${k} ${yes ? "○" : "✕"}</span>`;
        };
        return tooltipHtml(
          `<b>${s.name}</b> <span style="color:#8b96ab">${s.cat}</span><br/>` +
            ["경사로", "입구턱", "일층", "테이블석", "장애인화장실"]
              .map(chip)
              .join(" · ") +
            `<br/><span style="color:${CLS_HEX[st.cls]}">판정: ${st.barrier}</span>`,
        );
      }
      return null;
    };
  }, [greedy, sim, entryByCanon]);

  useEffect(() => {
    onMapSpec({ layers, getTooltip, flyTo });
  }, [layers, getTooltip, flyTo, onMapSpec]);

  // ── KPI band ────────────────────────────────────────────────────────────
  const kpis: ReactNode =
    isMetric ? (
      <div className="grid grid-cols-4 gap-2">
        <KpiTile
          label="호출이 가장 많은 곳"
          value={kpiTop ? kpiTop.calls.name : "—"}
          sub={kpiTop ? `13개월 ${fmt(kpiTop.calls.calls)}건 · 도착 기준` : undefined}
          color={HEX.demand}
          active={metric === "calls"}
        />
        <KpiTile
          label="배차 실패율이 가장 높은 곳"
          value={kpiTop ? kpiTop.unmet.name : "—"}
          sub={
            kpiTop
              ? `${(kpiTop.unmet.unmetRate * 100).toFixed(1)}% — 호출했지만 못 탐`
              : undefined
          }
          color={HEX.unmet}
          active={metric === "unmet"}
        />
        <KpiTile
          label="충전소가 0개인 동"
          value={kpiTop ? `${kpiTop.zeroCharger}개 동` : "—"}
          sub="해운대 18개 동 중 · 급속충전기 기준"
          color={HEX.warn}
          active={metric === "facLeast"}
        />
        <KpiTile
          label="일반인 대비 격차 최대"
          value={kpiTop ? kpiTop.gap.name : "—"}
          sub={
            kpiTop
              ? `${kpiTop.gap.gapPp.toFixed(1)}%p — 일반인은 가는데 못 간다`
              : undefined
          }
          color={HEX.tourism}
          active={metric === "gap"}
        />
      </div>
    ) : mode === "deserts" ? (
      <div className="grid grid-cols-4 gap-2">
        <KpiTile
          label="도착지 공백 격자 (해운대)"
          value={deserts.data ? `${fmt(hwCells.length)}곳` : "—"}
          sub={
            deserts.data ? `${deserts.data.params.cellM}m 격자 기준` : undefined
          }
          color={HEX.warn}
        />
        <KpiTile
          label="1위 격자 하차"
          value={hwCells[0] ? `${fmt(hwCells[0].dropoffs)}건` : "—"}
          sub={hwCells[0]?.dong ?? "본선 재생성 대기"}
          color={HEX.gapHL}
        />
        <KpiTile
          label="충전소가 먼 격자"
          value={hwCells.length ? pct(chargerLackShare) : "—"}
          sub="800m 안에 급속충전기 없음"
          color={HEX.accent}
        />
        <KpiTile
          label="후보 지점 누적 커버"
          value={
            greedy.length ? pct(greedy[greedy.length - 1].cumShare) : "—"
          }
          sub={greedy.length ? `${greedy.length}곳 설치 시` : undefined}
          color={HEX.infra}
        />
      </div>
    ) : (
      <div className="grid grid-cols-4 gap-2">
        <KpiTile
          label="실사 무장애가게"
          value={access.data ? `${fmt(shops.length)}곳` : "—"}
          sub={access.data?.meta.scope}
          color={HEX.demand}
        />
        <KpiTile
          label="진입 가능"
          value={access.data ? `${fmt(roll.enterable)}곳` : "—"}
          sub={
            sim
              ? `무턱화 시뮬 · 기준 ${fmt(roll.baseEnterable)}곳`
              : "입구·층 hard gate 통과"
          }
          color={HEX.warn}
          active={sim}
        />
        <KpiTile
          label="장애인화장실까지 완비"
          value={access.data ? `${fmt(roll.comfort)}곳` : "—"}
          sub={access.data ? `${fmt(shops.length)}곳 중` : undefined}
          color={HEX.gapHL}
        />
        <KpiTile
          label="반영된 두리발 하차"
          value={access.data ? `${fmt(access.data.summary.arrivals)}건` : "—"}
          sub={access.data ? `${access.data.meta.catchmentM}m 반경 기준` : undefined}
          color={HEX.infra}
        />
      </div>
    );

  // ── map toolbar ─────────────────────────────────────────────────────────
  const toolbar: ReactNode = (
    <MapToolbar label={`무엇을 비교할까 — ${activeMode.title}`}>
      {MODES.map((m) => (
        <Chip
          key={m.key}
          active={mode === m.key}
          onClick={() => setMode(m.key)}
          color={m.color}
        >
          {m.chip}
        </Chip>
      ))}
      {mode === "gap" && (
        <span className="text-[10px] leading-4 text-dim">
          기준선: 일반인 인구이동 2022.4~6
        </span>
      )}
      {mode === "deserts" && (
        <>
          <Chip
            active={showGreedy}
            onClick={() => setShowGreedy((v) => !v)}
            color={HEX.accent}
          >
            후보 지점
          </Chip>
          <Chip
            active={showTourism}
            onClick={() => setShowTourism((v) => !v)}
            color={HEX.tourism}
          >
            관광지
          </Chip>
        </>
      )}
      {mode === "shops" && (
        <>
          <span className="flex items-center gap-2 text-[11px] text-ink">
            <span className="flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: CLS_HEX.critical }}
              />
              진입 불가
            </span>
            <span className="flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: CLS_HEX.warning }}
              />
              미완비
            </span>
            <span className="flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: CLS_HEX.good }}
              />
              완비
            </span>
          </span>
          <Chip
            active={sim}
            onClick={() => setSim((v) => !v)}
            color={HEX.accent}
          >
            입구 무턱화 시뮬 {sim ? "ON" : "OFF"}
          </Chip>
        </>
      )}
      {isMetric && cmpName && (
        <Chip active onClick={() => setCmpName(null)}>
          선택 해제
        </Chip>
      )}
      {mode === "deserts" && cell && (
        <Chip active onClick={() => setCellRank(null)}>
          선택 해제
        </Chip>
      )}
    </MapToolbar>
  );

  // ── 항상 펼쳐진 쉬운 설명 카드 + 용어 주석 (접히는 Explainer 대체) ──────
  const explainCard: ReactNode = (
    <SidePanel title={activeMode.title} aside={activeMode.chip} padded>
      <p className="text-[11.5px] leading-5 text-ink/90">{activeMode.plain}</p>
      <p className="mt-1.5 text-[11px] leading-4">
        <b style={{ color: activeMode.color }}>읽는 법 · </b>
        <span className="text-dim">{activeMode.direction}</span>
      </p>
      <p className="mt-1.5 rounded bg-[#0e1424] px-2 py-1.5 text-[11px] leading-[1.5] text-ink/85">
        💡 {activeMode.insight}
      </p>
      <p className="mt-1.5 text-[10.5px] leading-4 text-accent/90">
        {activeMode.solution}
      </p>
    </SidePanel>
  );

  const glossary: ReactNode = (
    <div className="rounded-lg border border-line bg-panel/60 px-3 py-2">
      <div className="mb-1 text-[10px] font-semibold text-dim">용어 주석</div>
      <div className="space-y-0.5">
        {GLOSSARY.map(([t, d]) => (
          <p key={t} className="text-[10px] leading-4 text-dim">
            <b className="text-ink/70">{t}</b> — {d}
          </p>
        ))}
      </div>
    </div>
  );

  // ── right column ────────────────────────────────────────────────────────
  const modeContent: ReactNode =
    isMetric ? (
      !compare.data ? (
        <DataPending note="dong_compare.json 대기 중 — 동별 수요·인프라·일반인 격차 비교가 표시됩니다." />
      ) : (
        <div className="space-y-3">
          <SidePanel
            title={`동 랭킹 — ${activeMode.chip}`}
            aside="막대 클릭 = 지도 이동"
            padded
          >
            <DongCompareRank
              rows={ranked.map((e) => ({
                name: e.name,
                value: metricValue(e, metric),
                label: metricLabel(e, metric),
              }))}
              color={activeMode.color}
              selected={cmpName}
              onSelect={(name) => {
                setCmpName((cur) => (cur === name ? null : name));
                const f = featureOf.get(name);
                if (f)
                  setFlyTo({
                    longitude: f.centroid[0],
                    latitude: f.centroid[1],
                    zoom: 12.6,
                  });
              }}
              unit={activeMode.chip}
            />
          </SidePanel>

          {mode === "gap" && (
            <SidePanel
              title="시간대 격차 — 저녁이 사라진다"
              aside="각 24시간 합 = 100%"
              padded
            >
              <HourGapArea hours={compare.data.hourly} />
              <p className="mt-1.5 text-[10.5px] leading-4 text-dim">
                일반인 이동(회색)은 저녁에도 이어지는데, 두리발 접수(청록)는
                21시 0.8%로 소멸합니다. 공급 실패(미충족) 이전에{" "}
                <b className="text-ink">저녁 수요 자체가 억제</b>되고 있음을
                시사합니다.
              </p>
            </SidePanel>
          )}

          {cmp && (
            <SidePanel
              title={`${cmp.name} 시설 4종`}
              aside={`등록장애인 ${fmt(cmp.disabled)}명`}
              padded
            >
              <div className="space-y-1.5">
                {(
                  [
                    ["장애인화장실", cmp.fac.restroom],
                    ["장애인주차장", cmp.fac.parking],
                    ["휠체어충전소", cmp.fac.charger],
                    ["장애인승강기", cmp.fac.elevator],
                  ] as [string, number][]
                ).map(([label, n], i) => {
                  const keys = [
                    "restroom",
                    "parking",
                    "charger",
                    "elevator",
                  ] as const;
                  const mx = Math.max(
                    1,
                    ...entries.map((x) => x.fac[keys[i]]),
                  );
                  return (
                    <div
                      key={label}
                      className="grid grid-cols-[82px_1fr_28px] items-center gap-2 text-[11.5px]"
                    >
                      <span className="text-dim">{label}</span>
                      <span className="h-4 overflow-hidden rounded bg-[#0e1424]">
                        <span
                          className="block h-full rounded"
                          style={{
                            width: `${(100 * n) / mx}%`,
                            background: n === 0 ? HEX.gapHL : HEX.infra,
                            opacity: 0.85,
                          }}
                        />
                      </span>
                      <span className="tnum text-right text-ink">{n}</span>
                    </div>
                  );
                })}
              </div>
              {cmp.per1k !== null && (
                <p className="mt-2 text-[10.5px] leading-4 text-dim">
                  등록장애인 1천명당 도착{" "}
                  <b className="tnum text-ink">{fmt(cmp.per1k)}건</b> — 도착
                  기준 이용 강도(거주자 이용률 아님)
                </p>
              )}
            </SidePanel>
          )}
        </div>
      )
    ) : mode === "deserts" ? (
      !deserts.data ? (
        <DataPending note="arrival_deserts.json 대기 중 — 하차 250m 격자 공백이 표시됩니다." />
      ) : hwCells.length === 0 ? (
        <DataPending note="현재 격자 산출물은 5월 부산 전역 리허설 기준이라 해운대 셀이 없습니다 — 본선 데이터로 파이프라인 재생성 시 이 칩이 채워집니다." />
      ) : (
        <SidePanel
          title="도착지 공백 순위"
          aside={`행 클릭 = 확대 · ${deserts.data.params.cellM}m`}
        >
          <ul>
            {hwCells.slice(0, 40).map((c) => {
              const active = c.rank === cellRank;
              return (
                <li key={c.rank}>
                  <button
                    type="button"
                    onClick={() => selectCell(c)}
                    className={`w-full border-b border-line px-2.5 py-1.5 text-left last:border-b-0 ${
                      active ? "bg-accent/10" : "hover:bg-[#161e30]"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[12px]">
                      <span className="tnum w-5 shrink-0 text-dim">
                        {c.rank}
                      </span>
                      <span
                        className={`min-w-0 flex-1 truncate ${
                          active ? "font-semibold text-accent" : "text-ink"
                        }`}
                      >
                        {c.dong ?? "행정동 미확인"}
                      </span>
                      <span className="tnum shrink-0 text-[11px] text-dim">
                        하차 {fmt(c.dropoffs)}
                      </span>
                    </span>
                    {c.lack.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {c.lack.map((l) => (
                          <span
                            key={l}
                            className="rounded bg-unmet/10 px-1 py-px text-[9.5px] leading-4 text-unmet"
                          >
                            {l}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </SidePanel>
      )
    ) : !access.data ? (
      <DataPending note="access_actions.json 대기 중 — 무장애가게 실사 × 하차 접근성 사슬이 표시됩니다." />
    ) : (
      <div className="space-y-3">
        <SidePanel title="이동완성 사슬" aside="어디서 줄어드나" padded>
          <div className="space-y-1.5">
            {(
              [
                ["무장애가게", shops.length, HEX.demand],
                ["진입 가능", roll.enterable, HEX.warn],
                ["내부 이용", roll.usable, HEX.warn],
                ["완비", roll.comfort, HEX.infra],
              ] as [string, number, string][]
            ).map(([label, n, color]) => (
              <div
                key={label}
                className="grid grid-cols-[70px_1fr_28px] items-center gap-2 text-[11.5px]"
              >
                <span className="text-dim">{label}</span>
                <span className="h-[16px] overflow-hidden rounded bg-[#0e1424]">
                  <span
                    className="block h-full rounded"
                    style={{
                      width: `${(100 * n) / Math.max(1, shops.length)}%`,
                      background: color,
                      opacity: 0.85,
                    }}
                  />
                </span>
                <span className="tnum text-right text-ink">{n}</span>
              </div>
            ))}
          </div>
          {sim && (
            <p className="mt-2 text-[10.5px] leading-4 text-warn">
              무턱화 시뮬: 진입 가능 {roll.baseEnterable} → {roll.enterable}곳.
              완비는 여전히 {roll.comfort}곳 — 다음 병목은 장애인화장실입니다.
            </p>
          )}
        </SidePanel>

        <SidePanel title="Barrier DNA" aside="사슬이 끊기는 지점" padded>
          <div className="space-y-1.5">
            {["입구(진입)", "층이동", "내부이용", "편의(화장실)", "완비"]
              .filter((k) => roll.dna[k])
              .map((k) => (
                <div
                  key={k}
                  className="grid grid-cols-[88px_1fr_24px] items-center gap-2 text-[11.5px]"
                >
                  <span className="text-dim">{k}</span>
                  <span className="h-4 overflow-hidden rounded bg-[#0e1424]">
                    <span
                      className="block h-full rounded"
                      style={{
                        width: `${(100 * roll.dna[k]) / Math.max(1, ...Object.values(roll.dna))}%`,
                        background: barrierHex(k),
                      }}
                    />
                  </span>
                  <span className="tnum text-right text-ink">{roll.dna[k]}</span>
                </div>
              ))}
          </div>
        </SidePanel>

        <SidePanel title="고칠 곳 순위" aside="하차 규모순 · 클릭 = 지도">
          <ul>
            {actions.slice(0, 10).map(({ shop: s, index, st }) => {
              const active = shopIdx === index;
              const a = actionOf(st.barrier);
              return (
                <li key={s.name}>
                  <button
                    type="button"
                    onClick={() => {
                      setShopIdx(active ? null : index);
                      if (!active)
                        setFlyTo({
                          longitude: s.lng,
                          latitude: s.lat,
                          zoom: 15.4,
                        });
                    }}
                    className={`flex w-full items-center gap-2 border-b border-line px-2.5 py-1.5 text-left last:border-b-0 ${
                      active ? "bg-accent/10" : "hover:bg-[#161e30]"
                    }`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: barrierHex(st.barrier) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-ink">
                        {s.name}
                      </span>
                      <span className="block truncate text-[10.5px] text-dim">
                        {a.label}
                      </span>
                    </span>
                    <span className="tnum shrink-0 text-[10.5px] text-dim">
                      하차 {fmt(s.nearbyArrivals)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </SidePanel>
      </div>
    );

  const side: ReactNode = (
    <div className="space-y-3">
      {explainCard}
      {modeContent}
      {glossary}
    </div>
  );

  // ── bottom strip: the selected object + the one recommended action ──────
  const bottom: ReactNode =
    isMetric ? (
      cmp ? (
        <div className="flex items-stretch gap-3">
          <SelectedBlock
            title={cmp.name}
            badge={{
              label:
                cmp.gapPp < 0
                  ? `일반인 대비 ${cmp.gapPp.toFixed(1)}%p — 못 가는 동`
                  : `교통약자 특화 목적지 +${cmp.gapPp.toFixed(1)}%p`,
              color: cmp.gapPp < 0 ? HEX.gapHL : HEX.infra,
            }}
            onClear={() => setCmpName(null)}
            facts={[
              ["호출(도착 기준)", `${fmt(cmp.calls)}건`],
              [
                "배차 실패",
                `${fmt(cmp.unmet)}건 (${(cmp.unmetRate * 100).toFixed(1)}%)`,
              ],
              ["무장애시설", `${fmt(cmp.facTotal)}개`],
              ["충전소", `${fmt(cmp.fac.charger)}개`],
              ["등록장애인", `${fmt(cmp.disabled)}명`],
              [
                "1천명당 도착",
                cmp.per1k !== null ? `${fmt(cmp.per1k)}건` : "—",
              ],
            ]}
          />
          <ActionCard
            eyebrow="진단"
            action={`${cmp.name}에 내린 사람은 실제로 어디에 들어갈 수 있나?`}
            impact="요인별 기여도(가중치)는 통계 화면에서 분리합니다."
            cta={{
              label: "이 동에서 갈 수 있는 곳 보기",
              onClick: () => {
                setMode("shops");
                if (cmpFeature)
                  setFlyTo({
                    longitude: cmpFeature.centroid[0],
                    latitude: cmpFeature.centroid[1],
                    zoom: 13.6,
                  });
              },
            }}
          />
        </div>
      ) : undefined
    ) : mode === "deserts" ? (
      <div className="flex items-stretch gap-3">
        {cell ? (
          <SelectedBlock
            title={`${cell.dong ?? "행정동 미확인"} · ${cell.rank}위 격자`}
            badge={{ label: `부족 점수 ${cell.score.toFixed(1)}`, color: HEX.warn }}
            onClear={() => setCellRank(null)}
            facts={[
              ["기간 내 하차", `${fmt(cell.dropoffs)}건`],
              ["최근접 충전소", distLabel(cell.nearestM.charger)],
              ["최근접 병의원", distLabel(cell.nearestM.hospital)],
              ["최근접 복지시설", distLabel(cell.nearestM.welfare)],
              [
                `${ZONE_M}m 안 무장애가게`,
                zone
                  ? zone.shops.length
                    ? `${fmt(zone.shops.length)}곳 중 진입 ${fmt(zone.enterable)}곳`
                    : "실사 표본 밖"
                  : "—",
              ],
              [
                `${ZONE_M}m 안 관광지`,
                zone
                  ? zone.sites.length
                    ? `${fmt(zone.sites.length)}곳 중 베리어프리 ${fmt(zone.barrierFree)}곳`
                    : "없음"
                  : "—",
              ],
            ]}
            extra={
              <>
                <div className="flex flex-wrap gap-1">
                  {cell.lack.map((l) => (
                    <span
                      key={l}
                      className="rounded bg-unmet/10 px-1.5 py-0.5 text-[10px] leading-4 text-unmet"
                    >
                      {l}
                    </span>
                  ))}
                </div>
                {zone && zone.shops.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {zone.shops.slice(0, 4).map(({ shop: s }) => {
                      const st = statusOf(s.fields, sim);
                      return (
                        <span
                          key={s.name}
                          className="rounded border border-line bg-[#0e1424] px-1.5 py-0.5 text-[10px] leading-4"
                          style={{ color: barrierHex(st.barrier) }}
                        >
                          {s.name} · {st.barrier}
                        </span>
                      );
                    })}
                  </div>
                )}
              </>
            }
          />
        ) : (
          <EmptyBlock text="붉은 원을 클릭하면 그 도착지 안으로 확대되어 무장애가게·관광지와 실제 장벽이 나타납니다." />
        )}
        {(() => {
          const a = cell
            ? actionOfLack(cell.lack)
            : { label: "가장 나쁜 격자부터 확인", owner: "—" };
          return (
            <ActionCard
              eyebrow="권고 조치"
              action={a.label}
              owner={a.owner}
              impact={
                cell
                  ? `이 격자 하차 ${fmt(cell.dropoffs)}건에 직접 영향`
                  : "격자를 선택하면 조치와 소관이 표시됩니다."
              }
              cta={{ label: "③ 400m 진입 가능성 보기", onClick: goLast400 }}
            />
          );
        })()}
      </div>
    ) : (
      <div className="flex items-stretch gap-3">
        {shop && shopSt ? (
          <SelectedBlock
            title={shop.name}
            badge={{
              label: shopSt.enterable
                ? shopSt.comfort
                  ? "완비"
                  : "진입 가능 · 미완비"
                : "진입 불가",
              color: CLS_HEX[shopSt.cls],
            }}
            onClear={() => setShopIdx(null)}
            facts={[
              ["업종", shop.cat],
              ["끊기는 지점", shopSt.barrier],
              ["400m 하차 가중", `${fmt(shop.nearbyArrivals)}건`],
            ]}
            extra={
              <div className="flex flex-wrap gap-1">
                {[
                  "일층",
                  "경사로",
                  "입구턱",
                  "입구무턱",
                  "테이블석",
                  "장애인화장실",
                  "엘리베이터",
                  "장애인주차장",
                ].map((k) => {
                  const yes = shop.fields[k] === "Y";
                  return (
                    <span
                      key={k}
                      className={`rounded px-1.5 py-0.5 text-[10px] leading-4 ${
                        yes ? "bg-infra/10 text-infra" : "bg-[#0e1424] text-dim"
                      }`}
                    >
                      {k} {yes ? "○" : "✕"}
                    </span>
                  );
                })}
              </div>
            }
          />
        ) : (
          <EmptyBlock text="지도의 점이나 오른쪽 '고칠 곳 순위'를 선택하면 그 가게의 12개 실사 항목과 조치가 여기 나타납니다." />
        )}
        {(() => {
          const a = shopSt
            ? actionOf(shopSt.barrier)
            : { label: "가장 많은 하차를 받는 곳부터 개선", owner: "구청·업주" };
          return (
            <ActionCard
              eyebrow="권고 조치"
              action={a.label}
              owner={a.owner}
              impact={
                shop
                  ? `${access.data?.meta.catchmentM ?? 400}m 하차 ${fmt(shop.nearbyArrivals)}건에 닿는 조치`
                  : `표본 ${fmt(shops.length)}곳 중 완비 ${fmt(roll.comfort)}곳`
              }
              cta={{
                label: "동 비교로 돌아가기",
                onClick: () => setMode("calls"),
              }}
            />
          );
        })()}
      </div>
    );

  const footnote: ReactNode =
    isMetric ? (
      "호출·미충족·1천명당 도착은 두리발 본선 데이터(2025.03~2026.03)의 목적지(도착) 기준 — 거주자 이용률이 아닙니다. 일반인 격차의 기준선은 부산시 시간대·행정동별 인구이동건수(2022.4~6)로 시점이 달라 공간·시간 '분포' 비교로만 사용합니다. 시설 4종은 구 제공 실사 데이터 기준입니다."
    ) : mode === "deserts" ? (
      `부족 판정은 직선거리 기준(충전소 800m·병의원 500m·복지시설 1km)이며, 후보 지점은 greedy maximal-coverage 제안으로 부지 확보 검토가 아닙니다. 격자는 ${deserts.data?.params.cellM ?? 250}m 집계라 개별 이동을 추적하지 않습니다.`
    ) : (
      `무장애가게 실사는 ${access.data?.meta.scope ?? "표본"} 범위이며 거리는 직선 proximity입니다. "완비 0곳"은 표본의 사실일 뿐 인과 주장이 아닙니다.`
    );

  return (
    <PresentationLayout
      question="해운대구, 어디서 어긋나고 — 어디로 갈 수 있는가?"
      hint="칩을 눌러 비교 기준을 바꿉니다. 모든 지표는 해운대 18개 동 · 도착지 기준."
      kpis={kpis}
      sideWide
      toolbar={toolbar}
      map={map}
      side={side}
      bottom={bottom}
      footnote={footnote}
    />
  );
}

/** Right-column block: one title, one list. Lists are flush by default. */
function SidePanel({
  title,
  aside,
  children,
  padded,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-panel">
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h3 className="text-[12px] font-semibold text-ink">{title}</h3>
        {aside && (
          <span className="shrink-0 text-[10px] text-dim">{aside}</span>
        )}
      </header>
      <div className={padded ? "px-3 py-2.5" : ""}>{children}</div>
    </section>
  );
}

function SelectedBlock({
  title,
  badge,
  facts,
  extra,
  onClear,
}: {
  title: string;
  badge?: { label: string; color: string };
  facts: [string, string][];
  extra?: ReactNode;
  onClear: () => void;
}) {
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <h2 className="truncate text-[14px] font-bold leading-5 text-ink">
          {title}
        </h2>
        {badge && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-4"
            style={{ color: badge.color, background: `${badge.color}1f` }}
          >
            {badge.label}
          </span>
        )}
        <button
          type="button"
          onClick={onClear}
          className="ml-auto shrink-0 text-[10.5px] text-accent hover:underline"
        >
          선택 해제
        </button>
      </div>
      <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
        {facts.map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-1.5">
            <dt className="text-[10.5px] text-dim">{k}</dt>
            <dd className="tnum text-[12px] font-semibold text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {extra && <div className="mt-1.5">{extra}</div>}
    </div>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center rounded-lg border border-dashed border-line bg-panel/40 px-3.5 py-2.5 text-[11.5px] leading-5 text-dim">
      {text}
    </div>
  );
}
