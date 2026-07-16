"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DisabilityTypeStat } from "@/lib/types";
import { fmt } from "@/lib/format";
import { HEX } from "@/lib/palette";
import {
  CURSOR_FILL,
  TICK,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
} from "./theme";

/** 유형별 등록 장애인 가로 스택 바: 심한 장애(주황) + 심하지 않은 장애(저채도).
 *  유형별 정도가 없는 구(사하·강서)는 total 단일 바로 폴백. total 내림차순,
 *  0명 유형은 표시하지 않는다. */
export function DisabilityTypeBar({ data }: { data: DisabilityTypeStat[] }) {
  const rows = data
    .filter((t) => (t.total ?? 0) > 0)
    .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
    .map((t) => ({
      label: t.type,
      severe: t.severe ?? 0,
      // 정도 미제공 유형은 전체를 "구분 없음"으로 그린다
      mild: t.severe === null ? 0 : t.mild ?? 0,
      unknown: t.severe === null ? t.total ?? 0 : 0,
    }));
  const height = rows.length * 22 + 28;

  if (rows.length === 0) return null;

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: -8 }}>
          <XAxis type="number" tick={TICK} tickLine={false} axisLine={false} height={20} />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ ...TICK, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={64}
          />
          <Tooltip
            cursor={CURSOR_FILL}
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
            formatter={(v, name) => [
              `${fmt(Number(v))}명`,
              name === "severe" ? "심한 장애" : name === "mild" ? "심하지 않은 장애" : "정도 구분 없음",
            ]}
          />
          <Bar dataKey="severe" stackId="d" fill={HEX.warn} fillOpacity={0.9} maxBarSize={12} />
          <Bar
            dataKey="mild"
            stackId="d"
            fill={HEX.demand}
            fillOpacity={0.35}
            radius={[0, 3, 3, 0]}
            maxBarSize={12}
          />
          <Bar
            dataKey="unknown"
            stackId="d"
            fill={HEX.inkDim}
            fillOpacity={0.35}
            radius={[0, 3, 3, 0]}
            maxBarSize={12}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
