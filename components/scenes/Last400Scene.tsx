"use client";

import { useEffect, useMemo, useState } from "react";
import { GeoJsonLayer, ScatterplotLayer } from "deck.gl";
import {
  DATA,
  type AccessActions,
  type AccessShop,
  type DongProps,
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
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";
import { Explainer } from "@/components/ui/Explainer";

type Cls = "good" | "warning" | "critical";
interface Status {
  enterable: boolean;
  usable: boolean;
  comfort: boolean;
  barrier: string;
  cls: Cls;
}

/** enterable→usable→comfort chain from the 12 Y/N audit fields (doc §5).
 *  sim = 입구 무턱화(entrance made step-free) counterfactual. */
function statusOf(f: Record<string, string>, sim: boolean): Status {
  const entryOk = sim || f["입구턱"] !== "Y" || f["입구무턱"] === "Y" || f["경사로"] === "Y";
  const floorOk = f["일층"] === "Y" || f["엘리베이터"] === "Y";
  const enterable = entryOk && floorOk;
  const usable = enterable && f["테이블석"] === "Y";
  const comfort = usable && f["장애인화장실"] === "Y";
  const barrier = !entryOk
    ? "입구(진입)"
    : !floorOk
      ? "층이동"
      : f["테이블석"] !== "Y"
        ? "내부이용"
        : f["장애인화장실"] !== "Y"
          ? "편의(화장실)"
          : "완비";
  const cls: Cls = comfort ? "good" : !enterable ? "critical" : "warning";
  return { enterable, usable, comfort, barrier, cls };
}

const CLS_RGBA: Record<Cls, [number, number, number, number]> = {
  good: [52, 211, 153, 235], // infra green — 완비
  warning: [251, 191, 36, 235], // warn amber — 진입가능·미완비
  critical: [229, 72, 77, 240], // gapHL red — 진입 불가
};
const CLS_HEX: Record<Cls, string> = {
  good: HEX.infra,
  warning: HEX.warn,
  critical: HEX.gapHL,
};

/** hard gate (입구/층) → red, quality gap (내부/편의) → amber. */
function barrierHex(barrier: string): string {
  if (barrier.startsWith("입구") || barrier === "층이동") return HEX.gapHL;
  if (barrier === "완비") return HEX.infra;
  return HEX.warn;
}

/** the concrete fix + responsible party for each broken link (doc §8). */
function actionOf(barrier: string): { label: string; owner: string } {
  if (barrier.startsWith("입구") || barrier === "층이동")
    return { label: "입구 무턱화·경사로 설치", owner: "구청·건물주" };
  if (barrier === "내부이용") return { label: "내부 통로·좌석 개선", owner: "업주" };
  if (barrier === "편의(화장실)") return { label: "장애인화장실 설치", owner: "업주·구청" };
  return { label: "접근 거점 유지", owner: "—" };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function Last400Scene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const access = useData<AccessActions>(DATA.accessActions);
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);

  const [selected, setSelected] = useState<number | null>(null);
  const [sim, setSim] = useState(false);
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);
  const [didFly, setDidFly] = useState(false);

  const shops = useMemo(() => access.data?.shops ?? [], [access.data]);
  const drops = useMemo(() => access.data?.dropoffs ?? [], [access.data]);

  // live status per shop under the current sim toggle
  const statuses = useMemo(
    () => shops.map((s) => statusOf(s.fields, sim)),
    [shops, sim],
  );

  const roll = useMemo(() => {
    const enterable = statuses.filter((s) => s.enterable).length;
    const usable = statuses.filter((s) => s.usable).length;
    const comfort = statuses.filter((s) => s.comfort).length;
    const dna: Record<string, number> = {};
    for (const s of statuses) dna[s.barrier] = (dna[s.barrier] ?? 0) + 1;
    const baseEnterable = shops.filter((s) => statusOf(s.fields, false).enterable).length;
    return { enterable, usable, comfort, dna, baseEnterable };
  }, [statuses, shops]);

  // ranked action list: what to fix, ordered by served 하차 (skip 완비 = nothing to fix)
  const actions = useMemo(
    () =>
      shops
        .map((s, i) => ({ s, i, st: statuses[i] }))
        .filter((x) => x.st && x.st.barrier !== "완비")
        .sort((a, b) => b.s.nearbyArrivals - a.s.nearbyArrivals),
    [shops, statuses],
  );

  // fly to the sample area once the data lands
  useEffect(() => {
    if (!access.data || didFly || shops.length === 0) return;
    setFlyTo({
      longitude: avg(shops.map((s) => s.lng)),
      latitude: avg(shops.map((s) => s.lat)),
      zoom: 14.6,
    });
    setDidFly(true);
  }, [access.data, didFly, shops]);

  const layers = useMemo(() => {
    const out = [];
    if (dongs.data) {
      out.push(
        new GeoJsonLayer<DongProps>({
          id: "l4-dongs",
          data: dongs.data as never,
          stroked: true,
          filled: false,
          getLineColor: [35, 43, 61, 150],
          getLineWidth: 1,
          lineWidthUnits: "pixels",
        }),
      );
    }
    if (drops.length > 0) {
      out.push(
        new ScatterplotLayer<[number, number]>({
          id: "l4-drops",
          data: drops,
          getPosition: (d) => d,
          getRadius: 22,
          radiusUnits: "meters",
          radiusMinPixels: 1.5,
          radiusMaxPixels: 4,
          getFillColor: [56, 189, 248, 42], // demand blue, low opacity
        }),
      );
    }
    if (shops.length > 0) {
      out.push(
        new ScatterplotLayer<AccessShop>({
          id: "l4-shops",
          data: shops,
          getPosition: (d) => [d.lng, d.lat],
          getRadius: 26,
          radiusUnits: "meters",
          radiusMinPixels: 6,
          radiusMaxPixels: 13,
          getFillColor: (d) => CLS_RGBA[statusOf(d.fields, sim).cls],
          stroked: true,
          getLineColor: (_d, { index }) =>
            index === selected ? [34, 211, 238, 255] : [11, 15, 26, 220],
          getLineWidth: (_d, { index }) => (index === selected ? 3 : 1.5),
          lineWidthUnits: "pixels",
          pickable: true,
          onClick: (info) => {
            const i = info.index;
            if (i < 0) return;
            const s = shops[i];
            setSelected(i);
            setFlyTo({ longitude: s.lng, latitude: s.lat, zoom: 15.4 });
          },
          updateTriggers: {
            getFillColor: [sim],
            getLineColor: [selected],
            getLineWidth: [selected],
          },
        }),
      );
    }
    return out;
  }, [dongs.data, drops, shops, sim, selected]);

  const getTooltip = useMemo<MapSpec["getTooltip"]>(() => {
    return (info) => {
      const s = info.object as AccessShop | undefined;
      if (!s || !("fields" in s)) return null;
      const st = statusOf(s.fields, sim);
      const chip = (k: string) => {
        const yes = s.fields[k] === "Y";
        return `<span style="color:${yes ? "#4fd14f" : "#8b96ab"}">${k} ${yes ? "○" : "✕"}</span>`;
      };
      return tooltipHtml(
        `<b>${s.name}</b> <span style="color:#8b96ab">${s.cat}</span><br/>` +
          ["경사로", "입구턱", "일층", "엘리베이터", "테이블석", "장애인화장실"]
            .map(chip)
            .join(" · ") +
          `<br/><span style="color:${CLS_HEX[st.cls]}">판정: ${st.barrier}</span>`,
      );
    };
  }, [sim]);

  useEffect(() => {
    onMapSpec({ layers, getTooltip, flyTo });
  }, [layers, getTooltip, flyTo, onMapSpec]);

  if (!access.data) {
    return (
      <DataPending note="access_actions.json 대기 중 — 무장애가게 실사 × 하차 접근성 사슬이 표시됩니다." />
    );
  }

  const { summary, meta } = access.data;
  const sel = selected !== null ? shops[selected] : null;
  const selSt = sel ? statusOf(sel.fields, sim) : null;
  const N = shops.length;

  const stages: [string, number, string][] = [
    ["무장애가게", N, HEX.demand],
    ["진입 가능", roll.enterable, HEX.warn],
    ["내부 이용", roll.usable, HEX.warn],
    ["완비", roll.comfort, HEX.infra],
  ];
  const dnaOrder = ["입구(진입)", "층이동", "내부이용", "편의(화장실)", "완비"];
  const dnaMax = Math.max(1, ...Object.values(roll.dna));

  return (
    <div className="space-y-3">
      {/* selected shop ------------------------------------------------------ */}
      {sel && selSt && (
        <Section
          title={sel.name}
          aside={
            <button type="button" onClick={() => setSelected(null)} className="text-accent hover:underline">
              선택 해제
            </button>
          }
        >
          <div className="mb-2 flex items-center justify-between text-[12px]">
            <span className="text-dim">{sel.cat}</span>
            <span className="font-semibold" style={{ color: CLS_HEX[selSt.cls] }}>
              {selSt.enterable ? (selSt.comfort ? "완비" : "진입 가능 · 미완비") : "진입 불가"} · {selSt.barrier}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {["일층", "경사로", "입구턱", "입구무턱", "테이블석", "화장실무턱", "장애인화장실", "엘리베이터", "장애인주차장"].map((k) => {
              const yes = sel.fields[k] === "Y";
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
        </Section>
      )}

      {/* headline tiles ----------------------------------------------------- */}
      <Section title="이 미시존이 말하는 것" aside={meta.scope}>
        <div className="grid grid-cols-2 gap-2">
          <div
            className="col-span-2 rounded-lg border bg-[#1c1418] px-3 py-2.5"
            style={{ borderColor: "rgba(229,72,77,0.4)" }}
          >
            <div className="text-[30px] font-semibold leading-none" style={{ color: HEX.gapHL }}>
              {roll.comfort}
            </div>
            <div className="mt-1 text-[11px] leading-4 text-dim">
              {N}개 무장애가게 중 <b className="text-ink">장애인화장실까지 완비</b>된 곳
            </div>
          </div>
          {(
            [
              [fmt(summary.arrivals), "두리발 하차 (13개월)"],
              [`${N}`, "무장애가게"],
              [`${roll.enterable}`, "진입 가능"],
              [`${roll.usable}`, "내부 이용 가능"],
            ] as [string, string][]
          ).map(([v, l]) => (
            <div key={l} className="rounded-lg border border-line bg-[#0e1424] px-3 py-2">
              <div className="tnum text-[20px] font-semibold leading-none text-ink">{v}</div>
              <div className="mt-1 text-[11px] leading-4 text-dim">{l}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* chain funnel ------------------------------------------------------- */}
      <Section
        title="이동완성 사슬 — 어디서 줄어드나"
        aside={
          <button
            type="button"
            onClick={() => setSim((v) => !v)}
            className={`rounded border px-2 py-0.5 text-[11px] ${
              sim ? "border-accent/60 bg-accent/10 text-accent" : "border-line text-dim hover:text-ink"
            }`}
          >
            입구 무턱화 시뮬 {sim ? "ON" : "OFF"}
          </button>
        }
      >
        <div className="space-y-1.5">
          {stages.map(([label, n, color]) => (
            <div key={label} className="grid grid-cols-[84px_1fr_32px] items-center gap-2.5 text-[12px]">
              <span className="text-dim">{label}</span>
              <span className="h-[18px] overflow-hidden rounded bg-[#0e1424]">
                <span
                  className="block h-full rounded"
                  style={{ width: `${(100 * n) / Math.max(1, N)}%`, background: color, opacity: 0.85 }}
                />
              </span>
              <span className="tnum text-right text-ink">{n}</span>
            </div>
          ))}
        </div>
        {sim && (
          <p className="mt-2 text-[11px] leading-4 text-warn">
            입구 무턱화 시뮬: 진입 가능 {roll.baseEnterable} → {roll.enterable} (+{roll.enterable - roll.baseEnterable}곳).
            완비는 여전히 {roll.comfort} — 장애인화장실이 다음 병목입니다.
          </p>
        )}
      </Section>

      {/* barrier DNA -------------------------------------------------------- */}
      <Section title="Barrier DNA — 사슬이 끊기는 지점">
        <div className="space-y-2">
          {dnaOrder
            .filter((k) => roll.dna[k])
            .map((k) => (
              <div key={k} className="grid grid-cols-[104px_1fr_24px] items-center gap-2.5 text-[12px]">
                <span className="text-dim">{k}</span>
                <span className="h-4 overflow-hidden rounded bg-[#0e1424]">
                  <span
                    className="block h-full rounded"
                    style={{ width: `${(100 * roll.dna[k]) / dnaMax}%`, background: barrierHex(k) }}
                  />
                </span>
                <span className="tnum text-right text-ink">{roll.dna[k]}</span>
              </div>
            ))}
        </div>
        <p className="mt-2 text-[11px] leading-4 text-dim">
          지배적 broken-link 기준. 대부분 진입은 되지만 <b className="text-ink">편의(장애인화장실)</b>에서 막힙니다 —
          &ldquo;가게가 없는 게 아니라, 문 앞·화장실에서 끊긴다&rdquo;.
        </p>
      </Section>

      {/* next actions ------------------------------------------------------- */}
      <Section title="다음 행동 — 무엇을 · 누가 · 몇 건" aside={`${meta.catchmentM}m 하차 기준 · 행 클릭 = 지도`}>
        <ul className="space-y-0.5">
          {actions.slice(0, 8).map(({ s, i, st }) => {
            const a = actionOf(st.barrier);
            const active = selected === i;
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(active ? null : i);
                    if (!active) setFlyTo({ longitude: s.lng, latitude: s.lat, zoom: 15.4 });
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                    active ? "bg-accent/10" : "hover:bg-[#161e30]"
                  }`}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: barrierHex(st.barrier) }}
                  />
                  <span className="min-w-0 flex-1 text-[12px]">
                    <span className="block truncate text-ink">{s.name}</span>
                    <span className="block truncate text-[11px] text-dim">{a.label}</span>
                  </span>
                  <span className="shrink-0 rounded border border-line bg-[#0e1424] px-1.5 py-px text-[10px] leading-4 text-ink/80">
                    {a.owner}
                  </span>
                  <span className="tnum w-14 shrink-0 text-right text-[11px] text-dim">
                    하차 {fmt(s.nearbyArrivals)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[11px] leading-4 text-dim">
          &ldquo;몇 건&rdquo;은 반경 {meta.catchmentM}m 안 두리발 하차의 거리가중 수 — 그 조치가
          닿는 도착 규모입니다. 빨간 점은 진입 자체가 막힌 곳(hard gate).
        </p>
      </Section>

      <Explainer
        what={
          <p>
            두리발이 실제로 <b>내려준 지점</b>(파란 점 {fmt(summary.arrivals)}건)과 윌체어{" "}
            <b>무장애가게 실사</b>(12개 Y/N 항목)를 겹쳤습니다. 매장 색은 도착 이후 실제
            상태입니다: 빨강 = 문턱·계단으로 <b>진입 불가</b>, 노랑 = 진입은 되지만 완비 아님,
            초록 = 장애인화장실까지 <b>완비</b>. 송정동 표본에서 초록은 0곳입니다.
          </p>
        }
        how={
          <p>
            사슬은 <b>진입(입구턱·무턱·경사로 → 일층·엘리베이터) → 이용(테이블석) → 편의(장애인화장실)</b>
            순서로, 가장 먼저 끊기는 지점이 그 매장의 판정이 됩니다(weakest-link). 12개 항목 중
            하나라도 hard gate가 막히면 나머지가 좋아도 &ldquo;진입 불가&rdquo;입니다. &lsquo;입구 무턱화
            시뮬&rsquo;은 입구턱을 없앴을 때 진입 가능 매장이 몇 곳 느는지 관찰된 반사실만 다시
            계산합니다.
          </p>
        }
        caveats={
          <p>
            현재는 2026 DIVE <b>샘플(송정동)</b>이라 매장 {N}곳 규모입니다 — 본선 전체 해운대
            데이터로 그대로 확장됩니다. 거리는 직선 proximity 기준이라 언덕·횡단보도는 반영되지
            않았고, &ldquo;완비 0곳&rdquo;은 표본의 사실일 뿐 인과·이용자 수 주장이 아닙니다.
            unknown 항목은 없었으며(모두 Y/N), 값이 비면 N으로 단정하지 않습니다.
          </p>
        }
      />
    </div>
  );
}
