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

/** Mini bar chart of requests by day-of-week (월..일). */
export function DowBar({
  data,
  height = 96,
}: {
  data: { label: string; requests: number }[];
  height?: number;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: -60 }}>
          <XAxis
            dataKey="label"
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: "var(--line)" }}
          />
          <YAxis tick={false} tickLine={false} axisLine={false} width={54} />
          <Tooltip
            cursor={CURSOR_FILL}
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
            formatter={(v) => [`${fmt(Number(v))}건`, "접수"]}
          />
          <Bar
            dataKey="requests"
            name="접수"
            fill={HEX.demand}
            fillOpacity={0.65}
            radius={[3, 3, 0, 0]}
            maxBarSize={18}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
