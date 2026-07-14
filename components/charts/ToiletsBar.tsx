"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { GuToilets } from "@/lib/types";
import { fmt } from "@/lib/format";
import { HEX } from "@/lib/palette";
import {
  CURSOR_FILL,
  TICK,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
} from "./theme";

/** Horizontal stacked bars: 장애인용 fixture 보유 화장실 (green) vs 나머지 (gray),
 *  total bar length = 전체 공중화장실 수. Sorted by accessible desc. */
export function ToiletsBar({ data }: { data: GuToilets[] }) {
  const rows = [...data]
    .sort((a, b) => b.accessible - a.accessible)
    .map((d) => ({ ...d, rest: Math.max(0, d.total - d.accessible) }));
  const height = rows.length * 22 + 28;

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: -8 }}>
          <XAxis type="number" tick={TICK} tickLine={false} axisLine={false} height={20} />
          <YAxis
            type="category"
            dataKey="gu"
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
              `${fmt(Number(v))}개소`,
              name === "accessible" ? "장애인용 보유" : "미보유",
            ]}
          />
          <Bar dataKey="accessible" stackId="t" fill={HEX.infra} fillOpacity={0.9} maxBarSize={12} />
          <Bar
            dataKey="rest"
            stackId="t"
            fill={HEX.gapLL}
            radius={[0, 3, 3, 0]}
            maxBarSize={12}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
