"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { GeoJsonLayer, ScatterplotLayer } from "deck.gl";
import type { Layer } from "@deck.gl/core";
import {
  DATA,
  DISABILITY_TYPES,
  type DongProps,
  type GuToilets,
  type InfraPoint,
  type StationLift,
  type WelfareProgram,
  type WelfareProgramsData,
} from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt, pct } from "@/lib/format";
import {
  DISABILITY_HEX,
  HEX,
  INFRA_HEX,
  INFRA_LABEL,
  type RGB,
} from "@/lib/palette";
import {
  tooltipHtml,
  type DongCollection,
  type FlyTo,
  type MapSpec,
} from "@/lib/mapspec";
import { DataPending } from "@/components/ui/DataPending";
import { Explainer } from "@/components/ui/Explainer";
import {
  ActionCard,
  Chip,
  KpiTile,
  MapToolbar,
  PresentationLayout,
} from "@/components/PresentationLayout";

// 생활 인프라 — one interface instead of two collapsible legacy blocks:
// filters over the map, a profile of the selected 행정동 on the right, and ONE
// unified card for whatever object was clicked (facility or 복지관 program hub).

type Filter = "charger" | "medical" | "welfare" | "program";

const FILTERS: { id: Filter; label: string; color: string }[] = [
  { id: "charger", label: "충전소", color: INFRA_HEX.charger },
  { id: "medical", label: "의료", color: INFRA_HEX.hospital },
  { id: "welfare", label: "복지시설", color: INFRA_HEX.welfare },
  { id: "program", label: "프로그램 운영기관", color: HEX.tourism },
];

/** 복지관 that actually appear in welfare_programs.json, one point each. */
interface ProgramHub {
  center: string;
  gu: string;
  lng: number;
  lat: number;
  approx: boolean;
  programs: WelfareProgram[];
}

type Picked =
  | { kind: "poi"; poi: InfraPoint }
  | { kind: "hub"; hub: ProgramHub }
  | null;

const POI_RGB: Record<string, RGB> = {
  charger: [34, 211, 238],
  hospital: [52, 211, 153],
  pharmacy: [56, 189, 248],
  welfare: [251, 191, 36],
};

function poiPasses(type: InfraPoint["type"], on: Record<Filter, boolean>) {
  if (type === "charger") return on.charger;
  if (type === "hospital" || type === "pharmacy") return on.medical;
  if (type === "welfare") return on.welfare;
  return false; // tourism lives on the 접근성 사각지대 screen
}

export function InfrastructureScene({
  onMapSpec,
  map,
}: {
  onMapSpec: (spec: MapSpec) => void;
  map: ReactNode;
}) {
  const points = useData<InfraPoint[]>(DATA.infraPoints);
  const toilets = useData<GuToilets[]>(DATA.toiletsGu);
  const welfare = useData<WelfareProgramsData>(DATA.welfarePrograms);
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);
  const lifts = useData<StationLift[]>(DATA.elevators);

  const [on, setOn] = useState<Record<Filter, boolean>>({
    charger: true,
    medical: false,
    welfare: true,
    program: true,
  });
  const [dongCd, setDongCd] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked>(null);
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);

  const all = useMemo(
    () => dongs.data?.features.map((f) => f.properties) ?? [],
    [dongs.data],
  );
  const dong = useMemo(
    () => all.find((p) => p.admCd === dongCd) ?? null,
    [all, dongCd],
  );

  const counts = useMemo(() => {
    const c = { charger: 0, hospital: 0, pharmacy: 0, welfare: 0 };
    for (const p of points.data ?? []) {
      if (p.type in c) c[p.type as keyof typeof c] += 1;
    }
    return c;
  }, [points.data]);

  const visiblePois = useMemo(
    () => (points.data ?? []).filter((p) => poiPasses(p.type, on)),
    [points.data, on],
  );

  const hubs = useMemo<ProgramHub[]>(() => {
    const byKey = new Map<string, ProgramHub>();
    for (const p of welfare.data?.programs ?? []) {
      if (p.lng == null || p.lat == null) continue;
      const key = `${p.center}|${p.lng}|${p.lat}`;
      const hub =
        byKey.get(key) ??
        ({
          center: p.center,
          gu: p.gu,
          lng: p.lng,
          lat: p.lat,
          approx: Boolean(p.locationApprox),
          programs: [],
        } satisfies ProgramHub);
      hub.programs.push(p);
      byKey.set(key, hub);
    }
    return [...byKey.values()];
  }, [welfare.data]);

  const toiletShare = useMemo(() => {
    const rows = toilets.data ?? [];
    const total = rows.reduce((a, t) => a + t.total, 0);
    const acc = rows.reduce((a, t) => a + t.accessible, 0);
    return total > 0 ? { total, acc, share: acc / total } : null;
  }, [toilets.data]);

  // ── profile of the selected 행정동 ───────────────────────────────────────
  const profile = useMemo(() => {
    if (!dong) return null;
    const guPrograms = (welfare.data?.programs ?? []).filter(
      (p) => p.gu === dong.gu,
    );
    const covered = new Set<string>();
    for (const p of guPrograms) {
      if (p.matchType !== "general") p.disabilityTypes.forEach((t) => covered.add(t));
    }
    const generalCount = guPrograms.filter((p) => p.isGeneral).length;
    const guToilets = (toilets.data ?? []).find((t) => t.gu === dong.gu) ?? null;
    const nearby = (points.data ?? []).filter(
      (p) => p.dong === dong.name && poiPasses(p.type, on),
    );
    const missing: string[] = [];
    if (dong.chargers === 0) missing.push("전동휠체어 급속충전기 0개");
    if (dong.hospitals === 0) missing.push("병의원 0곳");
    if (dong.pharmacies === 0) missing.push("약국 0곳");
    if (dong.welfare === 0) missing.push("장애인복지시설 0곳");
    if (guPrograms.length === 0) missing.push("복지 프로그램 원자료 미확보");
    else if (covered.size === 0) missing.push("장애유형 직접 명시 프로그램 없음");
    if (guToilets && guToilets.total > 0 && guToilets.accessible / guToilets.total < 0.5)
      missing.push("장애인화장실 보유율 50% 미만");
    if (dong.shopsFloor1Share !== null && dong.shopsFloor1Share < 0.4)
      missing.push("1층 상가 비율 낮음");
    return {
      guPrograms,
      generalCount,
      covered,
      guToilets,
      nearby,
      missing,
      hubs: hubs.filter((h) => h.gu === dong.gu),
    };
  }, [dong, welfare.data, toilets.data, points.data, on, hubs]);

  const worstDongs = useMemo(
    () =>
      [...all]
        .filter((p) => p.dropoffs > 0)
        .sort((a, b) => a.infraZ - b.infraZ || b.dropoffs - a.dropoffs)
        .slice(0, 30),
    [all],
  );

  const selectDong = useCallback((p: DongProps, fly = true) => {
    setDongCd((current) => (current === p.admCd ? null : p.admCd));
    if (fly)
      setFlyTo({
        longitude: p.centroid[0],
        latitude: p.centroid[1],
        zoom: 13.2,
      });
  }, []);

  // ── layers ──────────────────────────────────────────────────────────────
  const layers = useMemo<Layer[]>(() => {
    const out: Layer[] = [];
    if (dongs.data) {
      const zs = all.map((p) => p.infraZ);
      const min = Math.min(...zs, 0);
      const max = Math.max(...zs, 1);
      out.push(
        new GeoJsonLayer<DongProps>({
          id: "infra-choro",
          data: dongs.data as never,
          pickable: true,
          stroked: true,
          filled: true,
          getFillColor: (f) => {
            const t = (f.properties.infraZ - min) / (max - min || 1);
            return [52, 211, 153, Math.round(12 + t * 120)];
          },
          getLineColor: (f) =>
            f.properties.admCd === dongCd
              ? [34, 211, 238, 255]
              : [35, 43, 61, 170],
          getLineWidth: (f) => (f.properties.admCd === dongCd ? 2.5 : 1),
          lineWidthUnits: "pixels",
          autoHighlight: true,
          highlightColor: [255, 255, 255, 55],
          onClick: (info) => {
            const p = (info.object as { properties?: DongProps } | undefined)
              ?.properties;
            if (p) selectDong(p, false);
          },
          updateTriggers: {
            getLineColor: [dongCd],
            getLineWidth: [dongCd],
          },
        }),
      );
    }

    if (visiblePois.length > 0) {
      out.push(
        new ScatterplotLayer<InfraPoint>({
          id: "infra-pois",
          data: visiblePois,
          getPosition: (d) => [d.lng, d.lat],
          getFillColor: (d) => {
            const c = POI_RGB[d.type] ?? [139, 150, 171];
            return [c[0], c[1], c[2], d.type === "charger" ? 255 : 175];
          },
          getRadius: (d) => (d.type === "charger" ? 5 : 3),
          radiusUnits: "pixels",
          stroked: true,
          getLineColor: (d) =>
            picked?.kind === "poi" &&
            picked.poi.name === d.name &&
            picked.poi.lng === d.lng
              ? [34, 211, 238, 255]
              : [0, 0, 0, 0],
          getLineWidth: (d) =>
            picked?.kind === "poi" &&
            picked.poi.name === d.name &&
            picked.poi.lng === d.lng
              ? 3
              : 0,
          lineWidthUnits: "pixels",
          pickable: true,
          onClick: (info) => {
            const p = info.object as InfraPoint | undefined;
            if (!p) return;
            setPicked({ kind: "poi", poi: p });
            setFlyTo({ longitude: p.lng, latitude: p.lat, zoom: 14.8 });
          },
          updateTriggers: {
            getLineColor: [picked],
            getLineWidth: [picked],
          },
        }),
      );
    }

    if (on.program && hubs.length > 0) {
      out.push(
        new ScatterplotLayer<ProgramHub>({
          id: "infra-hubs",
          data: hubs,
          getPosition: (d) => [d.lng, d.lat],
          getRadius: 8,
          radiusUnits: "pixels",
          getFillColor: [192, 132, 252, 230],
          stroked: true,
          getLineColor: (d) =>
            picked?.kind === "hub" && picked.hub.center === d.center
              ? [34, 211, 238, 255]
              : d.approx
                ? [251, 191, 36, 220]
                : [11, 15, 26, 220],
          getLineWidth: 2,
          lineWidthUnits: "pixels",
          pickable: true,
          onClick: (info) => {
            const h = info.object as ProgramHub | undefined;
            if (!h) return;
            setPicked({ kind: "hub", hub: h });
            setFlyTo({ longitude: h.lng, latitude: h.lat, zoom: 14.2 });
          },
          updateTriggers: { getLineColor: [picked] },
        }),
      );
    }

    return out;
  }, [dongs.data, all, dongCd, visiblePois, on.program, hubs, picked, selectDong]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      const id = info.layer?.id;
      const o = info.object as Record<string, unknown> | undefined;
      if (!o) return null;
      if (id === "infra-choro") {
        const p = (o as { properties?: DongProps }).properties;
        if (!p) return null;
        return tooltipHtml(
          `<b>${p.gu} ${p.name}</b><br/>충전소 ${fmt(p.chargers)} · 병의원 ${fmt(p.hospitals)} · 복지 ${fmt(p.welfare)}<br/><span style="color:#8b96ab">클릭 = 이 동 프로필</span>`,
        );
      }
      if (id === "infra-pois") {
        const p = o as unknown as InfraPoint;
        return tooltipHtml(
          `<b>${p.name}</b><br/>${INFRA_LABEL[p.type]}${p.detail ? ` · ${p.detail}` : ""}` +
            (p.dong ? `<br/><span style="color:#8b96ab">${p.dong}</span>` : ""),
        );
      }
      if (id === "infra-hubs") {
        const h = o as unknown as ProgramHub;
        return tooltipHtml(
          `<b>${h.center}</b><br/>${h.gu} · 프로그램 ${fmt(h.programs.length)}건` +
            (h.approx
              ? `<br/><span style="color:#fbbf24">근사 위치(구 중심)</span>`
              : ""),
        );
      }
      return null;
    };
  }, []);

  useEffect(() => {
    onMapSpec({ layers, getTooltip, flyTo });
  }, [layers, getTooltip, flyTo, onMapSpec]);

  // ── KPI band ────────────────────────────────────────────────────────────
  const kpis = (
    <div className="grid grid-cols-4 gap-2">
      <KpiTile
        label="전동휠체어 급속충전기"
        value={points.data ? `${fmt(counts.charger)}기` : "—"}
        sub="가장 희소한 자원"
        color={INFRA_HEX.charger}
      />
      <KpiTile
        label="의료 접근 (병의원·약국)"
        value={
          points.data ? `${fmt(counts.hospital + counts.pharmacy)}곳` : "—"
        }
        sub={
          points.data
            ? `병의원 ${fmt(counts.hospital)} · 약국 ${fmt(counts.pharmacy)}`
            : undefined
        }
        color={INFRA_HEX.hospital}
      />
      <KpiTile
        label="장애인화장실 보유율"
        value={toiletShare ? pct(toiletShare.share) : "—"}
        sub={
          toiletShare
            ? `${fmt(toiletShare.acc)}/${fmt(toiletShare.total)}곳`
            : undefined
        }
        color={HEX.accent}
      />
      <KpiTile
        label="복지 프로그램"
        value={welfare.data ? `${fmt(welfare.data.stats.total)}건` : "—"}
        sub={
          welfare.data
            ? `운영기관 ${fmt(hubs.length)}곳 · 5개구 확보`
            : undefined
        }
        color={HEX.tourism}
      />
    </div>
  );

  const toolbar = (
    <>
      <MapToolbar label="표시할 인프라">
        {FILTERS.map((f) => (
          <Chip
            key={f.id}
            active={on[f.id]}
            color={f.color}
            onClick={() => setOn((prev) => ({ ...prev, [f.id]: !prev[f.id] }))}
          >
            {f.label}
          </Chip>
        ))}
      </MapToolbar>
      <div className="rounded-lg border border-line bg-panel/92 px-2.5 py-1.5 text-[10px] leading-4 text-dim backdrop-blur">
        행정동 음영이 <b className="text-infra">짙을수록 인프라가 많은 동</b>입니다
        · 동을 클릭하면 프로필이 열립니다
      </div>
    </>
  );

  // ── right column ────────────────────────────────────────────────────────
  const side: ReactNode = (
    <div className="space-y-3">
      {picked && (
        <Panel
          title={picked.kind === "poi" ? picked.poi.name : picked.hub.center}
          aside={
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="text-accent hover:underline"
            >
              닫기
            </button>
          }
          padded
        >
          {picked.kind === "poi" ? (
            <dl className="space-y-1 text-[12px]">
              <Row k="유형" v={INFRA_LABEL[picked.poi.type]} />
              {picked.poi.detail && <Row k="세부" v={picked.poi.detail} />}
              <Row k="행정동" v={picked.poi.dong ?? "미확인"} />
              <Row
                k="좌표"
                v={`${picked.poi.lat.toFixed(4)}, ${picked.poi.lng.toFixed(4)}`}
              />
            </dl>
          ) : (
            <>
              <dl className="space-y-1 text-[12px]">
                <Row k="구" v={picked.hub.gu} />
                <Row k="프로그램" v={`${fmt(picked.hub.programs.length)}건`} />
                <Row
                  k="지도 위치"
                  v={picked.hub.approx ? "근사값(구 중심)" : "주소 기반"}
                />
              </dl>
              <div className="mt-2 flex flex-wrap gap-1">
                {[
                  ...new Set(
                    picked.hub.programs.flatMap((p) =>
                      p.matchType === "general" ? [] : p.disabilityTypes,
                    ),
                  ),
                ].map((t) => (
                  <span
                    key={t}
                    className="rounded px-1.5 py-0.5 text-[10px] leading-4 text-[#0b0f1a]"
                    style={{ background: DISABILITY_HEX[t] ?? HEX.inkDim }}
                  >
                    {t}
                  </span>
                ))}
              </div>
              <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-[11px] text-dim">
                {picked.hub.programs.slice(0, 20).map((p) => (
                  <li key={p.id} className="truncate">
                    · {p.programName}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      )}

      {dong && profile ? (
        <>
          <Panel title={`${dong.gu} ${dong.name} 프로필`} aside="시설 수" padded>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  ["급속충전기", dong.chargers, INFRA_HEX.charger],
                  ["병의원", dong.hospitals, INFRA_HEX.hospital],
                  ["약국", dong.pharmacies, INFRA_HEX.pharmacy],
                  ["복지시설", dong.welfare, INFRA_HEX.welfare],
                ] as [string, number, string][]
              ).map(([label, n, color]) => (
                <div
                  key={label}
                  className="rounded-md border border-line bg-[#0e1424] px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-1.5 text-[10px] text-dim">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: color }}
                    />
                    {label}
                  </div>
                  <div className="tnum text-[15px] font-bold leading-5 text-ink">
                    {fmt(n)}
                  </div>
                </div>
              ))}
            </div>
            <dl className="mt-2 space-y-1 text-[11.5px]">
              <Row k="두리발 하차 / 승차" v={`${fmt(dong.dropoffs)} / ${fmt(dong.pickups)}건`} />
              <Row
                k="1층 상가 비율"
                v={
                  dong.shopsFloor1Share === null
                    ? "—"
                    : pct(dong.shopsFloor1Share)
                }
              />
              <Row
                k={`${dong.gu} 장애인화장실`}
                v={
                  profile.guToilets
                    ? `${fmt(profile.guToilets.accessible)}/${fmt(profile.guToilets.total)}곳`
                    : "원자료 없음"
                }
              />
            </dl>
          </Panel>

          <Panel
            title="이용 가능한 프로그램"
            aside={`${dong.gu} · ${fmt(profile.guPrograms.length)}건`}
            padded
          >
            {profile.guPrograms.length === 0 ? (
              <p className="text-[11.5px] leading-4 text-dim">
                이 구는 프로그램 원자료가 아직 확보되지 않았습니다 (확보:
                남구·영도구·사하구·금정구·사상구).
              </p>
            ) : (
              <>
                <div className="text-[11px] text-dim">
                  직접 명시로 커버되는 장애유형
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {DISABILITY_TYPES.map((t) => {
                    const ok = profile.covered.has(t);
                    return (
                      <span
                        key={t}
                        className={`rounded px-1.5 py-0.5 text-[10px] leading-4 ${
                          ok ? "text-[#0b0f1a]" : "bg-[#0e1424] text-dim"
                        }`}
                        style={ok ? { background: DISABILITY_HEX[t] } : undefined}
                      >
                        {t}
                        {ok ? "" : " ✕"}
                      </span>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] leading-4 text-dim">
                  공통(전체 이용가능) {fmt(profile.generalCount)}건 · 운영기관{" "}
                  {fmt(profile.hubs.length)}곳
                </p>
              </>
            )}
          </Panel>

          <Panel
            title="이 동에 없는 것"
            aside={`${fmt(profile.missing.length)}건`}
            padded
          >
            {profile.missing.length === 0 ? (
              <p className="text-[11.5px] text-infra">
                주요 항목에서 확인된 공백이 없습니다.
              </p>
            ) : (
              <ul className="space-y-1">
                {profile.missing.map((m) => (
                  <li
                    key={m}
                    className="rounded bg-unmet/10 px-2 py-1 text-[11.5px] leading-4 text-unmet"
                  >
                    {m}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {profile.nearby.length > 0 && (
            <Panel
              title="이 동의 시설"
              aside={`${fmt(profile.nearby.length)}개 · 클릭 = 카드`}
            >
              <ul className="max-h-56 overflow-y-auto">
                {profile.nearby.slice(0, 60).map((p, i) => (
                  <li key={`${p.name}-${i}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setPicked({ kind: "poi", poi: p });
                        setFlyTo({
                          longitude: p.lng,
                          latitude: p.lat,
                          zoom: 14.8,
                        });
                      }}
                      className="flex w-full items-center gap-2 border-b border-line px-2.5 py-1.5 text-left text-[11.5px] last:border-b-0 hover:bg-[#161e30]"
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: INFRA_HEX[p.type] }}
                      />
                      <span className="min-w-0 flex-1 truncate text-ink">
                        {p.name}
                      </span>
                      <span className="shrink-0 text-[10px] text-dim">
                        {INFRA_LABEL[p.type]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      ) : !dongs.data ? (
        <DataPending note="dongs.geojson 대기 중 — 행정동 프로필이 표시됩니다." />
      ) : (
        <Panel title="인프라가 가장 얇은 동" aside="행 클릭 = 프로필">
          <ul>
            {worstDongs.map((p, i) => (
              <li key={p.admCd}>
                <button
                  type="button"
                  onClick={() => selectDong(p)}
                  className="flex w-full items-center gap-2 border-b border-line px-2.5 py-1.5 text-left text-[12px] last:border-b-0 hover:bg-[#161e30]"
                >
                  <span className="tnum w-5 shrink-0 text-dim">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-ink">{p.name}</span>
                    <span className="ml-1 text-[10px] text-dim">{p.gu}</span>
                  </span>
                  <span className="tnum shrink-0 text-[10.5px] text-dim">
                    충전 {fmt(p.chargers)} · 하차 {fmt(p.dropoffs)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Explainer
        what={
          <p>
            &ldquo;내린 다음&rdquo;의 환경을 한 화면에 모았습니다: 전동휠체어
            급속충전기·병의원·약국·장애인복지시설의 위치, 구별 장애인화장실
            보유율, 그리고 5개구 복지관이 실제로 운영하는 프로그램입니다. 지도의
            행정동을 클릭하면 그 동의 시설 수·이용 가능한 프로그램·커버되는
            장애유형·부족한 항목이 한 프로필로 열립니다.
          </p>
        }
        how={
          <p>
            시설은 공공데이터 좌표를 그대로 찍었고(전동휠체어 급속충전기 —
            부산시, 병의원·약국 — 건강보험심사평가원, 장애인복지시설 — SHP),
            동별 개수는 행정동 경계 안 point-in-polygon 집계입니다. 프로그램은
            5개구 복지관 CSV를 15개 공식 장애유형으로 분류한 결과이며,
            &ldquo;직접 명시&rdquo;만 커버로 셉니다. 장애인화장실은 원자료에
            좌표가 없어 구 단위 보유율로만 표시합니다.
          </p>
        }
        caveats={
          <p>
            시설의 <b>존재</b>와 <b>실제 사용 가능</b>은 다릅니다 — 고장난
            충전기나 입구에 턱이 있는 병원도 같은 점으로 찍힙니다. 남구·사상구
            복지관은 원자료에 주소가 없어 지도상 위치가 구 중심 근사값(노란
            테두리)이고, 프로그램 원자료는 5개구만 확보돼 나머지 구의 프로필에는
            프로그램 칸이 비어 있습니다 — 0건이라는 뜻이 아닙니다.
          </p>
        }
      />
    </div>
  );

  // ── bottom strip ────────────────────────────────────────────────────────
  const action = (() => {
    if (!dong || !profile)
      return {
        label: "인프라가 얇은 동부터 프로필 확인",
        owner: "구청",
        impact: "지도나 목록에서 행정동을 선택하세요.",
      };
    if (dong.chargers === 0 && dong.dropoffs > 0)
      return {
        label: "전동휠체어 급속충전기 우선 설치",
        owner: "구청·윌체어",
        impact: `이 동 하차 ${fmt(dong.dropoffs)}건이 충전 공백 위에 놓여 있습니다.`,
      };
    if (dong.welfare === 0)
      return {
        label: "복지 프로그램 순회 배치 (인근 복지관 연계)",
        owner: "구청",
        impact: `${dong.gu} 운영기관 ${fmt(profile.hubs.length)}곳과 연계 가능`,
      };
    if (profile.guPrograms.length > 0 && profile.covered.size < 5)
      return {
        label: "장애유형별 프로그램 확충 (직접 명시 기준)",
        owner: "복지관·구청",
        impact: `현재 직접 명시 커버 ${fmt(profile.covered.size)}/15개 유형`,
      };
    if (dong.shopsFloor1Share !== null && dong.shopsFloor1Share < 0.4)
      return {
        label: "1층 접근 가능 상가 확충·입구 개선",
        owner: "윌체어·업주",
        impact: `1층 비율 ${pct(dong.shopsFloor1Share)}`,
      };
    return {
      label: "현 수준 유지 · 이용률 관찰",
      owner: "구청",
      impact: "주요 항목에서 확인된 공백이 없습니다.",
    };
  })();

  const bottom = (
    <div className="flex items-stretch gap-3">
      {dong ? (
        <div className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[14px] font-bold leading-5 text-ink">
              {dong.gu} {dong.name}
            </h2>
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-4"
              style={{
                color: dong.gapClass === "HL" ? HEX.gapHL : HEX.infra,
                background:
                  dong.gapClass === "HL" ? `${HEX.gapHL}1f` : `${HEX.infra}1f`,
              }}
            >
              {dong.gapClass === "HL" ? "수요高·인프라低" : "인프라 지수 보통 이상"}
            </span>
            <button
              type="button"
              onClick={() => setDongCd(null)}
              className="ml-auto shrink-0 text-[10.5px] text-accent hover:underline"
            >
              선택 해제
            </button>
          </div>
          <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
            {(
              [
                ["시설 합계", `${fmt(dong.chargers + dong.hospitals + dong.pharmacies + dong.welfare)}개`],
                ["프로그램", `${fmt(profile?.guPrograms.length ?? 0)}건`],
                ["커버 장애유형", `${fmt(profile?.covered.size ?? 0)}/15`],
                ["부족 항목", `${fmt(profile?.missing.length ?? 0)}건`],
                ["인프라 지수 z", dong.infraZ.toFixed(2)],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-1.5">
                <dt className="text-[10.5px] text-dim">{k}</dt>
                <dd className="tnum text-[12px] font-semibold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center rounded-lg border border-dashed border-line bg-panel/40 px-3.5 py-2.5 text-[11.5px] leading-5 text-dim">
          지도의 행정동을 클릭하면 그 동의 시설·프로그램·부족 항목이 하나의
          프로필로 열립니다. 시설이나 운영기관 점을 클릭하면 어느 레이어든 같은
          형식의 카드가 나타납니다.
          {lifts.data
            ? ` 참고: 승강기 없는 도시철도역 ${fmt((lifts.data ?? []).filter((l) => l.elevators === 0).length)}곳.`
            : ""}
        </div>
      )}
      <ActionCard
        eyebrow="권고 조치"
        action={action.label}
        owner={action.owner}
        impact={action.impact}
      />
    </div>
  );

  return (
    <PresentationLayout
      question="이 동네에서 실제로 쓸 수 있는 생활 인프라는 무엇인가?"
      hint="시설 · 프로그램 · 장애유형 커버리지를 한 프로필로."
      kpis={kpis}
      toolbar={toolbar}
      map={map}
      side={side}
      bottom={bottom}
      footnote="공공데이터 갱신 주기는 데이터셋마다 다르며, 프로그램 원자료는 5개구만 확보된 상태입니다. 회색·빈 값은 0이 아니라 원자료 범위 밖일 수 있습니다."
    />
  );
}

function Panel({
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
        {aside && <span className="shrink-0 text-[10px] text-dim">{aside}</span>}
      </header>
      <div className={padded ? "px-3 py-2.5" : ""}>{children}</div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-line/60 pb-1 last:border-b-0">
      <dt className="shrink-0 text-dim">{k}</dt>
      <dd className="tnum text-right text-ink">{v}</dd>
    </div>
  );
}
