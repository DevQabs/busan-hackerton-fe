"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GeoJsonLayer, ScatterplotLayer, TripsLayer } from "deck.gl";
import { DATA, type AnimTrip, type DongProps, type GhostPoint } from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt, hhmm } from "@/lib/format";
import { HEX, RGB_ACCENT, RGB_DEMAND, RGB_GRAY, RGB_UNMET } from "@/lib/palette";
import { type DongCollection, type MapSpec } from "@/lib/mapspec";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";
import { Explainer } from "@/components/ui/Explainer";

const DAY = 86400;
const TRAIL = 180; // seconds of trail behind each moving dot
const SPEEDS = [30, 120, 300] as const;
const GHOST_FADE = 20 * 60; // ghost dot fades out over ~20 simulated minutes

export function FlowScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const trips = useData<AnimTrip[]>(DATA.tripsAnim);
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);
  const ghosts = useData<GhostPoint[]>(DATA.ghosts);

  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(120);
  const [time, setTime] = useState(7 * 3600); // start the story at 07:00
  const [showGhosts, setShowGhosts] = useState(true);

  // rAF clock: advance simulated seconds-of-day by wall-dt × speed.
  const lastRef = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) {
      lastRef.current = null;
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      if (lastRef.current !== null) {
        const dt = (now - lastRef.current) / 1000;
        setTime((t) => (t + dt * speed) % DAY);
      }
      lastRef.current = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      lastRef.current = null;
    };
  }, [playing, speed]);

  const activeCount = useMemo(() => {
    if (!trips.data) return 0;
    // Recompute at most ~1/sec of simulated coarse time to keep it cheap.
    const t = Math.floor(time / 60) * 60;
    let n = 0;
    for (const trip of trips.data) if (trip.t[0] <= t && t <= trip.t[1]) n += 1;
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips.data, Math.floor(time / 60)]);

  // Running totals since midnight, advancing with the clock (per sim-minute).
  const ghostTotals = useMemo(() => {
    if (!ghosts.data) return { unassigned: 0, cancelled: 0 };
    const t = Math.floor(time / 60) * 60;
    let unassigned = 0;
    let cancelled = 0;
    for (const g of ghosts.data) {
      if (g.t > t) continue;
      if (g.kind === "unassigned") unassigned += 1;
      else cancelled += 1;
    }
    return { unassigned, cancelled };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghosts.data, Math.floor(time / 60)]);

  const layers = useMemo(() => {
    const out = [];
    if (dongs.data) {
      out.push(
        new GeoJsonLayer<DongProps>({
          id: "flow-dongs",
          data: dongs.data as never,
          stroked: true,
          filled: false,
          getLineColor: [35, 43, 61, 160],
          getLineWidth: 1,
          lineWidthUnits: "pixels",
        }),
      );
    }
    if (trips.data) {
      out.push(
        new TripsLayer<AnimTrip>({
          id: "flow-trips",
          data: trips.data,
          getPath: (d) => d.p,
          getTimestamps: (d) => d.t,
          getColor: (d) =>
            d.w === 2 ? RGB_ACCENT : d.w === 1 ? RGB_DEMAND : RGB_GRAY,
          currentTime: time,
          trailLength: TRAIL,
          widthMinPixels: 2.5,
          capRounded: true,
          jointRounded: true,
          fadeTrail: true,
          opacity: 0.85,
        }),
      );
    }
    if (showGhosts && ghosts.data) {
      // Ghost dots appear at request time and fade over GHOST_FADE sim-seconds.
      const visible = ghosts.data.filter(
        (g) => g.t <= time && time - g.t <= GHOST_FADE,
      );
      out.push(
        new ScatterplotLayer<GhostPoint>({
          id: "flow-ghosts",
          data: visible,
          getPosition: (d) => d.p,
          getRadius: (d) => (d.kind === "unassigned" ? 110 : 85),
          radiusUnits: "meters",
          radiusMinPixels: 2.5,
          radiusMaxPixels: 14,
          getFillColor: (d) => {
            const age = (time - d.t) / GHOST_FADE; // 0 fresh → 1 gone
            const alpha = Math.round(230 * (1 - age));
            const base = d.kind === "unassigned" ? RGB_UNMET : RGB_GRAY;
            return [base[0], base[1], base[2], alpha];
          },
          stroked: false,
          updateTriggers: { getFillColor: [time] },
        }),
      );
    }
    return out;
  }, [trips.data, dongs.data, ghosts.data, showGhosts, time]);

  useEffect(() => {
    onMapSpec({ layers });
  }, [layers, onMapSpec]);

  return (
    <div className="space-y-3">
      <p className="px-1 text-[12px] leading-5 text-ink/80">
        밝은 궤적은 이동에 성공한 사람들, 붉은 점은 같은 시각 차량을 받지 못한
        요청입니다.
      </p>

      <Section title="시계">
        <div className="flex items-end justify-between">
          <div className="tnum text-[34px] font-bold leading-9 text-ink">
            {hhmm(time)}
          </div>
          <div className="tnum pb-1 text-[11px] text-dim">
            운행 중 {fmt(activeCount)}건
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={DAY - 1}
          step={60}
          value={Math.floor(time)}
          onChange={(e) => setTime(Number(e.target.value))}
          className="mt-2 w-full"
          aria-label="시각 이동"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 text-[12px] font-semibold text-accent hover:bg-accent/20"
          >
            {playing ? "일시정지" : "재생"}
          </button>
          <div className="grid flex-1 grid-cols-3 gap-1 rounded-md border border-line bg-[#0e1424] p-1">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={`tnum rounded px-1 py-1 text-[12px] font-medium ${
                  speed === s ? "bg-accent/15 text-accent" : "text-dim hover:text-ink"
                }`}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>

        {showGhosts && ghosts.data && (
          <div className="tnum mt-2.5 rounded-md border border-unmet/40 bg-unmet/10 px-3 py-2 text-[12px] font-medium text-unmet">
            지금까지 미배차 {fmt(ghostTotals.unassigned)}건 · 취소{" "}
            {fmt(ghostTotals.cancelled)}건
          </div>
        )}
      </Section>

      <Section title="보이지 않는 승객">
        <label className="flex cursor-pointer items-center justify-between text-[12px] text-ink">
          보이지 않는 승객 표시
          <input
            type="checkbox"
            checked={showGhosts}
            onChange={(e) => setShowGhosts(e.target.checked)}
            className="h-4 w-4 accent-[var(--unmet)]"
          />
        </label>
        <ul className="mt-2 space-y-1.5 text-[12px]">
          <li className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: HEX.unmet }} />
            <span className="text-ink">미배차 — 차량을 받지 못한 요청</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#64748b]" />
            <span className="text-ink">취소 — 접수 후 취소된 요청</span>
          </li>
        </ul>
        {!ghosts.data && (
          <div className="mt-2">
            <DataPending note="ghosts.json 대기 중 — 미배차·취소 요청이 시각에 맞춰 나타납니다." />
          </div>
        )}
      </Section>

      <Section title="휠체어 유형">
        <ul className="space-y-1.5 text-[12px]">
          <li className="flex items-center gap-2">
            <span className="h-1 w-5 rounded-full" style={{ background: HEX.accent }} />
            <span className="text-ink">전동휠체어</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1 w-5 rounded-full" style={{ background: HEX.demand }} />
            <span className="text-ink">수동휠체어</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1 w-5 rounded-full bg-[#64748b]" />
            <span className="text-ink">휠체어 미이용</span>
          </li>
        </ul>
        <p className="mt-2 text-[11px] leading-4 text-dim">
          완료된 두리발 운행 {trips.data ? fmt(trips.data.length) : "—"}건을 하루
          시각에 맞춰 재생합니다. 꼬리 길이는 {TRAIL}초입니다.
        </p>
      </Section>

      {!trips.data && (
        <DataPending note="trips_anim.json 대기 중 — 이동 애니메이션이 재생됩니다." />
      )}

      <Explainer
        what={
          <>
            <p>
              하루 동안의 두리발 이동을 시계에 맞춰 재생하는 화면입니다. 밝은
              궤적 하나가 완료된 운행 한 건이고, 색은 휠체어 유형을 나타냅니다.
              &ldquo;보이지 않는 승객&rdquo; 토글을 켜면 같은 시각에 차량을
              받지 못한 요청(붉은 점)과 취소된 요청(회색 점)이 접수 시각에
              나타났다가 약 20분(시뮬레이션 시간)에 걸쳐 사라집니다. 왼쪽
              카운터는 자정 이후 누적 미배차·취소 건수를 시계와 함께
              증가시킵니다. 성공한 이동과 실패한 요청을 같은 화면, 같은 시각에
              두는 것이 이 씬의 목적입니다.
            </p>
          </>
        }
        how={
          <>
            <p>
              완료 운행은 승차·하차 시각을 하루 안의 초 단위로 환산해 경로를
              따라 움직이는 점으로 그립니다. 미배차·취소 요청은 접수 시각과
              접수 지점(승차 예정지)만 사용합니다. 재생 속도는 30·120·300배로
              조절할 수 있고, 슬라이더로 원하는 시각으로 바로 이동할 수
              있습니다. 점의 밝기는 경과 시간에 비례해 줄어들어, 화면에 붉은
              점이 많이 쌓여 있는 시간대가 곧 배차 실패가 몰린 시간대입니다.
            </p>
          </>
        }
        caveats={
          <>
            <p>
              개인정보 보호를 위해 모든 좌표는 약 100m 격자로 반올림했으며,
              개인의 실제 이동 경로가 아니라 출발지와 도착지를 잇는 표현상의
              직선입니다. 취소에는 이용자 사정에 의한 취소도 포함되므로 붉은
              점(미배차)과는 구분해 회색으로 표시합니다. 리허설 데이터(2025년
              5월) 기준이며, 본선 데이터에 미배차 식별 정보가 없을 경우 장기
              대기 건 기준으로 대체 표시할 수 있습니다.
            </p>
          </>
        }
      />
    </div>
  );
}
