"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArcLayer, GeoJsonLayer, ScatterplotLayer, TextLayer } from "deck.gl";
import type { Layer } from "@deck.gl/core";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DATA,
  type DongProps,
  type Stats,
  type UnmetCell,
  type WaitKm,
} from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt, pct } from "@/lib/format";
import { HEX } from "@/lib/palette";
import {
  tooltipHtml,
  type DongCollection,
  type FlyTo,
  type MapSpec,
} from "@/lib/mapspec";
import { haversineM } from "@/lib/access";
import { DataPending } from "@/components/ui/DataPending";
import { Explainer } from "@/components/ui/Explainer";
import {
  ActionCard,
  Chip,
  KpiTile,
  MapToolbar,
  PresentationLayout,
} from "@/components/PresentationLayout";
import {
  CURSOR_FILL,
  TICK,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
} from "@/components/charts/theme";

// 배차 시스템 — a route-planner surface, not an analytical form: pick 시간 and
// 휠체어 조건 at the top, click 출발 / 도착 straight on the map, read one large
// result (대기 · 미배차 위험 · 우선순위 · 근거) on the right.

type Chair = "none" | "manual" | "electric";

const CHAIRS: { id: Chair; label: string }[] = [
  { id: "none", label: "미이용" },
  { id: "manual", label: "수동" },
  { id: "electric", label: "전동" },
];

const CHAIR_WAIT: Record<Chair, number> = { none: 1, manual: 1.06, electric: 1.12 };
const CHAIR_RISK: Record<Chair, number> = { none: 1, manual: 1.07, electric: 1.15 };
const CHAIR_PRIORITY: Record<Chair, number> = { none: 0, manual: 6, electric: 12 };

export function DispatchScene({
  onMapSpec,
  map,
}: {
  onMapSpec: (spec: MapSpec) => void;
  map: ReactNode;
}) {
  const stats = useData<Stats>(DATA.stats);
  const wait = useData<WaitKm>(DATA.waitKm);
  const unmet = useData<UnmetCell[]>(DATA.unmet);
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);

  const [hour, setHour] = useState(8);
  const [chair, setChair] = useState<Chair>("manual");
  const [pick, setPick] = useState<"origin" | "destination">("origin");
  const [originCd, setOriginCd] = useState<string | null>(null);
  const [destCd, setDestCd] = useState<string | null>(null);
  const [showUnmet, setShowUnmet] = useState(false);
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);

  const all = useMemo(
    () => dongs.data?.features.map((f) => f.properties) ?? [],
    [dongs.data],
  );
  const origin = useMemo(
    () => all.find((p) => p.admCd === originCd) ?? null,
    [all, originCd],
  );
  const destination = useMemo(
    () => all.find((p) => p.admCd === destCd) ?? null,
    [all, destCd],
  );

  const queue = wait.data?.queue ?? [];
  const row = queue.find((q) => q.hour === hour) ?? null;

  const worstHour = useMemo(
    () =>
      queue.reduce<WaitKm["queue"][number] | null>(
        (worst, q) =>
          !worst || q.unassignedRate > worst.unassignedRate ? q : worst,
        null,
      ),
    [queue],
  );

  const unmetRequests = useMemo(
    () => (unmet.data ?? []).reduce((s, c) => s + c.unassigned + c.cancelled, 0),
    [unmet.data],
  );

  // ── the estimate (same heuristic as the rehearsal panel, made explicit) ──
  const cityRate = stats.data?.totals.unassignedRate ?? 0;
  const originRate = origin
    ? origin.unassigned / Math.max(1, origin.pickups + origin.unassigned)
    : cityRate;
  const pressure = Math.max(0.8, Math.min(1.5, 1 + (originRate - cityRate) * 2));

  const baseWait =
    row?.p50Assign != null && row.p50Board != null
      ? row.p50Assign + row.p50Board
      : null;
  const expected =
    baseWait != null ? baseWait * pressure * CHAIR_WAIT[chair] : null;
  const risk = row
    ? Math.max(
        0,
        Math.min(
          1,
          row.unassignedRate * (1 + (originRate - cityRate)) * CHAIR_RISK[chair],
        ),
      )
    : null;
  const priority =
    expected != null && risk != null
      ? Math.min(
          100,
          Math.round(expected * 0.7 + risk * 300 + CHAIR_PRIORITY[chair]),
        )
      : null;
  const verdict =
    priority == null
      ? "분석 대기"
      : priority >= 70
        ? "우선 배차 권고"
        : priority >= 45
          ? "주의 배차"
          : "일반 배차";
  const verdictColor =
    priority == null
      ? HEX.inkDim
      : priority >= 70
        ? HEX.gapHL
        : priority >= 45
          ? HEX.warn
          : HEX.infra;

  const reasons = useMemo(() => {
    const out: { text: string; tone: "warn" | "ok" | "flat" }[] = [];
    if (row)
      out.push({
        text: `${hour}시 요청 ${fmt(row.requests)}건 · 이 시간대 미배차율 ${pct(row.unassignedRate)}`,
        tone: row.unassignedRate > cityRate ? "warn" : "ok",
      });
    if (origin)
      out.push({
        text: `출발지 ${origin.name} 미배차 비율 ${pct(originRate)} (시 평균 ${pct(cityRate)}) → 대기 ×${pressure.toFixed(2)}`,
        tone: originRate > cityRate ? "warn" : "ok",
      });
    out.push({
      text:
        chair === "electric"
          ? "전동휠체어 — 리프트 차량 한정으로 대기·미배차 위험 상향"
          : chair === "manual"
            ? "수동휠체어 — 차량 제약 일부 반영"
            : "휠체어 미이용 — 차량 제약 없음",
      tone: chair === "electric" ? "warn" : "flat",
    });
    if (destination) {
      if (chair === "electric" && destination.chargers === 0)
        out.push({
          text: `도착지 ${destination.name}에 급속충전기가 없어 복귀 이동까지 고려 필요`,
          tone: "warn",
        });
      else if (destination.gapClass === "HL")
        out.push({
          text: `도착지 ${destination.name}는 수요 대비 인프라가 부족한 우선 사각지대`,
          tone: "warn",
        });
      else
        out.push({
          text: `도착지 ${destination.name} 인프라 지수 z ${destination.infraZ.toFixed(2)}`,
          tone: "flat",
        });
    }
    return out;
  }, [row, hour, cityRate, origin, originRate, pressure, chair, destination]);

  const distanceM =
    origin && destination
      ? haversineM(origin.centroid, destination.centroid)
      : null;

  const setNode = useCallback(
    (p: DongProps) => {
      if (pick === "origin") {
        setOriginCd(p.admCd);
        setPick("destination");
      } else {
        setDestCd(p.admCd);
        setPick("origin");
      }
    },
    [pick],
  );

  // ── layers ──────────────────────────────────────────────────────────────
  const layers = useMemo<Layer[]>(() => {
    const out: Layer[] = [];
    if (dongs.data) {
      out.push(
        new GeoJsonLayer<DongProps>({
          id: "dispatch-choro",
          data: dongs.data as never,
          pickable: true,
          stroked: true,
          filled: true,
          getFillColor: (f) => {
            const p = f.properties;
            const rate = p.unassigned / Math.max(1, p.pickups + p.unassigned);
            const t = Math.min(1, rate / 0.25);
            return [251, 113, 133, Math.round(12 + t * 170)];
          },
          getLineColor: (f) => {
            const cd = f.properties.admCd;
            if (cd === originCd) return [52, 211, 153, 255];
            if (cd === destCd) return [34, 211, 238, 255];
            return [35, 43, 61, 170];
          },
          getLineWidth: (f) =>
            f.properties.admCd === originCd || f.properties.admCd === destCd
              ? 3
              : 1,
          lineWidthUnits: "pixels",
          autoHighlight: true,
          highlightColor: [255, 255, 255, 60],
          onClick: (info) => {
            const p = (info.object as { properties?: DongProps } | undefined)
              ?.properties;
            if (p) setNode(p);
          },
          updateTriggers: {
            getLineColor: [originCd, destCd],
            getLineWidth: [originCd, destCd],
          },
        }),
      );
    }

    if (showUnmet && unmet.data && unmet.data.length > 0) {
      out.push(
        new ScatterplotLayer<UnmetCell>({
          id: "dispatch-unmet",
          data: unmet.data,
          getPosition: (d) => [d.lng, d.lat],
          getRadius: (d) => 60 + Math.sqrt(d.unassigned + d.cancelled) * 40,
          radiusUnits: "meters",
          radiusMinPixels: 2,
          radiusMaxPixels: 18,
          getFillColor: [251, 113, 133, 120],
          pickable: true,
        }),
      );
    }

    if (origin && destination) {
      out.push(
        new ArcLayer<{ o: [number, number]; d: [number, number] }>({
          id: "dispatch-route",
          data: [{ o: origin.centroid, d: destination.centroid }],
          getSourcePosition: (d) => d.o,
          getTargetPosition: (d) => d.d,
          getSourceColor: [52, 211, 153, 230],
          getTargetColor: [34, 211, 238, 230],
          getWidth: 4,
          widthUnits: "pixels",
          getHeight: 0.35,
        }),
      );
    }

    const nodes: { label: string; p: DongProps; color: [number, number, number] }[] =
      [];
    if (origin) nodes.push({ label: "출발", p: origin, color: [52, 211, 153] });
    if (destination)
      nodes.push({ label: "도착", p: destination, color: [34, 211, 238] });

    if (nodes.length > 0) {
      out.push(
        new ScatterplotLayer<(typeof nodes)[number]>({
          id: "dispatch-nodes",
          data: nodes,
          getPosition: (d) => d.p.centroid,
          getRadius: 10,
          radiusUnits: "pixels",
          getFillColor: (d) => [...d.color, 240] as [number, number, number, number],
          stroked: true,
          getLineColor: [11, 15, 26, 255],
          getLineWidth: 2,
          lineWidthUnits: "pixels",
        }),
        new TextLayer<(typeof nodes)[number]>({
          id: "dispatch-node-labels",
          data: nodes,
          getPosition: (d) => d.p.centroid,
          getText: (d) => `${d.label} · ${d.p.name}`,
          getSize: 12,
          getColor: [226, 232, 240, 255],
          getPixelOffset: [0, -18],
          fontWeight: 700,
          getTextAnchor: "middle",
          getAlignmentBaseline: "bottom",
          background: true,
          getBackgroundColor: [11, 15, 26, 200],
          backgroundPadding: [4, 2, 4, 2],
        }),
      );
    }

    return out;
  }, [dongs.data, originCd, destCd, showUnmet, unmet.data, origin, destination, setNode]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      const id = info.layer?.id;
      const o = info.object as Record<string, unknown> | undefined;
      if (!o) return null;
      if (id === "dispatch-choro") {
        const p = (o as { properties?: DongProps }).properties;
        if (!p) return null;
        const rate = p.unassigned / Math.max(1, p.pickups + p.unassigned);
        return tooltipHtml(
          `<b>${p.gu} ${p.name}</b><br/>승차 ${fmt(p.pickups)}건 · 미배차 ${fmt(p.unassigned)}건 (${pct(rate)})<br/>` +
            `<span style="color:#8b96ab">클릭 = ${pick === "origin" ? "출발지" : "도착지"} 지정</span>`,
        );
      }
      if (id === "dispatch-unmet") {
        const c = o as unknown as UnmetCell;
        return tooltipHtml(
          `<b>미충족 요청</b><br/>미배차 ${fmt(c.unassigned)}건 · 취소 ${fmt(c.cancelled)}건<br/><span style="color:#8b96ab">약 100m 집계</span>`,
        );
      }
      return null;
    };
  }, [pick]);

  useEffect(() => {
    onMapSpec({ layers, getTooltip, flyTo });
  }, [layers, getTooltip, flyTo, onMapSpec]);

  // ── KPI band ────────────────────────────────────────────────────────────
  const kpis = (
    <div className="grid grid-cols-4 gap-2">
      <KpiTile
        label="배차 대기 중앙값 (KM)"
        value={
          wait.data?.km.median != null
            ? `${wait.data.km.median.toFixed(1)}분`
            : "—"
        }
        sub={
          wait.data ? `단순 중앙값 ${wait.data.naive.median.toFixed(1)}분` : undefined
        }
        color={HEX.warn}
      />
      <KpiTile
        label="전체 미배차율"
        value={stats.data ? pct(stats.data.totals.unassignedRate) : "—"}
        sub={stats.data ? `미배차 ${fmt(stats.data.totals.unassigned)}건` : undefined}
        color={HEX.unmet}
      />
      <KpiTile
        label="가장 위험한 시간대"
        value={worstHour ? `${worstHour.hour}시` : "—"}
        sub={worstHour ? `미배차 ${pct(worstHour.unassignedRate)}` : undefined}
        color={HEX.demand}
      />
      <KpiTile
        label="좌표 있는 미충족 요청"
        value={unmet.data ? `${fmt(unmetRequests)}건` : "—"}
        sub="약 100m 격자 집계"
        color={HEX.accent}
      />
    </div>
  );

  // ── toolbar: time + chair + pick mode ───────────────────────────────────
  const toolbar = (
    <>
      <MapToolbar label="요청 조건">
        <div className="flex w-[300px] flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <span className="tnum text-[15px] font-bold leading-5 text-ink">
              {String(hour).padStart(2, "0")}:00
            </span>
            <span className="tnum text-[10px] text-dim">
              {row
                ? `요청 ${fmt(row.requests)}건 · 미배차 ${pct(row.unassignedRate)}`
                : "표본 부족"}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={23}
            step={1}
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
            aria-label="요청 시각"
            className="w-full"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {CHAIRS.map((c) => (
            <Chip key={c.id} active={chair === c.id} onClick={() => setChair(c.id)}>
              {c.label}
            </Chip>
          ))}
        </div>
      </MapToolbar>

      <MapToolbar label="지도에서 지정">
        <Chip active={pick === "origin"} onClick={() => setPick("origin")} color={HEX.infra}>
          출발 {origin ? `· ${origin.name}` : "미지정"}
        </Chip>
        <Chip
          active={pick === "destination"}
          onClick={() => setPick("destination")}
          color={HEX.accent}
        >
          도착 {destination ? `· ${destination.name}` : "미지정"}
        </Chip>
        <Chip active={showUnmet} onClick={() => setShowUnmet((v) => !v)} color={HEX.unmet}>
          미충족 요청
        </Chip>
        {(origin || destination) && (
          <Chip
            active={false}
            onClick={() => {
              setOriginCd(null);
              setDestCd(null);
              setPick("origin");
            }}
          >
            초기화
          </Chip>
        )}
      </MapToolbar>
    </>
  );

  // ── right column: one large result ──────────────────────────────────────
  const side: ReactNode = !wait.data ? (
    <DataPending note="wait_km.json 대기 중 — 시간대별 대기·미배차 추정이 표시됩니다." />
  ) : (
    <div className="space-y-3">
      <section className="rounded-lg border border-line bg-panel px-3.5 py-3">
        <div className="text-[11px] text-dim">
          {String(hour).padStart(2, "0")}:00 ·{" "}
          {CHAIRS.find((c) => c.id === chair)?.label} ·{" "}
          {origin ? origin.name : "출발 미지정"} →{" "}
          {destination ? destination.name : "도착 미지정"}
        </div>

        <div className="mt-1 text-[11px] text-dim">예상 대기시간</div>
        <div className="tnum text-[38px] font-bold leading-[44px] text-ink">
          {expected != null ? `${expected.toFixed(0)}분` : "표본 부족"}
        </div>
        {row && (
          <div className="tnum text-[11px] leading-4 text-dim">
            접수→배차 {row.p50Assign?.toFixed(0) ?? "—"}분 + 배차→승차{" "}
            {row.p50Board?.toFixed(0) ?? "—"}분 · 출발지 압력 ×
            {pressure.toFixed(2)}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-md border border-line bg-[#0e1424] px-2.5 py-2">
            <div className="text-[10px] text-dim">미배차 위험</div>
            <div className="tnum text-[22px] font-bold leading-7 text-unmet">
              {risk != null ? pct(risk) : "—"}
            </div>
          </div>
          <div className="rounded-md border border-line bg-[#0e1424] px-2.5 py-2">
            <div className="text-[10px] text-dim">배차 우선순위</div>
            <div className="tnum text-[22px] font-bold leading-7 text-accent">
              {priority ?? "—"}
              <span className="ml-0.5 text-[12px] font-semibold">점</span>
            </div>
          </div>
        </div>

        <div
          className="mt-2 rounded-md px-2.5 py-2 text-[13px] font-bold"
          style={{ background: `${verdictColor}1f`, color: verdictColor }}
        >
          {verdict}
        </div>

        <ul className="mt-2 space-y-1">
          {reasons.map((r) => (
            <li
              key={r.text}
              className="flex gap-1.5 text-[11px] leading-4 text-ink/85"
            >
              <span
                className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background:
                    r.tone === "warn"
                      ? HEX.unmet
                      : r.tone === "ok"
                        ? HEX.infra
                        : HEX.inkDim,
                }}
              />
              {r.text}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-line bg-panel px-3 py-2.5">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-[12px] font-semibold text-ink">시간대별 부하</h3>
          <span className="text-[10px] text-dim">막대 클릭 = 시각 변경</span>
        </div>
        <div style={{ height: 132 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={queue.map((q) => ({
                hour: q.hour,
                requests: q.requests,
                rate: q.unassignedRate,
              }))}
              margin={{ top: 4, right: 4, bottom: 0, left: -22 }}
              onClick={(e) => {
                const h = e?.activeLabel;
                if (typeof h === "number") setHour(h);
                else if (typeof h === "string") setHour(Number(h));
              }}
            >
              <XAxis
                dataKey="hour"
                tick={TICK}
                tickLine={false}
                axisLine={{ stroke: "var(--line)" }}
                interval={3}
              />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={44} />
              <Tooltip
                cursor={CURSOR_FILL}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                labelFormatter={(v) => `${v}시`}
                formatter={(v, name) =>
                  name === "requests"
                    ? [`${fmt(Number(v))}건`, "요청"]
                    : [pct(Number(v)), "미배차율"]
                }
              />
              <Bar dataKey="requests" name="requests" radius={[3, 3, 0, 0]}>
                {queue.map((q) => (
                  <Cell
                    key={q.hour}
                    fill={q.hour === hour ? HEX.accent : HEX.demand}
                    fillOpacity={q.hour === hour ? 0.95 : 0.35}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <Explainer
        what={
          <p>
            요청 시각과 휠체어 조건을 고른 뒤 지도에서 출발지와 도착지를
            클릭하면, 그 조합에 대한 <b>예상 대기시간·미배차 위험·배차
            우선순위</b>와 그 판단의 근거가 한 화면에 나옵니다. 행정동 음영은
            승차 요청 대비 미배차 비율이라 &ldquo;차가 잘 안 잡히는 출발지&rdquo;를
            바로 볼 수 있습니다.
          </p>
        }
        how={
          <p>
            기준값은 2025년 5월 같은 시각의 단계별 중앙값(접수→배차 +
            배차→승차)입니다. 여기에 출발지 미배차 비율이 시 평균보다 높은 만큼의
            압력 계수(0.8~1.5)와 휠체어 조건 계수(전동 1.12·수동 1.06)를
            곱합니다. 미배차 위험은 그 시간대 미배차율에 같은 두 요인을 적용한
            값이고, 우선순위 점수는 대기(0.7배)·위험(300배)·휠체어 가중치를 더해
            100점으로 자릅니다. 대기 중앙값 KPI는 미배차 요청을 중도절단으로
            처리한 Kaplan-Meier 추정입니다.
          </p>
        }
        caveats={
          <p>
            <b>데모용 휴리스틱입니다</b> — 실시간 차량 위치·도로 소요시간·운전자
            상태를 쓰지 않으므로 운영 배차 결정을 대체하지 않습니다. 과거 같은
            시간대의 분포를 조건별로 보정한 기대치일 뿐이며, 표본이 적은 시간대는
            &ldquo;표본 부족&rdquo;으로 비워 둡니다. 경로선은 행정동 중심점을 이은
            직선으로 실제 주행 경로가 아닙니다.
          </p>
        }
      />
    </div>
  );

  // ── bottom strip ────────────────────────────────────────────────────────
  const destWarning =
    destination == null
      ? null
      : chair === "electric" && destination.chargers === 0
        ? "도착 행정동에 전동휠체어 급속충전기가 없습니다."
        : destination.gapClass === "HL"
          ? "도착지가 수요 대비 인프라가 부족한 우선 사각지대입니다."
          : null;

  const bottom = (
    <div className="flex items-stretch gap-3">
      {origin && destination ? (
        <div className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[14px] font-bold leading-5 text-ink">
              {origin.gu} {origin.name} → {destination.gu} {destination.name}
            </h2>
            <button
              type="button"
              onClick={() => {
                setOriginCd(null);
                setDestCd(null);
                setPick("origin");
              }}
              className="ml-auto shrink-0 text-[10.5px] text-accent hover:underline"
            >
              초기화
            </button>
          </div>
          <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
            {(
              [
                ["직선 거리", distanceM != null ? `${(distanceM / 1000).toFixed(1)}km` : "—"],
                ["출발지 미배차율", pct(originRate)],
                ["도착지 충전소·병의원", `${fmt(destination.chargers)}·${fmt(destination.hospitals)}개`],
                ["도착지 격차점수", destination.gapScore.toFixed(2)],
                ["요청 시각", `${String(hour).padStart(2, "0")}:00`],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-1.5">
                <dt className="text-[10.5px] text-dim">{k}</dt>
                <dd className="tnum text-[12px] font-semibold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          {destWarning && (
            <p className="mt-1.5 rounded border border-warn/40 bg-warn/10 px-2 py-1 text-[10.5px] leading-4 text-warn">
              도착지 확인: {destWarning}
            </p>
          )}
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center rounded-lg border border-dashed border-line bg-panel/40 px-3.5 py-2.5 text-[11.5px] leading-5 text-dim">
          지도에서 행정동을 클릭하세요 — 첫 클릭이 <b className="text-infra">출발</b>
          , 다음 클릭이 <b className="text-accent">도착</b>입니다. 두 지점이 정해지면
          경로선과 함께 배차 판단이 계산됩니다.
        </div>
      )}
      <ActionCard
        eyebrow="배차 권고"
        action={verdict}
        owner={priority != null && priority >= 70 ? "관제·배차팀" : "관제"}
        impact={
          expected != null && risk != null
            ? `예상 대기 ${expected.toFixed(0)}분 · 미배차 위험 ${pct(risk)}`
            : "시각·출발지를 지정하면 권고가 계산됩니다."
        }
      />
    </div>
  );

  return (
    <PresentationLayout
      question="이 요청은 언제·얼마나 기다리게 되는가?"
      hint="시간과 휠체어 조건을 고르고, 지도에서 출발·도착을 지정하세요."
      kpis={kpis}
      toolbar={toolbar}
      map={map}
      side={side}
      bottom={bottom}
      footnote="2025년 5월 운행 로그 기반 휴리스틱 추정이며 실시간 배차 예측이 아닙니다. LLM 설명 계층은 미연결(OpenAI 호환 API로 교체 가능)."
    />
  );
}
