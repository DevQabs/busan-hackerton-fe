"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GeoJsonLayer, TripsLayer } from "deck.gl";
import { DATA, type AnimTrip, type DongProps } from "@/lib/types";
import { useData } from "@/lib/useData";
import { fmt, hhmm } from "@/lib/format";
import { HEX, RGB_ACCENT, RGB_DEMAND, RGB_GRAY } from "@/lib/palette";
import { type DongCollection, type MapSpec } from "@/lib/mapspec";
import { Section } from "@/components/ui/Section";
import { DataPending } from "@/components/ui/DataPending";

const DAY = 86400;
const TRAIL = 180; // seconds of trail behind each moving dot
const SPEEDS = [30, 120, 300] as const;

export function FlowScene({ onMapSpec }: { onMapSpec: (s: MapSpec) => void }) {
  const trips = useData<AnimTrip[]>(DATA.tripsAnim);
  const dongs = useData<DongCollection<DongProps>>(DATA.dongs);

  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(120);
  const [time, setTime] = useState(7 * 3600); // start the story at 07:00

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
    return out;
  }, [trips.data, dongs.data, time]);

  useEffect(() => {
    onMapSpec({ layers });
  }, [layers, onMapSpec]);

  return (
    <div className="space-y-3">
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
    </div>
  );
}
