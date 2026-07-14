"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmt } from "@/lib/format";
import { HEX } from "@/lib/palette";
import {
  CURSOR_FILL,
  TICK,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
} from "./theme";

/** Horizontal stacked bars: 베리어프리 관광지 (green) vs 나머지 (gray),
 *  total bar length = 전체 관광지 수. Sorted by total desc. */
export function TourismBar({
  data,
}: {
  data: { label: string; total: number; barrierFree: number }[];
}) {
  const rows = [...data]
    .sort((a, b) => b.total - a.total)
    .map((d) => ({ ...d, rest: Math.max(0, d.total - d.barrierFree) }));
  const height = rows.length * 22 + 28;

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
              `${fmt(Number(v))}곳`,
              name === "barrierFree" ? "베리어프리" : "일반",
            ]}
          />
          <Bar dataKey="barrierFree" stackId="t" fill={HEX.infra} fillOpacity={0.9} maxBarSize={12} />
          <Bar
            dataKey="rest"
            stackId="t"
            fill={HEX.tourism}
            fillOpacity={0.35}
            radius={[0, 3, 3, 0]}
            maxBarSize={12}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
