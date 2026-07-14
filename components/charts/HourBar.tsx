"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmt } from "@/lib/format";
import {
  CURSOR_FILL,
  TICK,
  TOOLTIP_CONTENT_STYLE,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
} from "./theme";

interface Row {
  hour: number;
  value: number;
}

/** 24-hour bar chart. The top-2 hours get the highlight color so the
 *  peaks (typically 11시/15시) pop without labeling every bar. */
export function HourBar({
  data,
  baseColor,
  hiColor,
  seriesName,
  height = 136,
}: {
  data: Row[];
  baseColor: string;
  hiColor: string;
  seriesName: string;
  height?: number;
}) {
  const top2 = [...data]
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map((d) => d.hour);

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: -26 }}>
          <XAxis
            dataKey="hour"
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: "var(--line)" }}
            interval={2}
            tickFormatter={(h: number) => `${h}시`}
          />
          <YAxis
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={54}
            tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}k` : `${v}`)}
          />
          <Tooltip
            cursor={CURSOR_FILL}
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
            labelFormatter={(h) => `${h}시`}
            formatter={(v) => [`${fmt(Number(v))}건`, seriesName]}
          />
          <Bar dataKey="value" name={seriesName} radius={[3, 3, 0, 0]} maxBarSize={10}>
            {data.map((d) => (
              <Cell
                key={d.hour}
                fill={top2.includes(d.hour) ? hiColor : baseColor}
                fillOpacity={top2.includes(d.hour) ? 1 : 0.55}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
