"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  GeoJsonLayer,
  PathLayer,
  ScatterplotLayer,
  TextLayer,
  TripsLayer,
} from "deck.gl";
import type { Layer } from "@deck.gl/core";
import {
  DATA,
  type AccessActions,
  type AccessShop,
  type ArrivalDeserts,
  type DesertCell,
  type DesertGreedyPick,
  type DongProps,
  type OdPair,
  type TourismDeserts,
  type TourismSite,
} from "@/lib/types";
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
import { Explainer } from "@/components/ui/Explainer";
import {
  ActionCard,
  Chip,
  KpiTile,
  MapToolbar,
  PresentationLayout,
  type StoryStep,
} from "@/components/PresentationLayout";

// 접근성 사각지대 — the reference presentation screen. One question, one map,
// and a three-step zoom-out→zoom-in story instead of five equal toggles:
//   1. 어디로 이동하는가   (city scale, OD arcs)
//   2. 어디가 부족한가     (destination scale, 250m 하차 격자 공백)
//   3. 실제로 들어갈 수 있는가 (door scale, 도착 이후 400m · Barrier DNA)
// Clicking a problem destination zone in step 2 flies the camera in and draws
// the shops / 관광지 / concrete barriers that sit inside it.

type Step = "flow" | "deserts" | "last400";

const STEPS: StoryStep[] = [
  { id: "flow", label: "어디로 이동하는가", caption: "행정동 간 이동 흐름" },
  { id: "deserts", label: "어디가 부족한가", caption: "도착지 250m 공백" },
  {
    id: "last400",
    label: "실제로 들어갈 수 있는가",
    caption: "도착 이후 400m 진입",
  },
];

/** radius (m) around a selected desert cell that defines "이 도착지 안" */
const ZONE_M = 1200;

// ── animated flow geometry ──────────────────────────────────────────────────
// Static green→cyan arcs did not say which end was which. Each OD pair becomes
// a gently bowed polyline that a light runs along, 출발 → 도착, so direction is
// read from the motion instead of from a color legend.
const CURVE_STEPS = 18;
const FLOW_TRAVEL = 1.2; // how long one light takes to cross its path
const FLOW_LOOP = 2.6; // cycle length; phases spread inside it
const FLOW_TRAIL = 0.34;
const FLOW_SPEED = 0.42; // loop units per wall-clock second

/** quadratic Bézier bowed perpendicular to the O→D chord. */
function bowedPath(
  o: [number, number],
  d: [number, number],
): [number, number][] {
  const cx = (o[0] + d[0]) / 2 - (d[1] - o[1]) * 0.16;
  const cy = (o[1] + d[1]) / 2 + (d[0] - o[0]) * 0.16;
  const pts: [number, number][] = [];
  for (let i = 0; i < CURVE_STEPS; i += 1) {
    const t = i / (CURVE_STEPS - 1);
    const u = 1 - t;
    pts.push([
      u * u * o[0] + 2 * u * t * cx + t * t * d[0],
      u * u * o[1] + 2 * u * t * cy + t * t * d[1],
    ]);
  }
  return pts;
}

interface FlowPath {
  pair: OdPair;
  path: [number, number][];
  timestamps: number[];
  width: number;
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

export function BlindspotsScene({
  onMapSpec,
  map,
}: {
  onMapSpec: (spec: MapSpec) => void;
  map: ReactNode;
}) {
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);
  const od = useData<OdPair[]>(DATA.od);
  const deserts = useData<ArrivalDeserts>(DATA.arrivalDeserts);
  const access = useData<AccessActions>(DATA.accessActions);
  const tourism = useData<TourismDeserts>(DATA.tourism);

  const [step, setStep] = useState<Step>("flow");
  const [flowDong, setFlowDong] = useState<string | null>(null);
  const [cellRank, setCellRank] = useState<number | null>(null);
  const [shopIdx, setShopIdx] = useState<number | null>(null);
  const [sim, setSim] = useState(false);
  const [showGreedy, setShowGreedy] = useState(true);
  const [showTourism, setShowTourism] = useState(true);
  const [showPriority, setShowPriority] = useState(true);
  const [flowing, setFlowing] = useState(true);
  const [flowTime, setFlowTime] = useState(0);
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);
  const [didFlyShops, setDidFlyShops] = useState(false);

  // rAF clock for the flow animation — runs only while step ① is on screen.
  const lastFrame = useRef<number | null>(null);
  useEffect(() => {
    if (step !== "flow" || !flowing) {
      lastFrame.current = null;
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      if (lastFrame.current !== null) {
        const dt = (now - lastFrame.current) / 1000;
        setFlowTime((t) => (t + dt * FLOW_SPEED) % FLOW_LOOP);
      }
      lastFrame.current = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      lastFrame.current = null;
    };
  }, [step, flowing]);

  const features = useMemo(() => dongs.data?.features ?? [], [dongs.data]);
  const cells = useMemo(() => deserts.data?.cells ?? [], [deserts.data]);
  const greedy = useMemo(() => deserts.data?.greedy ?? [], [deserts.data]);
  const shops = useMemo(() => access.data?.shops ?? [], [access.data]);
  const drops = useMemo(() => access.data?.dropoffs ?? [], [access.data]);
  const sites = useMemo(() => tourism.data?.sites ?? [], [tourism.data]);

  // ── step 1: flows ───────────────────────────────────────────────────────
  const dongByName = useMemo(() => {
    const out = new Map<string, DongProps>();
    for (const f of features) {
      out.set(`${f.properties.gu} ${f.properties.name}`, f.properties);
    }
    return out;
  }, [features]);

  const flowTotals = useMemo(() => {
    const totals = new Map<string, { out: number; in: number }>();
    const bump = (name: string, key: "out" | "in", n: number) => {
      const row = totals.get(name) ?? { out: 0, in: 0 };
      row[key] += n;
      totals.set(name, row);
    };
    for (const p of od.data ?? []) {
      bump(p.oName, "out", p.count);
      bump(p.dName, "in", p.count);
    }
    return [...totals.entries()]
      .map(([name, row]) => ({ name, ...row, total: row.out + row.in }))
      .sort((a, b) => b.total - a.total);
  }, [od.data]);

  const arcs = useMemo(() => {
    const all = od.data ?? [];
    if (!flowDong) return all;
    return all.filter((p) => p.oName === flowDong || p.dName === flowDong);
  }, [od.data, flowDong]);

  const odTrips = useMemo(
    () => (od.data ?? []).reduce((sum, p) => sum + p.count, 0),
    [od.data],
  );

  /** one bowed polyline per visible flow, with a staggered travel window */
  const flowPaths = useMemo<FlowPath[]>(
    () =>
      arcs.map((pair, i) => {
        const phase = ((i * 0.3819) % 1) * (FLOW_LOOP - FLOW_TRAVEL);
        const path = bowedPath(pair.o, pair.d);
        return {
          pair,
          path,
          timestamps: path.map(
            (_pt, j) => phase + (j / (CURVE_STEPS - 1)) * FLOW_TRAVEL,
          ),
          width: Math.max(0.8, Math.sqrt(pair.count) * 0.55),
        };
      }),
    [arcs],
  );

  /** 출발 / 도착 endpoints of the visible flows, aggregated per coordinate */
  const endpoints = useMemo(() => {
    const make = (
      key: "o" | "d",
      nameKey: "oName" | "dName",
    ): { pos: [number, number]; name: string; count: number }[] => {
      const acc = new Map<
        string,
        { pos: [number, number]; name: string; count: number }
      >();
      for (const pair of arcs) {
        const pos = pair[key];
        const id = `${pos[0].toFixed(4)},${pos[1].toFixed(4)}`;
        const row = acc.get(id) ?? { pos, name: pair[nameKey], count: 0 };
        row.count += pair.count;
        acc.set(id, row);
      }
      return [...acc.values()];
    };
    return { origins: make("o", "oName"), dests: make("d", "dName") };
  }, [arcs]);

  const topDest = useMemo(
    () =>
      [...flowTotals].sort((a, b) => b.in - a.in)[0] ?? null,
    [flowTotals],
  );

  const priorityDongs = useMemo(
    () => features.filter((f) => f.properties.gapClass === "HL"),
    [features],
  );

  const flowSelected = flowDong ? dongByName.get(flowDong) ?? null : null;

  // ── step 2: destination deserts ─────────────────────────────────────────
  const cell = useMemo(
    () => cells.find((c) => c.rank === cellRank) ?? null,
    [cells, cellRank],
  );
  const maxScore = useMemo(
    () => Math.max(1e-9, ...cells.map((c) => c.score)),
    [cells],
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
    if (cells.length === 0) return 0;
    return (
      cells.filter((c) => c.lack.some((l) => l.includes("충전"))).length /
      cells.length
    );
  }, [cells]);

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
      setStep("deserts");
      if (!fromDong) return;
      const match = cells.find(
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
    [cells],
  );

  const goLast400 = useCallback(() => {
    setStep("last400");
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
    if (step !== "last400" || didFlyShops || shops.length === 0) return;
    const lng = shops.reduce((s, x) => s + x.lng, 0) / shops.length;
    const lat = shops.reduce((s, x) => s + x.lat, 0) / shops.length;
    setFlyTo({ longitude: lng, latitude: lat, zoom: 14.6 });
    setDidFlyShops(true);
  }, [step, didFlyShops, shops]);

  // ── map layers ──────────────────────────────────────────────────────────
  const layers = useMemo<Layer[]>(() => {
    const out: Layer[] = [];
    if (!dongs.data) return out;

    const filled = step !== "last400" && showPriority;
    out.push(
      new GeoJsonLayer<DongProps>({
        id: "bs-dongs",
        data: dongs.data as never,
        stroked: true,
        filled,
        getFillColor: (f) => {
          const p = f.properties;
          if (p.gapClass !== "HL") return [42, 51, 72, 40];
          return RGB_GAP.HL;
        },
        getLineColor: (f) =>
          flowSelected && f.properties.admCd === flowSelected.admCd
            ? [34, 211, 238, 255]
            : [35, 43, 61, 160],
        getLineWidth: (f) =>
          flowSelected && f.properties.admCd === flowSelected.admCd ? 2.5 : 1,
        lineWidthUnits: "pixels",
        opacity: step === "flow" ? 0.55 : 0.3,
        pickable: step === "flow",
        autoHighlight: step === "flow",
        highlightColor: [255, 255, 255, 60],
        onClick: (info) => {
          const p = (info.object as { properties?: DongProps } | undefined)
            ?.properties;
          if (!p) return;
          const name = `${p.gu} ${p.name}`;
          setFlowDong((current) => (current === name ? null : name));
        },
        updateTriggers: {
          getFillColor: [step, showPriority],
          getLineColor: [flowSelected?.admCd],
          getLineWidth: [flowSelected?.admCd],
        },
      }),
    );

    if (step === "flow" && flowPaths.length > 0) {
      // the route skeleton — always visible, carries the tooltip
      out.push(
        new PathLayer<FlowPath>({
          id: "bs-flow-paths",
          data: flowPaths,
          getPath: (d) => d.path,
          getColor: flowDong ? [56, 189, 248, 120] : [56, 189, 248, 55],
          getWidth: (d) => d.width,
          widthUnits: "pixels",
          widthMinPixels: 1,
          capRounded: true,
          jointRounded: true,
          pickable: true,
          updateTriggers: { getColor: [flowDong] },
        }),
        // the moving light: head at 도착 side, tail toward 출발
        new TripsLayer<FlowPath>({
          id: "bs-flow-lights",
          data: flowPaths,
          getPath: (d) => d.path,
          getTimestamps: (d) => d.timestamps,
          getColor: [34, 211, 238],
          getWidth: (d) => Math.max(1.6, d.width * 1.4),
          widthUnits: "pixels",
          widthMinPixels: 2,
          currentTime: flowTime,
          trailLength: FLOW_TRAIL,
          fadeTrail: true,
          capRounded: true,
          jointRounded: true,
          opacity: 0.95,
        }),
        // 출발: green rings the light leaves · 도착: cyan discs it arrives at
        new ScatterplotLayer<(typeof endpoints.origins)[number]>({
          id: "bs-flow-origins",
          data: endpoints.origins,
          getPosition: (d) => d.pos,
          getRadius: (d) => 130 + Math.sqrt(d.count) * 26,
          radiusUnits: "meters",
          radiusMinPixels: 3,
          radiusMaxPixels: 13,
          filled: false,
          stroked: true,
          getLineColor: [52, 211, 153, 225],
          getLineWidth: 1.6,
          lineWidthUnits: "pixels",
          pickable: true,
        }),
        new ScatterplotLayer<(typeof endpoints.dests)[number]>({
          id: "bs-flow-dests",
          data: endpoints.dests,
          getPosition: (d) => d.pos,
          getRadius: (d) => 130 + Math.sqrt(d.count) * 26,
          radiusUnits: "meters",
          radiusMinPixels: 3,
          radiusMaxPixels: 14,
          getFillColor: [34, 211, 238, 190],
          stroked: true,
          getLineColor: [11, 15, 26, 220],
          getLineWidth: 1,
          lineWidthUnits: "pixels",
          pickable: true,
        }),
      );
    }

    if (step === "deserts" && cells.length > 0) {
      out.push(
        new ScatterplotLayer<DesertCell>({
          id: "bs-cells",
          data: cells,
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
    const zoneShops = step === "deserts" ? (zone?.shops ?? []) : [];
    const zoneSites =
      step === "deserts" && showTourism ? (zone?.sites ?? []) : [];
    const shopData =
      step === "last400" ? shops : zoneShops.map((x) => x.shop);
    const siteData = step === "deserts" ? zoneSites.map((x) => x.site) : [];

    if (step === "last400" && drops.length > 0) {
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
    step,
    showPriority,
    flowSelected,
    flowPaths,
    endpoints,
    flowTime,
    flowDong,
    cells,
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

      if (id === "bs-flow-paths") {
        const p = (o as unknown as FlowPath).pair;
        return tooltipHtml(
          `<b>${shortDong(p.oName)} → ${shortDong(p.dName)}</b> · ${fmt(p.count)}건<br/>` +
            `<span style="color:#8b96ab">${p.oName} → ${p.dName}</span>`,
        );
      }
      if (id === "bs-flow-origins" || id === "bs-flow-dests") {
        const e = o as unknown as { name: string; count: number };
        const isOrigin = id === "bs-flow-origins";
        return tooltipHtml(
          `<b>${e.name}</b><br/><span style="color:${isOrigin ? HEX.infra : HEX.accent}">` +
            `${isOrigin ? "출발" : "도착"} ${fmt(e.count)}건</span>`,
        );
      }
      if (id === "bs-dongs") {
        const p = (o as { properties?: DongProps }).properties;
        if (!p) return null;
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
  }, [greedy, sim]);

  useEffect(() => {
    onMapSpec({ layers, getTooltip, flyTo });
  }, [layers, getTooltip, flyTo, onMapSpec]);

  // ── KPI band ────────────────────────────────────────────────────────────
  const kpis: ReactNode =
    step === "flow" ? (
      <div className="grid grid-cols-4 gap-2">
        <KpiTile
          label="집계된 주요 이동"
          value={od.data ? `${fmt(odTrips)}건` : "—"}
          sub={od.data ? `상위 ${fmt(od.data.length)}개 흐름` : undefined}
          color={HEX.demand}
        />
        <KpiTile
          label="가장 많이 도착하는 곳"
          value={topDest ? shortDong(topDest.name) : "—"}
          sub={topDest ? `도착 ${fmt(topDest.in)}건` : undefined}
          color={HEX.accent}
        />
        <KpiTile
          label="우선 사각지대 (수요高·인프라低)"
          value={dongs.data ? `${fmt(priorityDongs.length)}개 동` : "—"}
          sub={dongs.data ? `전체 ${fmt(features.length)}개 동 중` : undefined}
          color={HEX.gapHL}
        />
        <KpiTile
          label={flowSelected ? `${flowSelected.name} 이동량` : "선택한 행정동"}
          value={
            flowDong
              ? `${fmt(arcs.reduce((s, p) => s + p.count, 0))}건`
              : "미선택"
          }
          sub={
            flowSelected
              ? `${GAP_LABEL[flowSelected.gapClass]}`
              : "지도나 목록에서 선택"
          }
          color={HEX.warn}
          active={Boolean(flowDong)}
        />
      </div>
    ) : step === "deserts" ? (
      <div className="grid grid-cols-4 gap-2">
        <KpiTile
          label="도착지 공백 격자"
          value={deserts.data ? `${fmt(cells.length)}곳` : "—"}
          sub={
            deserts.data ? `${deserts.data.params.cellM}m 격자 기준` : undefined
          }
          color={HEX.warn}
        />
        <KpiTile
          label="1위 격자 하차"
          value={cells[0] ? `${fmt(cells[0].dropoffs)}건` : "—"}
          sub={cells[0]?.dong ?? undefined}
          color={HEX.gapHL}
        />
        <KpiTile
          label="충전소가 먼 격자"
          value={cells.length ? pct(chargerLackShare) : "—"}
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
  const toolbar: ReactNode =
    step === "flow" ? (
      <MapToolbar label="이동 흐름 — 빛이 흐르는 쪽이 도착지">
        <span className="flex items-center gap-1.5 text-[11px] text-ink">
          <span
            className="h-2.5 w-2.5 rounded-full border-[1.5px]"
            style={{ borderColor: HEX.infra }}
          />
          출발
          <span className="text-dim">›››</span>
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: HEX.accent }}
          />
          도착
        </span>
        <Chip
          active={flowing}
          onClick={() => setFlowing((v) => !v)}
          color={HEX.accent}
        >
          흐름 재생 {flowing ? "ON" : "OFF"}
        </Chip>
        <Chip
          active={showPriority}
          onClick={() => setShowPriority((v) => !v)}
          color={HEX.gapHL}
        >
          우선 사각지대 음영
        </Chip>
        {flowDong && (
          <Chip active onClick={() => setFlowDong(null)}>
            전체 흐름으로
          </Chip>
        )}
      </MapToolbar>
    ) : step === "deserts" ? (
      <MapToolbar label="도착지 공백">
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
        <Chip
          active={showPriority}
          onClick={() => setShowPriority((v) => !v)}
          color={HEX.gapHL}
        >
          우선 사각지대 음영
        </Chip>
        {cell && (
          <Chip active onClick={() => setCellRank(null)}>
            선택 해제
          </Chip>
        )}
      </MapToolbar>
    ) : (
      <MapToolbar label="도착 이후 400m">
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
        <Chip active={sim} onClick={() => setSim((v) => !v)} color={HEX.accent}>
          입구 무턱화 시뮬 {sim ? "ON" : "OFF"}
        </Chip>
      </MapToolbar>
    );

  // ── right column ────────────────────────────────────────────────────────
  const side: ReactNode =
    step === "flow" ? (
      !od.data ? (
        <DataPending note="od.json 대기 중 — 행정동 간 이동 흐름이 표시됩니다." />
      ) : (
        <SidePanel
          title="이동량 많은 행정동"
          aside={`${fmt(arcs.length)}개 흐름`}
        >
          <ul>
            {flowTotals.slice(0, 40).map((row, i) => {
              const active = row.name === flowDong;
              const props = dongByName.get(row.name);
              return (
                <li key={row.name}>
                  <button
                    type="button"
                    onClick={() => {
                      setFlowDong(active ? null : row.name);
                      if (!active && props)
                        setFlyTo({
                          longitude: props.centroid[0],
                          latitude: props.centroid[1],
                          zoom: 12.4,
                        });
                    }}
                    className={`flex w-full items-center gap-2 border-b border-line px-2.5 py-1.5 text-left text-[12px] last:border-b-0 ${
                      active ? "bg-accent/10" : "hover:bg-[#161e30]"
                    }`}
                  >
                    <span className="tnum w-5 shrink-0 text-dim">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span
                        className={
                          active ? "font-semibold text-accent" : "text-ink"
                        }
                      >
                        {shortDong(row.name)}
                      </span>
                      <span className="ml-1 text-[10px] text-dim">
                        {row.name.split(" ")[0]}
                      </span>
                    </span>
                    {props?.gapClass === "HL" && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: HEX.gapHL }}
                        title="우선 사각지대"
                      />
                    )}
                    <span className="tnum shrink-0 text-[11px] text-dim">
                      {fmt(row.total)}건
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </SidePanel>
      )
    ) : step === "deserts" ? (
      !deserts.data ? (
        <DataPending note="arrival_deserts.json 대기 중 — 하차 250m 격자 공백이 표시됩니다." />
      ) : (
        <SidePanel
          title="도착지 공백 순위"
          aside={`행 클릭 = 확대 · ${deserts.data.params.cellM}m`}
        >
          <ul>
            {cells.slice(0, 40).map((c) => {
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

  // ── bottom strip: the selected object + the one recommended action ──────
  const bottom: ReactNode =
    step === "flow" ? (
      <div className="flex items-stretch gap-3">
        {flowSelected ? (
          <SelectedBlock
            title={`${flowSelected.gu} ${flowSelected.name}`}
            badge={{
              label: GAP_LABEL[flowSelected.gapClass],
              color: GAP_HEX[flowSelected.gapClass],
            }}
            onClear={() => setFlowDong(null)}
            facts={[
              ["도착(하차)", `${fmt(flowSelected.dropoffs)}건`],
              ["출발(승차)", `${fmt(flowSelected.pickups)}건`],
              ["미배차", `${fmt(flowSelected.unassigned)}건`],
              ["격차점수", flowSelected.gapScore.toFixed(2)],
              [
                "충전소·병의원",
                `${fmt(flowSelected.chargers)}·${fmt(flowSelected.hospitals)}개`,
              ],
            ]}
          />
        ) : (
          <EmptyBlock text="지도의 행정동이나 오른쪽 목록을 선택하면 그 동의 이동·인프라가 여기 나타납니다." />
        )}
        <ActionCard
          eyebrow="다음 질문"
          action={
            flowSelected
              ? `${flowSelected.name}에 내린 사람은 어디로 갈 수 있나?`
              : "도착지에 갈 만한 곳이 있는지 확인"
          }
          impact="이동은 보이지만, 도착 이후는 아직 보이지 않습니다."
          cta={{
            label: "② 도착지 공백 보기",
            onClick: () => goDeserts(flowSelected),
          }}
        />
      </div>
    ) : step === "deserts" ? (
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
                label: "① 도시 전체 흐름으로",
                onClick: () => setStep("flow"),
              }}
            />
          );
        })()}
      </div>
    );

  const footnote: ReactNode =
    step === "flow" ? (
      "OD 흐름은 출발지 좌표가 있는 2025년 5월 부산 전역 공개 데이터 기준입니다. 본선 데이터에는 출발지 좌표가 없어 도착지 기반 분석(②·③)이 본 줄기입니다."
    ) : step === "deserts" ? (
      `부족 판정은 직선거리 기준(충전소 800m·병의원 500m·복지시설 1km)이며, 후보 지점은 greedy maximal-coverage 제안으로 부지 확보 검토가 아닙니다. 격자는 ${deserts.data?.params.cellM ?? 250}m 집계라 개별 이동을 추적하지 않습니다.`
    ) : (
      `무장애가게 실사는 ${access.data?.meta.scope ?? "표본"} 범위이며 거리는 직선 proximity입니다. "완비 0곳"은 표본의 사실일 뿐 인과 주장이 아닙니다.`
    );

  return (
    <PresentationLayout
      question="내려서 실제로 들어갈 수 있는 곳은 어디인가?"
      hint="이동 → 도착지 → 문 앞. 세 단계로 좁혀 봅니다."
      steps={STEPS}
      activeStep={step}
      onStep={(id) => setStep(id as Step)}
      kpis={kpis}
      toolbar={toolbar}
      map={map}
      side={
        <div className="space-y-3">
          {side}
          <Explainer
            what={
              <p>
                한 화면에서 세 가지 축척을 잇습니다: 교통약자가{" "}
                <b>어디로 이동하는지</b>(행정동 간 흐름), 그 도착지에{" "}
                <b>갈 만한 시설이 있는지</b>(250m 하차 격자의 시설 공백), 그리고
                도착 이후 400m 안에서 <b>실제로 문을 통과할 수 있는지</b>
                (무장애가게 12개 Y/N 실사). 붉은 음영은 수요는 높지만 인프라가
                낮은 우선 사각지대 행정동입니다.
              </p>
            }
            how={
              <p>
                ① 완료 운행의 승차동→하차동 쌍을 집계해 상위 흐름을 동 중심점으로
                이었습니다. ② 하차 지점을 {deserts.data?.params.cellM ?? 250}m
                격자로 묶고 하차 건수 × 시설 부족 가중치로 점수를 매긴 뒤, greedy
                maximal-coverage로 다음 시설 후보를 뽑았습니다. ③ 진입(입구턱·무턱·
                경사로 → 일층·엘리베이터) → 이용(테이블석) → 편의(장애인화장실)
                사슬에서 가장 먼저 끊기는 지점이 그 가게의 판정입니다(weakest-link).
              </p>
            }
            caveats={
              <p>
                ①은 출발지 좌표가 있는 5월 공개 데이터, ③은 송정동 실사 표본
                기준입니다. 거리는 모두 직선거리라 언덕·횡단보도가 반영되지
                않았고, 회색·비표시 지역은 값이 0이라는 뜻이 아니라 원자료 범위
                밖일 수 있습니다.
              </p>
            }
          />
        </div>
      }
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
